const { ipcRenderer } = window.require('electron');

const trackedMicStreams = new Set();
const trackedAudioContexts = new Set();
let displayCaptureEnded = false;
let analyzePromise = null;

function patchMediaCaptureTracking() {
    const devices = navigator.mediaDevices;
    if (!devices || devices.__runtimeHardened) return;

    if (typeof devices.getUserMedia === 'function') {
        const originalGetUserMedia = devices.getUserMedia.bind(devices);
        devices.getUserMedia = async constraints => {
            const stream = await originalGetUserMedia(constraints);
            if (constraints?.audio) trackedMicStreams.add(stream);
            return stream;
        };
    }

    if (typeof devices.getDisplayMedia === 'function') {
        const originalGetDisplayMedia = devices.getDisplayMedia.bind(devices);
        devices.getDisplayMedia = async constraints => {
            const stream = await originalGetDisplayMedia(constraints);
            displayCaptureEnded = false;
            for (const track of stream.getVideoTracks()) {
                track.addEventListener(
                    'ended',
                    () => {
                        displayCaptureEnded = true;
                        window.cheatingDaddy?.setStatus('Screen sharing stopped. End the session and start again to resume Analyze Screen.');
                    },
                    { once: true }
                );
            }
            return stream;
        };
    }

    devices.__runtimeHardened = true;
}

function patchAudioContextTracking() {
    const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
    if (!OriginalAudioContext || OriginalAudioContext.__runtimeHardened) return;

    const HardenedAudioContext = new Proxy(OriginalAudioContext, {
        construct(target, args) {
            const context = Reflect.construct(target, args, target);
            trackedAudioContexts.add(context);
            const originalClose = context.close?.bind(context);
            if (originalClose) {
                context.close = async (...closeArgs) => {
                    try {
                        return await originalClose(...closeArgs);
                    } finally {
                        trackedAudioContexts.delete(context);
                    }
                };
            }
            return context;
        },
    });

    Object.defineProperty(HardenedAudioContext, '__runtimeHardened', { value: true });
    window.AudioContext = HardenedAudioContext;
    if (window.webkitAudioContext) window.webkitAudioContext = HardenedAudioContext;
}

function cleanupTrackedCaptureResources() {
    for (const stream of trackedMicStreams) {
        for (const track of stream.getTracks()) {
            try {
                track.stop();
            } catch {}
        }
    }
    trackedMicStreams.clear();

    for (const context of trackedAudioContexts) {
        if (context.state !== 'closed') {
            Promise.resolve(context.close()).catch(() => {});
        }
    }
    trackedAudioContexts.clear();
    displayCaptureEnded = false;
}

function patchCheatingDaddyFacade() {
    const api = window.cheatingDaddy;
    if (!api || api.__runtimeHardened) return;

    const originalStopCapture = api.stopCapture.bind(api);
    api.stopCapture = (...args) => {
        try {
            return originalStopCapture(...args);
        } finally {
            cleanupTrackedCaptureResources();
        }
    };

    api.getVersion = async () => {
        const result = await ipcRenderer.invoke('get-app-version');
        if (result?.success) return result.data;
        throw new Error(result?.error || 'Could not read app version');
    };

    api.__runtimeHardened = true;
}

