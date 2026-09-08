const test = require('node:test');
const assert = require('node:assert/strict');
const { rendererFixture } = require('./helpers/renderer-fixture');
const { createWindowModeController } = require('../src/utils/windowModeController');

test('theme changes preserve the existing saved alpha, including zero; normal pages remain opaque', async () => {
    for (const alpha of [0, 0.25, 0.5, 0.8, 1]) {
        const f = rendererFixture({ prefs: { backgroundTransparency: alpha } });
        await f.api.theme.load(); await f.api.theme.save('light');
        assert.equal(f.api.theme.currentAlpha, alpha); assert.equal(f.prefs.backgroundTransparency, alpha);
        assert.equal(f.prefs.theme, 'light');
        assert.equal(f.variables.get('--hud-background'), `rgba(255, 255, 255, ${alpha})`);
        assert.match(f.variables.get('--bg-app'), /^rgb\(/);
        const restarted = rendererFixture({ prefs: f.prefs }); await restarted.api.theme.load();
        assert.equal(restarted.api.theme.currentAlpha, alpha); assert.equal(restarted.api.theme.current, 'light');
    }
});

test('opacity clamps invalid persisted values without fading foreground text', () => {
    const f = rendererFixture();
    for (const [input, expected] of [[-1, 0], [2, 1], ['invalid', 0.8]]) {
        f.api.theme.apply('dark', input); assert.equal(f.api.theme.currentAlpha, expected);
        assert.equal(f.variables.get('--text-primary'), '#e0e0e0');
    }
});

test('resized HUD bounds survive transitions/restart and clamp after display removal', () => {
    let bounds = { x: 80, y: 90, width: 900, height: 650 };
    let workArea = { x: 0, y: 0, width: 1920, height: 1040 };
    let saved;
    const calls = [];
    const win = {
        getBounds: () => ({ ...bounds }), getNormalBounds: () => ({ ...bounds }),
        isDestroyed: () => false, isMaximized: () => false, isVisible: () => true,
        setBounds(value) { bounds = value; }, setPosition(x, y) { bounds = { ...bounds, x, y }; },
        setMinimumSize() {}, setResizable() {}, setContentProtection: value => calls.push(['protected', value]),
        setSkipTaskbar() {}, setAlwaysOnTop: value => calls.push(['topmost', value]),
        setIgnoreMouseEvents: value => calls.push(['click-through', value]), moveTop() {},
        setOpacity() { assert.fail('foreground must not be faded with native window opacity'); },
    };
    const screen = { getDisplayMatching: () => ({ workArea }) };
    const controller = createWindowModeController(win, screen, { saveBounds: value => { saved = value; } });
    controller.enterHudMode();
    bounds = { x: 200, y: 180, width: 800, height: 430 }; controller.rememberBounds();
    controller.enterHudMode(); assert.deepEqual(bounds, saved.hud);
    controller.enterNormalMode(); assert.equal(bounds.width, 900);
    controller.enterHudMode(); assert.deepEqual(bounds, { x: 200, y: 180, width: 800, height: 430 });
    workArea = { x: 0, y: 0, width: 720, height: 400 }; controller.repositionHud();
    assert.equal(bounds.width, 720); assert.equal(bounds.height, 400); assert.equal(bounds.x, 0); assert.equal(bounds.y, 0);
    assert.ok(calls.some(([type, value]) => type === 'topmost' && value === true));
    assert.ok(calls.some(([type, value]) => type === 'click-through' && value === false));
    assert.ok(calls.filter(([type]) => type === 'protected').every(([, value]) => value === true));
});
