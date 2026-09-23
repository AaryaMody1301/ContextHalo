const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadMain } = require('./helpers/native-boundary');

function compositorFixture(options = {}) {
    const captures = [], protection = [], evaluations = [], files = new Map(), zOrder = [], backdropScripts = [];
    let alpha = 0.37, background = 0, destroyed = false, created = 0;
    const output = path.resolve('compositor-test-output');
    const display = { id: 77, bounds: { x: -1280, y: 0, width: 1280, height: 800 }, workArea: { x: -1280, y: 0, width: 1280, height: 760 } };
    const windowBounds = options.fullscreen ? { x: -1280, y: 0, width: 1280, height: 760 } : { x: -900, y: 40, width: 640, height: 320 };
    const window = {
        webContents: {
            isDevToolsOpened: () => options.devTools === true,
            async executeJavaScript(code) {
                evaluations.push(code);
                if (code.startsWith('({theme:')) return { theme: 'light', alpha: 0.37 };
                if (code.includes("const shell=root.querySelector('.app-shell')")) return { capture: { x: 100, y: 100, width: 40, height: 40 } };
                const match = code.match(/^contextHalo\.theme\.apply\('dark',([\d.]+)\)$/);
                if (match) alpha = Number(match[1]);
            },
        },
        isResizable: () => options.resizable === true,
        isContentProtected: () => options.protected === true,
        getBounds: () => ({ ...windowBounds }),
        getContentBounds: () => ({ ...windowBounds }),
        setContentProtection: value => protection.push(value),
        show() {}, moveTop() { zOrder.push('top'); }, moveAbove(id) { if (options.moveAboveError) throw new Error('unsupported'); zOrder.push(id); },
    };
    class Backdrop {
        constructor() {
            created++;
            this.webContents = { executeJavaScript: async code => {
                backdropScripts.push(code);
                const match = code.match(/rgb\((\d+),(\d+),(\d+)\)/);
                if (match) background = Number(match[1]);
            } };
        }
        async loadURL() {}
        showInactive() {}
        getMediaSourceId() { return 'window:fixture:0'; }
        isDestroyed() { return destroyed; }
        destroy() { destroyed = true; }
    }
    const surfaceScreenRect = () => ({ x: windowBounds.x + 100, y: windowBounds.y + 100, width: 40, height: 40 });
    const isControlCrop = rect => rect.x < 100;
    function makeCrop(width, height, kind) {
        return {
            getSize: () => options.emptyCrop ? { width: 0, height: 0 } : { width, height },
            toPNG: () => Buffer.from(`fixture-${kind}`),
            toBitmap() {
                if (options.emptyCrop) return Buffer.alloc(0);
                let value;
                if (kind === 'control') value = options.badBackdrop ? 0 : background;
                else value = options.opaqueSurface ? 16 : Math.round(16 * alpha + background * (1 - alpha));
                const bitmap = Buffer.alloc(width * height * 4);
                for (let offset = 0; offset < bitmap.length; offset += 4) {
                    bitmap[offset] = value; bitmap[offset + 1] = value; bitmap[offset + 2] = value; bitmap[offset + 3] = 255;
                }
                return bitmap;
            },
        };
    }
    const thumbnail = {
        getSize: () => options.emptyThumbnail ? { width: 0, height: 0 } : { width: 1280, height: 800 },
        crop(rect) {
            const kind = isControlCrop(rect) ? 'control' : 'surface';
            captures.at(-1).crops.push({ ...rect, kind });
            return makeCrop(rect.width, rect.height, kind);
        },
    };
    const source = { id: 'screen:fixture:0', display_id: options.emptyDisplayId ? '' : '77', thumbnail };
    const desktopCapturer = { async getSources(request) {
        captures.push({ request, alpha, background, crops: [], surfaceScreenRect: surfaceScreenRect() });
        if (options.captureError) throw options.captureError;
        if (options.missingDisplay) return [{ ...source, display_id: '88' }, { ...source, id: 'screen:other:0', display_id: '99' }];
        return [source];
    } };
    const api = loadMain('scripts/windows-compositor-acceptance.js', {
        'node:fs': { writeFileSync: (filename, value) => files.set(filename, value) },
        'node:timers/promises': { setTimeout: async () => {} },
        electron: {
            app: { isPackaged: true }, BrowserWindow: Backdrop, desktopCapturer,
            screen: {
                getDisplayMatching: () => display,
                getAllDisplays: () => options.multipleDisplays ? [display, { id: 88 }] : [display],
            },
        },
    }, { process: {
        platform: options.platform || 'win32',
        argv: options.production ? [] : ['--ci-smoke-test'],
        env: {}, versions: { electron: '44.3.0' },
    } });
    return {
        api, captures, protection, evaluations, zOrder, backdropScripts,
        get created() { return created; }, get destroyed() { return destroyed; },
        report: () => JSON.parse(files.get(path.join(output, 'compositor.json'))),
        pngs: () => [...files.keys()].filter(file => file.endsWith('.png')),
        run: () => api.verifyWindowsCompositor(window, output),
    };
}

