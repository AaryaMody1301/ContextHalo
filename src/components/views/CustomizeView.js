import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';
import { unifiedPageStyles } from './sharedPageStyles.js';

export class CustomizeView extends LitElement {
    static styles = [
        unifiedPageStyles,
        css`
            .danger-surface {
                border-color: var(--danger);
            }

            .warning-callout {
                position: relative;
                margin-top: 4px;
                padding: 8px 12px;
                border: 1px solid var(--danger);
                border-radius: var(--radius-sm);
                color: var(--danger);
                font-size: var(--font-size-xs);
                line-height: 1.4;
                background: rgba(239, 68, 68, 0.06);
            }

            .warning-callout::before {
                content: '';
                position: absolute;
                top: -6px;
                left: 16px;
                width: 10px;
                height: 10px;
                background: var(--bg-surface);
                border-top: 1px solid var(--danger);
                border-left: 1px solid var(--danger);
                transform: rotate(45deg);
            }

            .toggle-row {
                display: flex;
                align-items: center;
                gap: var(--space-sm);
                padding: var(--space-sm);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                background: var(--bg-elevated);
            }

            .toggle-input {
                width: 14px;
                height: 14px;
                accent-color: var(--text-primary);
                cursor: pointer;
            }

            .toggle-label {
                color: var(--text-primary);
                font-size: var(--font-size-sm);
                cursor: pointer;
                user-select: none;
            }

            .slider-wrap {
                display: flex;
                flex-direction: column;
                align-items: stretch;
                gap: var(--space-xs);
            }

            .slider-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: var(--space-sm);
            }

            .slider-value {
                font-family: var(--font-mono);
                font-size: var(--font-size-xs);
                color: var(--text-secondary);
                background: var(--bg-elevated);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                padding: 2px 8px;
            }

            .slider-input {
                -webkit-appearance: none;
                appearance: none;
                width: 100%;
                height: 4px;
                border-radius: 2px;
                background: var(--border);
                outline: none;
                cursor: pointer;
            }

            .slider-input::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 14px;
                height: 14px;
                border-radius: 50%;
                background: var(--text-primary);
                border: none;
            }

            .slider-input::-moz-range-thumb {
                width: 14px;
                height: 14px;
                border-radius: 50%;
                background: var(--text-primary);
                border: none;
            }

            .keybind-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: var(--space-sm) 0;
                border-bottom: 1px solid var(--border);
            }

            .keybind-row:last-of-type {
                border-bottom: none;
            }

            .keybind-name {
                color: var(--text-secondary);
                font-size: var(--font-size-sm);
            }

            .keybind-input {
                width: 140px;
                text-align: center;
                font-family: var(--font-mono);
                font-size: var(--font-size-xs);
            }

            .danger-button {
                border: 1px solid var(--danger);
                color: var(--danger);
                background: transparent;
                border-radius: var(--radius-sm);
                padding: 9px 12px;
                font-size: var(--font-size-sm);
                cursor: pointer;
                transition: background var(--transition);
            }

            .danger-button:hover {
                background: rgba(241, 76, 76, 0.11);
            }

            .danger-button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .status {
                margin-top: var(--space-sm);
                padding: var(--space-sm);
                border-radius: var(--radius-sm);
                border: 1px solid var(--border);
                font-size: var(--font-size-xs);
            }

            .status.success {
                border-color: var(--success);
                color: var(--success);
            }

            .status.error {
                border-color: var(--danger);
                color: var(--danger);
            }
        `,
    ];

