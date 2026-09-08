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

