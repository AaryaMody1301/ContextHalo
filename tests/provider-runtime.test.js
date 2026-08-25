const test = require('node:test');
const assert = require('node:assert/strict');

test('GoogleGenAI CommonJS export can be wrapped before gemini.js imports it', () => {
    const genai = require('@google/genai');
    const OriginalGoogleGenAI = genai.GoogleGenAI;
    assert.equal(typeof OriginalGoogleGenAI, 'function');

    class WrappedGoogleGenAI extends OriginalGoogleGenAI {}
    genai.GoogleGenAI = WrappedGoogleGenAI;

    try {
        assert.equal(
            genai.GoogleGenAI,
            WrappedGoogleGenAI,
            'runtime hardening depends on replacing the CommonJS GoogleGenAI export'
        );
    } finally {
        genai.GoogleGenAI = OriginalGoogleGenAI;
    }
});
