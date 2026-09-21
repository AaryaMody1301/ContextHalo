const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
    boundedFetch,
    classifyProviderRequest,
    parseRetryAfterMs,
    tuneProviderRequest,
    runWithProviderScope,
    resetProviderSession,
    setFetchImplementationForTests,
} = require('../src/utils/windowsProviderTransport');
const { loadMain } = require('./helpers/native-boundary');
const { mixPcm16 } = loadMain('src/utils/windowsRuntimeMain.js');
const { normalizeEtag, parseModelReference, extractVulkanRuntime, VULKAN_LLAMA_RELEASE } = loadMain('src/utils/windowsLocalAiRuntime.js');

function read(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('Windows provider transport classifies cloud and local runtime calls', () => {
    const textBody = JSON.stringify({ model: 'openai/gpt-oss-120b', messages: [] });
    const imageBody = JSON.stringify({ model: 'qwen/qwen3.8-27b', messages: [{ content: [{ type: 'image_url' }] }] });

    assert.equal(classifyProviderRequest('https://api.groq.com/openai/v1/chat/completions', { body: textBody }), 'groq-text');
    assert.equal(classifyProviderRequest('https://api.groq.com/openai/v1/chat/completions', { body: imageBody }), 'groq-image');
    assert.equal(classifyProviderRequest('https://api.groq.com/openai/v1/audio/transcriptions', {}), 'groq-transcription');
    assert.equal(classifyProviderRequest('http://127.0.0.1:1234/v1/chat/completions', { body: imageBody }), 'local-image');
    assert.equal(classifyProviderRequest('http://127.0.0.1:1234/v1/chat/completions', { body: textBody }), 'local-text');
    assert.equal(classifyProviderRequest('http://127.0.0.1:1234/inference', {}), 'local-whisper');
});

test('Groq Retry-After is honored before retrying a 429', async () => {
    const nativeFetch = global.fetch;
    resetProviderSession();
    let calls = 0;

    setFetchImplementationForTests(async () => {
        calls += 1;
        if (calls === 1) {
            return new Response('rate limited', {
                status: 429,
                headers: { 'retry-after': '0' },
            });
        }
        return new Response('ok', { status: 200 });
    });

    try {
        const response = await boundedFetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'openai/gpt-oss-120b', messages: [] }),
        });
        assert.equal(calls, 2);
        assert.equal(response.status, 200);
        assert.equal(await response.text(), 'ok');
    } finally {
        setFetchImplementationForTests(nativeFetch.bind(global));
        resetProviderSession();
    }
});

test('Groq transport retries only the provider-documented HTTP statuses', async () => {
    const nativeFetch = global.fetch;
    const retryable = [422, 429, 498, 500, 502, 503];
    const nonRetryable = [400, 401, 403, 404, 409, 413, 425, 504];

    try {
        for (const status of retryable) {
            resetProviderSession();
            let calls = 0;
            setFetchImplementationForTests(async () => {
                calls += 1;
                return calls === 1
                    ? new Response('retry', { status, headers: { 'retry-after': '0' } })
                    : new Response('ok', { status: 200 });
            });
            const response = await boundedFetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                body: JSON.stringify({ model: 'openai/gpt-oss-120b', messages: [] }),
            });
            assert.equal(response.status, 200, 'status ' + status + ' should retry');
            assert.equal(calls, 2, 'status ' + status + ' should have one bounded retry');
            await response.text();
        }

        for (const status of nonRetryable) {
            resetProviderSession();
            let calls = 0;
            setFetchImplementationForTests(async () => {
                calls += 1;
                return new Response('no retry', { status });
            });
            const response = await boundedFetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                body: JSON.stringify({ model: 'openai/gpt-oss-120b', messages: [] }),
            });
            assert.equal(response.status, status);
            assert.equal(calls, 1, 'status ' + status + ' must not be retried');
            await response.text();
        }
    } finally {
        setFetchImplementationForTests(nativeFetch.bind(global));
        resetProviderSession();
    }
});

