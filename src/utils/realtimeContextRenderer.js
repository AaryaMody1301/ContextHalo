const { ipcRenderer } = window.require('electron');

const MAIN_STYLE_ID = 'phase3-response-mode-style';
const ASSISTANT_STYLE_ID = 'phase3-realtime-context-style';
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
let providerMode = 'byok';
let audioMode = 'speaker_only';
let transcriptEntries = [];
let interimTranscript = null;
let markers = [];
let currentSessionId = null;
let loadedSessionId = null;
let transcriptExpanded = false;
let markerNotice = '';
let markerNoticeTimer = null;
let persistTimer = null;

const MAIN_STYLES = `
    .phase3-response-mode-card {
        margin: 14px 0 16px;
        padding: 12px 14px;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--bg-surface);
    }

    .phase3-mode-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 9px;
    }

    .phase3-mode-title {
        color: var(--text-primary);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
    }

    .phase3-mode-hint {
        color: var(--text-muted);
        font-size: var(--font-size-xs);
    }

    .phase3-mode-options {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 7px;
    }

    .phase3-mode-option {
        min-width: 0;
        padding: 8px 9px;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        color: var(--text-secondary);
        cursor: pointer;
        text-align: left;
        transition: border-color var(--transition), background var(--transition), color var(--transition);
    }

    .phase3-mode-option:hover {
        color: var(--text-primary);
        border-color: var(--border-strong);
        background: var(--bg-hover);
    }

    .phase3-mode-option.active {
        color: var(--text-primary);
        border-color: rgba(59, 130, 246, 0.7);
        background: rgba(59, 130, 246, 0.1);
    }

    .phase3-mode-option strong,
    .phase3-mode-option span {
        display: block;
        pointer-events: none;
    }

    .phase3-mode-option strong {
        margin-bottom: 2px;
        font-size: 12px;
        font-weight: 600;
    }

    .phase3-mode-option span {
        color: var(--text-muted);
        font-size: 10px;
        line-height: 1.35;
    }
`;

const ASSISTANT_STYLES = `
    .phase3-context-panel {
        flex: 0 0 auto;
        margin: 8px 0 0;
        padding: 8px 10px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        background: rgba(7, 9, 13, 0.48);
        backdrop-filter: blur(14px) saturate(125%);
    }

    .phase3-context-row {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        flex-wrap: wrap;
    }

    .phase3-context-chip,
    .phase3-marker-button,
    .phase3-transcript-toggle {
        height: 24px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.68);
        font-family: var(--font);
        font-size: 10px;
        line-height: 1;
        white-space: nowrap;
    }

    .phase3-context-chip.mode {
        border-color: rgba(96, 165, 250, 0.2);
        background: rgba(59, 130, 246, 0.08);
        color: #b8d7ff;
        font-weight: 600;
    }

    .phase3-marker-group {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-left: auto;
    }

    .phase3-marker-button,
    .phase3-transcript-toggle {
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
    }

    .phase3-marker-button:hover,
    .phase3-transcript-toggle:hover,
    .phase3-transcript-toggle.active {
        color: #ffffff;
        border-color: rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.09);
    }

    .phase3-marker-button {
        width: 25px;
        padding: 0;
        font-size: 11px;
    }

    .phase3-transcript-preview {
        display: flex;
        align-items: baseline;
        gap: 7px;
        min-width: 0;
        margin-top: 7px;
        padding-top: 7px;
        border-top: 1px solid rgba(255, 255, 255, 0.055);
    }

    .phase3-transcript-provider {
        flex: 0 0 auto;
        color: rgba(255, 255, 255, 0.38);
        font-family: var(--font-mono);
        font-size: 9px;
        text-transform: uppercase;
    }

    .phase3-transcript-text {
        min-width: 0;
        overflow: hidden;
        color: rgba(255, 255, 255, 0.72);
        font-size: 11px;
        line-height: 1.4;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .phase3-transcript-text.interim {
        color: rgba(255, 255, 255, 0.48);
        font-style: italic;
    }

    .phase3-transcript-history {
        max-height: 104px;
        overflow-y: auto;
        margin-top: 7px;
        padding-top: 7px;
        border-top: 1px solid rgba(255, 255, 255, 0.055);
    }

    .phase3-transcript-entry {
        display: grid;
        grid-template-columns: 52px minmax(0, 1fr);
        gap: 7px;
        padding: 3px 0;
        color: rgba(255, 255, 255, 0.66);
        font-size: 10px;
        line-height: 1.35;
    }

    .phase3-transcript-time {
        color: rgba(255, 255, 255, 0.34);
        font-family: var(--font-mono);
        font-size: 9px;
    }

    .phase3-marker-notice {
        margin-left: auto;
        color: #9ee6b4;
        font-size: 9px;
        white-space: nowrap;
    }

    :host([isclickthrough]) .phase3-marker-button,
    :host([isclickthrough]) .phase3-transcript-toggle {
        pointer-events: none;
    }
`;

