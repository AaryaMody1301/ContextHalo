const { ipcRenderer } = window.require('electron');

const MAIN_STYLE_ID = 'phase3-context-capture-main-style';
const ASSISTANT_STYLE_ID = 'phase3-context-capture-assistant-style';
const PACK_SAVE_DELAY_MS = 150;

let sessionPack = { title: '', goal: '', notes: '', clipboardText: '' };
let captureState = { kind: 'active-display', sourceId: null, displayId: null, label: 'Display hosting ContextHalo' };
let captureSources = [];
let inspectorExpanded = false;
let packSaveTimer = null;
let pendingRegion = null;
let pendingRegionTimer = null;
let initialized = false;

const QUICK_COMMANDS = new Map([
    ['/say', 'Draft exactly what I should say next. Use concise, natural spoken language and give me only the words I can say unless a tiny note is essential.'],
    ['/shorter', 'Make your previous answer shorter. Return at most three concise bullets and keep only the actionable answer.'],
    ['/explain', 'Explain your previous answer more simply. Use plain language and one compact example if it helps.'],
    ['/recap', 'Give a concise recap of the conversation so far: key points, decisions, risks, and what matters next.'],
    ['/actions', 'Extract the concrete action items from the conversation so far. Use a short checklist and include an owner only when it is known.'],
    ['/decisions', 'List the decisions that have been made in this conversation so far. Keep them concise and do not invent decisions.'],
    ['/questions', 'List the important open questions from the conversation so far. Do not include questions that have already been resolved.'],
]);

const MAIN_STYLES = `
    .phase3-session-context-card {
        margin: 0 0 16px;
        padding: 12px 14px;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--bg-surface);
    }

    .phase3-context-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
    }

    .phase3-context-title {
        display: block;
        color: var(--text-primary);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
    }

    .phase3-context-subtitle {
        display: block;
        margin-top: 2px;
        color: var(--text-muted);
        font-size: 10px;
        line-height: 1.4;
    }

    .phase3-source-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 7px;
        margin-bottom: 10px;
    }

    .phase3-source-row select,
    .phase3-pack-input,
    .phase3-pack-textarea {
        width: 100%;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        color: var(--text-primary);
        font: inherit;
        outline: none;
    }

    .phase3-source-row select,
    .phase3-pack-input {
        height: 34px;
        padding: 0 9px;
        font-size: 11px;
    }

    .phase3-pack-textarea {
        min-height: 58px;
        resize: vertical;
        padding: 8px 9px;
        font-size: 11px;
        line-height: 1.45;
    }

    .phase3-source-row select:focus,
    .phase3-pack-input:focus,
    .phase3-pack-textarea:focus {
        border-color: var(--accent);
    }

    .phase3-small-button {
        height: 34px;
        padding: 0 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        color: var(--text-secondary);
        cursor: pointer;
        font: inherit;
        font-size: 10px;
        white-space: nowrap;
    }

    .phase3-small-button:hover {
        color: var(--text-primary);
        background: var(--bg-hover);
    }

    .phase3-pack-grid {
        display: grid;
        grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
        gap: 7px;
        margin-bottom: 7px;
    }

    .phase3-pack-field {
        min-width: 0;
    }

    .phase3-pack-label {
        display: block;
        margin: 0 0 4px;
        color: var(--text-muted);
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .phase3-clipboard-row {
        display: flex;
        align-items: center;
        gap: 7px;
        margin-top: 8px;
    }

    .phase3-clipboard-status {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        color: var(--text-muted);
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
`;

