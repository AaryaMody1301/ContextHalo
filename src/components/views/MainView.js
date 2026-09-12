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
            appearance: auto;
            color-scheme: var(--control-color-scheme, dark);
            background-position: right 8px center;
            background-repeat: no-repeat;
            background-size: 14px;
            padding-right: 28px;
        }

        select option,
        select optgroup {
            background: var(--bg-elevated);
            color: var(--text-primary);
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
            font-size: 13px;
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
            font-size: 13px;
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
        .launch-card { padding:20px; border:1px solid var(--border-strong); border-radius:12px; background:var(--bg-surface); display:grid; gap:12px; }
        .launch-heading { display:flex; justify-content:space-between; align-items:center; gap:20px; }
        .launch-heading h2 { font-size:20px; line-height:1.35; margin:0; color:var(--text-primary); }
        .primary-action { flex-shrink:0; min-width:172px; text-align:center; }
        .start-button { background:var(--accent); color:var(--bg-app); min-height:44px; }
        .readiness, .launch-summary { margin:0; font-size:14px; line-height:1.6; color:var(--text-secondary); }
        .setup-choices { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
        .provider-fields { border:0; padding:0; margin:0; min-width:0; }
        .key-actions { display:flex; flex-wrap:wrap; align-items:center; gap:12px 24px; margin-top:12px; }
        .key-actions button { min-height:32px; padding:6px 10px; border:1px solid var(--border); border-radius:6px; }
        .advanced-models { padding:12px 0; }
        .advanced-models > summary { cursor:pointer; padding:8px 0; font-size:14px; font-weight:600; }
        .advanced-models .form-group { margin-top:16px; }
        button, summary, a { cursor:pointer; }
        :focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
        input, textarea { cursor:text; user-select:text; }
        .session-status { flex-wrap:wrap; max-height:none; overflow:visible; }
        .session-status > span:not(.session-status-dot) { flex:1 1 250px; overflow-wrap:anywhere; }
        .help-dialog:not([open]) { display:none; }
        .help-dialog::backdrop { background:rgb(0 0 0 / .4); }
        .help-dialog { max-height:calc(100vh - 32px); max-width:calc(100vw - 32px); }
        @media (max-width:800px) {
            :host { padding:48px 20px 28px; }
            .launch-card { padding:16px; }
            .launch-heading { flex-wrap:wrap; gap:12px; }
            .setup-choices { grid-template-columns:1fr; gap:16px; }
        }
        @media (prefers-reduced-motion:reduce) { *, *::before, *::after { animation:none !important; transition:none !important; } }
    `;

    static properties = {
        unsavedSession: { type: Boolean }, sessionActive: { type: Boolean },
        onOpenSettings: { type: Function },
        _configurationLoading: { state: true }, _setupOpen: { state: true },
        _saveState: { state: true }, _saveError: { state: true },
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
        _savedKeys: { state: true },
        _geminiKey: { state: true },
        _groqKey: { state: true },
        _geminiLiveModel: { state: true },
        _groqModel: { state: true },
        _groqImageModel: { state: true },
        _disableGroqThinking: { state: true },
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
        this.onOpenSettings = () => {};
        this.sessionActive = false;
        this._configurationLoading = true;
        this._setupOpen = true;
        this._saveState = '';
        this._saveError = '';
        this._configurationWrites = Promise.resolve();
        this._configurationVersion = 0;
        this._failedConfigurationWrites = new Map();
        this._audioMode = 'speaker_only';
        this._searchRequested = false;
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
        this._savedKeys = { gemini: false, groq: false };
        this._geminiKey = '';
        this._groqKey = '';
        this._geminiLiveModel = 'gemini-3.1-flash-live-preview';
        this._groqModel = GROQ_DEFAULTS.chat;
        this._groqImageModel = 'qwen/qwen3.6-27b';
        this._disableGroqThinking = true;
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
            const [config, prefs, credentialStatus] = await Promise.all([
                contextHalo.storage.getConfig(),
                contextHalo.storage.getPreferences(),
                contextHalo.storage.getCredentialStatus(),
            ]);

            this._audioMode = prefs.audioMode || 'speaker_only';
            this._searchRequested = prefs.googleSearchEnabled === true;
            const storedMode = prefs.providerMode || 'byok';
            this._mode = storedMode === 'cloud' ? 'byok' : storedMode;

            if (storedMode === 'cloud') {
                await contextHalo.storage.updatePreference('providerMode', this._mode);
            }

            this._savedKeys = { gemini: credentialStatus.gemini === true, groq: credentialStatus.groq === true };
            this._geminiLiveModel = config.geminiLiveModel || GEMINI_DEFAULTS.live;
            this._geminiHttpModel = config.geminiHttpModel || GEMINI_DEFAULTS.screen;
            this._groqTranscriptionModel = config.groqTranscriptionModel || GROQ_DEFAULTS.transcription;
            this._groqModel = config.groqModel || GROQ_DEFAULTS.chat;
            this._groqImageModel = config.groqImageModel || GROQ_DEFAULTS.vision;
            this._disableGroqThinking = config.disableGroqThinking === true;

            // Load local AI settings
            this._localLlmModel = prefs.localLlmModel || 'unsloth/Qwen3.5-4B-GGUF:Q4_K_M';
            this._useCustomLocalLlmModel = !LOCAL_LLM_PRESETS.some(preset => preset.value === this._localLlmModel);
            this._whisperModel = prefs.whisperModel || 'tiny.en';
            if (this._savedKeys?.gemini) void this._refreshProviderModels('gemini');
            if (this._savedKeys?.groq) void this._refreshProviderModels('groq');

            this._setupOpen = !this._hasConfiguredProvider();
            this.requestUpdate();
        } catch {
            this._saveError = 'Configuration could not be loaded. Retry loading before starting.';
        } finally { this._configurationLoading = false; }
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
        this.shadowRoot.querySelector('.help-dialog')?.close();
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
        if (this.sessionActive || this.isInitializing || !['byok', 'groq', 'local'].includes(mode)) return;
        if (mode === 'local' && !this._localAiSupported()) {
            this.startError = 'Local AI is unavailable on this platform. Choose Gemini or Groq.';
            return;
        }
        this._mode = mode;
        this._keyError = false;
        this._setupOpen = !this._hasConfiguredProvider();
        return this._persistConfiguration('preference', 'providerMode', mode);
    }

    _persistConfiguration(kind, key, value) {
        const version = ++this._configurationVersion;
        this._saveState = 'saving';
        this._saveError = '';
        const write = () => kind === 'profile' ? this.onProfileChange(value)
            : kind === 'config' ? contextHalo.storage.updateConfig(key, value) : contextHalo.storage.updatePreference(key, value);
        const pending = this._configurationWrites.catch(() => {}).then(async () => {
            try {
                const result = await write();
                if (result?.success === false) throw new Error('Write failed');
                this._failedConfigurationWrites.delete(key);
                return true;
            } catch {
                this._failedConfigurationWrites.set(key, { kind, key, value });
                return false;
            } finally {
                if (version === this._configurationVersion) {
                    this._saveState = this._failedConfigurationWrites.size ? 'failed' : 'saved';
                    this._saveError = this._failedConfigurationWrites.size ? 'Configuration changes were not saved. Your edits are retained; retry before starting.' : '';
                }
            }
        });
        this._configurationWrites = pending;
        return pending;
    }

    _retryConfiguration() {
        if (this._failedConfigurationWrites.size) return Promise.all([...this._failedConfigurationWrites.values()].map(({ kind, key, value }) => this._persistConfiguration(kind, key, value)));
        this._configurationLoading = true;
        return this._loadFromStorage();
    }

    _saveGeminiKey(value) { return this._saveProviderKey('gemini', value); }
    _saveGroqKey(value) { return this._saveProviderKey('groq', value); }

    _saveProviderKey(provider, value) {
        if (this.sessionActive || this.isInitializing) return Promise.resolve();
        this._keyDraftDirty = false;
        value = String(value || '').trim();
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
            this._savedKeys = { ...this._savedKeys, [provider]: Boolean(value) };
            this[gemini ? '_geminiKey' : '_groqKey'] = '';
            this._keyError = false;
            this.startError = '';
            if (value.length >= 20) this._catalogTimers[provider] = setTimeout(() => this._refreshProviderModels(provider, true), 1200);
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

    _saveGeminiHttpModel(value) {
        this._geminiHttpModel = value;
        this.requestUpdate();
        return this._persistConfiguration('config', 'geminiHttpModel', value);
    }

    _saveGroqTranscriptionModel(value) {
        this._groqTranscriptionModel = value;
        this.requestUpdate();
        return this._persistConfiguration('config', 'groqTranscriptionModel', value);
    }

    _saveGeminiLiveModel(value) {
        this._geminiLiveModel = value;
        this.requestUpdate();
        return this._persistConfiguration('config', 'geminiLiveModel', value);
    }

    _saveGroqModel(value) {
        this._groqModel = value;
        this.requestUpdate();
        return this._persistConfiguration('config', 'groqModel', value);
    }

    _saveGroqImageModel(value) {
        this._groqImageModel = value;
        this.requestUpdate();
        return this._persistConfiguration('config', 'groqImageModel', value);
    }

    _saveDisableGroqThinking(value) {
        this._disableGroqThinking = value;
        this.requestUpdate();
        return this._persistConfiguration('config', 'disableGroqThinking', value);
    }

    _saveLocalLlmModel(value) {
        this._localLlmModel = value;
        this.requestUpdate();
        return this._persistConfiguration('preference', 'localLlmModel', value);
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

    _saveWhisperModel(value) {
        this._whisperModel = value;
        this.requestUpdate();
        return this._persistConfiguration('preference', 'whisperModel', value);
    }

    _handleProfileChange(e) {
        this.selectedProfile = e.target.value;
        return this._persistConfiguration('profile', 'selectedProfile', this.selectedProfile);
    }

    async _openLocalHelp() {
        this._showLocalHelp = true;
        await this.updateComplete;
        const dialog = this.shadowRoot.querySelector('.help-dialog');
        if (this.isConnected && dialog && !dialog.open) dialog.showModal();
    }

    _closeLocalHelp() {
        this.shadowRoot.querySelector('.help-dialog')?.close();
        this._showLocalHelp = false;
    }

    // ── Start ──

    async _handleStart() {
        if (this.sessionActive) return this.onStart();
        if (this._configurationLoading || this.isInitializing || this.downloadProgress.active || this.retryBlocked) return;
        const draft = this._mode === 'groq' ? this._groqKey : this._geminiKey;
        if (this._mode !== 'local' && this._keyDraftDirty && !this._keyError && draft.trim()) await this._saveProviderKey(this._mode === 'groq' ? 'groq' : 'gemini', draft);
        await Promise.all([this._keySavePromise, this._configurationWrites]);
        if (this._saveError || this._keyError || this.isInitializing) { this._setupOpen = true; return; }
        if (!this._hasConfiguredProvider()) {
            this.startError = this._mode === 'local' ? 'Choose a local language model and transcription model before starting.' : `Enter a ${this._mode === 'groq' ? 'Groq' : 'Gemini'} API key and review model settings before starting.`;
            this._setupOpen = true;
            this._keyError = this._mode !== 'local';
            await this.updateComplete;
            this.shadowRoot.querySelector('#provider-api-key')?.focus();
            return;
        }
        if (this._mode === 'local' && !this._localAiSupported()) { this.startError = 'Local AI is unavailable on this platform.'; return; }
        return this.onStart();
    }

    _hasConfiguredProvider() {
        if (this._mode === 'local') return Boolean(this._localLlmModel.trim() && this._whisperModel.trim());
        return this._mode === 'groq' ? Boolean((this._savedKeys?.groq || this._groqKey.trim()) && this._groqModel.trim() && this._groqImageModel.trim() && this._groqTranscriptionModel.trim())
            : Boolean((this._savedKeys?.gemini || this._geminiKey.trim()) && this._geminiLiveModel.trim() && this._geminiHttpModel.trim());
    }

    _readinessSummary() {
        if (this.sessionActive) return 'A session is active. Return to your answer workspace; capture is unchanged.';
        if (this._configurationLoading) return 'Loading your saved configuration...';
        if (this._saveState === 'saving') return 'Saving configuration. Start will wait for it to finish.';
        if (this._saveError || this._keyError) return 'Resolve the unsaved configuration below before starting.';
        if (!this._hasConfiguredProvider()) return 'First-time setup: add a provider key below, or choose Local AI.';
        return this._mode === 'local' ? 'Local setup selected. Runners and models are checked on start; first use may require downloads.'
            : 'Provider settings saved locally. Credentials and model access are checked when connecting, not verified by this summary.';
    }

    _renderLaunch() {
        const provider = { byok: 'Gemini', groq: 'Groq', local: 'Local AI' }[this._mode] || 'Provider';
        const audio = { speaker_only: 'Speaker audio', mic_only: 'Microphone', both: 'Microphone and speaker audio' }[this._audioMode] || 'Audio input';
        const { captureState } = getContextState();
        return html`<section class="launch-card" aria-label="Start or return to session">
            <div class="launch-heading"><h2>${this.sessionActive ? 'Your session is running' : 'Ready for your next conversation?'}</h2>${this._renderStartButton()}</div>
            <p class="readiness" role="status">${this._readinessSummary()}</p>
            <p class="launch-summary">${provider} · ${this.selectedProfile} · ${audio}<br />
                ${captureState?.label || 'Display hosting ContextHalo'} · ${this._mode !== 'byok' ? 'Search is not supported by this provider' : this._searchRequested ? 'Google Search requested for the next session' : 'Google Search off'}</p>
            <button type="button" class="mode-link" @click=${this.onOpenSettings}>Change audio, appearance or Search in Settings</button>
        </section>`;
    }

    triggerApiKeyError() {
        this._keyError = this._mode !== 'local';
        this.requestUpdate();
        setTimeout(() => {
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
        return html`<div class="form-group profile-choice">
            <label class="form-label" for="session-profile">Session profile</label>
            <select id="session-profile" .value=${this.selectedProfile} ?disabled=${this.sessionActive || this.isInitializing || this._configurationLoading} @change=${this._handleProfileChange}>
                ${profiles.map(([value, label]) => html`<option value=${value}>${label}</option>`)}
            </select>
            <span class="form-hint">Applied when the next session connects.</span>
        </div>`;
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
        const downloading = this._mode === 'local' && this.downloadProgress.active;
        return html`<div class="primary-action">
            <button type="button" class="start-button" aria-describedby="start-shortcut"
                ?disabled=${!this.sessionActive && (this._configurationLoading || this.isInitializing || downloading || this.retryBlocked)}
                @click=${this._handleStart}>${this.sessionActive ? 'Return to Session' : downloading ? 'Preparing local AI...' : this.isInitializing ? 'Starting...' : 'Start Session'}</button>
            <span id="start-shortcut" class="form-hint">${this.shortcut || 'Ctrl+Enter'}</span>
            ${downloading ? html`<div class="download-controls"><span>${this.downloadProgress.label || 'Downloading local AI files'}${Number.isFinite(this.downloadProgress.percentage) ? `: ${this.downloadProgress.percentage}%` : ''}</span>
                <button type="button" class="download-cancel" @click=${this.onCancelDownload}>Cancel download</button></div>` : ''}
        </div>`;
    }

    // ── Cloud mode ──
    // Supported providers share one setup editor.
    // the codebase, but the renderer no longer exposes this setup path.

    // ── BYOK mode ──

    _renderConfigChevron() {
        return html`
            <svg class="config-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
        `;
    }


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
            <details class="config-section provider-setup" .open=${this._setupOpen} @toggle=${event => { this._setupOpen = event.target.open; }}>
                <summary class="config-summary"><span class="config-summary-text">
                    <span class="config-summary-title">${label}</span>
                    <span class="config-summary-description">${gemini ? 'Live audio, typed answers and screen analysis' : 'Transcription, reasoning and vision'}</span>
                </span>${this._renderConfigChevron()}</summary>
                <div class="config-content">
                    <div class="form-group">
                        <label class="form-label" for="provider-api-key">${label} API Key</label>
                        <input id="provider-api-key" type="password" autocomplete="off" spellcheck="false"
                            placeholder=${this._savedKeys[provider] ? 'Key saved securely; enter a replacement' : 'Required'} .value=${gemini ? this._geminiKey : this._groqKey}
                            ?disabled=${this.sessionActive || this.isInitializing}
                            @input=${event => { this._keyDraftDirty = true; this._keyError = false; this[gemini ? '_geminiKey' : '_groqKey'] = event.target.value; }}
                            @change=${event => { if (event.target.value.trim()) void this._saveProviderKey(provider, event.target.value); }}
                            aria-invalid=${this._keyError ? 'true' : 'false'} class=${this._keyError ? 'error' : ''} />
                        <div class="key-actions">
                            <button type="button" class="mode-link" ?disabled=${this.sessionActive || this.isInitializing || !(gemini ? this._geminiKey : this._groqKey).trim()}
                                @click=${() => this._saveProviderKey(provider, gemini ? this._geminiKey : this._groqKey)}>Save key</button>
                            <button type="button" class="mode-link" ?disabled=${this.sessionActive || this.isInitializing || !this._savedKeys[provider]}
                                @click=${() => this._saveProviderKey(provider, '')}>Remove saved key</button>
                            <button type="button" class="mode-link" @click=${() => this.onExternalLink(gemini ? 'https://aistudio.google.com/apikey' : 'https://console.groq.com/keys')}>Open ${label} key settings</button>
                            <button type="button" class="mode-link" ?disabled=${loading} @click=${() => this._refreshProviderModels(provider, true)}>${loading ? 'Loading models...' : 'Refresh available models'}</button>
                        </div>
                        ${error ? html`<div class="config-note" role="status">${error}</div>` : ''}
                    </div>
                    <details class="advanced-models"><summary>Advanced: model selection and capabilities</summary>
                        ${fields.map(field => renderModelPicker(this, field))}
                    </details>
                    <div class="config-note">${gemini ? 'Search preferences apply to the next session. Live, typed and screen requests share its effective Search setting.' : 'Google Search is not available in Groq mode. Its saved preference is retained for Gemini.'}</div>
                </div>
            </details>

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
                        <label class="form-label" for="local-model">Model</label>
                        <select id="local-model"
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
                                          type="text" aria-label="Custom local model path or repository"
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
                            <label class="form-label" for="whisper-model">Whisper model</label>
                            ${this.whisperDownloading ? html`<div class="whisper-spinner"></div>` : ''}
                        </div>
                        <select id="whisper-model" .value=${this._whisperModel} @change=${e => this._saveWhisperModel(e.target.value)}>
                            <option value="tiny.en" ?selected=${this._whisperModel === 'tiny.en'}>Tiny English (75 MB, fastest)</option>
                            <option value="base.en" ?selected=${this._whisperModel === 'base.en'}>Base English (142 MB)</option>
                            <option value="small.en" ?selected=${this._whisperModel === 'small.en'}>Small English (466 MB, most accurate)</option>
                        </select>
                        <div class="form-hint">${this.whisperDownloading ? 'Downloading model...' : 'Downloaded automatically on first use'}</div>
                    </div>
                </div>
            </details>



            <!-- Cloud promo intentionally removed from the active UI. -->

        `;
    }

    // ── Main render ──

    render() {
        return html`<div class="form-wrapper">
            <h1 class="page-title">ContextHalo</h1>
            ${this._renderLaunch()}
            ${this._renderSessionStatus()}
            ${this.unsavedSession ? html`<button type="button" @click=${this.onRetrySave}>Retry saving final transcript</button>` : ''}
            ${this._saveError ? html`<div class="session-status error" role="alert"><span>${this._saveError}</span><button type="button" class="mode-link" @click=${this._retryConfiguration}>Retry configuration save</button></div>` : ''}
            <div class="setup-choices">
                <div class="form-group"><label class="form-label" for="provider-choice">AI provider</label>
                    <select id="provider-choice" .value=${this._mode} ?disabled=${this.sessionActive || this.isInitializing || this._configurationLoading} @change=${event => this._saveMode(event.target.value)}>
                        <option value="byok">Gemini API</option><option value="groq">Groq API</option><option value="local">Local AI (on this computer)</option>
                    </select><span class="form-hint">Uses your own account or local models.</span></div>
                ${this._renderProfileSelector()}
            </div>
            ${this.sessionActive ? html`<p class="form-hint">Provider and profile changes apply after this session ends.</p>` : ''}
            <fieldset class="provider-fields" ?disabled=${this.isInitializing || this.sessionActive || this._configurationLoading}>
                ${this._mode === 'local' ? html`<details class="config-section provider-setup" .open=${this._setupOpen} @toggle=${event => { this._setupOpen = event.target.open; }}>
                    <summary class="config-summary">Local model setup (advanced)</summary><div class="config-content">
                    <button type="button" class="mode-link" @click=${this._openLocalHelp}>Local AI setup help</button>${this._renderLocalMode()}</div></details>`
                    : this._renderHostedProvider(this._mode === 'groq' ? 'groq' : 'gemini')}
            </fieldset>
            ${this.renderPreparation()}
        </div>${this._renderLocalHelp()}`;
    }

    _renderLocalHelp() {
        return html`
            <dialog class="help-dialog" aria-labelledby="local-help-title" @close=${() => { this._showLocalHelp = false; }}>
                    <div class="help-dialog-header">
                        <div id="local-help-title" class="help-dialog-title">Local AI setup</div>
                        <button class="help-btn" @click=${this._closeLocalHelp} aria-label="Close Local AI help">Close</button>
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
                                    <span class="help-model-name">Qwen3.5 4B Q4_K_M</span><span>Download size depends on model and quantization</span>
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
                                Running models locally uses a lot of RAM and CPU. If your computer slows down or freezes, it's likely the LLM. Choose Gemini or Groq on Home to use a hosted provider instead.
                            </div>
                        </div>

                        <button
                            class="help-cloud-btn"
                            @click=${() => {
                                this._closeLocalHelp();
                                this._saveMode('byok');
                            }}
                        >
                            Use Gemini instead
                        </button>
                    </div>
            </dialog>
        `;
    }
}

customElements.define('main-view', MainView);