function sanitizeRenderedHtml(html) {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(String(html || ''), 'text/html');
    const blockedTags = new Set([
        'SCRIPT',
        'STYLE',
        'IFRAME',
        'OBJECT',
        'EMBED',
        'FORM',
        'INPUT',
        'BUTTON',
        'TEXTAREA',
        'SELECT',
        'OPTION',
        'META',
        'LINK',
        'BASE',
        'SVG',
        'MATH',
    ]);
    const allowedAttributes = new Set(['class', 'data-word']);

    for (const element of Array.from(parsed.body.querySelectorAll('*'))) {
        if (blockedTags.has(element.tagName)) {
            element.replaceWith(parsed.createTextNode(element.textContent || ''));
            continue;
        }

        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase();
            if (name.startsWith('on') || name === 'style' || name === 'srcdoc') {
                element.removeAttribute(attribute.name);
                continue;
            }

            if (element.tagName === 'A' && name === 'href') {
                try {
                    const url = new URL(attribute.value);
                    if (!['http:', 'https:'].includes(url.protocol)) {
                        element.removeAttribute('href');
                    } else {
                        element.setAttribute('rel', 'noopener noreferrer');
                    }
                } catch {
                    element.removeAttribute('href');
                }
                continue;
            }

            if (!allowedAttributes.has(name)) element.removeAttribute(attribute.name);
        }
    }

    return parsed.body.innerHTML;
}

function waitForIpcEvent(channel, timeoutMs, timeoutMessage) {
    return new Promise(resolve => {
        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            ipcRenderer.removeListener(channel, listener);
            resolve(value);
        };
        const listener = (_event, value) => finish(value ?? true);
        const timer = setTimeout(() => finish({ success: false, error: timeoutMessage }), timeoutMs);
        ipcRenderer.on(channel, listener);
    });
}

async function runAnalyzeScreen() {
    if (analyzePromise) return analyzePromise;

    analyzePromise = (async () => {
        if (displayCaptureEnded) {
            return { success: false, error: 'Screen sharing has stopped. End the session and start a new one.' };
        }
        if (typeof window.captureManualScreenshot !== 'function') {
            return { success: false, error: 'Screen capture is not ready.' };
        }

        const started = waitForIpcEvent('screen-analysis-started', 5000, 'Could not capture a usable screen image.');
        const completed = waitForIpcEvent('screen-analysis-complete', 60000, 'Analyze Screen timed out after 60 seconds.');

        try {
            await Promise.resolve(window.captureManualScreenshot());
        } catch (error) {
            return { success: false, error: error?.message || String(error) };
        }

        const startedResult = await started;
        if (startedResult?.success === false) return startedResult;
        return await completed;
    })();

    try {
        return await analyzePromise;
    } finally {
        analyzePromise = null;
    }
}

async function patchAssistantView() {
    await customElements.whenDefined('assistant-view');
    const AssistantView = customElements.get('assistant-view');
    if (!AssistantView || AssistantView.prototype.__runtimeHardened) return;

    const proto = AssistantView.prototype;
    const originalRenderMarkdown = proto.renderMarkdown;
    const originalUpdated = proto.updated;

    proto.renderMarkdown = function (content) {
        return sanitizeRenderedHtml(originalRenderMarkdown.call(this, content));
    };

    proto.handleScreenAnswer = async function () {
        if (this.isAnalyzing || analyzePromise) return;
        this.isAnalyzing = true;
        try {
            const result = await runAnalyzeScreen();
            if (!result?.success) {
                const message = result?.error || 'Analyze Screen failed.';
                window.cheatingDaddy?.setStatus('Analyze error: ' + message);
                window.cheatingDaddy?.addNewResponse(`Error: ${message}`);
            }
        } finally {
            this.isAnalyzing = false;
            this.requestUpdate();
        }
    };

    proto.updated = function (changedProperties) {
        const result = originalUpdated.call(this, changedProperties);
        const responseContainer = this.shadowRoot?.querySelector('#responseContainer');
        if (responseContainer && !responseContainer.dataset.externalLinksBound) {
            responseContainer.dataset.externalLinksBound = 'true';
            responseContainer.addEventListener('click', event => {
                const anchor = event.target?.closest?.('a[href]');
                if (!anchor) return;
                event.preventDefault();
                event.stopPropagation();
                ipcRenderer.invoke('open-external', anchor.href).catch(error => console.error('Could not open link:', error));
            });
        }
        return result;
    };

    proto.__runtimeHardened = true;
}

