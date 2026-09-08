import { RESPONSE_MODES, getRealtimeState, setResponseMode } from '../../utils/realtimeContextRenderer.js';
import { loadContextState, getContextState, selectionKey, refreshCaptureSources, setCaptureSource, setPackField, captureClipboardText, clearClipboardContext } from '../../utils/contextCaptureRenderer.js';
import { GEMINI_DEFAULTS, GROQ_DEFAULTS, renderModelPicker } from '../../utils/dynamicModelRegistryRenderer.js';
import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

const LOCAL_LLM_PRESETS = [
    { value: 'unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M', label: 'Qwen 3.5 0.8B Q4 — 0.74 GB · Fastest' },
    { value: 'unsloth/Qwen3.5-0.8B-GGUF:Q8_0', label: 'Qwen 3.5 0.8B Q8 — 1.02 GB' },
    { value: 'unsloth/Qwen3.5-2B-GGUF:Q4_K_M', label: 'Qwen 3.5 2B Q4 — 1.95 GB' },
    { value: 'unsloth/Qwen3.5-2B-GGUF:Q8_0', label: 'Qwen 3.5 2B Q8 — 2.68 GB' },
    { value: 'unsloth/Qwen3.5-4B-GGUF:Q4_K_M', label: 'Qwen 3.5 4B Q4 — 3.42 GB · Recommended' },
    { value: 'unsloth/Qwen3.5-4B-GGUF:Q8_0', label: 'Qwen 3.5 4B Q8 — 5.16 GB' },
    { value: 'unsloth/Qwen3.5-9B-GGUF:Q4_K_M', label: 'Qwen 3.5 9B Q4 — 6.60 GB' },
    { value: 'unsloth/Qwen3.5-9B-GGUF:Q8_0', label: 'Qwen 3.5 9B Q8 — 10.45 GB' },
    { value: 'unsloth/Qwen3.5-27B-GGUF:Q4_K_M', label: 'Qwen 3.5 27B Q4 — 17.67 GB' },
    { value: 'unsloth/Qwen3.5-35B-A3B-GGUF:Q4_K_M', label: 'Qwen 3.5 35B-A3B Q4 — 22.92 GB · Largest' },
];