function assertCleaned(f) {
    assert.equal(f.destroyed, true);
    assert.deepEqual(f.protection, [], 'acceptance must never toggle capture protection');
    const last = f.evaluations.at(-1);
    assert.match(last, /compositor-test-style.*remove\(\)/);
    assert.match(last, /theme\.apply\("light",0\.37\)/);
}

test('compositor proves backdrop control and app alpha in the same Electron screen capture', async () => {
    const f = compositorFixture();
    const result = await f.run();
    assert.equal(result.success, true);
    assert.equal(f.captures.length, 10);
    assert.equal(f.pngs().length, 20);
    assert.ok(f.zOrder.every(id => id === 'window:fixture:0'));
    assert.equal(f.backdropScripts.length, 10);
    assert.match(f.backdropScripts[1], /rgb\(255,255,255\)/);
    assert.match(f.backdropScripts[1], /requestAnimationFrame/);
    const first = f.captures[0];
    assert.deepEqual(first.request, { types: ['screen'], thumbnailSize: { width: 1280, height: 800 }, fetchWindowIcons: false });
    assert.deepEqual(first.crops.map(crop => crop.kind), ['control', 'surface']);
    assert.deepEqual(first.crops.find(crop => crop.kind === 'surface'), { x: 480, y: 140, width: 40, height: 40, kind: 'surface' });
    const setup = f.evaluations.find(code => code.includes("const shell=root.querySelector('.app-shell')"));
    assert.match(setup, /\.app-shell > \* \{ visibility:hidden !important; \}/);
    assert.match(setup, /getBoundingClientRect\(\)/);
    assert.doesNotMatch(setup, /compositor-test-marker/);
    assert.deepEqual(result.samples.map(sample => sample.alpha), [0, 0.25, 0.5, 0.8, 1]);
    for (const sample of result.samples) {
        assert.deepEqual(sample.captures.map(capture => capture.background), [0, 255]);
        assert.deepEqual(sample.captures.map(capture => capture.control[0]), [0, 255]);
        assert.ok(sample.captures.every(capture => capture.thumbnail.selection === 'display-id'));
    }
    assert.equal(f.report().success, true);
    assertCleaned(f);
});

test('single-display capture may use the sole source when Windows omits display_id', async () => {
    const f = compositorFixture({ emptyDisplayId: true });
    const result = await f.run();
    assert.equal(result.success, true);
    assert.ok(result.samples.every(sample => sample.captures.every(capture => capture.thumbnail.selection === 'single-display')));
    assertCleaned(f);
});

test('control rectangle is guaranteed outside the ContextHalo window', () => {
    const f = compositorFixture();
    const rect = f.api._test.backdropControlRect({ workArea: { x: -1280, y: 0, width: 1280, height: 760 } }, { x: -900, y: 40, width: 640, height: 320 });
    assert.ok(rect);
    assert.equal(f.api._test.backdropControlRect({ workArea: { x: 0, y: 0, width: 640, height: 320 } }, { x: 0, y: 0, width: 640, height: 320 }), null);
});

for (const [name, options, message, expectedCaptures] of [
    ['screen capture failure', { captureError: new Error('screen source failed') }, /screen source failed/, 1],
    ['backdrop fixture mismatch', { badBackdrop: true }, /Backdrop control mismatch/, 2],
    ['opaque window instead of transparency', { opaqueSurface: true }, /Desktop alpha mismatch/, 1],
    ['empty screen thumbnail', { emptyThumbnail: true }, /Desktop capture produced no pixels/, 1],
    ['empty cropped image', { emptyCrop: true }, /Desktop capture crop produced no pixels/, 1],
    ['ambiguous display source', { missingDisplay: true, multipleDisplays: true }, /capture source for display 77 is unavailable/, 1],
]) test(`compositor rejects ${name} and cleans up the fixture`, async () => {
    const f = compositorFixture(options);
    await assert.rejects(f.run(), message);
    assert.equal(f.captures.length, expectedCaptures, 'No retry may disguise a failed capture/assertion');
    assert.equal(f.report().success, false);
    assert.match(f.report().error, message);
    assertCleaned(f);
});

test('compositor rejects a window that leaves no independently visible backdrop control area', async () => {
    const f = compositorFixture({ fullscreen: true });
    await assert.rejects(f.run(), /needs visible backdrop space/);
    assert.equal(f.created, 0);
    assert.deepEqual(f.protection, []);
});

test('compositor falls back to moveTop only when targeted z-order is unavailable', async () => {
    const f = compositorFixture({ moveAboveError: true });
    assert.equal((await f.run()).success, true);
    assert.ok(f.zOrder.every(value => value === 'top'));
    assertCleaned(f);
});

test('compositor cannot run in production, outside Windows, protected, with DevTools or native resize enabled', async () => {
    for (const [options, message] of [
        [{ production: true }, /isolated Windows smoke profile/],
        [{ platform: 'linux' }, /isolated Windows smoke profile/],
        [{ protected: true }, /before Windows capture protection is applied/],
        [{ devTools: true }, /Close DevTools/],
        [{ resizable: true }, /native resizing/],
    ]) {
        const f = compositorFixture(options);
        await assert.rejects(f.run(), message);
        assert.equal(f.created, 0);
        assert.equal(f.captures.length, 0);
        assert.deepEqual(f.protection, []);
    }
});
