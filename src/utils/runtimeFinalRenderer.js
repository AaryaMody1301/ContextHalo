const { ipcRenderer } = window.require('electron');

let analysisActive = false;
let typedPromptSequence = 0;
let typedPromptRequest = null;
let typedPromptTimer = null;
let typedPromptState = { phase: 'idle', message: '', error: '', restore: false };

const TYPED_PROMPT_TIMEOUT_MS = 30000;

function localAiSupported() {
    const platform = window.process?.platform;
    const arch = window.process?.arch;
    return (platform === 'win32' && arch === 'x64') || (platform === 'darwin' && (arch === 'x64' || arch === 'arm64'));
}

function getAssistantView() {
    const appElement = document.querySelector('context-halo-app');
    return appElement?.shadowRoot?.querySelector('assistant-view') || null;
}

function syncAnalyzeIndicator(active) {
    const assistant = getAssistantView();
    if (!assistant) return;
    assistant.isAnalyzing = Boolean(active);
    assistant.requestUpdate();
}

function patchResponseDeduplication() {
    const api = window.contextHalo;
    if (!api || api.__finalResponseDedupPatched) return;

    const originalAddNewResponse = api.addNewResponse.bind(api);
    api.addNewResponse = response => {
        const appElement = document.querySelector('context-halo-app');
        const lastResponse = appElement?.responses?.[appElement.responses.length - 1];
        if (typeof response === 'string' && response.startsWith('Error:') && lastResponse === response) {
            return;
        }
        return originalAddNewResponse(response);
    };

    api.__finalResponseDedupPatched = true;
}

function emitTypedPromptState(nextState) {
    typedPromptState = {
        phase: nextState?.phase || 'idle',
        message: nextState?.message || '',
        error: nextState?.error || '',
        restore: nextState?.restore === true,
    };
    window.dispatchEvent(new CustomEvent('contexthalo-typed-prompt-state', { detail: typedPromptState }));
}

function clearTypedPromptTimer() {
    if (typedPromptTimer) {
        clearTimeout(typedPromptTimer);
        typedPromptTimer = null;
    }
}

function completeTypedPrompt() {
    if (!typedPromptRequest) return;
    typedPromptRequest = null;
    clearTypedPromptTimer();
    emitTypedPromptState({ phase: 'idle' });
}

function startTypedPromptTimeout(requestId) {
    clearTypedPromptTimer();
    typedPromptTimer = setTimeout(() => {
        if (!typedPromptRequest || typedPromptRequest.id !== requestId) return;
        typedPromptRequest = null;
        typedPromptTimer = null;
        emitTypedPromptState({
            phase: 'error',
            error: 'No response received within 30 seconds.',
            restore: false,
        });
        window.contextHalo?.setStatus('No response received for the typed message. Try sending it again; session capture is still active.');
    }, TYPED_PROMPT_TIMEOUT_MS);
}

function patchTypedPromptDelivery() {
    const api = window.contextHalo;
    if (!api || api.__typedPromptDeliveryPatched) return;

    const originalSendTextMessage = api.sendTextMessage.bind(api);
    api.sendTextMessage = async text => {
        const message = String(text || '').trim();
        if (!message) return { success: false, error: 'Message cannot be empty' };

        const requestId = ++typedPromptSequence;
        typedPromptRequest = { id: requestId, message };
        clearTypedPromptTimer();
        emitTypedPromptState({ phase: 'sending', message });

        try {
            const result = await originalSendTextMessage(message);
            if (result?.success === false) {
                if (typedPromptRequest?.id === requestId) typedPromptRequest = null;
                clearTypedPromptTimer();
                emitTypedPromptState({
                    phase: 'error',
                    message,
                    error: result.error || 'Message could not be sent.',
                    restore: true,
                });
                return result;
            }

            // Groq and Local AI may stream a response before their invoke call
            // resolves. In that case the response listener has already completed
            // this request, so do not re-enter a waiting state.
            if (typedPromptRequest?.id === requestId) {
                emitTypedPromptState({ phase: 'waiting', message });
                startTypedPromptTimeout(requestId);
                setTimeout(() => {
                    if (typedPromptRequest?.id === requestId) {
                        window.contextHalo?.setStatus('Waiting for response...');
                    }
                }, 0);
            }
            return result || { success: true };
        } catch (error) {
            if (typedPromptRequest?.id === requestId) typedPromptRequest = null;
            clearTypedPromptTimer();
            emitTypedPromptState({
                phase: 'error',
                message,
                error: error?.message || String(error),
                restore: true,
            });
            throw error;
        }
    };

    ipcRenderer.on('new-response', completeTypedPrompt);
    ipcRenderer.on('update-response', completeTypedPrompt);
    api.__typedPromptDeliveryPatched = true;
}

