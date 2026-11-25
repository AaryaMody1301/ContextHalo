const storage = require('../storage');

const SESSION_PACK_MARKER = '[ContextHalo session pack]';

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

function appendPackToMessages(messages, scope, preferences) {
    if (!Array.isArray(messages)) return messages;
    const pack = getProviderSessionPack(scope, preferences);
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

module.exports = {
    SESSION_PACK_MARKER,
    sanitizeSessionPack,
    formatSessionPack,
    appendSessionPack,
    getProviderSessionPack,
    appendPackToMessages,
};
