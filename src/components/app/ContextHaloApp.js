import { initRealtimeContext, refreshPreferences, resolveSessionId, flushSessionContext } from '../../utils/realtimeContextRenderer.js';
import { loadContextState, saveSessionPack, persistPackToCurrentSession } from '../../utils/contextCaptureRenderer.js';
import { openPanel, closePanel } from '../../utils/phase4Renderer.js';
import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { MainView } from '../views/MainView.js';
import { CustomizeView } from '../views/CustomizeView.js';
import { HelpView } from '../views/HelpView.js';
import { HistoryView } from '../views/HistoryView.js';
import { AssistantView } from '../views/AssistantView.js';
import { OnboardingView } from '../views/OnboardingView.js';
import { AICustomizeView } from '../views/AICustomizeView.js';
import { FeedbackView } from '../views/FeedbackView.js';

export class ContextHaloApp extends LitElement {
    static styles = css`
    .phase4-overlay {
        position: fixed;
        inset: 48px 28px 28px calc(var(--sidebar-width) + 28px);
        z-index: 20000;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 16px;
        background: var(--bg-surface);
        box-shadow: 0 28px 90px rgba(0,0,0,.55);
        backdrop-filter: blur(28px) saturate(130%);
        -webkit-app-region: no-drag;
    }
    :host([live-hud]) .phase4-overlay {
        inset: 58px 22px 22px 22px;
    }
    .phase4-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-height: 58px;
        padding: 0 18px;
        border-bottom: 1px solid var(--border);
    }
    .phase4-title {
        display: flex;
        align-items: baseline;
        gap: 10px;
        color: var(--text-primary);
        font-size: 15px;
        font-weight: 650;
    }
    .phase4-subtitle { color: var(--text-secondary); font-size: 11px; font-weight: 400; }
    .phase4-close, .phase4-btn, .phase4-tab, .phase4-source-button {
        border: 1px solid var(--border);
        background: var(--bg-elevated);
        color: var(--text-secondary);
        border-radius: 9px;
        cursor: pointer;
        font: inherit;
    }
    .phase4-close { min-height: 32px; padding: 0 10px; font-size: 13px; }
    .phase4-close:hover, .phase4-btn:hover, .phase4-tab:hover, .phase4-source-button:hover { background: var(--bg-elevated); color: var(--text-primary); }
    .phase4-tabs { display: flex; gap: 6px; padding: 10px 18px 0; }
    .phase4-tab { padding: 7px 11px; font-size: 11px; }
    .phase4-tab.active { border-color: rgba(96,165,250,.55); background: rgba(59,130,246,.13); color: var(--accent); }
    .phase4-body { flex: 1; min-height: 0; overflow: auto; padding: 16px 18px 22px; }
    .phase4-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
    .phase4-btn { min-height: 32px; padding: 0 11px; font-size: 11px; }
    .phase4-btn.primary { border-color: rgba(96,165,250,.55); background: rgba(59,130,246,.18); color: var(--text-primary); }
    .phase4-btn.danger { border-color: rgba(248,113,113,.25); color: #fecaca; }
    .phase4-btn:disabled { opacity: .45; cursor: default; }
    .phase4-input, .phase4-textarea, .phase4-select {
        width: 100%;
        border: 1px solid var(--border);
        border-radius: 9px;
        background: var(--bg-elevated);
        color: var(--text-primary);
        font: inherit;
        outline: none;
    }
    .phase4-input, .phase4-select { height: 34px; padding: 0 10px; }
    .phase4-textarea { min-height: 110px; padding: 9px 10px; resize: vertical; user-select: text; cursor: text; }
    .phase4-input:focus, .phase4-textarea:focus, .phase4-select:focus { border-color: rgba(96,165,250,.65); }
    .phase4-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 12px; }
    .phase4-card {
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--bg-elevated);
        padding: 13px;
    }
    .phase4-card-title { color: var(--text-primary); font-size: 12px; font-weight: 650; margin-bottom: 5px; }
    .phase4-muted { color: var(--text-secondary); font-size: 10px; line-height: 1.55; }
    .phase4-note { color: var(--text-secondary); font-size: 10px; line-height: 1.55; margin: 8px 0 14px; }
    .phase4-list { display: flex; flex-direction: column; gap: 7px; }
    .phase4-doc, .phase4-session {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 48px;
        padding: 9px 10px;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--bg-elevated);
    }
    .phase4-doc-main, .phase4-session-main { flex: 1; min-width: 0; }
    .phase4-doc-title, .phase4-session-title { color: var(--text-primary); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .phase4-doc-meta, .phase4-session-meta { color: var(--text-secondary); font-size: 9px; margin-top: 3px; }
    .phase4-toggle { width: 15px; height: 15px; accent-color: #60a5fa; cursor: pointer; }
    .phase4-search-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; margin-bottom: 14px; }
    .phase4-result { margin-top: 8px; padding: 10px; border-left: 2px solid rgba(96,165,250,.5); background: rgba(59,130,246,.05); }
    .phase4-result-title { color: var(--accent); font-size: 10px; font-weight: 600; }
    .phase4-result-text { color: var(--text-secondary); font-size: 10px; line-height: 1.55; margin-top: 5px; white-space: pre-wrap; user-select: text; }
    .phase4-form { display: none; margin: 10px 0 14px; gap: 8px; }
    .phase4-form.visible { display: grid; }
    .phase4-practice-question { font-size: 14px; line-height: 1.55; color: var(--text-primary); white-space: pre-wrap; user-select: text; margin: 12px 0; }
    .phase4-progress { color: var(--text-secondary); font-size: 10px; }
    .phase4-feedback { margin-top: 10px; padding: 10px; border-radius: 9px; background: var(--bg-elevated); font-size: 10px; line-height: 1.55; color: var(--text-secondary); }
    .phase4-feedback.strong { background: rgba(34,197,94,.08); color: #bbf7d0; }
    .phase4-feedback.partial { background: rgba(234,179,8,.08); color: #fef08a; }
    .phase4-feedback.retry { background: rgba(248,113,113,.08); color: #fecaca; }
    .phase4-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
    .phase4-tag { padding: 4px 7px; border-radius: 999px; background: var(--bg-elevated); color: var(--text-secondary); font-size: 9px; }
    .phase4-review-section { margin-top: 14px; }
    .phase4-review-section h4 { margin: 0 0 7px; color: var(--text-primary); font-size: 11px; }
    .phase4-review-section ul { margin: 0; padding-left: 18px; color: var(--text-secondary); font-size: 10px; line-height: 1.6; user-select: text; }
    .phase4-empty { padding: 32px 16px; text-align: center; color: var(--text-secondary); font-size: 11px; }
    .phase4-live-chip {
        min-height: 24px;
        padding: 0 8px;
        border: 1px solid rgba(96,165,250,.2);
        border-radius: 999px;
        background: rgba(59,130,246,.07);
        color: var(--accent);
        font-size: 9px;
        cursor: pointer;
    }
    @media (max-width: 900px) { .phase4-grid { grid-template-columns: 1fr; } }

        .phase4-overlay { position: fixed; inset: 16px; width: auto; height: auto; max-width: none; max-height: none; margin: 0; padding: 0; background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-strong); }
        .phase4-overlay:not([open]) { display: none; }
        .phase4-overlay::backdrop { background: rgb(0 0 0 / 0.3); }
        .phase4-overlay :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

        * {
            box-sizing: border-box;
            font-family: var(--font);
            margin: 0;
            cursor: default;
            user-select: none;
        }

        :host {
            display: block;
            width: 100%;
            height: 100vh;
            overflow: hidden;
            border-radius: 12px;
            background: transparent;
            color: var(--text-primary);
        }

        /* ── Full app shell: top bar + sidebar/content ── */

        .app-shell {
            display: flex;
            height: calc(100vh - 2px);
            margin: 1px;
            overflow: hidden;
            border: 2px solid rgba(255, 255, 255, 0.18);
            border-radius: 11px;
            background: var(--bg-app);
        }

        .top-drag-bar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 9999;
            display: flex;
            align-items: center;
            height: 38px;
            background: transparent;
        }

        .drag-region {
            flex: 1;
            height: 100%;
            -webkit-app-region: drag;
        }

        .top-drag-bar.hidden {
            display: none;
        }

        .traffic-lights {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 var(--space-md);
            height: 100%;
            -webkit-app-region: no-drag;
        }

        .traffic-light {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            border: none;
            cursor: pointer;
            padding: 0;
            transition: opacity 0.15s ease;
        }

        .traffic-light:hover {
            opacity: 0.8;
        }

        .traffic-light.close {
            background: #ff5f57;
        }

        .traffic-light.minimize {
            background: #febc2e;
        }

        .traffic-light.maximize {
            background: #28c840;
        }

        .sidebar {
            width: var(--sidebar-width);
            min-width: var(--sidebar-width);
            background: var(--bg-surface);
            border-right: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            padding: 42px 0 var(--space-md) 0;
            transition:
                width var(--transition),
                min-width var(--transition),
                opacity var(--transition);
        }

        .sidebar.hidden {
            width: 0;
            min-width: 0;
            padding: 0;
            overflow: hidden;
            border-right: none;
            opacity: 0;
        }

        .sidebar-brand {
            padding: var(--space-sm) var(--space-lg);
            padding-top: var(--space-md);
            margin-bottom: var(--space-lg);
        }

        .sidebar-brand h1 {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
            letter-spacing: -0.01em;
        }

        .sidebar-nav {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: var(--space-xs);
            padding: 0 var(--space-sm);
            -webkit-app-region: no-drag;
        }

        .nav-item {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            padding: var(--space-sm) var(--space-md);
            border-radius: var(--radius-md);
            color: var(--text-secondary);
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            cursor: pointer;
            transition:
                color var(--transition),
                background var(--transition);
            border: none;
            background: none;
            width: 100%;
            text-align: left;
        }

        .nav-item:hover {
            color: var(--text-primary);
            background: var(--bg-hover);
        }

        .nav-item.active {
            color: var(--text-primary);
            background: var(--bg-elevated);
        }

        .nav-item svg {
            width: 20px;
            height: 20px;
            flex-shrink: 0;
        }

        .sidebar-footer {
            flex-shrink: 0;
            padding: var(--space-sm);
            margin-top: var(--space-sm);
            -webkit-app-region: no-drag;
        }

        .update-btn {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            width: 100%;
            padding: var(--space-sm) var(--space-md);
            border-radius: var(--radius-md);
            border: 1px solid rgba(239, 68, 68, 0.2);
            background: rgba(239, 68, 68, 0.08);
            color: var(--danger);
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            cursor: pointer;
            text-align: left;
            transition:
                background var(--transition),
                border-color var(--transition);
            animation: update-wobble 5s ease-in-out infinite;
        }

        .update-btn:hover {
            background: rgba(239, 68, 68, 0.14);
            border-color: rgba(239, 68, 68, 0.35);
        }

        @keyframes update-wobble {
            0%,
            90%,
            100% {
                transform: rotate(0deg);
            }
            92% {
                transform: rotate(-2deg);
            }
            94% {
                transform: rotate(2deg);
            }
            96% {
                transform: rotate(-1.5deg);
            }
            98% {
                transform: rotate(1.5deg);
            }
        }

        .update-btn svg {
            width: 20px;
            height: 20px;
            flex-shrink: 0;
        }

        .version-text {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            padding: var(--space-xs) var(--space-md);
        }

        /* ── Main content area ── */

        .content {
            min-width: 0;
            flex: 1;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            background: var(--bg-app);
        }

        /* A single alpha surface; child backgrounds must not compound it. */
        .app-shell.live-hud { background: var(--hud-background, rgba(10,10,10,0.8)); }
        .live-hud .content, .content-inner.live { background: transparent; }
        .live-bar {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
            gap: 12px;
            align-items: center;
            padding: 8px 12px;
            flex-shrink: 0;
            border-bottom: 1px solid var(--border-strong);
            -webkit-app-region: drag;
        }
        .live-bar-left, .live-bar-right {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
            -webkit-app-region: no-drag;
        }
        .live-bar-right { justify-content: flex-end; }
        .live-bar-center {
            min-width: 0;
            font-size: 14px;
            font-weight: 600;
            text-shadow: var(--hud-text-shadow);
        }
        .live-bar button, .session-actions button {
            min-height: 32px;
            padding: 6px 10px;
            border: 1px solid var(--border-strong);
            border-radius: 8px;
            color: var(--text-primary);
            background: var(--bg-elevated);
            cursor: pointer;
            -webkit-app-region: no-drag;
        }
        .live-bar button:hover, .session-actions button:hover { background: var(--bg-hover); }
        button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .live-bar-text { font-size: 12px; white-space: nowrap; text-shadow: var(--hud-text-shadow); }
        .session-state {
            max-height: 96px; overflow-y: auto;
            padding: 6px 12px;
            display: flex;
            flex-wrap: wrap;
            gap: 4px 12px;
            flex-shrink: 0;
            font-size: 12px;
            color: var(--text-primary);
            text-shadow: var(--hud-text-shadow);
        }
        .session-state .status-detail {
            min-width: 0;
            overflow-wrap: anywhere;
            overflow: auto;
            max-height: 3.2em;
            flex: 1 1 200px;
            user-select: text;
        }
        .session-state .search-state { flex-shrink: 0; }
        .session-actions { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
        .session-actions > span { flex-basis: 100%; max-height: 3.2em; overflow: auto; overflow-wrap: anywhere; }
        @media (max-height: 400px) { .session-state { max-height: 64px; padding: 4px 8px; } }
        :host([windows]) .top-drag-bar { height: 38px; background: var(--bg-surface); }
        :host([windows]) .drag-region { order: 1; }
        :host([windows]) .traffic-lights { order: 2; padding: 0; gap: 0; }
        :host([windows]) .traffic-light {
            position: relative; width: 46px; height: 38px;
            border-radius: 0; background: transparent; opacity: 1;
        }
        :host([windows]) .traffic-light:hover { background: var(--bg-hover); }
        :host([windows]) .traffic-light.close { order: 3; }
        :host([windows]) .traffic-light.close:hover { background: #c42b1c; color: white; }
        :host([windows]) .traffic-light::before, :host([windows]) .traffic-light::after {
            content: ''; position: absolute; left: 50%; top: 50%;
            color: var(--text-primary); pointer-events: none;
        }
        :host([windows]) .traffic-light.minimize::before {
            width: 10px; height: 1px; background: currentColor; transform: translate(-50%, 2px);
        }
        :host([windows]) .traffic-light.maximize::before {
            width: 9px; height: 8px; border: 1px solid currentColor; transform: translate(-50%, -50%);
        }
        :host([windows]) .traffic-light.close::before, :host([windows]) .traffic-light.close::after {
            width: 12px; height: 1px; background: currentColor; transform: translate(-50%, -50%) rotate(45deg);
        }
        :host([windows]) .traffic-light.close::after { transform: translate(-50%, -50%) rotate(-45deg); }
        @media (max-width: 700px) {
            .live-bar { gap: 6px; padding: 6px 8px; }
            .live-bar-center { font-size: 13px; }
            .live-bar-text.elapsed { display: none; }
        }

        /* Content inner */
        .content-inner {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
            overscroll-behavior: contain;
            scroll-behavior: auto;
        }

        .content-inner.live {
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        /* Onboarding fills everything */
        .fullscreen {
            position: fixed;
            inset: 0;
            z-index: 100;
            background: var(--bg-app);
        }

        .startup-shell {
            width: 100%;
            height: 100%;
            display: grid;
            place-items: center;
            background: var(--bg-app);
            color: var(--text-primary);
        }

        .startup-card {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 14px 18px;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            background: var(--bg-surface);
            font-size: var(--font-size-sm);
            color: var(--text-secondary);
        }

        .startup-spinner {
            width: 16px;
            height: 16px;
            border: 2px solid var(--border-strong);
            border-top-color: var(--accent);
            border-radius: 50%;
            animation: startup-spin 0.8s linear infinite;
        }

        @keyframes startup-spin {
            to { transform: rotate(360deg); }
        }

        .app-shell.compact .sidebar {
            width: 184px;
            min-width: 184px;
        }

        ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }

        ::-webkit-scrollbar-track {
            background: transparent;
        }

        ::-webkit-scrollbar-thumb {
            background: var(--border-strong);
            border-radius: 3px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: #444444;
        }
    `;

