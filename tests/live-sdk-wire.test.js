const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { geminiFixture } = require('./helpers/gemini-fixture');
let sdk;
let WebSocketServer;
try {
    sdk = require('@google/genai');
    ({ WebSocketServer } = createRequire(require.resolve('@google/genai'))('ws'));
} catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

// Use the installed SDK and its WebSocket implementation, not a mock connect().
// All connections terminate on loopback; no account, key or provider is accessed.
async function liveServer(t, mode = 'success', fixtureOptions = {}) {
    const received = [];
    const server = http.createServer();
    const sockets = new WebSocketServer({ noServer: true });
    server.on('upgrade', (request, socket, head) => {
        if (mode === 'authentication') {
            socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
            return;
        }
        sockets.handleUpgrade(request, socket, head, connection => {
            connection.on('message', bytes => {
                const message = JSON.parse(bytes.toString()); received.push(message);
                if (message.setup) {
                    if (mode === 'configuration') connection.close(1008, 'Invalid setup configuration');
                    else if (mode === 'search-quota' && message.setup.tools?.some(tool => tool.googleSearch)) connection.close(1011, 'Quota exceeded');
                    else if (mode === 'model-quota') connection.close(1011, 'generate_content_requests quota exceeded');
                    else if (mode === 'search-setup-1011' && message.setup.tools?.some(tool => tool.googleSearch)) {
                        connection.close(1011, 'Search setup unavailable for this project');
                    } else if (mode === 'session-management-1011' && (message.setup.sessionResumption || message.setup.contextWindowCompression)) {
                        connection.close(1011, 'Optional session management unavailable');
                    } else connection.send(JSON.stringify({ setupComplete: {} }));
                }
            });
        });
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => { for (const client of sockets.clients) client.terminate(); sockets.close(); server.closeAllConnections(); server.close(); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    class LoopbackAI extends sdk.GoogleGenAI {
        constructor(options) { super({ ...options, httpOptions: { ...options.httpOptions, baseUrl } }); }
    }
    const fixture = geminiFixture({ ...fixtureOptions, sdk: { ...sdk, GoogleGenAI: LoopbackAI } });
    t.after(() => fixture.close());
    return { fixture, received };
}

test('real SDK completes the production Live setup and serializes its audio/transcription contract', { skip: !sdk, timeout: 5000 }, async t => {
    const { fixture, received } = await liveServer(t);
    const result = await fixture.start('byok', { uiEpoch: 31 });
    assert.equal(result.success, true, result.error);
    assert.equal(received.length, 1);
    const { setup } = received[0];
    assert.equal(setup.model, 'models/gemini-3.8-live');
    assert.deepEqual(setup.generationConfig.responseModalities, ['AUDIO']);
    assert.deepEqual(setup.inputAudioTranscription, {});
    assert.deepEqual(setup.outputAudioTranscription, {});
    assert.deepEqual(setup.sessionResumption, {});
    assert.deepEqual(setup.contextWindowCompression, {
        triggerTokens: '25000',
        slidingWindow: { targetTokens: '8000' },
    });
    assert.equal(setup.generationConfig.thinkingConfig, undefined, 'Gemini 3.8 Live rejects thinkingConfig');
    assert.equal(JSON.stringify(setup).includes('abortSignal'), false);
    assert.deepEqual(fixture.preparations, [['windows', 'byok', 31], ['runtime', 'byok']]);
});

test('real SDK recovers from a setup-level 1011 by retrying the session without Search', { skip: !sdk, timeout: 5000 }, async t => {
    const { fixture, received } = await liveServer(t, 'search-setup-1011', { search: true });
    const result = await fixture.start('byok', { uiEpoch: 32 });
    assert.equal(result.success, true, result.error);
    assert.equal(received.length, 2);
    assert.equal(received[0].setup.tools.some(tool => tool.googleSearch), true);
    assert.equal(received[1].setup.tools, undefined);
    assert.equal(result.search.requested, true);
    assert.equal(result.search.liveEffective, false);
    assert.equal(result.search.status, 'live-setup-fallback');
});

test('real SDK retries setup 1011 with the documented core Live configuration', { skip: !sdk, timeout: 5000 }, async t => {
    const { fixture, received } = await liveServer(t, 'session-management-1011');
    const result = await fixture.start('byok', { uiEpoch: 33 });
    assert.equal(result.success, true, result.error);
    assert.equal(received.length, 2);
    assert.ok(received[0].setup.sessionResumption);
    assert.ok(received[0].setup.contextWindowCompression);
    assert.equal(received[1].setup.sessionResumption, undefined);
    assert.equal(received[1].setup.contextWindowCompression, undefined);
    assert.deepEqual(received[1].setup.inputAudioTranscription, {});
    assert.deepEqual(received[1].setup.outputAudioTranscription, {});
});

for (const [mode, category] of [['authentication', 'authentication'], ['configuration', 'invalid-configuration']]) {
    test(`real SDK ${mode} rejection is actionable and does not retry as a network outage`, { skip: !sdk, timeout: 5000 }, async t => {
        const { fixture } = await liveServer(t, mode);
        const result = await fixture.start();
        assert.equal(result.success, false);
        assert.equal(result.failure.category, category);
        assert.equal(result.failure.retryable, false);
        assert.doesNotMatch(result.error, /test-key-not-a-real-credential|127\.0\.0\.1/);
    });
}

for (const mode of ['search-quota', 'model-quota']) test(`real SDK ${mode} preserves quota scope and route-specific Search`, { skip: !sdk, timeout: 5000 }, async t => {
    const { fixture, received } = await liveServer(t, mode, { search: true });
    const result = await fixture.start('byok', { uiEpoch: 41 });
    assert.equal(result.success, mode === 'search-quota');
    assert.equal(received.length, mode === 'search-quota' ? 2 : 1);
    assert.equal(result.search.requested, true);
    assert.equal(result.search.httpEffective, true);
    assert.equal(fixture.preferences.googleSearchEnabled, true);
    if (mode === 'search-quota') {
        assert.equal(received[1].setup.tools, undefined);
        assert.equal(received[1].setup.model, received[0].setup.model);
        assert.deepEqual(received[1].setup.sessionResumption, received[0].setup.sessionResumption);
        assert.equal(result.search.liveEffective, false);
        assert.match(result.search.liveReason, /unconfirmed/);
    } else assert.equal(result.failure.quotaScope, 'model');
});
