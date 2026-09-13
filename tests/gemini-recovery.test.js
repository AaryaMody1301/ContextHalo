const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: tick } = require('node:timers/promises');
const { geminiFixture } = require('./helpers/gemini-fixture');
const httpError = (status, message, details = []) => Object.assign(new Error(message), { status, details });
function fixture(t, options) { const f = geminiFixture(options); t.after(() => f.close()); return f; }

test('Gemini failure categories are distinct and never expose arbitrary error content', t => {
    const f = fixture(t);
    const cases = [
        [401, 'Invalid API key secret-credential', 'authentication'],
        [403, 'PERMISSION_DENIED', 'permission'],
        [400, 'google_search is unsupported by this model', 'unsupported-tool'],
        [400, 'Bad input configuration', 'invalid-configuration'],
        [404, 'Model not found', 'model-unavailable'],
        [429, 'RESOURCE_EXHAUSTED', 'rate-or-quota'],
        [429, 'Quota per day exceeded', 'quota-exhausted'],
        [429, 'RequestsPerMinute quota exceeded', 'throttled'],
        [503, 'service unavailable', 'transient'],
    ];
    for (const [status, text, category] of cases) {
        const failure = f.api.classifyGeminiFailure(httpError(status, text + ' confidential transcript'), 'text', 'selected');
        assert.equal(failure.category, category);
        assert.doesNotMatch(JSON.stringify(failure), /secret-credential|confidential transcript/);
    }
    assert.equal(f.api.classifyGeminiFailure(Object.assign(new Error('cancelled'), { name: 'AbortError' })).category, 'cancelled');
    assert.equal(f.api.classifyGeminiFailure(new Error('fetch failed')).category, 'transient');
});

test('Retry-After seconds/date and Gemini RetryInfo are parsed without shortening', t => {
    const f = fixture(t);
    const now = Date.parse('2026-09-08T12:00:00Z');
    assert.equal(f.api.classifyGeminiFailure({ status: 429, headers: new Headers({ 'Retry-After': '2.5' }) }, 'text', 'm', now).retryAfterMs, 2500);
    assert.equal(f.api.classifyGeminiFailure({ status: 429, headers: { 'retry-after': 'Tue, 08 Sep 2026 12:01:00 GMT' } }, 'text', 'm', now).retryAfterMs, 60000);
    for (const retryDelay of ['3.25s', { seconds: '3', nanos: 250000000 }]) {
        const error = new Error(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] } }));
        assert.equal(f.api.classifyGeminiFailure(error, 'text', 'm', now).retryAfterMs, 3250);
    }
});

test('one retry owner honors provider delay; absent delay uses bounded jitter', async t => {
    const f = fixture(t);
    for (const supplied of [true, false]) {
        let clock = 1000, calls = 0;
        const waits = [];
        const value = await f.api.runGeminiRequest(async () => {
            calls++;
            if (calls === 1) throw Object.assign(new Error('RequestsPerMinute exceeded'), { status: 429, ...(supplied ? { headers: { 'retry-after': '2' } } : {}) });
            return 'ok';
        }, { operation: 'text', model: `model-${supplied}`, apiKey: 'fake', now: () => clock, random: () => 0.5,
            wait: async milliseconds => { waits.push(milliseconds); clock += milliseconds; } });
        assert.equal(value, 'ok'); assert.equal(calls, 2);
        assert.deepEqual(waits, [supplied ? 2000 : 750]);
    }
});

test('unknown 429, exhausted quota, auth and unsupported tools do not retry automatically', async t => {
    const f = fixture(t);
    for (const [status, message] of [[429, 'RESOURCE_EXHAUSTED'], [429, 'daily quota'], [401, 'bad key'], [403, 'permission denied'], [400, 'unsupported google_search tool']]) {
        let calls = 0;
        await assert.rejects(f.api.runGeminiRequest(async () => { calls++; throw httpError(status, message); }, {
            operation: 'live', model: message, apiKey: 'fake', wait: async () => assert.fail('must not retry'),
        }));
        assert.equal(calls, 1);
    }
});

