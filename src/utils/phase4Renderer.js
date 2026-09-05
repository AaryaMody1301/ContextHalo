const { ipcRenderer } = window.require('electron');

const STYLE_ID = 'phase4-workspace-style';
const NAV_IDS = ['phase4-knowledge-nav', 'phase4-practice-nav', 'phase4-review-nav'];
const state = {
    tab: null,
    documents: [],
    sessions: [],
    practice: null,
    practiceIndex: 0,
    practiceSource: 'knowledge',
    practiceSessionId: '',
    review: null,
    busy: false,
};

const STYLES = `
    .phase4-overlay {
        position: fixed;
        inset: 48px 28px 28px calc(var(--sidebar-width) + 28px);
        z-index: 20000;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 16px;
        background: rgba(10,12,17,.96);
        box-shadow: 0 28px 90px rgba(0,0,0,.55);
        backdrop-filter: blur(28px) saturate(130%);
        -webkit-app-region: no-drag;
    }
    :host([live-hud]) .phase4-overlay {
        inset: 58px 22px 22px 22px;
    }
    .phase4-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-height: 58px;
        padding: 0 18px;
        border-bottom: 1px solid rgba(255,255,255,.08);
    }
    .phase4-title {
        display: flex;
        align-items: baseline;
        gap: 10px;
        color: #f8fafc;
        font-size: 15px;
        font-weight: 650;
    }
    .phase4-subtitle { color: rgba(255,255,255,.46); font-size: 11px; font-weight: 400; }
    .phase4-close, .phase4-btn, .phase4-tab, .phase4-source-button {
        border: 1px solid rgba(255,255,255,.1);
        background: rgba(255,255,255,.055);
        color: rgba(255,255,255,.8);
        border-radius: 9px;
        cursor: pointer;
        font: inherit;
    }
    .phase4-close { width: 30px; height: 30px; font-size: 18px; }
    .phase4-close:hover, .phase4-btn:hover, .phase4-tab:hover, .phase4-source-button:hover { background: rgba(255,255,255,.1); color: #fff; }
    .phase4-tabs { display: flex; gap: 6px; padding: 10px 18px 0; }
    .phase4-tab { padding: 7px 11px; font-size: 11px; }
    .phase4-tab.active { border-color: rgba(96,165,250,.55); background: rgba(59,130,246,.13); color: #bfdbfe; }
    .phase4-body { flex: 1; min-height: 0; overflow: auto; padding: 16px 18px 22px; }
    .phase4-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
    .phase4-btn { min-height: 32px; padding: 0 11px; font-size: 11px; }
    .phase4-btn.primary { border-color: rgba(96,165,250,.55); background: rgba(59,130,246,.18); color: #dbeafe; }
    .phase4-btn.danger { border-color: rgba(248,113,113,.25); color: #fecaca; }
    .phase4-btn:disabled { opacity: .45; cursor: default; }
    .phase4-input, .phase4-textarea, .phase4-select {
        width: 100%;
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 9px;
        background: rgba(255,255,255,.045);
        color: #f1f5f9;
        font: inherit;
        outline: none;
    }
    .phase4-input, .phase4-select { height: 34px; padding: 0 10px; }
    .phase4-textarea { min-height: 110px; padding: 9px 10px; resize: vertical; user-select: text; cursor: text; }
    .phase4-input:focus, .phase4-textarea:focus, .phase4-select:focus { border-color: rgba(96,165,250,.65); }
    .phase4-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 12px; }
    .phase4-card {
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 12px;
        background: rgba(255,255,255,.025);
        padding: 13px;
    }
    .phase4-card-title { color: #f8fafc; font-size: 12px; font-weight: 650; margin-bottom: 5px; }
    .phase4-muted { color: rgba(255,255,255,.46); font-size: 10px; line-height: 1.55; }
    .phase4-note { color: rgba(255,255,255,.58); font-size: 10px; line-height: 1.55; margin: 8px 0 14px; }
    .phase4-list { display: flex; flex-direction: column; gap: 7px; }
    .phase4-doc, .phase4-session {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 48px;
        padding: 9px 10px;
        border: 1px solid rgba(255,255,255,.07);
        border-radius: 10px;
        background: rgba(255,255,255,.02);
    }
    .phase4-doc-main, .phase4-session-main { flex: 1; min-width: 0; }
    .phase4-doc-title, .phase4-session-title { color: #e5e7eb; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .phase4-doc-meta, .phase4-session-meta { color: rgba(255,255,255,.4); font-size: 9px; margin-top: 3px; }
    .phase4-toggle { width: 15px; height: 15px; accent-color: #60a5fa; cursor: pointer; }
    .phase4-search-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; margin-bottom: 14px; }
    .phase4-result { margin-top: 8px; padding: 10px; border-left: 2px solid rgba(96,165,250,.5); background: rgba(59,130,246,.05); }
    .phase4-result-title { color: #bfdbfe; font-size: 10px; font-weight: 600; }
    .phase4-result-text { color: rgba(255,255,255,.65); font-size: 10px; line-height: 1.55; margin-top: 5px; white-space: pre-wrap; user-select: text; }
    .phase4-form { display: none; margin: 10px 0 14px; gap: 8px; }
    .phase4-form.visible { display: grid; }
    .phase4-practice-question { font-size: 14px; line-height: 1.55; color: #f8fafc; white-space: pre-wrap; user-select: text; margin: 12px 0; }
    .phase4-progress { color: rgba(255,255,255,.46); font-size: 10px; }
    .phase4-feedback { margin-top: 10px; padding: 10px; border-radius: 9px; background: rgba(255,255,255,.04); font-size: 10px; line-height: 1.55; color: rgba(255,255,255,.72); }
    .phase4-feedback.strong { background: rgba(34,197,94,.08); color: #bbf7d0; }
    .phase4-feedback.partial { background: rgba(234,179,8,.08); color: #fef08a; }
    .phase4-feedback.retry { background: rgba(248,113,113,.08); color: #fecaca; }
    .phase4-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
    .phase4-tag { padding: 4px 7px; border-radius: 999px; background: rgba(255,255,255,.05); color: rgba(255,255,255,.58); font-size: 9px; }
    .phase4-review-section { margin-top: 14px; }
    .phase4-review-section h4 { margin: 0 0 7px; color: #e5e7eb; font-size: 11px; }
    .phase4-review-section ul { margin: 0; padding-left: 18px; color: rgba(255,255,255,.64); font-size: 10px; line-height: 1.6; user-select: text; }
    .phase4-empty { padding: 32px 16px; text-align: center; color: rgba(255,255,255,.42); font-size: 11px; }
    .phase4-live-chip {
        min-height: 24px;
        padding: 0 8px;
        border: 1px solid rgba(96,165,250,.2);
        border-radius: 999px;
        background: rgba(59,130,246,.07);
        color: #bfdbfe;
        font-size: 9px;
        cursor: pointer;
    }
    @media (max-width: 900px) { .phase4-grid { grid-template-columns: 1fr; } }
`;

