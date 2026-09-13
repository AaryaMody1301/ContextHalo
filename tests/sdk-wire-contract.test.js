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
