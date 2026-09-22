const GROQ_MODEL_POLICY = Object.freeze({
    'openai/gpt-oss-120b': Object.freeze({
        lifecycle: 'production', roles: Object.freeze(['chat']), reasoning: Object.freeze(['low', 'medium', 'high']),
        contextHaloCompatibility: 'supported',
    }),
    'openai/gpt-oss-20b': Object.freeze({
        lifecycle: 'production', roles: Object.freeze(['chat']), reasoning: Object.freeze(['low', 'medium', 'high']),
        contextHaloCompatibility: 'supported',
    }),
    'whisper-large-v3-turbo': Object.freeze({
        lifecycle: 'production', roles: Object.freeze(['transcription']), contextHaloCompatibility: 'supported',
    }),
    'whisper-large-v3': Object.freeze({
        lifecycle: 'production', roles: Object.freeze(['transcription']), contextHaloCompatibility: 'supported',
    }),
    'qwen/qwen3.8-27b': Object.freeze({
        lifecycle: 'preview', roles: Object.freeze(['chat', 'vision']), reasoning: Object.freeze(['none', 'default', 'low', 'medium', 'high']),
        contextHaloCompatibility: 'preview-supported',
    }),
    'qwen/qwen3.6-27b': Object.freeze({
        lifecycle: 'deprecated-account-dependent', roles: Object.freeze(['chat', 'vision']),
        replacement: 'qwen/qwen3.8-27b', contextHaloCompatibility: 'account-dependent',
    }),
    'minimaxai/minimax-m2.7': Object.freeze({
        lifecycle: 'preview', roles: Object.freeze(['chat']), access: 'enterprise',
        contextHaloCompatibility: 'advanced-preview',
    }),
    'openai/gpt-oss-safeguard-20b': Object.freeze({
        lifecycle: 'preview', roles: Object.freeze(['safety']), contextHaloCompatibility: 'not-chat-default',
    }),
    'canopylabs/orpheus-arabic-saudi': Object.freeze({
        lifecycle: 'preview', roles: Object.freeze(['tts']), contextHaloCompatibility: 'not-chat',
    }),
    'canopylabs/orpheus-v1-english': Object.freeze({
        lifecycle: 'preview', roles: Object.freeze(['tts']), contextHaloCompatibility: 'not-chat',
    }),
    'meta-llama/llama-prompt-guard-2-22m': Object.freeze({
        lifecycle: 'preview', roles: Object.freeze(['safety']), contextHaloCompatibility: 'not-chat-default',
    }),
    'meta-llama/llama-prompt-guard-2-86m': Object.freeze({
        lifecycle: 'preview', roles: Object.freeze(['safety']), contextHaloCompatibility: 'not-chat-default',
    }),
    'llama-3.1-8b-instant': Object.freeze({
        lifecycle: 'deprecated-account-dependent', roles: Object.freeze(['chat']), replacement: 'openai/gpt-oss-20b',
        contextHaloCompatibility: 'account-dependent',
    }),
    'llama-3.3-70b-versatile': Object.freeze({
        lifecycle: 'deprecated-account-dependent', roles: Object.freeze(['chat']), replacement: 'openai/gpt-oss-120b',
        contextHaloCompatibility: 'account-dependent',
    }),
    'groq/compound': Object.freeze({ lifecycle: 'retired', roles: Object.freeze(['system']), contextHaloCompatibility: 'retired' }),
    'groq/compound-mini': Object.freeze({ lifecycle: 'retired', roles: Object.freeze(['system']), contextHaloCompatibility: 'retired' }),
});

function normalizeGroqModelId(value) {
    return String(value || '').trim().toLowerCase();
}

function groqModelPolicy(model) {
    return GROQ_MODEL_POLICY[normalizeGroqModelId(model)] || null;
}

function groqCapabilityLabel(model) {
    const policy = groqModelPolicy(model);
    if (!policy) return 'Lifecycle not audited';
    if (policy.lifecycle === 'production') return 'Production';
    if (policy.lifecycle === 'preview') return policy.access === 'enterprise' ? 'Preview · Enterprise' : 'Preview';
    if (policy.lifecycle === 'deprecated-account-dependent') {
        return policy.replacement ? `Deprecated for some tiers · replacement ${policy.replacement}` : 'Deprecated for some tiers';
    }
    if (policy.lifecycle === 'retired') return 'Retired';
    return policy.lifecycle;
}

module.exports = { GROQ_MODEL_POLICY, normalizeGroqModelId, groqModelPolicy, groqCapabilityLabel };
