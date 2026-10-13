const { getModelSnapshot, selectProjector } = require('./hubMetadata');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { promisify } = require('util');
const { getConfigDir } = require('../storage');
const { abortable } = require('./requestDeadline');

const runFile = promisify(execFile);

const WINDOWS_X64_RELEASES = Object.freeze({
    llama: Object.freeze({
        tag: 'b10964',
        commit: 'b29c606e28a01b1bc8c1351026a0fa6e616bf6c4',
        archive: 'llama-b10964-bin-win-cpu-x64.zip',
        executable: 'llama-server.exe',
        sha256: '917f39c076402c421224824607397af20f53625a60defc20e8dd22446bf4c5d7',
        url: 'https://github.com/ggml-org/llama.cpp/releases/download/b10964/llama-b10964-bin-win-cpu-x64.zip',
    }),
    whisper: Object.freeze({
        tag: 'b5130',
        stableVersion: 'v1.9.4',
        commit: '927cfce34f31707e17f2bff35c349632fb9e2c3a',
        archive: 'whisper-bin-x64.zip',
        executable: 'whisper-server.exe',
        sha256: 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c',
        url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip',
    }),
});

const WHISPER_MODEL_REPOSITORY = 'ggerganov/whisper.cpp';
const WHISPER_MODEL_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1';
const WHISPER_MODELS = Object.freeze({
    'tiny.en': Object.freeze({
        filename: 'ggml-tiny.en.bin',
        sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f',
    }),
    'base.en': Object.freeze({
        filename: 'ggml-base.en.bin',
        sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
    }),
    'small.en': Object.freeze({
        filename: 'ggml-small.en.bin',
        sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d',
    }),
});

function getBinariesDirectory() {
    return path.join(getConfigDir(), 'binaries');
}

function getModelsDirectory() {
    return path.join(getConfigDir(), 'models');
}

async function calculateSha256(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const input = fs.createReadStream(filePath);
        input.on('error', reject);
        input.on('data', chunk => hash.update(chunk));
        input.on('end', () => resolve(hash.digest('hex')));
    });
}

async function fileMatchesChecksum(filePath, expectedSha256) {
    if (!fs.existsSync(filePath)) {
        return false;
    }

    const actualSha256 = await calculateSha256(filePath);
    return actualSha256 === expectedSha256;
}

async function downloadFile(url, destinationPath, onProgress, signal) {
    const temporaryPath = `${destinationPath}.download-${process.pid}-${Date.now()}`;
    const timeout = AbortSignal.timeout(30 * 60 * 1000);
    const idle = new AbortController();
    signal = AbortSignal.any([...(signal ? [signal] : []), timeout, idle.signal]);
    let idleTimer;
    const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => idle.abort(Object.assign(new Error('Download stalled for 30 seconds. Check network access and retry setup.'), {
            name: 'TimeoutError', code: 'DOWNLOAD_STALLED',
        })), 30000);
    };

    try {
        resetIdle();
        // Explicit byte-zero ranges avoid stalled full-file Hub CDN responses.
        const headers = new URL(url).hostname === 'huggingface.co' ? { Range: 'bytes=0-', 'Accept-Encoding': 'identity' } : undefined;
        const response = await abortable(() => fetch(url, { redirect: 'follow', signal, headers }), signal);
        if (!response.ok || !response.body) {
            try { void response.body?.cancel().catch(() => {}); } catch {}
            throw new Error(`Download failed with HTTP ${response.status}`);
        }
        const expectedBytes = Number(response.headers.get('content-length')) || 0;
        let downloadedBytes = 0;
        const input = Readable.fromWeb(response.body);
        const progressStream = new Transform({
            transform(chunk, encoding, callback) {
                downloadedBytes += chunk.length;
                resetIdle();
                onProgress?.({ downloadedBytes, expectedBytes });
                callback(null, chunk);
            },
        });
        await abortable(() => pipeline(input, progressStream, fs.createWriteStream(temporaryPath, { flags: 'wx' }), { signal }), signal);

        return temporaryPath;
    } catch (error) {
        fs.rmSync(temporaryPath, { force: true });
        throw signal.aborted ? signal.reason : error;
    } finally {
        clearTimeout(idleTimer);
    }
}

