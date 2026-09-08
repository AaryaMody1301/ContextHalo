const { ipcRenderer } = window.require('electron');
let sessionPack = { title: '', goal: '', notes: '', clipboardText: '' };
let captureState = { kind: 'active-display', sourceId: null, displayId: null, label: 'Display hosting ContextHalo' };
let captureSources = [];
let packSaveTimer = null;
let loaded = false;
let loadPromise = null;
let sourcePromise = null;
let error = '';
const QUICK_COMMANDS = new Map([
    ['/say', 'Draft exactly what I should say next. Use concise, natural spoken language and give me only the words I can say unless a tiny note is essential.'],
    ['/shorter', 'Make your previous answer shorter. Return at most three concise bullets and keep only the actionable answer.'],
    ['/explain', 'Explain your previous answer more simply. Use plain language and one compact example if it helps.'],
    ['/recap', 'Give a concise recap of the conversation so far: key points, decisions, risks, and what matters next.'],
    ['/actions', 'Extract the concrete action items from the conversation so far. Use a short checklist and include an owner only when it is known.'],
    ['/decisions', 'List the decisions that have been made in this conversation so far. Keep them concise and do not invent decisions.'],
    ['/questions', 'List the important open questions from the conversation so far. Do not include questions that have already been resolved.'],
]);

function sanitizePack(value) {
    const source = value && typeof value === 'object' ? value : {};
    const clean = (field, max) => typeof field === 'string' ? field.slice(0, max) : '';
    return {
        title: clean(source.title, 160),
        goal: clean(source.goal, 1600),
        notes: clean(source.notes, 6000),
        clipboardText: clean(source.clipboardText, 12000),
    };
}

function selectionKey(selection) {
    if (!selection) return 'active-display';
    if (selection.kind === 'screen') return `screen:${selection.displayId || selection.sourceId || ''}`;
    if (selection.kind === 'window') return `window:${selection.sourceId || ''}`;
    return selection.kind || 'active-display';
}

function changed() { window.dispatchEvent(new CustomEvent('session-context-changed')); }
export function getContextState() { return { sessionPack, captureState, captureSources, error }; }
export function loadContextState() {
    if (loaded) return Promise.resolve();
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        const preferences = await contextHalo.storage.getPreferences();
        sessionPack = sanitizePack(preferences.sessionPack);
        await refreshCaptureSources(); loaded = true;
    })().finally(() => { loadPromise = null; });
    return loadPromise;
}
export async function refreshCaptureSources() {
    const result = await ipcRenderer.invoke('context-capture:list-sources');
    if (result?.success) {
        captureSources = Array.isArray(result.data?.sources) ? result.data.sources : [];
        captureState = result.data?.selected || captureState;
        error = '';
    } else { error = 'Screen sources are unavailable. Check screen-sharing permissions and refresh.'; }
    changed();
}
export async function saveSessionPack() {
    clearTimeout(packSaveTimer);
    const result = await contextHalo.storage.updatePreference('sessionPack', sanitizePack(sessionPack));
    if (result?.success === false) throw new Error('Could not save session context.');
    error = ''; changed();
}
export function setPackField(field, value) {
    if (!['title', 'goal', 'notes'].includes(field)) return;
    sessionPack = sanitizePack({ ...sessionPack, [field]: value });
    clearTimeout(packSaveTimer);
    packSaveTimer = setTimeout(() => saveSessionPack().catch(() => {
        error = 'Context could not be saved. Your edits are still here; try starting again.'; changed();
    }), 150);
}
export async function persistPackToCurrentSession() {
    const result = await ipcRenderer.invoke('get-current-session');
    const id = result?.success ? result.data?.sessionId : null;
    if (id) {
        const saved = await contextHalo.storage.saveSession(id, { sessionPack: sanitizePack(sessionPack) });
        if (saved?.success === false) throw new Error('Could not save session context to history.');
    }
}
export function setCaptureSource(key) {
    if (sourcePromise) return sourcePromise;
    const source = captureSources.find(item => item.key === key);
    if (!source) return Promise.resolve({ success: false });
    sourcePromise = (async () => {
        const result = await ipcRenderer.invoke('context-capture:set-source', source);
        if (!result?.success) { error = 'Could not select this screen source. Refresh and try again.'; changed(); return result; }
        captureState = result.data; error = ''; changed();
        window.dispatchEvent(new CustomEvent('capture-source-changed'));
        return result;
    })().finally(() => { sourcePromise = null; });
    return sourcePromise;
}
export async function captureClipboardText() {
    const result = await ipcRenderer.invoke('context-capture:read-clipboard');
    if (!result?.success) { error = 'The clipboard does not contain readable text.'; changed(); return; }
    sessionPack = sanitizePack({ ...sessionPack, clipboardText: result.text });
    await saveSessionPack();
}
export async function clearClipboardContext() {
    sessionPack = { ...sessionPack, clipboardText: '' };
    await saveSessionPack();
}
export async function selectAndAnalyzeRegion(assistant) {
    if (!assistant || assistant.isAnalyzing || assistant.regionSelecting) return { success: false, cancelled: true };
    assistant.regionSelecting = true; assistant.analysisError = '';
    try {
        const result = await ipcRenderer.invoke('context-capture:select-region');
        if (!result?.success) {
            if (!result?.cancelled) assistant.analysisError = result?.error || 'Region selection failed.';
            return result;
        }
        if (!assistant.isConnected) return { success: false, cancelled: true };
        return await assistant.handleScreenAnswer({ region: result.region });
    } catch {
        assistant.analysisError = 'Region selection failed. Retry or choose a different screen in Home.';
        return { success: false, error: assistant.analysisError };
    } finally { assistant.regionSelecting = false; }
}
export function expandQuickCommand(raw) {
    const text = String(raw || '').trim();
    const space = text.indexOf(' ');
    const command = (space >= 0 ? text.slice(0, space) : text).toLowerCase();
    const argument = space >= 0 ? text.slice(space + 1).trim() : '';

    if (QUICK_COMMANDS.has(command)) return QUICK_COMMANDS.get(command);
    if (command === '/translate') {
        const language = argument || 'English';
        return `Translate the latest relevant spoken content into ${language}. Preserve meaning and tone, and output only the translation unless clarification is necessary.`;
    }
    return null;
}

export { selectionKey };
