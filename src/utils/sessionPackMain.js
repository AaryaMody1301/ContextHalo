const fs = require('node:fs');
const path = require('node:path');
const storage = require('../storage');

const SESSION_PACK_MARKER = '[ContextHalo session pack]';
let installed = false;
let fetchPatched = false;
let googleGenAiPatched = false;

function sanitizeSessionPack(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const clean = (field, maxLength) => typeof field === 'string' ? field.trim().slice(0, maxLength) : '';
    return {
        title: clean(source.title, 160),
        goal: clean(source.goal, 1600),
        notes: clean(source.notes, 6000),
        clipboardText: clean(source.clipboardText, 12000),
    };
}

function formatSessionPack(value) {
    const pack = sanitizeSessionPack(value);
    const lines = [];
    if (pack.title) lines.push(`Session: ${pack.title}`);
    if (pack.goal) lines.push(`Goal: ${pack.goal}`);
    if (pack.notes) lines.push(`Context notes:\n${pack.notes}`);
    if (pack.clipboardText) lines.push(`Copied text context:\n${pack.clipboardText}`);
    return lines.length ? `${SESSION_PACK_MARKER}\n${lines.join('\n\n')}` : '';
}

function appendSessionPack(text, pack = storage.getPreferences()?.sessionPack) {
    const base = String(text || '').trim();
    if (base.includes(SESSION_PACK_MARKER)) return base;
    const formatted = formatSessionPack(pack);
    if (!formatted) return base;
    return base ? `${base}\n\n${formatted}` : formatted;
}

function appendPackToMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    const pack = storage.getPreferences()?.sessionPack;
    if (!formatSessionPack(pack)) return messages;

    let updated = false;
    const next = messages.map(message => {
        if (updated || !message || message.role !== 'system' || typeof message.content !== 'string') return message;
        updated = true;
        return { ...message, content: appendSessionPack(message.content, pack) };
    });
    if (!updated) next.unshift({ role: 'system', content: appendSessionPack('', pack) });
    return next;
}

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

function patchProviderFetch() {
    if (fetchPatched || typeof global.fetch !== 'function') return;
    const previousFetch = global.fetch.bind(global);
    global.fetch = (input, init = {}) => {
        const url = requestUrl(input);
        if (!isChatRequest(url) || typeof init.body !== 'string') return previousFetch(input, init);
        try {
            const body = JSON.parse(init.body);
            if (Array.isArray(body.messages)) body.messages = appendPackToMessages(body.messages);
            return previousFetch(input, { ...init, body: JSON.stringify(body) });
        } catch {
            return previousFetch(input, init);
        }
    };
    fetchPatched = true;
}

function appendPackToLiveInstruction(systemInstruction) {
    const pack = storage.getPreferences()?.sessionPack;
    if (!formatSessionPack(pack)) return systemInstruction;

    if (typeof systemInstruction === 'string') return appendSessionPack(systemInstruction, pack);
    if (systemInstruction && typeof systemInstruction === 'object') {
        const parts = Array.isArray(systemInstruction.parts) ? systemInstruction.parts.map(part => ({ ...part })) : [];
        const textIndex = parts.findIndex(part => typeof part?.text === 'string');
        if (textIndex >= 0) parts[textIndex].text = appendSessionPack(parts[textIndex].text, pack);
        else parts.push({ text: appendSessionPack('', pack) });
        return { ...systemInstruction, parts };
    }
    return { parts: [{ text: appendSessionPack('', pack) }] };
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

function patchGeminiLive() {
    if (googleGenAiPatched) return;
    try {
        const genai = require('@google/genai');
        const CurrentGoogleGenAI = genai.GoogleGenAI;
        if (!CurrentGoogleGenAI || CurrentGoogleGenAI.__sessionPackPatched) {
            googleGenAiPatched = true;
            return;
        }

        class SessionPackGoogleGenAI extends CurrentGoogleGenAI {
            constructor(options) {
                super(options);
                const live = this.live;
                const originalConnect = live?.connect?.bind(live);
                if (!originalConnect) return;
                live.connect = params => {
                    const config = {
                        ...(params?.config || {}),
                        systemInstruction: appendPackToLiveInstruction(params?.config?.systemInstruction),
                    };
                    return originalConnect({ ...params, config });
                };
            }
        }

        Object.defineProperty(SessionPackGoogleGenAI, '__sessionPackPatched', { value: true });
        if (!replaceGoogleGenAiExport(genai, SessionPackGoogleGenAI)) {
            throw new Error('The @google/genai CommonJS export could not be wrapped for session packs');
        }
        googleGenAiPatched = true;
    } catch (error) {
        console.warn('Could not install Gemini session pack bridge:', error.message);
    }
}

function patchSessionStorage() {
    if (storage.saveSession.__sessionPackPatched) return;
    const previousSaveSession = storage.saveSession.bind(storage);
    const wrapped = (sessionId, data = {}) => {
        const previous = storage.getSession(sessionId) || {};
        const hasIncoming = Object.prototype.hasOwnProperty.call(data, 'sessionPack');
        const pack = sanitizeSessionPack(hasIncoming ? data.sessionPack : previous.sessionPack);
        const result = previousSaveSession(sessionId, data);
        if (!result) return result;

        if (hasIncoming || previous.sessionPack) {
            try {
                const session = storage.getSession(sessionId) || { sessionId };
                session.sessionPack = pack;
                const historyPath = path.join(storage.getConfigDir(), 'history', `${sessionId}.json`);
                fs.writeFileSync(historyPath, JSON.stringify(session, null, 2), 'utf8');
            } catch (error) {
                console.error('Could not persist session pack:', error.message);
                return false;
            }
        }
        return true;
    };
    Object.defineProperty(wrapped, '__sessionPackPatched', { value: true });
    storage.saveSession = wrapped;
}

function installSessionPackMain() {
    if (installed) return;
    patchSessionStorage();
    patchProviderFetch();
    patchGeminiLive();
    installed = true;
}

module.exports = {
    SESSION_PACK_MARKER,
    sanitizeSessionPack,
    formatSessionPack,
    appendSessionPack,
    installSessionPackMain,
};
