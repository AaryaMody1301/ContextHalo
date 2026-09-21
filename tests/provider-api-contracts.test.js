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
    assert.match(gemini, /https:\/\/api\.groq\.com\/openai\/v1\/audio\/transcriptions/);
    assert.match(gemini, /form\.append\('model', getConfig\(\)\.groqTranscriptionModel \|\| 'whisper-large-v3-turbo'\)/);
    assert.match(gemini, /form\.append\('language', String\(language\)\.split\('-'\)\[0\]\)/);
    assert.match(gemini, /form\.append\('response_format', 'json'\)/);
    assert.match(gemini, /new Blob\(\[wav\], \{ type: 'audio\/wav' \}\)/);

    assert.match(hardening, /groqTranscriptionModel \|\| 'whisper-large-v3-turbo'/);
    assert.match(hardening, /form\.append\('response_format', 'json'\)/);
    assert.match(hardening, /form\.append\('language', language\)/);
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
