import '../GroundingSources.js';
import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { unifiedPageStyles } from './sharedPageStyles.js';

export class HistoryView extends LitElement {
    static styles = [
        unifiedPageStyles,
        css`
            .unified-page {
                overflow: visible;
            }

            .unified-wrap {
                min-height: 100%;
            }

            .search-wrap {
                position: relative;
                max-width: 280px;
            }

            .search-icon {
                position: absolute;
                left: 10px;
                top: 50%;
                transform: translateY(-50%);
                width: 14px;
                height: 14px;
                color: var(--text-muted);
                pointer-events: none;
            }

            .search-wrap .control {
                padding-left: 30px;
            }

            .list-shell {
                border: 1px solid var(--border);
                border-radius: var(--radius-md);
                background: var(--bg-surface);
                overflow: hidden;
                flex: 1;
                display: flex;
                flex-direction: column;
                min-height: 0;
            }

            .sessions-list {
                overflow: visible;
            }

            .session-card {
                width: 100%;
                border: none;
                border-bottom: 1px solid var(--border);
                background: transparent;
                text-align: left;
                padding: var(--space-sm) var(--space-md);
                cursor: pointer;
                transition: background var(--transition);
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: var(--space-sm);
            }

            .session-card:hover {
                background: var(--bg-hover);
            }

            .session-left {
                display: flex;
                flex-direction: column;
                gap: 6px;
                min-width: 0;
                overflow-wrap: anywhere;
            }

            .session-profile {
                color: var(--text-primary);
                font-size: var(--font-size-sm);
            }

            .session-date {
                color: var(--text-muted);
                font-size: var(--font-size-xs);
            }

            .session-badge {
                color: var(--text-secondary);
                font-size: var(--font-size-xs);
                background: var(--bg-elevated);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                padding: 2px 8px;
                white-space: nowrap;
            }

            .detail-top {
                display: flex;
                align-items: center;
                gap: var(--space-sm);
            }

            .back-btn {
                border: none;
                background: none;
                color: var(--text-muted);
                padding: 0;
                font-size: var(--font-size-sm);
                cursor: pointer;
                display: flex;
                align-items: center;
            }

            .back-btn svg {
                cursor: pointer;
            }

            .back-btn:hover {
                color: var(--text-primary);
            }

            .detail-info {
                color: var(--text-secondary);
                font-size: var(--font-size-sm);
            }

            .tab-row {
                display: flex;
                gap: 6px;
            }

            .tab-btn {
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: transparent;
                color: var(--text-muted);
                padding: 6px 10px;
                cursor: pointer;
                font-size: var(--font-size-xs);
            }

            .tab-btn:hover {
                color: var(--text-secondary);
            }

            .tab-btn.active {
                color: var(--text-primary);
                border-color: var(--text-secondary);
            }

            .details-scroll {
                overflow: visible;
                min-height: 0;
                display: flex;
                flex-direction: column;
                gap: var(--space-sm);
                padding: var(--space-sm) 0;
            }

            .message-row {
                display: flex;
            }

            .message-row.user {
                justify-content: flex-end;
            }

            .message-row.ai,
            .message-row.screen {
                justify-content: flex-start;
            }

            .message {
                max-width: min(90%, 70ch);
                border-radius: 16px;
                padding: 8px 12px;
                word-break: break-word;
                user-select: text;
                cursor: text;
                font-size: var(--font-size-sm);
                line-height: 1.45;
            }

            .message-body {
                white-space: pre-wrap;
            }

            .message-meta {
                font-size: 13px;
                margin-top: 4px;
                color: var(--text-secondary);
            }

            .message-row.user .message {
                background: var(--accent);
                color: var(--bg-app);
                border-bottom-right-radius: 4px;
            }

            .message-row.user .message-meta {
                text-align: right;
            }

            .message-row.ai .message {
                background: var(--bg-elevated);
                color: var(--text-primary);
                border: 1px solid var(--border);
                border-bottom-left-radius: 4px;
            }

            .message-row.screen .message {
                background: var(--bg-elevated);
                color: var(--text-primary);
                border: 1px solid var(--border);
                border-bottom-left-radius: 4px;
            }

            .context-row {
                display: flex;
                align-items: flex-start;
                gap: var(--space-sm);
                padding: var(--space-sm);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: var(--bg-elevated);
            }

            .context-key {
                width: 84px;
                color: var(--text-muted);
                font-size: var(--font-size-xs);
                text-transform: uppercase;
                letter-spacing: 0.4px;
                flex-shrink: 0;
            }

            .context-value {
                color: var(--text-primary);
                font-size: var(--font-size-sm);
                line-height: 1.45;
                white-space: pre-wrap;
                word-break: break-word;
                user-select: text;
                cursor: text;
            }

            .empty {
                color: var(--text-muted);
                font-size: var(--font-size-sm);
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 120px;
                border: 1px dashed var(--border);
                border-radius: var(--radius-sm);
            }
        `,
    ];

