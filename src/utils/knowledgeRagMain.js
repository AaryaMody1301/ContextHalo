const storage = require('../storage');
const { formatRetrievedContext, normalizeText, retrieveChunks } = require('./knowledgeCore');
const { getEnabledDocuments } = require('./knowledgeStore');

const { chatRequestScope, getProviderSessionPack } = require('./sessionPackMain');

const KNOWLEDGE_MARKER = '[ContextHalo knowledge]';
let installed = false;
let fetchPatched = false;

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

function retrieveContext(query, options = {}) {
    const preferences = storage.getPreferences();
    const scope = options.scope || 'cloud';
    if (scope !== 'local' && preferences?.cloudKnowledgeEnabled !== true) return '';
    const documents = getEnabledDocuments();
    if (!documents.length) return '';
    const pack = getProviderSessionPack(scope, preferences);
    const seed = normalizeText([pack.goal, pack.notes, pack.clipboardText].filter(Boolean).join('\n'), 10_000);
    const effectiveQuery = normalizeText(query, 12_000) || seed;
    const results = effectiveQuery
        ? retrieveChunks(documents, effectiveQuery, { limit: options.limit || 5, maxChars: options.maxChars || 7200 })
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

function augmentMessages(messages, scope) {
    if (!Array.isArray(messages)) return messages;
    const context = retrieveContext(lastUserQuery(messages), { scope });
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
        const scope = chatRequestScope(input);
        if (scope && typeof init.body === 'string') {
            try {
                const body = JSON.parse(init.body);
                const messages = augmentMessages(body.messages, scope);
                if (messages !== body.messages) init = { ...init, redirect: 'error', body: JSON.stringify({ ...body, messages }) };
            } catch {
                // Send the original request if optional context could not be added.
            }
        }
        return previousFetch(input, init);
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
    const currentQuestion = contents.findLast(content => content?.role === 'user');
    const text = [];
    for (const content of currentQuestion ? [currentQuestion] : contents) {
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

function installKnowledgeRagMain() {
    if (installed) return;
    patchProviderFetch();
    installed = true;
}

module.exports = {
    KNOWLEDGE_MARKER,
    installKnowledgeRagMain,
    retrieveContext,
    augmentMessages,
    augmentGenerateParams,
    augmentLiveTextPayload,
    appendContextToInstruction,
};
