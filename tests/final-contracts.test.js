const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { setImmediate: tick } = require('node:timers/promises');
const { geminiFixture } = require('./helpers/gemini-fixture');
const { rendererFixture } = require('./helpers/renderer-fixture');
const { loadMain } = require('./helpers/native-boundary');
const { createGeminiLiveRuntime } = require('../src/utils/geminiLiveRuntime');
const { recordLiveFailure, createLiveRecoveryState } = require('../src/utils/geminiLiveSupervisor');
const { readSseJson } = require('../src/utils/sse');

function timers() {
    const jobs = [];
    return { jobs, setTimer(fn, ms) { const job = { fn, ms }; jobs.push(job); return job; },
        clearTimer(job) { job.cancelled = true; }, live: () => jobs.filter(j => !j.cancelled && !j.ran),
        async next() { const job = this.live()[0]; assert.ok(job); job.ran = true; await job.fn(); } };
}

test('Gemini uses the stored main-process key, never the renderer argument', async t => {
    const f = geminiFixture({ getApiKey: () => 'stored-main-key' }); t.after(f.close);
    const result = await f.call('initialize-gemini', 'untrusted-renderer-key', '', 'interview', 'en-US', 'byok', {});
    assert.equal(result.success, true);
    assert.equal(f.clients[0].apiKey, 'stored-main-key');
    assert.equal(f.handlers.has('initialize-cloud'), false);
    const preload = fs.readFileSync('preload.js', 'utf8');
    for (const channel of ['initialize-cloud', 'storage:get-credentials', 'storage:get-api-key', 'storage:get-groq-api-key', 'storage:set-credentials']) assert.equal(preload.includes(`'${channel}'`), false);
});

test('Groq does not even read a Gemini key during initialization', async t => {
    const f = geminiFixture({ getApiKey() { throw new Error('Gemini key unavailable'); } }); t.after(f.close);
    assert.equal((await f.start('groq')).success, true);
    assert.equal(f.connections.length, 0);
});

test('HTTP operation enforces its own budget even if an SDK ignores cancellation', async t => {
    const f = geminiFixture(); t.after(f.close); let signal;
    const start = Date.now();
    await assert.rejects(f.api.runGeminiRequest((_remaining, _attempt, supplied) => {
        signal = supplied; return new Promise(() => {});
    }, { operation: 'screen', model: 'fixture', budgetMs: 30 }), /timeout|timed out|network/i);
    assert.ok(signal.aborted);
    assert.ok(Date.now() - start < 1000);
});

test('typed and screen calls receive a bounded operation signal and no 27-second attempt cap', async t => {
    const f = geminiFixture({ model: 'gemini-3.8-flash' }); t.after(f.close); await f.start();
    assert.equal((await f.call('send-text-message', 'Explain the SQL join')).success, true);
    assert.equal((await f.call('send-image-content', { data: Buffer.alloc(1200).toString('base64'), prompt: 'Read code' })).success, true);
    for (const call of f.generated) {
        assert.ok(call.config.httpOptions.timeout > 60000);
        assert.ok(call.config.abortSignal);
        assert.equal(call.config.httpOptions.retryOptions.attempts, 1);
    }
});

test('fatal Live failure supersedes GoAway and a subsequent generic close cannot restart it', () => {
    const fake = timers(); const states = [];
    const r = createGeminiLiveRuntime({ reconnect: async () => {}, ...fake, publishState: state => states.push(state) });
    r.onOpen(); r.onMessage({ goAway: { timeLeft: '20s' } });
    r.onFailure({ category: 'authentication', httpStatus: 401 });
    r.onFailure({ socketCode: 1006 });
    assert.equal(fake.live().length, 0);
    assert.equal(states.at(-1), 'failed');
});

test('a socket closing before the GoAway deadline schedules immediate bounded recovery', () => {
    const fake = timers();
    const r = createGeminiLiveRuntime({ reconnect: async () => {}, ...fake, random: () => 0 });
    r.onOpen(); r.onMessage({ goAway: { timeLeft: '20s' } });
    r.onFailure({ socketCode: 1000 });
    assert.equal(fake.live().length, 1);
    assert.ok(fake.live()[0].ms < 2000); r.stop();
});