    static properties = {
        selectedProfile: { type: String },
        selectedLanguage: { type: String },
        selectedScreenshotInterval: { type: String },
        selectedImageQuality: { type: String },
        layoutMode: { type: String },
        keybinds: { type: Object },
        googleSearchEnabled: { type: Boolean },
        backgroundTransparency: { type: Number },
        fontSize: { type: Number },
        theme: { type: String },
        onProfileChange: { type: Function },
        onLanguageChange: { type: Function },
        onScreenshotIntervalChange: { type: Function },
        onImageQualityChange: { type: Function },
        onLayoutModeChange: { type: Function },
        onOpenProviderSettings: { type: Function },
        onOpenInstructions: { type: Function },
        saveStates: { state: true },
        shortcutStatus: { state: true },
        shortcutConflicts: { state: true },
        keybindSaving: { state: true },
        settingsLoading: { state: true },
        isClearing: { type: Boolean },
        isRestoring: { type: Boolean },
        clearStatusMessage: { type: String },
        clearStatusType: { type: String },
    };

    constructor() {
        super();
        this.selectedProfile = 'interview';
        this.selectedLanguage = 'en-US';
        this.selectedScreenshotInterval = '5';
        this.selectedImageQuality = 'medium';
        this.layoutMode = 'normal';
        this.keybinds = this.getDefaultKeybinds();
        this.onProfileChange = () => {};
        this.onLanguageChange = () => {};
        this.onScreenshotIntervalChange = () => {};
        this.onImageQualityChange = () => {};
        this.onLayoutModeChange = () => {};
        this.onOpenProviderSettings = () => {};
        this.onOpenInstructions = () => {};
        this.saveStates = {};
        this.shortcutStatus = '';
        this.shortcutConflicts = {};
        this.keybindSaving = false;
        this.settingsLoading = true;
        this._saveVersions = {};
        this._failedWrites = new Map();
        this.googleSearchEnabled = true;
        this.isClearing = false;
        this.isRestoring = false;
        this.clearStatusMessage = '';
        this.clearStatusType = '';
        this.backgroundTransparency = 0.8;
        this.fontSize = 20;
        this.audioMode = 'speaker_only';
        this.customPrompt = '';
        this.theme = 'dark';
        this._loadFromStorage();
    }

    connectedCallback() {
        super.connectedCallback();
    }

    getThemes() {
        return contextHalo.theme.getAll();
    }

    async _loadFromStorage() {
        try {
            const [prefs, shortcutState] = await Promise.all([contextHalo.storage.getPreferences(), contextHalo.storage.getShortcutState()]);
            if (shortcutState.success !== true) throw new Error(shortcutState.error || 'Could not load shortcuts.');
            const keybinds = shortcutState.data;
            this.shortcutConflicts = shortcutState.conflicts || {};
            this.shortcutRecovery = shortcutState.recovery;
            this.selectedLanguage = prefs.selectedLanguage || this.selectedLanguage;
            this.selectedImageQuality = prefs.selectedImageQuality || this.selectedImageQuality;
            this.layoutMode = prefs.layoutMode || this.layoutMode;
            this.googleSearchEnabled = prefs.googleSearchEnabled ?? true;
            this.backgroundTransparency = prefs.backgroundTransparency ?? 0.8;
            this.fontSize = prefs.fontSize ?? 20;
            this.audioMode = prefs.audioMode ?? 'speaker_only';
            this.customPrompt = prefs.customPrompt ?? '';
            this.theme = prefs.theme ?? 'dark';
            if (keybinds) {
                this.keybinds = { ...this.getDefaultKeybinds(), ...keybinds };
            }
            this.updateBackgroundAppearance();
            this.updateFontSize();
            this.requestUpdate();
        } catch (error) {
            this.saveStates = { load: 'Could not load settings. Retry before editing.' };
        } finally { this.settingsLoading = false; this.requestUpdate(); }
    }

