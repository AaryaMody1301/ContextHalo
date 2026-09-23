const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadMain } = require('./helpers/native-boundary');

// Exercise the real acceptance orchestrator at its native boundaries. Fixture
// pixels test assertions/cleanup, not Windows compositing or the GDI runtime.
function compositorFixture(options = {}) {
    const captures = [], protection = [], evaluations = [], files = new Map();
    let alpha = 0.37, background = 0, destroyed = false, created = 0;
    const output = path.resolve('compositor-test-output');
    const window = {
        webContents: {
            isDevToolsOpened: () => options.devTools === true,
            async executeJavaScript(code) {
                evaluations.push(code);
                if (code.startsWith('({theme:')) return { theme: 'light', alpha: 0.37 };
                const match = code.match(/^contextHalo\.theme\.apply\('dark',([\d.]+)\)$/);
                if (match) alpha = Number(match[1]);
            },
        },
        isResizable: () => options.resizable === true,
        getBounds: () => ({ x: -900, y: 40, width: 640, height: 320 }),
        getContentBounds: () => ({ x: -900, y: 40, width: 640, height: 320 }),
        setContentProtection: value => protection.push(value),
        show() {}, moveTop() {},
    };
    class Backdrop {
        constructor() { created++; }
        async loadURL() {}
        setAlwaysOnTop() {}
        showInactive() {}
        setBackgroundColor(value) { background = value === '#ffffff' ? 255 : 0; }
        isDestroyed() { return destroyed; }
        destroy() { destroyed = true; }
    }
    const api = loadMain('scripts/windows-compositor-acceptance.js', {
        'node:fs': { writeFileSync: (filename, content) => files.set(filename, content) },
        'node:timers/promises': { setTimeout: async () => {} },
        'node:child_process': { execFile(command, args, execOptions, callback) {
            captures.push({ command, args, execOptions, alpha, background });
            callback(options.captureError || null, '', '');
        } },
        electron: {
            app: { isPackaged: true }, BrowserWindow: Backdrop,
            screen: {
                getDisplayMatching: () => ({ workArea: { x: -1280, y: 0, width: 1280, height: 800 } }),
                dipToScreenRect: (_window, rect) => Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Math.round(value * 1.5)])),
            },
            nativeImage: { createFromPath: () => ({
                getSize: () => options.emptyImage ? { width: 0, height: 0 } : { width: 150, height: 36 },
                toBitmap() {
                    const bitmap = Buffer.alloc(150 * 36 * 4);
                    const surface = options.opaqueSurface ? 16 : Math.round(16 * alpha + background * (1 - alpha));
                    for (const [x, value] of [[15, surface], [120, options.fadedForeground ? 112 : 224]]) {
                        const offset = (18 * 150 + x) * 4;
                        bitmap.fill(value, offset, offset + 3);
                        bitmap[offset + 3] = 255;
                    }
                    return bitmap;
                },
            }) },
        },
    }, { process: {
        platform: options.platform || 'win32',
        argv: options.production ? [] : ['--ci-smoke-test'],
        env: {}, versions: { electron: '44.3.0' },
    } });
    return {
        captures, protection, evaluations,
        get created() { return created; }, get destroyed() { return destroyed; },
        report: () => JSON.parse(files.get(path.join(output, 'compositor.json'))),
        run: () => api.verifyWindowsCompositor(window, output),
    };
}

function assertCleaned(f) {
    assert.equal(f.destroyed, true);
    assert.deepEqual(f.protection, [false, true]);
    const last = f.evaluations.at(-1);
    assert.match(last, /compositor-test-style.*remove\(\)/);
    assert.match(last, /compositor-test-marker.*remove\(\)/);
    assert.match(last, /theme\.apply\("light",0\.37\)/);
}

test('compositor capture uses native BitBlt with layered-window flags and balanced HDC ownership', async () => {
    const f = compositorFixture();
    const result = await f.run();
    assert.equal(result.success, true);
    assert.equal(f.captures.length, 10);
    const { command, args, execOptions } = f.captures[0];
    assert.equal(command, 'powershell.exe');
    assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
    const script = args[3];
    assert.doesNotMatch(script, /CopyFromScreen|CopyPixelOperation/);
    assert.match(script, /DllImport\("gdi32\.dll", SetLastError = true\)/);
    assert.match(script, /extern bool BitBlt[\s\S]*?uint operation/);
    assert.match(script, /\[uint32\]\(0x00CC0020 -bor 0x40000000\)/);
    assert.match(script, /\[CaptureNative\]::BitBlt\(\$destinationDc, 0, 0, \$r\[2\], \$r\[3\], \$desktopDc, \$r\[0\], \$r\[1\], \$operation\)/);
    assert.match(script, /if \(!\$copied\).*Win32Exception.*GetLastWin32Error/);
    assert.match(script, /finally \{ \$graphics\.ReleaseHdc\(\$destinationDc\) \}/);
    assert.match(script, /finally \{ \$graphics\.Dispose\(\) \}/);
    assert.match(script, /finally \{ \$bitmap\.Dispose\(\) \}/);
    assert.match(script, /finally \{ \[CaptureNative\]::ReleaseDC\(\[IntPtr\]::Zero, \$desktopDc\)/);
    assert.ok(script.indexOf('ReleaseHdc($destinationDc)') < script.indexOf('$bitmap.Save('));
    assert.match(script, /PixelFormat\]::Format24bppRgb/);
    assert.equal(execOptions.timeout, 10000);
    assert.equal(execOptions.windowsHide, true);
    assert.equal(execOptions.env.CONTEXTHALO_TEST_RECT, '-1200,210,150,36');
    assert.deepEqual(result.samples.map(sample => sample.alpha), [0, 0.25, 0.5, 0.8, 1]);
    for (const sample of result.samples) assert.deepEqual(sample.captures.map(capture => capture.background), [0, 255]);
    assert.equal(f.report().success, true);
    assertCleaned(f);
});

for (const [name, options, message] of [
    ['native capture failure', { captureError: new Error('BitBlt failed') }, /BitBlt failed/],
    ['opaque window instead of transparency', { opaqueSurface: true }, /Desktop alpha mismatch/],
    ['faded foreground', { fadedForeground: true }, /Foreground faded/],
    ['empty desktop image', { emptyImage: true }, /Desktop capture produced no pixels/],
]) test(`compositor rejects ${name} and restores capture protection`, async () => {
    const f = compositorFixture(options);
    await assert.rejects(f.run(), message);
    assert.equal(f.captures.length, 1, 'No retry may disguise the failed capture/assertion');
    assert.equal(f.report().success, false);
    assert.match(f.report().error, message);
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
