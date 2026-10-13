const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadMain } = require('./helpers/native-boundary');
const { rendererFixture } = require('./helpers/renderer-fixture');
const { appFixture, componentClass } = require('./helpers/component-fixture');
const { geminiFixture } = require('./helpers/gemini-fixture');

test('interrupted Local AI projector setup resumes the pinned revision without redownloading a verified model', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-setup-resume-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const directory = path.join(root, 'models/llama/owner/repo');
    fs.mkdirSync(directory, { recursive: true });
    const model = Buffer.from('cached model'), projector = Buffer.from('matching projector');
    const hash = value => crypto.createHash('sha256').update(value).digest('hex');
    fs.writeFileSync(path.join(directory, 'model-Q4_K_M.gguf'), model);
    fs.writeFileSync(path.join(directory, 'unrelated.gguf'), 'preserved');
    let metadataCalls = 0, downloads = 0;
    const native = loadMain('src/utils/native-ai-runtime.js', {
        '../storage': { getConfigDir: () => root },
        './hubMetadata': { getModelSnapshot: async () => {
            metadataCalls++;
            return { revision: 'a'.repeat(40), files: [
                { type: 'file', path: 'model-Q4_K_M.gguf', size: model.length, lfs: { oid: hash(model) } },
                { type: 'file', path: 'mmproj-F16.gguf', size: projector.length, lfs: { oid: hash(projector) } },
            ] };
        }, selectProjector: files => files[1] },
    }, { fetch: async url => {
        downloads++; assert.match(url, /\/resolve\/a{40}\/mmproj-F16.gguf$/);
        return downloads === 1 ? new Response('', { status: 503 }) : new Response(projector);
    } });
    await assert.rejects(native.ensureLlamaModel('owner/repo:Q4_K_M'), /HTTP 503/);
    assert.ok(fs.existsSync(path.join(directory, '.source-Q4_K_M.json')));
    const result = await native.ensureLlamaModel('owner/repo:Q4_K_M');
    assert.deepEqual(fs.readFileSync(result.modelPath), model);
    assert.deepEqual(fs.readFileSync(result.projectorPath), projector);
    await native.ensureLlamaModel('owner/repo:Q4_K_M');
    assert.equal(metadataCalls, 1); assert.equal(downloads, 2);
    const sourcePath = path.join(directory, '.source-Q4_K_M.json');
    const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    source.projector.path = '../mmproj-F16.gguf';
    fs.writeFileSync(sourcePath, JSON.stringify(source));
    await native.ensureLlamaModel('owner/repo:Q4_K_M');
    assert.equal(metadataCalls, 2, 'invalid cached provenance must be resolved again');
    assert.equal(downloads, 2, 'valid cached artifacts remain reusable');
    assert.equal(fs.readFileSync(path.join(directory, 'unrelated.gguf'), 'utf8'), 'preserved');
});

test('Local AI cancels stalled downloads, requests complete byte-zero ranges and preserves existing files', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-download-stall-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const destination = path.join(root, 'model.gguf');
    fs.writeFileSync(destination, 'previous file');
    let cancelled = false;
    const native = loadMain('src/utils/native-ai-runtime.js', {}, {
        setTimeout: (fn, ms) => setTimeout(fn, ms === 30000 ? 10 : ms),
        fetch: async (_url, init) => {
            assert.equal(init.headers.Range, 'bytes=0-');
            return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
        },
    });
    await assert.rejects(native.installVerifiedFile({ url: 'https://huggingface.co/owner/repo/resolve/revision/model.gguf', destinationPath: destination, sha256: 'a'.repeat(64) }), error => error.code === 'DOWNLOAD_STALLED');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled, true);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'previous file');
    assert.deepEqual(fs.readdirSync(root), ['model.gguf']);
});

