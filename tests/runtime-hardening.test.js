const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('Analyze Screen uses serialized retries, stream guards, and lifecycle events', () => {
    const main = read('src/utils/runtimeHardeningMain.js');
    const renderer = read('src/utils/runtimeHardeningRenderer.js');
    const preload = read('preload.js');

    assert.match(main, /imageRequestQueue/);
    assert.match(main, /callWithProviderRetry/);
    assert.equal(main.includes('/\\b409\\b/i'), true);
    assert.match(main, /Empty provider response/);
    assert.match(main, /Provider stream timed out/);
    assert.match(main, /normalizeImageResult/);
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

test('final renderer guard covers supported local architectures and Analyze lifecycle polish', () => {
    const finalRenderer = read('src/utils/runtimeFinalRenderer.js');
    const html = read('src/index.html');

    assert.match(finalRenderer, /platform === 'win32' && arch === 'x64'/);
    assert.match(finalRenderer, /platform === 'darwin'/);
    assert.match(finalRenderer, /arch === 'arm64'/);
    assert.match(finalRenderer, /patchResponseDeduplication/);
    assert.match(finalRenderer, /screen-analysis-started/);
    assert.match(finalRenderer, /screen-analysis-complete/);
    assert.match(html, /runtimeFinalRenderer\.js/);
});

test('bootstrap installs hardening before provider IPC registration and accepts null keybind reset', () => {
    const index = read('src/index.js');
    const html = read('src/index.html');

    assert.ok(index.indexOf('installProviderRuntimeHardening();') < index.indexOf("require('./utils/gemini')"));
    assert.match(index, /installIpcHandlerHardening/);
    assert.match(index, /keybinds !== null/);
    assert.match(html, /runtimeHardeningRenderer\.js/);
    assert.match(html, /runtimeFinalRenderer\.js/);
});
