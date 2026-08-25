const { BrowserWindow, globalShortcut, ipcMain, screen, session, desktopCapturer, app } = require('electron');
const path = require('node:path');
const storage = require('../storage');

let mouseEventsIgnored = false;

const DEFAULT_MAIN_WINDOW_SIZE = { width: 1100, height: 800 };
const MIN_WINDOW_SIZE = { width: 700, height: 320 };
const WINDOWS_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src https://forms.gle https://docs.google.com; object-src 'none'; base-uri 'none'; form-action 'none'";

function isTrustedEvent(event, mainWindow) {
    return Boolean(event?.sender && mainWindow && !mainWindow.isDestroyed() && event.sender.id === mainWindow.webContents.id);
}

function createWindow(sendToRenderer, geminiSessionRef) {
    const mainWindow = new BrowserWindow({
        width: DEFAULT_MAIN_WINDOW_SIZE.width,
        height: DEFAULT_MAIN_WINDOW_SIZE.height,
        minWidth: MIN_WINDOW_SIZE.width,
        minHeight: MIN_WINDOW_SIZE.height,
        resizable: true,
        frame: false,
        transparent: true,
        hasShadow: false,
        alwaysOnTop: true,
        icon: path.join(__dirname, '../assets/logo.ico'),
        webPreferences: {
            preload: path.join(__dirname, '../../preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
        },
        backgroundColor: '#00000000',
    });

    const appSession = session.defaultSession;

    appSession.webRequest.onHeadersReceived((details, callback) => {
        const responseHeaders = { ...(details.responseHeaders || {}) };
        if (details.url.startsWith('file://')) {
            responseHeaders['Content-Security-Policy'] = [WINDOWS_CSP];
        }
        callback({ responseHeaders });
    });

    const isTrustedMainFramePermission = (webContents, permission, details = {}) => {
        if (!webContents || webContents.id !== mainWindow.webContents.id) return false;
        if (details.isMainFrame === false) return false;
        return permission === 'media' || permission === 'display-capture';
    };

    appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        callback(isTrustedMainFramePermission(webContents, permission, details));
    });
    appSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
        return isTrustedMainFramePermission(webContents, permission, details);
    });

    appSession.setDisplayMediaRequestHandler(
        (request, callback) => {
            desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
                callback({ video: sources[0], audio: 'loopback' });
            }).catch(() => callback({}));
        },
        { useSystemPicker: false }
    );

    mainWindow.setContentProtection(true);
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    try { mainWindow.setSkipTaskbar(true); } catch (error) { console.warn('Could not hide from taskbar:', error.message); }

    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', event => event.preventDefault());
    mainWindow.loadFile(path.join(__dirname, '../index.html'));

    mainWindow.webContents.once('dom-ready', () => {
        setTimeout(() => {
            const defaultKeybinds = getDefaultKeybinds();
            const savedKeybinds = storage.getKeybinds();
            updateGlobalShortcuts(savedKeybinds ? { ...defaultKeybinds, ...savedKeybinds } : defaultKeybinds, mainWindow, sendToRenderer, geminiSessionRef);
        }, 150);
    });

    setupWindowIpcHandlers(mainWindow, sendToRenderer, geminiSessionRef);
    return mainWindow;
}

function getDefaultKeybinds() {
    return {
        moveUp: 'Ctrl+Up', moveDown: 'Ctrl+Down',
        moveLeft: 'Ctrl+Left', moveRight: 'Ctrl+Right',
        toggleVisibility: 'Ctrl+\\', toggleClickThrough: 'Ctrl+M',
        nextStep: 'Ctrl+Enter', previousResponse: 'Ctrl+[',
        nextResponse: 'Ctrl+]', scrollUp: 'Ctrl+Shift+Up',
        scrollDown: 'Ctrl+Shift+Down', emergencyErase: 'Ctrl+Shift+E',
    };
}