    getLanguages() {
        return [
            { value: 'en-US', name: 'English (US)' },
            { value: 'en-GB', name: 'English (UK)' },
            { value: 'en-AU', name: 'English (Australia)' },
            { value: 'en-IN', name: 'English (India)' },
            { value: 'de-DE', name: 'German (Germany)' },
            { value: 'es-US', name: 'Spanish (US)' },
            { value: 'es-ES', name: 'Spanish (Spain)' },
            { value: 'fr-FR', name: 'French (France)' },
            { value: 'fr-CA', name: 'French (Canada)' },
            { value: 'hi-IN', name: 'Hindi (India)' },
            { value: 'pt-BR', name: 'Portuguese (Brazil)' },
            { value: 'ar-XA', name: 'Arabic (Generic)' },
            { value: 'id-ID', name: 'Indonesian (Indonesia)' },
            { value: 'it-IT', name: 'Italian (Italy)' },
            { value: 'ja-JP', name: 'Japanese (Japan)' },
            { value: 'tr-TR', name: 'Turkish (Turkey)' },
            { value: 'vi-VN', name: 'Vietnamese (Vietnam)' },
            { value: 'bn-IN', name: 'Bengali (India)' },
            { value: 'gu-IN', name: 'Gujarati (India)' },
            { value: 'kn-IN', name: 'Kannada (India)' },
            { value: 'ml-IN', name: 'Malayalam (India)' },
            { value: 'mr-IN', name: 'Marathi (India)' },
            { value: 'ta-IN', name: 'Tamil (India)' },
            { value: 'te-IN', name: 'Telugu (India)' },
            { value: 'nl-NL', name: 'Dutch (Netherlands)' },
            { value: 'ko-KR', name: 'Korean (South Korea)' },
            { value: 'cmn-CN', name: 'Mandarin Chinese (China)' },
            { value: 'pl-PL', name: 'Polish (Poland)' },
            { value: 'ru-RU', name: 'Russian (Russia)' },
            { value: 'th-TH', name: 'Thai (Thailand)' },
        ];
    }

    getDefaultKeybinds() {
        const isMac = contextHalo.isMacOS || navigator.platform.includes('Mac');
        return {
            moveUp: isMac ? 'Alt+Up' : 'Ctrl+Up',
            moveDown: isMac ? 'Alt+Down' : 'Ctrl+Down',
            moveLeft: isMac ? 'Alt+Left' : 'Ctrl+Left',
            moveRight: isMac ? 'Alt+Right' : 'Ctrl+Right',
            toggleVisibility: isMac ? 'Cmd+\\' : 'Ctrl+\\',
            toggleClickThrough: isMac ? 'Cmd+M' : 'Ctrl+M',
            nextStep: isMac ? 'Cmd+Enter' : 'Ctrl+Enter',
            previousResponse: isMac ? 'Cmd+[' : 'Ctrl+[',
            nextResponse: isMac ? 'Cmd+]' : 'Ctrl+]',
            scrollUp: isMac ? 'Cmd+Shift+Up' : 'Ctrl+Shift+Up',
            scrollDown: isMac ? 'Cmd+Shift+Down' : 'Ctrl+Shift+Down',
            emergencyErase: isMac ? 'Cmd+Shift+E' : 'Ctrl+Shift+E',
        };
    }

    getKeybindActions() {
        return [
            { key: 'moveUp', name: 'Move Window Up', description: 'Move the app window up' },
            { key: 'moveDown', name: 'Move Window Down', description: 'Move the app window down' },
            { key: 'moveLeft', name: 'Move Window Left', description: 'Move the app window left' },
            { key: 'moveRight', name: 'Move Window Right', description: 'Move the app window right' },
            { key: 'toggleVisibility', name: 'Toggle Visibility', description: 'Show or hide the app window' },
            { key: 'toggleClickThrough', name: 'Toggle Click-through', description: 'Enable or disable click-through mode' },
            { key: 'nextStep', name: 'Ask Next Step', description: 'Take screenshot and ask for next step' },
            { key: 'previousResponse', name: 'Previous Response', description: 'Move to previous AI response' },
            { key: 'nextResponse', name: 'Next Response', description: 'Move to next AI response' },
            { key: 'scrollUp', name: 'Scroll Response Up', description: 'Scroll response content upward' },
            { key: 'scrollDown', name: 'Scroll Response Down', description: 'Scroll response content downward' },
            { key: 'emergencyErase', name: 'Emergency Erase', description: 'Close the app and clear sensitive local data' },
        ];
    }

