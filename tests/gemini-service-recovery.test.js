const test = require('node:test');
const assert = require('node:assert/strict');
const { geminiFixture } = require('./helpers/gemini-fixture');
const transport = require('../src/utils/windowsProviderTransport');

for (const operation of ['text', 'screen']) test(`${operation}: two 503 responses recover with backoff, without reconnecting or changing Search`, async t => {
    const f = geminiFixture({ search: true }); t.after(() => f.close());
    await f.start();
    let calls = 0, now = 1000; const waits = [];
    const result = await f.api.runGeminiRequest(async () => {
        if (++calls < 3) throw Object.assign(new Error('UNAVAILABLE'), { status: 503 });
        return 'answer';
    }, { operation, model: operation, now: () => now, random: () => 0,
        wait: async ms => { waits.push(ms); now += ms; } });
    assert.equal(result, 'answer');
    assert.equal(calls, 3);
    assert.deepEqual(waits, [1000, 2000]);
    assert.equal(f.connections.length, 1);
    assert.equal(f.preferences.googleSearchEnabled, true);
});

test('persistent 503 stops at four HTTP attempts and reports service unavailability without blaming connectivity', async t => {
    const f = geminiFixture(); t.after(() => f.close());
    let calls = 0, now = 1000;
    await assert.rejects(f.api.runGeminiRequest(async () => {
        calls++; throw Object.assign(new Error('UNAVAILABLE'), { status: 503 });
    }, { operation: 'text', model: 'm', now: () => now, random: () => 0, wait: async ms => { now += ms; } }), error => {
        assert.equal(error.failure.httpStatus, 503);
        assert.match(error.message, /temporarily unavailable|overloaded/);
        assert.doesNotMatch(error.message, /connectivity recovers/);
        return true;
    });
    assert.equal(calls, 4);
});

test('Live-only Search fallback retains Search tools and instructions in text and screenshots', async t => {
    const f = geminiFixture({ search: true, live: async (params, attempt) => {
        if (attempt === 1) {
            params.callbacks.onopen?.({}); params.callbacks.onclose?.({ code: 1011, reason: 'unavailable' });
            return new Promise(() => {});
        }
        return { close() {}, sendRealtimeInput() {}, sendClientContent() {} };
    } }); t.after(() => f.close());
    const started = await f.start();
    assert.equal(started.success, true);
    assert.equal(started.search.effective, false);
    assert.equal(started.search.httpEffective, true);
    await f.call('send-text-message', 'question');
    await f.call('send-image-content', { data: Buffer.alloc(1100).toString('base64'), mimeType: 'image/jpeg', prompt: 'Read the code' });
    for (const params of f.generated) {
        assert.ok(params.config.tools?.some(tool => tool.googleSearch));
        assert.match(params.config.systemInstruction, /SEARCH TOOL USAGE/);
    }
    assert.equal(f.preferences.googleSearchEnabled, true);
});

for (const [status, reason] of [[401, 'unauthenticated'], [403, 'permission_denied'], [429, 'daily quota exceeded']]) {
    test(`Live setup ${status} inside 1011 is not bypassed by dropping capabilities`, async t => {
        const f = geminiFixture({ search: true, live: async params => {
            params.callbacks.onopen?.({});
            params.callbacks.onclose?.({ code: 1011, reason: `${status} ${reason}` });
            return new Promise(() => {});
        } }); t.after(() => f.close());
        const result = await f.start();
        assert.equal(result.success, false);
        assert.equal(f.connections.length, 1);
        assert.equal(result.search.effective, true);
    });
}

test('cancelled setup closes the open socket even if SDK connect never resolves', async t => {
    const f = geminiFixture(); t.after(() => f.close());
    const controller = new AbortController(); let closed = 0;
    const pending = f.api.connectGeminiLiveWithGuard({ live: { connect({ callbacks }) {
        callbacks.onopen({ target: { close() { closed++; } } });
        controller.abort(); return new Promise(() => {});
    } } }, { callbacks: {} }, 500, controller.signal);
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.equal(closed, 1);
});

test('Gemini HTTP transport keeps Retry-After and structured error details with no transport retry', async t => {
    t.after(() => transport.setFetchImplementationForTests(global.fetch));
    let calls = 0;
    transport.setFetchImplementationForTests(async () => {
        calls++;
        return new Response(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', details: [] } }), {
            status: 503, headers: { 'retry-after': '12', 'x-private': 'not for diagnostics' },
        });
    });
    await assert.rejects(transport.boundedFetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', {
        method: 'POST', signal: new AbortController().signal,
    }), error => {
        assert.equal(error.status, 503);
        assert.equal(error.headers['retry-after'], '12');
        assert.equal(error.headers['x-private'], undefined);
        assert.equal(JSON.parse(error.message).error.status, 'UNAVAILABLE');
        return true;
    });
    assert.equal(calls, 1);
});

test('typed 503 recovery saves one answer and keeps the original HTTP payload', async t => {
    const f = geminiFixture({ search: true, model: 'gemini-3.8-flash', generate: async (_params, attempt) => {
        if (attempt < 3) throw { status: 503, headers: { 'retry-after': '0' } };
        return { text: 'Recovered' };
    } }); t.after(() => f.close());
    await f.start();
    const result = await f.call('send-text-message', 'Original question');
    assert.equal(result.success, true, result.error);
    assert.equal(f.generated.length, 3);
    assert.deepEqual(f.generated[0].contents, f.generated[2].contents);
    assert.equal(f.generated[0].config.systemInstruction, f.generated[2].config.systemInstruction);
    assert.equal(f.connections.length, 1);
    assert.equal(f.events.filter(([channel]) => channel === 'save-conversation-turn').length, 1);
});

test('core Live reconnect replays local context rather than trusting an omitted resumption handle', async t => {
    const clientContent = [];
    const f = geminiFixture({ live: async (params, attempt) => {
        if (attempt === 2) {
            params.callbacks.onopen?.({}); params.callbacks.onclose?.({ code: 1011, reason: 'setup unavailable' });
            return new Promise(() => {});
        }
        return { close() {}, sendRealtimeInput() {}, sendClientContent: data => clientContent.push(data) };
    } }); t.after(() => f.close());
    await f.start(); await f.call('send-text-message', 'Remember this question');
    f.callbacks.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'old-handle' } });
    const result = await f.call('retry-session-connection', { withoutSearch: false });
    assert.equal(result.success, true, result.error);
    assert.equal(f.connections.length, 3);
    assert.equal(f.connections[2].config.sessionResumption, undefined);
    assert.equal(f.connections[2].config.historyConfig.initialHistoryInClientContent, true);
    assert.equal(clientContent.length, 1);
    assert.match(JSON.stringify(clientContent), /Remember this question/);
});

test('ending during HTTP retry backoff prevents a third attempt', async t => {
    const f = geminiFixture(); t.after(() => f.close());
    const controller = new AbortController(); let attempts = 0, waits = 0;
    await assert.rejects(f.api.runGeminiRequest(async () => {
        attempts++; throw { status: 503 };
    }, { operation: 'text', model: 'cancel-third', signal: controller.signal,
        wait: async () => { if (++waits === 2) controller.abort(); } }), error => error.name === 'AbortError');
    assert.equal(attempts, 2);
});
