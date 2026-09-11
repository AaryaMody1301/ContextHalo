const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: tick, setTimeout: sleep } = require('node:timers/promises');
const { rendererFixture, stream } = require('./helpers/renderer-fixture');

for (const audioMode of ['speaker_only', 'mic_only', 'both']) test(`capture ${audioMode} reports only acquired inputs and closes every track/context`, async t => {
    const f = rendererFixture({ audioMode }); t.after(() => f.api.stopCapture());
    assert.equal(await f.api.startCapture(), true);
    const state = f.api.getCaptureState();
    assert.equal(state.state, 'ready'); assert.equal(state.audioReady, true); assert.equal(state.screen, true);
    assert.equal(state.system, audioMode !== 'mic_only'); assert.equal(state.microphone, audioMode !== 'speaker_only');
    const expected = audioMode === 'speaker_only' ? f.media.getTracks() : [...f.media.getTracks(), ...f.microphone.getTracks()];
    f.api.stopCapture();
    for (const track of expected) assert.equal(track.readyState, 'ended');
    for (const context of f.contexts) assert.equal(context.state, 'closed');
    assert.equal(f.api.getCaptureState().audioReady, false);
});

test('duplicate capture starts share permission work, and cancelled permission results are stopped', async t => {
    let resolve;
    const late = stream('video', 'audio');
    const f = rendererFixture({ display: () => new Promise(done => { resolve = done; }) });
    t.after(() => f.api.stopCapture());
    const a = f.api.startCapture(); const b = f.api.startCapture();
    assert.equal(a, b); await tick();
    f.api.stopCapture(); assert.equal(await a, false);
    resolve(late); await tick();
    assert.equal(f.calls.filter(([name]) => name === 'display').length, 1);
    assert.ok(late.getTracks().every(track => track.readyState === 'ended'));
    assert.equal(f.api.getCaptureState().state, 'stopped');
});

test('denied microphone-only capture cleans the screen and never reports audio ready', async () => {
    const f = rendererFixture({ audioMode: 'mic_only', mic: async () => { throw new Error('Denied'); } });
    assert.equal(await f.api.startCapture(), false);
    assert.equal(f.api.getCaptureState().audioReady, false);
    assert.match(f.api.getCaptureState().warning, /Microphone capture is unavailable/);
    assert.ok(f.media.getTracks().every(track => track.readyState === 'ended'));
});

test('mixed-mode microphone denial is explicit speaker-only degradation, not fake mixed audio', async t => {
    const f = rendererFixture({ audioMode: 'both', mic: async () => { throw new Error('Denied'); } });
    t.after(() => f.api.stopCapture());
    assert.equal(await f.api.startCapture(), true);
    assert.equal(f.api.getCaptureState().microphone, false);
    assert.equal(f.api.getCaptureState().system, true);
    assert.match(f.api.getCaptureState().warning, /speaker audio only/);
});

test('ended screen capture automatically reacquires the selected source', async t => {
    const first = stream('video', 'audio');
    const second = stream('video', 'audio');
    let acquisitions = 0;
    const f = rendererFixture({ display: async () => acquisitions++ === 0 ? first : second });
    t.after(() => f.api.stopCapture());
    assert.equal(await f.api.startCapture(), true);
    first.getVideoTracks()[0].end();
    await sleep(350);
    assert.equal(f.api.getCaptureState().state, 'ready');
    assert.equal(second.getVideoTracks()[0].readyState, 'live');
    assert.ok(first.getAudioTracks().every(track => track.readyState === 'ended'));
    assert.ok(f.calls.some(([name]) => name === 'audio-stream-end'));
    assert.equal((await f.api.captureManualScreenshot()).success, true);
});

test('ended audio capture automatically reacquires audio instead of leaving a dead interview', async t => {
    const first = stream('video', 'audio');
    const second = stream('video', 'audio');
    let acquisitions = 0;
    const f = rendererFixture({ display: async () => acquisitions++ === 0 ? first : second });
    t.after(() => f.api.stopCapture());
    assert.equal(await f.api.startCapture(), true);
    first.getAudioTracks()[0].end();
    await sleep(350);
    assert.equal(f.api.getCaptureState().state, 'ready');
    assert.equal(f.api.getCaptureState().audioReady, true);
    assert.equal(second.getAudioTracks()[0].readyState, 'live');
});

