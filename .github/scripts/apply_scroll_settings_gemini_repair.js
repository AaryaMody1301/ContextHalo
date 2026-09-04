const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}
function write(path, content) {
  fs.writeFileSync(path, content.replace(/\n/g, '\r\n'), 'utf8');
}
function replaceOnce(content, from, to, label) {
  const first = content.indexOf(from);
  if (first === -1) throw new Error(`Missing patch target: ${label}`);
  if (content.indexOf(from, first + from.length) !== -1) throw new Error(`Ambiguous patch target: ${label}`);
  return content.slice(0, first) + to + content.slice(first + from.length);
}

// ---- Home/app scroll ownership and Settings linkage ----
{
  const path = 'src/components/app/ContextHaloApp.js';
  let s = read(path);
  s = replaceOnce(s,
`        .content-inner {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
        }`,
`        .content-inner {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
            overscroll-behavior: contain;
            scroll-behavior: auto;
        }`, 'content scroll owner');

  s = replaceOnce(s,
`    navigate(view) {
        this.currentView = view;
        this.requestUpdate();
    }`,
`    navigate(view) {
        this.currentView = view;
        this.requestUpdate();
        // Normal pages share one scroll owner (.content-inner). Reset it after
        // navigation so Home/Settings always open at their real top edge.
        this.updateComplete.then(() => this._resetContentScroll());
    }

    _resetContentScroll() {
        const content = this.shadowRoot?.querySelector('.content-inner');
        if (!content || this._isLiveMode()) return;
        content.scrollTop = 0;
        content.scrollLeft = 0;
    }`, 'navigate scroll reset');

  s = replaceOnce(s,
`        if (changedProperties.has('currentView') && window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send('view-changed', this.currentView);
        }`,
`        if (changedProperties.has('currentView')) {
            this._resetContentScroll();
            if (window.require) {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.send('view-changed', this.currentView);
            }
        }`, 'updated scroll reset');

  s = replaceOnce(s,
`                        .onLayoutModeChange=${lm => this.handleLayoutModeChange(lm)}
                    ></customize-view>`,
`                        .onLayoutModeChange=${lm => this.handleLayoutModeChange(lm)}
                        .onOpenProviderSettings=${() => this.navigate('main')}
                    ></customize-view>`, 'Settings provider navigation callback');
  write(path, s);
}

// Home must not be a nested scroller.
{
  const path = 'src/components/views/MainView.js';
  let s = read(path);
  s = replaceOnce(s,
`        :host {
            height: 100%;
            min-height: 100%;
            display: block;
            overflow-y: auto;
            padding: 58px clamp(24px, 6vw, 72px) 44px;
        }`,
`        :host {
            display: block;
            width: 100%;
            min-height: 100%;
            height: auto;
            overflow: visible;
            box-sizing: border-box;
            padding: 58px clamp(24px, 6vw, 72px) 44px;
        }`, 'MainView nested scroll');
  write(path, s);
}

// Shared Settings/pages must use the app-level content scroller.
{
  const path = 'src/components/views/sharedPageStyles.js';
  let s = read(path);
  s = replaceOnce(s,
`    :host {
        display: block;
        height: 100%;
    }

    .unified-page {
        height: 100%;
        overflow-y: auto;
        padding: var(--space-lg);
        background: var(--bg-app);
    }`,
`    :host {
        display: block;
        width: 100%;
        min-height: 100%;
        height: auto;
    }

    .unified-page {
        min-height: 100%;
        height: auto;
        overflow: visible;
        padding: 58px var(--space-lg) var(--space-lg);
        background: var(--bg-app);
    }`, 'unified page nested scroll');
  write(path, s);
}

