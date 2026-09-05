const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const registry = require('../src/utils/providerModelRegistry');

const { buildGeminiCatalog, buildGroqCatalog } = registry._test;

test('Gemini catalog separates Live and generateContent models from API metadata', () => {
    const catalog = buildGeminiCatalog([
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

    assert.deepEqual(catalog.live.map(model => model.id), ['gemini-3.1-flash-live-preview']);
    assert.deepEqual(catalog.screen.map(model => model.id), ['gemini-3.7-flash', 'gemini-3.8-flash']);
    assert.equal(catalog.recommended.live, 'gemini-3.1-flash-live-preview');
    assert.equal(catalog.recommended.screen, 'gemini-3.8-flash');
});

test('Groq catalog keeps all active models while grouping task models conservatively', () => {
    const catalog = buildGroqCatalog([
        { id: 'openai/gpt-oss-120b', active: true, owned_by: 'OpenAI' },
        { id: 'qwen/qwen3.8-27b', active: true, owned_by: 'Qwen' },
        { id: 'whisper-large-v3-turbo', active: true, owned_by: 'OpenAI' },
        { id: 'canopylabs/orpheus-v1-english', active: true, owned_by: 'Canopy Labs' },
        { id: 'retired-model', active: false, owned_by: 'Example' },
    ]);

    assert.equal(catalog.all.some(model => model.id === 'retired-model'), false);
    assert.equal(catalog.chat.some(model => model.id === 'openai/gpt-oss-120b'), true);
    assert.equal(catalog.vision.some(model => model.id === 'qwen/qwen3.8-27b'), true);
    assert.deepEqual(catalog.transcription.map(model => model.id), ['whisper-large-v3-turbo']);
    assert.equal(catalog.chat.some(model => model.id.includes('orpheus')), false);
});

test('Phase 1 wiring preserves manual fallback and makes Groq transcription configurable', () => {
    const preload = fs.readFileSync(path.join(process.cwd(), 'preload.js'), 'utf8');
    const indexMain = fs.readFileSync(path.join(process.cwd(), 'src', 'index.js'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(process.cwd(), 'src', 'index.html'), 'utf8');
    const gemini = fs.readFileSync(path.join(process.cwd(), 'src', 'utils', 'gemini.js'), 'utf8');
    const hardening = fs.readFileSync(path.join(process.cwd(), 'src', 'utils', 'runtimeHardeningMain.js'), 'utf8');
    const dynamicUi = fs.readFileSync(path.join(process.cwd(), 'src', 'utils', 'dynamicModelRegistryRenderer.js'), 'utf8');

    assert.match(preload, /provider-models:list/);
    assert.match(indexMain, /listProviderModels/);
    assert.match(indexHtml, /dynamicModelRegistryRenderer\.js/);
    assert.match(gemini, /groqTranscriptionModel/);
    assert.match(hardening, /groqTranscriptionModel/);
    assert.match(dynamicUi, /Manual model IDs remain available/i);
    assert.match(dynamicUi, /All provider models \(advanced\)/);
    assert.match(dynamicUi, /gemini-3\.8-flash/);
});