async function installVerifiedFile({ url, destinationPath, sha256, onProgress, signal }) {
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

    if (await fileMatchesChecksum(destinationPath, sha256)) {
        return destinationPath;
    }

    const temporaryPath = await downloadFile(url, destinationPath, onProgress, signal);
    try {
        const downloadedSha256 = await calculateSha256(temporaryPath);
    
        if (downloadedSha256 !== sha256) {
            fs.rmSync(temporaryPath, { force: true });
            throw new Error(`Checksum verification failed for ${path.basename(destinationPath)}`);
        }
    
        signal?.throwIfAborted();
        fs.renameSync(temporaryPath, destinationPath);
    
    } finally { fs.rmSync(temporaryPath, { force: true }); }

    return destinationPath;
}

function findRuntimeFile(directory, fileName) {
    if (!fs.existsSync(directory)) return null;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            const nested = findRuntimeFile(entryPath, fileName);
            if (nested) return nested;
        } else if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
            return entryPath;
        }
    }
    return null;
}

function writeJsonAtomic(filePath, value) {
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    try {
        fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temporaryPath, filePath);
    } finally {
        fs.rmSync(temporaryPath, { force: true });
    }
}

function runtimeSource(release) {
    return {
        tag: release.tag,
        commit: release.commit,
        archive: release.archive,
        sha256: release.sha256,
        url: release.url,
    };
}

function installedRuntimeMatches(runtimeDirectory, release) {
    const executable = findRuntimeFile(runtimeDirectory, release.executable);
    if (!executable) return null;
    try {
        const source = JSON.parse(fs.readFileSync(path.join(runtimeDirectory, '.source.json'), 'utf8'));
        return JSON.stringify(source) === JSON.stringify(runtimeSource(release)) ? executable : null;
    } catch {
        return null;
    }
}

async function extractRuntimeArchive(archivePath, runtimeDirectory, release, run = runFile, signal) {
    signal?.throwIfAborted();
    const stagingDirectory = `${runtimeDirectory}.extract-${process.pid}-${Date.now()}`;
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
    fs.mkdirSync(stagingDirectory, { recursive: true });
    try {
        const result = await run('tar.exe', ['-xf', archivePath, '-C', stagingDirectory], {
            signal,
            windowsHide: true,
            encoding: 'utf8',
            timeout: 120000,
        });
        if (result?.error || (result?.status !== undefined && result.status !== 0)) {
            throw new Error(`Windows could not unpack the verified ${release.tag} runtime`);
        }
        signal?.throwIfAborted();
        if (!findRuntimeFile(stagingDirectory, release.executable)) {
            throw new Error(`The verified ${release.tag} package is missing ${release.executable}`);
        }
        writeJsonAtomic(path.join(stagingDirectory, '.source.json'), runtimeSource(release));
        fs.rmSync(runtimeDirectory, { recursive: true, force: true });
        fs.renameSync(stagingDirectory, runtimeDirectory);
        return findRuntimeFile(runtimeDirectory, release.executable);
    } catch (error) {
        fs.rmSync(stagingDirectory, { recursive: true, force: true });
        throw error;
    }
}

async function ensureNativeBinary(type, onProgress, signal) {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
        throw new Error(`Local AI is not available for ${process.platform}/${process.arch}`);
    }
    const release = WINDOWS_X64_RELEASES[type];
    if (!release) throw new Error(`Unsupported Local AI runtime: ${type}`);
    const binariesDirectory = getBinariesDirectory();
    const archivePath = path.join(binariesDirectory, release.archive);
    const runtimeDirectory = path.join(binariesDirectory, `${type}-${release.tag}-cpu`);
    const existing = installedRuntimeMatches(runtimeDirectory, release);
    if (existing && await fileMatchesChecksum(archivePath, release.sha256)) return existing;

    await installVerifiedFile({
        url: release.url,
        destinationPath: archivePath,
        sha256: release.sha256,
        onProgress,
        signal,
    });
    signal?.throwIfAborted();
    return extractRuntimeArchive(archivePath, runtimeDirectory, release, runFile, signal);
}

function normalizeWhisperModel(modelName) {
    const legacyModels = {
        'Xenova/whisper-tiny': 'tiny.en',
        'Xenova/whisper-base': 'base.en',
        'Xenova/whisper-small': 'small.en',
    };

    return legacyModels[modelName] || modelName || 'tiny.en';
}

async function ensureWhisperModel(modelName, onProgress, signal) {
    const normalizedModel = normalizeWhisperModel(modelName);
    const model = WHISPER_MODELS[normalizedModel];

    if (!model) {
        throw new Error(`Unsupported Whisper model: ${modelName}`);
    }

    const destinationPath = path.join(getModelsDirectory(), 'whisper', model.filename);
    return installVerifiedFile({
        url: `https://huggingface.co/${WHISPER_MODEL_REPOSITORY}/resolve/${WHISPER_MODEL_REVISION}/${model.filename}`,
        destinationPath,
        sha256: model.sha256,
        onProgress,
        signal,
    });
}

