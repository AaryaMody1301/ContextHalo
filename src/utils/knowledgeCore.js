const DEFAULT_CHUNK_CHARS = 1400;
const DEFAULT_OVERLAP_CHARS = 220;
const MAX_QUERY_TOKENS = 64;

const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'hers',
    'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our', 'ours', 'she', 'so',
    'that', 'the', 'their', 'theirs', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to', 'too', 'up', 'us', 'was',
    'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your', 'yours',
]);

function normalizeText(value, maxLength = 2_000_000) {
    if (typeof value !== 'string') return '';
    return value
        .replace(/\u0000/g, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{4,}/g, '\n\n\n')
        .trim()
        .slice(0, maxLength);
}

function tokenize(value) {
    const text = normalizeText(String(value || ''), 100_000).toLowerCase();
    const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}_'-]{1,}/gu) || [];
    return matches.filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function splitOversizedBlock(block, maxChars, overlapChars) {
    const chunks = [];
    let start = 0;
    while (start < block.length) {
        let end = Math.min(block.length, start + maxChars);
        if (end < block.length) {
            const boundary = Math.max(
                block.lastIndexOf('. ', end),
                block.lastIndexOf('? ', end),
                block.lastIndexOf('! ', end),
                block.lastIndexOf('\n', end),
                block.lastIndexOf(' ', end)
            );
            if (boundary > start + Math.floor(maxChars * 0.55)) end = boundary + 1;
        }
        const text = block.slice(start, end).trim();
        if (text) chunks.push(text);
        if (end >= block.length) break;
        start = Math.max(start + 1, end - overlapChars);
    }
    return chunks;
}

function chunkText(value, options = {}) {
    const text = normalizeText(value);
    if (!text) return [];

    const maxChars = Math.max(400, Math.min(4000, Number(options.maxChars) || DEFAULT_CHUNK_CHARS));
    const overlapChars = Math.max(0, Math.min(Math.floor(maxChars / 3), Number(options.overlapChars) || DEFAULT_OVERLAP_CHARS));
    const blocks = text.split(/\n{2,}/).map(block => block.trim()).filter(Boolean);
    const chunks = [];
    let pending = '';

    const flush = () => {
        const clean = pending.trim();
        if (clean) chunks.push(clean);
        pending = '';
    };

    for (const block of blocks) {
        if (block.length > maxChars) {
            flush();
            chunks.push(...splitOversizedBlock(block, maxChars, overlapChars));
            continue;
        }

        const candidate = pending ? `${pending}\n\n${block}` : block;
        if (candidate.length <= maxChars) {
            pending = candidate;
            continue;
        }

        const overlap = pending.slice(Math.max(0, pending.length - overlapChars)).trim();
        flush();
        pending = overlap ? `${overlap}\n\n${block}` : block;
        if (pending.length > maxChars) {
            const split = splitOversizedBlock(pending, maxChars, overlapChars);
            chunks.push(...split.slice(0, -1));
            pending = split.at(-1) || '';
        }
    }
    flush();

    return chunks.map((textValue, index) => ({
        id: `chunk-${index + 1}`,
        index,
        text: textValue,
        chars: textValue.length,
        tokens: tokenize(textValue),
    }));
}

function termCounts(tokens) {
    const counts = new Map();
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
    return counts;
}

function scoreChunks(documents, query) {
    const queryTokens = [...new Set(tokenize(query).slice(0, MAX_QUERY_TOKENS))];
    const candidates = [];
    for (const document of Array.isArray(documents) ? documents : []) {
        if (!document || document.enabled === false || !Array.isArray(document.chunks)) continue;
        for (const chunk of document.chunks) {
            const tokens = Array.isArray(chunk.tokens) ? chunk.tokens : tokenize(chunk.text);
            if (!tokens.length) continue;
            candidates.push({ document, chunk, tokens, counts: termCounts(tokens) });
        }
    }
    if (!candidates.length) return [];

    if (!queryTokens.length) {
        return candidates.map((candidate, index) => ({ ...candidate, score: 1 / (index + 1) }));
    }

    const documentFrequency = new Map();
    for (const token of queryTokens) {
        let count = 0;
        for (const candidate of candidates) {
            if (candidate.counts.has(token)) count += 1;
        }
        documentFrequency.set(token, count);
    }

    const averageLength = candidates.reduce((sum, candidate) => sum + candidate.tokens.length, 0) / candidates.length;
    const k1 = 1.2;
    const b = 0.72;

    return candidates.map(candidate => {
        let score = 0;
        for (const token of queryTokens) {
            const tf = candidate.counts.get(token) || 0;
            if (!tf) continue;
            const df = documentFrequency.get(token) || 0;
            const idf = Math.log(1 + (candidates.length - df + 0.5) / (df + 0.5));
            const denominator = tf + k1 * (1 - b + b * candidate.tokens.length / Math.max(1, averageLength));
            score += idf * ((tf * (k1 + 1)) / denominator);
        }

        const titleTokens = tokenize(candidate.document.title || '');
        const titleHits = queryTokens.filter(token => titleTokens.includes(token)).length;
        score += titleHits * 0.8;
        return { ...candidate, score };
    });
}

function retrieveChunks(documents, query, options = {}) {
    const limit = Math.max(1, Math.min(12, Number(options.limit) || 5));
    const maxChars = Math.max(1000, Math.min(20_000, Number(options.maxChars) || 7500));
    const scored = scoreChunks(documents, query)
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index);

    const results = [];
    const seen = new Set();
    let chars = 0;
    for (const item of scored) {
        const key = `${item.document.id}:${item.chunk.id || item.chunk.index}`;
        if (seen.has(key)) continue;
        const text = normalizeText(item.chunk.text, 5000);
        if (!text) continue;
        if (results.length && chars + text.length > maxChars) break;
        seen.add(key);
        results.push({
            documentId: item.document.id,
            title: item.document.title || 'Untitled source',
            sourceType: item.document.sourceType || 'text',
            chunkId: item.chunk.id || `chunk-${item.chunk.index + 1}`,
            text,
            score: Number(item.score.toFixed(4)),
        });
        chars += text.length;
        if (results.length >= limit) break;
    }
    return results;
}

function formatRetrievedContext(results, marker = '[ContextHalo knowledge]') {
    if (!Array.isArray(results) || !results.length) return '';
    const sections = results.map((result, index) => {
        return `Source ${index + 1}: ${result.title}\n${normalizeText(result.text, 3500)}`;
    });
    return `${marker}\nUse the retrieved local knowledge only when relevant. If it conflicts with the live user request, follow the user. Do not invent facts that are absent from the sources.\n\n${sections.join('\n\n')}`;
}

function topKeywords(value, limit = 8) {
    const counts = termCounts(tokenize(value));
    return [...counts.entries()]
        .filter(([token]) => token.length >= 3)
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
        .slice(0, Math.max(1, Math.min(20, limit)))
        .map(([token, count]) => ({ token, count }));
}

module.exports = {
    DEFAULT_CHUNK_CHARS,
    DEFAULT_OVERLAP_CHARS,
    normalizeText,
    tokenize,
    chunkText,
    retrieveChunks,
    formatRetrievedContext,
    topKeywords,
};
