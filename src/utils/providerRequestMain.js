const storage = require('../storage');
const { formatGroqMessages } = require('./groqRequestPolicy');
const { augmentMessages } = require('./knowledgeRagMain');
const { appendPackToMessages } = require('./sessionPackMain');
const { tuneChatRequestBody } = require('./realtimeContextCore');
const { observeTranscriptResponse } = require('./realtimeContextMain');

function matchProviderEndpoint(input) {
    let url;
    try {
        url = new URL(input?.url || String(input));
    } catch {
        return null;
    }

    const { origin, protocol, hostname, pathname } = url;
    if (origin === 'https://api.groq.com') {
        if (pathname === '/openai/v1/chat/completions') return 'groq-chat';
        if (pathname === '/openai/v1/audio/transcriptions') return 'groq-transcription';
    }
    if (origin === 'https://api.mistral.ai' && pathname === '/v1/chat/completions') return 'mistral-chat';
    if (origin === 'https://generativelanguage.googleapis.com'
        && /^\/v1(?:beta|alpha)?\/models\/[^/]+:(?:generateContent|streamGenerateContent)$/.test(pathname)) return 'gemini-http';
    if (protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
        if (pathname === '/v1/chat/completions') return 'local-chat';
        if (/^(?:\/[a-f0-9]{48})?\/inference$/.test(pathname)) return 'local-whisper';
        if (/^(?:\/[a-f0-9]{48})?\/health$/.test(pathname)) return 'local-health';
    }
    return null;
}

function inspectProviderRequest(input, init) {
    const endpoint = matchProviderEndpoint(input);
    if (!endpoint?.endsWith('-chat')) return { kind: endpoint };

    let body;
    if (typeof init?.body === 'string') {
        try {
            body = JSON.parse(init.body);
        } catch {
            // Let the provider report malformed request JSON.
        }
    }
    const image = Array.isArray(body?.messages) && body.messages.some(message =>
        Array.isArray(message?.content) && message.content.some(part => part?.type === 'image_url'));
    return { kind: endpoint.replace('-chat', image ? '-image' : '-text'), body };
}

function classifyProviderRequest(input, init) {
    return inspectProviderRequest(input, init).kind;
}

function composeChatRequest(kind, init, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return init;

    const scope = kind.startsWith('local-') ? 'local' : 'cloud';
    let messages = body.messages;
    const preferences = storage.getPreferences() || {};
    try {
        messages = augmentMessages(messages, scope, preferences);
    } catch {
        // Knowledge lookup is optional. Continue with the session pack and response style.
    }
    messages = appendPackToMessages(messages, scope, preferences);
    const request = tuneChatRequestBody({ ...body, messages }, preferences.responseMode);

    if (kind.startsWith('mistral-')) request.max_tokens = Math.min(Number(request.max_tokens) || 2048, 2048);
    if (kind.startsWith('groq-') && Array.isArray(request.messages)) request.messages = formatGroqMessages(request.model, request.messages);
    if (kind === 'groq-text' && String(request.model || '').startsWith('openai/gpt-oss-')) {
        request.reasoning_effort ??= 'low';
        request.include_reasoning = false;
        request.max_completion_tokens = Math.max(Number(request.max_completion_tokens) || 0, 4096);
    }

    return {
        ...init,
        ...(messages === body.messages ? {} : { redirect: 'error' }),
        body: JSON.stringify(request),
    };
}

function createProviderFetch(send, getActiveSessionId = () => null) {
    return async (input, init = {}) => {
        const { kind, body } = inspectProviderRequest(input, init);
        const requestInit = composeChatRequest(kind, init, body);
        const transcription = kind === 'groq-transcription' ? 'groq' : kind === 'local-whisper' ? 'local' : null;
        if (!transcription) return send(input, requestInit, kind);

        const sessionId = getActiveSessionId();
        const response = await send(input, requestInit, kind);
        observeTranscriptResponse(response, transcription, sessionId, getActiveSessionId);
        return response;
    };
}

module.exports = { classifyProviderRequest, createProviderFetch };