test('fresh provider default is Groq; saved provider choices and encrypted keys survive Mistral updates', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-mistral-storage-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const storage = loadMain('src/storage.js', { os: { platform: () => 'win32', homedir: () => root }, electron: {
        app: { isPackaged: true }, safeStorage: { isAsyncEncryptionAvailable: async () => true,
            encryptStringAsync: async value => Buffer.from('encrypted:' + value),
            decryptStringAsync: async value => ({ result: value.toString().replace(/^encrypted:/, ''), shouldReEncrypt: false }),
        },
    } });
    storage.initializeStorage();
    assert.equal(storage.getPreferences().providerMode, 'groq');
    await storage.initializeCredentialStorage();
    await storage.setApiKey('gemini-fixture'); await storage.setGroqApiKey('groq-fixture');
    await storage.setMistralApiKey('mistral-fixture');
    const stored = JSON.parse(fs.readFileSync(path.join(storage.getConfigDir(), 'credentials.json'), 'utf8'));
    assert.equal(stored.format, 'windows-safe-storage-v1');
    assert.equal(stored.apiKey, undefined); assert.equal(stored.mistralApiKey, undefined);
    assert.equal(Buffer.from(stored.encrypted.mistralApiKey, 'base64').toString(), 'encrypted:mistral-fixture');
    await storage.setMistralApiKey('');
    assert.equal(storage.getApiKey(), 'gemini-fixture'); assert.equal(storage.getGroqApiKey(), 'groq-fixture');
    assert.equal(storage.getMistralApiKey(), '');
    for (const mode of ['byok', 'groq', 'local', 'mistral']) { storage.updatePreference('providerMode', mode); assert.equal(storage.getPreferences().providerMode, mode); }
    storage.updatePreference('providerMode', 'cloud'); assert.equal(storage.getPreferences().providerMode, 'byok');
});

test('native startup preserves safe exit diagnostics without exposing native output', async () => {
    const native = loadMain('src/utils/native-ai-runtime.js');
    await assert.rejects(native.waitForServer('http://127.0.0.1:1/health', { exitCode: -1073741515, killed: false, startupDiagnostics: 'private prompt' }, 1000), error => {
        assert.equal(error.code, 'NATIVE_EXIT'); assert.equal(error.exitCode, -1073741515);
        assert.match(error.message, /0xc0000135/); assert.match(error.message, /DLL/);
        assert.doesNotMatch(error.message, /private prompt/); return true;
    });
});

test('overlapping encrypted key saves preserve every provider and recover after a failed write', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-key-race-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const storage = loadMain('src/storage.js', { os: { platform: () => 'win32', homedir: () => root }, electron: {
        app: { isPackaged: true }, safeStorage: { isAsyncEncryptionAvailable: async () => true,
            encryptStringAsync: async value => {
                await new Promise(resolve => setImmediate(resolve));
                if (value === 'fail') throw new Error('Encryption failed');
                return Buffer.from('encrypted:' + value);
            },
            decryptStringAsync: async value => ({ result: value.toString().replace(/^encrypted:/, ''), shouldReEncrypt: false }),
        },
    } });
    storage.initializeStorage();
    await storage.initializeCredentialStorage();
    await Promise.all([storage.setApiKey('gemini-fixture'), storage.setGroqApiKey('groq-fixture'), storage.setMistralApiKey('mistral-fixture')]);
    assert.equal(storage.getApiKey(), 'gemini-fixture');
    assert.equal(storage.getGroqApiKey(), 'groq-fixture');
    assert.equal(storage.getMistralApiKey(), 'mistral-fixture');
    const [failed, saved] = await Promise.allSettled([storage.setApiKey('fail'), storage.setMistralApiKey('replacement')]);
    assert.equal(failed.status, 'rejected'); assert.equal(saved.value, true);
    await storage.initializeCredentialStorage();
    assert.equal(storage.getApiKey(), 'gemini-fixture');
    assert.equal(storage.getGroqApiKey(), 'groq-fixture');
    assert.equal(storage.getMistralApiKey(), 'replacement');
    const pending = storage.setApiKey('discarded-by-reset');
    await storage.clearAllData();
    await pending;
    assert.equal(storage.getApiKey(), '');
    assert.equal(storage.getGroqApiKey(), '');
    assert.equal(storage.getMistralApiKey(), '');
    await storage.initializeCredentialStorage();
    assert.equal(storage.getApiKey(), '', 'a completed reset must not resurrect a pending key save');
});