async function patchAssistantTypedPromptUi() {
    await customElements.whenDefined('assistant-view');
    const AssistantView = customElements.get('assistant-view');
    if (!AssistantView || AssistantView.prototype.__typedPromptUiPatched) return;

    const proto = AssistantView.prototype;
    const originalConnectedCallback = proto.connectedCallback;
    const originalDisconnectedCallback = proto.disconnectedCallback;
    const originalUpdated = proto.updated;
    const originalHandleSendText = proto.handleSendText;

    proto._ensureTypedPromptUi = function () {
        const root = this.shadowRoot;
        const input = root?.querySelector('#textInput');
        const inputShell = root?.querySelector('.input-bar-inner');
        if (!root || !input || !inputShell) return;

        input.placeholder = 'Ask about this live session...';
        input.setAttribute('aria-label', 'Ask ContextHalo about this live session');

        if (!root.querySelector('style[data-typed-prompt-ui]')) {
            const style = document.createElement('style');
            style.dataset.typedPromptUi = 'true';
            style.textContent = `
                .input-bar-inner input { min-width: 0; }
                .typed-send-btn {
                    width: 26px;
                    height: 26px;
                    flex: 0 0 26px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border: none;
                    border-radius: 50%;
                    background: var(--accent);
                    color: #fff;
                    cursor: pointer;
                    padding: 0;
                    transition: opacity var(--transition), background var(--transition), transform var(--transition);
                }
                .typed-send-btn:hover:not(:disabled) { background: var(--accent-hover); transform: translateY(-1px); }
                .typed-send-btn:disabled { opacity: 0.38; cursor: default; transform: none; }
                .typed-send-btn svg { width: 14px; height: 14px; pointer-events: none; }
                .typed-send-spinner {
                    display: none;
                    width: 12px;
                    height: 12px;
                    border: 2px solid rgba(255, 255, 255, 0.35);
                    border-top-color: #fff;
                    border-radius: 50%;
                    animation: typedPromptSpin 0.75s linear infinite;
                }
                .typed-send-btn.pending .typed-send-icon { display: none; }
                .typed-send-btn.pending .typed-send-spinner { display: block; }
                @keyframes typedPromptSpin { to { transform: rotate(360deg); } }
            `;
            root.appendChild(style);
        }

        let button = root.querySelector('.typed-send-btn');
        if (!button) {
            button = document.createElement('button');
            button.type = 'button';
            button.className = 'typed-send-btn';
            button.setAttribute('aria-label', 'Send message');
            button.innerHTML = `
                <svg class="typed-send-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <span class="typed-send-spinner" aria-hidden="true"></span>
            `;
            button.addEventListener('click', () => this.handleSendText());
            inputShell.appendChild(button);
        }

        if (!input.__typedPromptInputBound) {
            input.addEventListener('input', () => this._syncTypedPromptUi());
            input.__typedPromptInputBound = true;
        }

        this._syncTypedPromptUi();
    };

    proto._syncTypedPromptUi = function () {
        const input = this.shadowRoot?.querySelector('#textInput');
        const button = this.shadowRoot?.querySelector('.typed-send-btn');
        if (!input || !button) return;

        const pending = typedPromptState.phase === 'sending' || typedPromptState.phase === 'waiting';
        button.classList.toggle('pending', pending);
        button.disabled = pending || !input.value.trim();
        button.title = pending ? (typedPromptState.phase === 'sending' ? 'Sending message...' : 'Waiting for response...') : 'Send message';
        button.setAttribute('aria-busy', String(pending));

        if (typedPromptState.phase === 'error' && typedPromptState.restore && typedPromptState.message && !input.value.trim()) {
            input.value = typedPromptState.message;
            button.disabled = false;
            input.focus();
        }
    };

    proto.handleSendText = async function (...args) {
        if (typedPromptState.phase === 'sending' || typedPromptState.phase === 'waiting') return;
        return originalHandleSendText.apply(this, args);
    };

    proto.connectedCallback = function () {
        const result = originalConnectedCallback.call(this);
        this.__typedPromptStateListener = () => this._syncTypedPromptUi();
        window.addEventListener('contexthalo-typed-prompt-state', this.__typedPromptStateListener);
        queueMicrotask(() => this._ensureTypedPromptUi());
        return result;
    };

    proto.disconnectedCallback = function () {
        if (this.__typedPromptStateListener) {
            window.removeEventListener('contexthalo-typed-prompt-state', this.__typedPromptStateListener);
            this.__typedPromptStateListener = null;
        }
        return originalDisconnectedCallback.call(this);
    };

    proto.updated = function (...args) {
        const result = originalUpdated.apply(this, args);
        this._ensureTypedPromptUi();
        return result;
    };

    proto.__typedPromptUiPatched = true;
    const activeAssistant = getAssistantView();
    if (activeAssistant) activeAssistant._ensureTypedPromptUi();
}

