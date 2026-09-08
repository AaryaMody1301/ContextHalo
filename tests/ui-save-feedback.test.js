const test = require('node:test');
const assert = require('node:assert/strict');
const { componentClass } = require('./helpers/component-fixture');
const { rendererFixture } = require('./helpers/renderer-fixture');
const tick = () => new Promise(resolve => setImmediate(resolve));

function settings(storage) {
    const { Target } = componentClass('src/components/views/CustomizeView.js', 'CustomizeView', { unifiedPageStyles: [], contextHalo: { storage } });
    return Object.assign(Object.create(Target.prototype), { _saveVersions: {}, _failedWrites: new Map(), saveStates: {}, theme: 'dark' });
}

test('storage writes are checked, serialized and snapshotted; failed writes do not block later edits', async () => {
    let release; const writes = [];
    const f = rendererFixture({ invoke: (channel, key, value) => {
        if (channel !== 'storage:update-preference') return;
        writes.push([key, value]);
        return writes.length === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ success: true });
    } });
    const pack = { title: 'first' };
    const first = f.api.storage.updatePreference('sessionPack', pack);
    const failed = assert.rejects(first, /could not save|retained/i);
    pack.title = 'mutated after invocation';
    const second = f.api.storage.updatePreference('sessionPack', { title: 'second' });
    await tick(); assert.deepEqual(writes, [['sessionPack', { title: 'first' }]]);
    release({ success: false }); await failed; await second;
    assert.equal(writes[1][1].title, 'second');
});

test('a read after a queued write observes completion rather than stale preferences', async () => {
    let release, value = 'old';
    const f = rendererFixture({ invoke: (channel, key, next) => {
        if (channel === 'storage:update-preference') return new Promise(resolve => { release = () => { value = next; resolve({ success: true }); }; });
        if (channel === 'storage:get-preferences') return Promise.resolve({ success: true, data: { value } });
    } });
    const write = f.api.storage.updatePreference('value', 'new');
    let resolved = false; const read = f.api.storage.getPreferences().then(data => { resolved = true; return data; });
    await tick(); assert.equal(resolved, false); release(); await write;
    assert.equal((await read).value, 'new');
});

test('Settings retain edits for explicit unsuccessful saves and permit retry', async () => {
    let fail = true;
    const view = settings({ updatePreference: async () => ({ success: !fail }) });
    view.theme = 'light';
    assert.equal(await view._savePreference('theme', 'light'), false);
    assert.equal(view.theme, 'light'); assert.equal(view.saveStates.theme, 'failed');
    fail = false; await view.retrySaves(); assert.equal(view.saveStates.theme, 'saved'); assert.equal(view._failedWrites.size, 0);
});

test('stale Settings completion cannot replace feedback for a newer value', async () => {
    const completions = [];
    const view = settings({ updatePreference: () => new Promise(resolve => completions.push(resolve)) });
    const old = view._savePreference('backgroundTransparency', 0.2);
    const recent = view._savePreference('backgroundTransparency', 0.7);
    completions[1]({ success: true }); await recent;
    completions[0]({ success: false }); await old;
    assert.equal(view.saveStates.backgroundTransparency, 'saved'); assert.equal(view._failedWrites.size, 0);
});

test('AI instructions preserve newer edits while a save finishes and expose rejected writes', async () => {
    let release, rejectNext = false;
    const { Target } = componentClass('src/components/views/AICustomizeView.js', 'AICustomizeView', {
        unifiedPageStyles: [], contextHalo: { storage: { getPreferences: async () => ({ customPrompt: 'stored' }), updatePreference: () => rejectNext ? Promise.reject(Error('disk')) : new Promise(resolve => { release = resolve; }) } },
    });
    const view = new Target(); await tick();
    view._editContext({ target: { value: 'first edit' } });
    const saving = view._saveContext(); assert.equal(await view._saveContext(), false);
    view._editContext({ target: { value: 'newer edit' } });
    release({ success: true }); await saving;
    assert.equal(view._context, 'newer edit'); assert.equal(view._state, 'unsaved');
    rejectNext = true; assert.equal(await view._saveContext(), false);
    assert.equal(view._context, 'newer edit'); assert.equal(view._state, 'failed');
});

test('AI instructions restore an in-memory failed draft instead of replacing it with persisted text', async () => {
    let release;
    const { Target } = componentClass('src/components/views/AICustomizeView.js', 'AICustomizeView', {
        unifiedPageStyles: [], contextHalo: { storage: { getPreferences: () => new Promise(resolve => { release = resolve; }) } },
    });
    const view = new Target(); view.draft = 'unsaved retained draft';
    release({ customPrompt: 'old disk version' }); await tick();
    assert.equal(view._context, 'unsaved retained draft'); assert.equal(view._state, 'unsaved');
});