export class MainView extends LitElement {
    static styles = css`
        .preparation { margin: 16px 0; border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
        .preparation summary { cursor: pointer; font-weight: 600; }
        .preparation label { display: block; margin: 12px 0 4px; color: var(--text-secondary); }
        .preparation textarea, .preparation select, .preparation input { width: 100%; font: inherit; }
        .preparation textarea { min-height: 72px; padding: 8px; resize: vertical; background: var(--bg-elevated); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px; }
        .preparation-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
        .preparation button { background: var(--bg-elevated); color: var(--text-primary); border: 1px solid var(--border); padding: 7px 10px; border-radius: 6px; cursor: pointer; }
        .preparation :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

        * {
            font-family: var(--font);
            cursor: default;
            user-select: none;
            box-sizing: border-box;
        }

        :host {
            display: block;
            width: 100%;
            min-height: 100%;
            height: auto;
            overflow: visible;
            box-sizing: border-box;
            padding: 58px clamp(24px, 6vw, 72px) 44px;
        }

        .form-wrapper {
            width: min(760px, 100%);
            margin: 0 auto;
            display: flex;
            flex-direction: column;
            gap: var(--space-md);
        }

        .page-title {
            font-size: var(--font-size-xl);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
            margin-bottom: var(--space-xs);
        }

        .page-title .mode-suffix {
            opacity: 0.5;
        }

        .page-subtitle {
            font-size: var(--font-size-sm);
            color: var(--text-muted);
            margin-bottom: var(--space-md);
        }

        /* ── Cloud promo card ── */

        .cloud-promo {
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 14px 16px;
            border-radius: var(--radius-md);
            border: 1px solid rgba(59, 130, 246, 0.45);
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(139, 92, 246, 0.09) 100%);
            cursor: pointer;
            transition:
                border-color 0.2s,
                background 0.2s;
        }

        .cloud-promo:hover {
            border-color: rgba(59, 130, 246, 0.65);
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.16) 0%, rgba(139, 92, 246, 0.12) 100%);
            box-shadow:
                0 0 20px rgba(59, 130, 246, 0.15),
                0 0 40px rgba(139, 92, 246, 0.08);
        }

        .cloud-promo-glow {
            position: absolute;
            top: -40%;
            right: -20%;
            width: 120px;
            height: 120px;
            background: radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%);
            pointer-events: none;
        }

        .cloud-promo-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .cloud-promo-title {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
        }

        .cloud-promo-arrow {
            color: var(--accent);
            font-size: 16px;
            transition: transform 0.2s;
        }

        .cloud-promo:hover .cloud-promo-arrow {
            transform: translateX(2px);
        }

        .cloud-promo-desc {
            font-size: var(--font-size-xs);
            color: var(--text-secondary);
            line-height: var(--line-height);
        }

        /* ── Form controls ── */

        .form-group {
            display: flex;
            flex-direction: column;
            gap: var(--space-xs);
        }

        .config-section {
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            background: var(--bg-surface);
            overflow: hidden;
        }

        .config-summary {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-md);
            padding: 12px 14px;
            cursor: pointer;
            list-style: none;
        }

        .config-summary::-webkit-details-marker {
            display: none;
        }

        .config-summary-text {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .config-summary-title {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            color: var(--text-primary);
        }

        .config-summary-description {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
        }

        .config-chevron {
            width: 16px;
            height: 16px;
            color: var(--text-muted);
            transition: transform var(--transition);
        }

        .config-section[open] .config-chevron {
            transform: rotate(180deg);
        }

        .config-content {
            display: flex;
            flex-direction: column;
            gap: var(--space-md);
            padding: 14px;
            border-top: 1px solid var(--border);
        }

        .config-note {
            padding: 10px 12px;
            border: 1px solid rgba(212, 160, 23, 0.28);
            border-radius: var(--radius-sm);
            background: rgba(212, 160, 23, 0.08);
            color: var(--text-secondary);
            font-size: var(--font-size-xs);
            line-height: var(--line-height);
        }

        .config-checkbox {
            display: flex;
            align-items: flex-start;
            gap: var(--space-sm);
            cursor: pointer;
        }

        .config-checkbox input {
            width: 16px;
            height: 16px;
            margin-top: 2px;
            padding: 0;
            accent-color: var(--accent);
            cursor: pointer;
        }

        .config-checkbox-text {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .form-label {
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-medium);
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        input,
        select,
        textarea {
            background: var(--bg-elevated);
            color: var(--text-primary);
            border: 1px solid var(--border);
            padding: 10px 12px;
            width: 100%;
            border-radius: var(--radius-sm);
            font-size: var(--font-size-sm);
            font-family: var(--font);
            transition:
                border-color var(--transition),
                box-shadow var(--transition);
        }

        input:hover:not(:focus),
        select:hover:not(:focus),
        textarea:hover:not(:focus) {
            border-color: var(--text-muted);
        }

        input:focus,
        select:focus,
        textarea:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 0 1px var(--accent);
        }

        input::placeholder,
        textarea::placeholder {
            color: var(--text-muted);
        }

        input.error {
            border-color: var(--danger, #ef4444);
        }

        select {
            cursor: pointer;
            appearance: none;
            color-scheme: dark;
            background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23999' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
            background-position: right 8px center;
            background-repeat: no-repeat;
            background-size: 14px;
            padding-right: 28px;
        }

        select option,
        select optgroup {
            background: #191919;
            color: #f5f5f5;
        }

        textarea {
            resize: vertical;
            min-height: 80px;
            line-height: var(--line-height);
        }

        .form-hint {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
        }

        .form-hint a,
        .form-hint span.link {
            color: var(--accent);
            text-decoration: none;
            cursor: pointer;
        }

        .form-hint span.link:hover {
            text-decoration: underline;
        }

        .whisper-label-row {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .whisper-spinner {
            width: 12px;
            height: 12px;
            border: 2px solid var(--border);
            border-top-color: var(--accent);
            border-radius: 50%;
            animation: whisper-spin 0.8s linear infinite;
        }

        @keyframes whisper-spin {
            to {
                transform: rotate(360deg);
            }
        }

        .session-status {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 10px 12px;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            background: var(--bg-elevated);
            color: var(--text-secondary);
            font-size: var(--font-size-xs);
            line-height: 1.45;
        }

        .session-status.error {
            border-color: rgba(239, 68, 68, 0.55);
            background: rgba(239, 68, 68, 0.08);
            color: #fca5a5;
        }

        .session-status-dot {
            width: 7px;
            height: 7px;
            flex: none;
            margin-top: 5px;
            border-radius: 50%;
            background: currentColor;
        }

        /* ── Start button ── */

        .start-button {
            position: relative;
            overflow: hidden;
            background: #e8e8e8;
            color: #111111;
            border: none;
            padding: 12px var(--space-md);
            border-radius: var(--radius-sm);
            font-size: var(--font-size-base);
            font-weight: var(--font-weight-semibold);
            cursor: pointer;
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-sm);
        }

        .start-button canvas.btn-aurora {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            z-index: 0;
        }

        .start-button canvas.btn-dither {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            z-index: 1;
            opacity: 0.1;
            mix-blend-mode: overlay;
            pointer-events: none;
            image-rendering: pixelated;
        }

        .start-button .btn-label {
            position: relative;
            z-index: 2;
            display: flex;
            align-items: center;
            gap: var(--space-sm);
        }

        .start-button:hover {
            opacity: 0.9;
        }

        .start-button.disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .start-button.disabled:hover {
            opacity: 0.5;
        }

        .download-progress-fill {
            position: absolute;
            inset: 0 auto 0 0;
            z-index: 2;
            width: 0;
            background: rgba(17, 17, 17, 0.16);
            transition: width 0.2s ease;
            pointer-events: none;
        }

        .download-progress-fill.indeterminate {
            width: 38%;
            animation: download-progress-slide 1.2s ease-in-out infinite;
        }

        .download-controls {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-md);
            margin-top: var(--space-xs);
            font-size: var(--font-size-xs);
            color: var(--text-muted);
        }

        .download-cancel {
            flex: none;
            padding: 0;
            border: none;
            background: none;
            color: var(--danger, #ef4444);
            font: inherit;
            cursor: pointer;
        }

        .download-cancel:hover {
            text-decoration: underline;
        }

        @keyframes download-progress-slide {
            from {
                transform: translateX(-105%);
            }
            to {
                transform: translateX(270%);
            }
        }

        .shortcut-hint {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            opacity: 0.5;
            font-family: var(--font-mono);
        }

        /* ── Divider ── */

        .divider {
            display: flex;
            align-items: center;
            gap: var(--space-md);
            margin: var(--space-sm) 0;
        }

        .divider-line {
            flex: 1;
            height: 1px;
            background: var(--border);
        }

        .divider-text {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            text-transform: lowercase;
        }

        /* ── Mode switch links ── */

        .mode-links {
            display: flex;
            justify-content: center;
            gap: var(--space-lg);
        }

        .mode-link {
            font-size: var(--font-size-sm);
            color: var(--text-secondary);
            cursor: pointer;
            background: none;
            border: none;
            padding: 0;
            transition: color var(--transition);
        }

        .mode-link:hover {
            color: var(--text-primary);
        }

        /* ── Mode option cards ── */

        .mode-cards {
            display: flex;
            gap: var(--space-sm);
        }

        .mode-card {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 12px 14px;
            border-radius: var(--radius-md);
            border: 1px solid var(--border);
            background: var(--bg-elevated);
            cursor: pointer;
            transition:
                border-color 0.2s,
                background 0.2s;
        }

        .mode-card:hover {
            border-color: var(--text-muted);
            background: var(--bg-hover);
        }

        .mode-card-title {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
        }

        .mode-card-desc {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            line-height: var(--line-height);
        }

        /* ── Title row with help ── */

        .title-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: var(--space-xs);
        }

        .title-row .page-title {
            margin-bottom: 0;
        }

        .help-btn {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 4px;
            border-radius: var(--radius-sm);
            transition: color 0.2s;
            display: flex;
            align-items: center;
        }

        .help-btn:hover {
            color: var(--text-secondary);
        }

        .help-btn * {
            pointer-events: none;
        }

        .help-dialog-backdrop {
            position: fixed;
            inset: 0;
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: var(--space-lg);
            background: rgba(0, 0, 0, 0.62);
        }

        .help-dialog {
            width: min(680px, 100%);
            max-height: calc(100vh - 48px);
            display: flex;
            flex-direction: column;
            gap: var(--space-md);
            padding: var(--space-lg);
            overflow: hidden;
            background: var(--bg-surface);
            border: 1px solid var(--border-strong);
            border-radius: var(--radius-lg);
            color: var(--text-primary);
        }

        .help-dialog-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-md);
        }

        .help-dialog-title {
            font-size: var(--font-size-lg);
            font-weight: var(--font-weight-semibold);
        }

        /* ── Help content ── */

        .help-content {
            display: flex;
            flex-direction: column;
            gap: var(--space-md);
            overflow-y: auto;
        }

        .help-section {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .help-section-title {
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
        }

        .help-section-text {
            font-size: var(--font-size-xs);
            color: var(--text-secondary);
            line-height: var(--line-height);
        }

        .help-code {
            font-family: var(--font-mono);
            font-size: 11px;
            background: var(--bg-hover);
            padding: 6px 8px;
            border-radius: var(--radius-sm);
            color: var(--text-primary);
            display: block;
        }

        .help-link {
            color: var(--accent);
            cursor: pointer;
            text-decoration: none;
        }

        .help-link:hover {
            text-decoration: underline;
        }

        .help-models {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .help-model {
            font-size: var(--font-size-xs);
            color: var(--text-secondary);
            display: flex;
            justify-content: space-between;
        }

        .help-model-name {
            font-family: var(--font-mono);
            font-size: 11px;
            color: var(--text-primary);
        }

        .help-divider {
            border: none;
            border-top: 1px solid var(--border);
            margin: 0;
        }

        .help-cloud-btn {
            background: #e8e8e8;
            color: #111111;
            border: none;
            padding: 10px var(--space-md);
            border-radius: var(--radius-sm);
            font-size: var(--font-size-sm);
            font-family: var(--font);
            font-weight: var(--font-weight-semibold);
            cursor: pointer;
            width: 100%;
            transition: opacity 0.15s;
        }

        .help-cloud-btn:hover {
            opacity: 0.9;
        }

        .help-warn {
            font-size: var(--font-size-xs);
            color: var(--warning);
            line-height: var(--line-height);
        }
    `;

