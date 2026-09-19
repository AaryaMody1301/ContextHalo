const { listModelFiles, selectProjector } = require('./hubMetadata');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
const runFile = require('node:util').promisify(execFile);

const VULKAN_LLAMA_RELEASE = Object.freeze({
    tag: 'b10964',
    archive: 'llama-b10964-bin-win-vulkan-x64.zip',
    sha256: '1ee3ad952f4ba71f438bd6d7bebef19e1c7af04adcaa35d08b4ddabb27d4c642',
    executable: 'llama-server.exe',
    backend: 'ggml-vulkan.dll',
    url: 'https://github.com/ggml-org/llama.cpp/releases/download/b10964/llama-b10964-bin-win-vulkan-x64.zip',
});

function encodePathParts(value) {
    return value.split('/').map(part => encodeURIComponent(part)).join('/');
}

function parseModelReference(modelReference) {
    const value = String(modelReference || '');
    const separatorIndex = value.lastIndexOf(':');
    if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
        throw new Error('Language model must use the format owner/repository:quant');
    }

    const repository = value.slice(0, separatorIndex);
    const quant = value.slice(separatorIndex + 1);
    const repositoryParts = repository.split('/');
    const safePart = part => /^[A-Za-z0-9._-]+$/.test(part) && part !== '.' && part !== '..';

    if (
        repositoryParts.length !== 2 ||
        repositoryParts.some(part => !safePart(part)) ||
        !safePart(quant)
    ) {
        throw new Error('Language model reference contains unsupported or unsafe path components');
    }
    return { repository, quant };
}

function normalizeEtag(value) {
    if (!value) return null;
    const normalized = String(value).trim().replace(/^W\//, '').replace(/^"|"$/g, '');
    return /^[a-f0-9]{64}$/i.test(normalized) ? normalized.toLowerCase() : null;
}

async function getHuggingFaceFileSha256(repository, filePath, signal) {
    const url = `https://huggingface.co/${encodePathParts(repository)}/resolve/main/${encodePathParts(filePath)}`;
    const response = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });

    if (response.status < 200 || response.status >= 400) {
        throw new Error(`Could not read Hugging Face metadata for ${filePath}: HTTP ${response.status}`);
    }

    const sha256 = normalizeEtag(response.headers.get('x-linked-etag')) || normalizeEtag(response.headers.get('etag'));
    if (!sha256) {
        throw new Error(`Hugging Face did not expose a SHA-256 ETag for ${filePath}`);
    }
    return sha256;
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

async function matchesChecksum(filePath, sha256) {
    if (!fs.existsSync(filePath)) return false;
    return (await calculateSha256(filePath)) === sha256;
}

async function downloadVerifiedFile(url, destinationPath, sha256, onProgress, signal) {
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    if (await matchesChecksum(destinationPath, sha256)) return destinationPath;

    const temporaryPath = `${destinationPath}.download-${process.pid}-${Date.now()}`;
    const timeout = AbortSignal.timeout(30 * 60 * 1000);
    signal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(url, { redirect: 'follow', signal });
    if (!response.ok || !response.body) {
        throw new Error(`Download failed with HTTP ${response.status}: ${url}`);
    }

    const expectedBytes = Number(response.headers.get('content-length')) || 0;
    let downloadedBytes = 0;
    try {
        const input = Readable.fromWeb(response.body);
        const progress = new Transform({
            transform(chunk, encoding, callback) {
                downloadedBytes += chunk.length;
                onProgress?.({ downloadedBytes, expectedBytes });
                callback(null, chunk);
            },
        });
        await pipeline(input, progress, fs.createWriteStream(temporaryPath, { flags: 'wx' }), { signal });

        const actualSha256 = await calculateSha256(temporaryPath);
        if (actualSha256 !== sha256) {
            throw new Error(`Checksum verification failed for ${path.basename(destinationPath)}`);
        }

        signal?.throwIfAborted();
        fs.renameSync(temporaryPath, destinationPath);
        return destinationPath;
    } catch (error) {
        fs.rmSync(temporaryPath, { force: true });
        throw error;
    }
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

function extractedVulkanRuntime(runtimeDirectory) {
    const executable = findRuntimeFile(runtimeDirectory, VULKAN_LLAMA_RELEASE.executable);
    if (!executable) return null;
    const backend = path.join(path.dirname(executable), VULKAN_LLAMA_RELEASE.backend);
    return fs.existsSync(backend) ? executable : null;
}

async function extractVulkanRuntime(archivePath, runtimeDirectory, run = runFile, signal) {
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
        if (result.error || (result.status !== undefined && result.status !== 0)) throw new Error('Windows could not unpack the verified llama.cpp Vulkan runtime');
        signal?.throwIfAborted();
        const executable = extractedVulkanRuntime(stagingDirectory);
        if (!executable) throw new Error('The verified llama.cpp Vulkan package is missing its server or Vulkan backend');
        fs.writeFileSync(path.join(stagingDirectory, '.archive-sha256'), VULKAN_LLAMA_RELEASE.sha256, 'utf8');
        fs.rmSync(runtimeDirectory, { recursive: true, force: true });
        fs.renameSync(stagingDirectory, runtimeDirectory);
        return extractedVulkanRuntime(runtimeDirectory);
    } catch (error) {
        fs.rmSync(stagingDirectory, { recursive: true, force: true });
        throw error;
    }
}