function normalizeMode(value) {
    return RESPONSE_MODES.some(mode => mode.id === value) ? value : 'balanced';
}

function ensureStyle(root, id, cssText) {
    if (!root || root.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = cssText;
    root.appendChild(style);
}

async function refreshPreferences() {
    try {
        const preferences = await contextHalo.storage.getPreferences();
        responseMode = normalizeMode(preferences.responseMode);
        providerMode = preferences.providerMode || 'byok';
        audioMode = preferences.audioMode || 'speaker_only';
    } catch {
        responseMode = normalizeMode(responseMode);
    }
}

async function setResponseMode(mode) {
    const normalized = normalizeMode(mode);
    responseMode = normalized;
    try {
        await contextHalo.storage.updatePreference('responseMode', normalized);
    } catch (error) {
        console.error('Could not save response mode:', error);
    }
    decorateAll();
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

async function resolveSessionId() {
    try {
        const result = await ipcRenderer.invoke('get-current-session');
        const sessionId = result?.success ? result.data?.sessionId : null;
        if (!sessionId) return null;
        if (currentSessionId !== sessionId) {
            clearTimeout(persistTimer);
            transcriptEntries = [];
            markers = [];
            interimTranscript = null;
            loadedSessionId = null;
            currentSessionId = sessionId;
            await loadSessionState(sessionId);
        }
        return sessionId;
    } catch {
        return null;
    }
}

async function loadSessionState(sessionId) {
    if (!sessionId || loadedSessionId === sessionId) return;
    loadedSessionId = sessionId;
    try {
        const session = await contextHalo.storage.getSession(sessionId);
        if (session && currentSessionId === sessionId) {
            transcriptEntries = mergeByTimestamp(session.liveTranscript || [], transcriptEntries);
            if (Array.isArray(session.markers)) markers = session.markers.slice(-500);
        }
    } catch (error) {
        console.error('Could not load realtime session context:', error);
    }
}

function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        void persistRealtimeState();
    }, 450);
}

async function persistRealtimeState() {
    const sessionId = currentSessionId || await resolveSessionId();
    if (!sessionId) return;
    try {
        await contextHalo.storage.saveSession(sessionId, {
            liveTranscript: transcriptEntries,
            markers,
        });
    } catch (error) {
        console.error('Could not save realtime session context:', error);
    }
}

function handleTranscript(_event, payload) {
    if (!payload || typeof payload.text !== 'string' || !payload.text.trim()) return;
    const entry = {
        provider: ['gemini', 'groq', 'local'].includes(payload.provider) ? payload.provider : 'local',
        text: payload.text.trim().slice(0, 8000),
        final: payload.final !== false,
        timestamp: Number(payload.timestamp) || Date.now(),
    };

    if (entry.final) {
        transcriptEntries = mergeByTimestamp(transcriptEntries, [entry]);
        interimTranscript = null;
        schedulePersist();
        void resolveSessionId();
    } else {
        interimTranscript = entry;
    }
    decorateAll();
}

function formatTime(timestamp) {
    try {
        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return '';
    }
}