test('Analyze waits for a complete response, rejects invalid regions, and propagates cancellation', async t => {
    let resolve;
    const f = rendererFixture({ image: () => new Promise(done => { resolve = done; }) });
    t.after(() => f.api.stopCapture()); await f.api.startCapture();
    await assert.rejects(f.api.captureManualScreenshot(null, { region: { x: -1, y: 0, width: 1, height: 1 } }), /Invalid screen region/);
    const controller = new AbortController();
    const pending = f.api.captureManualScreenshot(null, { signal: controller.signal, region: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } });
    for (let attempt = 0; attempt < 20 && typeof resolve !== 'function'; attempt++) await sleep(5);
    assert.equal(typeof resolve, 'function');
    controller.abort(); await assert.rejects(pending, /cancelled/);
    assert.ok(f.calls.some(([name]) => name === 'cancel-screen-analysis'));
    resolve({ success: true, text: 'late answer' }); await tick();
});


test('Analyze retries one blank frame and rejects repeated blank capture', async t => {
    let probes = 0;
    const recovered = rendererFixture({ blankFrame: () => ++probes === 1 });
    t.after(() => recovered.api.stopCapture());
    await recovered.api.startCapture();
    assert.equal((await recovered.api.captureManualScreenshot()).success, true);
    assert.ok(probes >= 2);

    const blank = rendererFixture({ blankFrame: true });
    t.after(() => blank.api.stopCapture());
    await blank.api.startCapture();
    await assert.rejects(blank.api.captureManualScreenshot(), /blank frames/i);
});

test('Analyze preserves more detail for full displays and selected regions', async t => {
    const f = rendererFixture({ videoWidth: 3840, videoHeight: 2160 });
    t.after(() => f.api.stopCapture());
    await f.api.startCapture();
    await f.api.captureManualScreenshot('medium');
    const full = f.calls.filter(([name]) => name === 'canvas-encoded').at(-1);
    assert.deepEqual(full.slice(1), [2048, 1152]);
    await f.api.captureManualScreenshot('high', { region: { x: 0, y: 0, width: 0.8, height: 0.8 } });
    const region = f.calls.filter(([name]) => name === 'canvas-encoded').at(-1);
    assert.deepEqual(region.slice(1), [2560, 1440]);
});

test('capture uses AudioWorklet rather than deprecated ScriptProcessorNode', async t => {
    const f = rendererFixture({ audioMode: 'both' });
    t.after(() => f.api.stopCapture());
    assert.equal(await f.api.startCapture(), true);
    assert.ok(f.calls.filter(([name]) => name === 'audio-worklet').length >= 2);
    assert.ok(f.contexts.every(context => context.sampleRate === 16000), 'Gemini capture runs natively at 16 kHz');
    const source = require('node:fs').readFileSync('src/utils/renderer.js', 'utf8');
    assert.equal(source.includes('createScriptProcessor'), false);
    assert.match(source, /MAX_AUDIO_DISPATCH_CHUNKS = 6/);

    const groq = rendererFixture({ audioMode: 'speaker_only', prefs: { providerMode: 'groq' } });
    t.after(() => groq.api.stopCapture());
    assert.equal(await groq.api.startCapture(), true);
    assert.equal(groq.contexts[0].sampleRate, 24000, 'non-Gemini providers retain their existing capture rate');
});


test('renderer audio delivery is bounded when IPC falls behind', async t => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const f = rendererFixture({
        invoke: channel => channel === 'send-audio-content' ? gate : undefined,
    });
    t.after(() => f.api.stopCapture());
    assert.equal(await f.api.startCapture(), true);
    const node = f.workletNodes[0];
    assert.ok(node?.port?.onmessage);
    for (let i = 0; i < 20; i++) {
        node.port.onmessage({ data: { pcm: new ArrayBuffer(3200) } });
    }
    await tick();
    assert.equal(f.calls.filter(([name]) => name === 'send-audio-content').length, 1, 'only one IPC send is in flight');
    release({ success: true });
    await sleep(30);
    assert.ok(f.calls.filter(([name]) => name === 'send-audio-content').length <= 7,
        'one in-flight chunk plus six queued chunks is the hard upper bound');
});

test('repeated capture cycles do not retain tracks or audio contexts', async () => {
    const streams = [];
    const f = rendererFixture({ display: async () => { const value = stream('video', 'audio'); streams.push(value); return value; } });
    for (let i = 0; i < 8; i++) { assert.equal(await f.api.startCapture(), true); f.api.stopCapture(); }
    assert.equal(streams.length, 8);
    assert.ok(streams.every(value => value.getTracks().every(track => track.stops === 1)));
    assert.ok(f.contexts.every(context => context.state === 'closed'));
});
