const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function write(rel, content) {
    const file = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
}

function replaceOnce(rel, from, to) {
    const current = read(rel);
    if (!current.includes(from)) {
        throw new Error(`Expected pattern not found in ${rel}: ${from.slice(0, 120)}`);
    }
    write(rel, current.replace(from, to));
}

const providerModelRegistry = String.raw`const crypto = require('node:crypto');

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
    return /(?:preview|experimental|exp(?:-|$))/i.test(`${id} ${displayName}`);
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
    const screen = generate.filter(model => !/(embedding|imagen|veo|lyria|tts|transcribe|robotics|computer-use|(?:^|-)image(?:-|$))/i.test(model.id));

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
            screen: pick(screen, ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-flash-latest']),
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
    const vision = chat.filter(model => /(vision|(?:^|[-/])vl(?:[-/]|$)|maverick|scout|qwen\/qwen3\.(?:6|8)-27b)/i.test(model.id));

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
    if (!['gemini', 'groq'].includes(normalizedProvider)) {
        throw new Error('Unsupported provider');
    }
    if (!apiKey || !String(apiKey).trim()) {
        throw new Error(`${normalizedProvider === 'gemini' ? 'Gemini' : 'Groq'} API key is not configured`);
    }

    const fingerprint = keyFingerprint(apiKey);
    const cacheKey = `${normalizedProvider}:${fingerprint}`;
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
`;

