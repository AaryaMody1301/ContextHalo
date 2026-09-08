const storage = require('../storage');

const SESSION_PACK_MARKER = '[ContextHalo session pack]';
let installed = false;
let fetchPatched = false;

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

function installSessionPackMain() {
    if (installed) return;
    patchProviderFetch();
    installed = true;
}

module.exports = {
    SESSION_PACK_MARKER,
    sanitizeSessionPack,
    formatSessionPack,
    appendSessionPack,
    installSessionPackMain,
};
