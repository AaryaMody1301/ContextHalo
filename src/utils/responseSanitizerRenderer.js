const ALLOWED_TAGS = new Set([
    'A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HR', 'I', 'LI', 'OL', 'P', 'PRE', 'SPAN', 'STRONG', 'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'UL',
]);

const ALLOWED_ATTRIBUTES = new Map([
    ['A', new Set(['href', 'title'])],
    ['CODE', new Set(['class'])],
    ['SPAN', new Set(['data-word'])],
    ['TD', new Set(['colspan', 'rowspan'])],
    ['TH', new Set(['colspan', 'rowspan'])],
]);

const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION', 'META', 'LINK', 'BASE', 'SVG', 'MATH', 'TEMPLATE']);

function safeExternalHref(value) {
    const href = String(value || '').trim();
    if (!href) return '';
    try {
        const parsed = new URL(href);
        return ['https:', 'http:'].includes(parsed.protocol) ? parsed.toString() : '';
    } catch {
        return '';
    }
}

export function sanitizeAssistantHtml(html) {
    const parser = new DOMParser();
    const documentFragment = parser.parseFromString(String(html || ''), 'text/html');
    const elements = [...documentFragment.body.querySelectorAll('*')];

    for (const element of elements) {
        const tag = element.tagName;
        if (!ALLOWED_TAGS.has(tag)) {
            if (DROP_WITH_CONTENT.has(tag)) {
                element.remove();
            } else {
                element.replaceWith(...element.childNodes);
            }
            continue;
        }

        const allowed = ALLOWED_ATTRIBUTES.get(tag) || new Set();
        for (const attribute of [...element.attributes]) {
            const name = attribute.name.toLowerCase();
            if (name.startsWith('on') || name === 'style' || !allowed.has(attribute.name)) {
                element.removeAttribute(attribute.name);
            }
        }

        if (tag === 'A' && element.hasAttribute('href')) {
            const href = safeExternalHref(element.getAttribute('href'));
            if (href) {
                element.setAttribute('href', href);
                element.setAttribute('rel', 'noopener noreferrer');
            } else {
                element.removeAttribute('href');
            }
        }
    }

    return documentFragment.body.innerHTML;
}

