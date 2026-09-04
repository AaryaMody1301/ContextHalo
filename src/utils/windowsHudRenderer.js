const APP_STYLE_ID = 'phase2-windows-shell-style';
const ASSISTANT_STYLE_ID = 'phase2-live-assistant-style';

const APP_STYLES = `
    :host([live-hud]) {
        background: transparent !important;
        border-radius: 18px;
    }

    .app-shell:not(.live-hud) {
        border: 1px solid rgba(255, 255, 255, 0.14) !important;
        background: var(--bg-app);
        box-shadow: 0 16px 44px rgba(0, 0, 0, 0.34);
    }

    .top-drag-bar:not(.hidden) {
        height: 40px !important;
        background: rgba(15, 15, 15, 0.88) !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        backdrop-filter: blur(18px) saturate(130%);
    }

    .drag-region {
        order: 1;
    }

    .traffic-lights {
        order: 2;
        gap: 0 !important;
        padding: 0 !important;
        margin-left: auto;
    }

    .traffic-light {
        position: relative;
        width: 46px !important;
        height: 39px !important;
        border-radius: 0 !important;
        background: transparent !important;
        opacity: 1 !important;
        transition: background 120ms ease !important;
    }

    .traffic-light:hover {
        background: rgba(255, 255, 255, 0.09) !important;
    }

    .traffic-light.close:hover {
        background: #c42b1c !important;
    }

    .traffic-light::before,
    .traffic-light::after {
        content: '';
        position: absolute;
        left: 50%;
        top: 50%;
        pointer-events: none;
    }

    .traffic-light.minimize::before {
        width: 10px;
        height: 1px;
        background: var(--text-secondary);
        transform: translate(-50%, 2px);
    }

    .traffic-light.maximize::before {
        width: 9px;
        height: 8px;
        border: 1px solid var(--text-secondary);
        transform: translate(-50%, -50%);
    }

    .traffic-light.close::before,
    .traffic-light.close::after {
        width: 11px;
        height: 1px;
        background: var(--text-secondary);
        transform-origin: center;
    }

    .traffic-light.close::before {
        transform: translate(-50%, -50%) rotate(45deg);
    }

    .traffic-light.close::after {
        transform: translate(-50%, -50%) rotate(-45deg);
    }

    .traffic-light.close:hover::before,
    .traffic-light.close:hover::after {
        background: #ffffff;
    }

    .app-shell.live-hud {
        height: calc(100vh - 18px) !important;
        margin: 9px !important;
        border: 1px solid rgba(255, 255, 255, 0.2) !important;
        border-radius: 18px !important;
        background:
            linear-gradient(145deg, rgba(24, 27, 34, 0.88), rgba(9, 11, 16, 0.8)) !important;
        box-shadow:
            0 22px 58px rgba(0, 0, 0, 0.42),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(30px) saturate(145%);
    }

    .content.live-hud,
    .content-inner.live {
        background: transparent !important;
    }

    .live-bar {
        height: 44px !important;
        min-height: 44px;
        padding: 0 14px !important;
        background: rgba(13, 15, 21, 0.72) !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
        box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.24);
    }

    .live-bar-left,
    .live-bar-right {
        gap: 8px !important;
    }

    .live-bar-back {
        width: 28px;
        height: 28px;
        padding: 6px !important;
        color: rgba(255, 255, 255, 0.72) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        border-radius: 8px !important;
        background: rgba(255, 255, 255, 0.045) !important;
    }

    .live-bar-back:hover {
        color: #ffffff !important;
        background: rgba(255, 255, 255, 0.09) !important;
    }

    .phase2-private-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 26px;
        padding: 0 9px;
        border-radius: 999px;
        border: 1px solid rgba(74, 222, 128, 0.18);
        background: rgba(34, 197, 94, 0.08);
        color: #9ee6b4;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.02em;
        pointer-events: none;
    }

    .phase2-private-badge::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #4ade80;
        box-shadow: 0 0 10px rgba(74, 222, 128, 0.58);
    }

    .live-bar-center {
        color: rgba(255, 255, 255, 0.78) !important;
        font-size: 11px !important;
        letter-spacing: 0.01em;
    }

    .live-bar-text {
        min-height: 24px;
        display: inline-flex;
        align-items: center;
        padding: 0 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.58) !important;
        font-family: var(--font) !important;
        font-size: 10px !important;
    }

    .live-bar-text.clickable {
        color: rgba(255, 255, 255, 0.76) !important;
        background: rgba(255, 255, 255, 0.065);
    }

    .live-bar-text.clickable:hover {
        color: #ffffff !important;
        border-color: rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.11);
    }
`;