function encodePathParts(value) {
    return value
        .split('/')
        .map(part => encodeURIComponent(part))
        .join('/');
}

function parseHuggingFaceModelReference(modelReference) {
    const separatorIndex = modelReference.lastIndexOf(':');
    if (separatorIndex <= 0 || separatorIndex === modelReference.length - 1) {
        throw new Error('Language model must use the format owner/repository:quant');
    }

    const repository = modelReference.slice(0, separatorIndex);
    const quant = modelReference.slice(separatorIndex + 1);
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repository) || !/^[A-Za-z0-9._-]+$/.test(quant)) {
        throw new Error('Language model reference contains unsupported characters');
    }

    return {
        repository,
        quant,
    };
}

async function resolveHuggingFaceGguf(modelReference, signal) {
    const { repository, quant } = parseHuggingFaceModelReference(modelReference);
    const { revision, files } = await getModelSnapshot(repository, signal);
    const normalizedQuant = quant.toUpperCase();
    const matches = files.filter(file => {
        return file.type === 'file' && file.path?.toLowerCase().endsWith('.gguf') && file.path.toUpperCase().includes(normalizedQuant) && !file.path.toLowerCase().startsWith('mmproj-');
    });

    if (matches.length !== 1) {
        throw new Error(`Expected one GGUF file for ${modelReference}, found ${matches.length}`);
    }

    const file = matches[0];
    if (!file.lfs?.oid || !file.size) {
        throw new Error(`Hugging Face did not provide checksum metadata for ${file.path}`);
    }

    const projector = selectProjector(files);
    if (!projector?.lfs?.oid || !projector.size) {
        throw new Error(`Hugging Face model ${repository} does not provide a supported multimodal projector`);
    }

    return {
        repository,
        revision,
        quant,
        model: {
            path: file.path,
            sha256: file.lfs.oid,
        },
        projector: {
            path: projector.path,
            sha256: projector.lfs.oid,
        },
    };
}

async function ensureLlamaModel(modelReference, onModelProgress, onProjectorProgress, signal) {
    if (path.isAbsolute(modelReference)) {
        if (path.extname(modelReference).toLowerCase() !== '.gguf') {
            throw new Error('Custom language models must be regular .gguf files.');
        }
        if (!fs.existsSync(modelReference) || !fs.statSync(modelReference).isFile()) {
            throw new Error(`Language model does not exist or is not a regular file: ${modelReference}`);
        }

        const projectorName = ['mmproj-BF16.gguf', 'mmproj-F16.gguf', 'mmproj-F32.gguf'].find(name => {
            const candidate = path.join(path.dirname(modelReference), name);
            return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
        });
        const projectorPath = path.join(path.dirname(modelReference), projectorName || 'mmproj-BF16.gguf');
        if (!projectorName) {
            throw new Error(`Multimodal GGUF projector does not exist beside the selected model: ${projectorPath}`);
        }

        return {
            modelPath: modelReference,
            projectorPath,
        };
    }

    const { repository, quant } = parseHuggingFaceModelReference(modelReference);
    const repositoryDirectory = path.join(getModelsDirectory(), 'llama', repository);
    const model = readModelProvenance(repositoryDirectory, repository, quant) || await resolveHuggingFaceGguf(modelReference, signal);
    // Pin both artifacts before downloading so an interrupted setup resumes the same revision.
    persistModelProvenance(repositoryDirectory, { schemaVersion: 1, ...model });
    onModelProgress?.({ phase: 'checking' });
    const modelPath = await installVerifiedFile({
        url: `https://huggingface.co/${encodePathParts(model.repository)}/resolve/${model.revision}/${encodePathParts(model.model.path)}`,
        destinationPath: path.join(repositoryDirectory, path.basename(model.model.path)),
        sha256: model.model.sha256,
        onProgress: onModelProgress,
        signal,
    });
    onProjectorProgress?.({ phase: 'checking' });
    const projectorPath = await installVerifiedFile({
        url: `https://huggingface.co/${encodePathParts(model.repository)}/resolve/${model.revision}/${encodePathParts(model.projector.path)}`,
        destinationPath: path.join(repositoryDirectory, path.basename(model.projector.path)),
        sha256: model.projector.sha256,
        onProgress: onProjectorProgress,
        signal,
    });

    return {
        modelPath,
        projectorPath,
    };
}

