const { ipcRenderer } = window.require('electron');

let analysisActive = false;

function localAiSupported() {
    const platform = window.process?.platform;
    const arch = window.process?.arch;
    return (platform === 'win32' && arch === 'x64') || (platform === 'darwin' && (arch === 'x64' || arch === 'arm64'));
}

function getAssistantView() {
    const appElement = document.querySelector('cheating-daddy-app');
    return appElement?.shadowRoot?.querySelector('assistant-view') || null;
}

function syncAnalyzeIndicator(active) {
    const assistant = getAssistantView();
    if (!assistant) return;
    assistant.isAnalyzing = Boolean(active);
    assistant.requestUpdate();
}

function patchResponseDeduplication() {
    const api = window.cheatingDaddy;
    if (!api || api.__finalResponseDedupPatched) return;

    const originalAddNewResponse = api.addNewResponse.bind(api);
    api.addNewResponse = response => {
        const appElement = document.querySelector('cheating-daddy-app');
        const lastResponse = appElement?.responses?.[appElement.responses.length - 1];
        if (typeof response === 'string' && response.startsWith('Error:') && lastResponse === response) {
            return;
        }
        return originalAddNewResponse(response);
    };

    api.__finalResponseDedupPatched = true;
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
            window.cheatingDaddy?.setStatus(
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
            window.cheatingDaddy?.setStatus('Analyze Screen returned an empty response. Try again.');
        }
    });
}

async function applyFinalRendererHardening() {
    patchResponseDeduplication();
    installAnalyzeLifecyclePolish();
    await patchLocalArchitectureGuard();
}

applyFinalRendererHardening().catch(error => {
    console.error('Failed to apply final renderer hardening:', error);
});
