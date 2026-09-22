import { LitElement, html, css } from '../assets/lit-core-3.3.3.min.js';

function safeSourceUrl(value) {
    try {
        const raw = String(value || '');
        const url = new URL(raw);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? raw : '';
    } catch { return ''; }
}

// Google supplies Search Suggestions as compliant HTML/CSS. Do not parse,
// sanitize, rewrite, or persist that provider fragment. It is rendered verbatim
// inside an opaque sandboxed iframe so it never joins the privileged app DOM.
class GoogleSearchSuggestions extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._content = '';
        this._click = event => {
            const anchor = event.composedPath().find(node => node?.tagName === 'A' && node.getAttribute?.('href'));
            if (!anchor) return;
            const url = safeSourceUrl(anchor.getAttribute('href'));
            if (!url) {
                event.preventDefault();
                return;
            }
            // Operational navigation only: do not log, persist, count, or
            // otherwise monitor which Search Suggestion the user selected.
            event.preventDefault();
            void window.electronAPI.invoke('open-external', url).catch(() => {});
        };
    }

    connectedCallback() {
        this.shadowRoot.addEventListener('click', this._click);
    }

    disconnectedCallback() {
        this.shadowRoot.removeEventListener('click', this._click);
    }

    set content(value) {
        const next = typeof value === 'string' ? value : '';
        if (next === this._content) return;
        this._content = next;
        // Provider content is inserted exactly as supplied. innerHTML-created
        // script elements are inert, and the application CSP also forbids
        // inline/provider scripts. The nested shadow root prevents provider CSS
        // from restyling the privileged ContextHalo UI.
        this.shadowRoot.innerHTML = next;
    }

    get content() {
        return this._content;
    }
}

if (!customElements.get('google-search-suggestions')) {
    customElements.define('google-search-suggestions', GoogleSearchSuggestions);
}

export class GroundingSources extends LitElement {
    static properties = { grounding: { type: Object }, error: { state: true } };
    static styles = css`
        :host { display: block; font: 12px/1.5 var(--font, system-ui); color: var(--text-secondary); }
        .sources { display: flex; flex-wrap: wrap; gap: 6px 12px; margin: 8px 0; }
        .sources a { color: var(--link-color, #2563eb); overflow-wrap: anywhere; }
        .sources a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
        google-search-suggestions { display: block; }
        .error { color: var(--danger); }
    `;
    constructor() { super(); this.grounding = null; this.error = ''; }
    async openSource(event, href) {
        event.preventDefault();
        const url = safeSourceUrl(href);
        if (!url) return;
        try {
            const result = await window.electronAPI.invoke('open-external', url);
            if (result?.success === false) throw new Error('Link failed');
        } catch { this.error = 'The source link could not be opened.'; }
    }
    updated() {
        const suggestions = this.shadowRoot.querySelector('google-search-suggestions');
        if (suggestions) suggestions.content = typeof this.grounding?.renderedContent === 'string' ? this.grounding.renderedContent : '';
    }
    render() {
        const value = this.grounding;
        if (!value) return html``;
        const hasSuggestions = typeof value.renderedContent === 'string' && value.renderedContent.length > 0;
        return html`
            ${hasSuggestions ? html`<google-search-suggestions aria-label="Google Search suggestions"></google-search-suggestions>` : ''}
            <nav class="sources" aria-label="Answer sources">${(value.sources || []).map((source, index) => source && safeSourceUrl(source.uri)
                ? html`<a href=${source.uri} @click=${event => this.openSource(event, source.uri)}>[${index + 1}] ${source.title}</a>` : '')}</nav>
            ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : ''}
        `;
    }
}
customElements.define('grounding-sources', GroundingSources);
