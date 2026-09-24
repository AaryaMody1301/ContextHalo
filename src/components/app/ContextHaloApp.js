import { initRealtimeContext, refreshPreferences, resolveSessionId, flushSessionContext } from '../../utils/realtimeContextRenderer.js';
import { loadContextState, saveSessionPack, persistPackToCurrentSession } from '../../utils/contextCaptureRenderer.js';
import { openPanel, closePanel } from '../../utils/phase4Renderer.js';
import { html, LitElement } from '../../assets/lit-core-3.3.3.min.js';
import { contextHaloAppStyles } from './ContextHaloAppStyles.js';
import { addResponseState, updateResponseState } from './responseStateRenderer.js';
import { MainView } from '../views/MainView.js';
import { CustomizeView } from '../views/CustomizeView.js';
import { HelpView } from '../views/HelpView.js';
import { HistoryView } from '../views/HistoryView.js';
import { AssistantView } from '../views/AssistantView.js';
import { OnboardingView } from '../views/OnboardingView.js';
import { AICustomizeView } from '../views/AICustomizeView.js';
import { FeedbackView } from '../views/FeedbackView.js';
import '../WindowResizeHandles.js';

export class ContextHaloApp extends LitElement {
    static styles = contextHaloAppStyles;

    static properties = {
        workspaceTab: { state: true },
        instructionDraft: { state: true },
        _detailMessage: { state: true },
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
        visibilityShortcut: { state: true },
        shortcutWarning: { state: true },
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
        _updateState: { state: true },
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
        this.searchState = { requested: false, liveEffective: false, httpEffective: false, status: 'off', liveReason: '', httpReason: '' };
        this.sessionDraft = '';
        this.requestError = null;
        this.shortcut = '';
        this.visibilityShortcut = 'Ctrl+\\';
        this.shortcutWarning = '';
        this._requestSequence = 0;
        this._requestOwners = {};
        this._requestErrors = {};
        this._detailMessage = null;
        this._responseGrounding = [];
        this._unsavedSession = false;
        this._needsRestart = false;
        this._sessionStarted = false;
        this._uiSessionEpoch = 0;
        this._startPromise = null;
        this._stopPromise = null;
        this._startController = null;
        this._captureStateListener = event => this._captureChanged(event.detail);
        this._captureRestartPromise = null;
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
        this._updateState = { status: 'checking' };
        this._whisperDownloading = false;
        this._localAiDownloadProgress = { active: false, label: '', percentage: null };
        this._localVersion = '';

        this._loadFromStorage();
        this._checkForUpdates();
    }

