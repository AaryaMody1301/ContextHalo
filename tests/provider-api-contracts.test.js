const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { geminiFixture } = require('./helpers/gemini-fixture');

function sseAnswer(text) {
    return new Response(
        'data: ' + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
    );
}

test('Groq typed and vision requests serialize the documented current contracts', async t => {
    const calls = [];
    const fixture = geminiFixture({
        config: {
            groqModel: 'openai/gpt-oss-120b',
            groqImageModel: 'qwen/qwen3.8-27b',
            groqTranscriptionModel: 'whisper-large-v3-turbo',
            disableGroqThinking: true,
        },
        fetch: async (url, init = {}) => {
            calls.push({
                url: String(url),
                method: init.method,
                headers: init.headers,
                body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
            });
            return sseAnswer(calls.length === 1 ? 'Typed answer' : 'Vision answer');
        },
    });
    t.after(() => fixture.close());

    const started = await fixture.start('groq', { uiEpoch: 41 });
    assert.equal(started.success, true, started.error);

    const typed = await fixture.call('send-text-message', 'Explain this event stream');
    assert.equal(typed.success, true, typed.error);

    const image = await fixture.call('send-image-content', {
        data: Buffer.alloc(1200, 1).toString('base64'),
        prompt: 'Read the visible code',
    });
    assert.equal(image.success, true, image.error);

    assert.equal(calls.length, 2);
    for (const call of calls) {
        assert.equal(call.url, 'https://api.groq.com/openai/v1/chat/completions');
        assert.equal(call.method, 'POST');
        assert.equal(call.body.stream, true);
        assert.equal(call.headers.Authorization, 'Bearer groq-test-key');
    }

    const textBody = calls[0].body;
    assert.equal(textBody.model, 'openai/gpt-oss-120b');
    assert.equal(textBody.reasoning_effort, 'low');
    assert.equal(textBody.include_reasoning, false);
    assert.equal(Object.hasOwn(textBody, 'reasoning_format'), false);
    assert.ok(textBody.messages.some(message => message.role === 'system'));
    assert.ok(textBody.messages.some(message => message.role === 'user' && /Explain this event stream/.test(message.content)));

    const visionBody = calls[1].body;
    assert.equal(visionBody.model, 'qwen/qwen3.8-27b');
    assert.equal(visionBody.reasoning_effort, 'none');
    assert.equal(visionBody.reasoning_format, 'hidden');
    assert.equal(Object.hasOwn(visionBody, 'include_reasoning'), false);
    assert.equal(visionBody.messages.some(message => message.role === 'system'), false, 'Qwen instructions stay in the user turn');
    const imagePart = visionBody.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
        .find(part => part?.type === 'image_url');
    assert.match(imagePart?.image_url?.url || '', /^data:image\/jpeg;base64,/);
});

test('Groq model discovery and transcription endpoints keep documented request fields', () => {
    const registry = fs.readFileSync('src/utils/providerModelRegistry.js', 'utf8');
    const gemini = fs.readFileSync('src/utils/gemini.js', 'utf8');
    const hardening = fs.readFileSync('src/utils/runtimeHardeningMain.js', 'utf8');

    assert.match(registry, /https:\/\/api\.groq\.com\/openai\/v1\/models/);
    assert.doesNotMatch(gemini, /processGroqAudioQueue|GROQ_AUDIO_CHUNK_SECONDS/);
    assert.match(hardening, /https:\/\/api\.groq\.com\/openai\/v1\/audio\/transcriptions/);
    assert.match(hardening, /new Blob\(\[pcmToWavBuffer\(pcm, sampleRate\)\], \{ type: 'audio\/wav' \}\)/);
    assert.match(hardening, /groqTranscriptionModel \|\| 'whisper-large-v3-turbo'/);
    assert.match(hardening, /form\.append\('response_format', 'json'\)/);
    assert.match(hardening, /form\.append\('language', language\)/);
});

test('Groq preserves the complete newest question at the history and IPC boundaries', async t => {
    const bodies = [];
    const f = geminiFixture({ fetch: async (_url, init) => { bodies.push(JSON.parse(init.body)); return sseAnswer('Answer'); } });
    t.after(() => f.close()); await f.start('groq');
    await f.call('send-text-message', 'Older question');
    for (const size of [12000, 12001, 32000]) {
        const question = 'q'.repeat(size);
        const result = await f.call('send-text-message', question);
        assert.equal(result.success, true, result.error);
        assert.deepEqual(bodies.at(-1).messages.filter(message => message.role !== 'system'), [{ role: 'user', content: question }]);
    }
    assert.equal((await f.call('send-text-message', 'q'.repeat(32001))).success, false);
    assert.equal(bodies.length, 4);
});

