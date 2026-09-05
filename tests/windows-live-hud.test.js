const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    getHudBounds,
    clampBoundsToWorkArea,
} = require('../src/utils/windowModeController');

const root = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('live HUD is top-centered and bounded on a 1080p-class Windows work area', () => {
    const bounds = getHudBounds({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } });
    assert.deepEqual(bounds, { x: 480, y: 24, width: 960, height: 520 });
});

test('live HUD respects an offset work area and remains inside the display', () => {
    const workArea = { x: 100, y: 50, width: 1366, height: 728 };
    const bounds = getHudBounds({ workArea });

    assert.deepEqual(bounds, { x: 387, y: 74, width: 792, height: 520 });
    assert.ok(bounds.x >= workArea.x);
    assert.ok(bounds.y >= workArea.y);
    assert.ok(bounds.x + bounds.width <= workArea.x + workArea.width);
    assert.ok(bounds.y + bounds.height <= workArea.y + workArea.height);
});

test('restored normal bounds are clamped into the current Windows work area', () => {
    const workArea = { x: 0, y: 0, width: 1600, height: 900 };
    const restored = clampBoundsToWorkArea(
        { x: 1500, y: 850, width: 1100, height: 800 },
        workArea
    );

    assert.deepEqual(restored, { x: 500, y: 100, width: 1100, height: 800 });
});

test('window integration switches privacy and z-order policy by app mode', () => {
    const windowSource = read('src/utils/window.js');
    const controllerSource = read('src/utils/windowModeController.js');

    assert.match(windowSource, /createWindowModeController/);
    assert.match(windowSource, /enterHudMode\(\)/);
    assert.match(windowSource, /enterNormalMode\(\)/);
    assert.match(windowSource, /mouseEventsIgnored = false/);
    assert.doesNotMatch(windowSource, /setVisibleOnAllWorkspaces/);

    assert.match(controllerSource, /setContentProtection\(true\)/);
    assert.match(controllerSource, /setAlwaysOnTop\(true, 'screen-saver', 1\)/);
    assert.match(controllerSource, /setAlwaysOnTop\(false\)/);
    assert.match(controllerSource, /setBackgroundMaterial\(mainWindow, 'acrylic'\)/);
    assert.match(controllerSource, /setBackgroundMaterial\(mainWindow, 'mica'\)/);
    assert.match(controllerSource, /setSkipTaskbar\(mainWindow, true\)/);
    assert.match(controllerSource, /setSkipTaskbar\(mainWindow, false\)/);
});

test('renderer loads the Windows HUD layer before runtime hardening', () => {
    const html = read('src/index.html');
    const hudSource = read('src/utils/windowsHudRenderer.js');

    const hudIndex = html.indexOf('utils/windowsHudRenderer.js');
    const hardeningIndex = html.indexOf('utils/runtimeHardeningRenderer.js');
    assert.ok(hudIndex >= 0);
    assert.ok(hardeningIndex > hudIndex);

    assert.match(hudSource, /Private HUD/);
    assert.match(hudSource, /\.traffic-light\.maximize/);
    assert.match(hudSource, /\.traffic-light\.close:hover/);
    assert.match(hudSource, /backdrop-filter: blur\(30px\)/);
    assert.match(hudSource, /currentView === 'assistant'/);
});

test('maximize caption has one Lit handler, not a second imperative toggle', () => {
    const hardeningSource = read('src/utils/runtimeHardeningRenderer.js');
    const appSource = read('src/components/app/ContextHaloApp.js');
    assert.doesNotMatch(hardeningSource, /maximizeButton.addEventListener/);
    assert.match(appSource, /@click=\$\{\(\) => this._handleMaximize\(\)\}/);
});


test('returning from HUD restores the maximized state and original normal bounds', () => {
    const { createWindowModeController } = require('../src/utils/windowModeController');
    const original = { x: 50, y: 60, width: 900, height: 650 };
    let bounds = { x: 0, y: 0, width: 1920, height: 1040 };
    let maximized = true;
    const window = {
        getBounds: () => bounds, getNormalBounds: () => original,
        isDestroyed: () => false, isMaximized: () => maximized,
        unmaximize() { maximized = false; bounds = { width: 700, height: 320, x: 0, y: 0 }; },
        maximize() { maximized = true; }, setBounds(value) { bounds = value; },
        setContentProtection() {}, setBackgroundMaterial() {}, setMinimumSize() {},
        setResizable() {}, setSkipTaskbar() {}, setAlwaysOnTop() {}, setIgnoreMouseEvents() {}, moveTop() {},
    };
    const display = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
    const controller = createWindowModeController(window, { getDisplayMatching: () => display });
    controller.enterHudMode();
    assert.equal(maximized, false);
    controller.enterNormalMode();
    assert.equal(maximized, true);
    assert.deepEqual(bounds, original);
});
