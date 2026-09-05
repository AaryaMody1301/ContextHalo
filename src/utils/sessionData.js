const { normalizeTranscriptEvent } = require('./realtimeContextCore');
function sanitizeTranscriptHistory(value) {
    return Array.isArray(value) ? value.map(normalizeTranscriptEvent).filter(Boolean).slice(-1000) : [];
}
function sanitizeMarkers(value) {
    const types = new Set(['important', 'decision', 'action', 'question']);
    return Array.isArray(value) ? value.filter(item => item && types.has(item.type)).slice(-500).map(item => ({
        type: item.type, timestamp: Number(item.timestamp) || Date.now(),
        transcript: typeof item.transcript === 'string' ? item.transcript.slice(0, 2000) : '',
    })) : [];
}
function sanitizeSessionPack(value) {
    const source = value && typeof value === 'object' ? value : {};
    const clean = (name, limit) => typeof source[name] === 'string' ? source[name].trim().slice(0, limit) : '';
    return { title: clean('title', 160), goal: clean('goal', 1600), notes: clean('notes', 6000), clipboardText: clean('clipboardText', 12000) };
}
module.exports = { sanitizeTranscriptHistory, sanitizeMarkers, sanitizeSessionPack };
