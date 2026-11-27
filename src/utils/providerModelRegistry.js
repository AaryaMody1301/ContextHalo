const crypto = require('node:crypto');
const { GEMINI_SCREEN_MODEL_IDS, GEMINI_LIVE_SELECTABLE_IDS, GEMINI_LIVE_MAPPED_IDS,
    geminiModelPolicy, geminiCapabilityLabel } = require('./geminiModelPolicy');
const { groqModelPolicy, groqCapabilityLabel } = require('./groqModelPolicy');

const { abortable } = require('./requestDeadline');

const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const STALE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const cache = new Map();

function keyFingerprint(apiKey) {
    return crypto.createHash('sha256').update(String(apiKey || '')).digest('hex');
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

    const policy = geminiModelPolicy(id);
    return {
        id,
        displayName: String(raw?.displayName || id),
        description: String(raw?.description || ''),
        methods,
        inputTokenLimit: Number(raw?.inputTokenLimit) || policy?.inputTokenLimit || null,
        outputTokenLimit: Number(raw?.outputTokenLimit) || policy?.outputTokenLimit || null,
        thinking: raw?.thinking === true || Boolean(policy?.thinkingLevels?.length) || policy?.defaultThinking === 'interleaved-fixed',
        preview: policy ? policy.lifecycle === 'preview' : isPreviewModel(id, raw?.displayName),
        lifecycle: policy?.lifecycle || (isPreviewModel(id, raw?.displayName) ? 'preview' : 'provider'),
        capabilityLabel: geminiCapabilityLabel(id),
        contextHaloCompatibility: policy?.contextHaloCompatibility || 'unmapped',
        compatibilityReason: policy?.compatibilityReason || '',
        search: policy?.search ?? null,
        thinkingLevels: policy ? [...policy.thinkingLevels] : [],
    };
}

function buildGeminiCatalog(rawModels) {
    const all = sortModels(rawModels.map(normalizeGeminiModel).filter(Boolean));
    // Require both account-advertised methods and a supported application route.
    const liveIds = new Set(GEMINI_LIVE_SELECTABLE_IDS);
    const mappedLiveIds = new Set(GEMINI_LIVE_MAPPED_IDS);
    const live = all.filter(model => model.methods.includes('bidiGenerateContent') && liveIds.has(model.id));
    const liveMapped = all.filter(model => model.methods.includes('bidiGenerateContent') && mappedLiveIds.has(model.id));
    const generate = all.filter(model => model.methods.includes('generateContent'));
    const screenIds = new Set(GEMINI_SCREEN_MODEL_IDS);
    const screen = generate.filter(model => screenIds.has(model.id));

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
        liveMapped,
        generate,
        screen,
        recommended: {
            live: pick(live, ['gemini-3.8-live']),
            screen: pick(screen.filter(model => !geminiModelPolicy(model.id)?.paidOnly),
                ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']),
        },
    };
}

function normalizeGroqModel(raw) {
    const id = modelId(raw?.id);
    if (!id || raw?.active === false) return null;
    const policy = groqModelPolicy(id);
    if (policy?.lifecycle === 'retired') return null;

    const inferredPreview = raw?.preview === true || isPreviewModel(id);
    const preview = policy
        ? ['preview', 'deprecated-account-dependent'].includes(policy.lifecycle)
        : inferredPreview;

    return {
        id,
        displayName: id,
        owner: String(raw?.owned_by || ''),
        contextWindow: Number(raw?.context_window) || null,
        maxCompletionTokens: Number(raw?.max_completion_tokens) || null,
        preview,
        lifecycle: policy?.lifecycle || (inferredPreview ? 'preview' : 'unverified'),
        capabilityLabel: groqCapabilityLabel(id),
        contextHaloCompatibility: policy?.contextHaloCompatibility || 'advanced-unverified',
        replacement: policy?.replacement || '',
        roles: policy?.roles ? [...policy.roles] : [],
    };
}

function buildGroqCatalog(rawModels) {
    const all = sortModels(rawModels.map(normalizeGroqModel).filter(Boolean));
    const transcription = all.filter(model => /(whisper|transcrib)/i.test(model.id));
    const nonChat = /(whisper|transcrib|orpheus|tts|speech|(?:^|[-/])guard|safeguard)/i;
    const chat = all.filter(model => !nonChat.test(model.id));
    const vision = chat.filter(model => model.roles.includes('vision') ||
        (!model.roles.length && /(vision|(?:^|[-/])vl(?:[-/]|$)|maverick|scout)/i.test(model.id)));

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
            // Groq deprecated Qwen 3.6 for Free/Developer on 2026-09-14 and
            // documents Qwen 3.8 as the current vision model. Keep 3.6 in the
            // discovered catalog only when an account still reports it (for
            // example, eligible enterprise accounts).
            vision: pick(vision, ['qwen/qwen3.8-27b', 'qwen/qwen3.6-27b']),
            transcription: pick(transcription, ['whisper-large-v3-turbo', 'whisper-large-v3']),
        },
    };
}

