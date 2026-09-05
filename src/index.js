const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { installProviderRuntimeHardening, installIpcHandlerHardening, setupRuntimeWindowHardening } = require('./utils/runtimeHardeningMain');
const { installAnalyzeProviderFallback } = require('./utils/analyzeProviderFallback');
const {
    installWindowsProviderTransport,
    abortProviderSession,
} = require('./utils/windowsProviderTransport');
const {
    installWindowsIpcHardening,
    setupWindowsWindowHardening,
} = require('./utils/windowsRuntimeMain');
const { installWindowsLocalAiRuntime } = require('./utils/windowsLocalAiRuntime');
const { installRealtimeContextMain } = require('./utils/realtimeContextMain');
const { installSessionPackMain } = require('./utils/sessionPackMain');
const { installKnowledgeRagMain } = require('./utils/knowledgeRagMain');
const { setupContextCaptureMain } = require('./utils/contextCaptureMain');
const { setupPhase4Main } = require('./utils/phase4Main');

const WINDOWS_SMOKE_MODE = process.argv.includes('--ci-smoke-test');
if (WINDOWS_SMOKE_MODE) {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const smokeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'context-halo-smoke-'));
    os.homedir = () => smokeHome;
    app.setPath('userData', path.join(smokeHome, 'electron'));
    app.on('will-quit', () => { try { fs.rmSync(smokeHome, { recursive: true, force: true }); } catch {} });
}

// Provider networking, Local AI compatibility and SDK wrappers must be installed
// before gemini.js/localai.js capture their dependencies.
installWindowsProviderTransport();
installWindowsLocalAiRuntime();
installProviderRuntimeHardening();
installRealtimeContextMain();
installSessionPackMain();
installAnalyzeProviderFallback();
installKnowledgeRagMain();

const { createWindow, updateGlobalShortcuts } = require('./utils/window');
const { setupGeminiIpcHandlers, stopMacOSAudioCapture, sendToRenderer } = require('./utils/gemini');
const storage = require('./storage');
const { listProviderModels } = require('./utils/providerModelRegistry');

const geminiSessionRef = { current: null };
let mainWindow = null;

function installWindowsSmokeCheck(window) {
    if (!WINDOWS_SMOKE_MODE) return;

    let finished = false;
    const finish = (success, detail) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        console.log(success ? `[Windows smoke] PASS: ${detail}` : `[Windows smoke] FAIL: ${detail}`);
        setTimeout(() => app.exit(success ? 0 : 1), 50);
    };

    const timeout = setTimeout(() => finish(false, 'renderer did not become ready within 45 seconds'), 45000);

    window.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
        finish(false, `load failed (${errorCode}): ${errorDescription}`);
    });
    window.webContents.once('render-process-gone', (_event, details) => {
        finish(false, `renderer process exited: ${details.reason}`);
    });
    window.webContents.once('did-finish-load', async () => {
        try {
            const result = await window.webContents.executeJavaScript(`
                (async () => {
                    await customElements.whenDefined('context-halo-app');
                    await customElements.whenDefined('main-view');
                    await customElements.whenDefined('assistant-view');
                    await customElements.whenDefined('customize-view');

                    const mainView = document.createElement('main-view');
                    mainView.style.display = 'none';
                    document.body.appendChild(mainView);
                    await mainView.updateComplete;
                    mainView.startError = 'Smoke test session failure';
                    mainView.requestUpdate();
                    await mainView.updateComplete;
                    const mainText = mainView.shadowRoot?.textContent || '';
                    const homeReady = mainText.includes('Start Session') && mainText.includes('Session Profile');
                    const errorReady = Boolean(mainView.shadowRoot?.querySelector('.session-status.error'));

                    const settingsView = document.createElement('customize-view');
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

                    return {
                        bridge: Boolean(window.electronAPI && window.require),
                        platform: window.process?.platform,
                        arch: window.process?.arch,
                        app: Boolean(document.querySelector('context-halo-app')),
                        home: homeReady,
                        sessionError: errorReady,
                        settings: settingsReady,
                        parentCanScroll,
                        navigationReset,
                        singleScrollOwner,
                    };
                })()
            `, true);

            const ready = result?.bridge === true &&
                result?.platform === 'win32' &&
                result?.arch === 'x64' &&
                result?.app === true &&
                result?.home === true &&
                result?.sessionError === true &&
                result?.settings === true &&
                result?.parentCanScroll === true &&
                result?.navigationReset === true &&
                result?.singleScrollOwner === true;
            if (!ready) throw new Error(`unexpected renderer state ${JSON.stringify(result)}`);
            const { rendererBehaviorSmoke } = require('../scripts/renderer-behavior-smoke');
            const checks = await window.webContents.executeJavaScript(`(${rendererBehaviorSmoke.toString()})()`, true);
            console.log('[Windows behavior smoke] ' + JSON.stringify(checks));
            const fs = require('node:fs');
            const path = require('node:path');
            const directory = path.join(process.cwd(), 'qa-results');
            fs.mkdirSync(directory, { recursive: true });
            for (const view of ['main', 'customize', 'assistant']) {
                await window.webContents.executeJavaScript(`(async () => {
                    const app = document.querySelector('context-halo-app');
                    app.currentView = ${JSON.stringify(view)};
                    app.requestUpdate(); await app.updateComplete;
                    await new Promise(resolve => setTimeout(resolve, 150));
                })()`);
                fs.writeFileSync(path.join(directory, view + '.png'), (await window.webContents.capturePage()).toPNG());
            }
            fs.writeFileSync(path.join(directory, 'checks.json'), JSON.stringify({ shell: result, behavior: checks }, null, 2));
            finish(true, 'sandboxed preload, navigation, typed composer, response routing, knowledge, practice and review verified');
        } catch (error) {
            finish(false, error.message);
        }
    });
}