test('Local AI cancellation cannot emit stale setup state or change a replacement provider', async t => {
    const events = [];
    let release;
    const local = loadMain('src/utils/localai.js', {
        fs: { existsSync: () => true },
        './gemini': { sendToRenderer: (...args) => events.push(args), initializeNewSession() {} },
        './native-ai-runtime': {
            ensureNativeBinary: async () => new Promise(resolve => { release = resolve; }),
            stopNativeServer() {},
        },
    }, { console: { log() {}, warn() {} } });
    t.after(() => local.closeLocalSession());
    const old = local.initializeLocalSession('model', 'tiny.en', 'interview', '');
    const cancellation = local.cancelLocalInitialization();
    events.length = 0;
    await cancellation;
    assert.deepEqual(events, [], 'cancellation must finish state updates before allowing a replacement to start');
    release('/runner');
    assert.equal(await old, false);
    assert.deepEqual(events, [], 'aborted setup must not advance to a later stage after a cached check finishes');

    const f = geminiFixture({ local: { cancelLocalInitialization: () => cancellation } });
    t.after(() => f.close());
    const ipcCancel = f.call('cancel-local-initialization');
    assert.equal((await f.start('mistral')).success, true);
    await ipcCancel;
    const answer = await f.call('send-text-message', 'question', { requestId: 'replacement-1', uiEpoch: 0 });
    assert.equal(answer.model, 'mistral-small-2603', 'an earlier cancel must not reset the replacement provider');
});

test('cancelled Local AI startup cannot launch a runner after an awaited port reservation', async t => {
    for (const blockedPortCall of [1, 2]) {
        let release, ready;
        const waiting = new Promise(resolve => { ready = resolve; });
        let ports = 0;
        const started = [], stopped = [];
        const local = loadMain('src/utils/localai.js', {
            fs: { existsSync: () => true },
            './gemini': { sendToRenderer() {}, initializeNewSession() {} },
            './native-ai-runtime': {
                ensureNativeBinary: async () => '/runner', ensureWhisperModel: async () => '/whisper',
                ensureLlamaModel: async () => ({ modelPath: '/model', projectorPath: '/projector' }),
                getAvailablePort: async () => ++ports === blockedPortCall ? new Promise(resolve => { release = resolve; ready(); }) : 1234,
                startNativeServer: options => { started.push(options); return options; }, waitForServer: async () => {},
                stopNativeServer: process => { if (process) stopped.push(process); },
            },
        }, { console: { log() {}, warn() {} } });
        t.after(() => local.closeLocalSession());
        const old = local.initializeLocalSession('old', 'tiny.en', 'interview', '');
        await waiting;
        assert.equal(await local.initializeLocalSession('replacement', 'tiny.en', 'interview', ''), true);
        const count = started.length;
        release(1234);
        assert.equal(await old, false);
        assert.equal(started.length, count, 'the cancelled owner must not spawn another process');
        assert.equal(local.isLocalSessionActive(), true);
        local.closeLocalSession();
        assert.ok(stopped.includes(started.at(-1)) && stopped.includes(started.at(-2)));
    }
});

test('download progress failures reject safely and remove only the partial download', { timeout: 2000 }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-download-progress-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const destination = path.join(root, 'model.gguf');
    fs.writeFileSync(destination, 'preserved');
    const native = loadMain('src/utils/native-ai-runtime.js', {}, { fetch: async () => new Response('model bytes') });
    await assert.rejects(native.installVerifiedFile({ url: 'https://huggingface.co/owner/repo/resolve/revision/model.gguf',
        destinationPath: destination, sha256: 'a'.repeat(64), onProgress: () => { throw new Error('Progress cancelled'); },
    }), /Progress cancelled/);
    assert.deepEqual(fs.readdirSync(root), ['model.gguf']);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'preserved');
});