const dynamicModelRegistryRenderer = String.raw`import { html } from '../assets/lit-core-2.7.4.min.js';

const GEMINI_DEFAULTS = {
    live: 'gemini-3.1-flash-live-preview',
    screen: 'gemini-3.7-flash',
};
const GROQ_DEFAULTS = {
    chat: 'openai/gpt-oss-120b',
    vision: 'qwen/qwen3.6-27b',
    transcription: 'whisper-large-v3-turbo',
};

function uniqueModels(models = []) {
    const seen = new Set();
    return models.filter(model => {
        if (!model?.id || seen.has(model.id)) return false;
        seen.add(model.id);
        return true;
    });
}

function findMainViews() {
    const views = [...document.querySelectorAll('main-view')];
    const app = document.querySelector('context-halo-app');
    const nested = app?.shadowRoot?.querySelector('main-view');
    if (nested && !views.includes(nested)) views.push(nested);
    return views;
}

function renderModelPicker(view, { label, value, preferred, all, save, helper }) {
    const preferredModels = uniqueModels(preferred || []);
    const preferredIds = new Set(preferredModels.map(model => model.id));
    const advancedModels = uniqueModels((all || []).filter(model => !preferredIds.has(model.id)));
    const hasCatalog = preferredModels.length > 0 || advancedModels.length > 0;
    const currentKnown = [...preferredModels, ...advancedModels].some(model => model.id === value);

    if (!hasCatalog) {
        return html`
            <div class="form-group">
                <label class="form-label">${label}</label>
                <input type="text" .value=${value || ''} @input=${event => save.call(view, event.target.value)} />
                ${helper ? html`<div class="form-hint">${helper}</div>` : ''}
            </div>
        `;
    }

    return html`
        <div class="form-group">
            <label class="form-label">${label}</label>
            <select .value=${value || ''} @change=${event => save.call(view, event.target.value)}>
                ${!currentKnown && value ? html`<option value=${value}>${value} — current/manual</option>` : ''}
                ${preferredModels.length ? html`
                    <optgroup label="Compatible / recommended">
                        ${preferredModels.map(model => html`
                            <option value=${model.id}>${model.displayName || model.id}${model.preview ? ' · Preview' : ''}</option>
                        `)}
                    </optgroup>
                ` : ''}
                ${advancedModels.length ? html`
                    <optgroup label="All provider models (advanced)">
                        ${advancedModels.map(model => html`
                            <option value=${model.id}>${model.displayName || model.id}${model.preview ? ' · Preview' : ''}</option>
                        `)}
                    </optgroup>
                ` : ''}
            </select>
            ${helper ? html`<div class="form-hint">${helper}</div>` : ''}
        </div>
    `;
}

async function waitForRuntimeProviderPatch(proto) {
    for (let i = 0; i < 100; i++) {
        if (proto.__runtimeProviderFixesPatched) return;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
}

async function patchDynamicModelRegistry() {
    await customElements.whenDefined('main-view');
    const MainView = customElements.get('main-view');
    if (!MainView || MainView.prototype.__dynamicModelRegistryPatched) return;
    const proto = MainView.prototype;
    await waitForRuntimeProviderPatch(proto);

    const originalConnectedCallback = proto.connectedCallback;
    const originalSaveGeminiKey = proto._saveGeminiKey;
    const originalSaveGroqKey = proto._saveGroqKey;

    proto._initializeDynamicModelRegistry = async function () {
        if (this.__dynamicModelRegistryInitialized) return;
        this.__dynamicModelRegistryInitialized = true;
        this._geminiCatalog = null;
        this._groqCatalog = null;
        this._geminiCatalogLoading = false;
        this._groqCatalogLoading = false;
        this._geminiCatalogError = '';
        this._groqCatalogError = '';

        try {
            const [config, geminiKey, groqKey] = await Promise.all([
                contextHalo.storage.getConfig(),
                contextHalo.storage.getApiKey().catch(() => ''),
                contextHalo.storage.getGroqApiKey().catch(() => ''),
            ]);
            this._geminiHttpModel = config.geminiHttpModel || GEMINI_DEFAULTS.screen;
            this._groqTranscriptionModel = config.groqTranscriptionModel || GROQ_DEFAULTS.transcription;
            this.requestUpdate();
            if (geminiKey?.trim()) this._refreshProviderModels('gemini', false);
            if (groqKey?.trim()) this._refreshProviderModels('groq', false);
        } catch (error) {
            console.warn('Could not initialize provider model registry:', error);
        }
    };

    proto._refreshProviderModels = async function (provider, forceRefresh = false) {
        const isGemini = provider === 'gemini';
        const loadingKey = isGemini ? '_geminiCatalogLoading' : '_groqCatalogLoading';
        const errorKey = isGemini ? '_geminiCatalogError' : '_groqCatalogError';
        const catalogKey = isGemini ? '_geminiCatalog' : '_groqCatalog';
        if (this[loadingKey]) return;
        this[loadingKey] = true;
        this[errorKey] = '';
        this.requestUpdate();
        try {
            const { ipcRenderer } = window.require('electron');
            const result = await ipcRenderer.invoke('provider-models:list', provider, forceRefresh === true);
            if (!result?.success) throw new Error(result?.error || 'Model discovery failed');
            this[catalogKey] = result.data;
            if (result.data?.warning) this[errorKey] = `Using cached catalog: ${result.data.warning}`;
        } catch (error) {
            this[errorKey] = error?.message || String(error);
        } finally {
            this[loadingKey] = false;
            this.requestUpdate();
        }
    };

    proto._scheduleProviderModelRefresh = function (provider) {
        const timerKey = provider === 'gemini' ? '__geminiCatalogRefreshTimer' : '__groqCatalogRefreshTimer';
        if (this[timerKey]) clearTimeout(this[timerKey]);
        this[timerKey] = setTimeout(() => this._refreshProviderModels(provider, true), 1200);
    };

    proto._saveGeminiKey = async function (value) {
        const result = await originalSaveGeminiKey.call(this, value);
        if (String(value || '').trim().length >= 20) this._scheduleProviderModelRefresh('gemini');
        return result;
    };

    proto._saveGroqKey = async function (value) {
        const result = await originalSaveGroqKey.call(this, value);
        if (String(value || '').trim().length >= 20) this._scheduleProviderModelRefresh('groq');
        return result;
    };

    proto._saveGeminiHttpModel = async function (value) {
        this._geminiHttpModel = value;
        await contextHalo.storage.updateConfig('geminiHttpModel', value);
        this.requestUpdate();
    };

    proto._saveGroqTranscriptionModel = async function (value) {
        this._groqTranscriptionModel = value;
        await contextHalo.storage.updateConfig('groqTranscriptionModel', value);
        this.requestUpdate();
    };

    proto._renderByokMode = function () {
        const catalog = this._geminiCatalog;
        const all = catalog?.all || [];
        return html`
            <details class="config-section" open>
                <summary class="config-summary">
                    <span class="config-summary-text">
                        <span class="config-summary-title">Gemini</span>
                        <span class="config-summary-description">Live audio plus selectable Gemini screen analysis</span>
                    </span>
                    ${this._renderConfigChevron()}
                </summary>
                <div class="config-content">
                    <div class="form-group">
                        <label class="form-label">Gemini API Key</label>
                        <input
                            type="password"
                            placeholder="Required"
                            .value=${this._geminiKey}
                            @input=${event => this._saveGeminiKey(event.target.value)}
                            class=${this._keyError ? 'error' : ''}
                        />
                        <div class="form-hint">
                            <span class="link" @click=${() => this.onExternalLink('https://aistudio.google.com/apikey')}>Get Gemini key</span>
                            <span> · </span>
                            <span class="link" @click=${() => this._refreshProviderModels('gemini', true)}>Refresh models</span>
                            ${this._geminiCatalogLoading ? html`<span> · Loading…</span>` : ''}
                        </div>
                        ${this._geminiCatalogError ? html`<div class="config-note">Model discovery: ${this._geminiCatalogError}. Manual model IDs remain available.</div>` : ''}
                    </div>

                    ${renderModelPicker(this, {
                        label: 'Gemini Live Model',
                        value: this._geminiLiveModel || GEMINI_DEFAULTS.live,
                        preferred: catalog?.live,
                        all,
                        save: this._saveGeminiLiveModel,
                        helper: 'Live-compatible models are identified from the provider supported methods. Advanced choices may not support Live sessions.',
                    })}

                    ${renderModelPicker(this, {
                        label: 'Screen / Analysis Model',
                        value: this._geminiHttpModel || GEMINI_DEFAULTS.screen,
                        preferred: catalog?.screen,
                        all,
                        save: this._saveGeminiHttpModel,
                        helper: 'Screen choices prefer generateContent models. The advanced group contains every model returned for your key.',
                    })}

                    <div class="config-note">
                        Model lists come directly from the Gemini Models API for your key. If discovery is unavailable, ContextHalo keeps the current manual model IDs and existing provider behavior.
                    </div>
                </div>
            </details>

            ${this._renderStartButton()} ${this._renderDivider()}

            <div class="mode-links">
                <button class="mode-link" @click=${() => this._saveMode('groq')}>Use Groq API</button>
                <button class="mode-link" @click=${() => this._saveMode('local')}>Use local AI</button>
            </div>
        `;
    };

    proto._renderGroqMode = function () {
        const catalog = this._groqCatalog;
        const all = catalog?.all || [];
        return html`
            <details class="config-section" open>
                <summary class="config-summary">
                    <span class="config-summary-text">
                        <span class="config-summary-title">Groq</span>
                        <span class="config-summary-description">Selectable transcription, reasoning, and vision models</span>
                    </span>
                    ${this._renderConfigChevron()}
                </summary>
                <div class="config-content">
                    <div class="form-group">
                        <label class="form-label">Groq API Key</label>
                        <input
                            type="password"
                            placeholder="Required"
                            .value=${this._groqKey}
                            @input=${event => this._saveGroqKey(event.target.value)}
                            class=${this._keyError ? 'error' : ''}
                        />
                        <div class="form-hint">
                            <span class="link" @click=${() => this.onExternalLink('https://console.groq.com/keys')}>Get Groq key</span>
                            <span> · </span>
                            <span class="link" @click=${() => this._refreshProviderModels('groq', true)}>Refresh models</span>
                            ${this._groqCatalogLoading ? html`<span> · Loading…</span>` : ''}
                        </div>
                        ${this._groqCatalogError ? html`<div class="config-note">Model discovery: ${this._groqCatalogError}. Manual model IDs remain available.</div>` : ''}
                    </div>

                    ${renderModelPicker(this, {
                        label: 'Text / Reasoning Model',
                        value: this._groqModel || GROQ_DEFAULTS.chat,
                        preferred: catalog?.chat,
                        all,
                        save: this._saveGroqModel,
                        helper: 'The compatible group removes known transcription, speech, and guard-only IDs.',
                    })}

                    ${renderModelPicker(this, {
                        label: 'Screenshot / Vision Model',
                        value: this._groqImageModel || GROQ_DEFAULTS.vision,
                        preferred: catalog?.vision,
                        all,
                        save: this._saveGroqImageModel,
                        helper: 'Groq model-list metadata does not expose input modalities, so the advanced group may include models that cannot accept images.',
                    })}

                    ${renderModelPicker(this, {
                        label: 'Audio Transcription Model',
                        value: this._groqTranscriptionModel || GROQ_DEFAULTS.transcription,
                        preferred: catalog?.transcription,
                        all,
                        save: this._saveGroqTranscriptionModel,
                        helper: 'Whisper/transcription IDs are preferred. Advanced selections may not support the transcription endpoint.',
                    })}

                    <div class="config-note">
                        Model IDs come directly from Groq's Models API. Existing saved IDs remain valid even when discovery is temporarily unavailable.
                    </div>
                </div>
            </details>

            ${this._renderStartButton()} ${this._renderDivider()}

            <div class="mode-links">
                <button class="mode-link" @click=${() => this._saveMode('byok')}>Use Gemini API</button>
                <button class="mode-link" @click=${() => this._saveMode('local')}>Use local AI</button>
            </div>
        `;
    };

    proto.connectedCallback = function () {
        const result = originalConnectedCallback.call(this);
        queueMicrotask(() => this._initializeDynamicModelRegistry());
        return result;
    };

    proto.__dynamicModelRegistryPatched = true;
    for (const view of findMainViews()) {
        view._initializeDynamicModelRegistry();
        view.requestUpdate();
    }
}

patchDynamicModelRegistry().catch(error => {
    console.error('Failed to install dynamic provider model registry UI:', error);
});
`;

