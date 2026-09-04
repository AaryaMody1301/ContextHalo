import { html } from '../assets/lit-core-2.7.4.min.js';

const GOOGLE_SEARCH_KEY = 'googleSearchEnabled';

function mirrorGoogleSearchSetting(value) {
    if (typeof value === 'boolean') {
        localStorage.setItem(GOOGLE_SEARCH_KEY, String(value));
    }
}

async function patchPreferenceStorage() {
    const storage = window.contextHalo?.storage;
    if (!storage || storage.__runtimeProviderFixesPatched) return;

    try {
        const prefs = await storage.getPreferences();
        mirrorGoogleSearchSetting(prefs?.googleSearchEnabled === true);
    } catch (error) {
        console.warn('Could not sync Google Search preference:', error);
    }

    const originalUpdatePreference = storage.updatePreference.bind(storage);
    storage.updatePreference = async (key, value) => {
        const result = await originalUpdatePreference(key, value);
        if (key === GOOGLE_SEARCH_KEY) mirrorGoogleSearchSetting(value === true);
        return result;
    };

    const originalSetPreferences = storage.setPreferences.bind(storage);
    storage.setPreferences = async preferences => {
        const result = await originalSetPreferences(preferences);
        if (Object.prototype.hasOwnProperty.call(preferences || {}, GOOGLE_SEARCH_KEY)) {
            mirrorGoogleSearchSetting(preferences.googleSearchEnabled === true);
        }
        return result;
    };

    storage.__runtimeProviderFixesPatched = true;
}

async function patchMainView() {
    await customElements.whenDefined('main-view');
    const MainView = customElements.get('main-view');
    if (!MainView || MainView.prototype.__runtimeProviderFixesPatched) return;

    const proto = MainView.prototype;
    const originalRender = proto.render;
    const originalRenderLocalMode = proto._renderLocalMode;
    const originalHandleStart = proto._handleStart;
    const originalSaveGroqKey = proto._saveGroqKey;

    proto._saveGroqKey = async function (value) {
        this._keyError = false;
        return originalSaveGroqKey.call(this, value);
    };

    proto._handleStart = function () {
        if (this._mode !== 'groq') return originalHandleStart.call(this);
        if (this.isInitializing || this.downloadProgress.active) return;

        if (!this._groqKey.trim()) {
            this._keyError = true;
            this.requestUpdate();
            return;
        }

        this.onStart();
    };

    proto._renderByokMode = function () {
        return html`
            <details class="config-section" open>
                <summary class="config-summary">
                    <span class="config-summary-text">
                        <span class="config-summary-title">Gemini</span>
                        <span class="config-summary-description">Live audio plus Gemini 3.8 Flash screenshots</span>
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
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Gemini Live Model</label>
                        <input type="text" .value=${this._geminiLiveModel} @input=${event => this._saveGeminiLiveModel(event.target.value)} />
                    </div>

                    <div class="config-note">
                        Live audio uses Gemini 3.1 Flash Live Preview. Manual screenshots use Gemini 3.8 Flash from the migrated app configuration.
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
        return html`
            <details class="config-section" open>
                <summary class="config-summary">
                    <span class="config-summary-text">
                        <span class="config-summary-title">Groq</span>
                        <span class="config-summary-description">Whisper transcription plus Groq reasoning and vision</span>
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
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Text / Reasoning Model</label>
                        <input type="text" .value=${this._groqModel} @input=${event => this._saveGroqModel(event.target.value)} />
                    </div>

                    <div class="form-group">
                        <label class="form-label">Screenshot / Vision Model</label>
                        <input type="text" .value=${this._groqImageModel} @input=${event => this._saveGroqImageModel(event.target.value)} />
                    </div>

                    <div class="config-note">
                        Audio transcription uses whisper-large-v3-turbo. GPT-OSS reasoning output is hidden; Qwen vision uses the saved reasoning preference. This mode does not require a Gemini key or consume Gemini quota.
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

    proto._renderLocalMode = function () {
        return html`
            ${originalRenderLocalMode.call(this)}
            <div class="mode-links">
                <button class="mode-link" @click=${() => this._saveMode('groq')}>Use Groq API</button>
            </div>
        `;
    };

    proto.render = function () {
        if (this._mode !== 'groq') return originalRender.call(this);

        return html`
            <div class="form-wrapper">
                <div class="page-title">ContextHalo <span class="mode-suffix">Groq</span></div>
                <div class="page-subtitle">Use your Groq API key without opening a Gemini Live session</div>
                ${this._renderProfileSelector ? this._renderProfileSelector() : ''}
                ${this._renderSessionStatus ? this._renderSessionStatus() : ''}
                ${this._renderGroqMode()}
            </div>
        `;
    };

    proto.__runtimeProviderFixesPatched = true;
    document.querySelectorAll('main-view').forEach(element => element.requestUpdate());
}

async function applyRuntimeProviderFixes() {
    await patchPreferenceStorage();
    await patchMainView();
}

applyRuntimeProviderFixes().catch(error => {
    console.error('Failed to apply runtime provider fixes:', error);
});
