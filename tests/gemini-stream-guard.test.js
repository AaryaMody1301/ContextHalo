const test = require('node:test');
const assert = require('node:assert/strict');
const { guardGeminiStream } = require('../src/utils/geminiStreamGuard');
const { classifyGeminiFailure } = require('../src/utils/geminiFailure');

function splitResponse(text, headers = {}) {
    const bytes = Buffer.from(text);
    return new Response(new ReadableStream({
        start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); },
    }), { headers: { 'content-type': 'text/event-stream', ...headers } });
}

test('stream guard preserves split Unicode, CRLF, grounding and thought signatures exactly', async () => {
    const text = ':keepalive\r\n\r\ndata: ' + JSON.stringify({ candidates: [{ content: { parts: [
        { text: '日本語 €', thoughtSignature: 'opaque-signature' },
    ] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.org' } }] }, finishReason: 'STOP' }] }) + '\r\n\r\n';
    assert.equal(await guardGeminiStream(splitResponse(text)).text(), text);
});

test('stream errors retain structured retry delays without returning private text in failures', async () => {
    const payload = JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'private request text', details: [
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '120s' },
    ] } });
    for (const text of ['data: ' + payload + '\n\n', 'data: ' + payload, payload]) {
        await assert.rejects(guardGeminiStream(splitResponse(text, { 'retry-after': '60' })).text(), error => {
            const failure = classifyGeminiFailure(error, 'screen', 'gemini-3.8-flash');
            assert.equal(failure.httpStatus, 503);
            assert.equal(failure.retryAfterMs, 120000);
            assert.doesNotMatch(JSON.stringify(failure), /private request text/);
            return true;
        });
    }
});

test('stream guard bounds malformed event buffering and propagates reader cancellation', async () => {
    let cancelled = false;
    const original = new Response(new ReadableStream({
        start(controller) { controller.enqueue(Buffer.from('data: ' + 'x'.repeat(2 * 1024 * 1024))); },
        cancel() { cancelled = true; },
    }), { headers: { 'content-type': 'text/event-stream' } });
    await assert.rejects(guardGeminiStream(original).text(), /supported size/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled, true);
});

test('stream guard leaves unary JSON responses alone', () => {
    const response = new Response('{}', { headers: { 'content-type': 'application/json' } });
    assert.equal(guardGeminiStream(response), response);
});
