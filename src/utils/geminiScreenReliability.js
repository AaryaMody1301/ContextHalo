const { screenThinkingConfigForModel } = require('./geminiModelPolicy');
const SCREEN_PROVIDER_BUDGET_MS = 70000;
const SCREEN_SESSION_TIMEOUT_MS = 75000;
const SCREEN_WINDOWS_SCOPE_MS = 77000;
// The classic renderer mirrors this value locally because its page script cannot
// safely resolve this CommonJS module path; regression coverage enforces parity.
const SCREEN_RENDERER_TIMEOUT_MS = 80000;

function screenThinkingConfig(model) {
    // Use the audited Gemini capability map rather than a version regex so
    // stable Flash and Flash-Lite models receive only documented levels.
    return screenThinkingConfigForModel(model);
}

module.exports = {
    SCREEN_PROVIDER_BUDGET_MS,
    SCREEN_SESSION_TIMEOUT_MS,
    SCREEN_WINDOWS_SCOPE_MS,
    SCREEN_RENDERER_TIMEOUT_MS,
    screenThinkingConfig,
};
