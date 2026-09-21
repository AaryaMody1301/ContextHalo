const HUB_ORIGIN = 'https://huggingface.co';

function encodeRepository(repository) {
    return String(repository || '').split('/').map(encodeURIComponent).join('/');
}

function validRevision(value) {
    return /^[a-f0-9]{40}$/i.test(String(value || ''));
}

async function fetchHubJson(url, signal) {
    const timeout = AbortSignal.timeout(15000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(url, { signal: combined });
    if (!response.ok) throw new Error(`Could not inspect Hugging Face model: HTTP ${response.status}`);
    return { response, body: await response.json() };
}

async function resolveModelRevision(repository, signal) {
    const encoded = encodeRepository(repository);
    const { body } = await fetchHubJson(`${HUB_ORIGIN}/api/models/${encoded}`, signal);
    const revision = String(body?.sha || '').toLowerCase();
    if (!validRevision(revision)) throw new Error('Hugging Face did not provide an immutable model revision');
    const modelId = String(body?.id || body?.modelId || '');
    if (modelId && modelId !== repository) throw new Error('Hugging Face returned metadata for an unexpected model repository');
    return revision;
}

// Hugging Face tree listings are paginated; never assume the first page contains
// either the requested quantization or its paired multimodal projector.
async function listModelFiles(repository, revision, signal) {
    if (!validRevision(revision)) throw new Error('Model revision must be a full Hugging Face commit SHA');
    const encoded = encodeRepository(repository);
    const prefix = `${HUB_ORIGIN}/api/models/${encoded}/tree/${revision}`;
    let url = `${prefix}?recursive=true&expand=true&limit=100`;
    const seen = new Set();
    const files = [];
    for (let page = 0; url && page < 50; page++) {
        if (!url.startsWith(prefix) || seen.has(url)) throw new Error('Invalid model pagination response');
        seen.add(url);
        const { response, body } = await fetchHubJson(url, signal);
        if (!Array.isArray(body)) throw new Error('Invalid Hugging Face model metadata');
        files.push(...body);
        const link = response.headers?.get?.('link') || '';
        const next = link.split(',').find(part => /rel=["']?next["']?/.test(part));
        url = next?.match(/<([^>]+)>/)?.[1] || '';
    }
    if (url) throw new Error('Model repository is too large to inspect safely');
    return files;
}

async function getModelSnapshot(repository, signal) {
    const revision = await resolveModelRevision(repository, signal);
    return { revision, files: await listModelFiles(repository, revision, signal) };
}

function selectProjector(files) {
    for (const name of ['mmproj-BF16.gguf', 'mmproj-F16.gguf', 'mmproj-F32.gguf']) {
        const file = files.find(item => item.type === 'file' && item.path === name);
        if (file) return file;
    }
    throw new Error('The selected vision model does not provide a supported mmproj projector');
}

module.exports = { getModelSnapshot, listModelFiles, resolveModelRevision, selectProjector };