const ASSISTANT_STYLES = `
    .phase3-capture-tools {
        display: flex;
        align-items: center;
        gap: 5px;
        margin-top: 7px;
        padding-top: 7px;
        border-top: 1px solid rgba(255, 255, 255, 0.055);
    }

    .phase3-capture-target {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        color: rgba(255, 255, 255, 0.42);
        font-size: 9px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .phase3-tool-button {
        height: 23px;
        padding: 0 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.65);
        cursor: pointer;
        font-family: var(--font);
        font-size: 9px;
        white-space: nowrap;
    }

    .phase3-tool-button:hover,
    .phase3-tool-button.active {
        color: #fff;
        border-color: rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.09);
    }

    .phase3-context-inspector {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 5px 10px;
        margin-top: 7px;
        padding: 8px 9px;
        border: 1px solid rgba(255, 255, 255, 0.055);
        border-radius: 9px;
        background: rgba(255, 255, 255, 0.025);
        color: rgba(255, 255, 255, 0.5);
        font-size: 9px;
        line-height: 1.45;
    }

    .phase3-inspector-value {
        color: rgba(255, 255, 255, 0.75);
    }

    .phase3-quick-actions {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 6px 16px 0;
        overflow-x: auto;
        background: transparent;
    }

    .phase3-quick-button {
        flex: 0 0 auto;
        height: 24px;
        padding: 0 9px;
        border: 1px solid rgba(255, 255, 255, 0.075);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.035);
        color: rgba(255, 255, 255, 0.54);
        cursor: pointer;
        font-family: var(--font);
        font-size: 9px;
        transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
    }

    .phase3-quick-button:hover {
        color: rgba(255, 255, 255, 0.9);
        border-color: rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.075);
    }
`;

