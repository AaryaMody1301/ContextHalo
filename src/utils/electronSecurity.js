const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:']);

function normalizeExternalUrl(value) {
    if (typeof value !== 'string' || value.length > 4096) return null;
    try {
        const url = new URL(value);
        if (!EXTERNAL_PROTOCOLS.has(url.protocol) || url.username || url.password || !url.hostname) return null;
        return url.toString();
    } catch {
        return null;
    }
}

module.exports = { normalizeExternalUrl };