// Make provider/model setup explicitly reachable from Settings instead of
// duplicating secret/model state in two separate components.
{
  const path = 'src/components/views/CustomizeView.js';
  let s = read(path);
  s = replaceOnce(s,
`        onLayoutModeChange: { type: Function },
        isClearing: { type: Boolean },`,
`        onLayoutModeChange: { type: Function },
        onOpenProviderSettings: { type: Function },
        isClearing: { type: Boolean },`, 'Settings provider callback property');
  s = replaceOnce(s,
`        this.onLayoutModeChange = () => {};
        this.googleSearchEnabled = true;`,
`        this.onLayoutModeChange = () => {};
        this.onOpenProviderSettings = () => {};
        this.googleSearchEnabled = true;`, 'Settings provider callback default');
  s = replaceOnce(s,
`    renderAISection() {
        return html\``,
`    renderProviderSection() {
        return html\`
            <section class="surface">
                <div class="surface-title">AI Provider & Models</div>
                <div class="surface-subtitle">API keys and provider-specific model choices are shared with the Home session setup.</div>
                <div class="form-group">
                    <div class="form-help">Open the provider setup to select Gemini, Groq, or Local AI and refresh compatible models.</div>
                    <button class="control" style="width:auto;cursor:pointer;" @click=\${() => this.onOpenProviderSettings()}>Open provider setup</button>
                </div>
            </section>
        \`;
    }

    renderAISection() {
        return html\``, 'provider Settings section');
  s = replaceOnce(s,
`                    ${this.renderSessionSection()}
                    ${this.renderAISection()}`, 
`                    ${this.renderSessionSection()}
                    ${this.renderProviderSection()}
                    ${this.renderAISection()}`, 'render provider Settings section');
  write(path, s);
}

