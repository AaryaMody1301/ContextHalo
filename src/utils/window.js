const { BrowserWindow, globalShortcut, ipcMain, screen, session, Tray, Menu, app } = require('electron');
const path = require('node:path');
const storage = require('../storage');
const { createWindowModeController } = require('./windowModeController');

let mouseEventsIgnored = false;
let shortcutOwner;
let recoveryTray;
let configuredBindings = {};
let shortcutConflicts = {};
const registeredBindings = new Map();

// Deliberately limited to keyboard accelerators the editor can capture. Validate
// again in main: a renderer must not persist arbitrary/reserved accelerators.
function normalizeAccelerator(value) {
    if (typeof value !== 'string' || value.length > 100) throw new Error('Use a keyboard shortcut.');
    const parts = value.trim().split('+');
    const key = parts.pop();
    const aliases = { Control: 'Ctrl', CommandOrControl: 'Ctrl', CmdOrCtrl: 'Ctrl', Command: 'Super', Cmd: 'Super', Meta: 'Super' };
    const modifiers = parts.map(part => aliases[part] || part);
    if (new Set(modifiers).size !== modifiers.length || modifiers.some(part => !['Ctrl', 'Alt', 'Shift', 'Super'].includes(part))) {
        throw new Error('Unsupported modifier combination.');
    }
    const named = ['Up', 'Down', 'Left', 'Right', 'Enter', 'Space', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Plus'];
    if (!key || (!/^[a-z0-9\[\]\\,./;'=-]$/i.test(key) && !/^F([1-9]|1[0-9]|2[0-4])$/.test(key) && !named.includes(key))) {
        throw new Error('Unsupported key. Tab navigates and Escape cancels editing.');
    }
    if (!modifiers.some(part => ['Ctrl', 'Alt', 'Super'].includes(part)) && !/^F\d+$/.test(key)) {
        throw new Error('Use Ctrl, Alt or Windows with a key, or a function key.');
    }
    const result = [...['Ctrl', 'Alt', 'Shift', 'Super'].filter(part => modifiers.includes(part)), key.length === 1 ? key.toUpperCase() : key].join('+');
    if (['Alt+F4', 'Ctrl+Alt+Delete', 'Super+L'].includes(result)) throw new Error('This combination is reserved by Windows.');
    return result;
}

function getShortcutState() {
    return {
        success: true,
        data: { ...getDefaultKeybinds(), ...configuredBindings },
        registered: Object.fromEntries(registeredBindings),
        conflicts: { ...shortcutConflicts },
        recovery: recoveryTray ? 'notification-area' : 'taskbar',
    };
}

function restoreWindow(mainWindow, controller) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Recovery restores interaction as well as visibility; it does not end capture.
    mouseEventsIgnored = false;
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.webContents.send('click-through-toggled', false);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    controller?.reassertHudMode();
    if (!recoveryTray) mainWindow.setSkipTaskbar(false);
    mainWindow.focus();
}

function hideWindow(mainWindow) {
    if (recoveryTray) mainWindow.hide();
    else {
        // A failed/missing tray must never strand an invisible skip-taskbar HUD.
        mainWindow.setSkipTaskbar(false);
        mainWindow.minimize();
    }
}

function installRecovery(mainWindow, controller) {
    try {
        recoveryTray = new Tray(path.join(__dirname, '../assets/logo.ico'));
        recoveryTray.setToolTip('ContextHalo - show window');
        const restore = () => restoreWindow(mainWindow, controller);
        recoveryTray.setContextMenu(Menu.buildFromTemplate([{ label: 'Show ContextHalo', click: restore }]));
        recoveryTray.on('click', restore);
        recoveryTray.on('double-click', restore);
    } catch {
        recoveryTray = undefined;
        mainWindow.setSkipTaskbar(false);
    }
}

const DEFAULT_MAIN_WINDOW_SIZE = { width: 1100, height: 800 };
const MIN_WINDOW_SIZE = { width: 700, height: 320 };
const WINDOWS_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self' https://forms.gle https://docs.google.com; object-src 'none'; base-uri 'none'; form-action 'none'";

function isTrustedEvent(event, mainWindow) {
    return Boolean(event?.sender && mainWindow && !mainWindow.isDestroyed() && event.sender.id === mainWindow.webContents.id);
}

function createWindow(sendToRenderer, geminiSessionRef) {
    const workArea = screen.getPrimaryDisplay().workArea;
    const mainWindow = new BrowserWindow({
        width: Math.min(DEFAULT_MAIN_WINDOW_SIZE.width, workArea.width),
        height: Math.min(DEFAULT_MAIN_WINDOW_SIZE.height, workArea.height),
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

    let boundsTimer;
    let pendingBounds;
    const saveBounds = () => {
        clearTimeout(boundsTimer);
        if (!pendingBounds) return;
        try { storage.updateConfig('windowBounds', pendingBounds); }
        catch { console.warn('Could not save window bounds'); }
        pendingBounds = null;
    };
    const windowModeController = createWindowModeController(mainWindow, screen, {
        bounds: storage.getConfig().windowBounds,
        saveBounds(value) {
            pendingBounds = value;
            clearTimeout(boundsTimer);
            boundsTimer = setTimeout(saveBounds, 200);
        },
    });
    mainWindow.on('moved', windowModeController.rememberBounds);
    mainWindow.on('resized', windowModeController.rememberBounds);
    mainWindow.on('close', saveBounds);
    const handleDisplayMetricsChanged = () => windowModeController.repositionHud();
    for (const event of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(event, handleDisplayMetricsChanged);

    mainWindow.on('show', () => {
        windowModeController.reassertHudMode();
        if (!recoveryTray) mainWindow.setSkipTaskbar(false);
    });
    mainWindow.on('closed', () => {
        saveBounds();
        recoveryTray?.destroy();
        recoveryTray = undefined;
        for (const binding of registeredBindings.values()) globalShortcut.unregister(binding);
        registeredBindings.clear();
        shortcutOwner = undefined;
        for (const event of ['display-metrics-changed', 'display-added', 'display-removed']) screen.removeListener(event, handleDisplayMetricsChanged);
    });

    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', event => event.preventDefault());
    mainWindow.loadFile(path.join(__dirname, '../index.html'));

    installRecovery(mainWindow, windowModeController);
    updateGlobalShortcuts({ ...getDefaultKeybinds(), ...storage.getKeybinds() }, mainWindow, sendToRenderer, geminiSessionRef, windowModeController);

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
    const moveWindow = (dx, dy) => {
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        const increment = Math.floor(Math.min(width, height) * 0.1);
        if (windowModeController) return windowModeController.moveBy(dx * increment, dy * increment);
        if (!mainWindow.isVisible()) return;
        const [x, y] = mainWindow.getPosition();
        mainWindow.setPosition(x + dx * increment, y + dy * increment);
    };
    const actions = {
        moveUp: () => moveWindow(0, -1), moveDown: () => moveWindow(0, 1),
        moveLeft: () => moveWindow(-1, 0), moveRight: () => moveWindow(1, 0),
        toggleVisibility: () => {
            if (mainWindow.isVisible() && !mainWindow.isMinimized()) hideWindow(mainWindow);
            else restoreWindow(mainWindow, windowModeController);
        },
        toggleClickThrough: () => {
            mouseEventsIgnored = !mouseEventsIgnored;
            mainWindow.setIgnoreMouseEvents(mouseEventsIgnored, mouseEventsIgnored ? { forward: true } : undefined);
            mainWindow.webContents.send('click-through-toggled', mouseEventsIgnored);
        },
        nextStep: () => mainWindow.webContents.send('shortcut', 'ctrl+enter'),
        previousResponse: () => sendToRenderer('navigate-previous-response'),
        nextResponse: () => sendToRenderer('navigate-next-response'),
        scrollUp: () => sendToRenderer('scroll-response-up'),
        scrollDown: () => sendToRenderer('scroll-response-down'),
        emergencyErase: () => {
            if (mainWindow.isDestroyed()) return;
            mainWindow.hide();
            if (geminiSessionRef.current) { Promise.resolve(geminiSessionRef.current.close()).catch(() => {}); geminiSessionRef.current = null; }
            sendToRenderer('clear-sensitive-data');
            setTimeout(() => app.quit(), 300);
        },
    };
    shortcutOwner = { actions };
    configuredBindings = { ...keybinds };
    shortcutConflicts = {};
    for (const name of Object.keys(actions)) {
        try {
            const binding = normalizeAccelerator(keybinds[name]);
            if ([...registeredBindings.values()].includes(binding) || !globalShortcut.register(binding, actions[name])) throw new Error('Unavailable');
            registeredBindings.set(name, binding);
            configuredBindings[name] = binding;
        } catch {
            shortcutConflicts[name] = 'Not registered. Choose another combination. Restore the window from the notification area or taskbar.';
        }
    }
    return getShortcutState();
}

// Register and persist as one transaction. Only changed actions are unregistered;
// a failed registration/write restores the previously working bindings.
function saveGlobalShortcuts(input) {
    if (!shortcutOwner) return { success: false, error: 'Shortcuts are not ready. Retry shortly.' };
    const desired = { ...getDefaultKeybinds(), ...input };
    const conflicts = {};
    const seen = new Map();
    for (const name of Object.keys(desired)) {
        try {
            if (!(name in shortcutOwner.actions)) throw new Error('Unknown shortcut action.');
            desired[name] = normalizeAccelerator(desired[name]);
            if (seen.has(desired[name])) throw new Error('Already assigned to another action.');
            seen.set(desired[name], name);
        } catch (error) { conflicts[name] = error.message; }
    }
    if (Object.keys(conflicts).length) return { ...getShortcutState(), success: false, error: 'Shortcut not saved. Resolve the highlighted conflict.', conflicts };
    const changed = Object.keys(desired).filter(name => registeredBindings.get(name) !== desired[name]);
    const previous = new Map(registeredBindings);
    const acquired = [];
    try {
        for (const name of changed) {
            if (previous.has(name)) globalShortcut.unregister(previous.get(name));
            registeredBindings.delete(name);
        }
        for (const name of changed) {
            if (!globalShortcut.register(desired[name], shortcutOwner.actions[name])) {
                conflicts[name] = 'Windows could not register this shortcut. Another application may be using it.';
                throw new Error('Shortcut not saved. The previous working binding was restored.');
            }
            acquired.push(name);
            registeredBindings.set(name, desired[name]);
        }
        if (storage.setKeybinds(desired) !== true) throw new Error('Shortcuts could not be saved. Previous bindings restored; retry after checking disk permissions.');
        configuredBindings = desired;
        shortcutConflicts = {};
        return getShortcutState();
    } catch (error) {
        for (const name of acquired) globalShortcut.unregister(desired[name]);
        for (const name of changed) {
            registeredBindings.delete(name);
            if (!previous.has(name)) continue;
            try {
                if (!globalShortcut.register(previous.get(name), shortcutOwner.actions[name])) throw new Error('Unavailable');
                registeredBindings.set(name, previous.get(name));
            } catch { shortcutConflicts[name] = 'Previous shortcut is also unavailable. Use the notification area or taskbar to show the window.'; }
        }
        return { ...getShortcutState(), success: false, error: error.message, conflicts: { ...shortcutConflicts, ...conflicts } };
    }
}

function setupWindowIpcHandlers(mainWindow, sendToRenderer, geminiSessionRef, windowModeController) {
    ipcMain.on('view-changed', (event, view) => {
        if (!isTrustedEvent(event, mainWindow) || typeof view !== 'string' || mainWindow.isDestroyed()) return;
        const isLiveMode = view === 'assistant';

        if (isLiveMode) {
            windowModeController?.enterHudMode();
            if (!recoveryTray) mainWindow.setSkipTaskbar(false);
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

    ipcMain.handle('toggle-window-visibility', event => {
        if (!isTrustedEvent(event, mainWindow)) return { success: false, error: 'Untrusted renderer' };
        if (mainWindow.isDestroyed()) return { success: false, error: 'Window has been destroyed' };
        if (mainWindow.isVisible() && !mainWindow.isMinimized()) hideWindow(mainWindow);
        else restoreWindow(mainWindow, windowModeController);
        return { success: true };
    });
}

module.exports = { createWindow, getDefaultKeybinds, updateGlobalShortcuts, setupWindowIpcHandlers, getShortcutState, saveGlobalShortcuts, normalizeAccelerator };
