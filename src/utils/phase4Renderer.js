const ipcRenderer = window.electronAPI;

const state = {
    tab: null,
    documents: [],
    sessions: [],
    practice: null,
    practiceIndex: 0,
    practiceSource: 'knowledge',
    practiceSessionId: '',
    practiceTrackId: '',
    review: null,
    busy: false,
};

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (tag === 'button') node.type = 'button';
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

export function closePanel(app) {
    app?.shadowRoot?.querySelector('.phase4-overlay')?.close();
    state.tab = null;
    app.workspaceTab = null;
}
function panelShell(app) {
    const dialog = app.shadowRoot.querySelector('.phase4-overlay');
    const slot = dialog.querySelector('.phase4-body');
    const body = el('div', 'phase4-page');
    slot.replaceChildren(body);
    if (!dialog.open) dialog.showModal();
    return body;
}

async function loadDocuments() {
    const result = await invoke('knowledge:list');
    state.documents = Array.isArray(result.data) ? result.data : [];
    return result.status;
}

async function loadSessions() {
    const result = await invoke('review:list');
    state.sessions = Array.isArray(result.data) ? result.data : [];
    return state.sessions;
}

function statusLine(parent, text, isError = false) {
    const line = el('div', 'phase4-note', text);
    line.setAttribute('role', isError ? 'alert' : 'status');
    if (isError) line.style.color = 'var(--text-primary)';
    parent.prepend(line);
    // Keep recovery feedback until the next action; errors must not disappear on a timer.
    parent.querySelectorAll('[data-workspace-status]').forEach(node => node.remove());
    line.dataset.workspaceStatus = 'true';
    return line;
}

