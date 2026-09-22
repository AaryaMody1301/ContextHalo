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
export class GroundingSources extends LitElement {
    static properties = { grounding: { type: Object }, error: { state: true } };
    static styles = css`
        :host { display: block; font: 12px/1.5 var(--font, system-ui); color: var(--text-secondary); }
        .sources { display: flex; flex-wrap: wrap; gap: 6px 12px; margin: 8px 0; }
        a { color: var(--link-color, #2563eb); overflow-wrap: anywhere; }
        a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
        iframe { border: 0; display: block; width: 100%; height: 64px; max-height: 160px; background: var(--bg-surface); border-radius: 6px; }
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
    render() {
        const value = this.grounding;
        if (!value) return html``;
        const suggestions = typeof value.renderedContent === 'string' ? value.renderedContent : '';
        return html`
            ${suggestions ? html`<iframe title="Google Search suggestions"
                sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"
                .srcdoc=${suggestions}></iframe>` : ''}
            <nav class="sources" aria-label="Answer sources">${(value.sources || []).map((source, index) => source && safeSourceUrl(source.uri)
                ? html`<a href=${source.uri} @click=${event => this.openSource(event, source.uri)}>[${index + 1}] ${source.title}</a>` : '')}</nav>
            ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : ''}
        `;
    }
}
customElements.define('grounding-sources', GroundingSources);