test('Local AI exposes a sanitized setup stage through the actual initialization IPC', async () => {
    const local = loadMain('src/utils/localai.js', {
        './gemini': { sendToRenderer() {} },
        './native-ai-runtime': { stopNativeServer() {}, ensureNativeBinary: async () => { throw new Error('HTTP 403 https://example.test/private-token'); } },
    }, { console: { log() {}, warn() {} } });
    const f = geminiFixture({ local });
    const result = await f.start('local');
    assert.equal(result.success, false);
    assert.equal(result.failure.stage, 'Llama runner');
    assert.equal(result.failure.httpStatus, 403);
    assert.match(result.error, /Llama runner/);
    assert.doesNotMatch(result.error, /private-token|example.test/);
    await f.close();
});

test('provider initialization rejects malformed IPC configuration before native or account work', async () => {
    for (const args of [
        [null, 'tiny.en', 'meeting', '', 'en-US', {}],
        ['model', {}, 'meeting', '', 'en-US', {}],
        ['model', 'tiny.en', 'meeting', 'x'.repeat(32001), 'en-US', {}],
        ['model', 'tiny.en', 'meeting', '', 'en-US', { uiEpoch: -1 }],
        ['model', 'tiny.en', 'meeting', '', 'en-US', []],
    ]) {
        let started = false;
        const f = geminiFixture({ local: { initializeLocalSession: async () => { started = true; return true; } } });
        try {
            const result = await f.call('initialize-local', ...args);
            assert.equal(result.success, false);
            assert.equal(started, false);
        } finally { await f.close(); }
    }
    const f = geminiFixture();
    try {
        assert.equal((await f.start('mistral', { uiEpoch: -1 })).success, false);
        assert.equal((await f.start('mistral', [])).success, false);
        assert.equal(f.connections.length, 0);
    } finally { await f.close(); }
});

test('a cancelled Local AI initialization cannot close or overwrite a replacement session', async () => {
    let failOld, calls = 0;
    const stopped = [];
    const local = loadMain('src/utils/localai.js', {
        fs: { existsSync: () => true },
        './gemini': { sendToRenderer() {}, initializeNewSession() {} },
        './native-ai-runtime': {
            ensureNativeBinary: async () => ++calls === 1 ? new Promise((_resolve, reject) => { failOld = reject; }) : '/runner',
            ensureWhisperModel: async () => '/whisper',
            ensureLlamaModel: async () => ({ modelPath: '/model', projectorPath: '/projector' }),
            getAvailablePort: async () => 1234, startNativeServer: () => ({}), waitForServer: async () => {},
            stopNativeServer: process => { if (process) stopped.push(process); },
        },
    }, { console: { log() {}, warn() {} } });
    try {
        const old = local.initializeLocalSession('old-model', 'tiny.en', 'interview', '');
        assert.equal(await local.initializeLocalSession('selected-model', 'tiny.en', 'interview', ''), true);
        failOld(new Error('Old download failed after cancellation'));
        assert.equal(await old, false);
        assert.equal(local.isLocalSessionActive(), true);
        assert.equal(local.getLocalInitializationFailure(), null);
        assert.equal(stopped.length, 0);
    } finally { local.closeLocalSession(); }
});

test('Mistral capture is screen-only for every saved audio mode', async () => {
    for (const audioMode of ['speaker_only', 'mic_only', 'both']) {
        const f = rendererFixture({ prefs: { providerMode: 'mistral', audioMode } });
        assert.equal(await f.api.startCapture(), true);
        assert.equal(f.calls.find(call => call[0] === 'display')[1].audio, false);
        assert.equal(f.calls.filter(call => call[0] === 'microphone').length, 0);
        assert.equal(f.contexts.length, 0);
        assert.equal(f.api.getCaptureState().audioReady, false);
        assert.equal(f.api.getCaptureState().screen, true);
        assert.equal(f.prefs.audioMode, audioMode);
        f.api.stopCapture();
    }
});

