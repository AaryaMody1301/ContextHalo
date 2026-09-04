const { BrowserWindow, globalShortcut, ipcMain, screen, session, desktopCapturer, app } = require('electron');
const path = require('node:path');
const storage = require('../storage');
const { createWindowModeController } = require('./windowModeController');

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
        maximizable: true,
        minimizable: true,
        frame: false,
        transparent: true,
        hasShadow: true,
        roundedCorners: true,
        thickFrame: true,
        alwaysOnTop: false,
        skipTaskbar: false,
        autoHideMenuBar: true,
        title: 'ContextHalo',
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

    const windowModeController = createWindowModeController(mainWindow, screen);
    const handleDisplayMetricsChanged = () => windowModeController.repositionHud();
    screen.on('display-metrics-changed', handleDisplayMetricsChanged);

    mainWindow.on('show', () => windowModeController.reassertHudMode());
    mainWindow.on('closed', () => {
        screen.removeListener('display-metrics-changed', handleDisplayMetricsChanged);
    });

    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', event => event.preventDefault());
    mainWindow.loadFile(path.join(__dirname, '../index.html'));

    mainWindow.webContents.once('dom-ready', () => {
        setTimeout(() => {
            const defaultKeybinds = getDefaultKeybinds();
            const savedKeybinds = storage.getKeybinds();
            updateGlobalShortcuts(
                savedKeybinds ? { ...defaultKeybinds, ...savedKeybinds } : defaultKeybinds,
                mainWindow,
                sendToRenderer,
                geminiSessionRef,
                windowModeController
            );
        }, 150);
    });

    setupWindowIpcHandlers(mainWindow, sendToRenderer, geminiSessionRef, windowModeController);
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

function updateGlobalShortcuts(keybinds, mainWindow, sendToRenderer, geminiSessionRef, windowModeController) {
    globalShortcut.unregisterAll();
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const moveIncrement = Math.floor(Math.min(width, height) * 0.1);
    const moveWindow = (deltaX, deltaY) => {
        if (windowModeController) {
            windowModeController.moveBy(deltaX, deltaY);
            return;
        }
        if (!mainWindow.isVisible()) return;
        const [x, y] = mainWindow.getPosition();
        mainWindow.setPosition(x + deltaX, y + deltaY);
    };
    const movementActions = {
        moveUp: () => moveWindow(0, -moveIncrement),
        moveDown: () => moveWindow(0, moveIncrement),
        moveLeft: () => moveWindow(-moveIncrement, 0),
        moveRight: () => moveWindow(moveIncrement, 0),
    };

    const register = (name, handler) => {
        const keybind = keybinds[name];
        if (!keybind) return;
        try { globalShortcut.register(keybind, handler); } catch (error) { console.error(`Failed to register ${name} (${keybind}):`, error); }
    };

    Object.entries(movementActions).forEach(([name, handler]) => register(name, handler));
    register('toggleVisibility', () => {
        if (mainWindow.isVisible()) mainWindow.hide();
        else {
            mainWindow.showInactive();
            windowModeController?.reassertHudMode();
        }
    });
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

function setupWindowIpcHandlers(mainWindow, sendToRenderer, geminiSessionRef, windowModeController) {
    ipcMain.on('view-changed', (event, view) => {
        if (!isTrustedEvent(event, mainWindow) || typeof view !== 'string' || mainWindow.isDestroyed()) return;
        const isLiveMode = view === 'assistant';

        if (isLiveMode) {
            windowModeController?.enterHudMode();
            return;
        }

        mouseEventsIgnored = false;
        mainWindow.setIgnoreMouseEvents(false);
        mainWindow.webContents.send('click-through-toggled', false);
        windowModeController?.enterNormalMode();
    });

    ipcMain.handle('window-minimize', event => {
        if (!isTrustedEvent(event, mainWindow)) return { success: false, error: 'Untrusted renderer' };
        if (!mainWindow.isDestroyed()) mainWindow.minimize();
        return { success: true };
    });

    ipcMain.on('update-keybinds', (event, newKeybinds) => {
        if (!isTrustedEvent(event, mainWindow) || !newKeybinds || typeof newKeybinds !== 'object') return;
        updateGlobalShortcuts(
            { ...getDefaultKeybinds(), ...newKeybinds },
            mainWindow,
            sendToRenderer,
            geminiSessionRef,
            windowModeController
        );
    });

    ipcMain.handle('toggle-window-visibility', event => {
        if (!isTrustedEvent(event, mainWindow)) return { success: false, error: 'Untrusted renderer' };
        if (mainWindow.isDestroyed()) return { success: false, error: 'Window has been destroyed' };
        if (mainWindow.isVisible()) mainWindow.hide();
        else {
            mainWindow.showInactive();
            windowModeController?.reassertHudMode();
        }
        return { success: true };
    });
}

module.exports = { createWindow, getDefaultKeybinds, updateGlobalShortcuts, setupWindowIpcHandlers };
