const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
    SCREEN_PROVIDER_BUDGET_MS,
    SCREEN_SESSION_TIMEOUT_MS,
    SCREEN_WINDOWS_SCOPE_MS,
    SCREEN_RENDERER_TIMEOUT_MS,
    screenThinkingConfig,
} = require('../src/utils/geminiScreenReliability');
const { geminiFixture } = require('./helpers/gemini-fixture');

const imagePayload = () => ({
    data: Buffer.alloc(1100).toString('base64'),
    mimeType: 'image/jpeg',
    prompt: 'Analyze the visible interview question',
});

test('screen reliability budgets leave one owner at each layer', () => {
    assert.equal(SCREEN_PROVIDER_BUDGET_MS, 70000);
    assert.equal(SCREEN_SESSION_TIMEOUT_MS, 75000);
    assert.equal(SCREEN_WINDOWS_SCOPE_MS, 77000);
    assert.equal(SCREEN_RENDERER_TIMEOUT_MS, 80000);
    assert.ok(SCREEN_PROVIDER_BUDGET_MS < SCREEN_SESSION_TIMEOUT_MS);
    assert.ok(SCREEN_SESSION_TIMEOUT_MS < SCREEN_WINDOWS_SCOPE_MS);
    assert.ok(SCREEN_WINDOWS_SCOPE_MS < SCREEN_RENDERER_TIMEOUT_MS);
    const windowsRuntime = fs.readFileSync('src/utils/windowsRuntimeMain.js', 'utf8');
    assert.match(windowsRuntime, /runWithProviderScope\('Analyze Screen', SCREEN_WINDOWS_SCOPE_MS/);
    assert.doesNotMatch(windowsRuntime, /ANALYZE_SCOPE_MS = 58000/);
});

test('renderer watchdog does not depend on a page-relative CommonJS require', () => {
    const source = fs.readFileSync('src/utils/renderer.js', 'utf8');
    assert.doesNotMatch(source, /require\(['"]\.\/geminiScreenReliability['"]\)/);
    const match = source.match(/const SCREEN_RENDERER_TIMEOUT_MS = (\d+);/);
    assert.ok(match, 'renderer watchdog constant is declared locally');
    assert.equal(Number(match[1]), SCREEN_RENDERER_TIMEOUT_MS);
});

test('low thinking is enabled only for compatible Gemini Flash models', () => {
    for (const model of ['gemini-3.8-flash', 'models/gemini-3.7-flash', 'gemini-3.6-flash-preview']) {
        assert.deepEqual(screenThinkingConfig(model), { thinkingConfig: { thinkingLevel: 'low' } });
    }
    for (const model of ['gemini-2.5-flash', 'gemini-3.1-flash-lite-image', 'custom-model']) {
        assert.deepEqual(screenThinkingConfig(model), {});
    }
});

test('screen 503 retry does not reconnect or end the Live interview', async t => {
    let calls = 0;
    const f = geminiFixture({
        model: 'gemini-3.8-flash',
        generate: async () => {
            calls += 1;
            if (calls === 1) throw Object.assign(new Error('service unavailable'), { status: 503, headers: { 'retry-after': '0' } });
            return { text: 'Recovered screen answer' };
        },
    });
    t.after(() => f.close());
    assert.equal((await f.start()).success, true);
    const liveConnections = f.connections.length;
    const result = await f.call('send-image-content', imagePayload());
    assert.equal(result.success, true);
    assert.equal(result.text, 'Recovered screen answer');
    assert.equal(calls, 2);
    assert.equal(f.connections.length, liveConnections);
});

test('screen 504 retry does not reconnect or end the Live interview', async t => {
    let calls = 0;
    const f = geminiFixture({
        model: 'gemini-3.8-flash',
        generate: async () => {
            calls += 1;
            if (calls === 1) throw Object.assign(new Error('deadline exceeded'), { status: 504, headers: { 'retry-after': '0' } });
            return { text: 'Recovered after deadline' };
        },
    });
    t.after(() => f.close());
    assert.equal((await f.start()).success, true);
    const liveConnections = f.connections.length;
    const result = await f.call('send-image-content', imagePayload());
    assert.equal(result.success, true);
    assert.equal(result.text, 'Recovered after deadline');
    assert.equal(calls, 2);
    assert.equal(f.connections.length, liveConnections);
});

test('Assistant screen UI leaves the renderer watchdog as the only UI deadline owner', () => {
    const source = fs.readFileSync('src/components/views/AssistantView.js', 'utf8');
    const start = source.indexOf('    async handleScreenAnswer(options = {}) {');
    const end = source.indexOf('    handleResponseLink(event) {', start);
    assert.ok(start >= 0 && end > start);
    const handler = source.slice(start, end);
    assert.doesNotMatch(handler, /setTimeout\s*\(/);
    assert.doesNotMatch(handler, /clearTimeout\s*\(/);
    assert.match(handler, /new AbortController\(\)/);
});

test('Settings explicitly enters the Lit connected lifecycle', () => {
    const source = fs.readFileSync('src/components/views/CustomizeView.js', 'utf8');
    assert.match(source, /connectedCallback\(\)\s*\{\s*super\.connectedCallback\(\);\s*\}/);
});

test('Windows Electron smoke re-queries mounted Settings instead of caching a missing view', () => {
    const source = fs.readFileSync('scripts/renderer-behavior-smoke.js', 'utf8');
    const navigation = source.indexOf("app.navigate('customize');");
    const readyCheck = source.indexOf('const unifiedPage = settingsInApp?.shadowRoot?.querySelector', navigation);
    assert.ok(navigation >= 0 && readyCheck > navigation);
    const probe = source.slice(navigation, readyCheck);
    assert.match(probe, /for \(let attempt = 0; attempt < 200 && !settingsReady; attempt\+\+\)/);
    assert.match(probe, /settingsInApp = app\.shadowRoot\?\.querySelector\('customize-view'\) \|\| null/);
    assert.match(probe, /settingsReady = Boolean\(settingsInApp\?\.shadowRoot\?\.querySelector\('\.unified-page'\)\)/);
});

test('Windows Electron smoke exposes bounded mounted Settings connectivity diagnostics while the CI regression is repaired', () => {
    const source = fs.readFileSync('scripts/renderer-behavior-smoke.js', 'utf8');
    assert.match(source, /settingsDebug:/);
    assert.match(source, /updateError: settingsUpdateError/);
    assert.match(source, /constructorName: settingsInApp\?\.constructor\?\.name/);
    assert.match(source, /Promise\.race\(\[/);
    assert.match(source, /updateComplete timed out after 2000ms/);
    assert.match(source, /appConnected: Boolean\(app\?\.isConnected\)/);
    assert.match(source, /isConnected: Boolean\(settingsInApp\?\.isConnected\)/);
    assert.match(source, /rootIsAppShadow: settingsInApp\?\.getRootNode\?\.\(\) === app\?\.shadowRoot/);
});
