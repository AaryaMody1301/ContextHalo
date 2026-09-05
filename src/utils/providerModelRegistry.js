const crypto = require('node:crypto');

const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const cache = new Map();

function keyFingerprint(apiKey) {
    return crypto.createHash('sha256').update(String(apiKey || '')).digest('hex').slice(0, 16);
}

function modelId(value) {
    return String(value || '').replace(/^models\//, '').trim();
}

function isPreviewModel(id, displayName = '') {
    return /(?:preview|experimental|exp(?:-|$))/i.test(String(id) + ' ' + String(displayName));
}

function sortModels(models) {
    return [...models].sort((a, b) => {
        if (a.preview !== b.preview) return a.preview ? 1 : -1;
        return a.displayName.localeCompare(b.displayName, undefined, { numeric: true, sensitivity: 'base' });
    });
}

function normalizeGeminiModel(raw) {
    const id = modelId(raw?.name || raw?.id);
    if (!id) return null;

    const methods = Array.isArray(raw?.supportedGenerationMethods)
        ? raw.supportedGenerationMethods.map(String)
        : Array.isArray(raw?.supportedActions)
            ? raw.supportedActions.map(String)
            : [];

    return {
        id,
        displayName: String(raw?.displayName || id),
        description: String(raw?.description || ''),
        methods,
        inputTokenLimit: Number(raw?.inputTokenLimit) || null,
        outputTokenLimit: Number(raw?.outputTokenLimit) || null,
        thinking: raw?.thinking === true,
        preview: isPreviewModel(id, raw?.displayName),
    };
}

function buildGeminiCatalog(rawModels) {
    const all = sortModels(rawModels.map(normalizeGeminiModel).filter(Boolean));
    const live = all.filter(model => model.methods.includes('bidiGenerateContent'));
    const generate = all.filter(model => model.methods.includes('generateContent'));
    const screen = generate.filter(
        model => !/(embedding|imagen|veo|lyria|tts|transcribe|robotics|computer-use|(?:^|-)image(?:-|$))/i.test(model.id)
    );

    const pick = (list, preferredIds) => {
        for (const id of preferredIds) {
            const match = list.find(model => model.id === id);
            if (match) return match.id;
        }
        return list.find(model => !model.preview)?.id || list[0]?.id || null;
    };

    return {
        provider: 'gemini',
        all,
        live,
        generate,
        screen,
        recommended: {
            live: pick(live, ['gemini-3.1-flash-live-preview', 'gemini-omni-1.1-flash']),
            screen: pick(screen, ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-flash-latest']),
        },
    };
}

function normalizeGroqModel(raw) {
    const id = modelId(raw?.id);
    if (!id || raw?.active === false) return null;

    return {
        id,
        displayName: id,
        owner: String(raw?.owned_by || ''),
        contextWindow: Number(raw?.context_window) || null,
        maxCompletionTokens: Number(raw?.max_completion_tokens) || null,
        preview: isPreviewModel(id),
    };
}

function buildGroqCatalog(rawModels) {
    const all = sortModels(rawModels.map(normalizeGroqModel).filter(Boolean));
    const transcription = all.filter(model => /(whisper|transcrib)/i.test(model.id));
    const nonChat = /(whisper|transcrib|orpheus|tts|speech|(?:^|[-/])guard|safeguard)/i;
    const chat = all.filter(model => !nonChat.test(model.id));
    const vision = chat.filter(
        model => /(vision|(?:^|[-/])vl(?:[-/]|$)|maverick|scout|qwen\/qwen3\.(?:6|8)-27b)/i.test(model.id)
    );

    const pick = (list, preferredIds) => {
        for (const id of preferredIds) {
            const match = list.find(model => model.id === id);
            if (match) return match.id;
        }
        return list.find(model => !model.preview)?.id || list[0]?.id || null;
    };

    return {
        provider: 'groq',
        all,
        chat,
        vision,
        transcription,
        recommended: {
            chat: pick(chat, ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'qwen/qwen3.6-27b']),
            vision: pick(vision, ['qwen/qwen3.8-27b', 'qwen/qwen3.6-27b']),
            transcription: pick(transcription, ['whisper-large-v3-turbo', 'whisper-large-v3']),
        },
    };
}

async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const text = await response.text();
        if (!response.ok) {
            let detail = text;
            try {
                detail = JSON.parse(text)?.error?.message || text;
            } catch {}
            throw new Error(`HTTP ${response.status}: ${String(detail).slice(0, 240)}`);
        }
        return text ? JSON.parse(text) : {};
    } finally {
        clearTimeout(timer);
    }
}

async function fetchGeminiCatalog(apiKey) {
    const models = [];
    let pageToken = '';
    let pages = 0;

    do {
        const url = new URL(GEMINI_MODELS_URL);
        url.searchParams.set('pageSize', '1000');
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const body = await fetchJson(url, {
            headers: {
                Accept: 'application/json',
                'x-goog-api-key': apiKey,
            },
        });

        if (Array.isArray(body.models)) models.push(...body.models);
        pageToken = String(body.nextPageToken || '');
        pages += 1;
    } while (pageToken && pages < 5);

    return buildGeminiCatalog(models);
}

async function fetchGroqCatalog(apiKey) {
    const body = await fetchJson(GROQ_MODELS_URL, {
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
    });
    return buildGroqCatalog(Array.isArray(body.data) ? body.data : []);
}

async function listProviderModels(provider, apiKey, options = {}) {
    const normalizedProvider = String(provider || '').toLowerCase();
    if (!['gemini', 'groq'].includes(normalizedProvider)) throw new Error('Unsupported provider');
    if (!apiKey || !String(apiKey).trim()) {
        const name = normalizedProvider === 'gemini' ? 'Gemini' : 'Groq';
        throw new Error(`${name} API key is not configured`);
    }

    const cacheKey = `${normalizedProvider}:${keyFingerprint(apiKey)}`;
    const existing = cache.get(cacheKey);
    const now = Date.now();

    if (!options.forceRefresh && existing && now - existing.fetchedAt < CACHE_TTL_MS) {
        return { ...existing.catalog, fetchedAt: existing.fetchedAt, source: 'cache', stale: false };
    }

    try {
        const catalog = normalizedProvider === 'gemini'
            ? await fetchGeminiCatalog(String(apiKey).trim())
            : await fetchGroqCatalog(String(apiKey).trim());
        const fetchedAt = Date.now();
        cache.set(cacheKey, { catalog, fetchedAt });
        return { ...catalog, fetchedAt, source: 'api', stale: false };
    } catch (error) {
        if (existing) {
            return {
                ...existing.catalog,
                fetchedAt: existing.fetchedAt,
                source: 'cache',
                stale: true,
                warning: error?.message || String(error),
            };
        }
        throw error;
    }
}

module.exports = {
    listProviderModels,
    _test: {
        modelId,
        normalizeGeminiModel,
        normalizeGroqModel,
        buildGeminiCatalog,
        buildGroqCatalog,
    },
};