async function ensureVulkanLlamaRuntime(runtime, onProgress, signal) {
    const binariesDirectory = path.join(path.dirname(runtime.getModelsDirectory()), 'binaries');
    const runtimeDirectory = path.join(binariesDirectory, `llama-${VULKAN_LLAMA_RELEASE.tag}-vulkan`);
    const archivePath = path.join(binariesDirectory, VULKAN_LLAMA_RELEASE.archive);
    const markerPath = path.join(runtimeDirectory, '.archive-sha256');
    const existing = extractedVulkanRuntime(runtimeDirectory);
    if (existing && fs.existsSync(markerPath)
        && fs.readFileSync(markerPath, 'utf8').trim() === VULKAN_LLAMA_RELEASE.sha256
        && await matchesChecksum(archivePath, VULKAN_LLAMA_RELEASE.sha256)) return existing;

    const acceleratorTimeout = AbortSignal.timeout(120000);
    const acceleratorSignal = signal ? AbortSignal.any([signal, acceleratorTimeout]) : acceleratorTimeout;
    await downloadVerifiedFile(VULKAN_LLAMA_RELEASE.url, archivePath, VULKAN_LLAMA_RELEASE.sha256, onProgress, acceleratorSignal);
    signal?.throwIfAborted();
    return extractVulkanRuntime(archivePath, runtimeDirectory, runFile, acceleratorSignal);
}

async function ensureXetLlamaModel(runtime, modelReference, onModelProgress, onProjectorProgress, signal) {
    const { repository, quant } = parseModelReference(modelReference);
    const files = await listModelFiles(repository, signal);
    const normalizedQuant = quant.toUpperCase();
    const matches = files.filter(file => (
        file.type === 'file' &&
        file.path?.toLowerCase().endsWith('.gguf') &&
        file.path.toUpperCase().includes(normalizedQuant) &&
        !file.path.toLowerCase().startsWith('mmproj-')
    ));
    if (matches.length !== 1) {
        throw new Error(`Expected one GGUF file for ${modelReference}, found ${matches.length}`);
    }

    const modelFile = matches[0];
    const projectorFile = selectProjector(files);
    if (!projectorFile) throw new Error(`Hugging Face model ${repository} does not provide a supported multimodal projector`);

    const [modelSha256, projectorSha256] = await Promise.all([
        getHuggingFaceFileSha256(repository, modelFile.path, signal),
        getHuggingFaceFileSha256(repository, projectorFile.path, signal),
    ]);

    const repositoryDirectory = path.join(runtime.getModelsDirectory(), 'llama', repository);
    const modelPath = await downloadVerifiedFile(
        `https://huggingface.co/${encodePathParts(repository)}/resolve/main/${encodePathParts(modelFile.path)}`,
        path.join(repositoryDirectory, path.basename(modelFile.path)),
        modelSha256,
        onModelProgress,
        signal
    );
    const projectorPath = await downloadVerifiedFile(
        `https://huggingface.co/${encodePathParts(repository)}/resolve/main/${encodePathParts(projectorFile.path)}`,
        path.join(repositoryDirectory, path.basename(projectorFile.path)),
        projectorSha256,
        onProjectorProgress,
        signal
    );

    return { modelPath, projectorPath };
}

function installWindowsLocalAiRuntime() {
    if (process.platform !== 'win32' || process.arch !== 'x64') return;

    const runtime = require('./native-ai-runtime');
    if (runtime.__windowsXetPatched) return;
    const originalEnsureLlamaModel = runtime.ensureLlamaModel.bind(runtime);
    const originalEnsureNativeBinary = runtime.ensureNativeBinary.bind(runtime);

    runtime.ensureNativeBinary = async (type, onProgress, signal, { cpuOnly = false } = {}) => {
        if (type !== 'llama' || cpuOnly) return originalEnsureNativeBinary(type, onProgress, signal);
        try {
            return await ensureVulkanLlamaRuntime(runtime, onProgress, signal);
        } catch (error) {
            signal?.throwIfAborted();
            console.warn('Verified Vulkan llama.cpp runtime unavailable; falling back to the verified CPU Local AI runner:', error?.message || error);
            return originalEnsureNativeBinary(type, onProgress, signal);
        }
    };

    runtime.ensureLlamaModel = async (...args) => {
        const modelReference = args[0];
        if (!path.isAbsolute(modelReference)) parseModelReference(modelReference);

        try {
            return await originalEnsureLlamaModel(...args);
        } catch (error) {
            const message = String(error?.message || error);
            const metadataFailure = message.includes('checksum metadata') || message.includes('does not provide a supported multimodal projector');
            if (!metadataFailure) throw error;
            console.warn('Falling back to Hugging Face Xet metadata for Local AI model verification');
            return ensureXetLlamaModel(runtime, ...args);
        }
    };

    Object.defineProperty(runtime, '__windowsXetPatched', { value: true });
}

module.exports = {
    installWindowsLocalAiRuntime,
    normalizeEtag,
    parseModelReference,
    extractVulkanRuntime,
    VULKAN_LLAMA_RELEASE,
};
