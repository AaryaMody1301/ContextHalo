const test = require('node:test');
const assert = require('node:assert/strict');
const { geminiFixture } = require('./helpers/gemini-fixture');
const { loadMain } = require('./helpers/native-boundary');

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1200)]).toString('base64');
const completion = text => new Response(`data:${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } })}\n\ndata:[DONE]\n\n`);

test('Mistral routes text and JPEG screenshots independently with pinned model and context', async () => {
    const requests = [];
    const f = geminiFixture({ search: true, preferences: { responseMode: 'detailed', sessionPack: { goal: 'Mistral test goal' } },
        knowledgeDocuments: [{ id: 'diagram-guide', title: 'Diagram guide', chunks: [{ id: 'chunk-1', text: 'Explain the diagram: orange nodes represent ingestion stages.' }] }], fetch: async (url, init) => {
        requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
        return completion('Mistral answer');
    } });
    assert.equal((await f.start('mistral')).audioReady, false);
    try {
        assert.equal(f.connections.length, 0);
        const text = await f.call('send-text-message', 'Explain the diagram');
        assert.equal(text.success, true);
        assert.equal(text.model, 'mistral-small-2603');
        assert.equal(text.metrics.usage.totalTokens, 15);
        assert.equal((await f.call('send-image-content', { data: jpeg, prompt: 'Read this screen' })).success, true);
        assert.equal((await f.call('send-text-message', 'Follow up')).success, true);
        for (const request of requests) {
            assert.equal(request.url, 'https://api.mistral.ai/v1/chat/completions');
            assert.equal(request.headers.Authorization, 'Bearer mistral-test-key');
            assert.equal(request.body.model, 'mistral-small-2603');
            assert.equal(request.body.reasoning_effort, 'none');
            assert.equal(request.body.max_tokens, 2048);
            assert.equal(request.body.stream, true);
            assert.match(request.body.messages[0].content, /Mistral test goal/);
            assert.match(request.body.messages[0].content, /response mode: detailed/);
        }
        assert.equal(requests[1].body.messages.at(-1).content[0].image_url.url, `data:image/jpeg;base64,${jpeg}`);
        assert.match(requests[0].body.messages[0].content, /orange nodes/);
        assert.ok(requests[2].body.messages.some(message => message.role === 'assistant' && message.content === 'Mistral answer'));
        assert.match(requests[2].body.messages[0].content, /Most recent screen analysis/);
        assert.equal(f.generated.length, 0);
        assert.equal((await f.call('send-audio-content', { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' })).success, false);
        assert.equal((await f.call('send-mic-audio-content', { data: 'AAA=', mimeType: 'audio/pcm;rate=24000' })).success, false);
        assert.equal(f.preferences.googleSearchEnabled, true);
    } finally { await f.close(); }
});

test('Mistral rejects missing credentials, invalid provider and non-JPEG input without provider calls', async () => {
    const missing = geminiFixture({ getMistralApiKey: () => '' });
    assert.equal((await missing.start('mistral')).success, false);
    assert.equal((await missing.start('unrecognized')).success, false);
    assert.equal(missing.connections.length, 0);
    const f = geminiFixture({ fetch: () => { throw new Error('Unexpected provider call'); } });
    await f.start('mistral');
    try {
        const result = await f.call('send-image-content', { data: Buffer.alloc(1200).toString('base64'), prompt: 'Analyze' });
        assert.equal(result.success, false);
        assert.match(result.error, /JPEG/);
    } finally { await f.close(); }
});

test('Mistral parses fragmented UTF-8 and text blocks, excluding reasoning from the displayed answer', async () => {
    const event = `data:${JSON.stringify({ choices: [{ delta: { content: [{ type: 'thinking', thinking: 'private reasoning' }, { type: 'text', text: 'Café' }] }, finish_reason: 'stop' }] })}\r\n\r\ndata:[DONE]\r\n\r\n`;
    const bytes = Buffer.from(event);
    const displayed = [];
    const api = loadMain('src/utils/mistral.js', {}, { fetch: async () => new Response(new ReadableStream({ start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
    } })) });
    const result = await api.streamMistral({ apiKey: 'fixture', messages: [], operation: 'text', onText: text => displayed.push(text) });
    assert.equal(result.text, 'Café');
    assert.deepEqual(displayed, ['Café']);
});

test('Mistral retries once before output, honors Retry-After, and sanitizes permanent errors', async () => {
    let calls = 0;
    const waits = [];
    const api = loadMain('src/utils/mistral.js', {
        'node:timers/promises': { setTimeout: async ms => waits.push(ms) },
    }, { fetch: async () => ++calls === 1 ? new Response('secret provider body', { status: 503, headers: { 'retry-after': '2' } }) : completion('Recovered') });
    const result = await api.streamMistral({ apiKey: 'fixture', messages: [], operation: 'text', onText() {} });
    assert.equal(result.text, 'Recovered'); assert.equal(calls, 2); assert.deepEqual(waits, [2000]);
    const denied = loadMain('src/utils/mistral.js', {}, { fetch: async () => { calls++; return new Response('fixture-secret', { status: 403 }); } });
    await assert.rejects(denied.streamMistral({ apiKey: 'fixture', messages: [], operation: 'text', onText() {} }), error => {
        const failure = denied.classifyMistralFailure(error, 'text');
        assert.equal(failure.category, 'authentication'); assert.equal(failure.httpStatus, 403);
        assert.doesNotMatch(failure.message, /fixture-secret/); return true;
    });
    assert.equal(calls, 3);
});

test('Mistral preserves long cooldowns and never retries or saves an incomplete streamed answer', async () => {
    let calls = 0;
    const limited = loadMain('src/utils/mistral.js', {}, { fetch: async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '120' } }); } });
    await assert.rejects(limited.streamMistral({ apiKey: 'fixture', messages: [], operation: 'text', onText() {} }), error => {
        assert.equal(limited.classifyMistralFailure(error, 'text').retryAfterMs, 120000); return true;
    });
    assert.equal(calls, 1);
    const f = geminiFixture({ fetch: async () => { calls++; return new Response('data:{"choices":[{"delta":{"content":"Partial"},"finish_reason":null}]}\n\ndata:{"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'); } });
    await f.start('mistral');
    try {
        const result = await f.call('send-text-message', 'Question');
        assert.equal(result.success, false); assert.equal(result.failure.category, 'generation-failed');
        assert.equal(calls, 2);
        assert.equal(f.events.filter(event => event[0] === 'save-conversation-turn').length, 0);
    } finally { await f.close(); }
});

