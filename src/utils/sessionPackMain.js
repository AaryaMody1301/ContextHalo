const storage = require('../storage');

const SESSION_PACK_MARKER = '[ContextHalo session pack]';
let installed = false;
let fetchPatched = false;
let googleGenAiPatched = false;

const { sanitizeSessionPack } = require('./sessionData');

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

function installSessionPackMain() {
    if (installed) return;
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
