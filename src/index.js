const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { installIpcHandlerHardening, setupRuntimeWindowHardening } = require('./utils/runtimeHardeningMain');
const {
    installWindowsProviderTransport,
    abortProviderSession,
} = require('./utils/windowsProviderTransport');
const {
    installWindowsIpcHardening,
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

// Provider networking, Local AI compatibility and context observers must be installed
// before gemini.js/localai.js capture their dependencies.
installWindowsProviderTransport();
installWindowsLocalAiRuntime();
installRealtimeContextMain();
installSessionPackMain();
installKnowledgeRagMain();

const { createWindow, getShortcutState, saveGlobalShortcuts } = require('./utils/window');
const { setupGeminiIpcHandlers, stopMacOSAudioCapture, sendToRenderer } = require('./utils/gemini');
const storage = require('./storage');
const { listProviderModels } = require('./utils/providerModelRegistry');

const geminiSessionRef = { current: null };
let mainWindow = null;


function createMainWindow() {
    mainWindow = createWindow(sendToRenderer, geminiSessionRef);
    setupRuntimeWindowHardening(mainWindow);
    setupContextCaptureMain(mainWindow, ipcMain);
    setupPhase4Main(mainWindow, ipcMain);
    if (WINDOWS_SMOKE_MODE) require('../scripts/renderer-behavior-smoke').installWindowsSmokeCheck(mainWindow);
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
        try { return await handler(...args); } catch (error) { console.warn(`${channel} failed`, { code: error.code || 'STORAGE_FAILURE' }); return { success: false, error: error.message, code: error.code || 'STORAGE_FAILURE' }; }
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

    handle('storage:credential-status', () => ({ success: true, data: {
        gemini: Boolean(storage.getApiKey()), groq: Boolean(storage.getGroqApiKey()),
    } }));
    handle('storage:set-api-key', apiKey => {
        if (!validateString(apiKey, 10000)) throw new Error('Invalid API key');
        saved(storage.setApiKey(apiKey)); return { success: true };
    });
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

    handle('storage:get-keybinds', () => getShortcutState());
    handle('storage:set-keybinds', keybinds => {
        if (keybinds !== null && !validateObject(keybinds)) throw new Error('Invalid keybinds');
        return saveGlobalShortcuts(keybinds);
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
        if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return { success: false, error: 'Unsupported URL protocol' };
        await shell.openExternal(parsed.toString());
        return { success: true };
    });
}