    static properties = {
        unsavedSession: { type: Boolean },
        onRetrySave: { attribute: false },
        onStart: { type: Function },
        onExternalLink: { type: Function },
        selectedProfile: { type: String },
        onProfileChange: { type: Function },
        isInitializing: { type: Boolean },
        statusText: { type: String },
        startError: { type: String },
        whisperDownloading: { type: Boolean },
        downloadProgress: { type: Object },
        onCancelDownload: { type: Function },
        onCancelStart: { type: Function },
        onRetryWithoutSearch: { type: Function },
        providerError: { type: Object },
        searchState: { type: Object },
        lifecycleState: { type: String },
        retryBlocked: { type: Boolean },
        shortcut: { type: String },
        // Internal state
        _mode: { state: true },
        _token: { state: true },
        _geminiKey: { state: true },
        _groqKey: { state: true },
        _openaiKey: { state: true },
        _geminiLiveModel: { state: true },
        _groqModel: { state: true },
        _groqImageModel: { state: true },
        _disableGroqThinking: { state: true },
        _tokenError: { state: true },
        _keyError: { state: true },
        // Local AI state
        _localLlmModel: { state: true },
        _useCustomLocalLlmModel: { state: true },
        _whisperModel: { state: true },
        _showLocalHelp: { state: true },
    };

    constructor() {
        super();
        this.onStart = () => {};
        this.onExternalLink = () => {};
        this.selectedProfile = 'interview';
        this.onProfileChange = () => {};
        this.isInitializing = false;
        this.statusText = '';
        this.startError = '';
        this.whisperDownloading = false;
        this.downloadProgress = { active: false, label: '', percentage: null };
        this.onCancelDownload = () => {};

        this._mode = 'byok';
        this._token = '';
        this._geminiKey = '';
        this._groqKey = '';
        this._openaiKey = '';
        this._geminiLiveModel = 'gemini-3.1-flash-live-preview';
        this._groqModel = 'qwen/qwen3.6-27b';
        this._groqImageModel = 'qwen/qwen3.6-27b';
        this._disableGroqThinking = true;
        this._tokenError = false;
        this._keyError = false;
        this._showLocalHelp = false;
        this._localLlmModel = 'unsloth/Qwen3.5-4B-GGUF:Q4_K_M';
        this._useCustomLocalLlmModel = false;
        this._whisperModel = 'tiny.en';

        this._catalogEpochs = { gemini: 0, groq: 0 };
        this._catalogTimers = {};
        this._keySavePromise = Promise.resolve();
        this._geminiHttpModel = GEMINI_DEFAULTS.screen;
        this._groqTranscriptionModel = GROQ_DEFAULTS.transcription;

        this.boundKeydownHandler = this._handleKeydown.bind(this);
        this._loadFromStorage();
    }