    async _savePreference(key, value, write) {
        const version = this._saveVersions[key] = (this._saveVersions[key] || 0) + 1;
        const perform = write || (() => contextHalo.storage.updatePreference(key, value));
        this.saveStates = { ...this.saveStates, [key]: 'saving' };
        try {
            const result = await perform();
            if (result?.success === false) throw new Error(result.error || 'Could not save this change.');
            if (this._saveVersions[key] === version) {
                this._failedWrites.delete(key);
                this.saveStates = { ...this.saveStates, [key]: 'saved' };
            }
            return true;
        } catch {
            if (this._saveVersions[key] === version) {
                this._failedWrites.set(key, () => this._savePreference(key, value, perform));
                this.saveStates = { ...this.saveStates, [key]: 'failed' };
            }
            return false;
        }
    }

    retrySaves() {
        if (this.saveStates.load) { this.saveStates = {}; this.settingsLoading = true; return this._loadFromStorage(); }
        return Promise.all([...this._failedWrites.values()].map(retry => retry()));
    }

    renderSaveFeedback() {
        const values = Object.values(this.saveStates);
        const failed = values.includes('failed') || this.saveStates.load;
        const saving = values.includes('saving');
        return html`<div class="save-feedback" role="status" aria-live="polite" data-state=${failed ? 'error' : saving ? 'saving' : 'saved'}>
            <span>${this.settingsLoading ? 'Loading settings...' : failed ? (this.saveStates.load || 'Some changes are not saved. Your edits are retained.') : saving ? 'Saving changes...' : values.length ? 'Settings saved.' : 'Changes are saved automatically.'}</span>
            ${failed ? html`<button class="control" @click=${this.retrySaves} ?disabled=${saving}>Retry save</button>` : ''}
        </div>`;
    }

    handleLanguageSelect(e) {
        this.selectedLanguage = e.target.value;
        const value = this.selectedLanguage;
        return this._savePreference('selectedLanguage', value, () => this.onLanguageChange(value));
    }

    handleImageQualitySelect(e) {
        this.selectedImageQuality = e.target.value;
        const value = this.selectedImageQuality;
        return this._savePreference('selectedImageQuality', value, () => this.onImageQualityChange(value));
    }

    handleLayoutModeSelect(e) {
        this.layoutMode = e.target.value;
        const value = this.layoutMode;
        return this._savePreference('layoutMode', value, () => this.onLayoutModeChange(value));
    }

    handleAudioModeSelect(e) {
        this.audioMode = e.target.value;
        this.requestUpdate();
        return this._savePreference('audioMode', this.audioMode);
    }

    handleThemeChange(e) {
        this.theme = e.target.value;
        contextHalo.theme.apply(this.theme, this.backgroundTransparency);
        return this._savePreference('theme', this.theme);
    }

    handleGoogleSearchChange(e) {
        this.googleSearchEnabled = e.target.checked;
        return this._savePreference('googleSearchEnabled', this.googleSearchEnabled);
    }

    handleBackgroundTransparencyChange(e) {
        this.backgroundTransparency = Number(e.target.value);
        this.updateBackgroundAppearance();
        return this._savePreference('backgroundTransparency', this.backgroundTransparency);
    }

    updateBackgroundAppearance() {
        // Hydration, opacity preview and reset must update one coherent palette.
        contextHalo.theme.apply(this.theme, this.backgroundTransparency);
    }

    handleFontSizeChange(e) {
        this.fontSize = Number(e.target.value);
        this.updateFontSize();
        return this._savePreference('fontSize', this.fontSize);
    }

    updateFontSize() {
        document.documentElement.style.setProperty('--response-font-size', `${this.fontSize}px`);
    }