    static properties = {
        sessions: { type: Array },
        selectedSession: { type: Object },
        selectedSessionId: { type: String },
        loading: { type: Boolean },
        activeTab: { type: String },
        searchQuery: { type: String },
        loadError: { state: true }, detailError: { state: true }, openingSession: { state: true },
    };

    constructor() {
        super();
        this.sessions = [];
        this.selectedSession = null;
        this.selectedSessionId = null;
        this.loading = true;
        this.activeTab = 'conversation';
        this.searchQuery = '';
        this.loadError = '';
        this.detailError = '';
        this.openingSession = '';
        this._listEpoch = 0;
        this._detailEpoch = 0;
        this.loadSessions();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._listEpoch++;
        this._detailEpoch++;
    }

    async loadSessions() {
        const epoch = ++this._listEpoch;
        this.loading = true;
        this.loadError = '';
        try {
            const sessions = await contextHalo.storage.getAllSessions();
            if (!Array.isArray(sessions)) throw new Error('Invalid history response');
            if (epoch === this._listEpoch) this.sessions = sessions;
            return true;
        } catch {
            if (epoch === this._listEpoch) this.loadError = 'History could not be loaded. Check folder permissions and retry. Previously loaded sessions are kept below.';
            return false;
        } finally {
            if (epoch === this._listEpoch) { this.loading = false; this.requestUpdate(); }
        }
    }

    async openSession(sessionId) {
        const epoch = ++this._detailEpoch;
        this._retrySessionId = sessionId;
        this.openingSession = sessionId;
        this.detailError = '';
        try {
            const session = await contextHalo.storage.getSession(sessionId);
            if (epoch !== this._detailEpoch) return false;
            if (!session) throw new Error('Missing session');
            this.selectedSession = session;
            this.selectedSessionId = sessionId;
            this.activeTab = 'conversation';
            this.requestUpdate();
            await this.updateComplete;
            // The user chose to open this detail, but may have moved focus meanwhile.
            const card = this.shadowRoot.activeElement;
            if (!card || card.dataset?.sessionId === sessionId) this.shadowRoot.querySelector('.back-btn')?.focus();
            return true;
        } catch {
            if (epoch === this._detailEpoch) this.detailError = 'This session could not be opened. It may be missing, unreadable or in an invalid format. Other history is unchanged.';
            return false;
        } finally { if (epoch === this._detailEpoch) this.openingSession = ''; }
    }

    async closeSession() {
        const id = this.selectedSessionId;
        this._detailEpoch++;
        this.selectedSession = null;
        this.selectedSessionId = null;
        this.activeTab = 'conversation';
        await this.updateComplete;
        this.shadowRoot.querySelector(`[data-session-id="${id}"]`)?.focus();
    }

    handleSearchInput(e) {
        this.searchQuery = e.target.value;
    }