function readModelProvenance(directory, repository, quant) {
    try {
        const source = JSON.parse(fs.readFileSync(path.join(directory, `.source-${quant}.json`), 'utf8'));
        const validArtifact = artifact => typeof artifact?.path === 'string'
            && /^[A-Za-z0-9._/-]+\.gguf$/i.test(artifact.path)
            && artifact.path.split('/').every(part => part && part !== '.' && part !== '..')
            && !path.isAbsolute(artifact.path) && /^[a-f0-9]{64}$/i.test(artifact.sha256);
        if (source.schemaVersion === 1 && source.repository === repository && source.quant === quant
            && /^[a-f0-9]{40}$/i.test(source.revision) && validArtifact(source.model) && validArtifact(source.projector)
            && !path.basename(source.model.path).startsWith('mmproj-') && path.basename(source.projector.path).startsWith('mmproj-')) return source;
    } catch {}
    return null;
}

function persistModelProvenance(repositoryDirectory, source) {
    if (!source?.revision || !/^[a-f0-9]{40}$/i.test(source.revision)) {
        throw new Error('Cannot persist model provenance without an immutable repository revision');
    }
    const quant = String(source.quant || 'model').replace(/[^A-Za-z0-9._-]/g, '_');
    writeJsonAtomic(path.join(repositoryDirectory, `.source-${quant}.json`), source);
}

async function getAvailablePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(() => resolve(address.port));
        });
    });
}

function attachProcessLogging(childProcess, name) {
    childProcess.stdout.on('data', data => {
        process.stdout.write(`[${name}] ${data}`);
    });
    childProcess.stderr.on('data', data => {
        if (!childProcess.startupReady) childProcess.startupDiagnostics = ((childProcess.startupDiagnostics || '') + data).slice(-8192);
        process.stderr.write(`[${name}] ${data}`);
    });
}

function startNativeServer({ executablePath, arguments: serverArguments, name, environment = {} }) {
    const childProcess = spawn(executablePath, serverArguments, {
        env: { ...process.env, ...environment },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });

    childProcess.on('error', error => { childProcess.launchError = error; });
    attachProcessLogging(childProcess, name);
    return childProcess;
}

async function waitForServer(url, childProcess, timeoutMs, signal) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        signal?.throwIfAborted();
        if (childProcess.launchError) throw new Error(`Native server could not start (${childProcess.launchError.code || 'spawn failed'})`);
        if (childProcess.exitCode !== null || childProcess.killed) {
            const exit = Number.isInteger(childProcess.exitCode) ? `0x${(childProcess.exitCode >>> 0).toString(16).padStart(8, '0')}` : 'terminated';
            const hint = /out of memory|bad_alloc|not enough memory|failed to allocate/i.test(childProcess.startupDiagnostics || '') ? ' Not enough memory; close other applications or explicitly select a smaller model.'
                : /unsupported|unknown model architecture|invalid model/i.test(childProcess.startupDiagnostics || '') ? ' The runner rejected the selected model format.'
                : exit === '0xc0000135' ? ' A required Windows runtime DLL is missing; reinstall the verified runner bundle.' : '';
            throw Object.assign(new Error(`Native server stopped before becoming ready (exit ${exit}).${hint}`), { code: 'NATIVE_EXIT', exitCode: childProcess.exitCode });
        }
        const timeout = AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now())));
        try {
            const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
            await response.body?.cancel();
            if (response.ok) { childProcess.startupReady = true; childProcess.startupDiagnostics = ''; return; }
        } catch (error) { if (signal?.aborted) throw signal.reason; }
        await require('node:timers/promises').setTimeout(250, undefined, { signal });
    }
    throw new Error('Native server did not become ready before the startup deadline');
}

function stopNativeServer(childProcess) {
    if (!childProcess || childProcess.exitCode !== null) {
        return;
    }

    childProcess.kill();
}

module.exports = {
    fileMatchesChecksum,
    installVerifiedFile,
    ensureNativeBinary,
    ensureLlamaModel,
    ensureWhisperModel,
    extractRuntimeArchive,
    persistModelProvenance,
    WINDOWS_X64_RELEASES,
    WHISPER_MODEL_REVISION,
    getAvailablePort,
    getModelsDirectory,
    startNativeServer,
    stopNativeServer,
    waitForServer,
};
