const test = require('node:test');
const assert = require('node:assert/strict');
const { geminiFixture } = require('./helpers/gemini-fixture');
const transport = require('../src/utils/windowsProviderTransport');

const screenshot = { data: Buffer.alloc(1100).toString('base64'), mimeType: 'image/jpeg', prompt: 'Explain the code' };

for (const [response, category] of [
    [{ text: 'Incomplete answer', candidates: [{ finishReason: 'MAX_TOKENS' }] }, 'output-limit'],
    [{ candidates: [{ finishReason: 'MAX_TOKENS' }], usageMetadata: { thoughtsTokenCount: 768 } }, 'output-limit'],
    [{ promptFeedback: { blockReason: 'SAFETY', blockReasonMessage: 'private input' } }, 'content-blocked'],
    [{ candidates: [{ finishReason: 'RECITATION', finishMessage: 'private output' }] }, 'content-blocked'],
    [{ text: 'unfinished', candidates: [{ finishReason: 'MALFORMED_FUNCTION_CALL' }] }, 'generation-failed'],
]) test(`screen completion ${JSON.stringify(response)} is reported as ${category}, never saved as successful`, async t => {
    const f = geminiFixture({ model: 'gemini-3.8-flash', generate: async () => response });
    t.after(() => f.close()); await f.start();
    const result = await f.call('send-image-content', screenshot);
    assert.equal(result.success, false);
    assert.equal(result.failure.category, category);
    assert.equal(f.generated.length, 1, 'terminal generation outcomes do not replay a request');
    assert.equal(f.events.filter(([channel]) => channel === 'save-screen-analysis').length, 0);
    assert.doesNotMatch(JSON.stringify(result), /private input|private output/);
});

test('Gemini budgets leave room for thinking while the chosen mode still controls answer length', async t => {
    for (const mode of ['instant', 'balanced', 'detailed']) {
        const f = geminiFixture({ model: 'gemini-3.8-flash', preferences: { responseMode: mode } });
        t.after(() => f.close()); await f.start();
        await f.call('send-image-content', screenshot);
        await f.call('send-text-message', 'Explain this');
        for (const params of f.generated) {
            assert.ok(params.config.maxOutputTokens >= 4096, 'visible-answer tokens alone cannot budget a thinking model');
            assert.ok(params.config.maxOutputTokens <= 65536);
            assert.match(params.config.systemInstruction, new RegExp('ContextHalo response mode: ' + mode));
        }
        assert.equal(f.generated[0].config.thinkingConfig.thinkingLevel, 'low');
        await f.close();
    }
});

test('a failed HTTP attempt is cancelled before its retry starts', async t => {
    const f = geminiFixture(); t.after(() => f.close());
    const signals = []; let clock = 1000;
    const result = await f.api.runGeminiRequest(async (_remaining, attempt, signal) => {
        signals.push(signal);
        if (!attempt) throw { status: 503 };
        assert.equal(signals[0].aborted, true, 'failed SDK stream must not survive into next attempt');
        assert.notEqual(signal, signals[0]);
        return 'recovered';
    }, { operation: 'screen', model: 'test', now: () => clock, random: () => 0,
        wait: async ms => { assert.equal(signals[0].aborted, true); clock += ms; } });
    assert.equal(result, 'recovered');
    assert.equal(signals[1].aborted, true, 'completed attempts also release their transport');
});

test('503 diagnostics report actual attempts rather than claiming an unperformed retry', async t => {
    const f = geminiFixture(); t.after(() => f.close());
    await assert.rejects(f.api.runGeminiRequest(async () => {
        throw { status: 503, headers: { 'retry-after': '120' } };
    }, { operation: 'screen', model: 'test', budgetMs: 70000 }), error => {
        assert.equal(error.failure.attempts, 1);
        assert.doesNotMatch(error.message, /ContextHalo retried/);
        return true;
    });
});

test('Gemini HTTP headers survive a broken error body', async t => {
    t.after(() => transport.setFetchImplementationForTests(global.fetch));
    transport.setFetchImplementationForTests(async () => new Response(new ReadableStream({
        start(controller) { controller.error(new TypeError('terminated')); },
    }), { status: 503, headers: { 'retry-after': '120' } }));
    await assert.rejects(transport.boundedFetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse'), error => {
        assert.equal(error.status, 503);
        assert.equal(error.headers['retry-after'], '120');
        return true;
    });
});
