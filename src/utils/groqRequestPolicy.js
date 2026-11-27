const { parseRetryAfterMs } = require('./requestDeadline');
const QWEN_REASONING_MODELS = /^qwen\/qwen3\.(?:6|8)-27b$/;
const GPT_OSS_MODELS = /^openai\/gpt-oss-(?:20b|120b)$/;

function normalizedInstruction(systemPrompt, maxChars) {
    const fallback = 'You are a helpful assistant.';
    const value = String(systemPrompt || fallback);
    return Number.isFinite(maxChars) ? value.slice(0, Math.max(0, maxChars)) : value;
}

function prependInstruction(content, instruction) {
    const prefix = `Instructions for this request:\n${instruction}\n\nRequest:\n`;
    if (typeof content === 'string') return prefix + content;
    if (!Array.isArray(content)) return prefix;

    const textIndex = content.findIndex(part => part?.type === 'text' && typeof part.text === 'string');
    if (textIndex < 0) return [{ type: 'text', text: prefix }, ...content];

    return content.map((part, index) => index === textIndex ? { ...part, text: prefix + part.text } : part);
}

function buildGroqMessages(systemPrompt, messages = [], maxInstructionChars) {
    const instruction = normalizedInstruction(systemPrompt, maxInstructionChars);
    const input = Array.isArray(messages) ? messages : [];
    return [{ role: 'system', content: instruction }, ...input];
}

function formatGroqMessages(model, messages) {
    if (!QWEN_REASONING_MODELS.test(String(model || ''))) {
        return messages;
    }
    const instruction = messages.filter(message => message?.role === 'system').map(message => message.content).join('\n\n');
    if (!instruction) return messages;
    const output = messages.filter(message => message?.role !== 'system');
    for (let index = output.length - 1; index >= 0; index--) {
        if (output[index]?.role !== 'user') continue;
        output[index] = { ...output[index], content: prependInstruction(output[index].content, instruction) };
        return output;
    }

    return [{ role: 'user', content: prependInstruction('', instruction) }, ...output];
}

function getGroqReasoningOptions(model, disableThinking) {
    const normalizedModel = String(model || '');
    if (normalizedModel === 'meta-models/muse-spark-open') {
        return { reasoning_effort: disableThinking ? 'low' : 'medium' };
    }
    if (QWEN_REASONING_MODELS.test(normalizedModel)) {
        return {
            reasoning_format: 'hidden',
            // Groq's reasoning/API reference maps Qwen 3.8 default to no
            // reasoning. Select a documented effort when the user enables it;
            // preserve the older enterprise-only 3.6 contract.
            reasoning_effort: disableThinking ? 'none' : normalizedModel === 'qwen/qwen3.8-27b' ? 'low' : 'default',
        };
    }
    if (GPT_OSS_MODELS.test(normalizedModel)) {
        return { include_reasoning: false, reasoning_effort: 'low' };
    }
    return {};
}

function groqHttpFailure(response, operation, model) {
    const httpStatus = response.status;
    // Status and retry timing suffice. Error bodies can echo the user's input.
    void response.body?.cancel().catch(() => {});
    const known = {
        400: ['invalid-configuration', 'Review the selected Groq model and request settings.'],
        401: ['authentication', 'Check the saved Groq API key.'],
        403: ['permission', 'Check this key’s access to the selected model in Groq Console.'],
        404: ['model-unavailable', 'Refresh the Groq model list and review the selected model.'],
        413: ['request-too-large', 'Reduce the request size.'],
        429: ['rate-or-quota', 'Groq reached a rate or usage limit.'],
        498: ['service-unavailable', 'Groq Flex capacity is temporarily unavailable.'],
    };
    const [category, advice] = known[httpStatus] || (httpStatus >= 500
        ? ['service-unavailable', 'Groq is temporarily unavailable. Try again later.']
        : ['request-failed', 'Review the selected model and request settings.']);
    const delay = [429, 503].includes(httpStatus) ? parseRetryAfterMs(response.headers) : null;
    const retryAfterMs = Number.isSafeInteger(delay) ? delay : null;
    const message = `Groq ${operation} (HTTP ${httpStatus}). ${advice}${retryAfterMs === null ? '' : ` Retry in ${Math.ceil(retryAfterMs / 1000)}s.`}`;
    return { success: false, error: message, failure: { operation, model, category, httpStatus, message, retryAfterMs,
        retryAt: retryAfterMs === null ? null : Date.now() + retryAfterMs } };
}

module.exports = {
    buildGroqMessages,
    formatGroqMessages,
    getGroqReasoningOptions,
    groqHttpFailure,
    _test: { prependInstruction, normalizedInstruction },
};
