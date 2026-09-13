// Hugging Face tree listings are paginated; never assume the first page contains
// either the requested quantization or its paired multimodal projector.
async function listModelFiles(repository, signal) {
    const encoded = repository.split('/').map(encodeURIComponent).join('/');
    const prefix = `https://huggingface.co/api/models/${encoded}/tree/`;
    let url = `${prefix}main?recursive=true&expand=true&limit=100`;
    const seen = new Set();
    const files = [];
    for (let page = 0; url && page < 50; page++) {
        if (!url.startsWith(prefix) || seen.has(url)) throw new Error('Invalid model pagination response');
        seen.add(url);
        const timeout = AbortSignal.timeout(15000);
        const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const response = await fetch(url, { signal: combined });
        if (!response.ok) throw new Error(`Could not inspect Hugging Face model: HTTP ${response.status}`);
        const body = await response.json();
        if (!Array.isArray(body)) throw new Error('Invalid Hugging Face model metadata');
        files.push(...body);
        const link = response.headers?.get?.('link') || '';
        const next = link.split(',').find(part => /rel=["']?next["']?/.test(part));
        url = next?.match(/<([^>]+)>/)?.[1] || '';
    }
    if (url) throw new Error('Model repository is too large to inspect safely');
    return files;
}
function selectProjector(files) {
    for (const name of ['mmproj-BF16.gguf', 'mmproj-F16.gguf', 'mmproj-F32.gguf']) {
        const file = files.find(item => item.type === 'file' && item.path === name);
        if (file) return file;
    }
    throw new Error('The selected vision model does not provide a supported mmproj projector');
}
module.exports = { listModelFiles, selectProjector };
