const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    normalizeResponseMode,
    getResponseMode,
    applyResponseModeInstruction,
    tuneChatRequestBody,
    normalizeTranscriptEvent,
} = require('../src/utils/realtimeContextCore');

function read(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('response modes normalize and produce bounded provider requests', () => {
    assert.equal(normalizeResponseMode('instant'), 'instant');
    assert.equal(normalizeResponseMode('unknown'), 'balanced');
    assert.equal(getResponseMode('detailed').maxTokens, 4096);

    const instant = tuneChatRequestBody({
        model: 'example',
        messages: [{ role: 'system', content: 'Help the user.' }],
        max_completion_tokens: 2048,
    }, 'instant');
    assert.equal(instant.max_completion_tokens, 768);
    assert.match(instant.messages[0].content, /ContextHalo response mode: instant/);

    const detailed = tuneChatRequestBody({
        model: 'local',
        messages: [{ role: 'user', content: 'Explain it.' }],
        max_tokens: 2048,
    }, 'detailed');
    assert.equal(detailed.max_tokens, 4096);
    assert.equal(detailed.messages[0].role, 'system');
    assert.match(detailed.messages[0].content, /ContextHalo response mode: detailed/);

    const once = applyResponseModeInstruction('Base prompt', 'balanced');
    assert.equal(applyResponseModeInstruction(once, 'balanced'), once);
});

test('live transcript events are normalized before renderer delivery', () => {
    const event = normalizeTranscriptEvent({
        provider: 'gemini',
        text: '  hello world  ',
        final: false,
        timestamp: 1234,
    });
    assert.deepEqual(event, {
        provider: 'gemini',
        text: 'hello world',
        final: false,
        timestamp: 1234,
    });
    assert.equal(normalizeTranscriptEvent({ provider: 'groq', text: '   ' }), null);
});

test('realtime context runtime observes all supported transcript paths without replacing provider implementations', () => {
    const main = read('src/utils/realtimeContextMain.js');
    const index = read('src/index.js');
    const preload = read('preload.js');

    assert.match(main, /interimInputTranscription/);
    assert.match(main, /inputTranscription/);
    assert.match(main, /audio\/transcriptions/);
    assert.match(main, /pathname\.includes\('\/inference'\)/);
    assert.match(main, /tuneChatRequestBody/);
    assert.match(main, /liveTranscript/);
    assert.match(main, /markers/);
    assert.match(preload, /live-transcript/);
    assert.ok(index.indexOf('installProviderRuntimeHardening();') < index.indexOf('installRealtimeContextMain();'));
    assert.ok(index.indexOf('installRealtimeContextMain();') < index.indexOf("require('./utils/gemini')"));
});

test('renderer exposes response selection, live transcript, context chips, and session markers', () => {
    const renderer = read('src/utils/realtimeContextRenderer.js');
    const indexHtml = read('src/index.html');

    assert.match(renderer, /Live response style/);
    assert.match(renderer, /Applied when the session starts/);
    assert.match(renderer, /Screen context/);
    assert.match(renderer, /Transcript/);
    assert.match(renderer, /important/);
    assert.match(renderer, /decision/);
    assert.match(renderer, /action/);
    assert.match(renderer, /question/);
    assert.match(renderer, /storage\.saveSession/);
    assert.match(indexHtml, /realtimeContextRenderer\.js/);
});
