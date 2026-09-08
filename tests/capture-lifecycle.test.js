const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: tick } = require('node:timers/promises');
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

test('stopping screen sharing closes audio and blocks stale screenshots', async () => {
    const f = rendererFixture(); await f.api.startCapture();
    f.media.getVideoTracks()[0].end();
    assert.equal(f.api.getCaptureState().audioReady, false);
    assert.ok(f.media.getAudioTracks().every(track => track.readyState === 'ended'));
    await assert.rejects(f.api.captureManualScreenshot(), /stopped/);
});

test('Analyze waits for a complete response, rejects invalid regions, and propagates cancellation', async t => {
    let resolve;
    const f = rendererFixture({ image: () => new Promise(done => { resolve = done; }) });
    t.after(() => f.api.stopCapture()); await f.api.startCapture();
    await assert.rejects(f.api.captureManualScreenshot(null, { region: { x: -1, y: 0, width: 1, height: 1 } }), /Invalid screen region/);
    const controller = new AbortController();
    const pending = f.api.captureManualScreenshot(null, { signal: controller.signal, region: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } });
    await tick(); assert.equal(typeof resolve, 'function');
    controller.abort(); await assert.rejects(pending, /cancelled/);
    assert.ok(f.calls.some(([name]) => name === 'cancel-screen-analysis'));
    resolve({ success: true, text: 'late answer' }); await tick();
});

test('repeated capture cycles do not retain tracks or audio contexts', async () => {
    const streams = [];
    const f = rendererFixture({ display: async () => { const value = stream('video', 'audio'); streams.push(value); return value; } });
    for (let i = 0; i < 8; i++) { assert.equal(await f.api.startCapture(), true); f.api.stopCapture(); }
    assert.equal(streams.length, 8);
    assert.ok(streams.every(value => value.getTracks().every(track => track.stops === 1)));
    assert.ok(f.contexts.every(context => context.state === 'closed'));
});