test('shutdown during a failed reconnect never publishes a late failed/reconnecting state', async () => {
    const fake = timers(); const states = []; let reject;
    const r = createGeminiLiveRuntime({ reconnect: () => new Promise((_resolve, fail) => { reject = fail; }), ...fake, publishState: state => states.push(state) });
    r.onFailure({ httpStatus: 503 }); const run = fake.next(); await tick(); r.stop();
    const count = states.length; reject({ httpStatus: 503 }); await run;
    assert.equal(states.length, count); assert.equal(fake.live().length, 0);
});

test('failure after reconnect setup but before its promise completes is not lost', async () => {
    const fake = timers(); let r;
    r = createGeminiLiveRuntime({ ...fake, now: () => 1000, reconnect: async () => {
        r.onOpen(); r.onFailure({ httpStatus: 503 });
    } });
    r.onFailure({ httpStatus: 503 }); await fake.next();
    assert.equal(fake.live().length, 1); r.stop();
});

test('Live recovery honors Retry-After and cools down repeated failures', () => {
    let state = createLiveRecoveryState();
    for (let n = 0; n < 8; n++) state = recordLiveFailure(state, { httpStatus: 503 }, 1000 + n, () => 0).state;
    assert.ok(recordLiveFailure(state, { httpStatus: 503 }, 1100).retryDelayMs >= 60000);
    assert.ok(recordLiveFailure(createLiveRecoveryState(), { category: 'throttled', retryAfterMs: 95000 }, 1000).retryDelayMs >= 95000);
});

test('an explicitly rejected resumption handle gets one fresh connection with ordered local context', async t => {
    const restored = [];
    const f = geminiFixture({ live: async (params, count) => {
        if (count === 2) throw Object.assign(new Error('Session resumption handle expired'), { status: 400 });
        return { close() {}, sendRealtimeInput() {}, sendClientContent: x => restored.push(x) };
    } }); t.after(f.close); await f.start();
    f.api.saveConversationTurn('Our interview context', 'A SQL answer');
    f.callbacks.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'expired' } });
    assert.equal((await f.call('retry-session-connection', { withoutSearch: false })).success, true);
    assert.equal(f.connections.length, 3);
    assert.equal(f.connections[1].config.sessionResumption.handle, 'expired');
    assert.deepEqual(f.connections[2].config.sessionResumption, {});
    assert.equal(restored[0].turnComplete, false); assert.match(JSON.stringify(restored), /SQL answer/);
});

test('cancel during AudioWorklet loading closes the pending context and cannot restart capture', async () => {
    let release;
    const f = rendererFixture({ addModule: () => new Promise(resolve => { release = resolve; }) });
    const start = f.api.startCapture(); await tick(); assert.equal(f.contexts.length, 1);
    f.api.stopCapture(); release(); assert.equal(await start, false); await tick();
    assert.ok(f.contexts.every(context => context.state === 'closed'));
    assert.equal(f.workletNodes.length, 0);
    assert.equal(f.api.getCaptureState().state, 'stopped');
});

test('fresh-frame validation rejects repeated counters and stagnant fallback clocks', async () => {
    const f = rendererFixture(); const controller = new AbortController();
    const video = { currentTime: 1, requestVideoFrameCallback: cb => setTimeout(() => cb(1, { presentedFrames: 1, mediaTime: 1 }), 0), cancelVideoFrameCallback: clearTimeout };
    await f.scope.testCapture.waitForFreshVideoFrame(video, controller.signal, 30);
    await assert.rejects(f.scope.testCapture.waitForFreshVideoFrame(video, controller.signal, 30));
    await assert.rejects(f.scope.testCapture.waitForFreshVideoFrame({ currentTime: 0 }, controller.signal, 30));
});

test('the actual audio processor bounds unacknowledged messages and outputs silence', () => {
    let Processor; const sent = []; const scope = { currentTime: 1, Float32Array, Int16Array, AudioWorkletProcessor: class {
        constructor() { this.port = { postMessage: message => sent.push(message) }; }
    }, registerProcessor: (_name, implementation) => { Processor = implementation; } };
    vm.runInNewContext(fs.readFileSync('src/utils/audioCaptureWorklet.js', 'utf8'), scope);
    const processor = new Processor({ processorOptions: { samplesPerChunk: 1600 } });
    const output = new Float32Array(128).fill(1);
    for (let i = 0; i < 2000; i++) processor.process([[new Float32Array(128).fill(0.25)]], [[output]]);
    assert.equal(sent.length, 4); assert.ok(output.every(x => x === 0));
    processor.port.onmessage({ data: { ack: sent[0].sequence } });
    for (let i = 0; i < 13; i++) processor.process([[new Float32Array(128)]], [[output]]);
    assert.equal(sent.length, 5);
    assert.equal(sent[0].pcm.byteLength, 3200);
});