async function patchProviderModelSelectionGuard() {
    await customElements.whenDefined('main-view');
    const MainView = customElements.get('main-view');
    if (!MainView) return;

    const proto = MainView.prototype;
    for (let attempt = 0; attempt < 120 && !proto.__dynamicModelRegistryPatched; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (proto.__finalProviderModelGuard || typeof proto._refreshProviderModels !== 'function') return;

    const originalRefreshProviderModels = proto._refreshProviderModels;
    proto._refreshProviderModels = async function (provider, forceRefresh = false) {
        const result = await originalRefreshProviderModels.call(this, provider, forceRefresh);
        const catalog = provider === 'gemini' ? this._geminiCatalog : this._groqCatalog;
        const allModels = Array.isArray(catalog?.all) ? catalog.all : [];
        const allIds = new Set(allModels.map(model => model.id));
        if (!allIds.size) return result;

        if (provider === 'gemini') {
            const currentScreen = this._geminiHttpModel;
            if (currentScreen && !allIds.has(currentScreen)) {
                const replacement = catalog?.recommended?.screen || catalog?.screen?.[0]?.id;
                if (replacement) await this._saveGeminiHttpModel(replacement);
            }
        } else if (provider === 'groq') {
            const replacements = [
                ['_groqModel', catalog?.recommended?.chat || catalog?.chat?.[0]?.id, this._saveGroqModel],
                ['_groqImageModel', catalog?.recommended?.vision || catalog?.vision?.[0]?.id, this._saveGroqImageModel],
                ['_groqTranscriptionModel', catalog?.recommended?.transcription || catalog?.transcription?.[0]?.id, this._saveGroqTranscriptionModel],
            ];

            for (const [field, replacement, save] of replacements) {
                if (this[field] && !allIds.has(this[field]) && replacement && typeof save === 'function') {
                    await save.call(this, replacement);
                }
            }
        }

        this.requestUpdate();
        return result;
    };

    proto.__finalProviderModelGuard = true;
}

async function patchLocalArchitectureGuard() {
    await customElements.whenDefined('main-view');
    const MainView = customElements.get('main-view');
    if (!MainView || MainView.prototype.__finalArchitectureGuard) return;

    const proto = MainView.prototype;
    const originalSaveMode = proto._saveMode;
    const originalLoadFromStorage = proto._loadFromStorage;

    proto._saveMode = async function (mode) {
        if (mode === 'local' && !localAiSupported()) {
            window.contextHalo?.setStatus(
                `Local AI is not available for ${window.process.platform}/${window.process.arch}. Use Gemini or Groq.`
            );
            return;
        }
        return originalSaveMode.call(this, mode);
    };

    proto._loadFromStorage = async function (...args) {
        const result = await originalLoadFromStorage.apply(this, args);
        if (!localAiSupported() && this._mode === 'local') {
            await originalSaveMode.call(this, 'byok');
        }
        return result;
    };

    proto.__finalArchitectureGuard = true;
}

function installAnalyzeLifecyclePolish() {
    ipcRenderer.on('screen-analysis-started', () => {
        analysisActive = true;
        syncAnalyzeIndicator(true);
    });

    const keepIndicatorActive = () => {
        if (!analysisActive) return;
        queueMicrotask(() => syncAnalyzeIndicator(true));
    };
    ipcRenderer.on('new-response', keepIndicatorActive);
    ipcRenderer.on('update-response', keepIndicatorActive);

    ipcRenderer.on('screen-analysis-complete', (_event, result) => {
        analysisActive = false;
        syncAnalyzeIndicator(false);

        if (result?.success === true && Object.prototype.hasOwnProperty.call(result, 'text') && !String(result.text || '').trim()) {
            window.contextHalo?.setStatus('Analyze Screen returned an empty response. Try again.');
        }
    });
}

async function applyFinalRendererHardening() {
    patchResponseDeduplication();
    patchTypedPromptDelivery();
    installAnalyzeLifecyclePolish();
    await Promise.all([
        patchLocalArchitectureGuard(),
        patchAssistantTypedPromptUi(),
        patchProviderModelSelectionGuard(),
    ]);
}

applyFinalRendererHardening().catch(error => {
    console.error('Failed to apply final renderer hardening:', error);
});