// ---- Gemini Live connection reliability and diagnostics ----
{
  const path = 'src/utils/gemini.js';
  let s = read(path);
  s = replaceOnce(s,
`const { startTransportLog, logTransportEvent, closeTransportLog } = require('./transportLogger');`,
`const { startTransportLog, logTransportEvent, closeTransportLog } = require('./transportLogger');
const { listProviderModels } = require('./providerModelRegistry');`, 'Gemini registry import');
  s = replaceOnce(s,
`let geminiSessionResumptionHandle = null;`,
`let geminiSessionResumptionHandle = null;
let lastGeminiInitializationError = '';`, 'Gemini init error state');

  const oldFormat = `function formatGeminiError(error) {
    const message = String(error?.message || error || '');
    const normalized = message.toLowerCase();
    if (normalized.includes('api key') || normalized.includes('unauthenticated') || normalized.includes('401')) {
        return 'Gemini authentication failed. Check that the API key is valid and enabled for the Gemini API.';
    }
    if (normalized.includes('resource_exhausted') || normalized.includes('quota') || normalized.includes('429')) {
        return 'Gemini quota or rate limit reached. Wait for the provider reset or use a project with available quota.';
    }
    if (normalized.includes('not found') || normalized.includes('404') || normalized.includes('model')) {
        return 'Gemini could not access the configured Live model. Check model availability for this API key.';
    }
    return message ? \`Gemini connection failed: \${message}\` : 'Gemini connection failed.';
}`;
  const newFormat = `function getGeminiErrorDetail(error) {
    const values = [
        error?.message,
        error?.reason,
        error?.error?.message,
        error?.error?.status,
        error?.status,
        Number.isFinite(error?.code) ? \`code \${error.code}\` : '',
    ].filter(Boolean).map(String);
    return [...new Set(values)].join(' · ') || String(error || 'Unknown Gemini error');
}

function formatGeminiError(error) {
    const detail = getGeminiErrorDetail(error);
    const normalized = detail.toLowerCase();
    if (normalized.includes('api key') || normalized.includes('unauthenticated') || normalized.includes('401')) {
        return \`Gemini authentication failed: \${detail}. Check the API key and that the Gemini API is enabled for its project.\`;
    }
    if (normalized.includes('permission_denied') || normalized.includes('forbidden') || normalized.includes('403')) {
        return \`Gemini permission denied: \${detail}. Check API-key restrictions and project access.\`;
    }
    if (normalized.includes('resource_exhausted') || normalized.includes('quota') || normalized.includes('429')) {
        return \`Gemini quota or rate limit reached: \${detail}\`;
    }
    if (normalized.includes('not found') || normalized.includes('404')) {
        return \`Gemini could not access the configured Live model: \${detail}\`;
    }
    if (normalized.includes('invalid argument') || normalized.includes('1007')) {
        return \`Gemini rejected the Live session setup: \${detail}\`;
    }
    return \`Gemini Live connection failed: \${detail}\`;
}

async function getGeminiLivePreflightError(apiKey, liveModel) {
    try {
        const catalog = await listProviderModels('gemini', apiKey);
        const liveModels = Array.isArray(catalog?.live) ? catalog.live : [];
        if (!liveModels.some(model => model.id === liveModel)) {
            const suggested = catalog?.recommended?.live || liveModels[0]?.id || 'a Live-compatible model';
            return \`Gemini API key is valid, but \${liveModel} is not available as a Live model for this key. Choose \${suggested} and try again.\`;
        }
        return '';
    } catch (error) {
        return \`Gemini API preflight failed: \${getGeminiErrorDetail(error)}\`;
    }
}

function connectGeminiLiveWithGuard(client, params, timeoutMs = 15000) {
    let setupFinished = false;
    let rejectEarly = () => {};
    let timer = null;
    const earlyFailure = new Promise((_, reject) => { rejectEarly = reject; });
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(\`Gemini Live setup timed out after \${Math.ceil(timeoutMs / 1000)} seconds\`)), timeoutMs);
    });
    const callbacks = params.callbacks || {};
    const wrappedCallbacks = {
        ...callbacks,
        onerror(event) {
            callbacks.onerror?.(event);
            if (!setupFinished) rejectEarly(new Error(\`Gemini Live socket error: \${getGeminiErrorDetail(event)}\`));
        },
        onclose(event) {
            callbacks.onclose?.(event);
            if (!setupFinished) {
                const code = Number.isFinite(event?.code) ? \`code \${event.code}\` : 'no close code';
                const reason = event?.reason ? \`: \${event.reason}\` : '';
                rejectEarly(new Error(\`Gemini Live closed during setup (\${code})\${reason}\`));
            }
        },
    };

    return Promise.race([
        client.live.connect({ ...params, callbacks: wrappedCallbacks }),
        earlyFailure,
        timeout,
    ]).then(session => {
        setupFinished = true;
        if (timer) clearTimeout(timer);
        return session;
    }, error => {
        setupFinished = true;
        if (timer) clearTimeout(timer);
        throw error;
    });
}`;
  s = replaceOnce(s, oldFormat, newFormat, 'Gemini error diagnostics');

  s = replaceOnce(s,
`    isInitializingSession = true;
    if (!isReconnect) {
        sendToRenderer('session-initializing', true);
    }`,
`    isInitializingSession = true;
    if (!isReconnect) {
        // A user-requested new session must never inherit a resumption token or
        // close-state from a previous Live connection.
        geminiSessionResumptionHandle = null;
        isUserClosing = false;
        lastGeminiInitializationError = '';
        sendToRenderer('session-initializing', true);
    }`, 'fresh Gemini state');

  s = replaceOnce(s,
`    // Initialize new conversation session only on first connect
    if (!isReconnect) {
        initializeNewSession(profile, customPrompt);
    }

    try {
        const session = await client.live.connect({`,
`    if (!isReconnect) {
        const preflightError = await getGeminiLivePreflightError(apiKey, liveModel);
        if (preflightError) {
            lastGeminiInitializationError = preflightError;
            sendToRenderer('update-status', preflightError);
            isInitializingSession = false;
            sendToRenderer('session-initializing', false);
            return null;
        }
    }

    let liveSessionReady = false;
    let connectedWithoutSearch = false;
    const callbacks = {`, 'Gemini preflight and callbacks start');

  // The previous replacement changed the beginning of the object. Turn the end of
  // callbacks into a reusable config/connect sequence.
  s = replaceOnce(s,
`            },
            config: {
                responseModalities: [Modality.AUDIO],
                // Gemini 3.1 Live documents these as empty configuration
                // objects. Speaker diarization fields are not valid Live API
                // transcription settings and can cause an invalid setup request.
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                ...(geminiSessionResumptionHandle
                    ? { sessionResumption: { handle: geminiSessionResumptionHandle } }
                    : {}),
                tools: enabledTools,
                thinkingConfig: { thinkingLevel: 'minimal' },
                systemInstruction: {
                    parts: [{ text: systemPrompt }],
                },
            },
        });

        isInitializingSession = false;`,
`            },
        };

        const baseConfig = {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: { parts: [{ text: systemPrompt }] },
        };
        const preferredConfig = enabledTools.length
            ? { ...baseConfig, tools: enabledTools }
            : baseConfig;

        let session;
        try {
            session = await connectGeminiLiveWithGuard(client, {
                model: liveModel,
                callbacks,
                config: preferredConfig,
            });
        } catch (firstError) {
            // Google Search is optional and has had Live-session compatibility
            // regressions. If it was enabled, retry once with the documented
            // core Live configuration instead of making the whole session unusable.
            if (!enabledTools.length) throw firstError;
            sendToRenderer('update-status', 'Gemini Live setup failed with Search enabled; retrying without Search...');
            session = await connectGeminiLiveWithGuard(client, {
                model: liveModel,
                callbacks,
                config: baseConfig,
            });
            connectedWithoutSearch = true;
        }

        liveSessionReady = true;
        if (!isReconnect) initializeNewSession(profile, customPrompt);
        lastGeminiInitializationError = '';
        if (connectedWithoutSearch) {
            sendToRenderer('update-status', 'Live session connected (Google Search disabled for this session)');
        }

        isInitializingSession = false;`, 'Gemini safe Live config');

  s = replaceOnce(s,
`                onerror: function (e) {
                    console.log('Session error:', e.message);
                    logTransportEvent('gemini.live.error', {
                        error: e.message,
                    });
                    sendToRenderer('update-status', 'Error: ' + e.message);
                },`,
`                onerror: function (e) {
                    const detail = formatGeminiError(e);
                    console.log('Session error:', getGeminiErrorDetail(e));
                    logTransportEvent('gemini.live.error', { error: getGeminiErrorDetail(e) });
                    if (!liveSessionReady) lastGeminiInitializationError = detail;
                    sendToRenderer('update-status', detail);
                },`, 'Gemini socket error callback');

  s = replaceOnce(s,
`                onclose: function (e) {
                    console.log('Session closed:', e.reason);
                    logTransportEvent('gemini.live.closed', {
                        reason: e.reason,
                    });

                    // Don't reconnect if user intentionally closed`,
`                onclose: function (e) {
                    const closeDetail = \`Gemini Live closed\${Number.isFinite(e?.code) ? \` (code \${e.code})\` : ''}\${e?.reason ? \`: \${e.reason}\` : ''}\`;
                    console.log('Session closed:', closeDetail);
                    logTransportEvent('gemini.live.closed', { reason: closeDetail });

                    if (!liveSessionReady) {
                        lastGeminiInitializationError = closeDetail;
                        sendToRenderer('update-status', closeDetail);
                        return;
                    }

                    // Don't reconnect if user intentionally closed`, 'Gemini setup close handling');

  s = replaceOnce(s,
`    } catch (error) {
        const message = formatGeminiError(error);
        console.error('Failed to initialize Gemini session:', error);`,
`    } catch (error) {
        let message = formatGeminiError(error);
        if (!isReconnect && /api request error|socket|setup|closed|timed out/i.test(getGeminiErrorDetail(error))) {
            const preflightError = await getGeminiLivePreflightError(apiKey, liveModel);
            if (!preflightError) {
                message = \`\${message}. The API key can list \${liveModel}, so the failure is in the Live WebSocket/setup path rather than model discovery.\`;
            } else {
                message = preflightError;
            }
        }
        lastGeminiInitializationError = message;
        console.error('Failed to initialize Gemini session:', error);`, 'Gemini catch diagnosis');

  s = replaceOnce(s,
`        return { success: false, error: 'Gemini session could not be initialized. Check the status message for details.' };`,
`        return { success: false, error: lastGeminiInitializationError || 'Gemini session could not be initialized.' };`, 'Gemini exact IPC error');
  write(path, s);
}