async function renderKnowledge(app, body) {
    body.replaceChildren();
    const toolbar = el('div', 'phase4-toolbar');
    const importButton = el('button', 'phase4-btn primary', 'Import files');
    const addButton = el('button', 'phase4-btn', 'Add pasted text');
    const refreshButton = el('button', 'phase4-btn', 'Refresh');
    toolbar.append(importButton, addButton, refreshButton);
    body.append(toolbar);
    const importLimits = el('div', 'phase4-note', 'Import text, Markdown, CSV, JSON, or source code files.');
    const libraryStatus = el('div', 'phase4-note');
    libraryStatus.setAttribute('role', 'status');
    libraryStatus.hidden = true;
    body.append(importLimits, libraryStatus);

    const form = el('div', 'phase4-form');
    form.id = 'knowledge-add-form';
    addButton.setAttribute('aria-controls', form.id);
    addButton.setAttribute('aria-expanded', 'false');
    const titleInput = el('input', 'phase4-input');
    titleInput.placeholder = 'Source title';
    titleInput.setAttribute('aria-label', 'Knowledge source title');
    titleInput.maxLength = 160;
    const textInput = el('textarea', 'phase4-textarea');
    textInput.setAttribute('aria-label', 'Knowledge source text');
    textInput.maxLength = 200000;
    textInput.placeholder = 'Paste notes, a job description, requirements, documentation, study material, or other reusable context…';
    const saveText = el('button', 'phase4-btn primary', 'Save source');
    form.append(titleInput, textInput, saveText);
    body.append(form);

    const searchRow = el('div', 'phase4-search-row');
    const searchInput = el('input', 'phase4-input');
    searchInput.setAttribute('aria-label', 'Test knowledge retrieval');
    searchInput.maxLength = 2000;
    searchInput.placeholder = 'Test retrieval…';
    const searchButton = el('button', 'phase4-btn', 'Search');
    searchRow.append(searchInput, searchButton);
    body.append(searchRow);
    const searchResults = el('div', 'phase4-list');
    body.append(searchResults);

    const list = el('div', 'phase4-list');
    body.append(list);

    const redraw = async () => {
        list.setAttribute('aria-busy', 'true');
        try {
            const status = await loadDocuments();
            if (status) {
                const fileSize = status.maxFileBytes / (1024 * 1024);
                const textLimit = status.maxTextChars.toLocaleString('en-US');
                importLimits.textContent = `Import up to ${status.maxImportFiles} files at a time. Each file can be up to ${fileSize} MiB with up to ${textLimit} characters of text.`;
            }
            const notices = [];
            if (status?.indexRepairPending) notices.push('Readable sources are available. Check folder permissions and refresh to save the repaired index.');
            else if (status?.indexBackup) notices.push('The knowledge index was rebuilt. A backup of the damaged index was kept.');
            if (status?.recoveredSources) {
                const count = status.recoveredSources;
                notices.push(`Recovered ${count} source${count === 1 ? '' : 's'} from disk.`);
            }
            if (status?.unreadableFiles?.length) {
                const count = status.unreadableFiles.length;
                notices.push(`${count} unreadable source ${count === 1 ? 'file was' : 'files were'} kept on disk.`);
            }
            if (state.documents.length >= status?.maxDocuments) {
                notices.push(`The library has ${state.documents.length} sources. Remove sources before adding new ones above the ${status.maxDocuments}-source limit.`);
            }
            libraryStatus.textContent = notices.join(' ');
            libraryStatus.hidden = !notices.length;
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
                toggle.setAttribute('aria-label', `Use ${document.title} for retrieval`);
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
                remove.setAttribute('aria-label', `Delete knowledge source ${document.title}`);
                remove.addEventListener('click', async () => {
                    remove.disabled = true;
                    try {
                        const result = await invoke('knowledge:delete', document.id);
                        if (result.cancelled) return;
                        await redraw();
                        refreshButton.focus();
                        statusLine(body, 'Knowledge source deleted.');
                    } catch (error) {
                        statusLine(body, error.message, true);
                    } finally {
                        if (remove.isConnected) {
                            remove.disabled = false;
                            remove.focus();
                        }
                    }
                });
                row.append(toggle, main, remove);
                list.append(row);
            }
        } catch (error) {
            libraryStatus.textContent = 'The Knowledge Library could not be refreshed. Check folder access and use Refresh to retry.';
            libraryStatus.hidden = false;
        }
        finally { list.setAttribute('aria-busy', 'false'); }
    };

    importButton.addEventListener('click', async () => {
        importButton.disabled = true;
        try {
            const result = await invoke('knowledge:import');
            if (result.cancelled) return;
            const imported = result.data?.imported?.length || 0;
            const failures = Array.isArray(result.data?.failed) ? result.data.failed : [];
            await redraw();
            const summary = `Imported ${imported} source${imported === 1 ? '' : 's'}.`;
            const skipped = failures.length ? ` Skipped ${failures.length} file${failures.length === 1 ? '' : 's'}.` : '';
            const line = statusLine(body, summary + skipped, failures.length > 0 && imported === 0);
            if (failures.length) {
                const details = el('details', 'phase4-note');
                details.dataset.workspaceStatus = 'true';
                details.append(el('summary', '', 'Skipped files'));
                const reasons = el('ul');
                for (const failure of failures) reasons.append(el('li', '', `${failure.name} — ${failure.error}`));
                details.append(reasons);
                line.after(details);
            }
        } catch (error) {
            statusLine(body, error.message, true);
        } finally {
            importButton.disabled = false;
        }
    });
    addButton.addEventListener('click', () => {
        const expanded = form.classList.toggle('visible');
        addButton.setAttribute('aria-expanded', String(expanded));
        if (expanded) titleInput.focus();
    });
    refreshButton.addEventListener('click', redraw);
    saveText.addEventListener('click', async () => {
        if (!textInput.value.trim()) return statusLine(body, 'Paste some text before saving.', true);
        saveText.disabled = true;
        const savedTitle = titleInput.value, savedText = textInput.value;
        try {
            await invoke('knowledge:add-text', savedTitle, savedText);
            if (titleInput.value === savedTitle) titleInput.value = '';
            if (textInput.value === savedText) textInput.value = '';
            if (!textInput.value) form.classList.remove('visible');
            addButton.setAttribute('aria-expanded', String(form.classList.contains('visible')));
            if (!form.classList.contains('visible') && form.contains(app.shadowRoot.activeElement)) addButton.focus();
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
                const source = el('details');
                const summary = el('summary', 'phase4-btn', 'View source excerpt');
                summary.setAttribute('aria-label', `View source excerpt from ${item.title}`);
                const excerpt = el('div');
                source.append(summary, excerpt);
                source.addEventListener('toggle', async () => {
                    if (!source.open) return;
                    excerpt.textContent = 'Loading source…';
                    try {
                        const { data } = await invoke('knowledge:excerpt', item.documentId, item.chunkId);
                        const lines = data.startLine === data.endLine ? `line ${data.startLine}` : `lines ${data.startLine}–${data.endLine}`;
                        excerpt.replaceChildren(
                            el('p', 'phase4-muted', `${data.sourceName || data.title} · ${data.sourceName ? 'imported copy' : 'saved text'} · ${lines}`),
                            el('div', 'phase4-result-text', data.text)
                        );
                    } catch (error) {
                        excerpt.replaceChildren();
                        statusLine(excerpt, error.message, true);
                    }
                });
                card.append(source);
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
    setup.append(el('div', 'phase4-muted', 'Choose a built-in topic, enabled knowledge, or a saved session. Practice runs locally.'));
    const sourceSelect = el('select', 'phase4-select');
    sourceSelect.setAttribute('aria-label', 'Practice source');
    sourceSelect.style.marginTop = '10px';
    const knowledgeOption = el('option', '', 'Enabled knowledge library');
    knowledgeOption.value = 'knowledge';
    sourceSelect.append(knowledgeOption);
    for (const [id, title] of [['sql', 'SQL'], ['python', 'Python'], ['data-engineering', 'Data engineering']]) {
        const option = el('option', '', title);
        option.value = `track:${id}`;
        sourceSelect.append(option);
    }
    try { await loadSessions(); } catch { setup.append(el('p', 'phase4-error', 'Saved sessions could not be loaded. Close and reopen Practice to retry. Your knowledge library remains available.')); }
    for (const session of state.sessions.slice(0, 60)) {
        const option = el('option', '', `Session · ${session.title || session.profile || 'Session'} · ${new Date(session.createdAt || Number(session.sessionId)).toLocaleDateString()}`);
        option.value = `session:${session.sessionId}`;
        sourceSelect.append(option);
    }
    if (state.practiceSource === 'session' && state.practiceSessionId) sourceSelect.value = `session:${state.practiceSessionId}`;
    if (state.practiceSource === 'track') sourceSelect.value = `track:${state.practiceTrackId}`;
    const generate = el('button', 'phase4-btn primary', 'Start practice');
    generate.style.marginTop = '9px';
    setup.append(sourceSelect, generate);

    const progress = el('div', 'phase4-card');
    progress.append(el('div', 'phase4-card-title', 'Practice history'));
    const historyText = el('div', 'phase4-muted', 'Practice history is stored locally.');
    progress.append(historyText);
    try {
        const history = await invoke('practice:history');
        const attempts = history.data || [];
        if (attempts.length) {
            const recent = attempts.filter(item => item.type !== 'recall' && Number.isFinite(item.score)).slice(0, 25);
            historyText.textContent = `${attempts.length} saved attempts.`;
            if (recent.length) {
                const average = Math.round(recent.reduce((sum, item) => sum + item.score, 0) / recent.length * 100);
                historyText.textContent += ` ${average}% across the latest ${recent.length} scored answers.`;
            }
        }
    } catch { historyText.textContent = 'Practice history could not be loaded. Reopen Practice to retry; existing attempts are unchanged.'; }
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
        const answer = question.type === 'choice' ? el('select', 'phase4-select') : el('textarea', 'phase4-textarea');
        answer.setAttribute('aria-label', 'Your practice answer');
        if (question.type === 'choice') {
            const placeholder = el('option', '', 'Choose an answer');
            placeholder.value = '';
            placeholder.disabled = true;
            placeholder.selected = true;
            answer.append(placeholder);
            question.choices.forEach((choice, index) => {
                const option = el('option', '', choice);
                option.value = String(index);
                answer.append(option);
            });
        } else {
            answer.maxLength = 5000;
            answer.placeholder = question.type === 'cloze' ? 'Enter the missing word…' : 'Answer in your own words…';
        }
        const controls = el('div', 'phase4-toolbar');
        controls.style.marginTop = '9px';
        const check = el('button', 'phase4-btn primary', 'Check answer');
        const next = el('button', 'phase4-btn', state.practiceIndex >= questions.length - 1 ? 'Restart set' : 'Next');
        const feedback = el('div', 'phase4-feedback');
        feedback.setAttribute('role', 'status');
        feedback.style.display = 'none';
        controls.append(check, next);
        practiceArea.append(answer, controls, feedback);
        check.addEventListener('click', async () => {
            if (!answer.value.trim()) { answer.focus(); return; }
            check.disabled = true;
            try {
                const result = await invoke('practice:grade', state.practice.setId, question.id, answer.value);
                feedback.className = `phase4-feedback ${result.data.level}`;
                feedback.style.display = 'block';
                const score = typeof result.data.score === 'number' ? `${Math.round(result.data.score * 100)}% · ` : '';
                feedback.textContent = `${score}${result.data.feedback}\n\nReference: ${result.data.reference}`;
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
            practiceArea.querySelector('textarea, select')?.focus();
        });
    };

    generate.addEventListener('click', async () => {
        generate.disabled = true;
        practiceArea.replaceChildren(el('div', 'phase4-empty', 'Building practice set…'));
        try {
            const value = sourceSelect.value;
            const options = value.startsWith('session:')
                ? { sourceType: 'session', sessionId: value.slice(8), count: 6 }
                : value.startsWith('track:') ? { sourceType: 'track', trackId: value.slice(6) }
                    : { sourceType: 'knowledge', count: 6 };
            const result = await invoke('practice:generate', options);
            state.practice = result.data;
            state.practiceIndex = 0;
            state.practiceSource = options.sourceType;
            state.practiceSessionId = options.sessionId || '';
            state.practiceTrackId = options.trackId || '';
            drawQuestion();
            if (app.shadowRoot.activeElement === generate || app.shadowRoot.activeElement === null) {
                practiceArea.querySelector('textarea, select')?.focus();
            }
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

    let detailEpoch = 0;
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
            button.append(el('div', 'phase4-session-title', session.title || session.profile || 'Session'));
            button.append(el('div', 'phase4-session-meta', `${Number.isNaN(date.getTime()) ? '' : date.toLocaleString()} · ${session.messageCount || 0} turns`));
            button.addEventListener('click', async () => {
                const epoch = ++detailEpoch;
                for (const sibling of sessionList.children) sibling.setAttribute('aria-pressed', String(sibling === button));
                detailCard.replaceChildren(el('div', 'phase4-empty', 'Building review…'));
                try {
                    const result = await invoke('review:get', session.sessionId);
                    if (epoch !== detailEpoch || !body.isConnected) return;
                    state.review = result.data;
                    drawDetail(result.data);
                } catch { if (epoch === detailEpoch) detailCard.replaceChildren(el('div', 'phase4-empty', 'This session could not be opened. Select it again to retry; other saved sessions are unchanged.')); }
            });
            sessionList.append(button);
        }
    } catch (error) {
        sessionList.replaceChildren(el('div', 'phase4-empty', 'Sessions could not be loaded. Your history has not been deleted.'));
        const retry = el('button', 'phase4-btn', 'Retry loading sessions');
        retry.addEventListener('click', () => renderReview(app, body));
        sessionList.append(retry);
    }
}

export async function openPanel(app, tab) {
    if (!app?.shadowRoot || !['knowledge', 'practice', 'review'].includes(tab)) return;
    state.tab = tab;
    app.workspaceTab = tab;
    await app.updateComplete;
    if (state.tab !== tab) return;
    const body = panelShell(app);
    if (tab === 'knowledge') await renderKnowledge(app, body);
    else if (tab === 'practice') await renderPractice(app, body);
    else await renderReview(app, body);
}

