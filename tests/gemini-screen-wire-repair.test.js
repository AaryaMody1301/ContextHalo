const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { GoogleGenAI, Modality } = require('@google/genai');
const { geminiFixture } = require('./helpers/gemini-fixture');
const transport = require('../src/utils/windowsProviderTransport');

for (const scenario of ['503-before-text', '503-after-text', '401', 'MAX_TOKENS', 'SAFETY']) {
    test(`real SDK screen stream handles ${scenario}`, { timeout: 7000 }, async t => {
        const requests = [];
        const server = http.createServer(async (request, response) => {
            const buffers = []; for await (const chunk of request) buffers.push(chunk);
            requests.push({ path: request.url, body: JSON.parse(Buffer.concat(buffers).toString()) });
            response.setHeader('content-type', 'text/event-stream');
            const event = data => 'data: ' + JSON.stringify(data) + '\n\n';
            if (scenario === '503-after-text') {
                response.write(event({ candidates: [{ content: { parts: [{ text: 'Partial answer' }] } }] }));
                // Force the first answer to reach the consumer before the error.
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (scenario.startsWith('503') && requests.length === 1 || scenario === '401') {
                const error = event({ error: { code: scenario === '401' ? 401 : 503,
                    status: scenario === '401' ? 'UNAUTHENTICATED' : 'UNAVAILABLE', message: 'private provider content' } });
                // Split the event across writes; errors cannot depend on socket chunk boundaries.
                response.write(error.slice(0, 18));
                response.end(error.slice(18));
            } else if (scenario === 'SAFETY') {
                response.end(event({ promptFeedback: { blockReason: 'SAFETY' } }));
            } else {
                response.end(event({ candidates: [{ content: { parts: [{ text: 'Screen answer' }] },
                    finishReason: scenario === 'MAX_TOKENS' ? 'MAX_TOKENS' : 'STOP' }] }));
            }
        });
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        const originalFetch = global.fetch;
        transport.setFetchImplementationForTests((input, init) => {
            const url = new URL(input);
            return originalFetch(`http://127.0.0.1:${server.address().port}${url.pathname}${url.search}`, init);
        });
        global.fetch = transport.boundedFetch;
        t.after(() => {
            global.fetch = originalFetch;
            transport.setFetchImplementationForTests(originalFetch);
            server.closeAllConnections(); server.close();
        });
        let liveConnections = 0;
        class WireAI extends GoogleGenAI {
            constructor(options) {
                super(options);
                this.live = { connect: async () => { liveConnections++; return { close() {}, sendRealtimeInput() {} }; } };
            }
        }
        const f = geminiFixture({ model: 'gemini-3.8-flash', search: true, sdk: { GoogleGenAI: WireAI, Modality } });
        t.after(() => f.close()); await f.start();
        const result = await f.call('send-image-content', {
            data: Buffer.alloc(1100).toString('base64'), mimeType: 'image/jpeg', prompt: 'Analyze code',
        });
        assert.equal(liveConnections, 1);
        assert.ok(requests.every(item => /\/v1beta\/models\/gemini-3\.8-flash:streamGenerateContent\?alt=sse$/.test(item.path)));
        assert.equal(requests[0].body.generationConfig.thinkingConfig.thinkingLevel, 'low');
        assert.ok(requests[0].body.tools.some(tool => tool.googleSearch));
        assert.ok(requests[0].body.contents[0].parts.some(part => part.inlineData?.mimeType === 'image/jpeg'));
        if (scenario === '503-before-text') {
            assert.equal(result.success, true, result.error);
            assert.equal(requests.length, 2);
            assert.deepEqual(requests[0].body, requests[1].body);
            assert.equal(f.events.filter(([channel]) => channel === 'save-screen-analysis').length, 1);
        } else {
            assert.equal(result.success, false);
            assert.equal(result.failure.category, { '503-after-text': 'transient', '401': 'authentication',
                MAX_TOKENS: 'output-limit', SAFETY: 'content-blocked' }[scenario]);
            assert.equal(requests.length, 1);
            assert.equal(f.events.filter(([channel]) => channel === 'save-screen-analysis').length, 0);
            assert.doesNotMatch(JSON.stringify(result), /private provider content/);
        }
    });
}