const providerModelTests = String.raw`const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const registry = require('../src/utils/providerModelRegistry');

const { buildGeminiCatalog, buildGroqCatalog } = registry._test;

test('Gemini catalog separates Live and generateContent models from API metadata', () => {
    const catalog = buildGeminiCatalog([
        {
            name: 'models/gemini-3.1-flash-live-preview',
            displayName: 'Gemini 3.1 Flash Live Preview',
            supportedGenerationMethods: ['bidiGenerateContent'],
        },
        {
            name: 'models/gemini-3.7-flash',
            displayName: 'Gemini 3.7 Flash',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
        {
            name: 'models/gemini-embedding-2',
            displayName: 'Gemini Embedding 2',
            supportedGenerationMethods: ['embedContent'],
        },
    ]);

    assert.deepEqual(catalog.live.map(model => model.id), ['gemini-3.1-flash-live-preview']);
    assert.deepEqual(catalog.screen.map(model => model.id), ['gemini-3.7-flash']);
    assert.equal(catalog.recommended.live, 'gemini-3.1-flash-live-preview');
    assert.equal(catalog.recommended.screen, 'gemini-3.7-flash');
});

test('Groq catalog keeps all active models while grouping chat, vision, and transcription conservatively', () => {
    const catalog = buildGroqCatalog([
        { id: 'openai/gpt-oss-120b', active: true, owned_by: 'OpenAI' },
        { id: 'qwen/qwen3.8-27b', active: true, owned_by: 'Qwen' },
        { id: 'whisper-large-v3-turbo', active: true, owned_by: 'OpenAI' },
        { id: 'canopylabs/orpheus-v1-english', active: true, owned_by: 'Canopy Labs' },
        { id: 'retired-model', active: false, owned_by: 'Example' },
    ]);

    assert.equal(catalog.all.some(model => model.id === 'retired-model'), false);
    assert.equal(catalog.chat.some(model => model.id === 'openai/gpt-oss-120b'), true);
    assert.equal(catalog.vision.some(model => model.id === 'qwen/qwen3.8-27b'), true);
    assert.deepEqual(catalog.transcription.map(model => model.id), ['whisper-large-v3-turbo']);
    assert.equal(catalog.chat.some(model => model.id.includes('orpheus')), false);
});

test('Phase 1 wiring preserves manual fallback and makes Groq transcription configurable', () => {
    const preload = fs.readFileSync(path.join(process.cwd(), 'preload.js'), 'utf8');
    const indexMain = fs.readFileSync(path.join(process.cwd(), 'src', 'index.js'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(process.cwd(), 'src', 'index.html'), 'utf8');
    const gemini = fs.readFileSync(path.join(process.cwd(), 'src', 'utils', 'gemini.js'), 'utf8');
    const hardening = fs.readFileSync(path.join(process.cwd(), 'src', 'utils', 'runtimeHardeningMain.js'), 'utf8');
    const dynamicUi = fs.readFileSync(path.join(process.cwd(), 'src', 'utils', 'dynamicModelRegistryRenderer.js'), 'utf8');

    assert.match(preload, /provider-models:list/);
    assert.match(indexMain, /listProviderModels/);
    assert.match(indexHtml, /dynamicModelRegistryRenderer\.js/);
    assert.match(gemini, /groqTranscriptionModel/);
    assert.match(hardening, /groqTranscriptionModel/);
    assert.match(dynamicUi, /Manual model IDs remain available/i);
    assert.match(dynamicUi, /All provider models \(advanced\)/);
});
`;