function updateGlobalShortcuts(keybinds, mainWindow, sendToRenderer, geminiSessionRef) {
    globalShortcut.unregisterAll();
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const moveIncrement = Math.floor(Math.min(width, height) * 0.1);
    const movementActions = {
        moveUp: () => { if (mainWindow.isVisible()) { const [x, y] = mainWindow.getPosition(); mainWindow.setPosition(x, y - moveIncrement); } },
        moveDown: () => { if (mainWindow.isVisible()) { const [x, y] = mainWindow.getPosition(); mainWindow.setPosition(x, y + moveIncrement); } },
        moveLeft: () => { if (mainWindow.isVisible()) { const [x, y] = mainWindow.getPosition(); mainWindow.setPosition(x - moveIncrement, y); } },
        moveRight: () => { if (mainWindow.isVisible()) { const [x, y] = mainWindow.getPosition(); mainWindow.setPosition(x + moveIncrement, y); } },
    };

    const register = (name, handler) => {
        const keybind = keybinds[name];
        if (!keybind) return;
        try { globalShortcut.register(keybind, handler); } catch (error) { console.error(`Failed to register ${name} (${keybind}):`, error); }
    };

    Object.entries(movementActions).forEach(([name, handler]) => register(name, handler));
    register('toggleVisibility', () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.showInactive());
    register('toggleClickThrough', () => {
        mouseEventsIgnored = !mouseEventsIgnored;
        mainWindow.setIgnoreMouseEvents(mouseEventsIgnored, mouseEventsIgnored ? { forward: true } : undefined);
        mainWindow.webContents.send('click-through-toggled', mouseEventsIgnored);
    });
    register('nextStep', () => mainWindow.webContents.send('shortcut', 'ctrl+enter'));
    register('previousResponse', () => sendToRenderer('navigate-previous-response'));
    register('nextResponse', () => sendToRenderer('navigate-next-response'));
    register('scrollUp', () => sendToRenderer('scroll-response-up'));
    register('scrollDown', () => sendToRenderer('scroll-response-down'));
    register('emergencyErase', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.hide();
        if (geminiSessionRef.current) { Promise.resolve(geminiSessionRef.current.close()).catch(() => {}); geminiSessionRef.current = null; }
        sendToRenderer('clear-sensitive-data');
        setTimeout(() => app.quit(), 300);
    });
}

function setupWindowIpcHandlers(mainWindow, sendToRenderer, geminiSessionRef) {
    ipcMain.on('view-changed', (event, view) => {
        if (!isTrustedEvent(event, mainWindow) || typeof view !== 'string' || mainWindow.isDestroyed()) return;
        const isLiveMode = view === 'assistant';
        if (!isLiveMode) mainWindow.setIgnoreMouseEvents(false);
    });

    ipcMain.handle('window-minimize', event => {
        if (!isTrustedEvent(event, mainWindow)) return { success: false, error: 'Untrusted renderer' };
        if (!mainWindow.isDestroyed()) mainWindow.minimize();
        return { success: true };
    });

    ipcMain.on('update-keybinds', (event, newKeybinds) => {
        if (!isTrustedEvent(event, mainWindow) || !newKeybinds || typeof newKeybinds !== 'object') return;
        updateGlobalShortcuts({ ...getDefaultKeybinds(), ...newKeybinds }, mainWindow, sendToRenderer, geminiSessionRef);
    });

    ipcMain.handle('toggle-window-visibility', event => {
        if (!isTrustedEvent(event, mainWindow)) return { success: false, error: 'Untrusted renderer' };
        if (mainWindow.isDestroyed()) return { success: false, error: 'Window has been destroyed' };
        if (mainWindow.isVisible()) mainWindow.hide(); else mainWindow.showInactive();
        return { success: true };
    });
}

module.exports = { createWindow, getDefaultKeybinds, updateGlobalShortcuts, setupWindowIpcHandlers };