function createMainWindow() {
    mainWindow = createWindow(sendToRenderer, geminiSessionRef);
    setupRuntimeWindowHardening(mainWindow);
    setupWindowsWindowHardening(mainWindow);
    setupContextCaptureMain(mainWindow, ipcMain);
    setupPhase4Main(mainWindow, ipcMain);
    installWindowsSmokeCheck(mainWindow);
    return mainWindow;
}

function isTrustedEvent(event) {
    return Boolean(event?.sender && mainWindow && !mainWindow.isDestroyed() && event.sender.id === mainWindow.webContents.id && event.senderFrame === mainWindow.webContents.mainFrame);
}

function validateString(value, maxLength = 200000) {
    return typeof value === 'string' && value.length <= maxLength;
}

function validateObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

app.whenReady().then(async () => {
    storage.initializeStorage();
    createMainWindow();

    // Install the Windows wrapper first, then the shared runtime wrapper. The
    // resulting registered handler is Windows -> shared hardening -> provider,
    // which gives the Windows layer authority to impose a single overall request
    // deadline and to mix loopback/microphone PCM before provider routing.
    const restoreWindowsIpc = installWindowsIpcHardening();
    const restoreIpcHandle = installIpcHandlerHardening();
    try {
        setupGeminiIpcHandlers(geminiSessionRef);
    } finally {
        restoreIpcHandle();
        restoreWindowsIpc();
    }

    setupStorageIpcHandlers();
    setupGeneralIpcHandlers();
});

app.on('window-all-closed', () => {
    stopMacOSAudioCapture();
    app.quit();
});

app.on('before-quit', () => {
    abortProviderSession('Application is closing');
    stopMacOSAudioCapture();
    require('./utils/localai').closeLocalSession();
});

