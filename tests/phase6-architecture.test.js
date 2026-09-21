const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(file, 'utf8');

test('renderer persistence and appearance have one explicit owner each', () => {
    const index = read('src/index.html');
    const renderer = read('src/utils/renderer.js');
    const storage = read('src/utils/rendererStorage.js');
    const theme = read('src/utils/rendererTheme.js');

    const storageScript = index.indexOf('utils/rendererStorage.js');
    const themeScript = index.indexOf('utils/rendererTheme.js');
    const rendererScript = index.indexOf('utils/renderer.js');
    assert.ok(storageScript >= 0 && storageScript < themeScript && themeScript < rendererScript);

    assert.match(renderer, /ContextHaloRendererStorage/);
    assert.match(renderer, /ContextHaloRendererTheme/);
    assert.doesNotMatch(renderer, /let persistenceQueue|const theme = \{/);
    assert.match(storage, /let persistenceQueue = Promise\.resolve\(\)/);
    assert.match(storage, /structuredClone\(args\)/);
    assert.match(theme, /function createThemeController/);
    assert.match(theme, /backgroundTransparency/);
});

test('ContextHaloApp delegates style and response-card ownership', () => {
    const app = read('src/components/app/ContextHaloApp.js');
    const styles = read('src/components/app/ContextHaloAppStyles.js');
    const responses = read('src/components/app/responseStateRenderer.js');

    assert.match(app, /contextHaloAppStyles/);
    assert.match(app, /addResponseState, updateResponseState/);
    assert.match(app, /return addResponseState\(this, response, metadata\)/);
    assert.match(app, /return updateResponseState\(this, response, metadata\)/);
    assert.doesNotMatch(app, /static styles = css\x60/);
    assert.match(styles, /export const contextHaloAppStyles = css\x60/);
    assert.match(responses, /host\._responseRequestIndex/);
    assert.match(responses, /canFollowResponse/);
});

test('Gemini transport keeps policy and lifecycle helpers outside the coordinator', () => {
    const gemini = read('src/utils/gemini.js');
    const failure = read('src/utils/geminiFailure.js');

    for (const helper of [
        'geminiFailure',
        'geminiLiveRuntime',
        'geminiScreenReliability',
        'requestDeadline',
        'sessionRequests',
        'sse',
        'groqRequestPolicy',
    ]) assert.ok(gemini.includes(`require('./${helper}')`), helper);

    assert.doesNotMatch(gemini, /function classifyGeminiFailure\(/);
    assert.match(failure, /function classifyGeminiFailure\(/);
    assert.match(failure, /module\.exports = \{ classifyGeminiFailure \}/);
});

test('source validation includes tests and validation scripts', () => {
    const check = read('scripts/check-source.js');
    assert.match(check, /sourceFiles\('src'\)/);
    assert.match(check, /sourceFiles\('tests'\)/);
    assert.match(check, /sourceFiles\('scripts'\)/);
});
