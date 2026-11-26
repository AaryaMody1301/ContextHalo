const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMain } = require('./helpers/native-boundary');

function read(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('ContextHalo pins official Windows Local AI runtimes to upstream releases and full commits', () => {
    const native = loadMain('src/utils/native-ai-runtime.js', {
        '../storage': { getConfigDir: () => '/tmp/unused' },
    });
    assert.deepEqual(native.WINDOWS_X64_RELEASES.llama, {
        tag: 'b12774',
        commit: '171527522610996f5f0acf12334e185156ca8f44',
        archive: 'llama-b12774-bin-win-cpu-x64.zip',
        executable: 'llama-server.exe',
        sha256: '44b70b20f3374eec3d16a002beceefef33cc3565678caeb3eea5f6cacba61836',
        url: 'https://github.com/ggml-org/llama.cpp/releases/download/b12774/llama-b12774-bin-win-cpu-x64.zip',
    });
    assert.deepEqual(native.WINDOWS_X64_RELEASES.whisper, {
        tag: 'b5907',
        commit: '5eaee0cc9024eb9e9a99469199920c8b7f5cb9ec',
        archive: 'whisper-bin-x64.zip',
        executable: 'whisper-server.exe',
        sha256: 'ecca07b277d943e9b9f4712856a144b857271a6b333104e511e1988e80db582b',
        url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5907/whisper-bin-x64.zip',
    });
    assert.equal(native.WHISPER_MODEL_REVISION, '5359861c739e955e79d9a303bcbc70fb988958b1');
});

test('runtime source contains no legacy executable host or mutable Hugging Face download revision', () => {
    const native = read('src/utils/native-ai-runtime.js');
    const windows = read('src/utils/windowsLocalAiRuntime.js');
    for (const source of [native, windows]) {
        assert.doesNotMatch(source, /resolve\/main/);
        assert.doesNotMatch(source, /llama-server-windows-x86_64\.exe|whisper-server-windows-x86_64\.exe/);
        assert.doesNotMatch(source, /7dcdb6ae66c8a03f43d412f2fac00382b927a8d2d817d22b231c14a326cdc862/);
        assert.doesNotMatch(source, /654e4531ad7cebe772c08485a742be770d6848b0cda2f540b179f426a6105435/);
    }
    assert.doesNotMatch(native, /github\.com\/sohzm/);
});

test('official runtime archives are staged, verified for their server executable and carry source metadata', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-runtime-provenance-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const native = loadMain('src/utils/native-ai-runtime.js', {
        '../storage': { getConfigDir: () => root },
    });
    const release = native.WINDOWS_X64_RELEASES.whisper;
    const destination = path.join(root, 'whisper-runtime');

    const executable = await native.extractRuntimeArchive('/fixture.zip', destination, release, async (command, args) => {
        assert.equal(command, 'tar.exe');
        const staging = args[args.indexOf('-C') + 1];
        const nested = path.join(staging, 'Release');
        fs.mkdirSync(nested, { recursive: true });
        fs.writeFileSync(path.join(nested, release.executable), 'fixture');
        return { status: 0 };
    });
    assert.equal(path.basename(executable), 'whisper-server.exe');
    const source = JSON.parse(fs.readFileSync(path.join(destination, '.source.json'), 'utf8'));
    assert.deepEqual(source, {
        tag: release.tag,
        commit: release.commit,
        archive: release.archive,
        sha256: release.sha256,
        url: release.url,
    });
});

test('runtime extraction never promotes an archive missing its expected server executable', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-runtime-missing-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const native = loadMain('src/utils/native-ai-runtime.js', {
        '../storage': { getConfigDir: () => root },
    });
    const destination = path.join(root, 'runtime');
    await assert.rejects(native.extractRuntimeArchive('/fixture.zip', destination, native.WINDOWS_X64_RELEASES.llama, async (_command, args) => {
        const staging = args[args.indexOf('-C') + 1];
        fs.writeFileSync(path.join(staging, 'unrelated.exe'), 'fixture');
        return { status: 0 };
    }), /missing llama-server\.exe/);
    assert.equal(fs.existsSync(destination), false);
    assert.deepEqual(fs.readdirSync(root), []);
});

