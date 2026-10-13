const test = require('node:test');
const assert = require('node:assert/strict');
const { geminiFixture } = require('./helpers/gemini-fixture');
const { loadMain } = require('./helpers/native-boundary');

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1200)]).toString('base64');
const completion = text => new Response(`data:${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } })}\n\ndata:[DONE]\n\n`);

test('explicit Ministral models use compatible payloads and the selected session model stays pinned', async () => {
    const bodies = [];
    const f = geminiFixture({ config: { mistralModel: 'ministral-8b-2512' }, fetch: async (_url, init) => {
        bodies.push(JSON.parse(init.body)); return completion('Answer');
    } });
    try {
        assert.equal((await f.start('mistral')).success, true);
        f.config.mistralModel = 'ministral-14b-2512';
        assert.equal((await f.call('send-text-message', 'Question')).model, 'ministral-8b-2512');
        assert.equal((await f.call('send-image-content', { data: jpeg, prompt: 'Screen' })).model, 'ministral-8b-2512');
        await f.close();
        for (const model of ['ministral-14b-2512', 'ministral-3b-2512']) {
            f.config.mistralModel = model;
            assert.equal((await f.start('mistral')).success, true);
            assert.equal((await f.call('send-text-message', 'Question')).model, model);
            await f.close();
        }
        assert.deepEqual(bodies.map(body => body.model), ['ministral-8b-2512', 'ministral-8b-2512', 'ministral-14b-2512', 'ministral-3b-2512']);
        assert.ok(bodies.every(body => !Object.hasOwn(body, 'reasoning_effort') && body.stream === true));
        f.config.mistralModel = 'untrusted-model';
        assert.equal((await f.start('mistral')).success, false);
        assert.equal(bodies.length, 4);
    } finally { await f.close(); }
});

test('zero runtime RPM stops retries, preserves safe numeric limits and reports the selected model', async () => {
    let calls = 0;
    const api = loadMain('src/utils/mistral.js', {}, { fetch: async () => {
        calls++;
        return new Response('private-invalid-body', { status: 429, headers: {
            'x-ratelimit-limit-req-minute': '0', 'x-ratelimit-remaining-req-minute': '-1',
            'x-ratelimit-limit-tokens-minute': '625000', 'x-ratelimit-remaining-tokens-minute': '999999999999999999999',
            'x-private-header': 'private-value',
        } });
    } });
    await assert.rejects(api.streamMistral({ apiKey: 'fixture', model: 'ministral-8b-2512', messages: [], operation: 'text', onText() {} }), error => {
        const failure = api.classifyMistralFailure(error, 'text', 'ministral-8b-2512');
        assert.equal(failure.model, 'ministral-8b-2512');
        assert.deepEqual(failure.rateLimits, { requestsPerMinute: 0, tokensPerMinute: 625000 });
        assert.equal(failure.retryable, false); assert.equal(failure.retryAt, null);
        assert.match(failure.message, /zero requests per minute/);
        assert.doesNotMatch(JSON.stringify(failure), /private/);
        return true;
    });
    assert.equal(calls, 1);
    await assert.rejects(api.streamMistral({ apiKey: 'fixture', model: 'untrusted', messages: [], operation: 'text', onText() {} }), /Unsupported/);
    assert.equal(calls, 1);
});

test('Ministral 14B concurrent starts respect its lower free request limit', async () => {
    let now = 0;
    const starts = [];
    const api = loadMain('src/utils/mistral.js', { 'node:timers/promises': { setTimeout: async ms => { now += ms; } } }, {
        Date: class extends Date { static now() { return now; } }, fetch: async () => { starts.push(now); return completion('Answer'); },
    });
    await Promise.all(['text', 'screen'].map(operation => api.streamMistral({ apiKey: 'fixture', model: 'ministral-14b-2512', messages: [], operation, onText() {} })));
    assert.ok(starts[1] - starts[0] >= 2200);
});

test('Mistral spaces concurrent text and screen starts for the 1-RPS evaluation limit', async () => {
    let now = 0, releaseFirst;
    const starts = [];
    const api = loadMain('src/utils/mistral.js', { 'node:timers/promises': { setTimeout: async ms => { now += ms; } } }, {
        Date: class extends Date { static now() { return now; } },
        fetch: async () => {
            starts.push(now);
            if (starts.length === 1) await new Promise(resolve => { releaseFirst = resolve; });
            return completion('Answer');
        },
    });
    const text = api.streamMistral({ apiKey: 'fixture', messages: [], operation: 'text', onText() {} });
    const screen = api.streamMistral({ apiKey: 'fixture', messages: [], operation: 'screen', onText() {} });
    await screen;
    releaseFirst(); await text;
    assert.ok(starts[1] - starts[0] >= 1000);
});

