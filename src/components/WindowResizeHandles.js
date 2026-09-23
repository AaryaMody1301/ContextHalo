import { css, html, LitElement } from '../assets/lit-core-3.3.3.min.js';

// Keep Electron's transparent window non-resizable. Main owns DIP geometry;
// the renderer only reports gestures, never arbitrary bounds or native handles.
export class WindowResizeHandles extends LitElement {
    static styles = css`
        :host { position: fixed; inset: 0; pointer-events: none; z-index: 10000; }
        button { position: absolute; border: 0; padding: 0; margin: 0; pointer-events: auto;
            background: rgb(128 128 128 / .02); touch-action: none; -webkit-app-region: no-drag; }
        .n, .s { left: 12px; right: 12px; height: 5px; cursor: ns-resize; }
        .e, .w { top: 12px; bottom: 12px; width: 5px; cursor: ew-resize; }
        .n, .ne, .nw { top: 0; } .s, .se, .sw { bottom: 0; }
        .e, .ne, .se { right: 0; } .w, .nw, .sw { left: 0; }
        .ne, .nw, .se, .sw { width: 12px; height: 12px; }
        .ne, .sw { cursor: nesw-resize; } .nw, .se { cursor: nwse-resize; }
        .se:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; background: var(--bg-elevated); }
    `;

    constructor() {
        super();
        this._gesture = null;
        this._blur = () => this.finish();
    }

    connectedCallback() { super.connectedCallback(); window.addEventListener('blur', this._blur); }
    disconnectedCallback() { this.finish(); window.removeEventListener('blur', this._blur); super.disconnectedCallback(); }

    async begin(event, edge) {
        if (event.button !== 0 || this._gesture) return;
        event.preventDefault();
        const gesture = { element: event.currentTarget, pointerId: event.pointerId, ready: false, pending: false };
        this._gesture = gesture;
        try {
            gesture.element.setPointerCapture(event.pointerId);
            const result = await window.electronAPI.invoke('window-resize', { phase: 'begin', edge });
            if (this._gesture !== gesture) return;
            if (!result.success) { this.finish(); return; }
            gesture.ready = true;
        } catch { this.finish(); }
    }

    async move(event) {
        const gesture = this._gesture;
        if (!gesture?.ready || gesture.pending || event.pointerId !== gesture.pointerId) return;
        // One IPC in flight bounds pointer traffic. Main samples the current OS
        // cursor in device-independent coordinates, including on mixed-DPI PCs.
        gesture.pending = true;
        try {
            const result = await window.electronAPI.invoke('window-resize', { phase: 'update' });
            if (!result.success && this._gesture === gesture) this.finish();
        } catch { if (this._gesture === gesture) this.finish(); }
        finally { gesture.pending = false; }
    }

    finish() {
        const gesture = this._gesture;
        if (!gesture) return;
        this._gesture = null;
        if (gesture.element.hasPointerCapture(gesture.pointerId)) gesture.element.releasePointerCapture(gesture.pointerId);
        void window.electronAPI.invoke('window-resize', { phase: 'end' }).catch(() => {});
    }

    key(event) {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        void window.electronAPI.invoke('window-resize', { phase: 'keyboard', key: event.key, large: event.shiftKey }).catch(() => {});
    }

    render() {
        return html`${['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].map(edge => html`
            <button type="button" class=${edge} tabindex=${edge === 'se' ? '0' : '-1'}
                aria-label="Resize window. Arrow keys adjust size; Shift makes larger changes."
                aria-hidden=${edge === 'se' ? 'false' : 'true'}
                @pointerdown=${event => this.begin(event, edge)} @pointermove=${this.move}
                @pointerup=${this.finish} @pointercancel=${this.finish} @lostpointercapture=${this.finish}
                @keydown=${this.key}></button>`)} `;
    }
}
customElements.define('window-resize-handles', WindowResizeHandles);