test('dynamic GGUF download uses one immutable Hub revision and persists its artifact provenance', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-model-snapshot-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const revision = 'b'.repeat(40);
    const modelBytes = Buffer.from('model fixture');
    const projectorBytes = Buffer.from('projector fixture');
    const digest = value => crypto.createHash('sha256').update(value).digest('hex');
    const files = [
        { type: 'file', path: 'model-Q4_K_M.gguf', size: modelBytes.length, lfs: { oid: digest(modelBytes) } },
        { type: 'file', path: 'mmproj-F16.gguf', size: projectorBytes.length, lfs: { oid: digest(projectorBytes) } },
    ];
    const urls = [];
    const native = loadMain('src/utils/native-ai-runtime.js', {
        '../storage': { getConfigDir: () => root },
        './hubMetadata': {
            getModelSnapshot: async repository => {
                assert.equal(repository, 'owner/repo');
                return { revision, files };
            },
            selectProjector: list => list[1],
        },
    }, {
        fetch: async url => {
            urls.push(String(url));
            const bytes = String(url).includes('mmproj-') ? projectorBytes : modelBytes;
            return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
        },
    });

    const result = await native.ensureLlamaModel('owner/repo:Q4_K_M');
    assert.equal(path.basename(result.modelPath), 'model-Q4_K_M.gguf');
    assert.equal(path.basename(result.projectorPath), 'mmproj-F16.gguf');
    assert.equal(urls.length, 2);
    assert.ok(urls.every(url => url.includes('/resolve/' + revision + '/')));
    assert.ok(urls.every(url => !url.includes('/resolve/main/')));

    const sourcePath = path.join(root, 'models', 'llama', 'owner', 'repo', '.source-Q4_K_M.json');
    const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    assert.equal(source.repository, 'owner/repo');
    assert.equal(source.revision, revision);
    assert.equal(source.quant, 'Q4_K_M');
    assert.equal(source.model.sha256, digest(modelBytes));
    assert.equal(source.projector.sha256, digest(projectorBytes));

    const offline = { offline: true };
    const startLocal = () => native.ensureLlamaModel('owner/repo:Q4_K_M', null, null, undefined, offline);
    assert.deepEqual(await startLocal(), result);
    fs.writeFileSync(result.projectorPath, 'damaged cached fixture');
    await assert.rejects(startLocal, { code: 'OFFLINE_CACHE_MISSING', message: /vision model files/ });
    await assert.rejects(native.ensureLlamaModel('owner/uncached:Q4_K_M', null, null, undefined, offline),
        { code: 'OFFLINE_CACHE_MISSING', message: /language model metadata/ });
    await assert.rejects(native.ensureWhisperModel('tiny.en', null, undefined, offline), { code: 'OFFLINE_CACHE_MISSING' });
    assert.equal(urls.length, 2, 'after the initial fixture seed there must be no download request');
});

test('model provenance cannot be persisted without a full immutable revision', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-model-provenance-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const native = loadMain('src/utils/native-ai-runtime.js', {
        '../storage': { getConfigDir: () => root },
    });
    assert.throws(() => native.persistModelProvenance(root, { revision: 'main', quant: 'Q4' }), /immutable repository revision/);
    assert.equal(fs.readdirSync(root).length, 0);
});

test('native runner diagnostics handle split offload lines without exposing them in the GPU counts', () => {
    const { EventEmitter } = require('node:events');
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    const native = loadMain('src/utils/native-ai-runtime.js', {
        child_process: { ...require('node:child_process'), spawn: () => child },
    }, { process: { ...process, stdout: { write() {} }, stderr: { write() {} } } });
    native.startNativeServer({ executablePath: 'fixture', arguments: [], name: 'Llama' });
    child.stderr.emit('data', 'load_tensors: offloaded 8/');
    assert.equal(child.gpuLayers, undefined);
    child.stderr.emit('data', '12 layers to GPU\n');
    assert.deepEqual(child.gpuLayers, { offloaded: 8, total: 12 });
});

test('both official b12774 llama runners use the same cache-reuse CLI contract', () => {
    const source = read('src/utils/localai.js');
    assert.ok(source.includes("'--cache-reuse'"));
    assert.doesNotMatch(source, /old CPU|fallback's conservative CLI/);
});
