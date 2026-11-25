const { requestIsCurrent } = require('./sessionRequests');
const {
    applyResponseModeInstruction,
    normalizeTranscriptEvent,
} = require('./realtimeContextCore');

function emitLiveTranscript(payload) {
    if (!payload?.sessionId || !requestIsCurrent()) return;
    const event = normalizeTranscriptEvent(payload);
    if (!event) return;

    const { BrowserWindow } = require('electron');
    for (const window of BrowserWindow.getAllWindows()) {
        if (!window || window.isDestroyed()) continue;
        window.webContents.send('live-transcript', { ...event, sessionId: payload.sessionId });
    }
}

function observeTranscriptResponse(response, provider, sessionId, getActiveSessionId) {
    if (!sessionId || sessionId !== getActiveSessionId() || !response?.ok || typeof response.clone !== 'function') return;

    try {
        const copy = response.clone();
        void copy.json().then(result => {
            if (sessionId !== getActiveSessionId()) return;
            const text = typeof result?.text === 'string' ? result.text : '';
            emitLiveTranscript({ provider, text, final: true, timestamp: Date.now(), sessionId });
        }).catch(() => {});
    } catch {}
}

function extractGeminiTranscript(message, field) {
    const transcription = message?.serverContent?.[field];
    if (!transcription) return '';
    if (typeof transcription.text === 'string') return transcription.text.trim();
    if (!Array.isArray(transcription.results)) return '';
    return transcription.results
        .map(result => result?.transcript || result?.text || '')
        .filter(Boolean)
        .join(' ')
        .trim();
}

function tuneLiveSystemInstruction(systemInstruction, mode) {
    if (typeof systemInstruction === 'string') {
        return applyResponseModeInstruction(systemInstruction, mode);
    }

    if (systemInstruction && typeof systemInstruction === 'object') {
        const parts = Array.isArray(systemInstruction.parts) ? systemInstruction.parts.map(part => ({ ...part })) : [];
        const textIndex = parts.findIndex(part => typeof part?.text === 'string');
        if (textIndex >= 0) {
            parts[textIndex].text = applyResponseModeInstruction(parts[textIndex].text, mode);
        } else {
            parts.push({ text: applyResponseModeInstruction('', mode) });
        }
        return { ...systemInstruction, parts };
    }

    return { parts: [{ text: applyResponseModeInstruction('', mode) }] };
}

const { sanitizeTranscriptHistory, sanitizeMarkers } = require('./sessionData');

module.exports = {
    observeTranscriptResponse,
    emitLiveTranscript,
    extractGeminiTranscript,
    tuneLiveSystemInstruction,
    sanitizeTranscriptHistory,
    sanitizeMarkers,
};