    async _checkForUpdates() {
        try {
            const state = await contextHalo.checkForUpdates();
            this._updateState = state || { status: 'error' };
            const fallback = state?.currentVersion || await contextHalo.getVersion();
            this._localVersion = String(state?.currentTag || fallback || '').replace(/^v/, '');
            this._updateAvailable = state?.status === 'update-available';
            this.requestUpdate();
        } catch {
            this._updateState = { status: 'error' };
            try { this._localVersion = await contextHalo.getVersion(); } catch {}
            this._updateAvailable = false;
            this.requestUpdate();
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

            const shortcuts = await contextHalo.storage.getShortcutState();
            this.refreshShortcuts(shortcuts.data, shortcuts.conflicts);
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
        void Promise.all([loadContextState(), refreshPreferences()]).catch(() => { this.startError = 'Session context could not be loaded.'; });
        this.toggleAttribute('windows', true);
        window.addEventListener('capture-state-changed', this._captureStateListener);

        const ipcRenderer = window.electronAPI;
        const listen = (channel, handler) => { ipcRenderer.on(channel, handler); this._ipcSubscriptions.push([channel, handler]); };
        listen('new-response', (_, response, metadata) => this.addNewResponse(response, metadata));
        listen('update-response', (_, response, metadata) => this.updateCurrentResponse(response, metadata));
        listen('update-status', (_, status) => this.setStatus(status));
        // Provider setup events must not release the UI's duplicate-start
        // guard while screen/audio permission and capture are still pending.
        listen('provider-state', (_, state) => this.setProviderState(state));
        listen('search-state', (_, state) => { this.searchState = state; });
        listen('provider-request-error', (_, failure, metadata) => this.handleRequestError(failure, metadata));
        listen('shortcut', (_, shortcut) => contextHalo.handleShortcut(shortcut));
        listen('click-through-toggled', (_, isEnabled) => {
            this._isClickThrough = isEnabled;
        });
        listen('capture-source-invalidated', (_, detail) => {
            if (this.sessionActive && ['active-display-changed', 'selection-changed'].includes(detail?.reason)) void this.restartCapture();
        });
        listen('reconnect-failed', (_, data) => this.setProviderState({ state: 'failed', error: data?.error || { message: data?.message || 'Provider disconnected' } }));
        listen('whisper-downloading', (_, downloading) => {
            this._whisperDownloading = downloading;
        });
        listen('local-ai-download-progress', (_, progress) => {
            this._localAiDownloadProgress = progress;
        });
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._stopTimer();
        clearTimeout(this._recoveryTimer);
        window.removeEventListener('capture-state-changed', this._captureStateListener);
        this._startController?.abort();
        if (this.sessionActive || this.isInitializing) void this.endSession().finally(() => this._disposeRealtime?.());
        else this._disposeRealtime?.();
        const ipcRenderer = window.electronAPI;
        for (const [channel, handler] of this._ipcSubscriptions) ipcRenderer.removeListener(channel, handler);
        this._ipcSubscriptions = [];
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

    refreshShortcuts(bindings = {}, conflicts = {}) {
        this.shortcut = bindings?.nextStep || 'Ctrl+Enter';
        this.visibilityShortcut = bindings?.toggleVisibility || 'Ctrl+\\';
        this.shortcutWarning = conflicts?.toggleVisibility ? 'Visibility shortcut unavailable. Use the notification-area icon or taskbar.' : '';
    }

    _beginRequest(operation, retry) {
        const owner = {
            operation, uiEpoch: this._uiSessionEpoch || 0,
            requestId: `ui-${this._uiSessionEpoch || 0}-${++this._requestSequence}`,
            sequence: this._requestSequence, retry,
        };
        this._requestOwners[operation] = owner;
        return owner;
    }

    _requestIsCurrent(owner) {
        return owner && owner.uiEpoch === (this._uiSessionEpoch || 0)
            && this._requestOwners[owner.operation]?.requestId === owner.requestId;
    }

    _refreshRequestError() {
        this.requestError = Object.values(this._requestErrors).sort((a, b) => b.sequence - a.sequence)[0] || null;
        this._scheduleRecoveryRefresh();
    }

    handleRequestError(failure, metadata) {
        // A null/legacy broadcast is not evidence that another request succeeded.
        if (!failure || !metadata?.requestId) return;
        const operation = metadata.kind || failure.operation;
        const owner = this._requestOwners[operation];
        if (owner?.outcome === 'success' || owner?.outcome === 'cancelled') return;
        if (!this._requestIsCurrent(owner) || owner.requestId !== metadata.requestId
            || metadata.uiEpoch !== owner.uiEpoch) return;
        this._requestErrors[operation] = { ...failure, operation, requestId: owner.requestId, uiEpoch: owner.uiEpoch, sequence: owner.sequence };
        this._refreshRequestError();
    }

    _finishRequest(owner, result) {
        if (!this._requestIsCurrent(owner)) return;
        owner.outcome = result?.success === true ? 'success' : result?.cancelled ? 'cancelled' : 'failed';
        if (result?.success === true || result?.cancelled || result?.failure?.category === 'cancelled') {
            if (this._detailMessage?.operation === owner.operation && this._detailMessage.uiEpoch === owner.uiEpoch) this._detailMessage = null;
            if ((this._requestErrors[owner.operation]?.sequence || 0) <= owner.sequence) delete this._requestErrors[owner.operation];
        } else {
            this._requestErrors[owner.operation] = {
                ...(result?.failure || {}), operation: owner.operation,
                message: result?.failure?.message || result?.error || 'Request failed. Retry or review settings.',
                requestId: owner.requestId, uiEpoch: owner.uiEpoch, sequence: owner.sequence,
            };
        }
        this._refreshRequestError();
    }

    async retryRequest(withoutSearch = false) {
        const failure = this.requestError;
        const owner = failure && this._requestOwners[failure.operation];
        if (!this._requestIsCurrent(owner) || failure.requestId !== owner.requestId || failure.retryAt > Date.now() || !this.sessionActive) return;
        if (withoutSearch) {
            if (!failure.canDisableSearch || this._httpSearchRetry) return;
            this._httpSearchRetry = true;
            try {
                const result = await window.electronAPI.invoke('disable-http-search', { uiEpoch: owner.uiEpoch });
                if (!this._requestIsCurrent(owner) || !result.success) return;
                this.searchState = result.search;
            } catch {
                if (this._requestIsCurrent(owner)) this._finishRequest(owner, { success: false, error: 'Could not disable Search. Retry; your draft is retained.' });
                return;
            } finally { this._httpSearchRetry = false; }
        }
        this.navigate('assistant');
        await this.updateComplete;
        if (!this._requestIsCurrent(owner)) return;
        const view = this.shadowRoot.querySelector('assistant-view');
        if (owner.operation === 'screen') return view?.handleScreenAnswer(owner.retry);
        return view?.handleSendText({ retryText: owner.retry.text });
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
        return addResponseState(this, response, metadata);
    }

    updateCurrentResponse(response, metadata) {
        return updateResponseState(this, response, metadata);
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
        this.closeSessionDetails();
        this.shadowRoot?.querySelector('.phase4-overlay')?.close();
        this._uiSessionEpoch += 1;
        this._requestOwners = {};
        this._requestErrors = {};
        this.requestError = null;
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
        await window.electronAPI.invoke('window-minimize');
    }

    async _handleMaximize() {
        await window.electronAPI.invoke('window-toggle-maximize');
    }

    async handleHideToggle() {
        await window.electronAPI.invoke('toggle-window-visibility');
    }

    // ── Session start ──

    handleStart(options = {}) {
        if (this._needsRestart) return Promise.resolve({ success: false, error: 'Restart ContextHalo to finish provider cleanup.' });
        if (this._stopPromise) return this._stopPromise.then(() => this.handleStart(options));
        if (this._startPromise && this._startEpoch === this._uiSessionEpoch) return this._startPromise;
        if (this.sessionActive) { this.navigate('assistant'); return Promise.resolve({ success: true }); }
        if (this.providerError?.retryAt > Date.now()) return Promise.resolve({ success: false, error: this.providerError.message });
        const epoch = ++this._uiSessionEpoch;
        this._requestOwners = {};
        this._requestErrors = {};
        this.requestError = null;
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
                const credentials = await this._awaitStart(contextHalo.storage.getCredentialStatus(), epoch);
                const hasKey = this.providerMode === 'groq' ? credentials?.groq === true : credentials?.gemini === true;
                if (!hasKey) throw new Error(`No ${this.providerMode === 'groq' ? 'Groq' : 'Gemini'} API key configured. Open provider settings.`);
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

    restartCapture() {
        if (!this.sessionActive || this.isInitializing) return Promise.resolve();
        if (this._captureRestartPromise) return this._captureRestartPromise;
        const epoch = this._uiSessionEpoch;
        const operation = (async () => {
            this._setLifecycle('preparing-capture', 'Restarting the selected screen and audio inputs...');
            contextHalo.stopCapture();
            try { await contextHalo.startCapture(this.selectedScreenshotInterval, this.selectedImageQuality); }
            catch { /* The capture owner publishes its recoverable failure state. */ }
            if (epoch !== this._uiSessionEpoch) return;
            this.captureState = contextHalo.getCaptureState();
            this._setLifecycle(this.captureState.state === 'ready' ? 'active' : 'capture-stopped', this.captureState.warning || this._readyStatus());
        })().finally(() => { if (this._captureRestartPromise === operation) this._captureRestartPromise = null; });
        this._captureRestartPromise = operation;
        return operation;
    }

    retryProvider(withoutSearch = false) {
        if (this.providerError?.retryAt > Date.now()) return Promise.resolve({ success: false });
        if (!this.sessionActive) return this.handleStart(withoutSearch ? { searchEnabled: false } : {});
        if (this._retryPromise) return this._retryPromise;
        const epoch = this._uiSessionEpoch;
        this.providerState = 'reconnecting';
        this._setLifecycle('reconnecting', 'Reconnecting the provider. Your draft and session history are retained.');
        const operation = window.electronAPI.invoke('retry-session-connection', { withoutSearch }).then(result => {
            if (epoch === this._uiSessionEpoch) this.setProviderState({ state: result.success ? 'ready' : 'failed', error: result.failure, search: result.search });
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
        await window.electronAPI.invoke('open-external', 'https://ai.google.dev/gemini-api/docs/api-key');
    }

    async handleGroqAPIKeyHelp() {
        await window.electronAPI.invoke('open-external', 'https://console.groq.com/keys');
    }

    // ── Settings handlers ──

    async handleProfileChange(profile) {
        this.selectedProfile = profile;
        return await contextHalo.storage.updatePreference('selectedProfile', profile);
    }

    async handleLanguageChange(language) {
        this.selectedLanguage = language;
        return await contextHalo.storage.updatePreference('selectedLanguage', language);
    }

    async handleScreenshotIntervalChange(interval) {
        this.selectedScreenshotInterval = interval;
        return await contextHalo.storage.updatePreference('selectedScreenshotInterval', interval);
    }

    async handleImageQualityChange(quality) {
        this.selectedImageQuality = quality;
        return await contextHalo.storage.updatePreference('selectedImageQuality', quality);
    }

    async handleLayoutModeChange(layoutMode) {
        this.layoutMode = layoutMode;
        await contextHalo.storage.updateConfig('layout', layoutMode);
        this.requestUpdate();
    }

    async handleExternalLinkClick(url) {
        await window.electronAPI.invoke('open-external', url);
    }

    async handleSendText(message) {
        const owner = this._beginRequest('text', { text: message });
        // A deliberate new question returns to latest; background updates do not.
        this.currentResponseIndex = this.responses.length - 1;
        this.requestUpdate();
        let result;
        try {
            result = await window.contextHalo.sendTextMessage(message, { requestId: owner.requestId, uiEpoch: owner.uiEpoch });
        } catch { result = { success: false, error: 'The request could not be completed. Your draft is retained; retry.' }; }
        if (owner.uiEpoch !== (this._uiSessionEpoch || 0)) return { success: false, cancelled: true, error: 'Session ended' };
        this._finishRequest(owner, result);
        if (this._requestIsCurrent(owner)) this.setStatus(result?.success === true ? 'Response received' : 'Text request needs attention');
        return result;
    }

    async handleAnalyzeScreen(options = {}) {
        const owner = this._beginRequest('screen', { ...(options.region ? { region: { ...options.region } } : {}) });
        let result;
        try {
            result = await contextHalo.captureManualScreenshot(null, { ...options, request: { requestId: owner.requestId, uiEpoch: owner.uiEpoch } });
        } catch (error) {
            result = { success: false, cancelled: options.signal?.aborted || error?.name === 'AbortError', error: error?.message || 'Screen analysis failed. Retry or review capture settings.' };
        }
        if (owner.uiEpoch !== (this._uiSessionEpoch || 0)) return { success: false, cancelled: true, error: 'Session ended' };
        this._finishRequest(owner, result);
        return result;
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
            // Windows CI exposed an upgraded, connected Settings element whose Lit
            // connection gate had not run after dynamic navigation. Normal custom-element
            // lifecycle is left alone; only recover a connected child with no render root.
            if (this.currentView === 'customize') {
                const settingsView = this.shadowRoot?.querySelector('customize-view');
                if (settingsView?.isConnected && !settingsView.renderRoot && typeof settingsView.connectedCallback === 'function') {
                    settingsView.connectedCallback();
                }
            }
            window.electronAPI.send('view-changed', this.currentView);
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
                    <onboarding-view .onClose=${() => this.handleClose()} .onComplete=${() => this.handleOnboardingComplete()}></onboarding-view>
                `;

            case 'main':
                return html`
                    <main-view
                        .sessionActive=${this.sessionActive}
                        .onOpenSettings=${() => this.navigate('customize')}
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
                        .draft=${this.instructionDraft}
                        @instruction-draft=${event => { this.instructionDraft = event.detail; }}
                        .selectedProfile=${this.selectedProfile}
                        .onOpenProfile=${() => this.navigate('main')}
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
                        .onOpenInstructions=${() => this.navigate('ai-customize')}
                        @shortcuts-changed=${event => this.refreshShortcuts(event.detail)}
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
                        .onAnalyzeScreen=${options => this.handleAnalyzeScreen(options)}
                        .onEndSession=${() => this.endSession()}
                        .onHideWindow=${() => this.handleHideToggle()}
                        .onShowError=${(message, operation) => this.openSessionDetails(message, operation)}
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
                <nav class="sidebar-nav" aria-label="Main navigation">
                    ${items.map(
                        item => html`
                            <button
                                class="nav-item ${this.currentView === item.id ? 'active' : ''}"
                                aria-current=${this.currentView === item.id ? 'page' : 'false'}
                                @click=${() => this.navigate(item.id)}
                                title=${item.label}
                            >
                                ${item.icon} ${item.label}
                            </button>
                        `
                    )}
                ${[['knowledge', 'Knowledge'], ['practice', 'Practice Lab'], ['review', 'Session Review']].map(([tab, label]) => html`
                    <button type="button" id=${`phase4-${tab}-nav`} class="nav-item" aria-haspopup="dialog" @click=${() => openPanel(this, tab)} title=${label}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"></rect><path d="M8 8h8M8 12h8M8 16h5"></path></svg><span>${label}</span></button>`)}
                </nav>
                <div class="sidebar-footer">
                    ${
                        this._updateAvailable
                            ? html`
                                  <button class="update-btn" title=${`Open official release ${this._updateState?.latestTag || ''}`} @click=${() => this.handleExternalLinkClick(this._updateState?.releasePageUrl || 'https://github.com/AaryaMody1301/ContextHalo/releases/latest')}>
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
                    <button type="button" @click=${() => this.handleHideToggle()} title=${`Hide without ending capture. Restore with ${this.visibilityShortcut}, the ContextHalo notification-area icon or the taskbar. ${this.shortcutWarning}`}>Hide</button>
                </div>
            </header>
            <div class="session-state">
                <span class="status-detail" role="status">${this.sessionStatusSummary()}</span>
                <span class="search-state" title="Search availability can differ between Live audio and text/screen requests. Open Session details for each path.">
                    ${this.searchState.liveEffective && !this.searchState.httpEffective ? 'Search: Live only' : this.searchState.httpEffective && !this.searchState.liveEffective ? 'Search: text/screen only' : this.searchState.status === 'pending' ? 'Search pending' : this.searchState.status === 'not-supported' ? 'Search unavailable' : this.searchState.liveEffective ? 'Search on' : this.searchState.requested ? 'Search off (session)' : 'Search off'}
                </span>
                <button type="button" aria-haspopup="dialog" @click=${() => this.openSessionDetails()}>${this.providerError || this.requestError || this.captureState.warning ? 'Resolve issue' : 'Session details'}</button>
            </div>
        `;
    }

    sessionStatusSummary() {
        const provider = { byok:'Gemini', groq:'Groq', local:'Local AI' }[this.providerMode] || 'Provider';
        if (this.providerState === 'reconnecting') return `${provider} reconnecting`;
        if (this.providerError) return `${provider} connection needs attention`;
        if (this.requestError) return this.requestError.operation === 'screen' ? 'Screen analysis needs attention' : 'Text request needs attention';
        if (this._isClickThrough) return 'Click-through on - use visibility shortcut or tray to recover';
        if (this.providerState !== 'ready') return `${provider} ${this.providerState || 'unavailable'}`;
        if (!this.captureState.audioReady) return `${provider} ready - audio stopped`;
        return `${provider} ready - ${this.captureState.microphone && this.captureState.system ? 'mixed audio' : this.captureState.microphone ? 'microphone' : 'speaker audio'}`;
    }

    async openSessionDetails(message, operation) {
        this._detailMessage = message ? { message:String(message).slice(0,4000), operation, uiEpoch:this._uiSessionEpoch } : null;
        this.requestUpdate();
        await this.updateComplete;
        const dialog = this.shadowRoot.querySelector('.session-details');
        if (dialog && !dialog.open) dialog.showModal();
    }

    closeSessionDetails() { this.shadowRoot.querySelector('.session-details')?.close(); }

    renderSessionDetails() {
        return html`<dialog class="session-details" aria-labelledby="session-details-title">
            <div class="details-header session-actions"><h2 id="session-details-title">Session details</h2>
                <button type="button" @click=${() => { this.closeSessionDetails(); this.endSession(); }}>End session</button>
                <button type="button" @click=${() => { this.closeSessionDetails(); this.handleHideToggle(); }}>Hide</button>
                <button type="button" @click=${this.closeSessionDetails} aria-label="Close session details">Close</button></div>
            <div class="details-body" tabindex="0" aria-label="Session details">
                ${this.requestError ? html`<h3>${this.requestError.operation === 'screen' ? 'Screen analysis needs attention' : 'Text request needs attention'}</h3>
                    <div class="session-actions" role="group" aria-label="Request recovery">
                        <button @click=${() => { this.closeSessionDetails(); this.retryRequest(); }} ?disabled=${this.requestError.retryAt > Date.now()}>Retry ${this.requestError.operation === 'screen' ? 'analysis' : 'message'}</button>
                        ${this.requestError.canDisableSearch && this.searchState.httpEffective ? html`<button @click=${() => { this.closeSessionDetails(); this.retryRequest(true); }} ?disabled=${this.requestError.retryAt > Date.now()}>Retry request without Search</button>` : ''}
                        <button @click=${() => { this.closeSessionDetails(); this.navigate('main'); }}>Provider settings</button>
                    </div>
                    ${this.requestError.retryAt > Date.now() ? html`<p>Retry available after ${new Date(this.requestError.retryAt).toLocaleTimeString()}.</p>` : ''}
                    ${this.requestError.model ? html`<p>Model: ${this.requestError.model}</p>` : ''}
                    <details class="error-details"><summary>Read request error</summary><p>${this.requestError.message}</p></details>
                ` : this._detailMessage?.uiEpoch === this._uiSessionEpoch ? html`<p>${this._detailMessage.message}</p>` : ''}
                ${this.providerError ? html`<h3>Provider connection needs attention</h3><div class="session-actions" role="group" aria-label="Provider recovery">
                    <button @click=${() => this.retryProvider()} ?disabled=${this.providerError.retryAt > Date.now() || this.providerState === 'reconnecting'}>Retry connection</button>
                    ${this.searchState.requested && this.searchState.liveEffective && this.providerError.canDisableSearch ? html`<button @click=${() => this.retryProvider(true)} ?disabled=${this.providerError.retryAt > Date.now()}>Continue without Search</button>` : ''}
                    <button @click=${() => { this.closeSessionDetails(); this.navigate('main'); }}>Provider settings</button></div>
                    ${this.providerError.retryAt > Date.now() ? html`<p>Retry available after ${new Date(this.providerError.retryAt).toLocaleTimeString()}.</p>` : ''}
                    <details class="error-details"><summary>Read connection error</summary><p>${this.providerError.message}</p></details>` : ''}
                ${this.captureState.state !== 'ready' && this.sessionActive ? html`<h3>Capture</h3><div class="session-actions"><button @click=${this.restartCapture} ?disabled=${this.isInitializing}>Restart capture</button></div><p>${this.captureState.warning || 'Capture is stopped. Typed questions can still work while the provider is connected.'}</p>` : ''}
                <h3>Session connection</h3>
                <details><summary>Connection and capture status</summary><p>${this.statusText || this._readyStatus()}</p></details>
                ${this.searchState.liveReason ? html`<p>Live Search: ${this.searchState.liveReason}</p>` : ''}
                ${this.searchState.httpReason ? html`<p>Text/screen Search: ${this.searchState.httpReason}</p>` : ''}
                <p>Search requested: ${this.searchState.requested ? 'yes' : 'no'}. Live audio Search: ${this.searchState.liveEffective ? 'enabled' : 'off'}. Text and screen Search: ${this.searchState.httpEffective ? 'enabled' : 'off'}. Your saved preference is unchanged. Enabled means the tool is available; Google decides whether a request needs a search.</p>
                <h3>Window visibility</h3>
                <p>Restore with ${this.visibilityShortcut} or the ContextHalo notification-area icon. If the icon is unavailable, Hide minimizes to the taskbar. Hiding and minimizing do not stop capture.</p>
                ${this.shortcutWarning ? html`<p>${this.shortcutWarning}</p>` : ''}
            </div>
        </dialog>`;
    }

    renderWorkspace() {
        const titles = { knowledge: 'Knowledge Library', practice: 'Practice Lab', review: 'Session Review' };
        return html`<dialog class="phase4-overlay" aria-label=${titles[this.workspaceTab] || 'Session tools'} @cancel=${event => { event.preventDefault(); closePanel(this); }}>
            <div class="phase4-header"><div class="phase4-title">${titles[this.workspaceTab] || 'Session tools'}</div>
                <button type="button" class="phase4-close" aria-label="Close session tools" @click=${() => closePanel(this)}>Close</button></div>
            <div class="phase4-tabs">${[['knowledge', 'Knowledge'], ['practice', 'Practice'], ['review', 'Review']].map(([tab, label]) => html`
                <button type="button" class=${`phase4-tab ${tab === this.workspaceTab ? 'active' : ''}`} aria-pressed=${tab === this.workspaceTab ? 'true' : 'false'} @click=${() => openPanel(this, tab)}>${label}</button>`)}</div>
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
            return html`<window-resize-handles></window-resize-handles><div class="fullscreen">${this.renderCurrentView()}</div>`;
        }

        const isLive = this._isLiveMode();

        return html`
            <window-resize-handles></window-resize-handles>
            <div class="app-shell ${isLive ? 'live-hud' : ''} ${this.layoutMode === 'compact' ? 'compact' : ''}">
                <div class="top-drag-bar ${isLive ? 'hidden' : ''}">
                    <div class="traffic-lights">
                        <button class="traffic-light close" @click=${() => this.handleClose()} title="Close"></button>
                        <button class="traffic-light minimize" @click=${() => this._handleMinimize()} title="Minimize"></button>
                        <button class="traffic-light maximize" @click=${() => this._handleMaximize()} title="Fit workspace or restore"></button>
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
                ${this.renderSessionDetails()}
        `;
    }
}

customElements.define('context-halo-app', ContextHaloApp);