test('SSE DONE finishes without waiting for a server to close the connection', async () => {
    let cancelled = false;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"ok":true}\n\ndata: [DONE]\n\n')); }, cancel() { cancelled = true; } });
    const result = [];
    for await (const item of readSseJson(stream)) result.push(item);
    assert.deepEqual(result, [{ ok: true }]); assert.equal(cancelled, true);
});

test('SSE limits accumulated multiline event data rather than only each individual line', async () => {
    let count = 0;
    const stream = new ReadableStream({ pull(controller) {
        if (++count > 24) controller.close();
        else controller.enqueue(new TextEncoder().encode('data: ' + 'x'.repeat(100000) + '\n'));
    } });
    await assert.rejects(async () => { for await (const _item of readSseJson(stream)) {} }, /too large/);
});

test('model discovery follows pagination and supports F16/F32 projectors without guessing model files', async () => {
    const calls = [];
    const hub = loadMain('src/utils/hubMetadata.js', {}, { fetch: async url => {
        calls.push(url);
        return calls.length === 1 ? new Response('[]', { headers: { link: '<https://huggingface.co/api/models/test/model/tree/main?cursor=2>; rel="next"' } })
            : new Response(JSON.stringify([{ type: 'file', path: 'mmproj-F32.gguf' }]));
    } });
    const files = await hub.listModelFiles('test/model');
    assert.equal(calls.length, 2); assert.equal(hub.selectProjector(files).path, 'mmproj-F32.gguf');
});

test('Hub metadata cannot redirect pagination to an arbitrary host', async () => {
    const hub = loadMain('src/utils/hubMetadata.js', {}, { fetch: async () => new Response('[]', {
        headers: { link: '<https://untrusted.example/tree/main>; rel="next"' },
    }) });
    await assert.rejects(hub.listModelFiles('test/model'), /Invalid model pagination/);
});

test('native readiness observes cancellation and reports launch errors immediately', async () => {
    const native = loadMain('src/utils/native-ai-runtime.js', { '../storage': { getConfigDir: () => '/tmp/unused' } });
    const control = new AbortController(); control.abort(new Error('stop readiness'));
    await assert.rejects(native.waitForServer('http://127.0.0.1:1/health', { exitCode: null }, 1000, control.signal), /stop readiness/);
    await assert.rejects(native.waitForServer('http://127.0.0.1:1/health', { exitCode: null, launchError: new Error('binary absent') }, 1000), /spawn failed/);
});

test('saved credential status hydrates Home without exposing a saved key; replacement/removal are explicit', async t => {
    const { componentClass } = require('./helpers/component-fixture');
    const writes = []; const status = { gemini: true, groq: false };
    const f = componentClass('src/components/views/MainView.js', 'MainView', { contextHalo: { storage: {
        getConfig: async () => ({}), getPreferences: async () => ({}), getCredentialStatus: async () => status,
        setApiKey: async value => { writes.push(value); return { success: true }; },
    } } });
    const view = new f.Target(); await tick();
    t.after(() => { for (const timer of Object.values(view._catalogTimers)) clearTimeout(timer); });
    assert.equal(view._configurationLoading, false); assert.equal(view._savedKeys.gemini, true); assert.equal(view._geminiKey, '');
    await view._saveGeminiKey('new-key'); assert.equal(view._geminiKey, ''); assert.equal(view._savedKeys.gemini, true);
    await view._saveGeminiKey(''); assert.equal(view._savedKeys.gemini, false); assert.deepEqual(writes, ['new-key', '']);
});