for (const failedStep of ['instructions', 'config']) test(`onboarding ${failedStep} failure prevents completion; retry and double-click guards work`, async () => {
    let fail = true, release, completed = 0; const writes = [];
    const { Target } = componentClass('src/components/views/OnboardingView.js', 'OnboardingView', { contextHalo: { storage: {
        updatePreference: async () => { writes.push('instructions'); return { success: !(fail && failedStep === 'instructions') }; },
        updateConfig: () => { writes.push('config'); return fail && failedStep === 'config' ? Promise.resolve({ success: false }) : new Promise(resolve => { release = resolve; }); },
    } } });
    const view = new Target(); view.contextText = 'retained context'; view.onComplete = () => completed++;
    assert.equal(await view.completeOnboarding(), false); assert.equal(completed, 0); assert.equal(view.contextText, 'retained context');
    assert.match(view.saveError, /could not be saved/i);
    if (failedStep === 'instructions') assert.equal(writes.includes('config'), false);
    fail = false; const retry = view.completeOnboarding(); await tick();
    assert.equal(await view.completeOnboarding(), false); assert.equal(completed, 0);
    release({ success: true }); assert.equal(await retry, true); assert.equal(completed, 1);
});

function home() {
    const { Target } = componentClass('src/components/views/MainView.js', 'MainView');
    let started = 0;
    const view = Object.assign(Object.create(Target.prototype), {
        _mode: 'byok', _geminiKey: '', _geminiLiveModel: 'manual-live', _geminiHttpModel: 'manual-http',
        _keySavePromise: Promise.resolve(), _configurationWrites: Promise.resolve(), downloadProgress: {}, _configurationLoading: false,
        onStart: () => started++, updateComplete: Promise.resolve(), shadowRoot: { querySelector: () => null },
    });
    return { view, started: () => started };
}

test('Home missing credentials guides setup; saved settings never claim verified account access', async () => {
    const f = home(); await f.view._handleStart(); assert.equal(f.started(), 0); assert.equal(f.view._setupOpen, true);
    assert.match(f.view.startError, /API key/);
    f.view._geminiKey = 'fixture'; f.view._keyError = false; await f.view._handleStart(); assert.equal(f.started(), 1);
    assert.match(f.view._readinessSummary(), /checked when connecting/);
    assert.equal(f.view._geminiLiveModel, 'manual-live');
});

test('Home loading, unsaved changes and initialization gate Start; active session returns without changing providers', async () => {
    const f = home(); f.view._geminiKey = 'fixture';
    f.view._configurationLoading = true; await f.view._handleStart(); assert.equal(f.started(), 0);
    f.view._configurationLoading = false; f.view._saveError = 'disk'; await f.view._handleStart(); assert.equal(f.started(), 0);
    f.view._saveError = ''; f.view.isInitializing = true; await f.view._handleStart(); assert.equal(f.started(), 0);
    f.view.sessionActive = true; await f.view._handleStart(); assert.equal(f.started(), 1);
    await f.view._saveMode('groq'); assert.equal(f.view._mode, 'byok');
});

test('all appearance palettes retain readable text and native control contrast without whole-window opacity', () => {
    const f = rendererFixture();
    const luminance = color => {
        const values = color.startsWith('#') ? color.slice(1).match(/../g).map(value => parseInt(value, 16)) : color.match(/[\d.]+/g).slice(0, 3).map(Number);
        const [r, g, b] = values.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const name of Object.keys(f.api.theme.themes)) {
        f.api.theme.apply(name, 0.37);
        assert.match(f.variables.get('--hud-background'), /0\.37\)/);
        for (const background of ['--bg-app', '--bg-surface', '--bg-elevated', '--bg-hover']) {
            assert.match(f.variables.get(background), /^rgb\(/, 'Normal pages and interactive surfaces stay opaque');
            for (const text of ['--text-primary', '--text-secondary', '--text-muted']) {
                const a = luminance(f.variables.get(background)), b = luminance(f.variables.get(text));
                assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `${name}: ${text} is readable over ${background}`);
            }
        }
        assert.equal(f.variables.get('--control-color-scheme'), ['light', 'sepia'].includes(name) ? 'light' : 'dark');
    }
});

test('Settings opacity/hydration reapplies matching foreground and background together', () => {
    const calls = [];
    const { Target } = componentClass('src/components/views/CustomizeView.js', 'CustomizeView', {
        unifiedPageStyles: [], contextHalo: { theme: { apply: (...args) => calls.push(args) } },
    });
    const view = Object.assign(Object.create(Target.prototype), { theme: 'light', backgroundTransparency: 0.37 });
    view.updateBackgroundAppearance();
    assert.deepEqual(calls, [['light', 0.37]]);
});
