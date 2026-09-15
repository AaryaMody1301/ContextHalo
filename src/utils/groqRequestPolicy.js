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

function buildGroqMessages(model, systemPrompt, messages = [], maxInstructionChars) {
    const instruction = normalizedInstruction(systemPrompt, maxInstructionChars);
    const input = Array.isArray(messages) ? messages : [];
    if (!QWEN_REASONING_MODELS.test(String(model || ''))) {
        return [{ role: 'system', content: instruction }, ...input];
    }

    const output = [...input];
    for (let index = output.length - 1; index >= 0; index--) {
        if (output[index]?.role !== 'user') continue;
        output[index] = { ...output[index], content: prependInstruction(output[index].content, instruction) };
        return output;
    }

    return [{ role: 'user', content: prependInstruction('', instruction) }, ...output];
}

function getGroqReasoningOptions(model, disableThinking) {
    const normalizedModel = String(model || '');
    if (QWEN_REASONING_MODELS.test(normalizedModel)) {
        return {
            reasoning_format: 'hidden',
            reasoning_effort: disableThinking ? 'none' : 'default',
        };
    }
    if (GPT_OSS_MODELS.test(normalizedModel)) {
        return { include_reasoning: false, reasoning_effort: 'low' };
    }
    return {};
}

module.exports = {
    buildGroqMessages,
    getGroqReasoningOptions,
    _test: { prependInstruction, normalizedInstruction },
};
