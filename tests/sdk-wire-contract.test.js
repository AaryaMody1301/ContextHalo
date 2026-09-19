const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
let available = true;
try { require.resolve('@google/genai'); } catch { available = false; }

// A real SDK against a loopback HTTP server: no credential or provider request
// leaves this process. Unlike fixture tests, this checks SDK serialization.
test('installed Gemini SDK serializes the supported screen contract and forwards cancellation', { skip: !available }, async t => {
    const { GoogleGenAI } = require('@google/genai');
    const requests = [];
    const server = http.createServer(async (request, response) => {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        requests.push({ url: request.url, body: JSON.parse(Buffer.concat(chunks).toString()) });
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Wire contract passed' }] } }] }));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => { server.closeAllConnections(); server.close(); });
    const client = new GoogleGenAI({ apiKey: 'not-a-provider-credential', httpOptions: {
        baseUrl: `http://127.0.0.1:${server.address().port}`, apiVersion: 'v1beta', retryOptions: { attempts: 1 },
    } });
    const result = await client.models.generateContent({
        model: 'gemini-3.8-flash', contents: [{ inlineData: { mimeType: 'image/jpeg', data: 'YWJj' } }, { text: 'Read this code' }],
        config: { thinkingConfig: { thinkingLevel: 'low' }, systemInstruction: 'Assist with this interview practice.',
            abortSignal: new AbortController().signal, httpOptions: { timeout: 70000, retryOptions: { attempts: 1 } } },
    });
    assert.equal(result.text, 'Wire contract passed');
    assert.match(requests[0].url, /\/v1beta\/models\/gemini-3\.8-flash:generateContent$/);
    assert.equal(requests[0].body.generationConfig.thinkingConfig.thinkingLevel, 'low');
    assert.ok(JSON.stringify(requests[0].body.contents).includes('image/jpeg'));
    assert.equal(JSON.stringify(requests[0].body).includes('abortSignal'), false);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(client.models.generateContent({ model: 'gemini-3.8-flash', contents: 'Cancelled', config: { abortSignal: controller.signal } }));
    assert.equal(requests.length, 1);
});

const { geminiFixture } = require('./helpers/gemini-fixture');
const transport = require('../src/utils/windowsProviderTransport');

for (const scenario of ['recover', 'retry-after']) test(`installed SDK HTTP 503 ${scenario} preserves provider backoff and the typed request`, { skip: !available, timeout: 5000 }, async t => {
    const { GoogleGenAI, Modality } = require('@google/genai');
    const received = [];
    const providerUrls = [];
    const server = http.createServer(async (request, response) => {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        received.push(JSON.parse(Buffer.concat(chunks).toString()));
        response.setHeader('content-type', 'application/json');
        if (scenario === 'retry-after' || received.length < 3) {
            response.statusCode = 503;
            response.setHeader('retry-after', scenario === 'retry-after' ? '120' : '0');
            response.end(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'Service unavailable' } }));
        } else {
            response.setHeader('content-type', 'text/event-stream');
            response.end('data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Recovered answer' }] } }] }) + '\n\n');
        }
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const originalFetch = global.fetch;
    const nativeFetch = originalFetch.bind(global);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    // Keep the production URL through the real transport classifier. Only the
    // final socket destination is redirected to loopback; no provider is called.
    transport.setFetchImplementationForTests((input, init) => {
        const url = new URL(input);
        providerUrls.push(url.pathname + url.search);
        return nativeFetch(baseUrl + url.pathname, init);
    });
    global.fetch = transport.boundedFetch;
    t.after(() => {
        global.fetch = originalFetch; transport.setFetchImplementationForTests(originalFetch);
        server.closeAllConnections(); server.close();
    });
    let connections = 0;
    class WireAI extends GoogleGenAI {
        constructor(options) {
            super(options);
            this.live = { connect: async () => { connections++; return { close() {}, sendRealtimeInput() {} }; } };
        }
    }
    const f = geminiFixture({ search: true, model: 'gemini-3.8-flash', sdk: { GoogleGenAI: WireAI, Modality } });
    t.after(() => f.close());
    assert.equal((await f.start()).success, true);
    const result = await f.call('send-text-message', 'Explain this request');
    assert.equal(connections, 1, 'HTTP retries never reconnect the Live session');
    if (scenario === 'recover') {
        assert.equal(result.success, true, result.error);
        assert.equal(result.text, 'Recovered answer');
        assert.equal(received.length, 3);
        assert.ok(providerUrls.every(url => /:streamGenerateContent\?alt=sse$/.test(url)), 'typed Gemini uses the SDK streaming endpoint');
        assert.equal(received[2].generationConfig.thinkingConfig.thinkingLevel, 'low');
        assert.deepEqual(received[0], received[2], 'retries keep the exact model, question, context and Search policy');
        assert.ok(received[2].tools.some(tool => tool.googleSearch));
        assert.equal(f.events.filter(([channel]) => channel === 'save-conversation-turn').length, 1);
    } else {
        assert.equal(result.success, false);
        assert.equal(result.failure.retryAfterMs, 120000);
        assert.equal(result.failure.httpStatus, 503);
        assert.equal(received.length, 1, 'a delay outside the deadline is exposed, never shortened');
        assert.equal(f.events.filter(([channel]) => channel === 'save-conversation-turn').length, 0);
    }
});