async function patchMainViewPlatformGuard() {
    await customElements.whenDefined('main-view');
    const MainView = customElements.get('main-view');
    if (!MainView || MainView.prototype.__platformHardened) return;

    const proto = MainView.prototype;
    const originalSaveMode = proto._saveMode;
    proto._saveMode = async function (mode) {
        if (mode === 'local' && !['win32', 'darwin'].includes(window.process.platform)) {
            window.cheatingDaddy?.setStatus(`Local AI is not available on ${window.process.platform}. Use Gemini or Groq.`);
            return;
        }
        return originalSaveMode.call(this, mode);
    };

    if (!['win32', 'darwin'].includes(window.process.platform) && this?._mode === 'local') {
        await originalSaveMode.call(this, 'byok');
    }

    proto.__platformHardened = true;
}

async function patchAppLifecycle() {
    await customElements.whenDefined('cheating-daddy-app');
    const App = customElements.get('cheating-daddy-app');
    if (!App || App.prototype.__runtimeHardened) return;

    const proto = App.prototype;
    const originalHandleStart = proto.handleStart;
    const originalUpdated = proto.updated;

    proto.handleStart = async function (...args) {
        if (this._runtimeStartPromise) return this._runtimeStartPromise;

        const mainView = this.shadowRoot?.querySelector('main-view');
        if (mainView) {
            mainView.isInitializing = true;
            mainView.requestUpdate();
        }

        this._runtimeStartPromise = Promise.resolve(originalHandleStart.apply(this, args));
        try {
            return await this._runtimeStartPromise;
        } finally {
            this._runtimeStartPromise = null;
            const currentMainView = this.shadowRoot?.querySelector('main-view');
            if (currentMainView) {
                currentMainView.isInitializing = false;
                currentMainView.requestUpdate();
            }
        }
    };

    proto.updated = function (changedProperties) {
        const result = originalUpdated.call(this, changedProperties);
        const maximizeButton = this.shadowRoot?.querySelector('.traffic-light.maximize');
        if (maximizeButton && !maximizeButton.dataset.runtimeBound) {
            maximizeButton.dataset.runtimeBound = 'true';
            maximizeButton.addEventListener('click', () => {
                ipcRenderer.invoke('window-toggle-maximize').catch(error => console.error('Maximize failed:', error));
            });
        }
        return result;
    };

    proto.__runtimeHardened = true;

    const appElement = document.querySelector('cheating-daddy-app');
    if (appElement) {
        try {
            appElement._localVersion = await window.cheatingDaddy.getVersion();
            appElement.requestUpdate();
        } catch {}
    }
}

function installRuntimeEventHandlers() {
    ipcRenderer.on('session-initializing', (_event, initializing) => {
        const appElement = document.querySelector('cheating-daddy-app');
        const mainView = appElement?.shadowRoot?.querySelector('main-view');
        if (mainView) {
            mainView.isInitializing = Boolean(initializing);
            mainView.requestUpdate();
        }
    });

    ipcRenderer.on('shortcut', (_event, shortcutKey) => {
        if (shortcutKey !== 'ctrl+enter' && shortcutKey !== 'cmd+enter') return;
        const appElement = document.querySelector('cheating-daddy-app');
        if (!appElement) return;

        if (appElement.currentView === 'main') {
            void appElement.handleStart();
            return;
        }

        if (appElement.currentView === 'assistant') {
            const assistant = appElement.shadowRoot?.querySelector('assistant-view');
            if (assistant?.handleScreenAnswer) void assistant.handleScreenAnswer();
        }
    });
}

async function applyRuntimeHardening() {
    patchMediaCaptureTracking();
    patchAudioContextTracking();
    patchCheatingDaddyFacade();
    installRuntimeEventHandlers();
    await Promise.all([patchAssistantView(), patchMainViewPlatformGuard(), patchAppLifecycle()]);
}

applyRuntimeHardening().catch(error => {
    console.error('Failed to apply renderer runtime hardening:', error);
});
