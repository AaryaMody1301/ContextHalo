import { MARKER_TYPES, getRealtimeState, addMarker } from '../../utils/realtimeContextRenderer.js';
import { getContextState, expandQuickCommand, selectAndAnalyzeRegion } from '../../utils/contextCaptureRenderer.js';
import '../GroundingSources.js';
import { sanitizeAssistantHtml } from '../../utils/responseSanitizerRenderer.js';
import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class AssistantView extends LitElement {
    static styles = css`
        .secondary-body { display: grid; gap: 10px; }
        .secondary-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
        .secondary-body button { background: var(--bg-elevated); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; cursor: pointer; font: inherit; }
        .secondary-body button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .context-source { overflow-wrap: anywhere; font-size: 13px; }
        .phase3-transcript-history { overflow: visible; }
        .phase3-transcript-entry, .context-preview { white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
        .phase3-transcript-entry { margin: 6px 0; font-size: 13px; }
        .phase3-transcript-entry time { color: var(--text-secondary); margin-right: 8px; }
        .context-preview { margin: 8px 0; font-size: 13px; }

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

        /* Response area */

        .response-container {
            flex: 1;
            min-height: 100px;
            min-width: 0;
            overflow-wrap: anywhere;
            overflow-y: auto;
            font-size: var(--response-font-size, 15px);
            line-height: var(--line-height);
            background: transparent;
            padding: 12px 18px;
            text-shadow: var(--hud-text-shadow);
            scroll-behavior: auto;
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
            white-space: pre-wrap;
            overflow-wrap: anywhere;
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
            table-layout: fixed;
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
            background: transparent;
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
            background: transparent;
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
        .composer-state { padding: 0 16px 6px; font-size: 13px; color: var(--text-secondary); }
        .composer-state.error { color: var(--danger); user-select: text; }
        .response-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 16px; flex-shrink: 0; }
        .response-toolbar .copy-btn { margin-left: auto; }
        .response-toolbar .response-nav { padding: 0; border: 0; }
        .input-bar { flex-shrink: 0; flex-wrap: wrap; }
        .input-bar-inner { flex-basis: 240px; }
        @media (max-width: 540px) {
            .input-bar { display: grid; grid-template-columns: minmax(0, 1fr) auto; padding: 8px; gap: 6px; }
            .input-bar-inner { flex-basis: auto; }
            .input-bar > .copy-btn { grid-column: 1 / -1; justify-self: end; }
        }

        @media (prefers-reduced-motion: reduce) { * { animation: none !important; scroll-behavior: auto !important; } }
        .tools-dialog { position:fixed; inset:12px; width:auto; height:auto; max-width:none; max-height:none; margin:0; padding:0;
            display:flex; flex-direction:column; border:1px solid var(--border-strong); border-radius:12px;
            background:var(--bg-surface); color:var(--text-primary); -webkit-app-region:no-drag; }
        .tools-dialog:not([open]) { display:none; }
        .tools-dialog::backdrop { background:rgb(0 0 0 / .35); }
        .tools-heading { display:flex; align-items:center; gap:8px; padding:10px 14px; flex-shrink:0; border-bottom:1px solid var(--border); }
        .tools-heading h2 { font-size:16px; margin:0 auto 0 0; }
        .tools-heading button, .tools-tab { padding:7px 10px; min-height:32px; font:inherit; font-size:13px; background:var(--bg-elevated); color:var(--text-primary); border:1px solid var(--border); border-radius:6px; cursor:pointer; }
        .tools-tabs { display:flex; flex-wrap:wrap; gap:8px; padding:10px 14px 0; flex-shrink:0; }
        .tools-tab[aria-pressed="true"] { border-color:var(--accent); color:var(--accent); }
        .secondary-body { padding:14px; overflow-y:auto; flex:1; min-height:0; font-size:14px; line-height:1.6; }
        .secondary-body section, .secondary-body p { min-width:0; overflow-wrap:anywhere; }
        .secondary-controls button { min-height:34px; padding:7px 10px; }
        .response-container { padding:10px 16px; line-height:1.5; }
        .response-body > :first-child { margin-top:0; }
        .response-toolbar { padding:4px 10px; min-height:38px; gap:8px; flex-wrap:wrap; }
        .response-toolbar .nav-btn { min-width:32px; min-height:30px; }
        .response-toolbar button { font-size:13px; }
        .response-toolbar .copy-btn { margin-left:0; }
        .response-toolbar .tools-open { margin-left:auto; }
        .response-toolbar .response-nav { gap:2px; }
        .input-bar { padding:4px 10px; display:flex; flex-wrap:nowrap; }
        .input-bar-inner { flex-basis:auto; padding:6px 8px; align-items:center; gap:8px; }
        .input-bar-inner textarea { min-height:38px; max-height:100px; height:38px; font-size:14px; line-height:1.4; }
        .analyze-btn { border-radius:8px; padding:7px 10px; height:32px; font-family:var(--font); }
        .composer-state { display:flex; align-items:center; gap:10px; flex-shrink:0; min-height:24px; padding:0 12px 4px; font-size:13px; color:var(--text-secondary); }
        .composer-state button { background:none; border:0; padding:2px; text-decoration:underline; color:var(--text-primary); cursor:pointer; font:inherit; }
        .composer-state span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
        :focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
        @media (max-height:400px) { .tools-dialog { inset:8px; } .tools-heading { padding:8px 12px; } .secondary-body { padding:12px; } }
        @media (prefers-reduced-motion:reduce) { *, *::before, *::after { animation:none !important; transition:none !important; scroll-behavior:auto !important; } }
    `;

    static properties = {
        regionSelecting: { state: true },
        onOpenKnowledge: { attribute: false },
        responses: { type: Array },
        currentResponseIndex: { type: Number },
        selectedProfile: { type: String },
        onSendText: { type: Function },
        onAnalyzeScreen: { type: Function },
        onEndSession: { attribute:false }, onHideWindow: { attribute:false }, onShowError: { attribute:false },
        toolsTab: { state:true }, toolsOpen: { state:true },
        shouldAnimateResponse: { type: Boolean },
        isAnalyzing: { type: Boolean, state: true },
        sending: { state: true },
        sendError: { state: true },
        draft: { state: true },
        copyStatus: { state: true },
        analysisError: { state: true },
        grounding: { type: Object },
        retryBlocked: { type: Boolean },
        shortcut: { type: String },
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
        this.analysisError = '';
        this._analysisController = null;
        this.toolsTab = 'transcript';
        this.toolsOpen = false;
        this._responseScroll = new Map();
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
            : `## ${profileNames[this.selectedProfile] || 'Session'} workspace\n\nAsk a question below or choose Analyze Screen. Live audio responses appear here when capture and the provider are ready.`;
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
        this._contextChanged = () => this.requestUpdate();
        window.addEventListener('session-context-changed', this._contextChanged);
        window.addEventListener('realtime-context-changed', this._contextChanged);
        this._selectionChanged = () => this.updateResponseContent();
        document.addEventListener('selectionchange', this._selectionChanged);

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
        window.removeEventListener('session-context-changed', this._contextChanged);
        window.removeEventListener('realtime-context-changed', this._contextChanged);
        document.removeEventListener('selectionchange', this._selectionChanged);
        this.cancelAnalysis();
        this.shadowRoot.querySelector('.tools-dialog')?.close();


        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            if (this.handlePreviousResponse) ipcRenderer.removeListener('navigate-previous-response', this.handlePreviousResponse);
            if (this.handleNextResponse) ipcRenderer.removeListener('navigate-next-response', this.handleNextResponse);
            if (this.handleScrollUp) ipcRenderer.removeListener('scroll-response-up', this.handleScrollUp);
            if (this.handleScrollDown) ipcRenderer.removeListener('scroll-response-down', this.handleScrollDown);
        }
    }

    async handleSendText(options = {}) {
        if (this.sending || this.retryBlocked) return { success: false, error: 'A message is already in progress' };
        const input = this.shadowRoot.querySelector('#textInput');
        const message = typeof options.retryText === 'string' ? options.retryText : input?.value?.trim() || '';
        if (!message) return { success: false, error: 'Enter a message' };
        this.draft = input.value;
        this.sending = true;
        this.sendError = '';
        try {
            const result = message === '/screen' ? await this.handleScreenAnswer()
                : message === '/region' ? await selectAndAnalyzeRegion(this)
                    : await this.onSendText(expandQuickCommand(message) || message);
            if (result?.success !== true) throw new Error(result?.error || 'Message could not be sent');
            if (input.value.trim() === message) { input.value = ''; this.draft = ''; this._publishDraft(); }
            return result;
        } catch (error) {
            this.sendError = error?.message || String(error);
            return { success: false, error: this.sendError };
        } finally {
            this.sending = false;
        }
    }

    handleTextKeydown(event) {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            void this.handleSendText();
        }
    }

    _publishDraft() {
        this.dispatchEvent(new CustomEvent('draft-changed', { detail: this.draft, bubbles: true, composed: true }));
    }

    cancelAnalysis() {
        this._analysisController?.abort();
    }

    async handleScreenAnswer(options = {}) {
        if (this.isAnalyzing || this.retryBlocked) return { success: false, error: 'Screen analysis is already running' };
        const controller = new AbortController();
        this._analysisController = controller;
        this.isAnalyzing = true;
        this.analysisError = '';
        const timer = setTimeout(() => controller.abort(), 65000);
        try {
            if (!this.onAnalyzeScreen && typeof window.captureManualScreenshot !== 'function') throw new Error('Screen capture is not ready.');
            const captureOptions = { signal: controller.signal, region: options.region };
            const result = this.onAnalyzeScreen ? await this.onAnalyzeScreen(captureOptions) : await window.captureManualScreenshot(null, captureOptions);
            if (result?.success !== true) throw new Error(result?.error || 'Screen analysis failed.');
            if ('text' in result && !String(result.text || '').trim()) throw new Error('The provider returned no answer. Review model settings and retry.');
            return result;
        } catch (error) {
            this.analysisError = controller.signal.aborted ? 'Screen analysis cancelled. Your draft is unchanged.' : error?.message || 'Screen analysis failed.';
            return { success: false, error: this.analysisError };
        } finally {
            clearTimeout(timer);
            if (this._analysisController === controller) this._analysisController = null;
            this.isAnalyzing = false;
        }
    }

    handleResponseLink(event) {
        const anchor = event.target?.closest?.('a[href]');
        if (!anchor) return;
        event.preventDefault();
        event.stopPropagation();
        void window.electronAPI.invoke('open-external', anchor.href).catch(() => {
            this.sendError = 'This source link could not be opened.';
        });
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

    canFollowResponse() {
        const container = this.shadowRoot.querySelector('#responseContainer');
        if (!container) return true;
        const body = container.querySelector('.response-body');
        const selection = document.getSelection?.();
        const reading = body?.contains(this.shadowRoot.activeElement)
            || (selection && !selection.isCollapsed && body?.contains(selection.anchorNode));
        return !reading && container.scrollHeight - container.scrollTop - container.clientHeight < 24;
    }

    updateResponseContent() {
        const container = this.shadowRoot.querySelector('#responseContainer');
        if (!container) return;
        const currentResponse = this.getCurrentResponse();
        const index = this.currentResponseIndex;
        if (this._renderedResponseText === currentResponse && this._renderedResponseIndex === index) return;
        const body = container.querySelector('.response-body');
        if (!body) return;
        // Do not destroy a keyboard-focused source link or an active text selection.
        const selection = document.getSelection?.();
        if (body.contains(this.shadowRoot.activeElement) || (selection && !selection.isCollapsed && body.contains(selection.anchorNode))) return;
        const previousTop = container.scrollTop;
        const switching = this._renderedResponseIndex !== index;
        const nearBottom = container.scrollHeight - previousTop - container.clientHeight < 24;
        this._responseScroll ||= new Map();
        if (switching && this._renderedResponseIndex !== undefined) this._responseScroll.set(this._renderedResponseIndex, previousTop);
        body.innerHTML = this.renderMarkdown(currentResponse);
        container.scrollTop = switching ? this._responseScroll.get(index) || 0 : nearBottom ? container.scrollHeight : previousTop;
        this._renderedResponseIndex = index;
        this._renderedResponseText = currentResponse;
        if (this.shouldAnimateResponse) this.dispatchEvent(new CustomEvent('response-animation-complete', { bubbles:true, composed:true }));
    }

    async openTools() {
        this.toolsOpen = true;
        await this.updateComplete;
        const dialog = this.shadowRoot.querySelector('.tools-dialog');
        if (this.isConnected && dialog && !dialog.open) dialog.showModal();
    }

    closeTools() {
        this.shadowRoot.querySelector('.tools-dialog')?.close();
        this.toolsOpen = false;
    }

    openKnowledge() {
        this.closeTools();
        this.onOpenKnowledge?.();
    }

    analyzeRegion() {
        this.closeTools();
        return selectAndAnalyzeRegion(this);
    }

    async runQuickCommand(command) {
        // Toolbar commands never overwrite a composed draft.
        if (this.sending || this.retryBlocked) return;
        this.sending = true; this.sendError = '';
        try {
            const result = await this.onSendText(expandQuickCommand(command) || command);
            if (!result?.success) throw new Error(result?.error || 'The request failed. Try again.');
        } catch (error) { this.sendError = error.message; }
        finally { this.sending = false; }
    }

    renderSecondary() {
        const realtime = getRealtimeState();
        const { sessionPack: pack, captureState } = getContextState();
        return html`<dialog class="tools-dialog secondary-panels" aria-labelledby="tools-title" @close=${() => { this.toolsOpen = false; }}>
            <div class="tools-heading"><h2 id="tools-title">Session tools</h2>
                <button type="button" @click=${() => { this.closeTools(); this.onEndSession?.(); }}>End session</button>
                <button type="button" @click=${() => { this.closeTools(); this.onHideWindow?.(); }}>Hide</button>
                <button type="button" aria-label="Close session tools" @click=${this.closeTools}>Close</button></div>
            <div class="tools-tabs" role="group" aria-label="Tool workspace">
                <button type="button" class="tools-tab phase3-transcript-toggle" aria-pressed=${this.toolsTab === 'transcript' ? 'true' : 'false'} @click=${() => { this.toolsTab = 'transcript'; }}>Transcript</button>
                <button type="button" class="tools-tab phase3-context-toggle" aria-pressed=${this.toolsTab === 'context' ? 'true' : 'false'} @click=${() => { this.toolsTab = 'context'; }}>Context</button>
                <button type="button" class="tools-tab" aria-pressed=${this.toolsTab === 'actions' ? 'true' : 'false'} @click=${() => { this.toolsTab = 'actions'; }}>Actions</button>
                <button type="button" class="tools-tab" @click=${this.openKnowledge}>Knowledge Library</button>
            </div>
            <div class="secondary-body" tabindex="0" aria-label=${`${this.toolsTab} workspace`}>
                ${this.toolsTab === 'transcript' ? html`
                    <section class="phase3-transcript-history" aria-label="Live transcript">
                        ${(realtime.transcriptEntries || []).length ? realtime.transcriptEntries.map(entry => html`<p class="phase3-transcript-entry"><time>${new Date(entry.timestamp).toLocaleTimeString()}</time>${entry.text}</p>`) : html`<p>No speech has been transcribed yet. Audio must be available and the provider connected.</p>`}
                        ${realtime.interimTranscript ? html`<p class="phase3-transcript-entry">${realtime.interimTranscript.text} (in progress)</p>` : ''}
                    </section>
                    <div class="secondary-controls" role="group" aria-label="Mark an important moment">${MARKER_TYPES.map(marker => html`
                        <button type="button" @click=${() => addMarker(marker.id)}>${marker.label}</button>`)}</div>
                    ${realtime.notice ? html`<p role="status">${realtime.notice}</p>` : ''}
                ` : this.toolsTab === 'context' ? html`
                    <section class="phase3-context-inspector" aria-label="Included session context">
                        <h3>${pack.title || 'Untitled session'}</h3><p class="context-preview">${pack.goal || 'No session goal added.'}</p>
                        <p class="context-preview">${pack.notes || 'No context notes added.'}</p>
                        <p class="context-preview">${pack.clipboardText ? `Clipboard context: ${pack.clipboardText}` : 'Clipboard context is not included.'}</p>
                    </section>
                ` : html`
                    <p class="context-source">Selected capture: ${captureState?.label || 'Display hosting ContextHalo'}</p>
                    <div class="secondary-controls phase3-capture-tools"><button type="button" ?disabled=${this.isAnalyzing || this.regionSelecting || this.retryBlocked} @click=${this.analyzeRegion}>${this.regionSelecting ? 'Selecting region...' : 'Analyze region'}</button></div>
                    <h3>Quick requests</h3><p>These do not replace the draft in your composer.</p>
                    <div class="secondary-controls" role="group" aria-label="Quick requests">${[['/say', 'What to say'], ['/shorter', 'Shorter'], ['/explain', 'Explain'], ['/recap', 'Recap'], ['/actions', 'Actions'], ['/decisions', 'Decisions'], ['/questions', 'Questions']].map(([command, label]) => html`
                        <button type="button" ?disabled=${this.sending || this.retryBlocked} @click=${() => this.runQuickCommand(command)}>${label}</button>`)}</div>
                `}
                ${realtime.error ? html`<p role="alert">${realtime.error}</p>` : ''}
            </div>
        </dialog>`;
    }

    render() {
        const hasMultipleResponses = this.responses.length > 1;

        return html`
            ${this.renderSecondary()}
            <div class="response-container" id="responseContainer" aria-label="Assistant response" tabindex="0" @click=${this.handleResponseLink} @focusout=${() => queueMicrotask(() => this.updateResponseContent())}><div class="response-body"></div><grounding-sources .grounding=${this.grounding}></grounding-sources></div>
            <div class="response-toolbar">
            ${hasMultipleResponses ? html`
                <div class="response-nav">
                    <button class="nav-btn" @click=${this.navigateToPreviousResponse} ?disabled=${this.currentResponseIndex <= 0} title="Previous response" aria-label="Previous response">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clip-rule="evenodd" />
                        </svg>
                    </button>
                    <span class="response-counter">${this.currentResponseIndex + 1} of ${this.responses.length}</span>
                    <button class="nav-btn" @click=${this.navigateToNextResponse} ?disabled=${this.currentResponseIndex >= this.responses.length - 1} title="Next response" aria-label="Next response">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </div>
            ` : ''}
                <button type="button" class="copy-btn tools-open" aria-haspopup="dialog" aria-expanded=${this.toolsOpen ? 'true' : 'false'} @click=${this.openTools}>Tools</button>
                ${this.isAnalyzing ? html`<button type="button" class="analyze-btn" @click=${this.cancelAnalysis}>Cancel analysis</button>` : html`
                    <button type="button" class="analyze-btn" ?disabled=${this.retryBlocked || this.regionSelecting} @click=${() => this.handleScreenAnswer()} title=${`Analyze the selected screen (${this.shortcut || 'Ctrl+Enter'})`}>Analyze Screen</button>`}
                <button class="copy-btn" @click=${this.copyResponse} ?disabled=${!this.responses.length}>${this.copyStatus || 'Copy response'}</button>
            </div>

            <div class="input-bar">
                <div class="input-bar-inner">
                    <textarea id="textInput" rows="2" maxlength="32000"
                        aria-label="Ask about this live session" placeholder="Ask about this live session..."
                        .value=${this.draft} @input=${event => { this.draft = event.target.value; this.sendError = ''; this._publishDraft(); }}
                        @keydown=${this.handleTextKeydown}></textarea>
                    <button type="button" class="send-btn" aria-label="Send message"
                        ?disabled=${this.sending || this.retryBlocked || !this.draft.trim()} @click=${this.handleSendText}>${this.sending ? 'Sending...' : 'Send'}</button>
                </div>
            </div>
            <div class="composer-state ${this.sendError || this.analysisError ? 'error' : ''}">
                <span role="status">${this.sendError ? 'Message not sent. Your draft is kept.' : this.analysisError ? 'Screen analysis needs attention.' : this.isAnalyzing ? 'Waiting for a complete screen answer. Cancel stops the request.' : this.sending ? 'Waiting for the provider. Your draft is kept.' : 'Enter to send. Shift+Enter for a new line.'}</span>
                ${this.sendError || this.analysisError ? html`<button type="button" @click=${() => this.onShowError?.(this.sendError || this.analysisError, this.sendError ? 'text' : 'screen')}>Details</button>` : ''}
            </div>
        `;
    }
}

customElements.define('assistant-view', AssistantView);
