if (require('electron-squirrel-startup')) {
    process.exit(0);
}

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
const { setupContextCaptureMain } = require('./utils/contextCaptureMain');

const WINDOWS_SMOKE_MODE = process.argv.includes('--ci-smoke-test');

// Provider networking, Local AI compatibility and SDK wrappers must be installed
// before gemini.js/localai.js capture their dependencies.
installWindowsProviderTransport();
installWindowsLocalAiRuntime();
installProviderRuntimeHardening();
installRealtimeContextMain();
installAnalyzeProviderFallback();

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

    const timeout = setTimeout(() => finish(false, 'renderer did not become ready within 20 seconds'), 20000);

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
                    return {
                        bridge: Boolean(window.electronAPI && window.require),
                        platform: window.process?.platform,
                        arch: window.process?.arch,
                        app: Boolean(document.querySelector('context-halo-app')),
                    };
                })()
            `, true);

            const ready = result?.bridge === true && result?.platform === 'win32' && result?.arch === 'x64' && result?.app === true;
            finish(ready, ready ? 'sandboxed preload and renderer loaded' : `unexpected renderer state ${JSON.stringify(result)}`);
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
    installWindowsSmokeCheck(mainWindow);
    return mainWindow;
}

function isTrustedEvent(event) {
    return Boolean(event?.sender && mainWindow && !mainWindow.isDestroyed() && event.sender.id === mainWindow.webContents.id);
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
    const handle = (channel, handler) => ipcMain.handle(channel, async (event, ...args) => {
        if (!isTrustedEvent(event)) return { success: false, error: 'Untrusted renderer' };
        try { return await handler(...args); } catch (error) { console.error(`${channel} failed:`, error); return { success: false, error: error.message }; }
    });

    handle('storage:get-config', () => ({ success: true, data: storage.getConfig() }));
    handle('storage:set-config', config => {
        if (!validateObject(config)) throw new Error('Invalid config');
        storage.setConfig(config); return { success: true };
    });
    handle('storage:update-config', (key, value) => {
        if (!validateString(key, 100)) throw new Error('Invalid config key');
        storage.updateConfig(key, value); return { success: true };
    });

    handle('storage:get-credentials', () => ({ success: true, data: storage.getCredentials() }));
    handle('storage:set-credentials', credentials => {
        if (!validateObject(credentials)) throw new Error('Invalid credentials');
        storage.setCredentials(credentials); return { success: true };
    });
    handle('storage:get-api-key', () => ({ success: true, data: storage.getApiKey() }));
    handle('storage:set-api-key', apiKey => {
        if (!validateString(apiKey, 10000)) throw new Error('Invalid API key');
        storage.setApiKey(apiKey); return { success: true };
    });
    handle('storage:get-groq-api-key', () => ({ success: true, data: storage.getGroqApiKey() }));
    handle('storage:set-groq-api-key', groqApiKey => {
        if (!validateString(groqApiKey, 10000)) throw new Error('Invalid Groq API key');
        storage.setGroqApiKey(groqApiKey); return { success: true };
    });

    handle('storage:get-preferences', () => ({ success: true, data: storage.getPreferences() }));
    handle('storage:set-preferences', preferences => {
        if (!validateObject(preferences)) throw new Error('Invalid preferences');
        storage.setPreferences(preferences); return { success: true };
    });
    handle('storage:update-preference', (key, value) => {
        if (!validateString(key, 100)) throw new Error('Invalid preference key');
        storage.updatePreference(key, value); return { success: true };
    });

    handle('storage:get-keybinds', () => ({ success: true, data: storage.getKeybinds() }));
    handle('storage:set-keybinds', keybinds => {
        if (keybinds !== null && !validateObject(keybinds)) throw new Error('Invalid keybinds');
        storage.setKeybinds(keybinds); return { success: true };
    });

    handle('storage:get-all-sessions', () => ({ success: true, data: storage.getAllSessions() }));
    handle('storage:get-session', sessionId => {
        if (!validateString(sessionId, 100) || !/^\d+$/.test(sessionId)) throw new Error('Invalid session ID');
        return { success: true, data: storage.getSession(sessionId) };
    });
    handle('storage:save-session', (sessionId, data) => {
        if (!validateString(sessionId, 100) || !/^\d+$/.test(sessionId) || !validateObject(data)) throw new Error('Invalid session data');
        storage.saveSession(sessionId, data); return { success: true };
    });
    handle('storage:delete-session', sessionId => {
        if (!validateString(sessionId, 100) || !/^\d+$/.test(sessionId)) throw new Error('Invalid session ID');
        storage.deleteSession(sessionId); return { success: true };
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
