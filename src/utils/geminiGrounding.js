const MAX_GROUNDING_SOURCES = 64;
const MAX_GROUNDING_SUPPORTS = 256;
const MAX_SEARCH_QUERIES = 32;
const MAX_RENDERED_CONTENT_CHARS = 512000;

function safeSource(chunk) {
    const uri = typeof chunk?.web?.uri === 'string' ? chunk.web.uri : '';
    if (!uri) return null;
    try {
        const parsed = new URL(uri);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    } catch {
        return null;
    }
    return {
        uri,
        title: String(chunk.web.title || '').slice(0, 500),
    };
}

function sanitizeSupport(value, offset, localChunkCount, totalSourceLimit) {
    if (!value || typeof value !== 'object') return null;
    const rawIndices = Array.isArray(value.groundingChunkIndices)
        ? value.groundingChunkIndices.filter(index => Number.isSafeInteger(index) && index >= 0)
        : [];
    if (!rawIndices.length) return null;

    // In streamed GenerateContent responses Google documents groundingChunks as
    // incremental. Most responses therefore index their local chunk fragment;
    // tolerate already-global indexes as well so wire-shape changes do not
    // double-shift citations.
    const local = rawIndices.every(index => index < localChunkCount);
    const indices = rawIndices
        .map(index => local ? index + offset : index)
        .filter(index => index < totalSourceLimit);
    if (!indices.length) return null;

    const segment = value.segment && typeof value.segment === 'object'
        ? {
            ...(Number.isSafeInteger(value.segment.startIndex) ? { startIndex: value.segment.startIndex } : {}),
            ...(Number.isSafeInteger(value.segment.endIndex) ? { endIndex: value.segment.endIndex } : {}),
            ...(typeof value.segment.text === 'string' ? { text: value.segment.text } : {}),
        }
        : undefined;

    return {
        ...(segment ? { segment } : {}),
        groundingChunkIndices: indices,
    };
}

function groundingFragmentFromResponse(response) {
    const value = response?.candidates?.[0]?.groundingMetadata
        || response?.serverContent?.groundingMetadata
        || response?.groundingMetadata;
    if (!value || typeof value !== 'object') return undefined;

    const chunks = Array.isArray(value.groundingChunks) ? value.groundingChunks : [];
    const rendered = typeof value.searchEntryPoint?.renderedContent === 'string'
        && value.searchEntryPoint.renderedContent.length <= MAX_RENDERED_CONTENT_CHARS
        ? value.searchEntryPoint.renderedContent
        : '';

    return {
        sources: chunks.map(safeSource),
        rawChunkCount: chunks.length,
        supports: Array.isArray(value.groundingSupports) ? value.groundingSupports : [],
        queries: Array.isArray(value.webSearchQueries)
            ? value.webSearchQueries.filter(query => typeof query === 'string').slice(0, MAX_SEARCH_QUERIES)
            : [],
        renderedContent: rendered,
    };
}

function mergeGrounding(current, fragment) {
    if (!fragment) return current;
    const previousSources = Array.isArray(current?.sources) ? current.sources : [];
    const previousCount = Number.isSafeInteger(current?._chunkCount) ? current._chunkCount : previousSources.length;
    const appendable = Math.max(0, MAX_GROUNDING_SOURCES - previousSources.length);
    const sources = [...previousSources, ...fragment.sources.slice(0, appendable)];

    const supportLimit = sources.length;
    const nextSupports = (fragment.supports || [])
        .map(support => sanitizeSupport(support, previousCount, fragment.rawChunkCount, supportLimit))
        .filter(Boolean);

    const supports = [...(Array.isArray(current?.supports) ? current.supports : []), ...nextSupports]
        .slice(0, MAX_GROUNDING_SUPPORTS);

    const querySet = new Set(Array.isArray(current?.queries) ? current.queries : []);
    for (const query of fragment.queries || []) {
        if (querySet.size >= MAX_SEARCH_QUERIES) break;
        querySet.add(query);
    }

    return {
        sources,
        supports,
        queries: [...querySet],
        renderedContent: fragment.renderedContent || current?.renderedContent || '',
        _chunkCount: previousCount + fragment.rawChunkCount,
    };
}

function publicGrounding(value) {
    if (!value) return undefined;
    const { _chunkCount, ...publicValue } = value;
    return publicValue;
}

module.exports = {
    groundingFragmentFromResponse,
    mergeGrounding,
    publicGrounding,
    _test: { safeSource, sanitizeSupport },
};
