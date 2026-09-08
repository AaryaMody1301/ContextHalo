import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class OnboardingView extends LitElement {
    static styles = css`
        * { box-sizing:border-box; font-family:var(--font, system-ui); }
        :host { overflow-y: auto; height: 100%; box-sizing: border-box; display:block; width:100%; height:100%; color:var(--text-primary); }
        .onboarding { min-height:100%; padding:48px 24px; display:grid; place-items:center;
            background:radial-gradient(ellipse at top left, var(--bg-elevated), transparent 65%), var(--bg-app); }
        .slide { width:min(560px,100%); display:grid; gap:20px; padding:28px; border:1px solid var(--border); border-radius:16px; background:var(--bg-surface); }
        h1 { font-size:28px; line-height:1.25; margin:0; }
        p { margin:0; color:var(--text-secondary); font-size:15px; line-height:1.65; }
        label { font-size:14px; font-weight:600; }
        textarea { width:100%; min-height:130px; padding:12px; resize:vertical; background:var(--bg-elevated); color:var(--text-primary); border:1px solid var(--border); border-radius:8px; font-size:14px; line-height:1.6; }
        .actions { display:flex; flex-wrap:wrap; gap:12px; }
        button { min-height:40px; padding:10px 20px; border:1px solid var(--border); border-radius:8px; background:var(--bg-elevated); color:var(--text-primary); cursor:pointer; font-size:14px; }
        .btn-primary { background:var(--accent); color:var(--bg-app); font-weight:600; }
        :focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
        button:disabled { opacity:.6; cursor:default; }
        .error { color:var(--danger); }
        .steps { font-size:13px; color:var(--text-secondary); }
        @media (max-height:450px) { .onboarding { padding:24px; } .slide { padding:20px; gap:12px; } }
    `;
    static properties = {
        currentSlide: { type:Number }, contextText: { type:String }, onComplete: { type:Function },
        saving: { state:true }, saveError: { state:true }, onClose: { attribute:false },
    };
    constructor() {
        super();
        this.currentSlide = 0;
        this.contextText = '';
        this.onComplete = () => {};
        this.onClose = () => {};
        this.saving = false;
        this.saveError = '';
    }
    // Decoration is static CSS. No animation loop, motion preference listener,
    // canvas or timer survives closing onboarding (including reduced-motion mode).
    async goToSlide(slide) {
        this.currentSlide = slide;
        await this.updateComplete;
        this.shadowRoot.querySelector('h1')?.focus();
    }
    handleContextInput(event) { this.contextText = event.target.value; }
    async completeOnboarding() {
        if (this.saving) return false;
        this.saving = true;
        this.saveError = '';
        const context = this.contextText.trim();
        try {
            if (context) {
                const result = await contextHalo.storage.updatePreference('customPrompt', context);
                if (result?.success === false) throw new Error('Instructions were not saved');
            }
            const result = await contextHalo.storage.updateConfig('onboarded', true);
            if (result?.success === false) throw new Error('Setup was not saved');
            this.onComplete();
            return true;
        } catch {
            this.saveError = 'Setup could not be saved. Your context is retained. Check storage permissions and retry.';
            return false;
        } finally { this.saving = false; }
    }
    render() {
        return html`<div class="onboarding"><section class="slide" aria-label="ContextHalo setup">
            <span class="steps">Setup ${this.currentSlide + 1} of 2</span>
            ${this.currentSlide === 0 ? html`
                <h1 tabindex="-1">Welcome to ContextHalo</h1>
                <p>Prepare for conversations, review your sessions and ask questions about your screen. You choose when to start and stop audio capture.</p>
                <p>Use Gemini or Groq with your own API key, or run Local AI on this computer. Cloud requests use the selected provider's account and limits.</p>
                <div class="actions"><button class="btn-primary" @click=${() => this.goToSlide(1)}>Continue</button><button @click=${this.onClose}>Close app</button></div>
            ` : html`
                <h1 tabindex="-1">Add optional context</h1>
                <p id="context-help">Add role requirements or answer preferences. You can skip this and edit custom instructions later in AI Customization. Avoid secrets.</p>
                <label for="onboarding-context">Custom instructions (optional)</label>
                <textarea id="onboarding-context" maxlength="20000" aria-describedby="context-help" .value=${this.contextText} @input=${this.handleContextInput} ?disabled=${this.saving} placeholder="Role, goals or relevant background..."></textarea>
                <div class="actions"><button class="btn-primary" @click=${this.completeOnboarding} ?disabled=${this.saving}>${this.saving ? 'Saving setup...' : this.saveError ? 'Retry saving setup' : 'Get Started'}</button>
                <button @click=${() => this.goToSlide(0)} ?disabled=${this.saving}>Back</button></div>
                <p role="status" class=${this.saveError ? 'error' : ''}>${this.saveError || (this.saving ? 'Saving your setup before opening Home...' : '')}</p>
            `}
        </section></div>`;
    }
}
customElements.define('onboarding-view', OnboardingView);