test('long provider delays remain visible and gate repeat actions for the same account/model', async t => {
    const f = fixture(t);
    let calls = 0;
    const options = { apiKey: 'account-a', model: 'quota-model', now: () => 1000, budgetMs: 10000 };
    const work = async () => { calls++; throw { status: 429, headers: { 'retry-after': '3600' } }; };
    await assert.rejects(f.api.runGeminiRequest(work, options), error => error.failure.retryAt === 3601000);
    await assert.rejects(f.api.runGeminiRequest(work, options));
    assert.equal(calls, 1);
    assert.equal(await f.api.runGeminiRequest(async () => 'other model', { ...options, model: 'other' }), 'other model');
});

test('cancellation during backoff never issues the second request', async t => {
    const f = fixture(t);
    const controller = new AbortController();
    let calls = 0;
    await assert.rejects(f.api.runGeminiRequest(async () => { calls++; throw httpError(503, 'unavailable'); }, {
        apiKey: 'fake', model: 'cancel', signal: controller.signal,
        wait: async () => controller.abort(),
    }), error => error.name === 'AbortError');
    assert.equal(calls, 1);
});

test('Search on/off is applied consistently to Live, typed and screen calls; SDK retries stay off', async t => {
    for (const search of [false, true]) {
        const f = fixture(t, { search });
        assert.equal((await f.start()).success, true);
        assert.equal((await f.call('send-text-message', 'Question')).success, true);
        assert.equal((await f.call('send-image-content', { data: Buffer.alloc(1100).toString('base64'), mimeType: 'image/jpeg', prompt: 'Analyze' })).success, true);
        assert.equal(Boolean(f.connections[0].config.tools?.length), search);
        assert.equal(f.generated.length, 2);
        for (const request of f.generated) {
            assert.equal(Boolean(request.config.tools?.length), search);
            assert.equal(request.config.httpOptions.retryOptions.attempts, 1);
            assert.equal(request.config.systemInstruction.includes('SEARCH TOOL USAGE'), search);
        }
        for (const client of f.clients) assert.equal(client.httpOptions.retryOptions.attempts, 1);
        await f.close();
    }
});

test('an unsupported Search setup fails once, retains requested Search and does not switch account/model', async t => {
    const f = fixture(t, { search: true, live: async () => { throw httpError(400, 'google_search tool is unsupported'); } });
    const result = await f.start();
    assert.equal(result.success, false); assert.equal(result.failure.category, 'unsupported-tool');
    assert.equal(result.search.requested, true); assert.equal(result.search.effective, true);
    assert.equal(f.connections.length, 1);
    assert.equal(f.preferences.googleSearchEnabled, true);
});

test('explicit continue-without-Search covers subsequent Live, typed, screen and reconnect prompts', async t => {
    const f = fixture(t, { search: true });
    await f.start();
    await f.call('send-text-message', 'First question');
    const old = f.callbacks;
    const result = await f.call('retry-session-connection', { withoutSearch: true });
    assert.equal(result.success, true);
    assert.equal(result.search.requested, true); assert.equal(result.search.effective, false);
    assert.equal(f.preferences.googleSearchEnabled, true);
    assert.equal(f.connections[1].config.tools, undefined);
    assert.doesNotMatch(f.connections[1].config.systemInstruction, /SEARCH TOOL USAGE/);
    await f.call('send-text-message', 'Second question');
    await f.call('send-image-content', { data: Buffer.alloc(1100).toString('base64'), mimeType: 'image/jpeg', prompt: 'Analyze' });
    for (const request of f.generated.slice(1)) {
        assert.equal(request.config.tools, undefined);
        assert.doesNotMatch(request.config.systemInstruction, /SEARCH TOOL USAGE/);
    }
    const before = f.events.length;
    old.onmessage({ serverContent: { modelTurn: { parts: [{ text: 'stale answer' }] } } });
    old.onerror(httpError(401, 'stale auth error'));
    assert.equal(f.events.length, before);
});