    formatDate(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    getProfileNames() {
        return {
            interview: 'Job Interview',
            sales: 'Sales Call',
            meeting: 'Business Meeting',
            presentation: 'Presentation',
            negotiation: 'Negotiation',
            exam: 'Exam Assistant',
        };
    }

    _getProfileLabel(session) {
        if (session.profile) {
            const names = this.getProfileNames();
            return names[session.profile] || session.profile;
        }
        return 'Session';
    }

    getSessionTitle(session) {
        return String(session.title || session.sessionPack?.title || '').trim()
            || `${this._getProfileLabel(session)} - ${this.formatDate(session.createdAt || Number(session.sessionId || this.selectedSessionId))}`;
    }

    getSessionPreview(session) {
        const parts = [];
        if (session.messageCount > 0) parts.push(`${session.messageCount} messages`);
        if (session.screenAnalysisCount > 0) parts.push(`${session.screenAnalysisCount} screen`);
        if (session.profile) {
            const profileNames = this.getProfileNames();
            parts.push(profileNames[session.profile] || session.profile);
        }
        return parts.length > 0 ? parts.join(' · ') : 'Empty session';
    }

    getFilteredSessions() {
        if (!this.searchQuery.trim()) return this.sessions;
        const q = this.searchQuery.trim().normalize('NFKC').toLocaleLowerCase();
        return this.sessions.filter(session => {
            const preview = this.getSessionPreview(session).toLowerCase();
            const date = this.formatDate(session.createdAt).toLowerCase();
            return `${this.getSessionTitle(session)} ${preview} ${date}`.normalize('NFKC').toLocaleLowerCase().includes(q);
        });
    }

    collectConversation(session) {
        const messages = [];
        const history = Array.isArray(session.conversationHistory) ? session.conversationHistory : [];
        history.filter(turn => turn && typeof turn === 'object').forEach(turn => {
            if (turn.transcription) messages.push({ type: 'user', content: turn.transcription, timestamp: turn.timestamp });
            if (turn.ai_response) messages.push({ type: 'ai', content: turn.ai_response, timestamp: turn.timestamp, grounding: turn.grounding });
        });
        return messages;
    }

    renderTabContent() {
        if (!this.selectedSession) return html`<div class="empty">Select a session.</div>`;

        if (this.activeTab === 'conversation') {
            const messages = this.collectConversation(this.selectedSession);
            if (!messages.length) return html`<div class="empty">No conversation data.</div>`;
            return messages.map(msg => html`
                <div class="message-row ${msg.type}">
                    <div class="message">
                        <div class="message-body">${msg.content}</div><grounding-sources .grounding=${msg.grounding}></grounding-sources>
                        <div class="message-meta">${this.formatTime(msg.timestamp)}</div>
                    </div>
                </div>
            `);
        }

        if (this.activeTab === 'screen') {
            const screen = Array.isArray(this.selectedSession.screenAnalysisHistory) ? this.selectedSession.screenAnalysisHistory.filter(Boolean) : [];
            if (!screen.length) return html`<div class="empty">No screen analysis data.</div>`;
            return screen.map(entry => html`
                <div class="message-row screen">
                    <div class="message">
                        <div class="message-body">${entry.response || ''}</div><grounding-sources .grounding=${entry.grounding}></grounding-sources>
                        <div class="message-meta">${this.formatTime(entry.timestamp)}</div>
                    </div>
                </div>
            `);
        }

        const profile = this.selectedSession.profile;
        const prompt = this.selectedSession.customPrompt;
        if (!profile && !prompt) return html`<div class="empty">No context saved for this session.</div>`;

        return html`
            ${profile ? html`
                <div class="context-row">
                    <span class="context-key">Profile</span>
                    <span class="context-value">${this.getProfileNames()[profile] || profile}</span>
                </div>
            ` : ''}
            ${prompt ? html`
                <div class="context-row">
                    <span class="context-key">Prompt</span>
                    <span class="context-value">${prompt}</span>
                </div>
            ` : ''}
        `;
    }

    renderListView() {
        const filteredSessions = this.getFilteredSessions();
        return html`
            <div class="page-title">History</div>

            <label class="form-label" for="history-search">Search saved titles, profiles or dates</label>
            <div class="search-wrap">
                <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                    class="control"
                    type="text"
                    id="history-search"
                    placeholder="Search sessions..."
                    .value=${this.searchQuery}
                    @input=${this.handleSearchInput}
                />
            </div>

            <div class="save-feedback" role="status">
                ${this.loading ? 'Loading sessions...' : this.loadError || ''}
                ${this.loadError ? html`<button class="control" @click=${this.loadSessions} ?disabled=${this.loading}>Retry loading history</button>` : ''}
            </div>
            ${this.detailError ? html`<div class="save-feedback" role="alert"><span>${this.detailError}</span>
                <button class="control" @click=${() => this.openSession(this._retrySessionId)} ?disabled=${Boolean(this.openingSession)}>Retry opening session</button></div>` : ''}
            ${this.openingSession ? html`<p role="status">Opening session...</p>` : ''}
            <section class="list-shell" aria-label="Saved sessions" aria-busy=${this.loading ? 'true' : 'false'}>
                <div class="sessions-list">
                    ${this.loading ? html`<div class="empty" style="margin:var(--space-md);">Loading sessions...</div>` : ''}
                    ${!this.loading && !this.loadError && filteredSessions.length === 0 ? html`<div class="empty" style="margin:var(--space-md);">
                        ${this.searchQuery.trim() ? `No sessions match "${this.searchQuery}". Try another title, profile or date.` : 'Your saved sessions will appear here after your first session.'}
                    </div>` : ''}
                    ${filteredSessions.map(session => html`
                        <button class="session-card" data-session-id=${session.sessionId} @click=${() => this.openSession(session.sessionId)}>
                            <div class="session-left">
                                <span class="session-profile">${this.getSessionTitle(session)}</span>
                                <span class="session-date">${this.getSessionPreview(session)} · ${this.formatDate(session.createdAt)} · ${this.formatTime(session.createdAt)}</span>
                                ${session.unreadable ? html`<span class="session-date">This entry needs attention. Open for recovery options.</span>` : ''}
                            </div>
                            ${session.messageCount > 0 ? html`<span class="session-badge">${session.messageCount} turns</span>` : ''}
                        </button>
                    `)}
                </div>
            </section>
        `;
    }

    renderDetailView() {
        const conversationCount = this.collectConversation(this.selectedSession).length;
        const screenCount = this.selectedSession?.screenAnalysisHistory?.length || 0;

        return html`
            <h1 class="page-title">${this.getSessionTitle(this.selectedSession)}</h1>
            <div class="detail-top">
                <button class="back-btn" aria-label="Back to session history" @click=${this.closeSession}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="15 18 9 12 15 6"/>
                    </svg>
                </button>
                <span class="detail-info">${this._getProfileLabel(this.selectedSession)} · ${this.formatDate(this.selectedSession.createdAt)} · ${this.formatTime(this.selectedSession.createdAt)}</span>
            </div>
            <div class="tab-row">
                <button aria-pressed=${this.activeTab === 'conversation' ? 'true' : 'false'} class="tab-btn ${this.activeTab === 'conversation' ? 'active' : ''}" @click=${() => { this.activeTab = 'conversation'; }}>
                    Conversation (${conversationCount})
                </button>
                <button aria-pressed=${this.activeTab === 'screen' ? 'true' : 'false'} class="tab-btn ${this.activeTab === 'screen' ? 'active' : ''}" @click=${() => { this.activeTab = 'screen'; }}>
                    Screen (${screenCount})
                </button>
                <button aria-pressed=${this.activeTab === 'context' ? 'true' : 'false'} class="tab-btn ${this.activeTab === 'context' ? 'active' : ''}" @click=${() => { this.activeTab = 'context'; }}>
                    Context
                </button>
            </div>
            <section class="details-scroll">
                ${this.renderTabContent()}
            </section>
        `;
    }

    render() {
        return html`
            <div class="unified-page">
                <div class="unified-wrap">
                    ${this.selectedSession ? this.renderDetailView() : this.renderListView()}
                </div>
            </div>
        `;
    }
}

customElements.define('history-view', HistoryView);