write('src/utils/providerModelRegistry.js', providerModelRegistry);
write('src/utils/dynamicModelRegistryRenderer.js', dynamicModelRegistryRenderer);
write('tests/provider-model-registry.test.js', providerModelTests);

replaceOnce('src/storage.js', 'const CONFIG_VERSION = 4;', 'const CONFIG_VERSION = 5;');
replaceOnce(
    'src/storage.js',
    "    groqImageModel: 'qwen/qwen3.6-27b',\n    disableGroqThinking: true,",
    "    groqImageModel: 'qwen/qwen3.6-27b',\n    groqTranscriptionModel: 'whisper-large-v3-turbo',\n    disableGroqThinking: true,"
);
replaceOnce(
    'src/storage.js',
    "    if (!config.groqImageModel) config.groqImageModel = DEFAULT_CONFIG.groqImageModel;\n\n    return config;",
    "    if (!config.groqImageModel) config.groqImageModel = DEFAULT_CONFIG.groqImageModel;\n    if (!config.groqTranscriptionModel) config.groqTranscriptionModel = DEFAULT_CONFIG.groqTranscriptionModel;\n\n    return config;"
);

replaceOnce(
    'preload.js',
    "        'storage:clear-all',\n        'get-app-version',",
    "        'storage:clear-all',\n        'provider-models:list',\n        'get-app-version',"
);

