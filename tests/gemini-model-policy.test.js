const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
    GEMINI_MODEL_POLICY,
    GEMINI_SCREEN_MODEL_IDS,
    GEMINI_LIVE_SELECTABLE_IDS,
    GEMINI_LIVE_MAPPED_IDS,
    geminiModelPolicy,
    geminiCapabilityLabel,
    screenThinkingConfigForModel,
} = require('../src/utils/geminiModelPolicy');

test('Gemini model policy matches the audited September 2026 stable model families', () => {
    assert.deepEqual(GEMINI_SCREEN_MODEL_IDS, [
        'gemini-3.8-flash',
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
    ]);
    assert.deepEqual(GEMINI_LIVE_SELECTABLE_IDS, ['gemini-3.8-live']);
    assert.deepEqual(GEMINI_LIVE_MAPPED_IDS, ['gemini-3.8-live', 'gemini-3.8-live-extended-thinking']);

    for (const id of GEMINI_SCREEN_MODEL_IDS) {
        const policy = geminiModelPolicy(id);
        assert.equal(policy.lifecycle, 'stable', id);
        assert.equal(policy.route, 'generate', id);
        assert.ok(policy.roles.includes('screen'), id);
        assert.ok(policy.inputs.includes('image'), id);
        assert.equal(policy.search, true, id);
        assert.ok(policy.thinkingLevels.includes('low'), id);
        assert.equal(policy.inputTokenLimit, 1048576, id);
        assert.equal(policy.outputTokenLimit, 65536, id);
        assert.deepEqual(screenThinkingConfigForModel(id), { thinkingConfig: { thinkingLevel: 'low' } }, id);
    }
});

test('Gemini 3.8 and 3.7 Flash exclude minimal thinking while older mapped stable Flash models allow it', () => {
    for (const id of ['gemini-3.8-flash', 'gemini-3.7-flash']) {
        assert.deepEqual(geminiModelPolicy(id).thinkingLevels, ['low', 'medium', 'high']);
    }
    for (const id of ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']) {
        assert.ok(geminiModelPolicy(id).thinkingLevels.includes('minimal'), id);
    }
});

test('standard and Extended Thinking Live models remain distinct protocol contracts', () => {
    const standard = geminiModelPolicy('models/gemini-3.8-live');
    const extended = geminiModelPolicy('gemini-3.8-live-extended-thinking');

    assert.equal(standard.contextHaloCompatibility, 'supported');
    assert.deepEqual(standard.thinkingLevels, []);
    assert.equal(standard.defaultThinking, 'interleaved-fixed');
    assert.equal(standard.search, true);

    assert.equal(extended.contextHaloCompatibility, 'mapped-not-selectable');
    assert.equal(extended.requiresInteractionStatus, true);
    assert.equal(extended.asyncFunctionsOnly, true);
    assert.deepEqual(extended.thinkingLevels, ['low', 'medium', 'high']);
    assert.match(extended.compatibilityReason, /interactionStatus/);
    assert.equal(extended, GEMINI_MODEL_POLICY['gemini-3.8-live-extended-thinking']);
    assert.match(geminiCapabilityLabel('gemini-3.8-live-extended-thinking'), /not enabled/);
});

test('unknown, preview and specialized models do not inherit screen thinking support', () => {
    for (const id of ['gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-image', 'gemini-omni-1.1-flash', 'custom-model']) {
        assert.deepEqual(screenThinkingConfigForModel(id), {}, id);
    }
});

test('model picker renders capability metadata returned by provider discovery', () => {
    const source = fs.readFileSync('src/utils/dynamicModelRegistryRenderer.js', 'utf8');
    assert.match(source, /model\.capabilityLabel/);
    const main = fs.readFileSync('src/components/views/MainView.js', 'utf8');
    assert.match(main, /Extended Thinking is mapped but not selectable yet/);
    assert.match(main, /screen analysis uses low thinking and bounded 503 backoff/);
});