async function addMarker(type) {
    if (!MARKER_TYPES.some(marker => marker.id === type)) return;
    const sessionId = currentSessionId || await resolveSessionId();
    if (!sessionId) return;

    const latest = transcriptEntries[transcriptEntries.length - 1] || interimTranscript;
    markers = [
        ...markers,
        {
            type,
            timestamp: Date.now(),
            transcript: latest?.text || '',
        },
    ].slice(-500);

    const label = MARKER_TYPES.find(marker => marker.id === type)?.label || type;
    markerNotice = `Marked ${label}`;
    clearTimeout(markerNoticeTimer);
    markerNoticeTimer = setTimeout(() => {
        markerNotice = '';
        decorateAll();
    }, 1600);
    schedulePersist();
    decorateAll();
}

function decorateMainView() {
    const app = document.querySelector('context-halo-app');
    const mainView = app?.shadowRoot?.querySelector('main-view');
    const root = mainView?.shadowRoot;
    if (!root) return;

    ensureStyle(root, MAIN_STYLE_ID, MAIN_STYLES);
    const startButton = root.querySelector('.start-button');
    if (!startButton) return;

    let card = root.querySelector('.phase3-response-mode-card');
    if (!card) {
        card = document.createElement('section');
        card.className = 'phase3-response-mode-card';
        startButton.parentNode.insertBefore(card, startButton);
    }

    card.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'phase3-mode-heading';
    const title = document.createElement('span');
    title.className = 'phase3-mode-title';
    title.textContent = 'Live response style';
    const hint = document.createElement('span');
    hint.className = 'phase3-mode-hint';
    hint.textContent = 'Applied when the session starts';
    heading.append(title, hint);

    const options = document.createElement('div');
    options.className = 'phase3-mode-options';
    for (const mode of RESPONSE_MODES) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `phase3-mode-option${responseMode === mode.id ? ' active' : ''}`;
        button.dataset.mode = mode.id;
        const strong = document.createElement('strong');
        strong.textContent = mode.label;
        const description = document.createElement('span');
        description.textContent = mode.description;
        button.append(strong, description);
        button.addEventListener('click', () => void setResponseMode(mode.id));
        options.appendChild(button);
    }

    card.append(heading, options);
}

function contextAudioLabel() {
    if (audioMode === 'both') return 'Audio · mixed';
    if (audioMode === 'mic_only') return 'Audio · mic';
    return 'Audio · speaker';
}

function providerLabel() {
    if (providerMode === 'groq') return 'Groq';
    if (providerMode === 'local') return 'Local';
    return 'Gemini';
}

function createChip(text, className = '') {
    const chip = document.createElement('span');
    chip.className = `phase3-context-chip${className ? ` ${className}` : ''}`;
    chip.textContent = text;
    return chip;
}