test('Mistral cancellation stops a stalled request and prevents late history writes', async () => {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const f = geminiFixture({ fetch: async (_url, init) => { started(); return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })); } });
    await f.start('mistral');
    const pending = f.call('send-text-message', 'Pending question');
    await ready;
    await f.close();
    const result = await pending;
    assert.equal(result.success, false); assert.equal(result.cancelled, true);
    assert.equal(f.events.filter(event => event[0] === 'save-conversation-turn').length, 0);
});

test('Mistral bounds stalled attempts and never retries after visible output', async () => {
    for (const partial of [false, true]) {
        let calls = 0, cancelled = false;
        const visible = [];
        const api = loadMain('src/utils/mistral.js', {
            'node:timers/promises': { setTimeout: async () => {} },
        }, {
            setTimeout: (fn, ms) => setTimeout(fn, ms === 60000 ? 200 : 10),
            fetch: async (_url, init) => {
                calls++;
                if (!partial) return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
                return new Response(new ReadableStream({
                    start(controller) { controller.enqueue(Buffer.from('data:{"choices":[{"delta":{"content":"Partial"}}]}\n\n')); },
                    cancel() { cancelled = true; },
                }));
            },
        });
        await assert.rejects(api.streamMistral({ apiKey: 'fixture', messages: [], operation: 'text', onText: text => visible.push(text) }), /timed out/);
        assert.equal(calls, partial ? 1 : 2);
        assert.deepEqual(visible, partial ? ['Partial'] : []);
        if (partial) assert.equal(cancelled, true);
    }
});