test('provider scope rejects work that ignores cancellation at the hard deadline', async () => {
    resetProviderSession();
    const startedAt = Date.now();
    await assert.rejects(
        runWithProviderScope('test provider', 35, () => new Promise(() => {})),
        /test provider timed out/i
    );
    assert.ok(Date.now() - startedAt < 500, 'scope should reject close to its own deadline');
});

test('GPT-OSS text requests are tuned for low-latency free-tier use', () => {
    const tuned = tuneProviderRequest('groq-text', {
        body: JSON.stringify({
            model: 'openai/gpt-oss-120b',
            messages: [],
            max_completion_tokens: 2048,
        }),
    });
    const body = JSON.parse(tuned.body);
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.include_reasoning, false);
    assert.equal(body.max_completion_tokens, 4096);
});

test('Windows both-audio mixer produces one clipped PCM16 stream', () => {
    const system = Buffer.alloc(6);
    const mic = Buffer.alloc(6);
    system.writeInt16LE(20000, 0);
    mic.writeInt16LE(10000, 0);
    system.writeInt16LE(-20000, 2);
    mic.writeInt16LE(-10000, 2);
    system.writeInt16LE(32767, 4);
    mic.writeInt16LE(32767, 4);

    const mixed = mixPcm16(system, mic);
    assert.equal(mixed.readInt16LE(0), 15000);
    assert.equal(mixed.readInt16LE(2), -15000);
    assert.equal(mixed.readInt16LE(4), 32767);
});


test('Windows mixed-audio dispatch is bounded and drops stale queued work', () => {
    const source = read('src/utils/windowsRuntimeMain.js');
    assert.match(source, /MAX_MIXED_DISPATCH_CHUNKS = 6/);
    assert.match(source, /MAX_MIXED_DISPATCH_AGE_MS = 900/);
    assert.match(source, /mixedAudioDispatchQueue\.length >= MAX_MIXED_DISPATCH_CHUNKS/);
    assert.match(source, /Date\.now\(\) - entry\.queuedAt > MAX_MIXED_DISPATCH_AGE_MS/);
    assert.equal(source.includes('mixedAudioDispatch = mixedAudioDispatch'), false);
});

test('Hugging Face Xet helpers require SHA-256 ETags and safe model references', () => {
    const hash = 'A'.repeat(64);
    assert.equal(normalizeEtag(`"${hash}"`), hash.toLowerCase());
    assert.equal(normalizeEtag('not-a-sha'), null);
    assert.deepEqual(parseModelReference('unsloth/Qwen3.5-4B-GGUF:Q4_K_M'), {
        repository: 'unsloth/Qwen3.5-4B-GGUF',
        quant: 'Q4_K_M',
    });
    assert.throws(() => parseModelReference('../bad:Q4'), /unsupported|unsafe|format/i);
    assert.throws(() => parseModelReference('owner/..:Q4'), /unsupported|unsafe|format/i);
});

