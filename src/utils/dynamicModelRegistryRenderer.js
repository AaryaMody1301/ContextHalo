import { html } from '../assets/lit-core-3.3.3.min.js';

const GEMINI_DEFAULTS = {
    live: 'gemini-3.8-live',
    screen: 'gemini-3.8-flash',
};

const GROQ_DEFAULTS = {
    chat: 'openai/gpt-oss-120b',
    vision: 'qwen/qwen3.8-27b',
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
        stale = false,
        currentModel,
    } = options;

    const preferredModels = uniqueModels(preferred);
    const preferredIds = new Set(preferredModels.map(model => model.id));
    const advancedModels = allowAdvanced ? uniqueModels(all.filter(model => !preferredIds.has(model.id))) : [];
    const catalogModels = [...preferredModels, ...advancedModels];
    const hasCatalog = catalogModels.length > 0;
    const currentKnown = catalogModels.some(model => model.id === value);
    const selected = catalogModels.find(model => model.id === value) || (currentModel?.id === value ? currentModel : null);
    const selectedStatus = selected?.capabilityLabel || (selected?.preview ? 'Preview' : '');
    const retained = hasCatalog && !currentKnown && Boolean(value);
    const status = [
        selectedStatus && `Selected model: ${selectedStatus}.`,
        retained && (selected ? 'This saved model is outside the compatible choices for this feature.'
            : 'Saved model ID. Refresh available models to check access.'),
        stale && 'Cached catalog. Refresh to check current access.',
    ].filter(Boolean).join(' ');
    const fieldId = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const statusId = `${fieldId}-status`;

    if (!hasCatalog) {
        return html`
            <div class="form-group">
                <label class="form-label" for=${fieldId}>${label}</label>
                <input id=${fieldId} type="text" spellcheck="false" aria-describedby=${status ? statusId : ''}
                    .value=${value || ''} @input=${event => onSave.call(view, event.target.value)} />
                ${status ? html`<div id=${statusId} class="form-hint" role="status">${status}</div>` : ''}
                ${helper ? html`<div class="form-hint">${helper}</div>` : ''}
            </div>
        `;
    }

    return html`
        <div class="form-group">
            <label class="form-label" for=${fieldId}>${label}</label>
            <select id=${fieldId} .value=${value || ''} aria-describedby=${status ? statusId : ''} @change=${event => onSave.call(view, event.target.value)}>
                ${retained ? html`<option value=${value} .selected=${true}>${value} (saved model)</option>` : ''}
                ${preferredModels.length ? html`
                    <optgroup label="Compatible / recommended">
                        ${preferredModels.map(model => html`
                            <option value=${model.id} .selected=${model.id === value}>
                                ${model.displayName || model.id}${model.preview ? ' · Preview' : ''}${model.capabilityLabel ? ` · ${model.capabilityLabel}` : ''}
                            </option>
                        `)}
                    </optgroup>
                ` : ''}
                ${advancedModels.length ? html`
                    <optgroup label="All provider models (advanced)">
                        ${advancedModels.map(model => html`
                            <option value=${model.id} .selected=${model.id === value}>
                                ${model.displayName || model.id}${model.preview ? ' · Preview' : ''}${model.capabilityLabel ? ` · ${model.capabilityLabel}` : ''}
                            </option>
                        `)}
                    </optgroup>
                ` : ''}
            </select>
            ${status ? html`<div id=${statusId} class="form-hint" role="status">${status}</div>` : ''}
            ${helper ? html`<div class="form-hint">${helper}</div>` : ''}
        </div>
    `;
}

export { GEMINI_DEFAULTS, GROQ_DEFAULTS, renderModelPicker };
