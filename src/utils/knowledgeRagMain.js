const storage = require('../storage');
const { formatRetrievedContext, normalizeText } = require('./knowledgeCore');
const { getEnabledDocuments, searchKnowledge } = require('./knowledgeStore');

const KNOWLEDGE_MARKER = '[ContextHalo knowledge]';
let installed = false;
let fetchPatched = false;
let googleGenAiPatched = false;

function requestUrl(input) {
    try {
        if (typeof input === 'string' || input instanceof URL) return new URL(input.toString());
        if (input && typeof input.url === 'string') return new URL(input.url);
    } catch {}
    return null;
}

function isChatRequest(url) {
    if (!url) return false;
    if (url.hostname === 'api.groq.com' && url.pathname.includes('/chat/completions')) return true;
    return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.pathname.includes('/v1/chat/completions');
}

function messageText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .map(item => typeof item?.text === 'string' ? item.text : item?.type === 'text' && typeof item?.text === 'string' ? item.text : '')
        .filter(Boolean)
        .join('\n');
}

function lastUserQuery(messages) {
    if (!Array.isArray(messages)) return '';
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index]?.role !== 'user') continue;
        const text = normalizeText(messageText(messages[index].content), 12_000);
        if (text) return text;
    }
    return '';
}

function sessionSeed() {
    const pack = storage.getPreferences()?.sessionPack;
    if (!pack || typeof pack !== 'object') return '';
    return normalizeText([pack.goal, pack.notes, pack.clipboardText].filter(Boolean).join('\n'), 10_000);
}

function retrieveContext(query, options = {}) {
    const documents = getEnabledDocuments();
    if (!documents.length) return '';
    const effectiveQuery = normalizeText(query, 12_000) || sessionSeed();
    const results = effectiveQuery
        ? searchKnowledge(effectiveQuery, { limit: options.limit || 5, maxChars: options.maxChars || 7200 })
        : documents.slice(0, 4).flatMap(document => (document.chunks || []).slice(0, 1).map(chunk => ({
            documentId: document.id,
            title: document.title,
            sourceType: document.sourceType,
            chunkId: chunk.id,
            text: chunk.text,
            score: 0,
        })));
    return formatRetrievedContext(results, KNOWLEDGE_MARKER);
}

function appendContext(base, context) {
    const text = String(base || '').trim();
    if (!context || text.includes(KNOWLEDGE_MARKER)) return text;
    return text ? `${text}\n\n${context}` : context;
}

function augmentMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    const context = retrieveContext(lastUserQuery(messages));
    if (!context) return messages;

    let updated = false;
    const next = messages.map(message => {
        if (updated || message?.role !== 'system' || typeof message?.content !== 'string') return message;
        updated = true;
        return { ...message, content: appendContext(message.content, context) };
    });
    if (!updated) next.unshift({ role: 'system', content: context });
    return next;
}

function patchProviderFetch() {
    if (fetchPatched || typeof global.fetch !== 'function') return;
    const previousFetch = global.fetch.bind(global);
    global.fetch = (input, init = {}) => {
        const url = requestUrl(input);
        if (!isChatRequest(url) || typeof init.body !== 'string') return previousFetch(input, init);
        try {
            const body = JSON.parse(init.body);
            if (Array.isArray(body.messages)) body.messages = augmentMessages(body.messages);
            return previousFetch(input, { ...init, body: JSON.stringify(body) });
        } catch {
            return previousFetch(input, init);
        }
    };
    fetchPatched = true;
}

function appendContextToInstruction(systemInstruction, context) {
    if (!context) return systemInstruction;
    if (typeof systemInstruction === 'string') return appendContext(systemInstruction, context);
    if (systemInstruction && typeof systemInstruction === 'object') {
        const parts = Array.isArray(systemInstruction.parts) ? systemInstruction.parts.map(part => ({ ...part })) : [];
        const textIndex = parts.findIndex(part => typeof part?.text === 'string');
        if (textIndex >= 0) parts[textIndex].text = appendContext(parts[textIndex].text, context);
        else parts.push({ text: context });
        return { ...systemInstruction, parts };
    }
    return { parts: [{ text: context }] };
}

