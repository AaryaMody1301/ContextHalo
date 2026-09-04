import { html } from '../assets/lit-core-2.7.4.min.js';

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

function renderModelPicker(view, options) {
    const {
        label,
        value,
        preferred = [],
        all = [],
        onSave,
        helper = '',
    } = options;

    const preferredModels = uniqueModels(preferred);
    const preferredIds = new Set(preferredModels.map(model => model.id));
    const advancedModels = uniqueModels(all.filter(model => !preferredIds.has(model.id)));
    const catalogModels = [...preferredModels, ...advancedModels];
    const hasCatalog = catalogModels.length > 0;
    const currentKnown = catalogModels.some(model => model.id === value);

    if (!hasCatalog) {
        return html`
            <div class="form-group">
                <label class="form-label">${label}</label>
                <input type="text" .value=${value || ''} @input=${event => onSave.call(view, event.target.value)} />
                ${helper ? html`<div class="form-hint">${helper}</div>` : ''}
            </div>
        `;
    }

    return html`
        <div class="form-group">
            <label class="form-label">${label}</label>
            <select .value=${value || ''} @change=${event => onSave.call(view, event.target.value)}>
                ${!currentKnown && value ? html`<option value=${value}>${value} — current/manual</option>` : ''}
                ${preferredModels.length ? html`
                    <optgroup label="Compatible / recommended">
                        ${preferredModels.map(model => html`
                            <option value=${model.id}>
                                ${model.displayName || model.id}${model.preview ? ' · Preview' : ''}
                            </option>
                        `)}
                    </optgroup>
                ` : ''}
                ${advancedModels.length ? html`
                    <optgroup label="All provider models (advanced)">
                        ${advancedModels.map(model => html`
                            <option value=${model.id}>
                                ${model.displayName || model.id}${model.preview ? ' · Preview' : ''}
                            </option>
                        `)}
                    </optgroup>
                ` : ''}
            </select>
            ${helper ? html`<div class="form-hint">${helper}</div>` : ''}
        </div>
    `;
}

async function waitForRuntimeProviderPatch(proto) {
    for (let attempt = 0; attempt < 100; attempt++) {
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
    const originalDisconnectedCallback = proto.disconnectedCallback;
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
                        ${this._geminiCatalogError ? html`
                            <div class="config-note">Model discovery: ${this._geminiCatalogError}. Manual model IDs remain available.</div>
                        ` : ''}
                    </div>

                    ${renderModelPicker(this, {
                        label: 'Gemini Live Model',
                        value: this._geminiLiveModel || GEMINI_DEFAULTS.live,
                        preferred: catalog?.live,
                        all,
                        onSave: this._saveGeminiLiveModel,
                        helper: 'Live-compatible models are identified from the provider-supported generation methods. Advanced choices may not support Live sessions.',
                    })}

                    ${renderModelPicker(this, {
                        label: 'Screen / Analysis Model',
                        value: this._geminiHttpModel || GEMINI_DEFAULTS.screen,
                        preferred: catalog?.screen,
                        all,
                        onSave: this._saveGeminiHttpModel,
                        helper: 'Screen choices prefer generateContent models. The advanced group contains every model returned for your API key.',
                    })}

                    <div class="config-note">
                        Models are loaded from the Gemini Models API. If discovery is unavailable, ContextHalo keeps the current manual model IDs and existing provider behavior.
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
                        ${this._groqCatalogError ? html`
                            <div class="config-note">Model discovery: ${this._groqCatalogError}. Manual model IDs remain available.</div>
                        ` : ''}
                    </div>

                    ${renderModelPicker(this, {
                        label: 'Text / Reasoning Model',
                        value: this._groqModel || GROQ_DEFAULTS.chat,
                        preferred: catalog?.chat,
                        all,
                        onSave: this._saveGroqModel,
                        helper: 'The compatible group removes known transcription, speech, and guard-only IDs.',
                    })}

                    ${renderModelPicker(this, {
                        label: 'Screenshot / Vision Model',
                        value: this._groqImageModel || GROQ_DEFAULTS.vision,
                        preferred: catalog?.vision,
                        all,
                        onSave: this._saveGroqImageModel,
                        helper: 'Groq model-list metadata does not expose full input modalities, so the advanced group may include models that cannot accept images.',
                    })}

                    ${renderModelPicker(this, {
                        label: 'Audio Transcription Model',
                        value: this._groqTranscriptionModel || GROQ_DEFAULTS.transcription,
                        preferred: catalog?.transcription,
                        all,
                        onSave: this._saveGroqTranscriptionModel,
                        helper: 'Whisper/transcription IDs are preferred. Advanced selections may not support the transcription endpoint.',
                    })}

                    <div class="config-note">
                        Models are loaded from Groq's Models API. Existing saved IDs remain usable even if discovery is temporarily unavailable.
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

    proto.disconnectedCallback = function () {
        if (this.__geminiCatalogRefreshTimer) clearTimeout(this.__geminiCatalogRefreshTimer);
        if (this.__groqCatalogRefreshTimer) clearTimeout(this.__groqCatalogRefreshTimer);
        return originalDisconnectedCallback.call(this);
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
