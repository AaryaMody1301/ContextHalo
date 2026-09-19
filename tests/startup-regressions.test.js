const test = require('node:test');
const assert = require('node:assert/strict');
const { componentClass } = require('./helpers/component-fixture');
const { geminiFixture } = require('./helpers/gemini-fixture');
const tick = () => new Promise(resolve => setImmediate(resolve));

function home(mode = 'byok') {
    const preferences = { providerMode: mode };
    const writes = [];
    const { Target } = componentClass('src/components/views/MainView.js', 'MainView', {
        contextHalo: { storage: {
            getConfig: async () => ({}), getPreferences: async () => preferences,
            getCredentialStatus: async () => ({ gemini: false, groq: false }),
            updatePreference: async (key, value) => { writes.push([key, value]); preferences[key] = value; return { success: true }; },
        } },
    });
    return { Target, preferences, writes, view: new Target() };
}

test('Home selects Local AI, persists the choice and starts without a cloud key or platform shim', async () => {
    const f = home();
    await tick();
    assert.equal(await f.view._saveMode('local'), true);
    assert.equal(f.preferences.providerMode, 'local');
    let starts = 0;
    f.view.onStart = () => { starts++; };
    await f.view._handleStart();
    assert.equal(starts, 1);
    assert.equal(f.view._keyError, false);
    const reloaded = new f.Target();
    await tick();
    reloaded.onStart = () => { starts++; };
    await reloaded._handleStart();
    assert.equal(reloaded._mode, 'local');
    assert.equal(starts, 2);
    for (const mode of ['groq', 'byok', 'local']) assert.equal(await f.view._saveMode(mode), true);
    assert.deepEqual(f.writes.map(([, value]) => value), ['local', 'groq', 'byok', 'local']);
});

test('a failed Local AI selection save cannot start using stale persisted provider settings', async () => {
    const f = home(); await tick();
    f.view._persistConfiguration = () => { f.view._saveError = 'Not saved'; return Promise.resolve(false); };
    assert.equal(await f.view._saveMode('local'), false);
    let started = false; f.view.onStart = () => { started = true; };
    await f.view._handleStart();
    assert.equal(started, false);
    assert.equal(f.preferences.providerMode, 'byok');
});

for (const mode of ['byok', 'groq', 'local']) test(`${mode}: IPC initializes the correct provider and forwards the UI epoch`, async t => {
    const f = geminiFixture(); t.after(() => f.close());
    const result = mode === 'local'
        ? await f.call('initialize-local', 'local-model', 'tiny.en', 'interview', '', 'en-US', { uiEpoch: 17 })
        : await f.start(mode, { uiEpoch: 17 });
    assert.equal(result.success, true);
    assert.deepEqual(f.preparations, [['windows', mode, 17], ['runtime', mode]]);
    assert.equal(f.connections.length, mode === 'byok' ? 1 : 0);
});

test('Live ErrorEvent preserves nested authentication failure instead of calling it a network outage', async t => {
    const f = geminiFixture(); t.after(() => f.close());
    const client = { live: { connect({ callbacks }) {
        callbacks.onerror({ message: 'WebSocket error', error: { status: 401, message: 'API key not valid' } });
        return new Promise(() => {});
    } } };
    await assert.rejects(f.api.connectGeminiLiveWithGuard(client, { callbacks: {} }, 50), error => {
        const failure = f.api.classifyGeminiFailure(error);
        assert.equal(failure.category, 'authentication');
        assert.equal(failure.httpStatus, 401);
        return true;
    });
});

test('ending a session during model discovery promptly releases Start and permits another provider', async t => {
    let release;
    const f = geminiFixture({ catalog: () => new Promise(resolve => { release = resolve; }) });
    t.after(() => f.close());
    const pending = f.start(); await tick(); await f.close();
    let completed = false; pending.then(() => { completed = true; });
    await tick();
    // Release the fixture even when the assertion fails, so it cannot hang Node.
    const cancelledPromptly = completed;
    release({ live: [{ id: 'gemini-3.8-live' }] });
    assert.equal((await pending).success, false);
    assert.equal(cancelledPromptly, true);
    assert.equal((await f.start('groq')).success, true);
    assert.equal(f.connections.length, 0);
});

test('startup diagnostics distinguish DNS and TLS failures without returning raw credentials or URLs', async t => {
    const f = geminiFixture(); t.after(() => f.close());
    for (const [code, category, retryable] of [['ENOTFOUND', 'transient', true], ['CERT_HAS_EXPIRED', 'tls', false]]) {
        const failure = f.api.classifyGeminiFailure({ message: 'WebSocket error', stage: 'transport',
            cause: { code, message: 'https://secret.example?key=private-credential confidential prompt' } });
        assert.equal(failure.category, category);
        assert.equal(failure.retryable, retryable);
        assert.equal(failure.networkCode, code);
        assert.equal(failure.stage, 'transport');
        assert.doesNotMatch(JSON.stringify(failure), /secret\.example|private-credential|confidential prompt/);
    }
    assert.equal(f.api.classifyGeminiFailure({ status: 407 }).category, 'proxy-authentication');
});
