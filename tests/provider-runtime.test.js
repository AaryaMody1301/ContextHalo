const test = require('node:test');
const assert = require('node:assert/strict');

test('GoogleGenAI CommonJS export can be wrapped before gemini.js imports it', () => {
    const modulePath = require.resolve('@google/genai');
    const genai = require('@google/genai');
    const cachedModule = require.cache[modulePath];
    const originalExports = cachedModule.exports;
    const OriginalGoogleGenAI = genai.GoogleGenAI;
    assert.equal(typeof OriginalGoogleGenAI, 'function');

    class WrappedGoogleGenAI extends OriginalGoogleGenAI {}
    let installed = false;

    try {
        try {
            genai.GoogleGenAI = WrappedGoogleGenAI;
            installed = genai.GoogleGenAI === WrappedGoogleGenAI;
        } catch {}

        if (!installed) {
            cachedModule.exports = { ...genai, GoogleGenAI: WrappedGoogleGenAI };
            installed = require('@google/genai').GoogleGenAI === WrappedGoogleGenAI;
        }

        assert.equal(installed, true, 'runtime hardening must be able to replace GoogleGenAI before gemini.js imports it');
    } finally {
        cachedModule.exports = originalExports;
        try {
            genai.GoogleGenAI = OriginalGoogleGenAI;
        } catch {}
    }
});
