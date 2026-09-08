const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}



test('preload permits required runtime events and exposes safe platform architecture', () => {
    const preload = read('preload.js');

    assert.match(preload, /whisper-downloading/);
    assert.match(preload, /local-ai-download-progress/);
    assert.match(preload, /groq-rate-limit/);
    assert.match(preload, /removeAllListeners\(channel\)/);
    assert.match(preload, /window-toggle-maximize/);
    assert.match(preload, /arch: process\.arch/);
});

test('audio modes and Groq voice use VAD without interleaving microphone and system PCM', () => {
    const main = read('src/utils/runtimeHardeningMain.js');

    assert.match(main, /GROQ_VAD/);
    assert.match(main, /silenceFramesRequired/);
    assert.match(main, /processGroqVadChunk/);
    assert.match(main, /runtimeProviderMode === 'groq'/);
    assert.match(main, /if \(mode === 'mic_only'\) return channel === 'send-mic-audio-content'/);
    assert.match(main, /return channel === 'send-audio-content'/);
    assert.match(main, /startRuntimeMacGroqAudio/);
});




