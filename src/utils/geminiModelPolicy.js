function gemini4GeneratePolicy(thinkingLevels, defaultThinking, paidOnly = false) {
    return Object.freeze({
        lifecycle: 'stable',
        route: 'generate',
        roles: Object.freeze(['text', 'screen']),
        inputs: Object.freeze(['text', 'image', 'video', 'audio', 'pdf']),
        outputs: Object.freeze(['text']),
        search: true,
        live: false,
        thinkingLevels: Object.freeze(thinkingLevels),
        defaultThinking,
        paidOnly,
        inputTokenLimit: 1048576,
        outputTokenLimit: 65536,
        contextHaloCompatibility: 'supported',
    });
}

const GEMINI_MODEL_POLICY = Object.freeze({
    'gemini-4-hydrogen': gemini4GeneratePolicy(['low', 'medium', 'high', 'xhigh'], 'high'),
    'gemini-4-carbon': gemini4GeneratePolicy(['low', 'medium', 'high'], 'medium', true),
    'gemini-4-neon': gemini4GeneratePolicy(['low', 'medium', 'high', 'xhigh'], 'high', true),
    'gemini-4-argon': gemini4GeneratePolicy(['low', 'medium', 'high'], 'medium', true),
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
        lifecycle: 'deprecated',
        replacement: 'gemini-3.8-flash',
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
        lifecycle: 'deprecated',
        replacement: 'gemini-3.6-flash',
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
    'gemini-2.5-flash-lite': Object.freeze({
        lifecycle: 'legacy',
        route: 'generate',
        roles: Object.freeze(['text', 'screen']),
        inputs: Object.freeze(['text', 'image', 'video', 'audio', 'pdf']),
        outputs: Object.freeze(['text']),
        search: true,
        live: false,
        // This generation uses thinkingBudget. Leave the model's default in effect.
        thinkingLevels: Object.freeze([]),
        defaultThinking: 'off',
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
        contextHaloCompatibility: 'supported',
    }),
});

const GEMINI_SCREEN_MODEL_IDS = Object.freeze(Object.entries(GEMINI_MODEL_POLICY)
    .filter(([, policy]) => policy.route === 'generate' && policy.roles.includes('screen')
        && ['stable', 'legacy'].includes(policy.lifecycle) && policy.contextHaloCompatibility === 'supported')
    .map(([id]) => id));

const GEMINI_LIVE_SELECTABLE_IDS = Object.freeze(Object.entries(GEMINI_MODEL_POLICY)
    .filter(([, policy]) => policy.route === 'live' && policy.lifecycle === 'stable'
        && policy.contextHaloCompatibility === 'supported')
    .map(([id]) => id));

const GEMINI_LIVE_MAPPED_IDS = Object.freeze(Object.entries(GEMINI_MODEL_POLICY)
    .filter(([, policy]) => policy.route === 'live' && policy.lifecycle === 'stable')
    .map(([id]) => id));

function normalizeGeminiModelId(value) {
    return String(value || '').trim().toLowerCase().replace(/^models\//, '');
}

function geminiModelPolicy(model) {
    return GEMINI_MODEL_POLICY[normalizeGeminiModelId(model)] || null;
}

function geminiModelRouteError(model, route) {
    const id = normalizeGeminiModelId(model);
    const policy = geminiModelPolicy(id);
    if (!/^[a-z0-9][a-z0-9.-]{0,127}$/.test(id)) return 'Enter a valid Gemini model ID in Home.';
    if (route === 'live' && policy?.route === 'generate') return 'Choose a Gemini Live model for live audio. The selected model uses text and screen requests.';
    if (route === 'generate' && (policy?.route === 'live' || /^gemini.*(?:-live(?:-|$)|-native-audio)/.test(id))) {
        return 'Choose a Gemini model for text and screen analysis. The selected model uses the Live API.';
    }
    return '';
}

function geminiCapabilityLabel(model) {
    const policy = geminiModelPolicy(model);
    if (!policy) return '';
    if (policy.lifecycle === 'legacy') return 'Legacy project access · Text/Image · Search';
    if (policy.lifecycle === 'deprecated') return `Deprecated · Google routes requests to ${policy.replacement}; select a current model explicitly`;
    if (policy.route === 'live') {
        if (policy.requiresInteractionStatus) {
            return 'Stable · Live audio · Search · Extended Thinking';
        }
        return 'Stable · Live audio · Search · fixed interleaved thinking';
    }
    const thinking = policy.thinkingLevels.length ? `Thinking ${policy.thinkingLevels.join('/')}` : 'Thinking unavailable';
    return `Stable · ${policy.paidOnly ? 'Paid tier · ' : ''}Text/Image · Search · ${thinking}`;
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
    geminiModelRouteError,
    geminiCapabilityLabel,
    screenThinkingConfigForModel,
};