async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
        const response = await abortable(() => fetch(url, { ...options, signal }), signal);
        if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            throw Object.assign(new Error(`Provider model list returned HTTP ${response.status}`), { status: response.status });
        }
        const text = await abortable(() => response.text(), signal);
        return text ? JSON.parse(text) : {};
    } finally {
        clearTimeout(timer);
    }
}

async function fetchGeminiCatalog(apiKey, signal) {
    const models = [];
    let pageToken = '';
    let pages = 0;

    do {
        const url = new URL(GEMINI_MODELS_URL);
        url.searchParams.set('pageSize', '1000');
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const body = await fetchJson(url, {
            signal,
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

async function fetchGroqCatalog(apiKey, signal) {
    const body = await fetchJson(GROQ_MODELS_URL, {
        signal,
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
    });
    return buildGroqCatalog(Array.isArray(body.data) ? body.data : []);
}

function discardCatalog(entry) {
    clearTimeout(entry.expiration);
    entry.expiration = null;
    entry.catalog = null;
}

function clearProviderModelCache(provider) {
    const providers = provider === undefined ? [...cache.keys()] : [provider];
    for (const name of providers) {
        const entry = cache.get(name);
        cache.delete(name);
        if (entry) {
            discardCatalog(entry);
            entry.refresh?.controller.abort();
        }
    }
}

function startRefresh(entry, provider, apiKey) {
    const controller = new AbortController();
    const { signal } = controller;
    const fetchCatalog = provider === 'gemini' ? fetchGeminiCatalog : fetchGroqCatalog;
    const refresh = { controller, waiters: 0 };
    entry.refresh = refresh;
    refresh.promise = fetchCatalog(apiKey, signal).then(catalog => {
        signal.throwIfAborted();
        discardCatalog(entry);
        entry.catalog = catalog;
        entry.expiration = setTimeout(() => discardCatalog(entry), STALE_TTL_MS);
        entry.expiration.unref();
        entry.fetchedAt = Date.now();
        return { ...catalog, fetchedAt: entry.fetchedAt, source: 'api', stale: false };
    }).catch(error => {
        signal.throwIfAborted();
        if ([401, 403].includes(error.status) || !entry.catalog || Date.now() - entry.fetchedAt >= STALE_TTL_MS) {
            discardCatalog(entry);
            throw error;
        }
        return {
            ...entry.catalog,
            fetchedAt: entry.fetchedAt,
            source: 'cache',
            stale: true,
            warning: 'Could not refresh the provider model catalog.',
        };
    }).finally(() => {
        if (entry.refresh === refresh) entry.refresh = null;
    });
    return refresh;
}

async function listProviderModels(provider, apiKey, options = {}) {
    options.signal?.throwIfAborted();
    const normalizedProvider = String(provider || '').toLowerCase();
    if (!['gemini', 'groq'].includes(normalizedProvider)) throw new Error('Unsupported provider');
    const key = String(apiKey || '').trim();
    if (!key) {
        clearProviderModelCache(normalizedProvider);
        const name = normalizedProvider === 'gemini' ? 'Gemini' : 'Groq';
        throw new Error(`${name} API key is not configured`);
    }

    const fingerprint = keyFingerprint(key);
    let entry = cache.get(normalizedProvider);
    if (entry?.fingerprint !== fingerprint) {
        clearProviderModelCache(normalizedProvider);
        entry = { fingerprint, catalog: null, fetchedAt: 0, expiration: null, refresh: null };
        cache.set(normalizedProvider, entry);
    }

    const age = Date.now() - entry.fetchedAt;
    if (entry.catalog && age >= STALE_TTL_MS) discardCatalog(entry);
    if (!options.forceRefresh && entry.catalog && age < CACHE_TTL_MS) {
        return { ...entry.catalog, fetchedAt: entry.fetchedAt, source: 'cache', stale: false };
    }

    const refresh = entry.refresh || startRefresh(entry, normalizedProvider, key);
    refresh.waiters += 1;
    try {
        return await (options.signal ? abortable(() => refresh.promise, options.signal) : refresh.promise);
    } finally {
        refresh.waiters -= 1;
        if (!refresh.waiters && entry.refresh === refresh) {
            entry.refresh = null;
            refresh.controller.abort();
        }
    }
}

module.exports = {
    listProviderModels,
    clearProviderModelCache,
    _test: {
        modelId,
        normalizeGeminiModel,
        normalizeGroqModel,
        buildGeminiCatalog,
        buildGroqCatalog,
    },
};
