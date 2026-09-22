const GROUNDED_HISTORY_RETENTION_MS = 2 * 365 * 24 * 60 * 60 * 1000;

function timestampFor(entry, now) {
    const value = Number(entry?.groundedAt ?? entry?.timestamp);
    return Number.isFinite(value) && value > 0 ? value : now;
}

function sanitizeConversationEntry(entry, now = Date.now()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const grounded = entry.grounded === true || Boolean(entry.grounding);
    const groundedAt = grounded ? timestampFor(entry, now) : null;
    const expired = grounded && now - groundedAt > GROUNDED_HISTORY_RETENTION_MS;
    const output = { ...entry };
    delete output.grounding;
    if (grounded) {
        output.grounded = true;
        output.groundedAt = groundedAt;
    } else {
        delete output.grounded;
        delete output.groundedAt;
    }
    if (expired) {
        output.ai_response = '';
        output.groundedExpired = true;
    } else {
        delete output.groundedExpired;
    }
    return output;
}

function sanitizeScreenEntry(entry, now = Date.now()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const grounded = entry.grounded === true || Boolean(entry.grounding);
    const groundedAt = grounded ? timestampFor(entry, now) : null;
    const expired = grounded && now - groundedAt > GROUNDED_HISTORY_RETENTION_MS;
    const output = { ...entry };
    delete output.grounding;
    if (grounded) {
        output.grounded = true;
        output.groundedAt = groundedAt;
    } else {
        delete output.grounded;
        delete output.groundedAt;
    }
    if (expired) {
        output.response = '';
        output.groundedExpired = true;
    } else {
        delete output.groundedExpired;
    }
    return output;
}

function sanitizeConversationHistory(value, now = Date.now()) {
    return Array.isArray(value) ? value.map(entry => sanitizeConversationEntry(entry, now)).filter(Boolean) : [];
}

function sanitizeScreenAnalysisHistory(value, now = Date.now()) {
    return Array.isArray(value) ? value.map(entry => sanitizeScreenEntry(entry, now)).filter(Boolean) : [];
}

function sanitizeSessionProviderHistory(session, now = Date.now()) {
    if (!session || typeof session !== 'object' || Array.isArray(session)) return { session, changed: false };
    const conversationHistory = sanitizeConversationHistory(session.conversationHistory, now);
    const screenAnalysisHistory = sanitizeScreenAnalysisHistory(session.screenAnalysisHistory, now);
    const next = { ...session, conversationHistory, screenAnalysisHistory };
    const changed = JSON.stringify(conversationHistory) !== JSON.stringify(session.conversationHistory || [])
        || JSON.stringify(screenAnalysisHistory) !== JSON.stringify(session.screenAnalysisHistory || []);
    return { session: next, changed };
}

module.exports = {
    GROUNDED_HISTORY_RETENTION_MS,
    sanitizeConversationEntry,
    sanitizeScreenEntry,
    sanitizeConversationHistory,
    sanitizeScreenAnalysisHistory,
    sanitizeSessionProviderHistory,
};