function extractContentsText(contents) {
    if (typeof contents === 'string') return contents;
    if (!Array.isArray(contents)) return '';
    const text = [];
    for (const content of contents) {
        if (typeof content === 'string') text.push(content);
        if (typeof content?.text === 'string') text.push(content.text);
        for (const part of Array.isArray(content?.parts) ? content.parts : []) {
            if (typeof part?.text === 'string') text.push(part.text);
        }
    }
    return normalizeText(text.join('\n'), 12_000);
}

function augmentGenerateParams(params = {}) {
    const context = retrieveContext(extractContentsText(params.contents), { limit: 4, maxChars: 6500 });
    if (!context) return params;
    return {
        ...params,
        config: {
            ...(params.config || {}),
            systemInstruction: appendContextToInstruction(params.config?.systemInstruction, context),
        },
    };
}

function augmentLiveTextPayload(payload) {
    if (!payload || typeof payload !== 'object' || typeof payload.text !== 'string') return payload;
    const question = normalizeText(payload.text, 12_000);
    const context = retrieveContext(question, { limit: 5, maxChars: 7000 });
    if (!context) return payload;
    return {
        ...payload,
        text: `${question}\n\n${context}`,
    };
}

function replaceGoogleGenAiExport(genai, PatchedGoogleGenAI) {
    try { genai.GoogleGenAI = PatchedGoogleGenAI; } catch {}
    if (genai.GoogleGenAI === PatchedGoogleGenAI) return true;
    try {
        const modulePath = require.resolve('@google/genai');
        const cachedModule = require.cache[modulePath];
        if (!cachedModule) return false;
        cachedModule.exports = { ...genai, GoogleGenAI: PatchedGoogleGenAI };
        return require('@google/genai').GoogleGenAI === PatchedGoogleGenAI;
    } catch {
        return false;
    }
}

function patchGoogleGenAi() {
    if (googleGenAiPatched) return;
    try {
        const genai = require('@google/genai');
        const CurrentGoogleGenAI = genai.GoogleGenAI;
        if (!CurrentGoogleGenAI || CurrentGoogleGenAI.__knowledgeRagPatched) {
            googleGenAiPatched = true;
            return;
        }

        class KnowledgeRagGoogleGenAI extends CurrentGoogleGenAI {
            constructor(options) {
                super(options);

                const models = this.models;
                if (models?.generateContent) {
                    const originalGenerateContent = models.generateContent.bind(models);
                    models.generateContent = params => originalGenerateContent(augmentGenerateParams(params));
                }
                if (models?.generateContentStream) {
                    const originalGenerateContentStream = models.generateContentStream.bind(models);
                    models.generateContentStream = params => originalGenerateContentStream(augmentGenerateParams(params));
                }

                const live = this.live;
                const originalConnect = live?.connect?.bind(live);
                if (originalConnect) {
                    live.connect = async params => {
                        const context = retrieveContext(sessionSeed(), { limit: 4, maxChars: 6500 });
                        const config = context
                            ? {
                                  ...(params?.config || {}),
                                  systemInstruction: appendContextToInstruction(params?.config?.systemInstruction, context),
                              }
                            : params?.config;
                        const liveSession = await originalConnect({ ...params, config });
                        const originalSend = liveSession?.sendRealtimeInput?.bind(liveSession);
                        if (originalSend && !liveSession.__knowledgeRagPatched) {
                            liveSession.sendRealtimeInput = payload => originalSend(augmentLiveTextPayload(payload));
                            Object.defineProperty(liveSession, '__knowledgeRagPatched', { value: true });
                        }
                        return liveSession;
                    };
                }
            }
        }

        Object.defineProperty(KnowledgeRagGoogleGenAI, '__knowledgeRagPatched', { value: true });
        if (!replaceGoogleGenAiExport(genai, KnowledgeRagGoogleGenAI)) {
            throw new Error('The @google/genai CommonJS export could not be wrapped for local knowledge retrieval');
        }
        googleGenAiPatched = true;
    } catch (error) {
        console.warn('Could not install local knowledge provider bridge:', error.message);
    }
}

function installKnowledgeRagMain() {
    if (installed) return;
    patchProviderFetch();
    patchGoogleGenAi();
    installed = true;
}

module.exports = {
    KNOWLEDGE_MARKER,
    installKnowledgeRagMain,
    retrieveContext,
    augmentMessages,
    augmentGenerateParams,
    augmentLiveTextPayload,
};