test('duplicate Start shares one initialization and ending a pending setup closes a late socket', async t => {
    let resolve;
    let closed = 0;
    const f = fixture(t, { live: () => new Promise(done => { resolve = done; }) });
    const first = f.start(); const duplicate = f.start();
    await tick();
    assert.equal(f.connections.length, 1); assert.equal(f.preparations.length, 2);
    await f.close();
    assert.equal((await first).success, false); assert.equal((await duplicate).success, false);
    resolve({ close() { closed++; } });
    await tick(); assert.equal(closed, 1);
    assert.equal(f.events.filter(([channel]) => channel === 'save-session-context').length, 0);
});

test('end during typed work prevents orphan answers or history updates, including after a restart', async t => {
    let resolve;
    const f = fixture(t, { generate: () => new Promise(done => { resolve = done; }) });
    await f.start();
    const pending = f.call('send-text-message', 'Question pending');
    await tick(); await f.close();
    assert.equal((await pending).success, false);
    await f.start();
    resolve({ text: 'late secret answer' }); await tick();
    assert.equal(f.events.filter(([channel]) => ['new-response', 'save-conversation-turn'].includes(channel)).length, 0);
});

test('automatic transient reconnect retains history and invalidates old socket callbacks', async t => {
    const f = fixture(t);
    await f.start(); await f.call('send-text-message', 'Before reconnect');
    const old = f.callbacks;
    old.onclose({ code: 1006, reason: 'network disconnect' }); await tick();
    assert.equal(f.connections.length, 2);
    assert.equal(f.events.filter(([channel]) => channel === 'save-session-context').length, 1);
    assert.ok(f.clientContent.some(item => item.turnComplete === false && JSON.stringify(item.turns).includes('Before reconnect')));
    const count = f.events.length;
    old.onmessage({ serverContent: { modelTurn: { parts: [{ text: 'stale' }] } } });
    assert.equal(f.events.length, count);
});

test('grounding metadata survives current response and saved history; unsafe source URLs are excluded', async t => {
    const metadata = { groundingChunks: [{ web: { uri: 'https://example.org/source', title: 'Source' } }, { web: { uri: 'javascript:alert(1)' } }],
        groundingSupports: [{ segment: { startIndex: 0, endIndex: 5 }, groundingChunkIndices: [0] }],
        searchEntryPoint: { renderedContent: '<div>Provider search suggestions</div>' }, webSearchQueries: ['mock query'] };
    const f = fixture(t, { search: true, generate: async () => ({ text: 'Answer', candidates: [{ groundingMetadata: metadata }] }) });
    await f.start(); const result = await f.call('send-text-message', 'Question');
    assert.equal(result.success, true);
    assert.ok(JSON.stringify(result.grounding).includes('https://example.org/source'));
    assert.doesNotMatch(JSON.stringify(result.grounding), /javascript:/);
    const saved = f.events.find(([channel]) => channel === 'save-conversation-turn');
    assert.deepEqual(saved[1].turn.grounding, result.grounding);
    assert.ok(f.events.some(([channel,, meta]) => channel === 'new-response' && meta.grounding === result.grounding));
});

test('Groq and Local remain explicit providers and never silently open a Gemini connection', async t => {
    const f = fixture(t, { search: true });
    assert.equal((await f.start('groq')).success, true);
    assert.equal((await f.call('send-text-message', 'Groq question')).success, true);
    assert.equal(f.connections.length, 0); assert.equal(f.generated.length, 0);
    await f.close();
    assert.equal((await f.call('initialize-local', 'local-model', 'whisper', 'interview', '', 'en-US')).success, true);
    assert.equal((await f.call('send-text-message', 'Local question')).text, 'Local answer');
    assert.equal(f.connections.length, 0);
});
