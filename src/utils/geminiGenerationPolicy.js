const { geminiModelPolicy } = require('./geminiModelPolicy');

// Application budgets, not provider guarantees. maxOutputTokens includes both
// internal thinking and the visible answer. Concision is controlled by the
// response-mode instruction; never try to turn Flash 3.8 thinking off.
function geminiOutputTokenLimit(model, answerTokens, thinkingLevel = 'low') {
    const policy = geminiModelPolicy(model);
    if (!policy || policy.route !== 'generate') return answerTokens;
    const thinkingAllowance = thinkingLevel === 'medium' ? 8192 : 4096;
    return Math.min(policy.outputTokenLimit, answerTokens + thinkingAllowance);
}

const BLOCKED_REASONS = new Set([
    'SAFETY', 'RECITATION', 'LANGUAGE', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII',
    'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'IMAGE_RECITATION', 'ESCALATION', 'PUP_LIMITED_DISABLED',
]);
const FINISH_REASONS = new Set([
    'STOP', 'MAX_TOKENS', ...BLOCKED_REASONS, 'OTHER', 'MALFORMED_FUNCTION_CALL',
    'IMAGE_OTHER', 'NO_IMAGE', 'UNEXPECTED_TOOL_CALL', 'TOO_MANY_TOOL_CALLS',
    'MISSING_THOUGHT_SIGNATURE', 'MALFORMED_RESPONSE',
]);

function assertGeminiGenerationOutcome(chunk) {
    const block = chunk?.promptFeedback?.blockReason;
    const finish = chunk?.candidates?.[0]?.finishReason;
    if (block && block !== 'BLOCK_REASON_UNSPECIFIED') {
        throw Object.assign(new Error('Gemini blocked the request'), {
            code: 'GEMINI_CONTENT_BLOCKED', blockReason: BLOCKED_REASONS.has(block) ? block : 'OTHER',
        });
    }
    if (!finish || finish === 'STOP' || finish === 'FINISH_REASON_UNSPECIFIED') return;
    throw Object.assign(new Error('Gemini did not complete the answer'), {
        code: finish === 'MAX_TOKENS' ? 'GEMINI_OUTPUT_LIMIT'
            : BLOCKED_REASONS.has(finish) ? 'GEMINI_CONTENT_BLOCKED' : 'GEMINI_GENERATION_FAILED',
        finishReason: FINISH_REASONS.has(finish) ? finish : 'OTHER',
    });
}

module.exports = { geminiOutputTokenLimit, assertGeminiGenerationOutcome };
