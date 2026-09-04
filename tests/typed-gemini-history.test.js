const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source() {
    return fs.readFileSync(path.join(process.cwd(), 'src/utils/gemini.js'), 'utf8');
}

test('Gemini Live typed prompts are preserved as session-history user turns', () => {
    const gemini = source();
    assert.match(gemini, /let pendingTypedPrompt = '';/);
    assert.match(gemini, /pendingTypedPrompt = cleanText;/);
    assert.match(gemini, /const turnInput = pendingTypedPrompt\.trim\(\) \|\| currentTranscription\.trim\(\);/);
    assert.match(gemini, /saveConversationTurn\(turnInput, messageBuffer\);/);
    assert.match(gemini, /if \(pendingTypedPrompt === cleanText\) pendingTypedPrompt = '';/);
});