    async _loadFromStorage() {
        try {
            const [config, prefs, creds] = await Promise.all([
                contextHalo.storage.getConfig(),
                contextHalo.storage.getPreferences(),
                contextHalo.storage.getCredentials().catch(() => ({})),
            ]);

            const storedMode = prefs.providerMode || 'byok';
            this._mode = storedMode === 'cloud' ? 'byok' : storedMode;

            if (storedMode === 'cloud') {
                await contextHalo.storage.updatePreference('providerMode', this._mode);
            }

            // Load keys
            this._token = creds.cloudToken || '';
            this._geminiKey = (await contextHalo.storage.getApiKey().catch(() => '')) || '';
            this._groqKey = (await contextHalo.storage.getGroqApiKey().catch(() => '')) || '';
            this._openaiKey = creds.openaiKey || '';
            this._geminiLiveModel = config.geminiLiveModel || GEMINI_DEFAULTS.live;
            this._geminiHttpModel = config.geminiHttpModel || GEMINI_DEFAULTS.screen;
            this._groqTranscriptionModel = config.groqTranscriptionModel || GROQ_DEFAULTS.transcription;
            this._groqModel = config.groqModel || 'qwen/qwen3.6-27b';
            this._groqImageModel = config.groqImageModel || 'qwen/qwen3.6-27b';
            this._disableGroqThinking = config.disableGroqThinking === true;

            // Load local AI settings
            this._localLlmModel = prefs.localLlmModel || 'unsloth/Qwen3.5-4B-GGUF:Q4_K_M';
            this._useCustomLocalLlmModel = !LOCAL_LLM_PRESETS.some(preset => preset.value === this._localLlmModel);
            this._whisperModel = prefs.whisperModel || 'tiny.en';
            if (this._geminiKey.trim()) void this._refreshProviderModels('gemini');
            if (this._groqKey.trim()) void this._refreshProviderModels('groq');

            this.requestUpdate();
        } catch (e) {
            console.error('Error loading MainView storage:', e);
        }
    }

    connectedCallback() {
        super.connectedCallback();
        this._contextChanged = () => this.requestUpdate();
        window.addEventListener('session-context-changed', this._contextChanged);
        window.addEventListener('realtime-context-changed', this._contextChanged);
        void loadContextState().catch(() => { this.startError = 'Session context could not be loaded.'; });
        document.addEventListener('keydown', this.boundKeydownHandler);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('session-context-changed', this._contextChanged);
        window.removeEventListener('realtime-context-changed', this._contextChanged);
        document.removeEventListener('keydown', this.boundKeydownHandler);
        for (const timer of Object.values(this._catalogTimers)) clearTimeout(timer);
        this._catalogEpochs.gemini++;
        this._catalogEpochs.groq++;
    }

    _handleKeydown(e) {
        if (e.key === 'Escape' && this._showLocalHelp) {
            this._closeLocalHelp();
            return;
        }


    }

    // ── Persistence ──

    _localAiSupported() {
        const { platform, arch } = window.process || {};
        return (platform === 'win32' && arch === 'x64') || (platform === 'darwin' && ['x64', 'arm64'].includes(arch));
    }

    async _saveMode(mode) {
        if (mode === 'local' && !this._localAiSupported()) {
            this.startError = `Local AI is unavailable on ${window.process?.platform}/${window.process?.arch}. Choose Gemini or Groq.`;
            return;
        }
        this._mode = mode;
        this._tokenError = false;
        this._keyError = false;
        await contextHalo.storage.updatePreference('providerMode', mode);
        this.requestUpdate();
    }

    async _saveToken(val) {
        this._token = val;
        this._tokenError = false;
        try {
            const creds = await contextHalo.storage.getCredentials().catch(() => ({}));
            await contextHalo.storage.setCredentials({ ...creds, cloudToken: val });
        } catch (e) {}
        this.requestUpdate();
    }

    _saveGeminiKey(value) { return this._saveProviderKey('gemini', value); }
    _saveGroqKey(value) { return this._saveProviderKey('groq', value); }

    _saveProviderKey(provider, value) {
        const gemini = provider === 'gemini';
        this[gemini ? '_geminiKey' : '_groqKey'] = value;
        this._keyError = false;
        this._catalogEpochs[provider]++;
        this[gemini ? '_geminiCatalogLoading' : '_groqCatalogLoading'] = false;
        clearTimeout(this._catalogTimers[provider]);
        // Serialize key writes; Start awaits the latest write. No key is logged.
        this._keySavePromise = this._keySavePromise.catch(() => {}).then(async () => {
            const result = await (gemini ? contextHalo.storage.setApiKey(value) : contextHalo.storage.setGroqApiKey(value));
            if (result?.success === false) throw new Error('Credential storage rejected the update.');
        }).then(() => {
            if (this[gemini ? '_geminiKey' : '_groqKey'] !== value) return;
            this._keyError = false;
            this.startError = '';
            if (value.trim().length >= 20) this._catalogTimers[provider] = setTimeout(() => this._refreshProviderModels(provider, true), 1200);
        }).catch(() => {
            if (this[gemini ? '_geminiKey' : '_groqKey'] !== value) return;
            this._keyError = true;
            this.startError = 'The key could not be saved securely. The entered value remains in this form; retry before starting.';
        });
        this.requestUpdate();
        return this._keySavePromise.finally(() => this.requestUpdate());
    }