function ensureStyle(root, id, cssText) {
    if (!root || root.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = cssText;
    root.appendChild(style);
}

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

async function loadContextState() {
    try {
        const preferences = await contextHalo.storage.getPreferences();
        sessionPack = sanitizePack(preferences.sessionPack);
    } catch {}
    await refreshCaptureSources();
    initialized = true;
}

async function refreshCaptureSources() {
    try {
        const result = await ipcRenderer.invoke('context-capture:list-sources');
        if (!result?.success) throw new Error(result?.error || 'Could not list capture sources');
        captureSources = Array.isArray(result.data?.sources) ? result.data.sources : [];
        captureState = result.data?.selected || captureState;
    } catch (error) {
        console.error('Could not load context sources:', error);
    }
    decorateAll();
}

async function saveSessionPack() {
    clearTimeout(packSaveTimer);
    try {
        await contextHalo.storage.updatePreference('sessionPack', sanitizePack(sessionPack));
    } catch (error) {
        console.error('Could not save session pack:', error);
    }
}

function scheduleSessionPackSave() {
    clearTimeout(packSaveTimer);
    packSaveTimer = setTimeout(() => void saveSessionPack(), PACK_SAVE_DELAY_MS);
}

async function persistPackToCurrentSession() {
    try {
        const result = await ipcRenderer.invoke('get-current-session');
        const sessionId = result?.success ? result.data?.sessionId : null;
        if (sessionId) await contextHalo.storage.saveSession(sessionId, { sessionPack: sanitizePack(sessionPack) });
    } catch (error) {
        console.error('Could not persist session pack into history:', error);
    }
}

async function setCaptureSource(key) {
    const source = captureSources.find(item => item.key === key);
    if (!source) return;
    try {
        const result = await ipcRenderer.invoke('context-capture:set-source', source);
        if (!result?.success) throw new Error(result?.error || 'Could not select context source');
        captureState = result.data;
    } catch (error) {
        console.error('Could not select context source:', error);
    }
    decorateAll();
}

async function captureClipboardText() {
    try {
        const result = await ipcRenderer.invoke('context-capture:read-clipboard');
        if (!result?.success) throw new Error(result?.error || 'Clipboard does not contain text');
        sessionPack = { ...sessionPack, clipboardText: result.text };
        await saveSessionPack();
        decorateAll();
    } catch (error) {
        const app = document.querySelector('context-halo-app');
        app?.setStatus?.(error.message);
    }
}

async function clearClipboardContext() {
    sessionPack = { ...sessionPack, clipboardText: '' };
    await saveSessionPack();
    decorateAll();
}

function patchRegionDrawImage() {
    const proto = window.CanvasRenderingContext2D?.prototype;
    if (!proto || proto.__contextRegionPatched) return;
    const originalDrawImage = proto.drawImage;

    proto.drawImage = function (image, ...args) {
        if (
            pendingRegion
            && image instanceof HTMLVideoElement
            && image.srcObject
            && image.videoWidth > 0
            && image.videoHeight > 0
            && args.length === 4
        ) {
            const region = pendingRegion;
            pendingRegion = null;
            clearTimeout(pendingRegionTimer);

            const sourceWidth = image.videoWidth;
            const sourceHeight = image.videoHeight;
            const sx = Math.max(0, Math.round(sourceWidth * region.x));
            const sy = Math.max(0, Math.round(sourceHeight * region.y));
            const sw = Math.max(1, Math.min(sourceWidth - sx, Math.round(sourceWidth * region.width)));
            const sh = Math.max(1, Math.min(sourceHeight - sy, Math.round(sourceHeight * region.height)));
            const outputWidth = Math.min(1280, sw);
            const outputHeight = Math.max(1, Math.round(sh * (outputWidth / sw)));

            this.canvas.width = outputWidth;
            this.canvas.height = outputHeight;
            return originalDrawImage.call(this, image, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);
        }
        return originalDrawImage.call(this, image, ...args);
    };

    Object.defineProperty(proto, '__contextRegionPatched', { value: true });
}

async function selectAndAnalyzeRegion(assistant) {
    if (!assistant || assistant.isAnalyzing) return;
    const result = await ipcRenderer.invoke('context-capture:select-region');
    if (!result?.success) {
        if (!result?.cancelled) {
            const app = document.querySelector('context-halo-app');
            app?.setStatus?.(result?.error || 'Region selection failed');
        }
        return;
    }

    pendingRegion = result.region;
    clearTimeout(pendingRegionTimer);
    pendingRegionTimer = setTimeout(() => { pendingRegion = null; }, 7000);
    await assistant.handleScreenAnswer();
}

function expandQuickCommand(raw) {
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

function runQuickCommand(assistant, command) {
    const input = assistant?.shadowRoot?.querySelector('#textInput');
    if (!input) return;
    input.value = command;
    void assistant.handleSendText();
}

function sourceOptions(select) {
    const selected = selectionKey(captureState);
    const displayGroup = document.createElement('optgroup');
    displayGroup.label = 'Displays';
    const windowGroup = document.createElement('optgroup');
    windowGroup.label = 'Windows';

    for (const source of captureSources) {
        const option = document.createElement('option');
        option.value = source.key;
        option.textContent = source.label;
        option.selected = source.key === selected;
        if (source.kind === 'window') windowGroup.appendChild(option);
        else displayGroup.appendChild(option);
    }
    select.append(displayGroup);
    if (windowGroup.childElementCount) select.append(windowGroup);
}

function createField(labelText, value, placeholder, onInput, multiline = false) {
    const field = document.createElement('label');
    field.className = 'phase3-pack-field';
    const label = document.createElement('span');
    label.className = 'phase3-pack-label';
    label.textContent = labelText;
    const input = document.createElement(multiline ? 'textarea' : 'input');
    input.className = multiline ? 'phase3-pack-textarea' : 'phase3-pack-input';
    input.placeholder = placeholder;
    input.value = value || '';
    input.addEventListener('input', event => onInput(event.target.value));
    field.append(label, input);
    return field;
}

function decorateMainView() {
    const app = document.querySelector('context-halo-app');
    const mainView = app?.shadowRoot?.querySelector('main-view');
    const root = mainView?.shadowRoot;
    if (!root || !initialized) return;
    ensureStyle(root, MAIN_STYLE_ID, MAIN_STYLES);

    const startButton = root.querySelector('.start-button');
    if (!startButton) return;
    let card = root.querySelector('.phase3-session-context-card');
    if (!card) {
        card = document.createElement('section');
        card.className = 'phase3-session-context-card';
        startButton.parentNode.insertBefore(card, startButton);
    }
    if (card.contains(root.activeElement)) return;
    card.replaceChildren();

    const heading = document.createElement('div');
    heading.className = 'phase3-context-heading';
    const headingText = document.createElement('div');
    const title = document.createElement('span');
    title.className = 'phase3-context-title';
    title.textContent = 'Session context';
    const subtitle = document.createElement('span');
    subtitle.className = 'phase3-context-subtitle';
    subtitle.textContent = 'Choose what is captured and optionally seed this session with a goal or copied text.';
    headingText.append(title, subtitle);
    heading.appendChild(headingText);
    card.appendChild(heading);

    const sourceRow = document.createElement('div');
    sourceRow.className = 'phase3-source-row';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Screen context source');
    sourceOptions(select);
    select.addEventListener('change', event => void setCaptureSource(event.target.value));
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'phase3-small-button';
    refresh.textContent = 'Refresh windows';
    refresh.addEventListener('click', () => void refreshCaptureSources());
    sourceRow.append(select, refresh);
    card.appendChild(sourceRow);

    const grid = document.createElement('div');
    grid.className = 'phase3-pack-grid';
    grid.append(
        createField('Session', sessionPack.title, 'e.g. Product roadmap', value => {
            sessionPack = { ...sessionPack, title: value };
            scheduleSessionPackSave();
        }),
        createField('Goal', sessionPack.goal, 'What should ContextHalo optimize for?', value => {
            sessionPack = { ...sessionPack, goal: value };
            scheduleSessionPackSave();
        })
    );
    card.appendChild(grid);
    card.appendChild(createField('Context notes', sessionPack.notes, 'Agenda, role, constraints, background...', value => {
        sessionPack = { ...sessionPack, notes: value };
        scheduleSessionPackSave();
    }, true));

    const clipboardRow = document.createElement('div');
    clipboardRow.className = 'phase3-clipboard-row';
    const status = document.createElement('span');
    status.className = 'phase3-clipboard-status';
    status.textContent = sessionPack.clipboardText
        ? `Copied text attached · ${sessionPack.clipboardText.length.toLocaleString()} characters · stored locally`
        : 'Copy selected text in another app, then attach it here if useful.';
    const useClipboard = document.createElement('button');
    useClipboard.type = 'button';
    useClipboard.className = 'phase3-small-button';
    useClipboard.textContent = sessionPack.clipboardText ? 'Refresh copied text' : 'Use copied text';
    useClipboard.addEventListener('click', () => void captureClipboardText());
    clipboardRow.append(status, useClipboard);
    if (sessionPack.clipboardText) {
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'phase3-small-button';
        clear.textContent = 'Clear';
        clear.addEventListener('click', () => void clearClipboardContext());
        clipboardRow.appendChild(clear);
    }
    card.appendChild(clipboardRow);
}

function updateRealtimeScreenChip(root) {
    const panel = root.querySelector('.phase3-context-panel');
    const chips = panel?.querySelectorAll('.phase3-context-chip');
    if (!chips || chips.length < 3) return;
    const label = captureState.label || 'Screen';
    chips[2].textContent = label.length > 28 ? `Screen · ${label.slice(0, 25)}…` : `Screen · ${label}`;
}

function decorateAssistant() {
    const app = document.querySelector('context-halo-app');
    const assistant = app?.shadowRoot?.querySelector('assistant-view');
    const root = assistant?.shadowRoot;
    if (!root || !initialized) return;
    ensureStyle(root, ASSISTANT_STYLE_ID, ASSISTANT_STYLES);
    updateRealtimeScreenChip(root);

    const panel = root.querySelector('.phase3-context-panel');
    if (panel) {
        let tools = panel.querySelector('.phase3-capture-tools');
        if (!tools) {
            tools = document.createElement('div');
            tools.className = 'phase3-capture-tools';
            panel.appendChild(tools);
        }
        tools.replaceChildren();

        const target = document.createElement('span');
        target.className = 'phase3-capture-target';
        target.textContent = `Context source: ${captureState.label || 'Display'}`;
        const region = document.createElement('button');
        region.type = 'button';
        region.className = 'phase3-tool-button';
        region.textContent = 'Region';
        region.title = 'Select a screen region to analyze';
        region.addEventListener('click', () => void selectAndAnalyzeRegion(assistant));
        const context = document.createElement('button');
        context.type = 'button';
        context.className = `phase3-tool-button${inspectorExpanded ? ' active' : ''}`;
        context.textContent = 'Context';
        context.addEventListener('click', () => {
            inspectorExpanded = !inspectorExpanded;
            decorateAll();
        });
        tools.append(target, region, context);

        let inspector = panel.querySelector('.phase3-context-inspector');
        if (inspectorExpanded) {
            if (!inspector) {
                inspector = document.createElement('div');
                inspector.className = 'phase3-context-inspector';
                panel.appendChild(inspector);
            }
            inspector.replaceChildren();
            const values = [
                ['Screen', captureState.label || 'Display'],
                ['Session', sessionPack.title || 'No session name'],
                ['Goal', sessionPack.goal || 'No goal set'],
                ['Copied text', sessionPack.clipboardText ? `${sessionPack.clipboardText.length.toLocaleString()} chars` : 'None'],
            ];
            for (const [label, value] of values) {
                const item = document.createElement('span');
                item.textContent = `${label}: `;
                const strong = document.createElement('span');
                strong.className = 'phase3-inspector-value';
                strong.textContent = value;
                item.appendChild(strong);
                inspector.appendChild(item);
            }
        } else if (inspector) {
            inspector.remove();
        }
    }

    const inputBar = root.querySelector('.input-bar');
    if (!inputBar) return;
    let quick = root.querySelector('.phase3-quick-actions');
    if (!quick) {
        quick = document.createElement('div');
        quick.className = 'phase3-quick-actions';
        inputBar.parentNode.insertBefore(quick, inputBar);
    }
    quick.replaceChildren();
    const actions = [
        ['Say next', '/say'],
        ['Shorter', '/shorter'],
        ['Explain', '/explain'],
        ['Recap', '/recap'],
        ['Actions', '/actions'],
        ['Screen', '/screen'],
        ['Region', '/region'],
    ];
    for (const [label, command] of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'phase3-quick-button';
        button.textContent = label;
        button.addEventListener('click', () => runQuickCommand(assistant, command));
        quick.appendChild(button);
    }

    const input = root.querySelector('#textInput');
    if (input && !input.dataset.phase3Placeholder) {
        input.dataset.phase3Placeholder = 'true';
        input.placeholder = 'Ask ContextHalo or type / for quick assist...';
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
    patchRegionDrawImage();
    await loadContextState();

    const App = customElements.get('context-halo-app');
    const MainView = customElements.get('main-view');
    const AssistantView = customElements.get('assistant-view');

    if (MainView && !MainView.prototype.__contextCapturePatched) {
        const originalUpdated = MainView.prototype.updated;
        const originalStart = MainView.prototype._handleStart;
        MainView.prototype.updated = function (changedProperties) {
            const result = typeof originalUpdated === 'function' ? originalUpdated.call(this, changedProperties) : undefined;
            queueMicrotask(decorateAll);
            return result;
        };
        MainView.prototype._handleStart = async function (...args) {
            await saveSessionPack();
            return originalStart.apply(this, args);
        };
        Object.defineProperty(MainView.prototype, '__contextCapturePatched', { value: true });
    }

    if (AssistantView && !AssistantView.prototype.__quickAssistPatched) {
        const originalUpdated = AssistantView.prototype.updated;
        const originalHandleSendText = AssistantView.prototype.handleSendText;
        AssistantView.prototype.updated = function (changedProperties) {
            const result = typeof originalUpdated === 'function' ? originalUpdated.call(this, changedProperties) : undefined;
            queueMicrotask(decorateAll);
            return result;
        };
        AssistantView.prototype.handleSendText = async function (...args) {
            if (this.sending) return;
            const input = this.shadowRoot?.querySelector('#textInput');
            const raw = input?.value?.trim() || '';
            if (raw === '/screen') {
                input.value = ''; this.draft = '';
                return this.handleScreenAnswer();
            }
            if (raw === '/region') {
                input.value = ''; this.draft = '';
                return selectAndAnalyzeRegion(this);
            }
            const expanded = expandQuickCommand(raw);
            if (expanded && input) input.value = expanded;
            return originalHandleSendText.apply(this, args);
        };
        Object.defineProperty(AssistantView.prototype, '__quickAssistPatched', { value: true });
    }

    if (App && !App.prototype.__contextCapturePatched) {
        const originalUpdated = App.prototype.updated;
        App.prototype.updated = function (changedProperties) {
            const result = originalUpdated.call(this, changedProperties);
            if (changedProperties?.has?.('currentView') && this.currentView === 'assistant') {
                void persistPackToCurrentSession();
            }
            queueMicrotask(decorateAll);
            return result;
        };
        Object.defineProperty(App.prototype, '__contextCapturePatched', { value: true });
    }

    decorateAll();
}

patchViews().catch(error => {
    console.error('Failed to initialize context capture UI:', error);
});