    async saveKeybinds(candidate) {
        if (this.keybindSaving) return false;
        this.keybindSaving = true;
        this.shortcutStatus = 'Checking availability and saving...';
        try {
            const result = await contextHalo.storage.setKeybinds(candidate);
            if (result?.success !== true) throw Object.assign(new Error(result?.error || 'Shortcut not saved.'), { result });
            this.keybinds = result.data || candidate;
            this.shortcutConflicts = result.conflicts || {};
            this.shortcutStatus = 'Shortcut saved and registered. Tab moves to the next setting.';
            this.dispatchEvent(new CustomEvent('shortcuts-changed', { detail: this.keybinds, bubbles: true, composed: true }));
            return true;
        } catch (error) {
            this.shortcutConflicts = error.result?.conflicts || {};
            this.shortcutStatus = error.result?.error || 'Shortcut not saved. The previous working binding is retained. Choose another combination or retry.';
            return false;
        } finally { this.keybindSaving = false; }
    }

    handleKeybindFocus(e) {
        this._capturingAction = e.target.dataset.action;
        this.shortcutStatus = 'Press Ctrl, Alt or Windows with a key (or a function key). Tab moves on; Escape cancels.';
        e.target.select();
    }

    handleKeybindBlur() {
        this._capturingAction = null;
        if (this.shortcutStatus.startsWith('Press ')) this.shortcutStatus = 'No shortcut changed.';
    }

