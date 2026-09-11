const SCREEN_PROVIDER_BUDGET_MS = 70000;
const SCREEN_SESSION_TIMEOUT_MS = 75000;
const SCREEN_RENDERER_TIMEOUT_MS = 80000;

function normalizeModelId(model) {
    return String(model || '').replace(/^models\//, '').trim().toLowerCase();
}

function screenThinkingConfig(model) {
    const id = normalizeModelId(model);
    // Gemini 3.6/3.7/3.8 Flash support low thinking. Keep this opt-in narrow so
    // custom or older models are never sent a thinking-level value they reject.
    if (/^gemini-3\.(?:6|7|8)-flash(?:$|[-.])/.test(id)) {
        return { thinkingConfig: { thinkingLevel: 'low' } };
    }
    return {};
}

module.exports = {
    SCREEN_PROVIDER_BUDGET_MS,
    SCREEN_SESSION_TIMEOUT_MS,
    SCREEN_RENDERER_TIMEOUT_MS,
    screenThinkingConfig,
};