// ---- Real renderer smoke must validate navigation/scrolling, not only text ----
{
  const path = 'src/index.js';
  let s = read(path);
  s = replaceOnce(s,
`                    const settingsView = document.createElement('customize-view');
                    settingsView.style.display = 'none';
                    document.body.appendChild(settingsView);
                    await settingsView.updateComplete;
                    const settingsText = settingsView.shadowRoot?.textContent || '';
                    const settingsReady = settingsText.includes('Session Defaults') &&
                        settingsText.includes('AI Behavior') &&
                        settingsText.includes('Keyboard Shortcuts');

                    mainView.remove();
                    settingsView.remove();

                    return {`,
`                    const settingsView = document.createElement('customize-view');
                    settingsView.style.display = 'none';
                    document.body.appendChild(settingsView);
                    await settingsView.updateComplete;
                    const settingsText = settingsView.shadowRoot?.textContent || '';
                    const settingsReady = settingsText.includes('Session Defaults') &&
                        settingsText.includes('AI Provider & Models') &&
                        settingsText.includes('AI Behavior') &&
                        settingsText.includes('Keyboard Shortcuts');

                    const app = document.querySelector('context-halo-app');
                    for (let i = 0; i < 80 && app?._storageLoaded !== true; i++) {
                        await new Promise(resolve => setTimeout(resolve, 25));
                    }
                    app.currentView = 'main';
                    app.requestUpdate();
                    await app.updateComplete;
                    const content = app.shadowRoot?.querySelector('.content-inner');
                    const liveMain = app.shadowRoot?.querySelector('main-view');
                    const mainOverflow = liveMain ? getComputedStyle(liveMain).overflowY : '';
                    if (liveMain) liveMain.style.minHeight = '1800px';
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    if (content) content.scrollTop = content.scrollHeight;
                    const parentCanScroll = Boolean(content && content.scrollTop > 0);
                    app.navigate('customize');
                    await app.updateComplete;
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    const settingsInApp = app.shadowRoot?.querySelector('customize-view');
                    const unifiedPage = settingsInApp?.shadowRoot?.querySelector('.unified-page');
                    const settingsOverflow = unifiedPage ? getComputedStyle(unifiedPage).overflowY : '';
                    const navigationReset = Boolean(content && content.scrollTop === 0);
                    const singleScrollOwner = mainOverflow !== 'auto' && settingsOverflow !== 'auto';

                    mainView.remove();
                    settingsView.remove();

                    return {`, 'smoke scroll setup');
  s = replaceOnce(s,
`                        settings: settingsReady,
                    };`,
`                        settings: settingsReady,
                        parentCanScroll,
                        navigationReset,
                        singleScrollOwner,
                    };`, 'smoke scroll result');
  s = replaceOnce(s,
`                result?.sessionError === true &&
                result?.settings === true;`,
`                result?.sessionError === true &&
                result?.settings === true &&
                result?.parentCanScroll === true &&
                result?.navigationReset === true &&
                result?.singleScrollOwner === true;`, 'smoke scroll gate');
  s = s.replace('sandboxed preload, Home, session error state, and Settings rendered', 'sandboxed preload, Home/Settings rendered, and navigation scrolling verified');
  write(path, s);
}