    async _refreshProviderModels(provider, forceRefresh = false) {
        const gemini = provider === 'gemini';
        const loading = gemini ? '_geminiCatalogLoading' : '_groqCatalogLoading';
        const errorKey = gemini ? '_geminiCatalogError' : '_groqCatalogError';
        if (this[loading]) return;
        const epoch = ++this._catalogEpochs[provider];
        this[loading] = true;
        this[errorKey] = '';
        this.requestUpdate();
        try {
            await this._keySavePromise;
            const result = await window.electronAPI.invoke('provider-models:list', provider, forceRefresh === true);
            if (!this.isConnected || epoch !== this._catalogEpochs[provider]) return;
            if (!result?.success) throw new Error('Model discovery failed. Check the provider key or retry.');
            this[gemini ? '_geminiCatalog' : '_groqCatalog'] = result.data;
            const selected = gemini ? this._geminiLiveModel : this._groqModel;
            if (selected && !result.data?.all?.some(model => model.id === selected)) {
                this[errorKey] = 'The selected model is not in this catalog. Its manual ID is preserved; review the model or refresh.';
            }
            if (result.data?.stale) this[errorKey] = 'The provider catalog is cached. Saved and manual model IDs are preserved.';
        } catch {
            if (epoch === this._catalogEpochs[provider]) this[errorKey] = 'Model discovery is unavailable. Saved and manual model IDs remain usable.';
        } finally {
            if (epoch === this._catalogEpochs[provider]) { this[loading] = false; this.requestUpdate(); }
        }
    }

    async _saveGeminiHttpModel(value) {
        this._geminiHttpModel = value;
        await contextHalo.storage.updateConfig('geminiHttpModel', value);
        this.requestUpdate();
    }

    async _saveGroqTranscriptionModel(value) {
        this._groqTranscriptionModel = value;
        await contextHalo.storage.updateConfig('groqTranscriptionModel', value);
        this.requestUpdate();
    }

    async _saveGeminiLiveModel(val) {
        this._geminiLiveModel = val;
        await contextHalo.storage.updateConfig('geminiLiveModel', val);
        this.requestUpdate();
    }

    async _saveGroqModel(val) {
        this._groqModel = val;
        await contextHalo.storage.updateConfig('groqModel', val);
        this.requestUpdate();
    }

    async _saveGroqImageModel(val) {
        this._groqImageModel = val;
        await contextHalo.storage.updateConfig('groqImageModel', val);
        this.requestUpdate();
    }

    async _saveDisableGroqThinking(disabled) {
        this._disableGroqThinking = disabled;
        await contextHalo.storage.updateConfig('disableGroqThinking', disabled);
        this.requestUpdate();
    }

    async _saveOpenaiKey(val) {
        this._openaiKey = val;
        try {
            const creds = await contextHalo.storage.getCredentials().catch(() => ({}));
            await contextHalo.storage.setCredentials({ ...creds, openaiKey: val });
        } catch (e) {}
        this.requestUpdate();
    }

    async _saveLocalLlmModel(val) {
        this._localLlmModel = val;
        await contextHalo.storage.updatePreference('localLlmModel', val);
        this.requestUpdate();
    }

    async _selectLocalLlmModel(value) {
        if (value === 'custom') {
            this._useCustomLocalLlmModel = true;
            this.requestUpdate();
            return;
        }

        this._useCustomLocalLlmModel = false;
        await this._saveLocalLlmModel(value);
    }

    async _saveWhisperModel(val) {
        this._whisperModel = val;
        await contextHalo.storage.updatePreference('whisperModel', val);
        this.requestUpdate();
    }

    _handleProfileChange(e) {
        this.onProfileChange(e.target.value);
    }

    _openLocalHelp() {
        this._showLocalHelp = true;
    }

    _closeLocalHelp() {
        this._showLocalHelp = false;
    }

    _handleHelpDialogClick(e) {
        e.stopPropagation();
    }

    // ── Start ──

    async _handleStart() {
        if (this.isInitializing || this.downloadProgress.active || this.retryBlocked) return;
        await this._keySavePromise;
        if (this._keyError || this.isInitializing) return;

        if (this._mode === 'byok') {
            if (!this._geminiKey.trim()) {
                this._keyError = true;
                this.requestUpdate();
                return;
            }
        } else if (this._mode === 'groq' && !this._groqKey.trim()) {
            this._keyError = true;
            this.startError = 'Enter a Groq API key before starting.';
            return;
        } else if (this._mode === 'local') {
            if (!this._localAiSupported()) { this.startError = 'Local AI requires Windows x64 or supported macOS hardware.'; return; }
            if (!this._localLlmModel.trim()) {
                return;
            }
        }

        this.onStart();
    }

    triggerApiKeyError() {
        this._keyError = this._mode !== 'local';
        this.requestUpdate();
        setTimeout(() => {
            this._tokenError = false;
            this._keyError = false;
            this.requestUpdate();
        }, 2000);
    }

    // ── Render helpers ──

