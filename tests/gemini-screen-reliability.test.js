const test = require('node:test');
const assert = require('node:assert/strict');
const {
    SCREEN_PROVIDER_BUDGET_MS,
    SCREEN_SESSION_TIMEOUT_MS,
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
    assert.equal(SCREEN_RENDERER_TIMEOUT_MS, 80000);
    assert.ok(SCREEN_PROVIDER_BUDGET_MS < SCREEN_SESSION_TIMEOUT_MS);
    assert.ok(SCREEN_SESSION_TIMEOUT_MS < SCREEN_RENDERER_TIMEOUT_MS);
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
