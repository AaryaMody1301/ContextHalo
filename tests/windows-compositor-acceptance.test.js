const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadMain } = require('./helpers/native-boundary');

function compositorFixture(options = {}) {
    const captures = [], protection = [], evaluations = [], files = new Map(), zOrder = [];
    let alpha = 0.37, background = 0, destroyed = false, created = 0;
    const output = path.resolve('compositor-test-output');
    const display = { id: 77, bounds: { x: -1280, y: 0, width: 1280, height: 800 }, workArea: { x: -1280, y: 0, width: 1280, height: 760 } };
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
        getBounds: () => ({ x: -900, y: 40, width: 640, height: 320 }),
        getContentBounds: () => ({ x: -900, y: 40, width: 640, height: 320 }),
        setContentProtection: value => protection.push(value),
        show() {}, moveTop() { zOrder.push('top'); }, moveAbove(id) { if (options.moveAboveError) throw new Error('unsupported'); zOrder.push(id); },
    };
    class Backdrop {
        constructor() { created++; }
        async loadURL() {}
        showInactive() {}
        setBackgroundColor(value) { background = value === '#ffffff' ? 255 : 0; }
        getMediaSourceId() { return 'window:fixture:0'; }
        isDestroyed() { return destroyed; }
        destroy() { destroyed = true; }
    }
    function makeCrop(width, height) {
        return {
            getSize: () => options.emptyCrop ? { width: 0, height: 0 } : { width, height },
            toPNG: () => Buffer.from('fixture-png'),
            toBitmap() {
                if (options.emptyCrop) return Buffer.alloc(0);
                const value = options.opaqueSurface ? 16 : Math.round(16 * alpha + background * (1 - alpha));
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
        crop(rect) { captures.at(-1).crop = rect; return makeCrop(rect.width, rect.height); },
    };
    const source = { id: 'screen:fixture:0', display_id: options.emptyDisplayId ? '' : '77', thumbnail };
    const desktopCapturer = { async getSources(request) {
        captures.push({ request, alpha, background });
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
        captures, protection, evaluations, zOrder,
        get created() { return created; }, get destroyed() { return destroyed; },
        report: () => JSON.parse(files.get(path.join(output, 'compositor.json'))),
        pngs: () => [...files.keys()].filter(file => file.endsWith('.png')),
        run: () => api.verifyWindowsCompositor(window, output),
    };
}

function assertCleaned(f) {
    assert.equal(f.destroyed, true);
    assert.deepEqual(f.protection, [false, true]);
    const last = f.evaluations.at(-1);
    assert.match(last, /compositor-test-style.*remove\(\)/);
    assert.match(last, /theme\.apply\("light",0\.37\)/);
}

test('compositor capture uses Electron screen sources and verifies all native alpha blends', async () => {
    const f = compositorFixture();
    const result = await f.run();
    assert.equal(result.success, true);
    assert.equal(f.captures.length, 10);
    assert.equal(f.pngs().length, 10);
    assert.ok(f.zOrder.every(id => id === 'window:fixture:0'));
    const first = f.captures[0];
    assert.deepEqual(first.request, { types: ['screen'], thumbnailSize: { width: 1280, height: 800 }, fetchWindowIcons: false });
    assert.deepEqual(first.crop, { x: 480, y: 140, width: 40, height: 40 });
    const setup = f.evaluations.find(code => code.includes("const shell=root.querySelector('.app-shell')"));
    assert.match(setup, /\.app-shell > \* \{ visibility:hidden !important; \}/);
    assert.match(setup, /getBoundingClientRect\(\)/);
    assert.doesNotMatch(setup, /compositor-test-marker/);
    assert.deepEqual(result.samples.map(sample => sample.alpha), [0, 0.25, 0.5, 0.8, 1]);
    for (const sample of result.samples) {
        assert.deepEqual(sample.captures.map(capture => capture.background), [0, 255]);
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

for (const [name, options, message] of [
    ['screen capture failure', { captureError: new Error('screen source failed') }, /screen source failed/],
    ['opaque window instead of transparency', { opaqueSurface: true }, /Desktop alpha mismatch/],
    ['empty screen thumbnail', { emptyThumbnail: true }, /Desktop capture produced no pixels/],
    ['empty cropped image', { emptyCrop: true }, /Desktop capture crop produced no pixels/],
    ['ambiguous display source', { missingDisplay: true, multipleDisplays: true }, /capture source for display 77 is unavailable/],
]) test(`compositor rejects ${name} and restores capture protection`, async () => {
    const f = compositorFixture(options);
    await assert.rejects(f.run(), message);
    assert.equal(f.captures.length, 1, 'No retry may disguise a failed capture/assertion');
    assert.equal(f.report().success, false);
    assert.match(f.report().error, message);
    assertCleaned(f);
});

test('compositor falls back to moveTop only when targeted z-order is unavailable', async () => {
    const f = compositorFixture({ moveAboveError: true });
    assert.equal((await f.run()).success, true);
    assert.ok(f.zOrder.every(value => value === 'top'));
    assertCleaned(f);
});

test('compositor cannot run in production, outside Windows, with DevTools or native resize enabled', async () => {
    for (const [options, message] of [
        [{ production: true }, /isolated Windows smoke profile/],
        [{ platform: 'linux' }, /isolated Windows smoke profile/],
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
