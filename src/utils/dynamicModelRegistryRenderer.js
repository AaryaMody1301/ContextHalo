import { html } from '../assets/lit-core-2.7.4.min.js';

const GEMINI_DEFAULTS = {
    live: 'gemini-3.1-flash-live-preview',
    screen: 'gemini-3.8-flash',
};

const GROQ_DEFAULTS = {
    chat: 'openai/gpt-oss-120b',
    vision: 'qwen/qwen3.6-27b',
    transcription: 'whisper-large-v3-turbo',
};

function uniqueModels(models = []) {
    const seen = new Set();
    return models.filter(model => {
        if (!model?.id || seen.has(model.id)) return false;
        seen.add(model.id);
        return true;
    });
}

function renderModelPicker(view, options) {
    const {
        label,
        value,
        preferred = [],
        all = [],
        onSave,
        helper = '',
        allowAdvanced = true,
    } = options;

    const preferredModels = uniqueModels(preferred);
    const preferredIds = new Set(preferredModels.map(model => model.id));
    const advancedModels = allowAdvanced ? uniqueModels(all.filter(model => !preferredIds.has(model.id))) : [];
    const catalogModels = [...preferredModels, ...advancedModels];
    const hasCatalog = catalogModels.length > 0;
    const currentKnown = catalogModels.some(model => model.id === value);

    if (!hasCatalog) {
        return html`
            <div class="form-group">
                <label class="form-label" for=${label}>${label}</label>
                <input id=${label} type="text" spellcheck="false" .value=${value || ''} @input=${event => onSave.call(view, event.target.value)} />
                ${helper ? html`<div class="form-hint">${helper}</div>` : ''}
            </div>
        `;
    }

    return html`
        <div class="form-group">
            <label class="form-label" for=${label}>${label}</label>
            <select id=${label} .value=${value || ''} @change=${event => onSave.call(view, event.target.value)}>
                ${!currentKnown && value ? html`<option value=${value}>${value} — current/manual</option>` : ''}
                ${preferredModels.length ? html`
                    <optgroup label="Compatible / recommended">
                        ${preferredModels.map(model => html`
                            <option value=${model.id}>
                                ${model.displayName || model.id}${model.preview ? ' · Preview' : ''}
                            </option>
                        `)}
                    </optgroup>
                ` : ''}
                ${advancedModels.length ? html`
                    <optgroup label="All provider models (advanced)">
                        ${advancedModels.map(model => html`
                            <option value=${model.id}>
                                ${model.displayName || model.id}${model.preview ? ' · Preview' : ''}
                            </option>
                        `)}
                    </optgroup>
                ` : ''}
            </select>
            ${helper ? html`<div class="form-hint">${helper}</div>` : ''}
        </div>
    `;
}

export { GEMINI_DEFAULTS, GROQ_DEFAULTS, renderModelPicker };