    static properties = {
        workspaceTab: { state: true },
        _unsavedSession: { state: true },
        currentView: { type: String },
        statusText: { type: String },
        startTime: { type: Number },
        isRecording: { type: Boolean },
        sessionActive: { type: Boolean },
        isInitializing: { type: Boolean },
        lifecycleState: { state: true },
        providerState: { state: true },
        providerMode: { state: true },
        providerError: { state: true },
        requestError: { state: true },
        shortcut: { state: true },
        captureState: { state: true },
        searchState: { state: true },
        sessionDraft: { state: true },
        startError: { type: String },
        selectedProfile: { type: String },
        selectedLanguage: { type: String },
        responses: { type: Array },
        currentResponseIndex: { type: Number },
        selectedScreenshotInterval: { type: String },
        selectedImageQuality: { type: String },
        layoutMode: { type: String },

        _isClickThrough: { state: true },

        shouldAnimateResponse: { type: Boolean },
        _storageLoaded: { state: true },
        _updateAvailable: { state: true },
        _whisperDownloading: { state: true },
        _localAiDownloadProgress: { state: true },
    };

    constructor() {
        super();
        this.currentView = 'main';
        this.statusText = '';
        this.startTime = null;
        this.isRecording = false;
        this.sessionActive = false;
        this.isInitializing = false;
        this.lifecycleState = 'idle';
        this.providerState = 'disconnected';
        this.providerMode = 'byok';
        this.providerError = null;
        this.captureState = { state: 'stopped', audioReady: false, screen: false, warning: '' };
        this.searchState = { requested: false, effective: false, status: 'off' };
        this.sessionDraft = '';
        this.requestError = null;
        this.shortcut = '';
        this._responseGrounding = [];
        this._unsavedSession = false;
        this._needsRestart = false;
        this._sessionStarted = false;
        this._uiSessionEpoch = 0;
        this._startPromise = null;
        this._stopPromise = null;
        this._startController = null;
        this._captureStateListener = event => this._captureChanged(event.detail);
        this.startError = '';
        this.selectedProfile = 'interview';
        this.selectedLanguage = 'en-US';
        this.selectedScreenshotInterval = '5';
        this.selectedImageQuality = 'medium';
        this.layoutMode = 'normal';
        this.responses = [];
        this._responseIds = [];
        this._responseRequestIndex = new Map();
        this.currentResponseIndex = -1;

        this._isClickThrough = false;


        this.shouldAnimateResponse = false;
        this._storageLoaded = false;
        this._timerInterval = null;
        this._ipcSubscriptions = [];
        this._updateAvailable = false;
        this._whisperDownloading = false;
        this._localAiDownloadProgress = { active: false, label: '', percentage: null };
        this._localVersion = '';

        this._loadFromStorage();
        this._checkForUpdates();
    }

