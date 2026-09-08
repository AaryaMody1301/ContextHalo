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