function setupStorageIpcHandlers() {
    const saved = result => { if (result !== true) throw new Error('Could not save data. Check available disk space and folder permissions.'); };
    const handle = (channel, handler) => ipcMain.handle(channel, async (event, ...args) => {
        if (!isTrustedEvent(event)) return { success: false, error: 'Untrusted renderer' };
        try { return await handler(...args); } catch (error) { console.error(`${channel} failed:`, error); return { success: false, error: error.message }; }
    });

    handle('storage:get-config', () => ({ success: true, data: storage.getConfig() }));
    handle('storage:set-config', config => {
        if (!validateObject(config)) throw new Error('Invalid config');
        saved(storage.setConfig(config)); return { success: true };
    });
    handle('storage:update-config', (key, value) => {
        if (!validateString(key, 100)) throw new Error('Invalid config key');
        saved(storage.updateConfig(key, value)); return { success: true };
    });

    handle('storage:get-credentials', () => ({ success: true, data: storage.getCredentials() }));
    handle('storage:set-credentials', credentials => {
        if (!validateObject(credentials)) throw new Error('Invalid credentials');
        saved(storage.setCredentials(credentials)); return { success: true };
    });
    handle('storage:get-api-key', () => ({ success: true, data: storage.getApiKey() }));
    handle('storage:set-api-key', apiKey => {
        if (!validateString(apiKey, 10000)) throw new Error('Invalid API key');
        saved(storage.setApiKey(apiKey)); return { success: true };
    });
    handle('storage:get-groq-api-key', () => ({ success: true, data: storage.getGroqApiKey() }));
    handle('storage:set-groq-api-key', groqApiKey => {
        if (!validateString(groqApiKey, 10000)) throw new Error('Invalid Groq API key');
        saved(storage.setGroqApiKey(groqApiKey)); return { success: true };
    });

    handle('storage:get-preferences', () => ({ success: true, data: storage.getPreferences() }));
    handle('storage:set-preferences', preferences => {
        if (!validateObject(preferences)) throw new Error('Invalid preferences');
        saved(storage.setPreferences(preferences)); return { success: true };
    });
    handle('storage:update-preference', (key, value) => {
        if (!validateString(key, 100)) throw new Error('Invalid preference key');
        saved(storage.updatePreference(key, value)); return { success: true };
    });

    handle('storage:get-keybinds', () => ({ success: true, data: storage.getKeybinds() }));
    handle('storage:set-keybinds', keybinds => {
        if (keybinds !== null && !validateObject(keybinds)) throw new Error('Invalid keybinds');
        saved(storage.setKeybinds(keybinds)); return { success: true };
    });

    handle('storage:get-all-sessions', () => ({ success: true, data: storage.getAllSessions() }));
    handle('storage:get-session', sessionId => {
        if (!validateString(sessionId, 100) || !/^\d+$/.test(sessionId)) throw new Error('Invalid session ID');
        return { success: true, data: storage.getSession(sessionId) };
    });
    handle('storage:save-session', (sessionId, data) => {
        if (!validateString(sessionId, 100) || !/^\d+$/.test(sessionId) || !validateObject(data)) throw new Error('Invalid session data');
        saved(storage.saveSession(sessionId, data)); return { success: true };
    });
    handle('storage:delete-session', sessionId => {
        if (!validateString(sessionId, 100) || !/^\d+$/.test(sessionId)) throw new Error('Invalid session ID');
        saved(storage.deleteSession(sessionId)); return { success: true };
    });
    handle('storage:delete-all-sessions', () => ({ success: storage.deleteAllSessions() }));
    handle('storage:get-today-limits', () => ({ success: true, data: storage.getTodayLimits() }));
    handle('storage:clear-all', () => ({ success: storage.clearAllData() }));
}

function setupGeneralIpcHandlers() {
    ipcMain.handle('provider-models:list', async (event, provider, forceRefresh = false) => {
        if (!isTrustedEvent(event) || !['gemini', 'groq'].includes(provider)) {
            return { success: false, error: 'Invalid provider model request' };
        }
        try {
            const apiKey = provider === 'gemini' ? storage.getApiKey() : storage.getGroqApiKey();
            const data = await listProviderModels(provider, apiKey, { forceRefresh: forceRefresh === true });
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error?.message || String(error) };
        }
    });

    ipcMain.handle('get-app-version', event => {
        if (!isTrustedEvent(event)) return { success: false, error: 'Untrusted renderer' };
        return { success: true, data: app.getVersion() };
    });

    ipcMain.handle('quit-application', event => {
        if (!isTrustedEvent(event)) return { success: false, error: 'Untrusted renderer' };
        app.quit(); return { success: true };
    });

    ipcMain.handle('open-external', async (event, rawUrl) => {
        if (!isTrustedEvent(event) || !validateString(rawUrl, 4096)) return { success: false, error: 'Invalid URL' };
        let parsed;
        try { parsed = new URL(rawUrl); } catch { return { success: false, error: 'Invalid URL' }; }
        if (!['https:', 'http:'].includes(parsed.protocol)) return { success: false, error: 'Unsupported URL protocol' };
        await shell.openExternal(parsed.toString());
        return { success: true };
    });
}