replaceOnce(
    'src/index.js',
    "const storage = require('./storage');",
    "const storage = require('./storage');\nconst { listProviderModels } = require('./utils/providerModelRegistry');"
);
replaceOnce(
    'src/index.js',
    "function setupGeneralIpcHandlers() {\n    ipcMain.handle('get-app-version', event => {",
    "function setupGeneralIpcHandlers() {\n    ipcMain.handle('provider-models:list', async (event, provider, forceRefresh = false) => {\n        if (!isTrustedEvent(event) || !['gemini', 'groq'].includes(provider)) {\n            return { success: false, error: 'Invalid provider model request' };\n        }\n        try {\n            const apiKey = provider === 'gemini' ? storage.getApiKey() : storage.getGroqApiKey();\n            const data = await listProviderModels(provider, apiKey, { forceRefresh: forceRefresh === true });\n            return { success: true, data };\n        } catch (error) {\n            return { success: false, error: error?.message || String(error) };\n        }\n    });\n\n    ipcMain.handle('get-app-version', event => {"
);

replaceOnce(
    'src/index.html',
    '        <script type="module" src="utils/runtimeProviderFixes.js"></script>\n        <script type="module" src="utils/runtimeHardeningRenderer.js"></script>',
    '        <script type="module" src="utils/runtimeProviderFixes.js"></script>\n        <script type="module" src="utils/dynamicModelRegistryRenderer.js"></script>\n        <script type="module" src="utils/runtimeHardeningRenderer.js"></script>'
);

replaceOnce(
    'src/utils/gemini.js',
    "        form.append('model', 'whisper-large-v3-turbo');",
    "        form.append('model', getConfig().groqTranscriptionModel || 'whisper-large-v3-turbo');"
);
replaceOnce(
    'src/utils/runtimeHardeningMain.js',
    "        form.append('model', 'whisper-large-v3-turbo');",
    "        form.append('model', storage.getConfig().groqTranscriptionModel || 'whisper-large-v3-turbo');"
);

replaceOnce('tests/storage.test.js', 'assert.equal(config.configVersion, 4);', 'assert.equal(config.configVersion, 5);');
replaceOnce(
    'tests/storage.test.js',
    "    assert.equal(config.groqImageModel, 'qwen/qwen3.6-27b');\n    assert.equal(config.onboarded, true);",
    "    assert.equal(config.groqImageModel, 'qwen/qwen3.6-27b');\n    assert.equal(config.groqTranscriptionModel, 'whisper-large-v3-turbo');\n    assert.equal(config.onboarded, true);"
);

console.log('Phase 1 dynamic model registry changes applied successfully.');
