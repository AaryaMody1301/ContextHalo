const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { loadMain } = require('./helpers/native-boundary');

function windowFixture(t, options = {}) {
    const shortcuts = new Map(), handlers = new Map(), listeners = new Map();
    const shows = [], taskbarChanges = [], messages = [], trays = [];
    let initial, sessionCloses = 0;
    const display = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
    const screen = Object.assign(new EventEmitter(), {
        getPrimaryDisplay: () => display, getDisplayMatching: () => display,
    });
    class Window extends EventEmitter {
        constructor(settings) {
            super();
            this.visible = settings.show !== false;
            this.taskbar = !settings.skipTaskbar;
            this.minimized = false;
            this.destroyed = false;
            this.protected = false;
            this.ignores = false;
            this.topmost = settings.alwaysOnTop;
            this.bounds = { x: 0, y: 0, width: settings.width, height: settings.height };
            this.webContents = Object.assign(new EventEmitter(), {
                id: 12, mainFrame: {}, send: (...args) => messages.push(args), setWindowOpenHandler() {},
            });
            initial = { visible: this.visible, taskbar: this.taskbar };
        }
        isDestroyed() { return this.destroyed; }
        isVisible() { return this.visible; }
        isMinimized() { return this.minimized; }
        getBounds() { return { ...this.bounds }; }
        setBounds(bounds) { this.bounds = { ...bounds }; }
        setMinimumSize() {}
        setContentProtection(value) { this.protected = value; }
        setAlwaysOnTop(value) { this.topmost = value; }
        setSkipTaskbar(value) { this.taskbar = !value; taskbarChanges.push(value); }
        setIgnoreMouseEvents(value) { this.ignores = value; }
        moveTop() {}
        focus() {}
        loadFile() {}
        show() {
            this.visible = true;
            shows.push({ taskbar: this.taskbar, protected: this.protected,
                trayReady: trays.length > 0, shortcutReady: shortcuts.has('Ctrl+\\') });
            this.emit('show');
        }
        hide() { this.visible = false; this.emit('hide'); }
        minimize() { this.minimized = true; }
        restore() { this.minimized = false; }
        close() { this.emit('close'); this.destroyed = true; this.emit('closed'); }
    }
    class RecoveryTray extends EventEmitter {
        constructor() {
            super();
            if (options.trayFails) throw new Error('Notification area unavailable');
            trays.push(this);
        }
        setToolTip() {}
        setContextMenu(menu) { this.menu = menu; }
        destroy() {}
    }
    const electron = {
        BrowserWindow: Window, Tray: RecoveryTray, Menu: { buildFromTemplate: menu => menu }, screen,
        globalShortcut: {
            register(key, action) {
                if (options.shortcutFails && key === 'Ctrl+\\') return false;
                shortcuts.set(key, action); return true;
            },
            unregister: key => shortcuts.delete(key),
        },
        ipcMain: { on: (channel, listener) => listeners.set(channel, listener), handle: (channel, handler) => handlers.set(channel, handler) },
        session: { defaultSession: { webRequest: { onHeadersReceived() {} }, setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
        app: { quit() { assert.fail('Window visibility must not quit the app'); } },
    };
    const session = { close() { sessionCloses++; } };
    const sessionRef = { current: session };
    const api = loadMain('src/utils/window.js', {
        electron, '../storage': { getConfig: () => ({}), getKeybinds: () => ({}), updateConfig() {} },
    }, { process: { argv: options.smoke ? ['electron', '--ci-smoke-test'] : ['electron'] } });
    const win = api.createWindow((...args) => messages.push(args), sessionRef);
    t.after(() => win.close());
    const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
    return { api, win, initial, shows, shortcuts, trays, taskbarChanges, messages, sessionRef, session,
        sessionCloses: () => sessionCloses,
        view: name => listeners.get('view-changed')(event, name),
        toggle: () => handlers.get('toggle-window-visibility')(event),
    };
}

test('startup hides the taskbar entry and establishes protection/recovery before first showing Home', t => {
    const f = windowFixture(t);
    assert.deepEqual(f.initial, { visible: false, taskbar: false });
    assert.deepEqual(f.shows, [{ taskbar: false, protected: true, trayReady: true, shortcutReady: true }]);
    assert.equal(f.win.visible, true, 'Home still opens normally without a new mode or startup setting');
    assert.equal(f.api.getShortcutState().recovery, 'notification-area');
});

test('taskbar hiding survives Home, settings, history, HUD and session-end layout transitions', t => {
    const f = windowFixture(t);
    const homeBounds = f.win.getBounds();
    for (const view of ['main', 'customize', 'history', 'assistant', 'assistant', 'main', 'history']) {
        f.view(view);
        assert.equal(f.win.taskbar, false, view);
        assert.equal(f.win.protected, true, view);
        assert.equal(f.win.topmost, view === 'assistant', view);
        if (view !== 'assistant') assert.deepEqual(f.win.getBounds(), homeBounds);
    }
    assert.equal(f.sessionRef.current, f.session);
    assert.equal(f.sessionCloses(), 0);
});

test('shortcut, IPC, tray and minimize recovery preserve taskbar hiding and the active session', t => {
    const f = windowFixture(t);
    for (const view of ['main', 'assistant']) {
        f.view(view);
        f.shortcuts.get('Ctrl+\\')();
        assert.equal(f.win.visible, false);
        f.shortcuts.get('Ctrl+\\')();
        assert.equal(f.win.visible, true);
        assert.equal(f.win.taskbar, false);
        for (const restore of [() => f.toggle(), () => f.trays[0].emit('click'),
            () => f.trays[0].emit('double-click'), () => f.trays[0].menu[0].click()]) {
            assert.equal(f.toggle().success, true);
            assert.equal(f.win.visible, false);
            f.win.ignores = true;
            restore();
            assert.equal(f.win.visible, true);
            assert.equal(f.win.ignores, false);
            assert.equal(f.win.taskbar, false);
            assert.equal(f.win.topmost, view === 'assistant');
        }
        f.win.minimize();
        f.trays[0].emit('click');
        assert.equal(f.win.minimized, false);
        assert.equal(f.win.taskbar, false);
    }
    assert.equal(f.sessionRef.current, f.session);
    assert.equal(f.sessionCloses(), 0);
    assert.equal(f.messages.some(([channel]) => channel === 'clear-sensitive-data'), false);
});

test('tray failure retains taskbar recovery before first show and throughout layout transitions', t => {
    const f = windowFixture(t, { trayFails: true, shortcutFails: true });
    assert.equal(f.shows[0].taskbar, true);
    assert.equal(f.api.getShortcutState().recovery, 'taskbar');
    for (const view of ['main', 'customize', 'assistant', 'history', 'main']) {
        f.view(view);
        assert.equal(f.win.taskbar, true, view);
        f.toggle();
        assert.equal(f.win.visible, true, 'Hide must not strand the app without its tray');
        assert.equal(f.win.minimized, true);
        f.toggle();
        assert.equal(f.win.minimized, false);
    }
    assert.ok(f.taskbarChanges.every(value => value === false), 'layout changes never temporarily hide the recovery entry');
    assert.equal(f.sessionCloses(), 0);
});

test('a conflicting visibility shortcut still allows tray recovery with the taskbar hidden', t => {
    const f = windowFixture(t, { shortcutFails: true });
    assert.ok(f.api.getShortcutState().conflicts.toggleVisibility);
    f.toggle();
    assert.equal(f.win.visible, false);
    f.trays[0].emit('click');
    assert.equal(f.win.visible, true);
    assert.equal(f.win.taskbar, false);
});

test('the isolated compositor smoke remains unprotected while using the same taskbar policy', t => {
    const f = windowFixture(t, { smoke: true });
    for (const view of ['main', 'assistant', 'main']) {
        f.view(view);
        assert.equal(f.win.protected, false);
        assert.equal(f.win.taskbar, false);
    }
});
