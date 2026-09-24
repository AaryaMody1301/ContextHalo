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

test('current Gemini 3.8 Live starts without a blocking advisory model-list request', async t => {
    const f = geminiFixture({ catalog: async () => { throw new Error('catalog should not block current stable Live'); } });
    t.after(() => f.close());
    const result = await f.start();
    assert.equal(result.success, true, result.error);
    assert.equal(f.connections.length, 1);
});

test('ending a session during model discovery promptly releases Start and permits another provider', async t => {
    let release;
    const f = geminiFixture({ config: { geminiLiveModel: 'gemini-3.1-flash-live-preview' }, catalog: () => new Promise(resolve => { release = resolve; }) });
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


test('Gemini Live setup retries once without Search after a setup-level WebSocket 1011', async t => {
    const f = geminiFixture({ search: true, live: async (params, attempt) => {
        if (attempt === 1) {
            params.callbacks.onopen?.({});
            params.callbacks.onclose?.({ code: 1011, reason: 'internal setup failure' });
            return new Promise(() => {});
        }
        return { close() {}, sendRealtimeInput() {}, sendClientContent() {} };
    } });
    t.after(() => f.close());
    const result = await f.start('byok', { uiEpoch: 23 });
    assert.equal(result.success, true, result.error);
    assert.equal(f.connections.length, 2);
    assert.equal(JSON.stringify(f.connections[0].config.tools), JSON.stringify([{ googleSearch: {} }]));
    assert.equal(f.connections[1].config.tools, undefined);
    assert.equal(result.search.requested, true);
    assert.equal(result.search.liveEffective, false);
    assert.equal(result.search.status, 'live-setup-fallback');
    assert.equal(f.preferences.googleSearchEnabled, true, 'saved Search preference is unchanged');
    assert.ok(f.events.some(([channel, value]) => channel === 'update-status' && /Gemini Live connected without Search/i.test(value)));
});

test('a compatibility fallback is limited to one fresh session and does not disable later long-session reliability', async t => {
    const f = geminiFixture({ search: false, live: async (params, attempt) => {
        if (attempt === 1) {
            assert.ok(params.config.sessionResumption);
            assert.equal(params.config.contextWindowCompression.triggerTokens, '25000');
            params.callbacks.onopen?.({});
            params.callbacks.onclose?.({ code: 1011, reason: 'temporary setup incompatibility' });
            return new Promise(() => {});
        }
        if (attempt === 2) {
            assert.equal(params.config.sessionResumption, undefined);
            assert.equal(params.config.contextWindowCompression, undefined);
        }
        if (attempt === 3) {
            assert.ok(params.config.sessionResumption, 'a new user session requests resumption again');
            assert.equal(params.config.contextWindowCompression.triggerTokens, '25000');
            assert.equal(params.config.contextWindowCompression.slidingWindow.targetTokens, '8000');
        }
        return { close() {}, sendRealtimeInput() {}, sendClientContent() {} };
    } });
    t.after(() => f.close());

    assert.equal((await f.start('byok', { uiEpoch: 31 })).success, true);
    await f.close();
    assert.equal((await f.start('byok', { uiEpoch: 32 })).success, true);
    assert.equal(f.connections.length, 3);
});

test('fresh reconnect fallback replays only bounded recent local context after a long session', async t => {
    const f = geminiFixture();
    t.after(() => f.close());
    assert.equal((await f.start('byok', { uiEpoch: 33 })).success, true);

    for (let index = 0; index < 80; index++) {
        f.api.saveConversationTurn(
            `question-${index} ${'q'.repeat(3500)}`,
            `answer-${index} ${'a'.repeat(3500)}`
        );
    }

    f.callbacks.onclose({ code: 1006, reason: 'provider rotation' });
    for (let count = 0; count < 8 && f.clientContent.length === 0; count++) await tick();

    assert.ok(f.connections.length >= 2, 'the Live runtime reconnects after a recoverable rotation');
    const replay = f.clientContent.at(-1)?.turns?.[0]?.parts?.[0]?.text || '';
    assert.ok(replay.length > 0, 'recent local context is replayed when no resumption handle exists');
    assert.ok(replay.length <= 16000, 'reconnect replay remains bounded during multi-hour sessions');
    assert.match(replay, /question-79/);
    assert.doesNotMatch(replay, /question-0 /);
});

test('Gemini Live setup retries with core config after a setup-level 1011 without Search', async t => {
    const f = geminiFixture({ search: false, live: async (params, attempt) => {
        if (attempt === 1) {
            assert.ok(params.config.sessionResumption);
            assert.ok(params.config.contextWindowCompression);
            params.callbacks.onopen?.({});
            params.callbacks.onclose?.({ code: 1011, reason: 'optional setup unavailable' });
            return new Promise(() => {});
        }
        assert.equal(params.config.sessionResumption, undefined);
        assert.equal(params.config.contextWindowCompression, undefined);
        assert.equal(JSON.stringify(params.config.inputAudioTranscription), '{}');
        assert.equal(JSON.stringify(params.config.outputAudioTranscription), '{}');
        return { close() {}, sendRealtimeInput() {}, sendClientContent() {} };
    } });
    t.after(() => f.close());
    const result = await f.start('byok', { uiEpoch: 24 });
    assert.equal(result.success, true, result.error);
    assert.equal(f.connections.length, 2);
    assert.ok(f.events.some(([channel, value]) => channel === 'update-status' && /core Live configuration/i.test(value)));
});