function decorateAssistant() {
    const app = document.querySelector('context-halo-app');
    const assistant = app?.shadowRoot?.querySelector('assistant-view');
    const root = assistant?.shadowRoot;
    if (!root) return;

    ensureStyle(root, ASSISTANT_STYLE_ID, ASSISTANT_STYLES);
    const responseContainer = root.querySelector('.response-container');
    if (!responseContainer) return;

    let panel = root.querySelector('.phase3-context-panel');
    if (!panel) {
        panel = document.createElement('section');
        panel.className = 'phase3-context-panel';
        responseContainer.parentNode.insertBefore(panel, responseContainer);
    }

    panel.replaceChildren();
    const row = document.createElement('div');
    row.className = 'phase3-context-row';
    const mode = RESPONSE_MODES.find(item => item.id === responseMode) || RESPONSE_MODES[1];
    row.append(
        createChip(`${mode.label} responses`, 'mode'),
        createChip(contextAudioLabel()),
        createChip('Screen context'),
        createChip(providerLabel())
    );

    const transcriptToggle = document.createElement('button');
    transcriptToggle.type = 'button';
    transcriptToggle.className = `phase3-transcript-toggle${transcriptExpanded ? ' active' : ''}`;
    transcriptToggle.textContent = `Transcript ${transcriptEntries.length}`;
    transcriptToggle.title = 'Show or hide recent transcript';
    transcriptToggle.addEventListener('click', () => {
        transcriptExpanded = !transcriptExpanded;
        decorateAll();
    });
    row.appendChild(transcriptToggle);

    const markerGroup = document.createElement('div');
    markerGroup.className = 'phase3-marker-group';
    for (const marker of MARKER_TYPES) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'phase3-marker-button';
        button.textContent = marker.symbol;
        button.title = `Mark ${marker.label}`;
        button.setAttribute('aria-label', `Mark ${marker.label}`);
        button.addEventListener('click', () => void addMarker(marker.id));
        markerGroup.appendChild(button);
    }
    row.appendChild(markerGroup);

    if (markerNotice) {
        const notice = document.createElement('span');
        notice.className = 'phase3-marker-notice';
        notice.textContent = markerNotice;
        row.appendChild(notice);
    }
    panel.appendChild(row);

    const latest = interimTranscript || transcriptEntries[transcriptEntries.length - 1];
    if (latest) {
        const preview = document.createElement('div');
        preview.className = 'phase3-transcript-preview';
        const provider = document.createElement('span');
        provider.className = 'phase3-transcript-provider';
        provider.textContent = latest.provider;
        const text = document.createElement('span');
        text.className = `phase3-transcript-text${latest.final === false ? ' interim' : ''}`;
        text.textContent = latest.text;
        preview.append(provider, text);
        panel.appendChild(preview);
    }

    if (transcriptExpanded && transcriptEntries.length) {
        const history = document.createElement('div');
        history.className = 'phase3-transcript-history';
        for (const entry of transcriptEntries.slice(-6).reverse()) {
            const item = document.createElement('div');
            item.className = 'phase3-transcript-entry';
            const time = document.createElement('span');
            time.className = 'phase3-transcript-time';
            time.textContent = formatTime(entry.timestamp);
            const text = document.createElement('span');
            text.textContent = entry.text;
            item.append(time, text);
            history.appendChild(item);
        }
        panel.appendChild(history);
    }
}

function decorateAll() {
    decorateMainView();
    decorateAssistant();
}

async function patchViews() {
    await Promise.all([
        customElements.whenDefined('context-halo-app'),
        customElements.whenDefined('main-view'),
        customElements.whenDefined('assistant-view'),
    ]);

    const App = customElements.get('context-halo-app');
    const MainView = customElements.get('main-view');
    const AssistantView = customElements.get('assistant-view');

    if (App && !App.prototype.__realtimeContextDecorated) {
        const originalUpdated = App.prototype.updated;
        App.prototype.updated = function (changedProperties) {
            const result = originalUpdated.call(this, changedProperties);
            if (changedProperties?.has?.('currentView') && this.currentView === 'assistant') {
                void refreshPreferences().then(() => {
                    void resolveSessionId();
                    decorateAll();
                });
            }
            queueMicrotask(decorateAll);
            return result;
        };
        Object.defineProperty(App.prototype, '__realtimeContextDecorated', { value: true });
    }

    for (const View of [MainView, AssistantView]) {
        if (!View || View.prototype.__realtimeContextDecorated) continue;
        const originalUpdated = View.prototype.updated;
        View.prototype.updated = function (changedProperties) {
            const result = typeof originalUpdated === 'function' ? originalUpdated.call(this, changedProperties) : undefined;
            queueMicrotask(decorateAll);
            return result;
        };
        Object.defineProperty(View.prototype, '__realtimeContextDecorated', { value: true });
    }

    await refreshPreferences();
    ipcRenderer.on('live-transcript', handleTranscript);
    window.contextHalo.flushSessionContext = async () => {
        clearTimeout(persistTimer);
        await persistRealtimeState();
    };
    ipcRenderer.on('save-session-context', async (_event, data) => {
        clearTimeout(persistTimer);
        currentSessionId = data.sessionId;
        loadedSessionId = null;
        transcriptEntries = [];
        markers = [];
        interimTranscript = null;
        decorateAll();
    });
    decorateAll();
}

patchViews().catch(error => {
    console.error('Failed to initialize realtime context UI:', error);
});
