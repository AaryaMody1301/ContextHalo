const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    boundedFetch,
    classifyProviderRequest,
    parseRetryAfterMs,
    tuneProviderRequest,
    runWithProviderScope,
    resetProviderSession,
    setFetchImplementationForTests,
} = require('../src/utils/windowsProviderTransport');
const { mixPcm16 } = require('../src/utils/windowsRuntimeMain');
const { normalizeEtag, parseModelReference } = require('../src/utils/windowsLocalAiRuntime');

function read(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('Windows provider transport classifies cloud and local runtime calls', () => {
    const textBody = JSON.stringify({ model: 'openai/gpt-oss-120b', messages: [] });
    const imageBody = JSON.stringify({ model: 'qwen/qwen3.6-27b', messages: [{ content: [{ type: 'image_url' }] }] });

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

test('Hugging Face Xet helpers require SHA-256 ETags and safe model references', () => {
    const hash = 'A'.repeat(64);
    assert.equal(normalizeEtag(`"${hash}"`), hash.toLowerCase());
    assert.equal(normalizeEtag('not-a-sha'), null);
    assert.deepEqual(parseModelReference('unsloth/Qwen3.5-4B-GGUF:Q4_K_M'), {
        repository: 'unsloth/Qwen3.5-4B-GGUF',
        quant: 'Q4_K_M',
    });
    assert.throws(() => parseModelReference('../bad:Q4'), /unsupported|format/i);
});

test('Windows security and packaging configuration are enabled together', () => {
    const windowSource = read('src/utils/window.js');
    const storageSource = read('src/storage.js');
    const preloadSource = read('preload.js');
    const packageJson = JSON.parse(read('package.json'));
    const indexSource = read('src/index.js');
    const analyzeSource = read('src/utils/analyzeProviderFallback.js');

    assert.match(windowSource, /sandbox: true/);
    assert.equal(windowSource.includes('enableBlinkFeatures'), false);
    assert.match(windowSource, /setPermissionRequestHandler/);
    assert.match(windowSource, /setPermissionCheckHandler/);
    assert.match(windowSource, /Content-Security-Policy/);
    assert.match(storageSource, /safeStorage\.encryptString/);
    assert.match(storageSource, /windows-safe-storage-v1/);
    assert.equal(preloadSource.includes('process.env'), false);
    assert.equal(packageJson.build.win.icon, 'src/assets/logo.ico');
    assert.ok(indexSource.indexOf('installWindowsProviderTransport();') < indexSource.indexOf("require('./utils/gemini')"));
    assert.ok(indexSource.indexOf('installWindowsLocalAiRuntime();') < indexSource.indexOf("require('./utils/gemini')"));
    assert.match(analyzeSource, /__lastAnalyzeActualModel = model/);
});

test('Retry-After numeric values are interpreted as seconds', () => {
    const headers = new Headers({ 'retry-after': '2.5' });
    assert.equal(parseRetryAfterMs(headers), 2500);
});
