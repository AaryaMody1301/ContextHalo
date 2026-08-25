const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('Analyze Screen uses serialized retries and dedicated lifecycle events', () => {
    const main = read('src/utils/runtimeHardeningMain.js');
    const renderer = read('src/utils/runtimeHardeningRenderer.js');
    const preload = read('preload.js');

    assert.match(main, /imageRequestQueue/);
    assert.match(main, /callWithProviderRetry/);
    assert.equal(main.includes('/\\b409\\b/i'), true);
    assert.match(main, /screen-analysis-started/);
    assert.match(main, /screen-analysis-complete/);
    assert.match(renderer, /runAnalyzeScreen/);
    assert.match(renderer, /Could not capture a usable screen image/);
    assert.match(renderer, /Analyze Screen timed out after 60 seconds/);
    assert.match(preload, /screen-analysis-started/);
    assert.match(preload, /screen-analysis-complete/);
});

test('global shortcut and duplicate session start share guarded renderer paths', () => {
    const renderer = read('src/utils/runtimeHardeningRenderer.js');

    assert.match(renderer, /ipcRenderer\.on\('shortcut'/);
    assert.match(renderer, /assistant\?\.handleScreenAnswer/);
    assert.match(renderer, /_runtimeStartPromise/);
    assert.match(renderer, /session-initializing/);
});

test('preload permits required runtime events and safe listener cleanup', () => {
    const preload = read('preload.js');

    assert.match(preload, /whisper-downloading/);
    assert.match(preload, /local-ai-download-progress/);
    assert.match(preload, /groq-rate-limit/);
    assert.match(preload, /removeAllListeners\(channel\)/);
    assert.match(preload, /window-toggle-maximize/);
});

test('audio modes and Groq voice use VAD instead of fixed eight-second questions', () => {
    const main = read('src/utils/runtimeHardeningMain.js');

    assert.match(main, /GROQ_VAD/);
    assert.match(main, /silenceFramesRequired/);
    assert.match(main, /processGroqVadChunk/);
    assert.match(main, /mode === 'mic_only'/);
    assert.match(main, /channel === 'send-mic-audio-content'/);
    assert.match(main, /startRuntimeMacGroqAudio/);
});

test('renderer sanitizes model output and tracks capture resources', () => {
    const renderer = read('src/utils/runtimeHardeningRenderer.js');

    assert.match(renderer, /sanitizeRenderedHtml/);
    assert.match(renderer, /blockedTags/);
    assert.match(renderer, /name\.startsWith\('on'\)/);
    assert.match(renderer, /trackedMicStreams/);
    assert.match(renderer, /trackedAudioContexts/);
    assert.match(renderer, /Screen sharing stopped/);
    assert.match(renderer, /open-external/);
});

test('window fallback selects the primary display and search preference is storage-backed', () => {
    const main = read('src/utils/runtimeHardeningMain.js');

    assert.match(main, /screen\.getPrimaryDisplay\(\)\.id/);
    assert.match(main, /candidate\.display_id/);
    assert.match(main, /storage\.getPreferences\(\)\.googleSearchEnabled === true/);
});

test('bootstrap installs hardening before provider IPC registration and accepts null keybind reset', () => {
    const index = read('src/index.js');
    const html = read('src/index.html');

    assert.ok(index.indexOf('installProviderRuntimeHardening();') < index.indexOf("require('./utils/gemini')"));
    assert.match(index, /installIpcHandlerHardening/);
    assert.match(index, /keybinds !== null/);
    assert.match(html, /runtimeHardeningRenderer\.js/);
});
