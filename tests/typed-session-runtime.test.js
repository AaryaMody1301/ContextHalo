const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Electron startup installs typed Gemini Live turn finalization and audio gating', () => {
    const packageJson = JSON.parse(read('package.json'));
    const bootstrap = read('src/bootstrap.js');

    assert.equal(packageJson.main, 'src/bootstrap.js');
    assert.match(bootstrap, /channel === 'send-text-message'/);
    assert.match(bootstrap, /providerMode === 'byok'/);
    assert.match(bootstrap, /sendRealtimeInput\(\{ audioStreamEnd: true \}\)/);
    assert.match(bootstrap, /send-audio-content/);
    assert.match(bootstrap, /send-mic-audio-content/);
    assert.match(bootstrap, /resetAudioMixer/);
    assert.match(bootstrap, /reason: 'typed-prompt-turn'/);
    assert.match(bootstrap, /channel === 'new-response' \|\| channel === 'update-response'/);
    assert.match(bootstrap, /TYPED_PROMPT_AUDIO_GATE_MS = 30000/);
    assert.ok(
        bootstrap.indexOf('result = await handler') < bootstrap.indexOf('await finalizeTypedGeminiTurn'),
        'audio stream should only be finalized after the typed message handler succeeds'
    );
});

test('typed prompt UI exposes send, pending, retry-safe failure, and timeout states', () => {
    const renderer = read('src/utils/runtimeFinalRenderer.js');

    assert.match(renderer, /TYPED_PROMPT_TIMEOUT_MS = 30000/);
    assert.match(renderer, /contexthalo-typed-prompt-state/);
    assert.match(renderer, /typed-send-btn/);
    assert.match(renderer, /Ask about this live session/);
    assert.match(renderer, /restore: true/);
    assert.match(renderer, /No response received for the typed message/);
    assert.match(renderer, /ipcRenderer\.on\('new-response', completeTypedPrompt\)/);
    assert.match(renderer, /ipcRenderer\.on\('update-response', completeTypedPrompt\)/);
});

test('provider refresh heals model IDs removed from the live provider catalog without blocking advanced choices', () => {
    const renderer = read('src/utils/runtimeFinalRenderer.js');

    assert.match(renderer, /patchProviderModelSelectionGuard/);
    assert.match(renderer, /const allIds = new Set\(allModels\.map\(model => model\.id\)\)/);
    assert.match(renderer, /catalog\?\.recommended\?\.screen/);
    assert.match(renderer, /catalog\?\.recommended\?\.chat/);
    assert.match(renderer, /catalog\?\.recommended\?\.vision/);
    assert.match(renderer, /catalog\?\.recommended\?\.transcription/);
});

test('component barrel no longer exports a missing AdvancedView module', () => {
    const componentIndex = read('src/components/index.js');
    assert.doesNotMatch(componentIndex, /AdvancedView/);
});