    async _checkForUpdates() {
        try {
            this._localVersion = await contextHalo.getVersion();
            // This fork's portable releases are identified by GitHub release tags,
            // while the app package version is currently static. Do not compare
            // against the original upstream repository and generate false updates.
            this._updateAvailable = false;
            this.requestUpdate();
        } catch (e) {
            // Keep the UI usable if version retrieval fails.
        }
    }

    async _loadFromStorage() {
        try {
            const [config, prefs] = await Promise.all([contextHalo.storage.getConfig(), contextHalo.storage.getPreferences()]);

            this.currentView = config.onboarded ? 'main' : 'onboarding';
            this.selectedProfile = prefs.selectedProfile || 'interview';
            this.selectedLanguage = prefs.selectedLanguage || 'en-US';
            this.selectedScreenshotInterval = prefs.selectedScreenshotInterval || '5';
            this.selectedImageQuality = prefs.selectedImageQuality || 'medium';
            this.layoutMode = config.layout || 'normal';

            this.shortcut = (await contextHalo.storage.getKeybinds())?.nextStep || (window.process?.platform === 'darwin' ? 'Cmd+Enter' : 'Ctrl+Enter');
            this._storageLoaded = true;
            this.requestUpdate();
        } catch (error) {
            console.error('Error loading from storage:', error);
            this._storageLoaded = true;
            this.requestUpdate();
        }
    }

