const test = require('node:test');
const assert = require('node:assert/strict');

const {
    installAnalyzeProviderFallback,
    isRetryableAnalyzeError,
    REQUEST_TIMEOUT_MS,
    FALLBACK_MODEL,
} = require('../src/utils/analyzeProviderFallback');

test('Analyze fallback remains inside the renderer 60 second watchdog', () => {
    const maximumTwoModelWindow = REQUEST_TIMEOUT_MS * 2 + 1000;
    assert.ok(maximumTwoModelWindow < 60000, `fallback window ${maximumTwoModelWindow}ms must stay below 60s`);
    assert.equal(FALLBACK_MODEL, 'gemini-3.6-flash');
});

test('Analyze fallback recognizes provider capacity and timeout failures', () => {
    for (const message of [
        '503 Service Unavailable',
        '429 RESOURCE_EXHAUSTED',
        '409 Conflict',
        '504 deadline exceeded',
        'Request timed out',
        'model not available',
    ]) {
        assert.equal(isRetryableAnalyzeError(new Error(message)), true, message);
    }
    assert.equal(isRetryableAnalyzeError(new Error('401 invalid API key')), false);
    assert.equal(isRetryableAnalyzeError(new Error('400 invalid request')), false);
});

test('Analyze provider wrapper can replace the current GoogleGenAI export', () => {
    const genai = require('@google/genai');
    const before = genai.GoogleGenAI;
    assert.equal(typeof before, 'function');

    installAnalyzeProviderFallback();

    const after = require('@google/genai').GoogleGenAI;
    assert.equal(typeof after, 'function');
    assert.notEqual(after, before);
    assert.equal(after.__analyzeFallbackInstalled, true);

    const client = new after({ apiKey: 'test-key' });
    assert.equal(typeof client.models.generateContentStream, 'function');
});