test('Windows Local AI pins and validates the official Vulkan llama.cpp runtime', async () => {
    assert.equal(VULKAN_LLAMA_RELEASE.tag, 'b10964');
    assert.equal(VULKAN_LLAMA_RELEASE.commit, 'b29c606e28a01b1bc8c1351026a0fa6e616bf6c4');
    assert.equal(VULKAN_LLAMA_RELEASE.sha256, '1ee3ad952f4ba71f438bd6d7bebef19e1c7af04adcaa35d08b4ddabb27d4c642');
    assert.match(VULKAN_LLAMA_RELEASE.url, /^https:\/\/github\.com\/ggml-org\/llama\.cpp\/releases\/download\/b10964\//);

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'contexthalo-vulkan-'));
    const runtimeDirectory = path.join(tempRoot, 'runtime');
    try {
        const spawn = (command, args) => {
            assert.equal(command, 'tar.exe');
            const target = args[args.indexOf('-C') + 1];
            fs.mkdirSync(target, { recursive: true });
            fs.writeFileSync(path.join(target, 'llama-server.exe'), 'server');
            fs.writeFileSync(path.join(target, 'ggml-vulkan.dll'), 'vulkan');
            return { status: 0 };
        };
        const executable = await extractVulkanRuntime(path.join(tempRoot, 'runtime.zip'), runtimeDirectory, spawn);
        assert.equal(path.basename(executable), 'llama-server.exe');
        assert.equal(fs.existsSync(path.join(runtimeDirectory, 'ggml-vulkan.dll')), true);
        const source = JSON.parse(fs.readFileSync(path.join(runtimeDirectory, '.source.json'), 'utf8'));
        assert.equal(source.tag, VULKAN_LLAMA_RELEASE.tag);
        assert.equal(source.commit, VULKAN_LLAMA_RELEASE.commit);
        assert.equal(source.sha256, VULKAN_LLAMA_RELEASE.sha256);
        assert.equal(source.url, VULKAN_LLAMA_RELEASE.url);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('Windows security and packaging configuration are enabled together', () => {
    const windowSource = read('src/utils/window.js');
    const windowsRuntime = read('src/utils/contextCaptureMain.js');
    const storageSource = read('src/storage.js');
    const preloadSource = read('preload.js');
    const packageJson = JSON.parse(read('package.json'));
    const indexSource = read('src/index.js');

    assert.match(windowSource, /sandbox: true/);
    assert.equal(windowSource.includes('enableBlinkFeatures'), false);
    assert.match(windowSource, /setPermissionRequestHandler/);
    assert.match(windowSource, /setPermissionCheckHandler/);
    assert.match(windowSource, /Content-Security-Policy/);
    assert.match(windowsRuntime, /audio: 'loopback'/);
    assert.match(windowsRuntime, /useSystemPicker: false/);
    assert.match(windowsRuntime, /screen\.getPrimaryDisplay/);
    assert.match(storageSource, /safeStorage\.encryptString/);
    assert.match(storageSource, /windows-safe-storage-v1/);
    assert.equal(preloadSource.includes('process.env'), false);
    assert.equal(packageJson.build.win.icon, 'src/assets/logo.ico');
    assert.deepEqual(packageJson.build.electronFuses, {
        runAsNode: false,
        enableCookieEncryption: true,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: false,
        enableEmbeddedAsarIntegrityValidation: true,
        onlyLoadAppFromAsar: true,
    });
    assert.equal(packageJson.dependencies['electron-squirrel-startup'], undefined);
    assert.equal(Object.keys(packageJson.devDependencies).some(name => name.startsWith('@electron-forge/')), false);
    assert.equal(packageJson.devDependencies['@reforged/maker-appimage'], undefined);
    assert.equal(indexSource.includes('electron-squirrel-startup'), false);
    assert.ok(indexSource.indexOf('installWindowsProviderTransport();') < indexSource.indexOf("require('./utils/gemini')"));
    assert.ok(indexSource.indexOf('installWindowsLocalAiRuntime();') < indexSource.indexOf("require('./utils/gemini')"));
});

test('Retry-After numeric values are interpreted as seconds', () => {
    const headers = new Headers({ 'retry-after': '2.5' });
    assert.equal(parseRetryAfterMs(headers), 2500);
});

test('cancelled asynchronous Vulkan extraction never promotes its partial files', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-extract-abort-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const destination = path.join(directory, 'runtime');
    const controller = new AbortController();
    await assert.rejects(extractVulkanRuntime('/archive.zip', destination, async (_command, args, options) => {
        assert.equal(options.signal, controller.signal);
        const stage = args[args.indexOf('-C') + 1];
        fs.writeFileSync(path.join(stage, 'llama-server.exe'), 'partial');
        await new Promise(resolve => setImmediate(resolve));
        controller.abort();
        return { status: 0 };
    }, controller.signal), error => error.name === 'AbortError');
    assert.equal(fs.existsSync(destination), false);
    assert.deepEqual(fs.readdirSync(directory), []);
});
