import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { unifiedPageStyles } from './sharedPageStyles.js';

const PROJECT_ISSUES_URL = 'https://github.com/AaryaMody1301/ContextHalo/issues';

export class FeedbackView extends LitElement {
    static styles = [
        unifiedPageStyles,
        css`
            .feedback-card {
                display: grid;
                gap: var(--space-md);
            }

            .feedback-copy {
                color: var(--text-secondary);
                font-size: var(--font-size-sm);
                line-height: 1.55;
            }

            .feedback-button {
                width: fit-content;
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                padding: 8px 12px;
                background: var(--bg-elevated);
                color: var(--text-primary);
                font-size: var(--font-size-sm);
                cursor: pointer;
            }

            .feedback-button:hover {
                border-color: var(--accent);
                background: rgba(63, 125, 229, 0.14);
            }
        `,
    ];

    async _openIssues() {
        if (!window.require) return;
        const { ipcRenderer } = window.require('electron');
        await ipcRenderer.invoke('open-external', PROJECT_ISSUES_URL);
    }

    render() {
        return html`
            <div class="unified-page">
                <div class="unified-wrap">
                    <div class="page-title">Feedback</div>

                    <section class="surface feedback-card">
                        <div class="surface-title">Help improve ContextHalo</div>
                        <div class="feedback-copy">
                            Bug reports, feature requests, and feedback are tracked publicly through the ContextHalo GitHub Issues page.
                            Before opening a new issue, please check whether a similar report already exists and never include API keys or other secrets.
                        </div>
                        <button class="feedback-button" @click=${this._openIssues}>Open GitHub Issues</button>
                    </section>
                </div>
            </div>
        `;
    }
}

customElements.define('feedback-view', FeedbackView);
