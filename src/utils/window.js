const { BrowserWindow, globalShortcut, ipcMain, screen, session, desktopCapturer, app } = require('electron');
const path = require('node:path');
const storage = require('../storage');

let mouseEventsIgnored = false;

const DEFAULT_MAIN_WINDOW_SIZE = { width: 1100, height: 800 };
const MIN_WINDOW_SIZE = { width: 700, height: 320 };

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
        alwaysOnTop: process.platform === 'win32',
        webPreferences: {
            preload: path.join(__dirname, '../../preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            backgroundThrottling: false,
            enableBlinkFeatures: 'GetDisplayMedia',
            webSecurity: true,
            allowRunningInsecureContent: false,
        },
        backgroundColor: '#00000000',
    });

    session.defaultSession.setDisplayMediaRequestHandler(
        (request, callback) => {
            desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
                callback({ video: sources[0], audio: 'loopback' });
            }).catch(() => callback({}));
        },
        { useSystemPicker: true }
    );

    mainWindow.setContentProtection(true);
    if (process.platform === 'win32') {
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        try { mainWindow.setSkipTaskbar(true); } catch (error) { console.warn('Could not hide from taskbar:', error.message); }
    }

    if (process.platform === 'darwin') {
        try { mainWindow.setHiddenInMissionControl(true); } catch (error) { console.warn('Could not hide from Mission Control:', error.message); }
    }

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
    const isMac = process.platform === 'darwin';
    return {
        moveUp: isMac ? 'Alt+Up' : 'Ctrl+Up', moveDown: isMac ? 'Alt+Down' : 'Ctrl+Down',
        moveLeft: isMac ? 'Alt+Left' : 'Ctrl+Left', moveRight: isMac ? 'Alt+Right' : 'Ctrl+Right',
        toggleVisibility: isMac ? 'Cmd+\\' : 'Ctrl+\\', toggleClickThrough: isMac ? 'Cmd+M' : 'Ctrl+M',
        nextStep: isMac ? 'Cmd+Enter' : 'Ctrl+Enter', previousResponse: isMac ? 'Cmd+[' : 'Ctrl+[',
        nextResponse: isMac ? 'Cmd+]' : 'Ctrl+]', scrollUp: isMac ? 'Cmd+Shift+Up' : 'Ctrl+Shift+Up',
        scrollDown: isMac ? 'Cmd+Shift+Down' : 'Ctrl+Shift+Down', emergencyErase: isMac ? 'Cmd+Shift+E' : 'Ctrl+Shift+E',
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
    register('nextStep', () => mainWindow.webContents.send('shortcut', process.platform === 'darwin' ? 'cmd+enter' : 'ctrl+enter'));
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
        if (process.platform !== 'win32') {
            mainWindow.setAlwaysOnTop(isLiveMode);
            mainWindow.setVisibleOnAllWorkspaces(isLiveMode, { visibleOnFullScreen: isLiveMode });
        }
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