const ASSISTANT_STYLES = `
    :host {
        background: transparent !important;
        padding: 0 10px 10px;
    }

    .response-container {
        margin-top: 10px;
        padding: 16px 18px !important;
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 14px;
        background: rgba(7, 9, 13, 0.62) !important;
        box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.035),
            0 10px 28px rgba(0, 0, 0, 0.16);
        backdrop-filter: blur(16px) saturate(130%);
    }

    .response-container blockquote,
    .response-container pre,
    .response-container th {
        background: rgba(255, 255, 255, 0.045) !important;
    }

    .response-nav {
        align-self: center;
        margin: 7px auto 0;
        padding: 3px 9px !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        border-radius: 999px;
        background: rgba(8, 10, 14, 0.62) !important;
    }

    .input-bar {
        padding: 10px 2px 2px !important;
        background: transparent !important;
    }

    .input-bar-inner,
    .analyze-btn {
        height: 36px !important;
        border-color: rgba(255, 255, 255, 0.1) !important;
        background: rgba(16, 19, 25, 0.76) !important;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
        backdrop-filter: blur(14px);
    }

    .input-bar-inner:focus-within,
    .analyze-btn:hover:not(.analyzing) {
        border-color: rgba(96, 165, 250, 0.72) !important;
    }

    .analyze-btn:hover:not(.analyzing) {
        background: rgba(30, 41, 59, 0.78) !important;
    }
`;

function ensureStyle(root, id, cssText) {
    if (!root || root.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = cssText;
    root.appendChild(style);
}

function decorateApp(appElement) {
    const root = appElement?.shadowRoot;
    if (!root) return;

    ensureStyle(root, APP_STYLE_ID, APP_STYLES);
    const live = appElement.currentView === 'assistant';
    appElement.toggleAttribute('live-hud', live);
    document.body.style.background = live ? 'transparent' : '';

    root.querySelector('.app-shell')?.classList.toggle('live-hud', live);
    root.querySelector('.content')?.classList.toggle('live-hud', live);

    if (!live) return;
    const left = root.querySelector('.live-bar-left');
    if (left && !left.querySelector('.phase2-private-badge')) {
        const badge = document.createElement('span');
        badge.className = 'phase2-private-badge';
        badge.textContent = 'Private HUD';
        left.appendChild(badge);
    }
}

function decorateAssistant(appElement) {
    const assistant = appElement?.shadowRoot?.querySelector('assistant-view');
    if (!assistant?.shadowRoot) return;
    ensureStyle(assistant.shadowRoot, ASSISTANT_STYLE_ID, ASSISTANT_STYLES);
}

async function patchWindowsShell() {
    if (window.process?.platform !== 'win32') return;

    await customElements.whenDefined('context-halo-app');
    const App = customElements.get('context-halo-app');
    if (!App || App.prototype.__windowsHudStyled) return;

    const originalUpdated = App.prototype.updated;
    App.prototype.updated = function (changedProperties) {
        const result = originalUpdated.call(this, changedProperties);
        queueMicrotask(() => {
            decorateApp(this);
            decorateAssistant(this);
        });
        return result;
    };

    Object.defineProperty(App.prototype, '__windowsHudStyled', { value: true });

    const appElement = document.querySelector('context-halo-app');
    if (appElement) {
        decorateApp(appElement);
        decorateAssistant(appElement);
    }
}

patchWindowsShell().catch(error => {
    console.error('Failed to apply Windows HUD styling:', error);
});
