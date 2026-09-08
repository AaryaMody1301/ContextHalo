const { ipcRenderer } = window.require('electron');

const RESPONSE_MODES = [
    { id: 'instant', label: 'Instant', description: 'Fast, 1-3 useful bullets' },
    { id: 'balanced', label: 'Balanced', description: 'Concise but complete' },
    { id: 'detailed', label: 'Detailed', description: 'More reasoning and detail' },
];
const MARKER_TYPES = [
    { id: 'important', label: 'Important', symbol: '★' },
    { id: 'decision', label: 'Decision', symbol: '◆' },
    { id: 'action', label: 'Action', symbol: '✓' },
    { id: 'question', label: 'Question', symbol: '?' },
];

let responseMode = 'balanced';
let transcriptEntries = [];
let interimTranscript = null;
let markers = [];
let currentSessionId = null;
let generation = 0;
let persistTimer = null;
let resolvingSession = null;
let error = '';
let notice = '';

function changed() { window.dispatchEvent(new CustomEvent('realtime-context-changed')); }
export function getRealtimeState() { return { responseMode, transcriptEntries, interimTranscript, markers, error, notice }; }
export async function refreshPreferences() {
    const preferences = await contextHalo.storage.getPreferences();
    responseMode = RESPONSE_MODES.some(mode => mode.id === preferences.responseMode) ? preferences.responseMode : 'balanced';
    changed();
}
export async function setResponseMode(mode) {
    if (!RESPONSE_MODES.some(item => item.id === mode)) return;
    const result = await contextHalo.storage.updatePreference('responseMode', mode);
    if (result?.success === false) throw new Error('Could not save response style.');
    responseMode = mode;
    changed();
}

function mergeByTimestamp(existing, incoming) {
    const merged = [...existing, ...incoming]
        .filter(item => item && typeof item.text === 'string' && item.text.trim())
        .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
    const output = [];
    for (const item of merged) {
        const previous = output[output.length - 1];
        if (previous && previous.provider === item.provider && previous.text === item.text && Math.abs(Number(previous.timestamp) - Number(item.timestamp)) < 2500) {
            continue;
        }
        output.push(item);
    }
    return output.slice(-1000);
}

export function resolveSessionId() {
    if (resolvingSession) return resolvingSession;
    const pending = loadSessionContext().finally(() => {
        if (resolvingSession === pending) resolvingSession = null;
    });
    resolvingSession = pending;
    return pending;
}

async function loadSessionContext() {
    const epoch = generation;
    const result = await ipcRenderer.invoke('get-current-session');
    if (epoch !== generation) return currentSessionId;
    const id = result?.success ? result.data?.sessionId : null;
    if (!id || id === currentSessionId) return id;
    clearTimeout(persistTimer);
    currentSessionId = id;
    const session = await contextHalo.storage.getSession(id);
    if (epoch !== generation || currentSessionId !== id) return currentSessionId;
    transcriptEntries = mergeByTimestamp(session?.liveTranscript || [], transcriptEntries);
    markers = Array.isArray(session?.markers) ? session.markers.slice(-500) : markers;
    changed();
    return id;
}

export async function flushSessionContext() {
    clearTimeout(persistTimer);
    const id = resolvingSession ? await resolvingSession : currentSessionId || await resolveSessionId();
    if (!id) return;
    // Snapshot before the await: an ended session must never receive the next session's transcript.
    const snapshot = { liveTranscript: [...transcriptEntries], markers: [...markers] };
    const result = await contextHalo.storage.saveSession(id, snapshot);
    if (result?.success === false) throw new Error('Could not save transcript and markers.');
    error = '';
}
function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => flushSessionContext().catch(() => {
        error = 'Transcript could not be saved. End the session to retry saving.';
        changed();
    }), 450);
}
function handleTranscript(_event, payload) {
    if (!payload || typeof payload.text !== 'string' || !payload.text.trim()) return;
    const entry = {
        provider: ['gemini', 'groq', 'local'].includes(payload.provider) ? payload.provider : 'local',
        text: payload.text.trim().slice(0, 8000), final: payload.final !== false,
        timestamp: Number(payload.timestamp) || Date.now(),
    };
    if (entry.final) {
        transcriptEntries = mergeByTimestamp(transcriptEntries, [entry]);
        interimTranscript = null;
        schedulePersist();
    } else { interimTranscript = entry; }
    changed();
}
export async function addMarker(type) {
    if (!MARKER_TYPES.some(marker => marker.id === type)) return;
    const epoch = generation;
    const id = resolvingSession ? await resolvingSession : currentSessionId || await resolveSessionId();
    if (!id || epoch !== generation) return;
    const latest = transcriptEntries.at(-1) || interimTranscript;
    markers = [...markers, { type, timestamp: Date.now(), transcript: latest?.text || '' }].slice(-500);
    notice = `Marked ${MARKER_TYPES.find(marker => marker.id === type).label}`;
    schedulePersist(); changed();
}
export function initRealtimeContext() {
    const reset = (_event, data) => {
        generation++; clearTimeout(persistTimer);
        resolvingSession = null;
        currentSessionId = data?.sessionId || null;
        transcriptEntries = []; markers = []; interimTranscript = null; error = ''; notice = '';
        changed();
    };
    ipcRenderer.on('live-transcript', handleTranscript);
    ipcRenderer.on('save-session-context', reset);
    return () => {
        generation++; clearTimeout(persistTimer);
        ipcRenderer.removeListener('live-transcript', handleTranscript);
        ipcRenderer.removeListener('save-session-context', reset);
    };
}
export { RESPONSE_MODES, MARKER_TYPES };
