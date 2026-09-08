const test = require('node:test');
const assert = require('node:assert/strict');
const { componentClass } = require('./helpers/component-fixture');
const { loadMain } = require('./helpers/native-boundary');

function editor() {
    const { Target } = componentClass('src/components/views/CustomizeView.js', 'CustomizeView', { unifiedPageStyles: [] });
    const view = Object.assign(Object.create(Target.prototype), {
        keybinds: { toggleVisibility: 'Ctrl+\\', nextStep: 'Ctrl+Enter' }, shortcutConflicts: {}, shortcutStatus: '', keybindSaving: false,
    });
    const writes = [];
    view.saveKeybinds = bindings => writes.push(bindings);
    const field = { dataset: { action: 'toggleVisibility' }, value: 'Ctrl+\\' };
    let prevented = 0;
    const key = (key, extra = {}) => view.handleKeybindInput({ key, target: field, preventDefault() { prevented++; }, ...extra });
    return { view, writes, field, key, prevented: () => prevented };
}

test('Tab and Shift+Tab navigate shortcut fields without preventing default or saving', () => {
    const f = editor();
    f.key('Tab'); f.key('Tab', { shiftKey: true });
    assert.equal(f.prevented(), 0);
    assert.equal(f.writes.length, 0);
    assert.equal(f.view.keybinds.toggleVisibility, 'Ctrl+\\');
});

test('Escape cancels; modifier-only/repeat/composition never overwrite a shortcut', () => {
    const f = editor();
    for (const key of ['Shift', 'Control', 'Alt', 'Meta']) f.key(key);
    f.key('k', { ctrlKey: true, repeat: true });
    f.key('k', { ctrlKey: true, isComposing: true });
    f.key('Escape');
    assert.equal(f.writes.length, 0);
    assert.equal(f.field.value, 'Ctrl+\\');
    assert.match(f.view.shortcutStatus, /cancel/i);
});

test('intentional combinations save; duplicate and unsupported shortcuts report conflicts', () => {
    const f = editor();
    f.key('Enter', { ctrlKey: true });
    assert.equal(f.writes.length, 0);
    assert.match(f.view.shortcutConflicts.toggleVisibility, /already assigned/i);
    f.key('k'); assert.equal(f.writes.length, 0);
    f.key('k', { ctrlKey: true, altKey: true });
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].toggleVisibility, 'Ctrl+Alt+K');
});

function nativeShortcuts(options = {}) {
    const held = new Map(), writes = [], removed = [], ipc = new Map();
    let saved = null;
    const win = {
        webContents: { id: 12, send() {} }, isDestroyed: () => false,
        visible: true, minimized: false, ignores: false, taskbar: false,
        isVisible() { return this.visible; }, isMinimized() { return this.minimized; },
        hide() { this.visible = false; }, show() { this.visible = true; },
        minimize() { this.minimized = true; }, restore() { this.minimized = false; },
        setIgnoreMouseEvents(value) { this.ignores = value; }, setSkipTaskbar(value) { this.taskbar = !value; }, focus() {},
    };
    const electron = {
        globalShortcut: {
            register(key, fn) { if (held.has(key) || key === options.refuse) return false; held.set(key, fn); return true; },
            unregister(key) { removed.push(key); held.delete(key); },
        },
        ipcMain: { on() {}, handle: (name, fn) => ipc.set(name, fn) }, screen: {}, app: {},
    };
    const api = loadMain('src/utils/window.js', {
        electron, '../storage': { setKeybinds(value) { writes.push(value); if (options.writeFail) return false; saved = { ...value }; return true; } },
    });
    api.updateGlobalShortcuts(api.getDefaultKeybinds(), win, () => {}, { current: null }, { reassertHudMode() {} });
    api.setupWindowIpcHandlers(win, () => {}, { current: null }, { reassertHudMode() {} });
    return { api, held, writes, removed, win, ipc, saved: () => saved };
}

test('failed registration restores the previous working binding and does not persist', () => {
    const f = nativeShortcuts({ refuse: 'Ctrl+Alt+K' });
    const old = f.api.getShortcutState().registered.toggleVisibility;
    const result = f.api.saveGlobalShortcuts({ ...f.api.getShortcutState().data, toggleVisibility: 'Ctrl+Alt+K' });
    assert.equal(result.success, false);
    assert.equal(f.writes.length, 0);
    assert.equal(f.api.getShortcutState().registered.toggleVisibility, old);
    assert.ok(f.held.has(old));
    assert.deepEqual(f.removed, [old]); // No unrelated shortcut is unregistered.
    assert.equal(f.api.getShortcutState().data.toggleVisibility, old);
    assert.match(result.conflicts.toggleVisibility, /could not register/i);
});

test('main validates aliases, duplicate bindings and reserved keys before changing registration', () => {
    const f = nativeShortcuts();
    for (const binding of ['Tab', 'Shift+Tab', 'Ctrl+Escape', 'Shift', 'A', 'Alt+F4', 'Ctrl+Alt+Delete', 'Super+L', 'Ctrl+Ctrl+K']) {
        assert.equal(f.api.saveGlobalShortcuts({ ...f.api.getShortcutState().data, toggleVisibility: binding }).success, false, binding);
    }
    assert.equal(f.api.saveGlobalShortcuts({ ...f.api.getShortcutState().data, toggleVisibility: 'Control+Enter' }).success, false);
    assert.equal(f.removed.length, 0); assert.equal(f.writes.length, 0);
    assert.equal(f.api.normalizeAccelerator('Alt+Control+k'), 'Ctrl+Alt+K');
});

test('persistence failure rolls back native registration; success survives a settings reload', () => {
    const f = nativeShortcuts({ writeFail: true });
    assert.equal(f.api.saveGlobalShortcuts({ ...f.api.getShortcutState().data, toggleVisibility: 'Ctrl+Alt+K' }).success, false);
    assert.equal(f.api.getShortcutState().registered.toggleVisibility, 'Ctrl+\\');
    assert.equal(f.held.has('Ctrl+Alt+K'), false);
    const g = nativeShortcuts();
    assert.equal(g.api.saveGlobalShortcuts({ ...g.api.getShortcutState().data, toggleVisibility: 'Ctrl+Alt+K' }).success, true);
    assert.equal(g.saved().toggleVisibility, 'Ctrl+Alt+K');
    assert.equal(g.api.getShortcutState().data.toggleVisibility, 'Ctrl+Alt+K');
    assert.deepEqual(g.removed, ['Ctrl+\\']);
});

test('without a tray Hide minimizes to a recoverable taskbar entry; restore exits click-through without ending capture', () => {
    const f = nativeShortcuts();
    const toggle = f.ipc.get('toggle-window-visibility');
    const event = { sender: f.win.webContents };
    assert.equal(toggle(event).success, true);
    assert.equal(f.win.minimized, true); assert.equal(f.win.taskbar, true);
    assert.equal(f.win.visible, true); // Never hide an unrecoverable skip-taskbar window.
    f.win.ignores = true;
    assert.equal(toggle(event).success, true);
    assert.equal(f.win.minimized, false); assert.equal(f.win.ignores, false);
    assert.equal(toggle({ sender: { id: 99 } }).success, false);
});