test('final Groq requests combine all context before applying Qwen roles', async t => {
    const bodies = [];
    const image = Buffer.alloc(1100).toString('base64');
    const f = geminiFixture({
        config: { groqModel: 'qwen/qwen3.8-27b', groqImageModel: 'qwen/qwen3.8-27b' },
        preferences: { sessionPack: { title: 'Database review', goal: 'Explain the query plan' } },
        knowledgeDocuments: [{ id: 'db', title: 'Database notes', enabled: true,
            chunks: [{ id: 'chunk', text: 'Query plans use indexes to reduce database scan cost.' }] }],
        fetch: async (_url, init) => { bodies.push(JSON.parse(init.body)); return sseAnswer('Answer'); },
    });
    t.after(() => f.close()); await f.start('groq');
    for (const responseMode of ['instant', 'balanced', 'detailed']) {
        f.preferences.responseMode = responseMode;
        assert.equal((await f.call('send-text-message', 'Explain database query plans')).success, true);
        assert.equal((await f.call('send-image-content', { data: image, prompt: 'Explain database query plans' })).success, true);
        for (const body of bodies.slice(-2)) {
            assert.equal(body.messages.some(message => message.role === 'system'), false);
            const current = body.messages.at(-1).content;
            const text = typeof current === 'string' ? current : current.find(part => part.type === 'text').text;
            for (const marker of ['[ContextHalo knowledge]', '[ContextHalo session pack]', '[ContextHalo response mode:']) {
                assert.equal(text.split(marker).length - 1, 1, marker);
            }
            assert.match(text, /Query plans use indexes/);
            assert.match(text, /Goal: Explain the query plan/);
            assert.ok(text.endsWith('Explain database query plans'));
        }
        assert.equal(bodies.at(-1).messages.at(-1).content.find(part => part.type === 'image_url').image_url.url, `data:image/jpeg;base64,${image}`);
    }
});

test('Local AI HTTP and CLI fields match the audited server contracts where provenance is exact', () => {
    const local = fs.readFileSync('src/utils/localai.js', 'utf8');
    const windowsRuntime = fs.readFileSync('src/utils/windowsLocalAiRuntime.js', 'utf8');

    assert.match(local, /\/v1\/chat\/completions/);
    assert.match(local, /\/inference/);
    assert.match(local, /chat_template_kwargs:\s*\{\s*enable_thinking:\s*false,?\s*\}/);
    assert.match(local, /cache_prompt:\s*true/);
    assert.match(local, /argumentsList\.push\('--cache-reuse', '256'\)/);
    assert.match(local, /'--host', '127\.0\.0\.1'/);
    assert.match(local, /['"]--alias['"][\s\S]{0,80}['"]local['"]/);
    assert.match(local, /'--mmproj'/);
    assert.match(windowsRuntime, /tag:\s*'b10964'/);
});

test('typed cancellation validates epoch and suppresses late provider answers', async t => {
    let release;
    const f = geminiFixture({ generate: async (_params, count) => count === 1 ? new Promise(resolve => { release = resolve; })
        : { text: 'Next answer', candidates: [{ finishReason: 'STOP' }] } });
    t.after(() => f.close()); await f.start('byok', { uiEpoch: 50 });
    const pending = f.call('send-text-message', 'Keep this draft', { requestId: 'typed-50', uiEpoch: 50 });
    while (!release) await new Promise(resolve => setImmediate(resolve));
    assert.equal((await f.call('cancel-text-message', { requestId: 'typed-50', uiEpoch: 49 })).success, false);
    assert.equal((await f.call('cancel-text-message')).success, false);
    assert.equal((await f.call('cancel-text-message', { requestId: 'typed-50', uiEpoch: 50 })).success, true);
    assert.equal((await pending).cancelled, true);
    release({ text: 'Late answer', candidates: [{ finishReason: 'STOP' }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.events.filter(([channel]) => channel === 'save-conversation-turn').length, 0);
    assert.equal((await f.call('send-text-message', 'Next question', { requestId: 'typed-51', uiEpoch: 50 })).success, true);
});

test('request metrics report actual stream timings and provider token metadata only', async t => {
    const f = geminiFixture({ generate: async () => ({ chunks: [
        { text: 'First ' },
        { text: 'answer', candidates: [{ finishReason: 'STOP' }] },
        { usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, thoughtsTokenCount: 2, totalTokenCount: 12, privateField: 'secret' } },
    ] }) });
    t.after(() => f.close()); await f.start();
    const result = await f.call('send-text-message', 'Question');
    assert.equal(result.success, true, result.error);
    assert.ok(result.metrics.firstTextMs >= 0 && result.metrics.totalMs >= result.metrics.firstTextMs);
    assert.deepEqual(result.metrics.usage, { inputTokens: 7, outputTokens: 3, thinkingTokens: 2, totalTokens: 12 });
    assert.doesNotMatch(JSON.stringify(result.metrics), /secret/);
    await f.close(); await f.start('groq');
    const groq = await f.call('send-text-message', 'Question');
    assert.equal(groq.success, true); assert.deepEqual(groq.metrics.usage, {});
});
