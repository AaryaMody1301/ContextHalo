import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { unifiedPageStyles } from './sharedPageStyles.js';

export class AICustomizeView extends LitElement {
    static styles = [unifiedPageStyles, css`
        textarea.control { min-height: 220px; resize: vertical; line-height: 1.6; }
        .actions { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
        .actions button { width:auto; }
    `];
    static properties = {
        draft: { type: String }, selectedProfile: { type: String }, onOpenProfile: { type: Function },
        _context: { state: true }, _state: { state: true }, _error: { state: true },
    };
    constructor() {
        super();
        this.selectedProfile = 'interview';
        this.onOpenProfile = () => {};
        this._context = '';
        this._savedContext = '';
        this._state = 'loading';
        this._error = '';
        this._loadFromStorage();
    }
    async _loadFromStorage() {
        try {
            const prefs = await contextHalo.storage.getPreferences();
            this._savedContext = prefs.customPrompt || '';
            this._context = this.draft ?? this._savedContext;
            this._state = this._context === this._savedContext ? 'saved' : 'unsaved';
            this._error = '';
        } catch { this._state = 'load-failed'; this._error = 'Instructions could not be loaded. Retry before editing.'; }
    }
    _editContext(e) {
        this._context = e.target.value;
        this.dispatchEvent(new CustomEvent('instruction-draft', { detail: this._context, bubbles: true, composed: true }));
        if (this._state !== 'saving') this._state = this._context === this._savedContext ? 'saved' : 'unsaved';
        this._error = '';
    }
    async _saveContext() {
        if (this._state === 'saving') return false;
        const snapshot = this._context;
        this._state = 'saving';
        this._error = '';
        try {
            const result = await contextHalo.storage.updatePreference('customPrompt', snapshot);
            if (result?.success === false) throw new Error('Write failed');
            this._savedContext = snapshot;
            if (this._context === snapshot) this.dispatchEvent(new CustomEvent('instruction-draft', { detail: undefined, bubbles: true, composed: true }));
            this._state = this._context === snapshot ? 'saved' : 'unsaved';
            return true;
        } catch {
            this._state = 'failed';
            this._error = 'Instructions were not saved. Your edit is retained; retry.';
            return false;
        }
    }
    render() {
        return html`<div class="unified-page"><div class="unified-wrap">
            <h1 class="page-title">AI Customization</h1>
            <p class="page-subtitle">Shared instructions for new sessions. Current sessions keep their existing context.</p>
            <section class="surface">
                <div class="actions"><span>Session profile: ${this.selectedProfile}</span><button class="control" @click=${this.onOpenProfile}>Change profile on Home</button></div>
                <div class="form-group vertical">
                    <label class="form-label" for="instructions">Custom instructions</label>
                    <textarea id="instructions" class="control" maxlength="20000" aria-describedby="instructions-help instructions-state"
                        ?disabled=${['loading', 'load-failed'].includes(this._state)} .value=${this._context} @input=${this._editContext}
                        placeholder="Role requirements, relevant experience or answer preferences..."></textarea>
                    <p id="instructions-help" class="form-help">Combined with your profile at session start. Avoid secrets and unnecessary personal information.</p>
                </div>
                <div class="actions">
                    <button class="control" @click=${this._state === 'load-failed' ? this._loadFromStorage : this._saveContext}
                        ?disabled=${['loading', 'saving'].includes(this._state)}>${this._state === 'saving' ? 'Saving...' : this._state === 'load-failed' ? 'Retry loading' : this._state === 'failed' ? 'Retry save' : 'Save instructions'}</button>
                    <span id="instructions-state" role="status">${this._error || ({ loading:'Loading...', saving:'Saving instructions...', saved:'Instructions saved.', unsaved:'Unsaved changes.' }[this._state] || '')}</span>
                </div>
            </section>
        </div></div>`;
    }
}
customElements.define('ai-customize-view', AICustomizeView);