// Update existing regression test to match the new intentional Gemini behavior.
{
  const path = 'tests/runtime-session-ui-settings.test.js';
  let s = read(path);
  s = replaceOnce(s,
`    assert.ok(gemini.includes('...(geminiSessionResumptionHandle'));
    assert.ok(gemini.includes('sessionResumption: { handle: geminiSessionResumptionHandle }'));`,
`    assert.ok(gemini.includes("listProviderModels('gemini', apiKey)"));
    assert.ok(gemini.includes('connectGeminiLiveWithGuard'));
    assert.ok(gemini.includes('lastGeminiInitializationError'));
    assert.ok(gemini.includes('retrying without Search'));
    assert.ok(!gemini.includes('thinkingConfig: { thinkingLevel'));`, 'Gemini regression assertions');
  write(path, s);
}

const newTest = `const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = file => fs.readFileSync(file, 'utf8');

test('normal pages use one parent scroll owner and navigation resets to top', () => {
  const app = read('src/components/app/ContextHaloApp.js');
  const main = read('src/components/views/MainView.js');
  const shared = read('src/components/views/sharedPageStyles.js');
  assert.ok(app.includes('min-height: 0;'));
  assert.ok(app.includes('this.updateComplete.then(() => this._resetContentScroll())'));
  assert.ok(app.includes('content.scrollTop = 0'));
  assert.ok(main.includes('height: auto;'));
  assert.ok(main.includes('overflow: visible;'));
  assert.ok(shared.includes('.unified-page'));
  assert.ok(shared.includes('overflow: visible;'));
});

test('Settings links provider setup back to the single Home provider editor', () => {
  const app = read('src/components/app/ContextHaloApp.js');
  const settings = read('src/components/views/CustomizeView.js');
  assert.ok(settings.includes('AI Provider & Models'));
  assert.ok(settings.includes('Open provider setup'));
  assert.ok(settings.includes('onOpenProviderSettings'));
  assert.ok(app.includes(".onOpenProviderSettings=\\${() => this.navigate('main')}"));
});

test('Gemini Live validates access, avoids stale resumption state, and returns exact startup errors', () => {
  const gemini = read('src/utils/gemini.js');
  assert.ok(gemini.includes("listProviderModels('gemini', apiKey)"));
  assert.ok(gemini.includes('geminiSessionResumptionHandle = null'));
  assert.ok(gemini.includes('connectGeminiLiveWithGuard'));
  assert.ok(gemini.includes('Gemini Live closed during setup'));
  assert.ok(gemini.includes('lastGeminiInitializationError'));
  assert.ok(gemini.includes('preferredConfig'));
  assert.ok(gemini.includes('retrying without Search'));
  assert.ok(!gemini.includes('thinkingConfig: { thinkingLevel'));
});
`;
write('tests/scroll-settings-gemini-live.test.js', newTest);

console.log('Applied scroll, Settings linkage, and Gemini Live diagnostics repair.');