    _renderProfileSelector() {
        const profiles = [
            ['interview', 'Job Interview'],
            ['sales', 'Sales Call'],
            ['meeting', 'Business Meeting'],
            ['presentation', 'Presentation'],
            ['negotiation', 'Negotiation'],
            ['exam', 'Exam Assistant'],
        ];
        return html`
            <details class="config-section" open>
                <summary class="config-summary">
                    <span class="config-summary-text">
                        <span class="config-summary-title">Session</span>
                        <span class="config-summary-description">Choose how ContextHalo should assist you</span>
                    </span>
                    ${this._renderConfigChevron()}
                </summary>
                <div class="config-content">
                    <div class="form-group">
                        <label class="form-label">Session Profile</label>
                        <select .value=${this.selectedProfile} @change=${event => this.onProfileChange(event.target.value)}>
                            ${profiles.map(([value, label]) => html`<option value=${value}>${label}</option>`)}
                        </select>
                        <div class="form-hint">The profile changes the live system prompt for the session.</div>
                    </div>
                </div>
            </details>
        `;
    }

    _renderSessionStatus() {
        const error = String(this.startError || '').trim();
        const text = error || (this.isInitializing ? (this.statusText || 'Starting session…') : '');
        if (!text) return '';
        return html`
            <div class="session-status ${error ? 'error' : ''}" role=${error ? 'alert' : 'status'}>
                <span class="session-status-dot"></span>
                <span>${text}</span>
                ${this.isInitializing ? html`<button type="button" class="download-cancel" @click=${() => this.onCancelStart?.()}>Cancel start</button>` : ''}
                ${error && this.searchState?.effective && this.providerError?.canDisableSearch ? html`<button type="button" class="download-cancel" ?disabled=${this.retryBlocked} @click=${() => this.onRetryWithoutSearch?.()}>Continue without Search</button>` : ''}
            </div>
        `;
    }

    async _contextAction(action) {
        try { await action(); } catch { this.startError = 'The setting could not be saved. Your current draft is retained.'; }
    }

    renderPreparation() {
        const { sessionPack: pack, captureState, captureSources, error } = getContextState();
        const { responseMode } = getRealtimeState();
        return html`<details class="preparation"><summary>Screen, context &amp; response style</summary>
            <label for="responseMode">Response style (applied next session)</label>
            <select id="responseMode" .value=${responseMode} @change=${event => this._contextAction(() => setResponseMode(event.target.value))}>
                ${RESPONSE_MODES.map(mode => html`<option value=${mode.id}>${mode.label} - ${mode.description}</option>`)}
            </select>
            <label for="captureSource">Screen or window to analyze</label>
            <select id="captureSource" .value=${selectionKey(captureState)} @change=${event => this._contextAction(() => setCaptureSource(event.target.value))}>
                ${captureSources.map(source => html`<option value=${source.key}>${source.label}</option>`)}
            </select>
            <div class="preparation-actions"><button type="button" @click=${() => this._contextAction(refreshCaptureSources)}>Refresh screens</button></div>
            <label for="contextTitle">Session title</label><input id="contextTitle" maxlength="160" .value=${pack.title} @input=${event => setPackField('title', event.target.value)} />
            <label for="contextGoal">Goal</label><input id="contextGoal" maxlength="1600" .value=${pack.goal} @input=${event => setPackField('goal', event.target.value)} />
            <label for="contextNotes">Context notes</label><textarea id="contextNotes" maxlength="6000" .value=${pack.notes} @input=${event => setPackField('notes', event.target.value)}></textarea>
            <div class="preparation-actions"><button type="button" @click=${() => this._contextAction(captureClipboardText)}>Add clipboard text</button>
                <button type="button" ?disabled=${!pack.clipboardText} @click=${() => this._contextAction(clearClipboardContext)}>Clear clipboard context</button>
                <span>${pack.clipboardText ? `${pack.clipboardText.length} characters included` : 'Clipboard is not included'}</span></div>
            ${error ? html`<p role="alert">${error}</p>` : ''}
        </details>`;
    }

    _renderStartButton() {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const isDownloading = this._mode === 'local' && this.downloadProgress.active;
        const percentage = this.downloadProgress.percentage;
        const hasPercentage = Number.isFinite(percentage);

        const cmdIcon = html`<svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path
                d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"
            />
        </svg>`;
        const ctrlIcon = html`<svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M6 15l6-6 6 6" />
        </svg>`;
        const enterIcon = html`<svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M9 10l-5 5 5 5" />
            <path d="M20 4v7a4 4 0 0 1-4 4H4" />
        </svg>`;

        return html`
            <button
                class="start-button ${this.isInitializing || isDownloading ? 'disabled' : ''}"
                ?disabled=${this.isInitializing || isDownloading || this.retryBlocked}
                @click=${() => this._handleStart()}
            >
                <canvas class="btn-aurora"></canvas>
                <canvas class="btn-dither"></canvas>
                ${
                    isDownloading
                        ? html`<span
                              class="download-progress-fill ${hasPercentage ? '' : 'indeterminate'}"
                              style=${hasPercentage ? `width: ${percentage}%` : ''}
                          ></span>`
                        : ''
                }
                <span class="btn-label">
                    ${isDownloading ? (hasPercentage ? `${percentage}%` : 'Preparing...') : this.isInitializing ? 'Starting…' : 'Start Session'}
                    ${isDownloading ? '' : html`<span class="shortcut-hint">${isMac ? cmdIcon : ctrlIcon}${enterIcon}</span>`}
                </span>
            </button>
            ${
                isDownloading
                    ? html`
                          <div class="download-controls">
                              <span>Downloading: ${this.downloadProgress.label || 'Local AI files'}</span>
                              <button class="download-cancel" @click=${() => this.onCancelDownload()}>Cancel</button>
                          </div>
                      `
                    : ''
            }
        `;
    }

