const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

function encodePathParts(value) {
    return value.split('/').map(part => encodeURIComponent(part)).join('/');
}

function parseModelReference(modelReference) {
    const separatorIndex = String(modelReference || '').lastIndexOf(':');
    if (separatorIndex <= 0 || separatorIndex === modelReference.length - 1) {
        throw new Error('Language model must use the format owner/repository:quant');
    }

    const repository = modelReference.slice(0, separatorIndex);
    const quant = modelReference.slice(separatorIndex + 1);
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repository) || !/^[A-Za-z0-9._-]+$/.test(quant)) {
        throw new Error('Language model reference contains unsupported characters');
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
        signal,
    });

    if (![200, 302, 307].includes(response.status)) {
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
        await pipeline(input, progress, fs.createWriteStream(temporaryPath, { flags: 'wx' }));

        const actualSha256 = await calculateSha256(temporaryPath);
        if (actualSha256 !== sha256) {
            throw new Error(`Checksum verification failed for ${path.basename(destinationPath)}`);
        }

        fs.rmSync(destinationPath, { force: true });
        fs.renameSync(temporaryPath, destinationPath);
        return destinationPath;
    } catch (error) {
        fs.rmSync(temporaryPath, { force: true });
        throw error;
    }
}

async function ensureXetLlamaModel(runtime, modelReference, onModelProgress, onProjectorProgress, signal) {
    const { repository, quant } = parseModelReference(modelReference);
    const repositoryUrl = encodePathParts(repository);
    const response = await fetch(`https://huggingface.co/api/models/${repositoryUrl}/tree/main?recursive=true&expand=true`, { signal });
    if (!response.ok) throw new Error(`Could not inspect Hugging Face model: HTTP ${response.status}`);

    const files = await response.json();
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
    const projectorFile = files.find(file => file.type === 'file' && file.path === 'mmproj-BF16.gguf');
    if (!projectorFile) throw new Error(`Hugging Face model ${repository} does not provide mmproj-BF16.gguf`);

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
    if (process.platform !== 'win32') return;

    const runtime = require('./native-ai-runtime');
    if (runtime.__windowsXetPatched) return;
    const originalEnsureLlamaModel = runtime.ensureLlamaModel.bind(runtime);

    runtime.ensureLlamaModel = async (...args) => {
        try {
            return await originalEnsureLlamaModel(...args);
        } catch (error) {
            const message = String(error?.message || error);
            if (!message.includes('checksum metadata')) throw error;
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
};
