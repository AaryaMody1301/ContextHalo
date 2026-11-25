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

function getProviderSessionPack(scope, preferences = storage.getPreferences()) {
    const pack = sanitizeSessionPack(preferences?.sessionPack);
    if (scope !== 'local' && preferences?.cloudClipboardEnabled !== true) pack.clipboardText = '';
    return pack;
}

function appendSessionPack(text, pack = getProviderSessionPack('cloud')) {
    const base = String(text || '').trim();
    if (base.includes(SESSION_PACK_MARKER)) return base;
    const formatted = formatSessionPack(pack);
    if (!formatted) return base;
    return base ? `${base}\n\n${formatted}` : formatted;
}

function appendPackToMessages(messages, scope) {
    if (!Array.isArray(messages)) return messages;
    const pack = getProviderSessionPack(scope);
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

function chatRequestScope(input) {
    const url = requestUrl(input);
    if (!url || !url.pathname.endsWith('/v1/chat/completions')) return null;
    if (url.protocol === 'https:' && ['api.groq.com', 'api.mistral.ai'].includes(url.hostname)) return 'cloud';
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) return 'local';
    return null;
}

function patchProviderFetch() {
    if (fetchPatched || typeof global.fetch !== 'function') return;
    const previousFetch = global.fetch.bind(global);
    global.fetch = (input, init = {}) => {
        const scope = chatRequestScope(input);
        if (scope && typeof init.body === 'string') {
            try {
                const body = JSON.parse(init.body);
                const messages = appendPackToMessages(body.messages, scope);
                if (messages !== body.messages) init = { ...init, redirect: 'error', body: JSON.stringify({ ...body, messages }) };
            } catch {
                // Send the original request if optional context could not be added.
            }
        }
        return previousFetch(input, init);
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
    getProviderSessionPack,
    chatRequestScope,
    installSessionPackMain,
};