    _renderDivider() {
        return html`
            <div class="divider">
                <div class="divider-line"></div>
                <span class="divider-text">or</span>
                <div class="divider-line"></div>
            </div>
        `;
    }

    // ── Cloud mode ──
    // Cloud UI intentionally disabled. Backend cloud wiring is still present in
    // the codebase, but the renderer no longer exposes this setup path.

    // ── BYOK mode ──

    _renderConfigChevron() {
        return html`
            <svg class="config-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
        `;
    }

    _renderByokMode() { return this._renderHostedProvider('gemini'); }
    _renderGroqMode() { return this._renderHostedProvider('groq'); }

    _renderHostedProvider(provider) {
        const gemini = provider === 'gemini';
        const label = gemini ? 'Gemini' : 'Groq';
        const catalog = gemini ? this._geminiCatalog : this._groqCatalog;
        const all = catalog?.all || [];
        const fields = gemini ? [
            { label: 'Gemini Live Model', value: this._geminiLiveModel, preferred: catalog?.live, all: catalog?.live || [],
                allowAdvanced: false, onSave: this._saveGeminiLiveModel, helper: 'Live audio requires bidiGenerateContent support. Search depends on the model and project.' },
            { label: 'Text / Screen Analysis Model', value: this._geminiHttpModel, preferred: catalog?.screen, all,
                onSave: this._saveGeminiHttpModel, helper: 'Text and screenshots share this model. Advanced choices may not support every input or tool.' },
        ] : [
            { label: 'Text / Reasoning Model', value: this._groqModel, preferred: catalog?.chat, all, onSave: this._saveGroqModel },
            { label: 'Screenshot / Vision Model', value: this._groqImageModel, preferred: catalog?.vision, all, onSave: this._saveGroqImageModel,
                helper: 'The advanced list may include models without image input. Saved manual IDs are preserved.' },
            { label: 'Audio Transcription Model', value: this._groqTranscriptionModel, preferred: catalog?.transcription,
                all: catalog?.transcription || [], allowAdvanced: false, onSave: this._saveGroqTranscriptionModel },
        ];
        const loading = gemini ? this._geminiCatalogLoading : this._groqCatalogLoading;
        const error = gemini ? this._geminiCatalogError : this._groqCatalogError;
        return html`
            <details class="config-section" open>
                <summary class="config-summary"><span class="config-summary-text">
                    <span class="config-summary-title">${label}</span>
                    <span class="config-summary-description">${gemini ? 'Live audio, typed answers and screen analysis' : 'Transcription, reasoning and vision'}</span>
                </span>${this._renderConfigChevron()}</summary>
                <div class="config-content">
                    <div class="form-group">
                        <label class="form-label" for="provider-api-key">${label} API Key</label>
                        <input id="provider-api-key" type="password" autocomplete="off" spellcheck="false"
                            placeholder="Required" .value=${gemini ? this._geminiKey : this._groqKey}
                            @input=${event => this._saveProviderKey(provider, event.target.value)}
                            aria-invalid=${this._keyError ? 'true' : 'false'} class=${this._keyError ? 'error' : ''} />
                        <div class="form-hint">
                            <button type="button" class="mode-link" @click=${() => this.onExternalLink(gemini ? 'https://aistudio.google.com/apikey' : 'https://console.groq.com/keys')}>Get ${label} key</button>
                            <button type="button" class="mode-link" ?disabled=${loading} @click=${() => this._refreshProviderModels(provider, true)}>${loading ? 'Loading models...' : 'Refresh models'}</button>
                        </div>
                        ${error ? html`<div class="config-note" role="status">${error}</div>` : ''}
                    </div>
                    ${fields.map(field => renderModelPicker(this, field))}
                    <div class="config-note">${gemini ? 'Search preferences apply to the next session. Live, typed and screen requests share its effective Search setting.' : 'Google Search is not available in Groq mode. Its saved preference is retained for Gemini.'}</div>
                </div>
            </details>
            ${this.renderPreparation()} ${this._renderStartButton()} ${this._renderDivider()}
            <div class="mode-links">
                <button class="mode-link" @click=${() => this._saveMode(gemini ? 'groq' : 'byok')}>Use ${gemini ? 'Groq' : 'Gemini'} API</button>
                <button class="mode-link" @click=${() => this._saveMode('local')}>Use local AI</button>
            </div>
        `;
    }