test('Windows audio validates the sender and session epoch before queues mutate', async () => {
    const handlers = new Map(); const delivered = []; const frame = {};
    const webContents = { id: 7, mainFrame: frame, send() {} };
    const ipc = { handle: (key, fn) => handlers.set(key, fn) };
    const actual = loadMain('src/utils/windowsRuntimeMain.js', {
        electron: { BrowserWindow: { getAllWindows: () => [{ webContents, isDestroyed: () => false }] }, ipcMain: ipc },
        '../storage': { getPreferences: () => ({ audioMode: 'both' }) },
        './runtimeHardeningMain': { resetRuntimeAudio() {} },
    }, { process: { platform: 'win32' } });
    const restore = actual.installWindowsIpcHardening();
    for (const channel of ['send-audio-content', 'send-mic-audio-content']) ipc.handle(channel, async (_event, payload) => delivered.push(payload));
    ipc.handle('close-session', async () => ({ success: true })); restore();
    actual.prepareWindowsProvider('byok', 9);
    const payload = { data: Buffer.alloc(3200).toString('base64'), mimeType: 'audio/pcm;rate=16000', uiEpoch: 9, capturedAtMs: Date.now() };
    const event = { sender: webContents, senderFrame: frame };
    await handlers.get('send-audio-content')({ sender: webContents, senderFrame: {} }, payload);
    await handlers.get('send-mic-audio-content')(event, payload);
    await tick(); assert.equal(delivered.length, 0);
    await handlers.get('send-audio-content')(event, { ...payload, uiEpoch: 8 }); await tick(); assert.equal(delivered.length, 0);
    await handlers.get('send-audio-content')(event, payload); await tick(); assert.equal(delivered.length, 1);
    await handlers.get('close-session')(event);
    await handlers.get('send-audio-content')(event, payload); await handlers.get('send-mic-audio-content')(event, payload);
    await tick(); assert.equal(delivered.length, 1);
});

test('Qwen preview status is explicit even when its model ID does not contain preview', () => {
    const { _test } = require('../src/utils/providerModelRegistry');
    const catalog = _test.buildGroqCatalog([{ id: 'qwen/qwen3.6-27b' }, { id: 'qwen/qwen3.8-27b' }, { id: 'openai/gpt-oss-120b' }]);
    assert.ok(catalog.vision.every(model => model.preview));
    assert.equal(catalog.chat.find(model => model.id === 'openai/gpt-oss-120b').preview, false);
});

test('setup messages emitted before SDK connect resolves retain the safe resumption handle', async t => {
    const f = geminiFixture({ live: async params => {
        params.callbacks.onopen();
        params.callbacks.onmessage({ setupComplete: {} });
        params.callbacks.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'during-setup' } });
        return { close() {}, sendRealtimeInput() {}, sendClientContent() {} };
    } }); t.after(f.close);
    assert.equal((await f.start()).success, true);
    assert.equal((await f.call('retry-session-connection', { withoutSearch: false })).success, true);
    assert.equal(f.connections[1].config.sessionResumption.handle, 'during-setup');
    assert.equal(f.clients[0].vertexai, false, 'BYOK must not inherit an Enterprise backend environment flag');
});

test('sixty minutes of virtual 100 ms audio plus six rotations stays bounded and screen-capable', async t => {
    let clock = 100000; const fake = timers(); let sent = 0;
    const f = geminiFixture({ process: { ...process, stdout: { write() {} } }, runtime: { ...fake, now: () => clock },
        live: async () => ({ close() {}, sendRealtimeInput: () => { sent++; }, sendClientContent() {} }) });
    t.after(f.close); assert.equal((await f.start('byok', { uiEpoch: 1 })).success, true);
    const payload = { data: Buffer.alloc(3200).toString('base64'), mimeType: 'audio/pcm;rate=16000', uiEpoch: 1 };
    for (let minute = 1; minute <= 60; minute++) {
        for (let chunk = 0; chunk < 600; chunk++) { clock += 100; await f.call('send-audio-content', payload); }
        if (minute % 10 === 0) {
            f.callbacks.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: `minute-${minute}` }, goAway: { timeLeft: '0.25s' } });
            await fake.next();
            assert.equal(f.connections.at(-1).config.sessionResumption.handle, `minute-${minute}`);
        }
        if (minute % 5 === 0) assert.equal((await f.call('send-image-content', { data: Buffer.alloc(1200).toString('base64'), prompt: 'Screen during interview' })).success, true);
    }
    assert.equal(sent, 36000); assert.equal(f.connections.length, 7);
    assert.equal(f.generated.length, 12); assert.equal(fake.live().length, 0);
});
