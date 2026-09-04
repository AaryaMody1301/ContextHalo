const RESPONSE_MODES = Object.freeze({
    instant: Object.freeze({
        id: 'instant',
        label: 'Instant',
        maxTokens: 768,
        instruction: 'Respond with the useful answer immediately. Prefer one to three concise bullets, lead with the answer, and avoid background detail unless it is essential.',
    }),
    balanced: Object.freeze({
        id: 'balanced',
        label: 'Balanced',
        maxTokens: 2048,
        instruction: 'Give a concise but complete answer. Lead with the recommendation or answer, then include only the reasoning and details that materially help.',
    }),
    detailed: Object.freeze({
        id: 'detailed',
        label: 'Detailed',
        maxTokens: 4096,
        instruction: 'Give a thorough answer with the important reasoning, tradeoffs, examples, and implementation details while staying organized and relevant.',
    }),
});

const RESPONSE_MODE_MARKER = '[ContextHalo response mode:';
const PROVIDERS = new Set(['gemini', 'groq', 'local']);

function normalizeResponseMode(value) {
    return Object.prototype.hasOwnProperty.call(RESPONSE_MODES, value) ? value : 'balanced';
}

function getResponseMode(value) {
    return RESPONSE_MODES[normalizeResponseMode(value)];
}

function applyResponseModeInstruction(text, value) {
    const base = String(text || '').trim();
    if (base.includes(RESPONSE_MODE_MARKER)) return base;
    const mode = getResponseMode(value);
    const instruction = `${RESPONSE_MODE_MARKER} ${mode.id}] ${mode.instruction}`;
    return base ? `${base}\n\n${instruction}` : instruction;
}

function tuneChatRequestBody(body, value) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return body;

    const mode = getResponseMode(value);
    const next = { ...body };
    if (Array.isArray(body.messages)) {
        let foundSystem = false;
        next.messages = body.messages.map(message => {
            if (!message || typeof message !== 'object' || message.role !== 'system' || typeof message.content !== 'string') return message;
            if (foundSystem) return message;
            foundSystem = true;
            return { ...message, content: applyResponseModeInstruction(message.content, mode.id) };
        });
        if (!foundSystem) {
            next.messages = [{ role: 'system', content: applyResponseModeInstruction('', mode.id) }, ...next.messages];
        }
    }

    if (Object.prototype.hasOwnProperty.call(next, 'max_completion_tokens')) {
        const current = Number(next.max_completion_tokens) || mode.maxTokens;
        next.max_completion_tokens = mode.id === 'instant'
            ? Math.min(current, mode.maxTokens)
            : mode.id === 'detailed'
                ? Math.max(current, mode.maxTokens)
                : current;
    }

    if (Object.prototype.hasOwnProperty.call(next, 'max_tokens')) {
        const current = Number(next.max_tokens) || mode.maxTokens;
        next.max_tokens = mode.id === 'instant'
            ? Math.min(current, mode.maxTokens)
            : mode.id === 'detailed'
                ? Math.max(current, mode.maxTokens)
                : current;
    }

    return next;
}

function normalizeTranscriptEvent(payload = {}) {
    const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, 8000) : '';
    if (!text) return null;

    return {
        provider: PROVIDERS.has(payload.provider) ? payload.provider : 'local',
        text,
        final: payload.final !== false,
        timestamp: Number.isFinite(Number(payload.timestamp)) ? Number(payload.timestamp) : Date.now(),
    };
}

module.exports = {
    RESPONSE_MODES,
    RESPONSE_MODE_MARKER,
    normalizeResponseMode,
    getResponseMode,
    applyResponseModeInstruction,
    tuneChatRequestBody,
    normalizeTranscriptEvent,
};