test('Mistral preserves safe 429 metadata, spaces retries, and never invents a reset time', async () => {
    let now = 0;
    const starts = [];
    const api = loadMain('src/utils/mistral.js', { 'node:timers/promises': { setTimeout: async ms => { now += ms; } } }, {
        Date: class extends Date { static now() { return now; } },
        fetch: async () => {
            starts.push(now);
            return new Response(JSON.stringify({ code: '1300', type: 'rate_limited', message: 'Rate limit exceeded; fixture-private-payload' }), { status: 429 });
        },
    });
    await assert.rejects(api.streamMistral({ apiKey: 'fixture', messages: [], operation: 'text', onText() {} }), error => {
        const failure = api.classifyMistralFailure(error, 'text');
        assert.equal(failure.category, 'rate-or-quota');
        assert.equal(failure.providerCode, '1300'); assert.equal(failure.providerType, 'rate_limited');
        assert.equal(failure.retryAfterMs, null); assert.equal(failure.retryAt, null);
        assert.match(failure.message, /monthly|included usage/);
        assert.doesNotMatch(JSON.stringify(failure), /fixture-private-payload/);
        return true;
    });
    assert.equal(starts.length, 2); assert.ok(starts[1] - starts[0] >= 1000);
});

test('Mistral bounds error bodies and discards unrecognized, malformed or oversized metadata', async () => {
    for (const kind of ['unrecognized', 'malformed', 'oversized', 'stalled']) {
        let cancelled = false;
        const api = loadMain('src/utils/mistral.js', {}, {
            setTimeout: (fn, ms) => setTimeout(fn, ms === 1000 ? 5 : ms),
            fetch: async () => new Response(kind === 'stalled' ? new ReadableStream({ cancel() { cancelled = true; } })
                : kind === 'malformed' ? 'fixture-private-payload'
                : JSON.stringify(kind === 'oversized' ? { code: '1300', type: 'rate_limited', message: 'x'.repeat(20000) }
                    : { code: 'fixture-private-code', type: 'fixture-private-type', message: 'fixture-private-payload' }),
            { status: 429, headers: { 'retry-after': '120' } }),
        });
        await assert.rejects(api.streamMistral({ apiKey: 'fixture', messages: [], operation: 'text', onText() {} }), error => {
            const failure = api.classifyMistralFailure(error, 'text');
            assert.equal(failure.httpStatus, 429); assert.equal(failure.retryAfterMs, 120000);
            assert.equal(failure.providerCode, undefined); assert.equal(failure.providerType, undefined);
            assert.doesNotMatch(JSON.stringify(failure), /fixture-private/); return true;
        });
        if (kind === 'stalled') assert.equal(cancelled, true);
    }
});

test('cancelled Mistral pacing waits never send or reserve a slot for a later request', async () => {
    let now = 0, calls = 0;
    const waits = [];
    const api = loadMain('src/utils/mistral.js', { 'node:timers/promises': {
        setTimeout: (ms, _value, { signal }) => new Promise((resolve, reject) => {
            waits.push({ ms, release: () => { now += ms; resolve(); } });
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    } }, { Date: class extends Date { static now() { return now; } }, fetch: async () => { calls++; return completion('Answer'); } });
    await api.streamMistral({ apiKey: 'fixture', messages: [], operation: 'text', onText() {} });
    const controller = new AbortController();
    const cancelled = api.streamMistral({ apiKey: 'fixture', messages: [], operation: 'screen', signal: controller.signal, onText() {} });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
    await assert.rejects(cancelled, /Cancelled/);
    assert.equal(calls, 1);
    const next = api.streamMistral({ apiKey: 'fixture', messages: [], operation: 'text', onText() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(waits.map(wait => wait.ms), [1000, 1000]);
    waits[1].release();
    assert.equal((await next).text, 'Answer'); assert.equal(calls, 2);
});

test('Mistral 429 details reach typed and screen IPC without private body or successful history', async () => {
    const f = geminiFixture({ fetch: async () => new Response(JSON.stringify({ code: '1300', type: 'rate_limited', message: 'fixture-private-payload' }),
        { status: 429, headers: { 'retry-after': '120' } }) });
    await f.start('mistral');
    try {
        const text = await f.call('send-text-message', 'Public test');
        const screen = await f.call('send-image-content', { data: jpeg, prompt: 'Public screen fixture' });
        for (const result of [text, screen]) {
            assert.equal(result.success, false);
            assert.equal(result.failure.providerCode, '1300'); assert.equal(result.failure.providerType, 'rate_limited');
            assert.equal(result.failure.httpStatus, 429); assert.equal(result.failure.retryAfterMs, 120000);
            assert.equal(result.metrics.firstTextMs, null);
            assert.doesNotMatch(JSON.stringify(result), /fixture-private-payload/);
        }
        assert.equal(f.events.filter(([name]) => ['save-conversation-turn', 'save-screen-analysis', 'new-response'].includes(name)).length, 0);
    } finally { await f.close(); }
});

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
    let calls = 0, now = 0;
    const waits = [];
    const api = loadMain('src/utils/mistral.js', {
        'node:timers/promises': { setTimeout: async ms => { waits.push(ms); now += ms; } },
    }, { Date: class extends Date { static now() { return now; } },
        fetch: async () => ++calls === 1 ? new Response('secret provider body', { status: 503, headers: { 'retry-after': '2' } }) : completion('Recovered') });
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
        let calls = 0, cancelled = false, now = 0;
        const visible = [];
        const api = loadMain('src/utils/mistral.js', {
            'node:timers/promises': { setTimeout: async ms => { now += ms; } },
        }, {
            Date: class extends Date { static now() { return now; } },
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
