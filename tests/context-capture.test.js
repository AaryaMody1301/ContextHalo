const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadMain } = require('./helpers/native-boundary');
const {
    sanitizeSelection,
    normalizeRegion,
} = loadMain('src/utils/contextCaptureMain.js');
const {
    sanitizeSessionPack,
    formatSessionPack,
    appendSessionPack,
} = require('../src/utils/sessionPackMain');

function read(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('capture selections and regions are normalized before main-process use', () => {
    assert.deepEqual(sanitizeSelection({ kind: 'screen', displayId: '42', sourceId: 'screen:42:0', label: 'Display 2' }), {
        kind: 'screen',
        displayId: '42',
        sourceId: 'screen:42:0',
        label: 'Display 2',
    });
    assert.equal(sanitizeSelection({ kind: 'unsafe', sourceId: 'x' }).kind, 'active-display');

    const region = normalizeRegion({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 });
    assert.ok(Math.abs(region.width - 0.5) < 1e-10);
    assert.ok(Math.abs(region.height - 0.4) < 1e-10);
    assert.equal(normalizeRegion({ x: 1, y: 0, width: 0.5, height: 0.4 }), null);
    assert.equal(normalizeRegion({ x: -2, y: 0, width: 0.5, height: 0.4 }), null);
    assert.equal(normalizeRegion({ x: 0, y: 0, width: 0.001, height: 0.4 }), null);
});

test('session packs are bounded and idempotently appended to provider context', () => {
    const pack = sanitizeSessionPack({
        title: 'Roadmap meeting',
        goal: 'Decide the release order',
        notes: 'Preserve compatibility.',
        clipboardText: 'Selected requirement text',
    });
    assert.equal(pack.title, 'Roadmap meeting');
    assert.match(formatSessionPack(pack), /Decide the release order/);
    assert.match(formatSessionPack(pack), /Selected requirement text/);

    const prompt = appendSessionPack('Base instructions', pack);
    assert.match(prompt, /\[ContextHalo session pack\]/);
    assert.equal(appendSessionPack(prompt, pack), prompt);
});

test('desktop source selection stays in the trusted main process and region selector is capture protected', () => {
    const main = read('src/utils/contextCaptureMain.js');
    const preload = read('preload.js');
    const selectorPreload = read('src/utils/regionSelectorPreload.js');
    const selectorHtml = read('src/region-selector.html');

    assert.match(main, /types: \['screen', 'window'\]/);
    assert.match(main, /thumbnailSize: \{ width: 0, height: 0 \}/);
    assert.match(main, /setDisplayMediaRequestHandler/);
    assert.match(main, /useSystemPicker: false/);
    assert.match(main, /setContentProtection\(true\)/);
    assert.match(main, /sandbox: true/);
    assert.match(main, /source\.id !== ownSourceId/);
    assert.match(preload, /context-capture:list-sources/);
    assert.match(preload, /context-capture:select-region/);
    assert.match(preload, /context-capture:read-clipboard/);
    assert.match(preload, /capture-source-invalidated/);
    assert.match(main, /mainWindow\.on\('moved', schedule\)/);
    assert.match(main, /capture-source-invalidated/);
    assert.match(main, /active-display-changed/);
    assert.match(selectorPreload, /region-selector-complete/);
    assert.match(selectorHtml, /Content-Security-Policy/);
});



test('display changes invalidate the active or pinned source without silently switching a pinned display', async t => {
    const { EventEmitter } = require('node:events');
    const { setTimeout: sleep } = require('node:timers/promises');
    const handlers = new Map();
    const preferences = { captureSource: { kind: 'window', sourceId: 'window:editor:0' } };
    let displayId = 1;
    let displays = [{ id: 1 }, { id: 2 }];
    let shareDisplay;
    // Keep a stale desktopCapturer entry when the monitor disappears.
    const sources = [
        { id: 'screen:1:0', display_id: '1', name: 'Primary' },
        { id: 'screen:2:0', display_id: '2', name: 'Second monitor' },
    ];
    const sends = [];
    const mainWindow = new EventEmitter();
    mainWindow.isDestroyed = () => false;
    mainWindow.getBounds = () => ({});
    mainWindow.getMediaSourceId = () => 'window:context-halo:0';
    mainWindow.webContents = { id: 1, mainFrame: {}, send: (...args) => sends.push(args) };
    const screen = new EventEmitter();
    screen.getPrimaryDisplay = () => ({ id: 1 });
    screen.getAllDisplays = () => displays;
    screen.getDisplayMatching = () => ({ id: displayId });
    const main = loadMain('src/utils/contextCaptureMain.js', {
        electron: {
            desktopCapturer: { getSources: async () => sources },
            screen,
            session: { defaultSession: { setDisplayMediaRequestHandler(handler) { shareDisplay = handler; } } },
        },
        '../storage': {
            getPreferences: () => preferences,
            updatePreference: (key, value) => { preferences[key] = value; return true; },
        },
    }, { process: { platform: 'win32' } });

    main.setupContextCaptureMain(mainWindow, { handle: (key, handler) => handlers.set(key, handler), removeHandler() {} });
    t.after(() => mainWindow.emit('closed'));
    const event = { sender: mainWindow.webContents, senderFrame: mainWindow.webContents.mainFrame };
    const selected = await handlers.get('context-capture:set-source')(event, { kind: 'active-display' });
    assert.equal(selected.success, true);

    displayId = 2;
    mainWindow.emit('moved');
    await sleep(220);
    assert.deepEqual(sends.at(-1), ['capture-source-invalidated', { reason: 'active-display-changed', displayId: '2' }]);
    await handlers.get('context-capture:set-source')(event, {
        kind: 'screen', displayId: '2', sourceId: 'screen:2:0', label: 'Second monitor',
    });
    displays = [{ id: 1 }];
    screen.emit('display-removed', {}, { id: 2 });
    await sleep(220);
    assert.deepEqual(sends.at(-1), ['capture-source-invalidated', { reason: 'selected-display-unavailable', displayId: null }]);
    const list = await main.listCaptureSources(mainWindow);
    assert.equal(list.selected.displayId, '2');
    assert.ok(!list.sources.some(source => source.key === 'screen:2'));
    const capture = () => new Promise(resolve => shareDisplay({ frame: event.senderFrame }, resolve));
    assert.deepEqual(await capture(), {});
    assert.match((await handlers.get('context-capture:select-region')(event)).error, /choose a connected display/i);

    displays.push({ id: 2 });
    screen.emit('display-added', {}, { id: 2 });
    await sleep(220);
    assert.deepEqual(sends.at(-1), ['capture-source-invalidated', { reason: 'selected-display-restored', displayId: '2' }]);
    assert.equal((await capture()).video.display_id, '2');
});