function ensureStyle(root) {
    if (!root || root.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    root.appendChild(style);
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
}

async function invoke(channel, ...args) {
    const result = await ipcRenderer.invoke(channel, ...args);
    if (!result?.success) throw new Error(result?.error || `${channel} failed`);
    return result;
}

function formatBytes(chars) {
    const value = Math.max(0, Number(chars) || 0);
    return value >= 1000000 ? `${(value / 1000000).toFixed(1)}m chars` : value >= 1000 ? `${Math.round(value / 1000)}k chars` : `${value} chars`;
}

function closePanel(app) {
    app?.shadowRoot?.querySelector('.phase4-overlay')?.remove();
    state.tab = null;
    for (const id of NAV_IDS) app?.shadowRoot?.getElementById(id)?.classList.remove('active');
}

function panelShell(app, tab) {
    const root = app.shadowRoot;
    root.querySelector('.phase4-overlay')?.remove();
    const overlay = el('section', 'phase4-overlay');
    const header = el('div', 'phase4-header');
    const title = el('div', 'phase4-title');
    title.append(el('span', '', tab === 'knowledge' ? 'Knowledge Library' : tab === 'practice' ? 'Practice Lab' : 'Session Review'));
    title.append(el('span', 'phase4-subtitle', tab === 'knowledge'
        ? 'Local retrieval for Gemini, Groq, and Local AI'
        : tab === 'practice'
            ? 'Local recall practice with keyword-based feedback'
            : 'Decisions, actions, questions, topics, and follow-up practice'));
    const close = el('button', 'phase4-close', '×');
    close.type = 'button';
    close.addEventListener('click', () => closePanel(app));
    header.append(title, close);

    const tabs = el('div', 'phase4-tabs');
    for (const item of [['knowledge', 'Knowledge'], ['practice', 'Practice'], ['review', 'Review']]) {
        const button = el('button', `phase4-tab ${tab === item[0] ? 'active' : ''}`, item[1]);
        button.type = 'button';
        button.addEventListener('click', () => openPanel(app, item[0]));
        tabs.append(button);
    }
    const body = el('div', 'phase4-body');
    overlay.append(header, tabs, body);
    root.append(overlay);
    return body;
}

async function loadDocuments() {
    const result = await invoke('knowledge:list');
    state.documents = Array.isArray(result.data) ? result.data : [];
    return state.documents;
}

async function loadSessions() {
    const result = await invoke('review:list');
    state.sessions = Array.isArray(result.data) ? result.data : [];
    return state.sessions;
}

function statusLine(parent, text, isError = false) {
    const line = el('div', 'phase4-note', text);
    if (isError) line.style.color = '#fecaca';
    parent.prepend(line);
    setTimeout(() => line.remove(), 4500);
}

async function renderKnowledge(app, body) {
    body.replaceChildren();
    const toolbar = el('div', 'phase4-toolbar');
    const importButton = el('button', 'phase4-btn primary', 'Import files');
    const addButton = el('button', 'phase4-btn', 'Add pasted text');
    const refreshButton = el('button', 'phase4-btn', 'Refresh');
    toolbar.append(importButton, addButton, refreshButton);
    body.append(toolbar);
    body.append(el('div', 'phase4-note', 'Enabled sources are retrieved locally and injected only when relevant. Supported imports are text, Markdown, JSON/CSV, logs, code, SQL, YAML/XML, and other plain-text files up to 2 MB each. PDF and DOCX ingestion is intentionally not cloud-forwarded.'));

    const form = el('div', 'phase4-form');
    const titleInput = el('input', 'phase4-input');
    titleInput.placeholder = 'Source title';
    const textInput = el('textarea', 'phase4-textarea');
    textInput.placeholder = 'Paste notes, a job description, requirements, documentation, study material, or other reusable context…';
    const saveText = el('button', 'phase4-btn primary', 'Save source');
    form.append(titleInput, textInput, saveText);
    body.append(form);

    const searchRow = el('div', 'phase4-search-row');
    const searchInput = el('input', 'phase4-input');
    searchInput.placeholder = 'Test retrieval…';
    const searchButton = el('button', 'phase4-btn', 'Search');
    searchRow.append(searchInput, searchButton);
    body.append(searchRow);
    const searchResults = el('div', 'phase4-list');
    body.append(searchResults);

    const list = el('div', 'phase4-list');
    body.append(list);

    const redraw = async () => {
        list.replaceChildren(el('div', 'phase4-empty', 'Loading knowledge…'));
        try {
            await loadDocuments();
            list.replaceChildren();
            if (!state.documents.length) {
                list.append(el('div', 'phase4-empty', 'No knowledge sources yet. Import a text-based file or add pasted text.'));
                return;
            }
            for (const document of state.documents) {
                const row = el('div', 'phase4-doc');
                const toggle = el('input', 'phase4-toggle');
                toggle.type = 'checkbox';
                toggle.checked = document.enabled !== false;
                toggle.title = toggle.checked ? 'Enabled for retrieval' : 'Disabled';
                toggle.addEventListener('change', async () => {
                    toggle.disabled = true;
                    try { await invoke('knowledge:set-enabled', document.id, toggle.checked); }
                    catch (error) { toggle.checked = !toggle.checked; statusLine(body, error.message, true); }
                    toggle.disabled = false;
                });
                const main = el('div', 'phase4-doc-main');
                main.append(el('div', 'phase4-doc-title', document.title));
                main.append(el('div', 'phase4-doc-meta', `${document.sourceType || 'text'} · ${document.chunks || 0} chunks · ${formatBytes(document.chars)}`));
                const remove = el('button', 'phase4-btn danger', 'Delete');
                remove.addEventListener('click', async () => {
                    remove.disabled = true;
                    try { await invoke('knowledge:delete', document.id); await redraw(); }
                    catch (error) { statusLine(body, error.message, true); remove.disabled = false; }
                });
                row.append(toggle, main, remove);
                list.append(row);
            }
        } catch (error) {
            list.replaceChildren(el('div', 'phase4-empty', error.message));
        }
    };

    importButton.addEventListener('click', async () => {
        importButton.disabled = true;
        try {
            const result = await invoke('knowledge:import');
            const imported = result.data?.imported?.length || 0;
            const failed = result.data?.failed?.length || 0;
            if (!result.cancelled) statusLine(body, `Imported ${imported} source${imported === 1 ? '' : 's'}${failed ? `; ${failed} skipped` : ''}.`, failed > 0 && imported === 0);
            await redraw();
        } catch (error) { statusLine(body, error.message, true); }
        importButton.disabled = false;
    });
    addButton.addEventListener('click', () => form.classList.toggle('visible'));
    refreshButton.addEventListener('click', redraw);
    saveText.addEventListener('click', async () => {
        if (!textInput.value.trim()) return statusLine(body, 'Paste some text before saving.', true);
        saveText.disabled = true;
        try {
            await invoke('knowledge:add-text', titleInput.value, textInput.value);
            titleInput.value = '';
            textInput.value = '';
            form.classList.remove('visible');
            statusLine(body, 'Knowledge source saved locally.');
            await redraw();
        } catch (error) { statusLine(body, error.message, true); }
        saveText.disabled = false;
    });
    searchButton.addEventListener('click', async () => {
        searchResults.replaceChildren();
        if (!searchInput.value.trim()) return;
        searchButton.disabled = true;
        try {
            const result = await invoke('knowledge:search', searchInput.value, { limit: 5, maxChars: 7000 });
            if (!result.data?.length) searchResults.append(el('div', 'phase4-empty', 'No relevant enabled source was found.'));
            for (const item of result.data || []) {
                const card = el('div', 'phase4-result');
                card.append(el('div', 'phase4-result-title', `${item.title} · score ${item.score}`));
                card.append(el('div', 'phase4-result-text', item.text));
                searchResults.append(card);
            }
        } catch (error) { statusLine(body, error.message, true); }
        searchButton.disabled = false;
    });

    await redraw();
}

async function renderPractice(app, body) {
    body.replaceChildren();
    const grid = el('div', 'phase4-grid');
    const setup = el('div', 'phase4-card');
    setup.append(el('div', 'phase4-card-title', 'Practice source'));
    setup.append(el('div', 'phase4-muted', 'Use enabled knowledge or turn any saved session into a recall set. Questions and grading run locally.'));
    const sourceSelect = el('select', 'phase4-select');
    sourceSelect.style.marginTop = '10px';
    const knowledgeOption = el('option', '', 'Enabled knowledge library');
    knowledgeOption.value = 'knowledge';
    sourceSelect.append(knowledgeOption);
    await loadSessions().catch(() => []);
    for (const session of state.sessions.slice(0, 60)) {
        const option = el('option', '', `Session · ${session.profile || 'Session'} · ${new Date(session.createdAt || Number(session.sessionId)).toLocaleDateString()}`);
        option.value = `session:${session.sessionId}`;
        sourceSelect.append(option);
    }
    if (state.practiceSource === 'session' && state.practiceSessionId) sourceSelect.value = `session:${state.practiceSessionId}`;
    const generate = el('button', 'phase4-btn primary', 'Generate 6 questions');
    generate.style.marginTop = '9px';
    setup.append(sourceSelect, generate);

    const progress = el('div', 'phase4-card');
    progress.append(el('div', 'phase4-card-title', 'Mastery'));
    const historyText = el('div', 'phase4-muted', 'Practice history is stored locally.');
    progress.append(historyText);
    try {
        const history = await invoke('practice:history');
        const attempts = history.data || [];
        if (attempts.length) {
            const recent = attempts.slice(0, 25);
            const average = Math.round(recent.reduce((sum, item) => sum + (Number(item.score) || 0), 0) / recent.length * 100);
            historyText.textContent = `${attempts.length} saved attempts · ${average}% average across the latest ${recent.length}.`;
        }
    } catch {}
    grid.append(setup, progress);
    body.append(grid);

    const practiceArea = el('div', 'phase4-card');
    practiceArea.style.marginTop = '12px';
    body.append(practiceArea);

    const drawQuestion = () => {
        practiceArea.replaceChildren();
        const questions = state.practice?.questions || [];
        if (!questions.length) {
            practiceArea.append(el('div', 'phase4-empty', 'Generate a practice set to begin.'));
            return;
        }
        const question = questions[state.practiceIndex];
        practiceArea.append(el('div', 'phase4-progress', `Question ${state.practiceIndex + 1} of ${questions.length} · ${question.sourceTitle}`));
        practiceArea.append(el('div', 'phase4-practice-question', question.prompt));
        const answer = el('textarea', 'phase4-textarea');
        answer.placeholder = 'Answer in your own words…';
        const controls = el('div', 'phase4-toolbar');
        controls.style.marginTop = '9px';
        const check = el('button', 'phase4-btn primary', 'Check answer');
        const next = el('button', 'phase4-btn', state.practiceIndex >= questions.length - 1 ? 'Restart set' : 'Next');
        const feedback = el('div', 'phase4-feedback');
        feedback.style.display = 'none';
        controls.append(check, next);
        practiceArea.append(answer, controls, feedback);
        check.addEventListener('click', async () => {
            if (!answer.value.trim()) return;
            check.disabled = true;
            try {
                const result = await invoke('practice:grade', state.practice.setId, question.id, answer.value);
                feedback.className = `phase4-feedback ${result.data.level}`;
                feedback.style.display = 'block';
                const missing = result.data.missing?.length ? ` Missing concepts: ${result.data.missing.join(', ')}.` : '';
                feedback.textContent = `${Math.round((result.data.score || 0) * 100)}% · ${result.data.feedback}${missing}\n\nReference: ${result.data.reference}`;
            } catch (error) {
                feedback.className = 'phase4-feedback retry';
                feedback.style.display = 'block';
                feedback.textContent = error.message;
            }
            check.disabled = false;
        });
        next.addEventListener('click', () => {
            state.practiceIndex = state.practiceIndex >= questions.length - 1 ? 0 : state.practiceIndex + 1;
            drawQuestion();
        });
    };

    generate.addEventListener('click', async () => {
        generate.disabled = true;
        practiceArea.replaceChildren(el('div', 'phase4-empty', 'Building practice set…'));
        try {
            const value = sourceSelect.value;
            const options = value.startsWith('session:')
                ? { sourceType: 'session', sessionId: value.slice(8), count: 6 }
                : { sourceType: 'knowledge', count: 6 };
            const result = await invoke('practice:generate', options);
            state.practice = result.data;
            state.practiceIndex = 0;
            state.practiceSource = options.sourceType;
            state.practiceSessionId = options.sessionId || '';
            drawQuestion();
        } catch (error) {
            practiceArea.replaceChildren(el('div', 'phase4-empty', error.message));
        }
        generate.disabled = false;
    });

    drawQuestion();
}

function appendReviewList(section, title, values) {
    if (!Array.isArray(values) || !values.length) return;
    const wrapper = el('div', 'phase4-review-section');
    wrapper.append(el('h4', '', title));
    const list = el('ul');
    for (const value of values) list.append(el('li', '', value));
    wrapper.append(list);
    section.append(wrapper);
}

async function renderReview(app, body) {
    body.replaceChildren();
    const grid = el('div', 'phase4-grid');
    const sessionCard = el('div', 'phase4-card');
    const detailCard = el('div', 'phase4-card');
    sessionCard.append(el('div', 'phase4-card-title', 'Saved sessions'));
    sessionCard.append(el('div', 'phase4-muted', 'Select a session to reconstruct local follow-up context from transcripts, markers, and conversation history.'));
    const sessionList = el('div', 'phase4-list');
    sessionList.style.marginTop = '10px';
    sessionCard.append(sessionList);
    detailCard.append(el('div', 'phase4-empty', 'Choose a session to review.'));
    grid.append(sessionCard, detailCard);
    body.append(grid);

    const drawDetail = review => {
        detailCard.replaceChildren();
        detailCard.append(el('div', 'phase4-card-title', review.title || 'Session review'));
        const meta = [
            review.durationMinutes !== null ? `${review.durationMinutes} min` : null,
            `${review.transcriptItems || 0} transcript items`,
            `${review.messageCount || 0} saved turns`,
        ].filter(Boolean).join(' · ');
        detailCard.append(el('div', 'phase4-muted', meta));
        if (review.goal) detailCard.append(el('div', 'phase4-note', `Goal: ${review.goal}`));
        if (review.topics?.length) {
            const tags = el('div', 'phase4-tags');
            for (const topic of review.topics) tags.append(el('span', 'phase4-tag', topic));
            detailCard.append(tags);
        }
        appendReviewList(detailCard, 'Decisions', review.decisions);
        appendReviewList(detailCard, 'Actions', review.actions);
        appendReviewList(detailCard, 'Open questions', review.questions);
        appendReviewList(detailCard, 'Important moments', review.important);
        const practice = el('button', 'phase4-btn primary', review.practiceReady ? 'Practice this session' : 'Not enough text for practice');
        practice.disabled = !review.practiceReady;
        practice.style.marginTop = '14px';
        practice.addEventListener('click', () => {
            state.practiceSource = 'session';
            state.practiceSessionId = review.sessionId;
            openPanel(app, 'practice');
        });
        detailCard.append(practice);
    };

    try {
        await loadSessions();
        sessionList.replaceChildren();
        if (!state.sessions.length) sessionList.append(el('div', 'phase4-empty', 'No saved sessions yet.'));
        for (const session of state.sessions.slice(0, 80)) {
            const button = el('button', 'phase4-source-button');
            button.style.width = '100%';
            button.style.textAlign = 'left';
            button.style.padding = '9px 10px';
            const date = new Date(session.createdAt || Number(session.sessionId));
            button.append(el('div', 'phase4-session-title', session.profile || 'Session'));
            button.append(el('div', 'phase4-session-meta', `${Number.isNaN(date.getTime()) ? '' : date.toLocaleString()} · ${session.messageCount || 0} turns`));
            button.addEventListener('click', async () => {
                detailCard.replaceChildren(el('div', 'phase4-empty', 'Building review…'));
                try {
                    const result = await invoke('review:get', session.sessionId);
                    state.review = result.data;
                    drawDetail(result.data);
                } catch (error) { detailCard.replaceChildren(el('div', 'phase4-empty', error.message)); }
            });
            sessionList.append(button);
        }
    } catch (error) {
        sessionList.replaceChildren(el('div', 'phase4-empty', error.message));
    }
}

async function openPanel(app, tab) {
    if (!app?.shadowRoot) return;
    state.tab = tab;
    for (const id of NAV_IDS) app.shadowRoot.getElementById(id)?.classList.toggle('active', id === `phase4-${tab}-nav`);
    const body = panelShell(app, tab);
    if (tab === 'knowledge') await renderKnowledge(app, body);
    else if (tab === 'practice') await renderPractice(app, body);
    else await renderReview(app, body);
}

function makeNavButton(app, id, label, tab, iconPath) {
    const button = el('button', 'nav-item');
    button.id = id;
    button.type = 'button';
    button.title = label;
    button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${iconPath}"/></svg><span></span>`;
    button.querySelector('span').textContent = label;
    button.addEventListener('click', () => openPanel(app, tab));
    return button;
}

function decorate(app) {
    const root = app?.shadowRoot;
    if (!root) return;
    ensureStyle(root);
    const nav = root.querySelector('.sidebar-nav');
    if (nav) {
        const history = [...nav.querySelectorAll('.nav-item')].find(item => item.textContent?.trim() === 'History');
        const entries = [
            ['phase4-knowledge-nav', 'Knowledge', 'knowledge', 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z M8 7h8 M8 11h8'],
            ['phase4-practice-nav', 'Practice Lab', 'practice', 'M12 3l8 4-8 4-8-4z M6 10v5c0 2 3 4 6 4s6-2 6-4v-5'],
            ['phase4-review-nav', 'Session Review', 'review', 'M5 4h14v16H5z M8 8h8 M8 12h5 M8 16h6'],
        ];
        let anchor = history;
        for (const entry of entries) {
            let button = root.getElementById(entry[0]);
            if (!button) {
                button = makeNavButton(app, ...entry);
                if (anchor?.nextSibling) nav.insertBefore(button, anchor.nextSibling);
                else nav.append(button);
            }
            anchor = button;
        }
    }

    if (app.currentView === 'assistant') {
        const liveRight = root.querySelector('.live-bar-right');
        if (liveRight && !liveRight.querySelector('.phase4-live-chip')) {
            const chip = el('button', 'phase4-live-chip', 'Knowledge');
            chip.type = 'button';
            chip.title = 'Open Knowledge Library';
            chip.addEventListener('click', () => openPanel(app, 'knowledge'));
            liveRight.prepend(chip);
        }
    }
}

async function install() {
    await customElements.whenDefined('context-halo-app');
    const App = customElements.get('context-halo-app');
    if (!App || App.prototype.__phase4WorkspaceInstalled) return;
    const originalUpdated = App.prototype.updated;
    App.prototype.updated = function(changedProperties) {
        const result = originalUpdated.call(this, changedProperties);
        queueMicrotask(() => decorate(this));
        return result;
    };
    Object.defineProperty(App.prototype, '__phase4WorkspaceInstalled', { value: true });
    const app = document.querySelector('context-halo-app');
    if (app) decorate(app);
}

install().catch(error => console.error('Failed to install Phase 4 workspace:', error));
