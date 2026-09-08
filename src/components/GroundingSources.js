import { LitElement, html, css } from '../assets/lit-core-2.7.4.min.js';

function safeSourceUrl(value) {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
}

// Google supplies Search Suggestions as HTML/CSS. Preserve that presentation in
// an isolated, scriptless document, never in the privileged app's document tree.
export function groundingDocument(value) {
    const doc = new DOMParser().parseFromString(String(value || '').slice(0, 128000), 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,base,meta,form,input,button,link,video,audio,source').forEach(node => node.remove());
    for (const element of doc.querySelectorAll('*')) {
        for (const attribute of [...element.attributes]) {
            const name = attribute.name.toLowerCase();
            if (name.startsWith('on') || ['srcdoc', 'formaction', 'target', 'xlink:href'].includes(name)) element.removeAttribute(attribute.name);
            else if (name === 'href' && !safeSourceUrl(attribute.value)) element.removeAttribute(attribute.name);
            else if (name === 'src' && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(attribute.value)) element.removeAttribute(attribute.name);
        }
    }
    return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'; frame-src \'none\'">'
        + '<style>body{margin:4px;font:13px system-ui;overflow-wrap:anywhere}a:focus-visible{outline:2px solid #2563eb;outline-offset:2px}</style>'
        + doc.head.innerHTML + '</head><body>' + doc.body.innerHTML + '</body></html>';
}

export class GroundingSources extends LitElement {
    static properties = { grounding: { type: Object }, error: { state: true } };
    static styles = css`
        :host { display: block; font: 12px/1.5 var(--font, system-ui); color: var(--text-secondary); }
        .sources { display: flex; flex-wrap: wrap; gap: 6px 12px; margin: 8px 0; }
        a { color: var(--link-color, #2563eb); overflow-wrap: anywhere; }
        a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
        iframe { border: 0; display: block; width: 100%; height: 64px; max-height: 160px; background: var(--bg-surface); border-radius: 6px; }
        .error { color: var(--error-color); }
    `;
    constructor() { super(); this.grounding = null; this.error = ''; this._documentSource = null; this._documentHtml = ''; }
    async openSource(event, href) {
        event.preventDefault();
        const url = safeSourceUrl(href);
        if (!url) return;
        try {
            const result = await window.electronAPI.invoke('open-external', url);
            if (result?.success === false) throw new Error('Link failed');
        } catch { this.error = 'The source link could not be opened.'; }
    }
    prepareAttribution(event) {
        const frame = event.target;
        const doc = frame.contentDocument;
        if (!doc) return;
        doc.addEventListener('click', click => {
            const anchor = click.target?.closest?.('a[href]');
            if (anchor) void this.openSource(click, anchor.getAttribute('href'));
        });
        frame.style.height = Math.min(160, Math.max(48, doc.documentElement.scrollHeight + 8)) + 'px';
    }
    render() {
        const value = this.grounding;
        if (!value) return html``;
        if (this._documentSource !== value.renderedContent) {
            this._documentSource = value.renderedContent;
            this._documentHtml = value.renderedContent ? groundingDocument(value.renderedContent) : '';
        }
        return html`
            ${this._documentHtml ? html`<iframe title="Google Search suggestions" sandbox="allow-same-origin" referrerpolicy="no-referrer"
                .srcdoc=${this._documentHtml} @load=${this.prepareAttribution}></iframe>` : ''}
            <nav class="sources" aria-label="Answer sources">${(value.sources || []).map((source, index) => source && safeSourceUrl(source.uri)
                ? html`<a href=${source.uri} @click=${event => this.openSource(event, source.uri)}>[${index + 1}] ${source.title}</a>` : '')}</nav>
            ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : ''}
        `;
    }
}
customElements.define('grounding-sources', GroundingSources);