test('Mistral is a valid active session without audio and requires its own credential', async () => {
    const f = appFixture({ mode: 'mistral', credentials: { mistral: true }, api: { getCaptureState: () => ({ state: 'ready', screen: true, audioReady: false }) } });
    assert.equal((await f.app.handleStart()).success, true);
    assert.equal(f.app.sessionActive, true); assert.equal(f.app.isRecording, false);
    assert.match(f.app.statusText, /Mistral/);
    await f.app.endSession();
    const missing = appFixture({ mode: 'mistral', credentials: { gemini: true, groq: true } });
    assert.equal((await missing.app.handleStart()).success, false);
    assert.match(missing.app.startError, /No Mistral API key/);
    assert.equal(missing.calls.includes('provider'), false);
});

test('request and setup errors are visible outside collapsed details', () => {
    const { app } = appFixture();
    app.requestError = { operation: 'screen', category: 'transient', httpStatus: 503, message: 'Sanitized overload explanation' };
    const rendered = app.renderSessionDetails();
    assert.match(rendered, /<p class="request-error-message" role="alert">Sanitized overload explanation<\/p>/);
    assert.match(rendered, /HTTP 503/);
});

test('Mistral failure details link account limits and exclude Gemini-only Search guidance', () => {
    const { app } = appFixture();
    app.providerMode = 'mistral';
    app.requestError = { operation: 'screen', category: 'rate-or-quota', httpStatus: 429,
        providerCode: '1300', providerType: 'rate_limited', rateLimits: { requestsPerMinute: 0 }, message: 'Sanitized limit explanation' };
    const rendered = app.renderSessionDetails();
    assert.match(rendered, /Open Mistral limits/);
    assert.match(rendered, /Provider code: 1300/);
    assert.match(rendered, /Effective request limit: 0\/min/);
    assert.match(rendered, /rate_limited/);
    assert.match(rendered, /Google Search is unavailable for Mistral/);
    assert.doesNotMatch(rendered, /Google decides/);
});

test('Mistral key drafts are saved through their own setter before Start', async () => {
    const writes = [];
    const { Target } = componentClass('src/components/views/MainView.js', 'MainView', { contextHalo: { storage: { setMistralApiKey: async value => { writes.push(value); return { success: true }; } } } });
    let starts = 0;
    const view = Object.assign(Object.create(Target.prototype), { _mode: 'mistral', _mistralModel: 'mistral-small-2603', _mistralKey: 'fixture', _keyDraftDirty: true,
        _catalogEpochs: { mistral: 0 }, _catalogTimers: {}, _savedKeys: {}, _keySavePromise: Promise.resolve(),
        _configurationWrites: Promise.resolve(), downloadProgress: { active: false }, requestUpdate() {}, onStart() { starts++; } });
    await view._handleStart();
    assert.deepEqual(writes, ['fixture']); assert.equal(starts, 1);
    assert.equal(view._mistralKey, ''); assert.equal(view._savedKeys.mistral, true);
});

test('Mistral picker persists explicit choices and rejects changes during an active session', async () => {
    const writes = [];
    const { Target } = componentClass('src/components/views/MainView.js', 'MainView');
    const view = Object.assign(Object.create(Target.prototype), { _mistralModel: 'mistral-small-2603', requestUpdate() {},
        _persistConfiguration: async (...args) => writes.push(args) });
    await view._saveMistralModel('ministral-8b-2512');
    assert.equal(view._mistralModel, 'ministral-8b-2512');
    assert.deepEqual(writes, [['config', 'mistralModel', 'ministral-8b-2512']]);
    view.sessionActive = true;
    await view._saveMistralModel('ministral-14b-2512');
    view.sessionActive = false; view.isInitializing = true;
    await view._saveMistralModel('ministral-3b-2512');
    view.isInitializing = false;
    await view._saveMistralModel('untrusted');
    assert.equal(writes.length, 1);
    assert.equal(view._mistralModel, 'ministral-8b-2512');
});