    _renderLocalMode() {
        return html`
            <details class="config-section">
                <summary class="config-summary">
                    <span class="config-summary-text">
                        <span class="config-summary-title">Language model</span>
                        <span class="config-summary-description">Local GGUF model</span>
                    </span>
                    ${this._renderConfigChevron()}
                </summary>
                <div class="config-content">
                    <div class="form-group">
                        <label class="form-label">Model</label>
                        <select
                            .value=${this._useCustomLocalLlmModel ? 'custom' : this._localLlmModel}
                            @change=${event => this._selectLocalLlmModel(event.target.value)}
                        >
                            ${LOCAL_LLM_PRESETS.map(preset => html`<option value=${preset.value}>${preset.label}</option>`)}
                            <option value="custom">Custom Hugging Face model or local GGUF…</option>
                        </select>
                        ${
                            this._useCustomLocalLlmModel
                                ? html`
                                      <input
                                          type="text"
                                          placeholder="owner/repository:quant or /absolute/model.gguf"
                                          .value=${this._localLlmModel}
                                          @input=${event => this._saveLocalLlmModel(event.target.value)}
                                      />
                                  `
                                : ''
                        }
                        <div class="form-hint">Sizes include the vision model. Q4 uses less memory; Q8 preserves more quality.</div>
                    </div>
                </div>
            </details>

            <details class="config-section">
                <summary class="config-summary">
                    <span class="config-summary-text">
                        <span class="config-summary-title">Transcription</span>
                        <span class="config-summary-description">Whisper speech-to-text model</span>
                    </span>
                    ${this._renderConfigChevron()}
                </summary>
                <div class="config-content">
                    <div class="form-group">
                        <div class="whisper-label-row">
                            <label class="form-label">Whisper Model</label>
                            ${this.whisperDownloading ? html`<div class="whisper-spinner"></div>` : ''}
                        </div>
                        <select .value=${this._whisperModel} @change=${e => this._saveWhisperModel(e.target.value)}>
                            <option value="tiny.en" ?selected=${this._whisperModel === 'tiny.en'}>Tiny English (75 MB, fastest)</option>
                            <option value="base.en" ?selected=${this._whisperModel === 'base.en'}>Base English (142 MB)</option>
                            <option value="small.en" ?selected=${this._whisperModel === 'small.en'}>Small English (466 MB, most accurate)</option>
                        </select>
                        <div class="form-hint">${this.whisperDownloading ? 'Downloading model...' : 'Downloaded automatically on first use'}</div>
                    </div>
                </div>
            </details>

            ${this.renderPreparation()} ${this._renderStartButton()} ${this._renderDivider()}

            <!-- Cloud promo intentionally removed from the active UI. -->

            <div class="mode-links">
                <button class="mode-link" @click=${() => this._saveMode('byok')}>Use Gemini API</button>
                <button class="mode-link" @click=${() => this._saveMode('groq')}>Use Groq API</button>
            </div>
        `;
    }

    // ── Main render ──

    render() {
        const helpIcon = html`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                <path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0m9 5v.01" />
                <path d="M12 13.5a1.5 1.5 0 0 1 1-1.5a2.6 2.6 0 1 0-3-4" />
            </g>
        </svg>`;
        const closeIcon = html`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6L6 18M6 6l12 12" />
        </svg>`;

        return html`
            <div class="form-wrapper">
                ${
                    this._mode === 'local'
                        ? html`
                              <div class="title-row">
                                  <div class="page-title">ContextHalo <span class="mode-suffix">Local AI</span></div>
                                  <button class="help-btn" @click=${this._openLocalHelp} aria-label="Open Local AI help">${helpIcon}</button>
                              </div>
                          `
                        : html` <div class="page-title">${html`ContextHalo <span class="mode-suffix">${this._mode === 'groq' ? 'Groq API' : 'Gemini API'}</span>`}</div> `
                }
                <div class="page-subtitle">${this._mode === 'local' ? 'Run models locally on your machine' : 'Choose your provider and prepare a session'}</div>
                ${this._renderProfileSelector()}
                ${this._renderSessionStatus()}
                ${this.unsavedSession ? html`<button type="button" @click=${this.onRetrySave}>Retry saving final transcript</button>` : ''}

                <!-- Cloud mode render branch intentionally disabled. -->
                ${this._mode === 'byok' ? this._renderByokMode() : this._mode === 'groq' ? this._renderGroqMode() : this._renderLocalMode()}
            </div>
            ${this._mode === 'local' && this._showLocalHelp ? this._renderLocalHelp(closeIcon) : ''}
        `;
    }

    _renderLocalHelp(closeIcon) {
        return html`
            <div class="help-dialog-backdrop" @click=${this._closeLocalHelp}>
                <section class="help-dialog" role="dialog" aria-modal="true" aria-labelledby="local-help-title" @click=${this._handleHelpDialogClick}>
                    <div class="help-dialog-header">
                        <div id="local-help-title" class="help-dialog-title">Local AI setup</div>
                        <button class="help-btn" @click=${this._closeLocalHelp} aria-label="Close Local AI help">${closeIcon}</button>
                    </div>

                    <div class="help-content">
                        <div class="help-section">
                            <div class="help-section-title">Native local AI</div>
                            <div class="help-section-text">
                                ContextHalo runs llama.cpp and whisper.cpp directly. Everything stays on your computer — no external AI service or
                                Ollama installation is required.
                            </div>
                        </div>

                        <div class="help-section">
                            <div class="help-section-title">Automatic setup</div>
                            <div class="help-section-text">
                                The correct native runners, selected Whisper model, and language model are downloaded and checksum-verified on first
                                use. They are stored in the ContextHalo config directory.
                            </div>
                        </div>

                        <div class="help-section">
                            <div class="help-section-title">Default model</div>
                            <div class="help-models">
                                <div class="help-model">
                                    <span class="help-model-name">Qwen3.5 4B Q4_K_M</span><span>About 2.7 GB — balanced local quality and speed</span>
                                </div>
                            </div>
                        </div>

                        <div class="help-section">
                            <div class="help-section-title">Whisper</div>
                            <div class="help-section-text">
                                The selected whisper.cpp model is downloaded automatically once and kept in the config directory.
                            </div>
                        </div>

                        <hr class="help-divider" />

                        <div class="help-section">
                            <div class="help-section-title">Computer hanging or slow?</div>
                            <div class="help-section-text">
                                Running models locally uses a lot of RAM and CPU. If your computer slows down or freezes, it's likely the LLM. Switch
                                back to BYOK mode if you want to use a hosted provider instead.
                            </div>
                        </div>

                        <button
                            class="help-cloud-btn"
                            @click=${() => {
                                this._closeLocalHelp();
                                this._saveMode('byok');
                            }}
                        >
                            Switch to BYOK
                        </button>
                    </div>
                </section>
            </div>
        `;
    }
}

customElements.define('main-view', MainView);