    connectedCallback() {
        super.connectedCallback();
        this._disposeRealtime = initRealtimeContext();
        this._captureSourceChanged = () => { if (this.sessionActive) void this.restartCapture(); };
        window.addEventListener('capture-source-changed', this._captureSourceChanged);
        void Promise.all([loadContextState(), refreshPreferences()]).catch(() => { this.startError = 'Session context could not be loaded.'; });
        this.toggleAttribute('windows', window.process?.platform === 'win32');
        window.addEventListener('capture-state-changed', this._captureStateListener);

        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            const listen = (channel, handler) => { ipcRenderer.on(channel, handler); this._ipcSubscriptions.push([channel, handler]); };
            listen('new-response', (_, response, metadata) => this.addNewResponse(response, metadata));
            listen('update-response', (_, response, metadata) => this.updateCurrentResponse(response, metadata));
            listen('update-status', (_, status) => this.setStatus(status));
            // Provider setup events must not release the UI's duplicate-start
            // guard while screen/audio permission and capture are still pending.
            listen('provider-state', (_, state) => this.setProviderState(state));
            listen('search-state', (_, state) => { this.searchState = state; });
            listen('provider-request-error', (_, failure) => { this.requestError = failure; this._scheduleRecoveryRefresh(); });
            listen('shortcut', (_, shortcut) => contextHalo.handleShortcut(shortcut));
            listen('click-through-toggled', (_, isEnabled) => {
                this._isClickThrough = isEnabled;
            });
            listen('reconnect-failed', (_, data) => this.setProviderState({ state: 'failed', error: data?.error || { message: data?.message || 'Provider disconnected' } }));
            listen('whisper-downloading', (_, downloading) => {
                this._whisperDownloading = downloading;
            });
            listen('local-ai-download-progress', (_, progress) => {
                this._localAiDownloadProgress = progress;
            });
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('capture-source-changed', this._captureSourceChanged);
        this._stopTimer();
        clearTimeout(this._recoveryTimer);
        window.removeEventListener('capture-state-changed', this._captureStateListener);
        this._startController?.abort();
        if (this.sessionActive || this.isInitializing) void this.endSession().finally(() => this._disposeRealtime?.());
        else this._disposeRealtime?.();
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            for (const [channel, handler] of this._ipcSubscriptions) ipcRenderer.removeListener(channel, handler);
            this._ipcSubscriptions = [];
        }
    }

    // ── Timer ──

    _startTimer() {
        this._stopTimer();
        if (this.startTime) {
            this._timerInterval = setInterval(() => this.requestUpdate(), 1000);
        }
    }

    _stopTimer() {
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
    }

    getElapsedTime() {
        if (!this.startTime) return '0:00';
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const h = Math.floor(elapsed / 3600);
        const m = Math.floor((elapsed % 3600) / 60);
        const s = elapsed % 60;
        const pad = n => String(n).padStart(2, '0');
        if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
        return `${m}:${pad(s)}`;
    }

    // ── Status & Responses ──

    setStatus(text) {
        const status = String(text || '').slice(0, 4000);
        this.statusText = /listening/i.test(status) && !this.isRecording ? this._readyStatus() : status;
    }

    _readyStatus() {
        const provider = { byok: 'Gemini', groq: 'Groq', local: 'Local AI' }[this.providerMode] || 'Provider';
        if (this.providerState !== 'ready') return `${provider} ${this.providerState || 'unavailable'}`;
        if (!this.captureState.audioReady) return `${provider} ready; audio capture is unavailable. Typed questions still work.`;
        const channels = [this.captureState.microphone ? 'microphone' : '', this.captureState.system ? 'speaker audio' : ''].filter(Boolean).join(' + ');
        return this.captureState.warning || `${provider} ready \u00b7 ${channels || 'audio'} active`;
    }

    _setLifecycle(state, status) {
        this.lifecycleState = state;
        this.isInitializing = ['preparing', 'connecting', 'preparing-capture', 'capture-ready', 'stopping'].includes(state);
        this.sessionActive = Boolean(this._sessionStarted);
        this.isRecording = this.sessionActive && this.providerState === 'ready' && this.captureState.audioReady === true;
        if (status !== undefined) this.setStatus(status);
        this.requestUpdate();
    }

    _captureChanged(state) {
        this.captureState = { ...state };
        this.isRecording = this.sessionActive && this.providerState === 'ready' && state.audioReady === true;
        if (this.sessionActive && !this.isInitializing && this.providerState === 'ready') {
            this._setLifecycle(state.state === 'ready' ? 'active' : 'capture-stopped', state.warning || this._readyStatus());
        }
    }

    setProviderState(data) {
        if (!data || typeof data.state !== 'string') return;
        if (data.uiEpoch !== undefined && data.uiEpoch !== this._uiSessionEpoch) return;
        this.providerState = data.state;
        if (data.provider) this.providerMode = data.provider;
        if (data.search) this.searchState = data.search;
        this.providerError = data.error || null;
        this._scheduleRecoveryRefresh();
        this.isRecording = this.sessionActive && this.providerState === 'ready' && this.captureState.audioReady === true;
        if (this.sessionActive && !this.isInitializing) {
            const state = data.state === 'ready' ? (this.captureState.state === 'ready' ? 'active' : 'capture-stopped')
                : data.state === 'reconnecting' ? 'reconnecting' : 'failed';
            this._setLifecycle(state, data.error?.message || this._readyStatus());
        }
    }

    _scheduleRecoveryRefresh() {
        clearTimeout(this._recoveryTimer);
        const retryAt = Math.max(this.providerError?.retryAt || 0, this.requestError?.retryAt || 0);
        if (retryAt > Date.now()) this._recoveryTimer = setTimeout(() => this.requestUpdate(), Math.min(2147483647, retryAt - Date.now() + 30));
        this.requestUpdate();
    }

    retryRequest() {
        if (this.requestError?.retryAt > Date.now()) return;
        this.navigate('assistant');
        this.updateComplete.then(() => {
            const view = this.shadowRoot.querySelector('assistant-view');
            if (this.requestError?.operation === 'screen') return view?.handleScreenAnswer();
            return view?.handleSendText();
        });
    }

    _checkStart(epoch) {
        if (epoch !== this._uiSessionEpoch || this._startController?.signal.aborted) {
            throw Object.assign(new Error('Session start cancelled'), { name: 'AbortError' });
        }
    }

    async _awaitStart(work, epoch) {
        const signal = this._startController?.signal;
        let onAbort;
        const cancelled = new Promise((_, reject) => {
            onAbort = () => reject(Object.assign(new Error('Session start cancelled'), { name: 'AbortError' }));
            if (signal?.aborted) onAbort();
            else signal?.addEventListener('abort', onAbort, { once: true });
        });
        try {
            const result = await Promise.race([work, cancelled]);
            this._checkStart(epoch);
            return result;
        } finally { signal?.removeEventListener('abort', onAbort); }
    }

    addNewResponse(response, metadata) {
        const id = metadata?.requestId;
        if (id && this._responseRequestIndex.has(id)) return this.updateCurrentResponse(response, metadata);
        const wasOnLatest = this.currentResponseIndex === this.responses.length - 1;
        this.responses = [...this.responses, String(response || '')];
        (this._responseGrounding ||= []).push(metadata?.grounding);
        this._responseIds.push(id || null);
        if (id) this._responseRequestIndex.set(id, this.responses.length - 1);
        if (wasOnLatest || this.currentResponseIndex === -1) this.currentResponseIndex = this.responses.length - 1;
        this.requestUpdate();
    }

    updateCurrentResponse(response, metadata) {
        const id = metadata?.requestId;
        if (id && !this._responseRequestIndex.has(id)) return this.addNewResponse(response, metadata);
        const index = id ? this._responseRequestIndex.get(id) : this.responses.length - 1;
        if (index < 0) return this.addNewResponse(response, metadata);
        if (metadata?.grounding) (this._responseGrounding ||= [])[index] = metadata.grounding;
        const next = [...this.responses];
        next[index] = String(response || '');
        this.responses = next;
        this.requestUpdate();
    }

    // ── Navigation ──

    navigate(view) {
        this.currentView = view;
        this.requestUpdate();
        // Home, Settings and the other normal pages share .content-inner as
        // their only vertical scroller. Always enter a page at its real top.
        this.updateComplete.then(() => this._resetContentScroll());
    }

    _resetContentScroll() {
        const content = this.shadowRoot?.querySelector('.content-inner');
        if (!content || this._isLiveMode()) return;
        content.scrollTop = 0;
        content.scrollLeft = 0;
    }

    async handleClose() {
        if (this.sessionActive || this.isInitializing || this.currentView === 'assistant') return this.endSession();
        if (this._unsavedSession && !(await this.retrySave()).success) return;
        await window.electronAPI.invoke('quit-application');
    }

    endSession() {
        if (this._stopPromise) return this._stopPromise;
        this._uiSessionEpoch += 1;
        this._startController?.abort();
        this._setLifecycle('stopping', 'Stopping capture and closing the provider...');
        contextHalo.stopCapture();
        const operation = (async () => {
            const results = await Promise.allSettled([
                Promise.resolve().then(() => flushSessionContext()),
                window.electronAPI.invoke('cancel-local-initialization'),
                window.electronAPI.invoke('close-session'),
            ]);
            const failedSave = results[0].status === 'rejected';
            const failedClose = results[2].status === 'rejected' || results[2].value?.success === false;
            this._unsavedSession = failedSave;
            this._needsRestart = failedClose;
            this._sessionStarted = false;
            this.providerState = 'disconnected';
            this._stopTimer();
            clearTimeout(this._recoveryTimer);
            this.startTime = null;
            this.currentView = 'main';
            this.startError = failedSave ? 'The final transcript is retained in memory. Retry saving before closing or starting another session; existing history is unchanged.' : failedClose ? 'Capture stopped, but provider cleanup failed. Restart ContextHalo before another session.' : '';
            this.requestError = null;
            this._setLifecycle(failedClose ? 'failed' : 'idle', this.startError || 'Session ended');
            return { success: !failedSave && !failedClose };
        })().finally(() => { if (this._stopPromise === operation) this._stopPromise = null; });
        this._stopPromise = operation;
        return operation;
    }

    async retrySave() {
        try {
            await flushSessionContext();
            this._unsavedSession = false;
            this.startError = this._needsRestart ? 'Provider cleanup failed. Restart ContextHalo before another session.' : '';
            this.requestUpdate();
            return { success: true };
        } catch {
            this._unsavedSession = true;
            this.startError = 'The final transcript is still retained in memory. Check storage permissions and retry saving.';
            this.requestUpdate();
            return { success: false };
        }
    }

    async _handleMinimize() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('window-minimize');
        }
    }

    async _handleMaximize() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('window-toggle-maximize');
        }
    }

    async handleHideToggle() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('toggle-window-visibility');
        }
    }

    // ── Session start ──

    handleStart(options = {}) {
        if (this._needsRestart) return Promise.resolve({ success: false, error: 'Restart ContextHalo to finish provider cleanup.' });
        if (this._stopPromise) return this._stopPromise.then(() => this.handleStart(options));
        if (this._startPromise && this._startEpoch === this._uiSessionEpoch) return this._startPromise;
        if (this.sessionActive) { this.navigate('assistant'); return Promise.resolve({ success: true }); }
        if (this.providerError?.retryAt > Date.now()) return Promise.resolve({ success: false, error: this.providerError.message });
        const epoch = ++this._uiSessionEpoch;
        this._startEpoch = epoch;
        this._startController = new AbortController();
        const operation = this._prepareSession(epoch, options).finally(() => {
            if (this._startPromise === operation) this._startPromise = null;
        });
        this._startPromise = operation;
        return operation;
    }

    async _prepareSession(epoch, options) {
        this.startError = '';
        this.providerError = null;
        this.providerState = 'disconnected';
        this._setLifecycle('preparing', 'Loading saved session settings...');
        try {
            if (this._unsavedSession) {
                await this._awaitStart(flushSessionContext(), epoch);
                this._unsavedSession = false;
            }
            await this._awaitStart(Promise.resolve(saveSessionPack()), epoch);
            const prefs = await this._awaitStart(contextHalo.storage.getPreferences(), epoch);
            this.providerMode = prefs.providerMode || 'byok';
            if (!['byok', 'groq', 'local'].includes(this.providerMode)) throw new Error('Choose Gemini, Groq or Local AI in provider settings.');
            if (this.providerMode !== 'local') {
                const key = await this._awaitStart(this.providerMode === 'groq' ? contextHalo.storage.getGroqApiKey() : contextHalo.storage.getApiKey(), epoch);
                if (!key?.trim()) throw new Error(`No ${this.providerMode === 'groq' ? 'Groq' : 'Gemini'} API key configured. Open provider settings.`);
            }
            this.providerState = 'connecting';
            this._setLifecycle('connecting', this.providerMode === 'local' ? 'Preparing local AI and speech models...' : `Connecting to ${this.providerMode === 'groq' ? 'Groq' : 'Gemini Live'}...`);
            const requestOptions = { ...options, uiEpoch: epoch };
            const success = await this._awaitStart(this.providerMode === 'local'
                ? contextHalo.initializeLocal(this.selectedProfile, this.selectedLanguage, requestOptions)
                : contextHalo.initializeGemini(this.selectedProfile, this.selectedLanguage, requestOptions), epoch);
            if (!success) throw new Error(this.providerError?.message || this.statusText || 'The provider could not connect.');
            this.providerState = 'ready';
            this._setLifecycle('preparing-capture', 'Provider connected. Preparing the selected screen and audio inputs...');
            const captured = await this._awaitStart(contextHalo.startCapture(this.selectedScreenshotInterval, this.selectedImageQuality), epoch);
            if (!captured) throw new Error(contextHalo.getCaptureState?.().warning || this.statusText || 'Capture could not start.');
            this.captureState = contextHalo.getCaptureState?.() || { state: 'ready', audioReady: true, screen: true };
            this._setLifecycle('capture-ready', 'Screen and audio capture ready');
            this.responses = [];
            this._responseIds = [];
            this._responseGrounding = [];
            this.requestError = null;
            this._responseRequestIndex.clear();
            this.currentResponseIndex = -1;
            this.startTime = Date.now();
            this._sessionStarted = true;
            await this._awaitStart(persistPackToCurrentSession(), epoch);
            await this._awaitStart(resolveSessionId(), epoch);
            this.currentView = 'assistant';
            this._setLifecycle('active', this._readyStatus());
            this._startTimer();
            return { success: true };
        } catch (error) {
            if (epoch !== this._uiSessionEpoch) return { success: false, cancelled: true };
            contextHalo.stopCapture();
            await window.electronAPI.invoke('close-session').catch(() => {});
            if (epoch !== this._uiSessionEpoch) return { success: false, cancelled: true };
            this._sessionStarted = false;
            this.providerState = 'failed';
            this.startError = error?.message || 'The session could not start.';
            this._setLifecycle('failed', this.startError);
            return { success: false, error: this.startError };
        }
    }

    async restartCapture() {
        if (!this.sessionActive || this.isInitializing) return;
        const epoch = this._uiSessionEpoch;
        this._setLifecycle('preparing-capture', 'Restarting the selected screen and audio inputs...');
        contextHalo.stopCapture();
        try { await contextHalo.startCapture(this.selectedScreenshotInterval, this.selectedImageQuality); }
        catch { /* The capture owner publishes its recoverable failure state. */ }
        if (epoch !== this._uiSessionEpoch) return;
        this.captureState = contextHalo.getCaptureState();
        this._setLifecycle(this.captureState.state === 'ready' ? 'active' : 'capture-stopped', this.captureState.warning || this._readyStatus());
    }

    retryProvider(withoutSearch = false) {
        if (Math.max(this.providerError?.retryAt || 0, this.requestError?.retryAt || 0) > Date.now()) return Promise.resolve({ success: false });
        if (!this.sessionActive) return this.handleStart(withoutSearch ? { searchEnabled: false } : {});
        if (this._retryPromise) return this._retryPromise;
        const epoch = this._uiSessionEpoch;
        this.providerState = 'reconnecting';
        this._setLifecycle('reconnecting', 'Reconnecting the provider. Your draft and session history are retained.');
        const operation = window.electronAPI.invoke('retry-session-connection', { withoutSearch }).then(result => {
            if (epoch === this._uiSessionEpoch) this.setProviderState({ state: result.success ? 'ready' : 'failed', error: result.failure, search: result.search });
            if (epoch === this._uiSessionEpoch && result.success) this.requestError = null;
            return result;
        }).catch(error => {
            if (epoch === this._uiSessionEpoch) this.setProviderState({ state: 'failed', error: { message: error.message } });
            return { success: false, error: error.message };
        }).finally(() => { if (this._retryPromise === operation) this._retryPromise = null; });
        this._retryPromise = operation;
        return operation;
    }

    async handleCancelLocalDownload() {
        await this.endSession();
    }

    async handleAPIKeyHelp() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('open-external', 'https://ai.google.dev/gemini-api/docs/api-key');
        }
    }

    async handleGroqAPIKeyHelp() {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('open-external', 'https://console.groq.com/keys');
        }
    }

    // ── Settings handlers ──

    async handleProfileChange(profile) {
        this.selectedProfile = profile;
        await contextHalo.storage.updatePreference('selectedProfile', profile);
    }

    async handleLanguageChange(language) {
        this.selectedLanguage = language;
        await contextHalo.storage.updatePreference('selectedLanguage', language);
    }

    async handleScreenshotIntervalChange(interval) {
        this.selectedScreenshotInterval = interval;
        await contextHalo.storage.updatePreference('selectedScreenshotInterval', interval);
    }

    async handleImageQualityChange(quality) {
        this.selectedImageQuality = quality;
        await contextHalo.storage.updatePreference('selectedImageQuality', quality);
    }

    async handleLayoutModeChange(layoutMode) {
        this.layoutMode = layoutMode;
        await contextHalo.storage.updateConfig('layout', layoutMode);
        this.requestUpdate();
    }

    async handleExternalLinkClick(url) {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            await ipcRenderer.invoke('open-external', url);
        }
    }

    async handleSendText(message) {
        // A new question returns to the newest card, unlike background updates.
        this.currentResponseIndex = this.responses.length - 1;
        this.requestUpdate();
        const epoch = this._uiSessionEpoch || 0;
        try {
            const result = await window.contextHalo.sendTextMessage(message);
            if ((this._uiSessionEpoch || 0) !== epoch) return { success: false, error: 'Session ended' };
            if (result?.success !== true) this.setStatus('Error sending message: ' + (result?.error || 'Unknown provider error'));
            else this.setStatus('Response received');
            return result;
        } catch (error) {
            if ((this._uiSessionEpoch || 0) === epoch) this.setStatus('Error sending message: ' + error.message);
            return { success: false, error: error.message };
        }
    }

    handleResponseIndexChanged(e) {
        this.currentResponseIndex = e.detail.index;
        this.shouldAnimateResponse = false;
        this.requestUpdate();
    }

    handleOnboardingComplete() {
        this.currentView = 'main';
    }

    updated(changedProperties) {
        super.updated(changedProperties);

        if (changedProperties.has('currentView')) {
            this._resetContentScroll();
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.send('view-changed', this.currentView);
            }
        }
    }

    // ── Helpers ──

    _isLiveMode() {
        return this.currentView === 'assistant';
    }

    // ── Render ──

    renderCurrentView() {
        switch (this.currentView) {
            case 'onboarding':
                return html`
                    <onboarding-view .onComplete=${() => this.handleOnboardingComplete()} .onClose=${() => this.handleClose()}></onboarding-view>
                `;

            case 'main':
                return html`
                    <main-view
                        .unsavedSession=${this._unsavedSession}
                        .onRetrySave=${() => this.retrySave()}
                        .selectedProfile=${this.selectedProfile}
                        .onProfileChange=${p => this.handleProfileChange(p)}
                        .onStart=${() => this.handleStart()}
                        .onExternalLink=${url => this.handleExternalLinkClick(url)}
                        .isInitializing=${this.isInitializing}
                        .onCancelStart=${() => this.endSession()}
                        .shortcut=${this.shortcut}
                        .onRetryWithoutSearch=${() => this.retryProvider(true)}
                        .providerError=${this.providerError}
                        .searchState=${this.searchState}
                        .lifecycleState=${this.lifecycleState}
                        .retryBlocked=${this.providerError?.retryAt > Date.now()}
                        .statusText=${this.statusText}
                        .startError=${this.startError}
                        .whisperDownloading=${this._whisperDownloading}
                        .downloadProgress=${this._localAiDownloadProgress}
                        .onCancelDownload=${() => this.handleCancelLocalDownload()}
                    ></main-view>
                `;

            case 'ai-customize':
                return html`
                    <ai-customize-view
                        .selectedProfile=${this.selectedProfile}
                        .onProfileChange=${p => this.handleProfileChange(p)}
                    ></ai-customize-view>
                `;

            case 'customize':
                return html`
                    <customize-view
                        .selectedProfile=${this.selectedProfile}
                        .selectedLanguage=${this.selectedLanguage}
                        .selectedScreenshotInterval=${this.selectedScreenshotInterval}
                        .selectedImageQuality=${this.selectedImageQuality}
                        .layoutMode=${this.layoutMode}
                        .onProfileChange=${p => this.handleProfileChange(p)}
                        .onLanguageChange=${l => this.handleLanguageChange(l)}
                        .onScreenshotIntervalChange=${i => this.handleScreenshotIntervalChange(i)}
                        .onImageQualityChange=${q => this.handleImageQualityChange(q)}
                        .onLayoutModeChange=${lm => this.handleLayoutModeChange(lm)}
                        .onOpenProviderSettings=${() => this.navigate('main')}
                    ></customize-view>
                `;

            case 'feedback':
                return html`<feedback-view></feedback-view>`;

            case 'help':
                return html`<help-view .onExternalLinkClick=${url => this.handleExternalLinkClick(url)}></help-view>`;

            case 'history':
                return html`<history-view></history-view>`;

            case 'assistant':
                return html`
                    <assistant-view
                        .grounding=${this._responseGrounding[this.currentResponseIndex]}
                        .retryBlocked=${this.requestError?.retryAt > Date.now()}
                        .shortcut=${this.shortcut}
                        .responses=${this.responses}
                        .currentResponseIndex=${this.currentResponseIndex}
                        .selectedProfile=${this.selectedProfile}
                        .onSendText=${msg => this.handleSendText(msg)}
                        .onOpenKnowledge=${() => openPanel(this, 'knowledge')}
                        .draft=${this.sessionDraft}
                        @draft-changed=${event => { this.sessionDraft = event.detail; }}
                        .shouldAnimateResponse=${this.shouldAnimateResponse}
                        @response-index-changed=${this.handleResponseIndexChanged}
                        @response-animation-complete=${() => {
                            this.shouldAnimateResponse = false;

                            this.requestUpdate();
                        }}
                    ></assistant-view>
                `;

            default:
                return html`<div>Unknown view: ${this.currentView}</div>`;
        }
    }

    renderSidebar() {
        const items = [
            {
                id: 'main',
                label: 'Home',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path
                            d="m19 8.71l-5.333-4.148a2.666 2.666 0 0 0-3.274 0L5.059 8.71a2.67 2.67 0 0 0-1.029 2.105v7.2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.2c0-.823-.38-1.6-1.03-2.105"
                        />
                        <path d="M16 15c-2.21 1.333-5.792 1.333-8 0" />
                    </g>
                </svg>`,
            },
            {
                id: 'ai-customize',
                label: 'AI Customization',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <path
                        fill="none"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M13 3v7h6l-8 11v-7H5z"
                    />
                </svg>`,
            },
            {
                id: 'history',
                label: 'History',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path
                            d="M10 20.777a9 9 0 0 1-2.48-.969M14 3.223a9.003 9.003 0 0 1 0 17.554m-9.421-3.684a9 9 0 0 1-1.227-2.592M3.124 10.5c.16-.95.468-1.85.9-2.675l.169-.305m2.714-2.941A9 9 0 0 1 10 3.223"
                        />
                        <path d="M12 8v4l3 3" />
                    </g>
                </svg>`,
            },
            {
                id: 'customize',
                label: 'Settings',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path
                            d="M19.875 6.27A2.23 2.23 0 0 1 21 8.218v7.284c0 .809-.443 1.555-1.158 1.948l-6.75 4.27a2.27 2.27 0 0 1-2.184 0l-6.75-4.27A2.23 2.23 0 0 1 3 15.502V8.217c0-.809.443-1.554 1.158-1.947l6.75-3.98a2.33 2.33 0 0 1 2.25 0l6.75 3.98z"
                        />
                        <path d="M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0" />
                    </g>
                </svg>`,
            },
            {
                id: 'feedback',
                label: 'Feedback',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5l-5 3v-3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM9.5 9h.01m4.99 0h.01" />
                        <path d="M9.5 13a3.5 3.5 0 0 0 5 0" />
                    </g>
                </svg>`,
            },
            {
                id: 'help',
                label: 'Help',
                icon: html`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
                        <path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9s-9-1.8-9-9s1.8-9 9-9m0 13v.01" />
                        <path d="M12 13a2 2 0 0 0 .914-3.782a1.98 1.98 0 0 0-2.414.483" />
                    </g>
                </svg>`,
            },
        ];

        return html`
            <div class="sidebar ${this._isLiveMode() ? 'hidden' : ''}">
                <div class="sidebar-brand">
                    <h1>ContextHalo</h1>
                </div>
                <nav class="sidebar-nav">
                    ${items.map(
                        item => html`
                            <button
                                class="nav-item ${this.currentView === item.id ? 'active' : ''}"
                                @click=${() => this.navigate(item.id)}
                                title=${item.label}
                            >
                                ${item.icon} ${item.label}
                            </button>
                        `
                    )}
                ${[['knowledge', 'Knowledge'], ['practice', 'Practice Lab'], ['review', 'Session Review']].map(([tab, label]) => html`
                    <button type="button" id=${`phase4-${tab}-nav`} class="nav-item" @click=${() => openPanel(this, tab)} title=${label}><span>${label}</span></button>`)}
                </nav>
                <div class="sidebar-footer">
                    ${
                        this._updateAvailable
                            ? html`
                                  <button class="update-btn" @click=${() => this.handleExternalLinkClick('https://github.com/AaryaMody1301/ContextHalo/releases/latest')}>
                                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                          <path
                                              fill="none"
                                              stroke="currentColor"
                                              stroke-linecap="round"
                                              stroke-linejoin="round"
                                              stroke-width="2"
                                              d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5l5-5m-5-7v12"
                                          />
                                      </svg>
                                      Update available
                                  </button>
                              `
                            : html` <div class="version-text">v${this._localVersion}</div> `
                    }
                </div>
            </div>
        `;
    }

    renderLiveBar() {
        const profileLabels = { interview: 'Interview workspace', meeting: 'Meeting workspace',
            sales: 'Sales workspace', presentation: 'Presentation', negotiation: 'Negotiation', exam: 'Study workspace' };
        return html`
            <header class="live-bar">
                <div class="live-bar-left">
                    <button type="button" @click=${() => this.handleClose()} title="End session and stop capture">End</button>
                </div>
                <div class="live-bar-center">${profileLabels[this.selectedProfile] || 'Session workspace'}</div>
                <div class="live-bar-right">
                    <span class="live-bar-text elapsed">${this.getElapsedTime()}</span>
                    <button type="button" @click=${() => this.handleHideToggle()} title="Hide window; capture continues. Use your visibility shortcut to show it again.">Hide</button>
                </div>
            </header>
            <div class="session-state">
                <span class="status-detail" role="status" title=${this.statusText}>${this.statusText || 'Session ready'}</span>
                <span class="search-state" title="Google Search applies to Gemini Live, typed questions and screen analysis for this session.">
                    ${this.searchState.status === 'pending' ? 'Search requested; connecting' : this.searchState.status === 'not-supported' ? 'Search unavailable with this provider' : this.searchState.effective ? 'Search enabled: Live, text, screen' : this.searchState.requested ? 'Search off for this session' : 'Search off'}
                </span>
                ${this._isClickThrough ? html`<span>Click-through on</span>` : ''}
                ${this.captureState.state !== 'ready' && this.sessionActive ? html`<div class="session-actions"><button @click=${this.restartCapture} ?disabled=${this.isInitializing}>Restart capture</button></div>` : ''}
                ${this.providerError ? html`<div class="session-actions" role="group" aria-label="Provider recovery">
                    <button @click=${() => this.retryProvider()} ?disabled=${this.providerError.retryAt > Date.now() || this.providerState === 'reconnecting'}>Retry connection</button>
                    ${this.searchState.requested && this.searchState.effective && this.providerError.canDisableSearch ? html`<button @click=${() => this.retryProvider(true)} ?disabled=${this.providerError.retryAt > Date.now()}>Continue without Search</button>` : ''}
                    <button @click=${() => this.navigate('main')}>Provider settings</button>
                </div>` : ''}
                ${this.requestError ? html`<div class="session-actions" role="alert">
                    <span>${this.requestError.message}</span>
                    <button @click=${this.retryRequest} ?disabled=${this.requestError.retryAt > Date.now()}>Retry ${this.requestError.operation === 'screen' ? 'analysis' : 'draft'}</button>
                    ${this.requestError.canDisableSearch && this.searchState.effective ? html`<button @click=${() => this.retryProvider(true)} ?disabled=${this.requestError.retryAt > Date.now()}>Continue without Search</button>` : ''}
                    <button @click=${() => this.navigate('main')}>Provider settings</button>
                </div>` : ''}
            </div>
        `;
    }

    renderWorkspace() {
        const titles = { knowledge: 'Knowledge Library', practice: 'Practice Lab', review: 'Session Review' };
        return html`<dialog class="phase4-overlay" aria-label=${titles[this.workspaceTab] || 'Session tools'} @cancel=${event => { event.preventDefault(); closePanel(this); }}>
            <div class="phase4-header"><div class="phase4-title">${titles[this.workspaceTab] || 'Session tools'}</div>
                <button type="button" class="phase4-close" aria-label="Close session tools" @click=${() => closePanel(this)}>Close</button></div>
            <div class="phase4-tabs">${[['knowledge', 'Knowledge'], ['practice', 'Practice'], ['review', 'Review']].map(([tab, label]) => html`
                <button type="button" class=${`phase4-tab ${tab === this.workspaceTab ? 'active' : ''}`} @click=${() => openPanel(this, tab)}>${label}</button>`)}</div>
            <div class="phase4-body"></div>
        </dialog>`;
    }

    render() {
        if (!this._storageLoaded) {
            return html`
                <div class="startup-shell">
                    <div class="startup-card"><span class="startup-spinner"></span><span>Loading ContextHalo settings…</span></div>
                </div>
            `;
        }

        // Onboarding is fullscreen, no sidebar
        if (this.currentView === 'onboarding') {
            return html` <div class="fullscreen">${this.renderCurrentView()}</div> `;
        }

        const isLive = this._isLiveMode();

        return html`
            <div class="app-shell ${isLive ? 'live-hud' : ''} ${this.layoutMode === 'compact' ? 'compact' : ''}">
                <div class="top-drag-bar ${isLive ? 'hidden' : ''}">
                    <div class="traffic-lights">
                        <button class="traffic-light close" @click=${() => this.handleClose()} title="Close"></button>
                        <button class="traffic-light minimize" @click=${() => this._handleMinimize()} title="Minimize"></button>
                        <button class="traffic-light maximize" @click=${() => this._handleMaximize()} title="Maximize or restore"></button>
                    </div>
                    <div class="drag-region"></div>
                </div>
                ${this.renderSidebar()}
                <div class="content">
                    ${isLive ? this.renderLiveBar() : this.sessionActive ? html`<div class="session-actions"><button @click=${() => this.navigate('assistant')}>Return to active session</button><button @click=${() => this.endSession()}>End session</button></div>` : ''}
                    <div class="content-inner ${isLive ? 'live' : ''}">${this.renderCurrentView()}</div>
                </div>
            </div>
                ${this.renderWorkspace()}
        `;
    }
}

customElements.define('context-halo-app', ContextHaloApp);
