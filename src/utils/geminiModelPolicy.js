const GEMINI_MODEL_POLICY = Object.freeze({
    'gemini-3.8-flash': Object.freeze({
        lifecycle: 'stable',
        route: 'generate',
        roles: Object.freeze(['text', 'screen']),
        inputs: Object.freeze(['text', 'image', 'video', 'audio', 'pdf']),
        outputs: Object.freeze(['text']),
        search: true,
        live: false,
        thinkingLevels: Object.freeze(['low', 'medium', 'high']),
        defaultThinking: 'medium',
        inputTokenLimit: 1048576,
        outputTokenLimit: 65536,
        contextHaloCompatibility: 'supported',
    }),
    'gemini-3.7-flash': Object.freeze({
        lifecycle: 'stable',
        route: 'generate',
        roles: Object.freeze(['text', 'screen']),
        inputs: Object.freeze(['text', 'image', 'video', 'audio', 'pdf']),
        outputs: Object.freeze(['text']),
        search: true,
        live: false,
        thinkingLevels: Object.freeze(['low', 'medium', 'high']),
        defaultThinking: 'medium',
        inputTokenLimit: 1048576,
        outputTokenLimit: 65536,
        contextHaloCompatibility: 'supported',
    }),
    'gemini-3.6-flash': Object.freeze({
        lifecycle: 'stable',
        route: 'generate',
        roles: Object.freeze(['text', 'screen']),
        inputs: Object.freeze(['text', 'image', 'video', 'audio', 'pdf']),
        outputs: Object.freeze(['text']),
        search: true,
        live: false,
        thinkingLevels: Object.freeze(['minimal', 'low', 'medium', 'high']),
        defaultThinking: 'medium',
        inputTokenLimit: 1048576,
        outputTokenLimit: 65536,
        contextHaloCompatibility: 'supported',
    }),
    'gemini-3.5-flash': Object.freeze({
        lifecycle: 'stable',
        route: 'generate',
        roles: Object.freeze(['text', 'screen']),
        inputs: Object.freeze(['text', 'image', 'video', 'audio', 'pdf']),
        outputs: Object.freeze(['text']),
        search: true,
        live: false,
        thinkingLevels: Object.freeze(['minimal', 'low', 'medium', 'high']),
        defaultThinking: 'medium',
        inputTokenLimit: 1048576,
        outputTokenLimit: 65536,
        contextHaloCompatibility: 'supported',
    }),
    'gemini-3.5-flash-lite': Object.freeze({
        lifecycle: 'stable',
        route: 'generate',
        roles: Object.freeze(['text', 'screen']),
        inputs: Object.freeze(['text', 'image', 'video', 'audio', 'pdf']),
        outputs: Object.freeze(['text']),
        search: true,
        live: false,
        thinkingLevels: Object.freeze(['minimal', 'low', 'medium', 'high']),
        defaultThinking: 'minimal',
        inputTokenLimit: 1048576,
        outputTokenLimit: 65536,
        contextHaloCompatibility: 'supported',
    }),
    'gemini-3.1-flash-lite': Object.freeze({
        lifecycle: 'stable',
        route: 'generate',
        roles: Object.freeze(['text', 'screen']),
        inputs: Object.freeze(['text', 'image', 'video', 'audio', 'pdf']),
        outputs: Object.freeze(['text']),
        search: true,
        live: false,
        thinkingLevels: Object.freeze(['minimal', 'low', 'medium', 'high']),
        defaultThinking: 'minimal',
        inputTokenLimit: 1048576,
        outputTokenLimit: 65536,
        contextHaloCompatibility: 'supported',
    }),
    'gemini-3.8-live': Object.freeze({
        lifecycle: 'stable',
        route: 'live',
        roles: Object.freeze(['live']),
        inputs: Object.freeze(['text', 'image', 'audio', 'video']),
        outputs: Object.freeze(['text', 'audio']),
        search: true,
        live: true,
        thinkingLevels: Object.freeze([]),
        defaultThinking: 'interleaved-fixed',
        inputTokenLimit: 131072,
        outputTokenLimit: 65536,
        contextHaloCompatibility: 'supported',
    }),
    'gemini-3.8-live-extended-thinking': Object.freeze({
        lifecycle: 'stable',
        route: 'live',
        roles: Object.freeze(['live']),
        inputs: Object.freeze(['text', 'image', 'audio', 'video']),
        outputs: Object.freeze(['text', 'audio']),
        search: true,
        live: true,
        thinkingLevels: Object.freeze(['low', 'medium', 'high']),
        inputTokenLimit: 131072,
        outputTokenLimit: 65536,
        requiresInteractionStatus: true,
        asyncFunctionsOnly: true,
        contextHaloCompatibility: 'mapped-not-selectable',
        compatibilityReason: 'Requires interactionStatus lifecycle handling; turnComplete alone does not mean the interaction is idle.',
    }),
});

const GEMINI_SCREEN_MODEL_IDS = Object.freeze(Object.entries(GEMINI_MODEL_POLICY)
    .filter(([, policy]) => policy.route === 'generate' && policy.roles.includes('screen')
        && policy.lifecycle === 'stable' && policy.contextHaloCompatibility === 'supported')
    .map(([id]) => id));

const GEMINI_LIVE_SELECTABLE_IDS = Object.freeze(Object.entries(GEMINI_MODEL_POLICY)
    .filter(([, policy]) => policy.route === 'live' && policy.lifecycle === 'stable'
        && policy.contextHaloCompatibility === 'supported')
    .map(([id]) => id));

const GEMINI_LIVE_MAPPED_IDS = Object.freeze(Object.entries(GEMINI_MODEL_POLICY)
    .filter(([, policy]) => policy.route === 'live' && policy.lifecycle === 'stable')
    .map(([id]) => id));

function normalizeGeminiModelId(value) {
    return String(value || '').replace(/^models\//, '').trim().toLowerCase();
}

function geminiModelPolicy(model) {
    return GEMINI_MODEL_POLICY[normalizeGeminiModelId(model)] || null;
}

function geminiCapabilityLabel(model) {
    const policy = geminiModelPolicy(model);
    if (!policy) return '';
    if (policy.route === 'live') {
        if (policy.contextHaloCompatibility !== 'supported') {
            return 'Stable · Live audio · Search · Extended Thinking mapped, not enabled';
        }
        return 'Stable · Live audio · Search · fixed interleaved thinking';
    }
    const thinking = policy.thinkingLevels.length ? `Thinking ${policy.thinkingLevels.join('/')}` : 'Thinking unavailable';
    return `Stable · Text/Image · Search · ${thinking}`;
}

function screenThinkingConfigForModel(model) {
    const policy = geminiModelPolicy(model);
    if (!policy || policy.route !== 'generate' || !policy.roles.includes('screen') || !policy.thinkingLevels.includes('low')) return {};
    return { thinkingConfig: { thinkingLevel: 'low' } };
}

module.exports = {
    GEMINI_MODEL_POLICY,
    GEMINI_SCREEN_MODEL_IDS,
    GEMINI_LIVE_SELECTABLE_IDS,
    GEMINI_LIVE_MAPPED_IDS,
    normalizeGeminiModelId,
    geminiModelPolicy,
    geminiCapabilityLabel,
    screenThinkingConfigForModel,
};
