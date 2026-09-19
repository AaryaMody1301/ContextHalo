const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../src/utils/providerModelRegistry');

const { buildGeminiCatalog, buildGroqCatalog } = registry._test;

test('Gemini catalog separates Live and generateContent models from API metadata', () => {
    const catalog = buildGeminiCatalog([
        {
            name: 'models/gemini-3.8-live',
            displayName: 'Gemini 3.8 Live',
            supportedGenerationMethods: ['bidiGenerateContent'],
        },
        {
            name: 'models/gemini-3.1-flash-live-preview',
            displayName: 'Gemini 3.1 Flash Live Preview',
            supportedGenerationMethods: ['bidiGenerateContent'],
        },
        {
            name: 'models/gemini-3.7-flash',
            displayName: 'Gemini 3.7 Flash',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
        {
            name: 'models/gemini-3.8-flash',
            displayName: 'Gemini 3.8 Flash',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
        {
            name: 'models/gemini-embedding-2',
            displayName: 'Gemini Embedding 2',
            supportedGenerationMethods: ['embedContent'],
        },
    ]);

    assert.deepEqual(catalog.live.map(model => model.id), ['gemini-3.8-live', 'gemini-3.1-flash-live-preview']);
    assert.deepEqual(catalog.screen.map(model => model.id), ['gemini-3.7-flash', 'gemini-3.8-flash']);
    assert.equal(catalog.recommended.live, 'gemini-3.8-live');
    assert.equal(catalog.recommended.screen, 'gemini-3.8-flash');
});

test('Gemini Omni is never offered as an interview Live model', () => {
    const catalog = buildGeminiCatalog([
        {
            name: 'models/gemini-omni-1.1-flash',
            displayName: 'Gemini Omni 1.1 Flash',
            // Defensive fixture: even if a future/incorrect catalog advertises a
            // bidirectional method, Omni is a video-generation family, not the
            // real-time audio dialogue model ContextHalo needs.
            supportedGenerationMethods: ['bidiGenerateContent'],
        },
        {
            name: 'models/example-live-preview',
            displayName: 'Example Live Preview',
            supportedGenerationMethods: ['bidiGenerateContent'],
        },
    ]);

    assert.equal(catalog.live.some(model => model.id === 'gemini-omni-1.1-flash'), false);
    assert.equal(catalog.recommended.live, 'example-live-preview');
});

test('Groq catalog keeps active task models and recommends the lower-latency vision default', () => {
    const catalog = buildGroqCatalog([
        { id: 'openai/gpt-oss-120b', active: true, owned_by: 'OpenAI' },
        { id: 'qwen/qwen3.6-27b', active: true, owned_by: 'Qwen' },
        { id: 'qwen/qwen3.8-27b', active: true, owned_by: 'Qwen' },
        { id: 'whisper-large-v3-turbo', active: true, owned_by: 'OpenAI' },
        { id: 'canopylabs/orpheus-v1-english', active: true, owned_by: 'Canopy Labs' },
        { id: 'retired-model', active: false, owned_by: 'Example' },
    ]);

    assert.equal(catalog.all.some(model => model.id === 'retired-model'), false);
    assert.equal(catalog.chat.some(model => model.id === 'openai/gpt-oss-120b'), true);
    assert.deepEqual(catalog.vision.map(model => model.id).sort(), ['qwen/qwen3.6-27b', 'qwen/qwen3.8-27b']);
    assert.equal(catalog.vision.every(model => model.preview), true);
    assert.equal(catalog.recommended.vision, 'qwen/qwen3.6-27b');
    assert.deepEqual(catalog.transcription.map(model => model.id), ['whisper-large-v3-turbo']);
    assert.equal(catalog.chat.some(model => model.id.includes('orpheus')), false);
});

test('catalog cancellation aborts the fetch and never returns a cached fallback as success', async t => {
    const original = global.fetch;
    t.after(() => { global.fetch = original; });
    global.fetch = async () => new Response(JSON.stringify({ models: [] }));
    await registry.listProviderModels('gemini', 'catalog-cancel-fixture', { forceRefresh: true });
    let requestSignal;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    global.fetch = async (_url, options) => {
        requestSignal = options.signal; started();
        return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    };
    const controller = new AbortController();
    const pending = registry.listProviderModels('gemini', 'catalog-cancel-fixture', { forceRefresh: true, signal: controller.signal });
    await ready; controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(requestSignal.aborted, true);
});
