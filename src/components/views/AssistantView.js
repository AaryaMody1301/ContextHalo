import { sanitizeAssistantHtml } from '../../utils/responseSanitizerRenderer.js';
import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class AssistantView extends LitElement {
    static styles = css`
        :host {
            box-sizing: border-box;
            height: 100%;
            min-height: 0;
            min-width: 0;
            display: flex;
            flex-direction: column;
        }

        * {
            box-sizing: border-box;
            font-family: var(--font);
            cursor: default;
        }

        /* ── Response area ── */

        .response-container {
            flex: 1;
            min-height: 0;
            min-width: 0;
            overflow-wrap: anywhere;
            overflow-y: auto;
            font-size: var(--response-font-size, 15px);
            line-height: var(--line-height);
            background: var(--bg-app);
            padding: var(--space-sm) var(--space-md);
            scroll-behavior: smooth;
            user-select: text;
            cursor: text;
            color: var(--text-primary);
        }

        .response-container * {
            user-select: text;
            cursor: text;
        }

        .response-container a {
            cursor: pointer;
        }

        .response-container [data-word] {
            display: inline-block;
        }

        /* ── Markdown ── */

        .response-container h1,
        .response-container h2,
        .response-container h3,
        .response-container h4,
        .response-container h5,
        .response-container h6 {
            margin: 1em 0 0.5em 0;
            color: var(--text-primary);
            font-weight: var(--font-weight-semibold);
        }

        .response-container h1 { font-size: 1.5em; }
        .response-container h2 { font-size: 1.3em; }
        .response-container h3 { font-size: 1.15em; }
        .response-container h4 { font-size: 1.05em; }
        .response-container h5,
        .response-container h6 { font-size: 1em; }

        .response-container p {
            margin: 0.6em 0;
            color: var(--text-primary);
        }

        .response-container ul,
        .response-container ol {
            margin: 0.6em 0;
            padding-left: 1.5em;
            color: var(--text-primary);
        }

        .response-container li {
            margin: 0.3em 0;
        }

        .response-container blockquote {
            margin: 0.8em 0;
            padding: 0.5em 1em;
            border-left: 2px solid var(--border-strong);
            background: var(--bg-surface);
            border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
        }

        .response-container code {
            background: var(--bg-elevated);
            padding: 0.15em 0.4em;
            border-radius: var(--radius-sm);
            font-family: var(--font-mono);
            font-size: 0.85em;
        }

        .response-container pre {
            background: var(--bg-surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: var(--space-md);
            overflow-x: auto;
            margin: 0.8em 0;
        }

        .response-container pre code {
            background: none;
            padding: 0;
        }

        .response-container a {
            color: var(--accent);
            text-decoration: underline;
            text-underline-offset: 2px;
        }

        .response-container strong,
        .response-container b {
            font-weight: var(--font-weight-semibold);
        }

        .response-container hr {
            border: none;
            border-top: 1px solid var(--border);
            margin: 1.5em 0;
        }

        .response-container table {
            border-collapse: collapse;
            width: 100%;
            margin: 0.8em 0;
        }

        .response-container th,
        .response-container td {
            border: 1px solid var(--border);
            padding: var(--space-sm);
            text-align: left;
        }

        .response-container th {
            background: var(--bg-surface);
            font-weight: var(--font-weight-semibold);
        }

        .response-container::-webkit-scrollbar {
            width: 6px;
        }

        .response-container::-webkit-scrollbar-track {
            background: transparent;
        }

        .response-container::-webkit-scrollbar-thumb {
            background: var(--border-strong);
            border-radius: 3px;
        }

        .response-container::-webkit-scrollbar-thumb:hover {
            background: #444444;
        }

        /* ── Response navigation strip ── */

        .response-nav {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-sm);
            padding: var(--space-xs) var(--space-md);
            border-top: 1px solid var(--border);
            background: var(--bg-app);
        }

        .nav-btn {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: var(--space-xs);
            border-radius: var(--radius-sm);
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color var(--transition);
        }

        .nav-btn:hover:not(:disabled) {
            color: var(--text-primary);
        }

        .nav-btn:disabled {
            opacity: 0.25;
            cursor: default;
        }

        .nav-btn svg {
            width: 14px;
            height: 14px;
        }

        .response-counter {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            font-family: var(--font-mono);
            min-width: 40px;
            text-align: center;
        }

        /* ── Bottom input bar ── */

        .input-bar {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            padding: var(--space-md);
            background: var(--bg-app);
        }

        .input-bar-inner {
            display: flex;
            align-items: center;
            flex: 1;
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            min-width: 0;
            border-radius: 12px;
            padding: 6px 10px;
            min-height: 36px;
            height: auto;
            transition: border-color var(--transition);
        }

        .input-bar-inner:focus-within {
            border-color: var(--accent);
        }

        .input-bar-inner textarea {
            flex: 1;
            background: none;
            color: var(--text-primary);
            border: none;
            padding: 0;
            font-size: var(--font-size-sm);
            font-family: var(--font);
            height: 100%;
            outline: none;
            min-width: 0;
            width: 100%;
            resize: vertical;
            min-height: 24px;
            max-height: 120px;
            user-select: text;
        }

        .input-bar-inner textarea::placeholder {
            color: var(--text-muted);
        }

        .analyze-btn {
            position: relative;
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            color: var(--text-primary);
            cursor: pointer;
            font-size: var(--font-size-xs);
            font-family: var(--font-mono);
            white-space: nowrap;
            padding: var(--space-xs) var(--space-md);
            border-radius: 100px;
            height: 32px;
            display: flex;
            align-items: center;
            gap: 4px;
            transition: border-color 0.4s ease, background var(--transition);
            flex-shrink: 0;
            overflow: hidden;
        }

        .analyze-btn:hover:not(.analyzing) {
            border-color: var(--accent);
            background: var(--bg-surface);
        }

        .analyze-btn.analyzing {
            cursor: default;
            border-color: transparent;
        }

        .analyze-btn-content {
            display: flex;
            align-items: center;
            gap: 4px;
            transition: opacity 0.4s ease;
            z-index: 1;
            position: relative;
        }

        .analyze-btn.analyzing .analyze-btn-content { opacity: 0.65; }

        .send-btn, .copy-btn {
            border: 1px solid var(--border-strong); border-radius: 8px;
            background: var(--bg-elevated); color: var(--text-primary);
            padding: 7px 10px; cursor: pointer; flex-shrink: 0;
        }
        .send-btn:disabled { opacity: 0.5; cursor: default; }
        button:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .composer-state { padding: 0 16px 6px; font-size: 12px; color: var(--text-secondary); }
        .composer-state.error { color: var(--danger); user-select: text; }
        .response-toolbar { display: flex; justify-content: flex-end; padding: 4px 16px; }
        .input-bar { flex-shrink: 0; flex-wrap: wrap; }
        .input-bar-inner { flex-basis: 240px; }
        @media (max-width: 540px) {
            .input-bar { padding: 8px; gap: 6px; }
            .input-bar-inner { flex-basis: 100%; }
            .analyze-btn { margin-left: auto; }
        }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; scroll-behavior: auto !important; } }
    `;

    static properties = {
        responses: { type: Array },
        currentResponseIndex: { type: Number },
        selectedProfile: { type: String },
        onSendText: { type: Function },
        shouldAnimateResponse: { type: Boolean },
        isAnalyzing: { type: Boolean, state: true },
        sending: { state: true },
        sendError: { state: true },
        draft: { state: true },
        copyStatus: { state: true },
    };

    constructor() {
        super();
        this.responses = [];
        this.currentResponseIndex = -1;
        this.selectedProfile = 'interview';
        this.onSendText = async () => ({ success: false, error: 'Session is not ready' });
        this.isAnalyzing = false;
        this.sending = false;
        this.sendError = '';
        this.draft = '';
        this.copyStatus = '';
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

    getCurrentResponse() {
        const profileNames = this.getProfileNames();
        return this.responses.length > 0 && this.currentResponseIndex >= 0
            ? this.responses[this.currentResponseIndex]
            : `Listening to your ${profileNames[this.selectedProfile] || 'session'}...`;
    }

    renderMarkdown(content) {
        const text = String(content || '');
        try {
            return sanitizeAssistantHtml(window.marked
                ? window.marked.parse(text, { breaks: true, gfm: true })
                : this.escapeText(text));
        } catch {
            return this.escapeText(text);
        }
    }

    escapeText(text) {
        const node = document.createElement('span');
        node.textContent = text;
        return node.innerHTML;
    }

    async copyResponse() {
        try {
            await navigator.clipboard.writeText(String(this.getCurrentResponse()));
            this.copyStatus = 'Copied';
        } catch { this.copyStatus = 'Copy failed'; }
    }

    navigateToPreviousResponse() {
        if (this.currentResponseIndex > 0) {
            this.currentResponseIndex--;
            this.dispatchEvent(
                new CustomEvent('response-index-changed', {
                    detail: { index: this.currentResponseIndex },
                })
            );
            this.requestUpdate();
        }
    }

    navigateToNextResponse() {
        if (this.currentResponseIndex < this.responses.length - 1) {
            this.currentResponseIndex++;
            this.dispatchEvent(
                new CustomEvent('response-index-changed', {
                    detail: { index: this.currentResponseIndex },
                })
            );
            this.requestUpdate();
        }
    }

    scrollResponseUp() {
        const container = this.shadowRoot.querySelector('.response-container');
        if (container) {
            const scrollAmount = container.clientHeight * 0.3;
            container.scrollTop = Math.max(0, container.scrollTop - scrollAmount);
        }
    }

    scrollResponseDown() {
        const container = this.shadowRoot.querySelector('.response-container');
        if (container) {
            const scrollAmount = container.clientHeight * 0.3;
            container.scrollTop = Math.min(container.scrollHeight - container.clientHeight, container.scrollTop + scrollAmount);
        }
    }

    connectedCallback() {
        super.connectedCallback();

        if (window.require) {
            const { ipcRenderer } = window.require('electron');

            this.handlePreviousResponse = () => this.navigateToPreviousResponse();
            this.handleNextResponse = () => this.navigateToNextResponse();
            this.handleScrollUp = () => this.scrollResponseUp();
            this.handleScrollDown = () => this.scrollResponseDown();

            ipcRenderer.on('navigate-previous-response', this.handlePreviousResponse);
            ipcRenderer.on('navigate-next-response', this.handleNextResponse);
            ipcRenderer.on('scroll-response-up', this.handleScrollUp);
            ipcRenderer.on('scroll-response-down', this.handleScrollDown);
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();


        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            if (this.handlePreviousResponse) ipcRenderer.removeListener('navigate-previous-response', this.handlePreviousResponse);
            if (this.handleNextResponse) ipcRenderer.removeListener('navigate-next-response', this.handleNextResponse);
            if (this.handleScrollUp) ipcRenderer.removeListener('scroll-response-up', this.handleScrollUp);
            if (this.handleScrollDown) ipcRenderer.removeListener('scroll-response-down', this.handleScrollDown);
        }
    }

    async handleSendText() {
        if (this.sending) return { success: false, error: 'A message is already in progress' };
        const input = this.shadowRoot.querySelector('#textInput');
        const message = input?.value?.trim() || '';
        if (!message) return { success: false, error: 'Enter a message' };
        this.draft = input.value;
        this.sending = true;
        this.sendError = '';
        try {
            const result = await this.onSendText(message);
            if (result?.success !== true) throw new Error(result?.error || 'Message could not be sent');
            if (input.value.trim() === message) { input.value = ''; this.draft = ''; }
            return result;
        } catch (error) {
            this.sendError = error?.message || String(error);
            return { success: false, error: this.sendError };
        } finally {
            this.sending = false;
            input?.focus();
        }
    }

    handleTextKeydown(event) {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            void this.handleSendText();
        }
    }

    async handleScreenAnswer() {
        if (this.isAnalyzing) return;
        this.isAnalyzing = true;
        try { return await window.captureManualScreenshot?.(); }
        finally { this.isAnalyzing = false; }
    }

    scrollToBottom() {
        setTimeout(() => {
            const container = this.shadowRoot.querySelector('.response-container');
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }, 0);
    }

    firstUpdated() {
        super.firstUpdated();
        this.updateResponseContent();
    }

    updated(changedProperties) {
        super.updated(changedProperties);
        if (changedProperties.has('responses') || changedProperties.has('currentResponseIndex')) {
            this.updateResponseContent();
        }

    }

    updateResponseContent() {
        const container = this.shadowRoot.querySelector('#responseContainer');
        if (container) {
            const currentResponse = this.getCurrentResponse();
            const renderedResponse = this.renderMarkdown(currentResponse);
            const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
            container.innerHTML = renderedResponse;
            if (nearBottom) container.scrollTop = container.scrollHeight;
            if (this.shouldAnimateResponse) {
                this.dispatchEvent(new CustomEvent('response-animation-complete', { bubbles: true, composed: true }));
            }
        }
    }

    render() {
        const hasMultipleResponses = this.responses.length > 1;

        return html`
            <div class="response-container" id="responseContainer" aria-label="Assistant response"></div>
            <div class="response-toolbar"><button class="copy-btn" @click=${this.copyResponse} ?disabled=${!this.responses.length}>${this.copyStatus || 'Copy response'}</button></div>

            ${hasMultipleResponses ? html`
                <div class="response-nav">
                    <button class="nav-btn" @click=${this.navigateToPreviousResponse} ?disabled=${this.currentResponseIndex <= 0} title="Previous response">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clip-rule="evenodd" />
                        </svg>
                    </button>
                    <span class="response-counter">${this.currentResponseIndex + 1} of ${this.responses.length}</span>
                    <button class="nav-btn" @click=${this.navigateToNextResponse} ?disabled=${this.currentResponseIndex >= this.responses.length - 1} title="Next response">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </div>
            ` : ''}

            <div class="input-bar">
                <div class="input-bar-inner">
                    <textarea id="textInput" rows="2" maxlength="32000"
                        aria-label="Ask about this live session" placeholder="Ask about this live session..."
                        .value=${this.draft} @input=${event => { this.draft = event.target.value; this.sendError = ''; }}
                        @keydown=${this.handleTextKeydown}></textarea>
                    <button type="button" class="send-btn" aria-label="Send message"
                        ?disabled=${this.sending || !this.draft.trim()} @click=${this.handleSendText}>${this.sending ? 'Sending...' : 'Send'}</button>
                </div>
                <button class="analyze-btn ${this.isAnalyzing ? 'analyzing' : ''}" @click=${this.handleScreenAnswer}>
                    <span class="analyze-btn-content">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24">
                            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 3v7h6l-8 11v-7H5z" />
                        </svg>
                        ${this.isAnalyzing ? 'Analyzing...' : 'Analyze Screen'}
                    </span>
                </button>
            </div>
            <div class="composer-state ${this.sendError ? 'error' : ''}" role=${this.sendError ? 'alert' : 'status'}>
                ${this.sendError || (this.sending ? 'Waiting for the selected provider. Your draft is preserved.' : 'Enter to send. Shift+Enter for a new line.')}
            </div>
        `;
    }
}

customElements.define('assistant-view', AssistantView);
