if (require('electron-squirrel-startup')) {
    process.exit(0);
}

const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { createWindow, updateGlobalShortcuts } = require('./utils/window');
const { setupGeminiIpcHandlers, stopMacOSAudioCapture, sendToRenderer } = require('./utils/gemini');
const storage = require('./storage');

const geminiSessionRef = { current: null };
let mainWindow = null;

function createMainWindow() {
    mainWindow = createWindow(sendToRenderer, geminiSessionRef);
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
    if (process.platform === 'darwin') {
        const { desktopCapturer } = require('electron');
        desktopCapturer.getSources({ types: ['screen'] }).catch(() => {});
    }
    createMainWindow();
    setupGeminiIpcHandlers(geminiSessionRef);
    setupStorageIpcHandlers();
    setupGeneralIpcHandlers();
});

app.on('window-all-closed', () => {
    stopMacOSAudioCapture();
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    stopMacOSAudioCapture();
    require('./utils/localai').closeLocalSession();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
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
        if (!validateObject(keybinds)) throw new Error('Invalid keybinds');
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