    handleKeybindInput(e) {
        // Navigation must never become a binding, including Shift+Tab.
        if (e.key === 'Tab') return;
        if (e.key === 'Escape') {
            e.preventDefault();
            this._capturingAction = null;
            e.target.value = this.keybinds[e.target.dataset.action];
            this.shortcutStatus = 'Shortcut editing cancelled. Previous binding retained.';
            return;
        }
        if (e.repeat || e.isComposing || ['Control', 'Meta', 'Alt', 'Shift', 'AltGraph'].includes(e.key)) return;
        e.preventDefault();
        if (this.keybindSaving) return;
        const named = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Space: 'Space', Backslash: '\\', Equal: e.shiftKey ? 'Plus' : '=' };
        const key = named[e.code] || (e.key.length === 1 ? e.key.toUpperCase() : e.key);
        const modifiers = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
        if (!e.ctrlKey && !e.altKey && !e.metaKey && !/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) {
            this.shortcutStatus = 'Not saved. Use Ctrl, Alt or Windows with a key, or a function key.';
            return;
        }
        const action = e.target.dataset.action;
        const binding = [...modifiers, key].join('+');
        const duplicate = Object.entries(this.keybinds).find(([name, value]) => name !== action && value.toLowerCase() === binding.toLowerCase());
        if (duplicate) {
            this.shortcutConflicts = { [action]: `Already assigned to ${this.getKeybindActions().find(item => item.key === duplicate[0])?.name || duplicate[0]}.` };
            this.shortcutStatus = 'Shortcut not saved: choose a different combination.';
            return;
        }
        // Do not blur: success must not disrupt keyboard traversal.
        return this.saveKeybinds({ ...this.keybinds, [action]: binding });
    }

    resetKeybinds() {
        return this.saveKeybinds(this.getDefaultKeybinds());
    }

    async restoreAllSettings() {
        if (this.isRestoring) return;
        this.isRestoring = true;
        this.clearStatusMessage = '';
        this.clearStatusType = '';
        this.requestUpdate();
        try {
            // Restore all preferences to defaults
            const defaults = {
                customPrompt: '',
                selectedProfile: 'interview',
                selectedLanguage: 'en-US',
                selectedScreenshotInterval: '5',
                selectedImageQuality: 'medium',
                audioMode: 'speaker_only',
                fontSize: 20,
                backgroundTransparency: 0.8,
                googleSearchEnabled: false,
                theme: 'dark',
            };
            for (const [key, value] of Object.entries(defaults)) {
                const result = await contextHalo.storage.updatePreference(key, value);
                if (result?.success === false) throw new Error('Some settings were not saved. Retry the reset.');
            }

            // Restore keybinds
            if (!await this.resetKeybinds()) throw new Error('Preferences restored, but shortcuts could not be reset. Previous bindings retained.');

            // Apply to local state
            this.selectedProfile = defaults.selectedProfile;
            this.selectedLanguage = defaults.selectedLanguage;
            this.selectedScreenshotInterval = defaults.selectedScreenshotInterval;
            this.selectedImageQuality = defaults.selectedImageQuality;
            this.audioMode = defaults.audioMode;
            this.fontSize = defaults.fontSize;
            this.backgroundTransparency = defaults.backgroundTransparency;
            this.googleSearchEnabled = defaults.googleSearchEnabled;
            this.customPrompt = defaults.customPrompt;
            this.theme = defaults.theme;

            // Notify parent callbacks
            await this.onProfileChange(defaults.selectedProfile);
            await this.onLanguageChange(defaults.selectedLanguage);
            await this.onScreenshotIntervalChange(defaults.selectedScreenshotInterval);
            await this.onImageQualityChange(defaults.selectedImageQuality);
            await this.onLayoutModeChange('normal');

            // Apply visual changes
            this.updateBackgroundAppearance();
            this.updateFontSize();
            await contextHalo.theme.save(defaults.theme);

            this.clearStatusMessage = 'All settings restored to defaults';
            this.clearStatusType = 'success';
        } catch (error) {
            console.error('Error restoring settings:', error);
            this.clearStatusMessage = `Error restoring settings: ${error.message}`;
            this.clearStatusType = 'error';
        } finally {
            this.isRestoring = false;
            this.requestUpdate();
        }
    }

    async clearLocalData() {
        if (this.isClearing) return;
        this.isClearing = true;
        this.clearStatusMessage = '';
        this.clearStatusType = '';
        this.requestUpdate();
        try {
            const result = await contextHalo.storage.clearAll();
            if (result?.success === false) throw new Error('No confirmation that data was cleared. Retry.');
            this.clearStatusMessage = 'Successfully cleared all local data';
            this.clearStatusType = 'success';
            this.requestUpdate();
            setTimeout(() => {
                this.clearStatusMessage = 'Closing application...';
                this.requestUpdate();
                setTimeout(async () => {
                    if (window.require) {
                        const { ipcRenderer } = window.require('electron');
                        await ipcRenderer.invoke('quit-application');
                    }
                }, 1000);
            }, 2000);
        } catch (error) {
            console.error('Error clearing data:', error);
            this.clearStatusMessage = `Error clearing data: ${error.message}`;
            this.clearStatusType = 'error';
        } finally {
            this.isClearing = false;
            this.requestUpdate();
        }
    }

    renderSessionSection() {
        return html`
            <section class="surface">
                <div class="surface-title">Session Defaults</div>
                <div class="surface-subtitle">Defaults used when you start a new assistant session.</div>
                <div class="form-grid">
                    <div class="form-help">Choose the session profile on Home. <button class="control" @click=${() => this.onOpenProviderSettings()}>Open Home</button></div>
                    <div class="form-group">
                        <label class="form-label" for="layout-mode">Window Layout</label>
                        <select id="layout-mode" class="control" .value=${this.layoutMode} @change=${this.handleLayoutModeSelect}>
                            <option value="normal">Normal</option>
                            <option value="compact">Compact sidebar</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <span class="form-label">Screen capture</span>
                        <div class="form-hint">On demand only. Use Analyze Screen or the capture shortcut; no automatic image requests are sent.</div>
                    </div>
                </div>
            </section>
        `;
    }

    renderProviderSection() {
        return html`
            <section class="surface">
                <div class="surface-title">AI Provider & Models</div>
                <div class="surface-subtitle">Gemini, Groq, Local AI, API keys, and model choices are shared with Home.</div>
                <div class="form-group">
                    <div class="form-help">Use one provider editor so credentials and model selections cannot drift between pages.</div>
                    <button class="control" style="width:auto;cursor:pointer;" @click=${() => this.onOpenProviderSettings()}>Open provider setup</button>
                </div>
            </section>
        `;
    }

    renderAISection() {
        return html`
            <section class="surface">
                <div class="surface-title">AI Behavior</div>
                <div class="surface-subtitle">Shared instructions and optional search grounding for new sessions.</div>
                <div class="form-grid">
                    <label class="toggle-row">
                        <input class="toggle-input" type="checkbox" .checked=${this.googleSearchEnabled} @change=${this.handleGoogleSearchChange} />
                        <span class="toggle-label">Request Google Search for the next Gemini session (Live, typed and screen)</span>
                    </label>
                    <div class="form-group vertical">
                        <div class="form-help">Edit shared instructions in AI Customization. Saved instructions still apply to new sessions.</div>
                        <button class="control" @click=${() => this.onOpenInstructions()}>Open AI Customization</button>
                    </div>
                </div>
            </section>
        `;
    }

    renderAudioSection() {
        return html`
            <section class="surface">
                <div class="surface-title">Audio Input</div>
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label" for="audio-mode">Audio Mode</label>
                        <select id="audio-mode" class="control" .value=${this.audioMode} @change=${this.handleAudioModeSelect}>
                            <option value="speaker_only">Speaker Only (Interviewer)</option>
                            <option value="mic_only">Microphone Only (Me)</option>
                            <option value="both">Both Speaker and Microphone</option>
                        </select>
                    </div>
                    ${this.audioMode !== 'speaker_only' ? html`
                        <div class="warning-callout">Microphone capture requires permission. Mixed audio includes both your voice and speaker audio; use headphones to reduce echo.</div>
                    ` : ''}
                    <div class="form-group">
                        <label class="form-label" for="image-quality">Image Quality</label>
                        <select id="image-quality" class="control" .value=${this.selectedImageQuality} @change=${this.handleImageQualitySelect}>
                            <option value="high">High Quality</option>
                            <option value="medium">Medium Quality</option>
                            <option value="low">Low Quality</option>
                        </select>
                    </div>
                </div>
            </section>
        `;
    }

    renderLanguageSection() {
        return html`
            <section class="surface">
                <div class="surface-title">Language</div>
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label" for="speech-language">Speech Language</label>
                        <select id="speech-language" class="control" .value=${this.selectedLanguage} @change=${this.handleLanguageSelect}>
                            ${this.getLanguages().map(language => html`<option value=${language.value}>${language.name}</option>`)}
                        </select>
                    </div>
                </div>
            </section>
        `;
    }

    renderAppearanceSection() {
        return html`
            <section class="surface">
                <div class="surface-title">Appearance</div>
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label" for="theme">Theme</label>
                        <select id="theme" class="control" .value=${this.theme} @change=${this.handleThemeChange}>
                            ${this.getThemes().map(theme => html`<option value=${theme.value}>${theme.name}</option>`)}
                        </select>
                    </div>
                    <div class="form-group slider-wrap">
                        <div class="slider-header">
                            <label class="form-label" for="hud-opacity">HUD background opacity</label>
                            <span class="slider-value">${Math.round(this.backgroundTransparency * 100)}%</span>
                        </div>
                        <input
                            class="slider-input"
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            id="hud-opacity"
                            aria-valuetext=${`${Math.round(this.backgroundTransparency * 100)} percent opaque`}
                            .value=${this.backgroundTransparency}
                            @input=${this.handleBackgroundTransparencyChange}
                        />
                        <div class="form-hint">0% is transparent; 100% is opaque. Text and controls stay solid. Normal pages are unaffected.</div>
                    </div>
                    <div class="form-group slider-wrap">
                        <div class="slider-header">
                            <label class="form-label" for="response-font">Response Font Size</label>
                            <span class="slider-value">${this.fontSize}px</span>
                        </div>
                        <input
                            class="slider-input"
                            type="range"
                            id="response-font"
                            min="12"
                            max="32"
                            step="1"
                            .value=${this.fontSize}
                            @input=${this.handleFontSizeChange}
                        />
                    </div>
                </div>
            </section>
        `;
    }

    renderKeyboardSection() {
        return html`
            <section class="surface">
                <div class="surface-title">Keyboard Shortcuts</div>
                ${this.getKeybindActions().map(action => html`
                    <div class="keybind-row">
                        <label class="keybind-name" for=${`shortcut-${action.key}`}>${action.name}</label>
                        <input
                            type="text"
                            class="control keybind-input"
                            .value=${this.keybinds[action.key]}
                            id=${`shortcut-${action.key}`}
                            aria-describedby=${`shortcut-help shortcut-error-${action.key}`}
                            aria-invalid=${this.shortcutConflicts[action.key] ? 'true' : 'false'}
                            aria-busy=${this.keybindSaving ? 'true' : 'false'}
                            data-action=${action.key}
                            @keydown=${this.handleKeybindInput}
                            @focus=${this.handleKeybindFocus}
                            @blur=${this.handleKeybindBlur}
                            readonly
                        />
                    </div>
                    <div id=${`shortcut-error-${action.key}`} class="form-help">${this.shortcutConflicts[action.key] || ''}</div>
                `)}
                <p id="shortcut-help" class="form-help">Tab and Shift+Tab navigate. Escape cancels. Hide does not stop capture. To restore a hidden window, use ${this.keybinds.toggleVisibility} or the ContextHalo notification-area icon; when unavailable, the window minimizes to the taskbar.</p>
                <p class="form-help" role="status">${this.shortcutStatus}</p>
                <div style="margin-top: var(--space-sm);">
                    <button class="control" style="width:auto;padding:8px 10px;" @click=${this.resetKeybinds} ?disabled=${this.keybindSaving}>Reset shortcuts to defaults</button>
                </div>
            </section>
        `;
    }

    renderPrivacySection() {
        return html`
            <section class="surface danger-surface">
                <div class="surface-title danger">Privacy and Data</div>
                <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;">
                    <button class="danger-button" @click=${this.restoreAllSettings} ?disabled=${this.isRestoring}>
                        ${this.isRestoring ? 'Restoring...' : 'Restore all settings'}
                    </button>
                    <button class="danger-button" @click=${this.clearLocalData} ?disabled=${this.isClearing}>
                        ${this.isClearing ? 'Clearing...' : 'Delete all data'}
                    </button>
                </div>
                ${this.clearStatusMessage ? html`
                    <div class="status ${this.clearStatusType === 'success' ? 'success' : 'error'}">${this.clearStatusMessage}</div>
                ` : ''}
            </section>
        `;
    }

    render() {
        return html`
            <div class="unified-page">
                <div class="unified-wrap">
                    <div class="page-title">Settings</div>
                    <div class="page-subtitle">Configure session defaults, AI behavior, audio, appearance, keyboard shortcuts, and local data.</div>
                    ${this.renderSaveFeedback()}
                    <fieldset style="border:0;padding:0;margin:0;min-width:0;display:contents" ?disabled=${this.settingsLoading || Boolean(this.saveStates.load)}>
                    ${this.renderSessionSection()}
                    ${this.renderProviderSection()}
                    ${this.renderAISection()}
                    ${this.renderAudioSection()}
                    ${this.renderLanguageSection()}
                    ${this.renderAppearanceSection()}
                    ${this.renderKeyboardSection()}
                    ${this.renderPrivacySection()}
                    </fieldset>
                </div>
            </div>
        `;
    }
}

customElements.define('customize-view', CustomizeView);
