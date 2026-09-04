const fs = require('node:fs');

function read(file) {
    return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function replaceOnce(file, before, after, label) {
    const source = read(file);
    const first = source.indexOf(before);
    if (first < 0) throw new Error(`Could not find ${label} in ${file}`);
    if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Expected one ${label} in ${file}`);
    fs.writeFileSync(file, source.slice(0, first) + after + source.slice(first + before.length), 'utf8');
}

// -----------------------------------------------------------------------------
// App shell: startup hydration, visible start errors, initialization state, and
// working maximize control.
// -----------------------------------------------------------------------------
const appFile = 'src/components/app/ContextHaloApp.js';
replaceOnce(
    appFile,
    `        isRecording: { type: Boolean },\n        sessionActive: { type: Boolean },`,
    `        isRecording: { type: Boolean },\n        sessionActive: { type: Boolean },\n        isInitializing: { type: Boolean },\n        startError: { type: String },`,
    'app start state properties'
);
replaceOnce(
    appFile,
    `        this.isRecording = false;\n        this.sessionActive = false;`,
    `        this.isRecording = false;\n        this.sessionActive = false;\n        this.isInitializing = false;\n        this.startError = '';`,
    'app start state defaults'
);
replaceOnce(
    appFile,
    `        .fullscreen {\n            position: fixed;\n            inset: 0;\n            z-index: 100;\n            background: var(--bg-app);\n        }\n\n        ::-webkit-scrollbar {`,
    `        .fullscreen {\n            position: fixed;\n            inset: 0;\n            z-index: 100;\n            background: var(--bg-app);\n        }\n\n        .startup-shell {\n            width: 100%;\n            height: 100%;\n            display: grid;\n            place-items: center;\n            background: var(--bg-app);\n            color: var(--text-primary);\n        }\n\n        .startup-card {\n            display: flex;\n            align-items: center;\n            gap: 12px;\n            padding: 14px 18px;\n            border: 1px solid var(--border);\n            border-radius: var(--radius-md);\n            background: var(--bg-surface);\n            font-size: var(--font-size-sm);\n            color: var(--text-secondary);\n        }\n\n        .startup-spinner {\n            width: 16px;\n            height: 16px;\n            border: 2px solid var(--border-strong);\n            border-top-color: var(--accent);\n            border-radius: 50%;\n            animation: startup-spin 0.8s linear infinite;\n        }\n\n        @keyframes startup-spin {\n            to { transform: rotate(360deg); }\n        }\n\n        .app-shell.compact .sidebar {\n            width: 184px;\n            min-width: 184px;\n        }\n\n        ::-webkit-scrollbar {`,
    'startup shell styles'
);
replaceOnce(
    appFile,
    `            ipcRenderer.on('update-status', (_, status) => this.setStatus(status));\n            ipcRenderer.on('click-through-toggled', (_, isEnabled) => {`,
    `            ipcRenderer.on('update-status', (_, status) => this.setStatus(status));\n            ipcRenderer.on('session-initializing', (_, active) => {\n                this.isInitializing = Boolean(active);\n                if (active) this.startError = '';\n                this.requestUpdate();\n            });\n            ipcRenderer.on('click-through-toggled', (_, isEnabled) => {`,
    'session initialization listener'
);
replaceOnce(
    appFile,
    `            ipcRenderer.removeAllListeners('update-status');\n            ipcRenderer.removeAllListeners('click-through-toggled');`,
    `            ipcRenderer.removeAllListeners('update-status');\n            ipcRenderer.removeAllListeners('session-initializing');\n            ipcRenderer.removeAllListeners('click-through-toggled');`,
    'session initialization listener cleanup'
);
replaceOnce(
    appFile,
    `    async _handleMinimize() {\n        if (window.require) {\n            const { ipcRenderer } = window.require('electron');\n            await ipcRenderer.invoke('window-minimize');\n        }\n    }\n\n    async handleHideToggle() {`,
    `    async _handleMinimize() {\n        if (window.require) {\n            const { ipcRenderer } = window.require('electron');\n            await ipcRenderer.invoke('window-minimize');\n        }\n    }\n\n    async _handleMaximize() {\n        if (window.require) {\n            const { ipcRenderer } = window.require('electron');\n            await ipcRenderer.invoke('window-toggle-maximize');\n        }\n    }\n\n    async handleHideToggle() {`,
    'maximize handler'
);

const oldHandleStart = `    async handleStart() {\n        const prefs = await contextHalo.storage.getPreferences();\n        const providerMode = prefs.providerMode || 'byok';\n\n        const failStart = message => {\n            this.setStatus(message);\n            const mainView = this.shadowRoot.querySelector('main-view');\n            if (mainView && mainView.triggerApiKeyError) {\n                mainView.triggerApiKeyError();\n            }\n        };\n\n        let success = false;\n\n        if (providerMode === 'cloud') {\n            const creds = await contextHalo.storage.getCredentials();\n            if (!creds.cloudToken || creds.cloudToken.trim() === '') {\n                failStart('No cloud token configured');\n                return;\n            }\n            success = await contextHalo.initializeCloud(this.selectedProfile);\n        } else if (providerMode === 'local') {\n            success = await contextHalo.initializeLocal(this.selectedProfile, this.selectedLanguage);\n        } else if (providerMode === 'groq') {\n            const groqKey = await contextHalo.storage.getGroqApiKey();\n            if (!groqKey || groqKey.trim() === '') {\n                failStart('No Groq API key configured');\n                return;\n            }\n            success = await contextHalo.initializeGemini(this.selectedProfile, this.selectedLanguage);\n        } else {\n            const apiKey = await contextHalo.storage.getApiKey();\n            if (!apiKey || apiKey.trim() === '') {\n                failStart('No Gemini API key configured');\n                return;\n            }\n            success = await contextHalo.initializeGemini(this.selectedProfile, this.selectedLanguage);\n        }\n\n        // Never enter the assistant screen after a provider initialization failure.\n        if (!success) {\n            failStart(this.statusText || 'Could not connect to the selected AI provider');\n            return;\n        }\n\n        const captureStarted = await contextHalo.startCapture(this.selectedScreenshotInterval, this.selectedImageQuality);\n        if (!captureStarted) {\n            if (window.require) {\n                const { ipcRenderer } = window.require('electron');\n                await ipcRenderer.invoke('close-session');\n            }\n            failStart(this.statusText || 'Could not start screen/audio capture');\n            return;\n        }\n\n        this.responses = [];\n        this.currentResponseIndex = -1;\n        this.startTime = Date.now();\n        this.sessionActive = true;\n        this.currentView = 'assistant';\n        this._startTimer();\n    }`;
const newHandleStart = `    async handleStart() {\n        if (this.isInitializing || this.sessionActive) return;\n\n        this.isInitializing = true;\n        this.startError = '';\n        this.setStatus('Preparing session...');\n        this.requestUpdate();\n\n        const failStart = message => {\n            const detail = String(message || 'Session could not be started');\n            this.startError = detail;\n            this.setStatus(detail);\n            const mainView = this.shadowRoot.querySelector('main-view');\n            if (/api key|authentication|credential/i.test(detail) && mainView?.triggerApiKeyError) {\n                mainView.triggerApiKeyError();\n            }\n            this.requestUpdate();\n        };\n\n        try {\n            const prefs = await contextHalo.storage.getPreferences();\n            const providerMode = prefs.providerMode || 'byok';\n            let success = false;\n\n            if (providerMode === 'local') {\n                this.setStatus('Preparing local AI...');\n                success = await contextHalo.initializeLocal(this.selectedProfile, this.selectedLanguage);\n            } else if (providerMode === 'groq') {\n                const groqKey = await contextHalo.storage.getGroqApiKey();\n                if (!groqKey || groqKey.trim() === '') {\n                    failStart('No Groq API key configured');\n                    return;\n                }\n                this.setStatus('Connecting to Groq...');\n                success = await contextHalo.initializeGemini(this.selectedProfile, this.selectedLanguage);\n            } else {\n                const apiKey = await contextHalo.storage.getApiKey();\n                if (!apiKey || apiKey.trim() === '') {\n                    failStart('No Gemini API key configured');\n                    return;\n                }\n                this.setStatus('Connecting to Gemini Live...');\n                success = await contextHalo.initializeGemini(this.selectedProfile, this.selectedLanguage);\n            }\n\n            if (!success) {\n                failStart(this.statusText || 'Could not connect to the selected AI provider');\n                return;\n            }\n\n            this.setStatus('Starting Windows screen and audio capture...');\n            const captureStarted = await contextHalo.startCapture(this.selectedScreenshotInterval, this.selectedImageQuality);\n            if (!captureStarted) {\n                if (window.require) {\n                    const { ipcRenderer } = window.require('electron');\n                    await ipcRenderer.invoke('close-session');\n                }\n                failStart(this.statusText || 'Could not start screen/audio capture');\n                return;\n            }\n\n            this.responses = [];\n            this.currentResponseIndex = -1;\n            this.startTime = Date.now();\n            this.sessionActive = true;\n            this.startError = '';\n            this.currentView = 'assistant';\n            this.setStatus(providerMode === 'groq' ? 'Groq ready' : providerMode === 'local' ? 'Local AI ready' : 'Listening...');\n            this._startTimer();\n        } catch (error) {\n            try {\n                if (window.require) {\n                    const { ipcRenderer } = window.require('electron');\n                    await ipcRenderer.invoke('close-session');\n                }\n            } catch {}\n            failStart(error?.message || String(error));\n        } finally {\n            this.isInitializing = false;\n            this.requestUpdate();\n        }\n    }`;
replaceOnce(appFile, oldHandleStart, newHandleStart, 'session start flow');
replaceOnce(
    appFile,
    `                        .onStart=${'${'}() => this.handleStart()}\n                        .onExternalLink=${'${'}url => this.handleExternalLinkClick(url)}\n                        .whisperDownloading=${'${'}this._whisperDownloading}`,
    `                        .onStart=${'${'}() => this.handleStart()}\n                        .onExternalLink=${'${'}url => this.handleExternalLinkClick(url)}\n                        .isInitializing=${'${'}this.isInitializing}\n                        .statusText=${'${'}this.statusText}\n                        .startError=${'${'}this.startError}\n                        .whisperDownloading=${'${'}this._whisperDownloading}`,
    'main view runtime status properties'
);
replaceOnce(
    appFile,
    `    render() {\n        // Onboarding is fullscreen, no sidebar\n        if (this.currentView === 'onboarding') {`,
    `    render() {\n        if (!this._storageLoaded) {\n            return html\`\n                <div class="startup-shell">\n                    <div class="startup-card"><span class="startup-spinner"></span><span>Loading ContextHalo settings…</span></div>\n                </div>\n            \`;\n        }\n\n        // Onboarding is fullscreen, no sidebar\n        if (this.currentView === 'onboarding') {`,
    'storage hydration render gate'
);
replaceOnce(
    appFile,
    `            <div class="app-shell">`,
    `            <div class="app-shell ${'${'}this.layoutMode === 'compact' ? 'compact' : ''}">`,
    'layout class'
);
replaceOnce(
    appFile,
    `                        <button class="traffic-light maximize" title="Maximize"></button>`,
    `                        <button class="traffic-light maximize" @click=${'${'}() => this._handleMaximize()} title="Maximize or restore"></button>`,
    'maximize button wiring'
);

// -----------------------------------------------------------------------------
// Renderer bridge and Windows media capture lifecycle.
// -----------------------------------------------------------------------------
const rendererFile = 'src/utils/renderer.js';
replaceOnce(
    rendererFile,
    `let micAudioProcessor = null;\nlet audioBuffer = [];`,
    `let micAudioProcessor = null;\nlet micAudioContext = null;\nlet micMediaStream = null;\nlet audioBuffer = [];`,
    'microphone lifecycle state'
);
replaceOnce(
    rendererFile,
    `        } else {\n            // Windows - use display media with loopback for system audio\n            mediaStream = await navigator.mediaDevices.getDisplayMedia({\n                video: {\n                    frameRate: 1,\n                    width: { ideal: 1920 },\n                    height: { ideal: 1080 },\n                },\n                audio: {\n                    sampleRate: SAMPLE_RATE,\n                    channelCount: 1,\n                    echoCancellation: true,\n                    noiseSuppression: true,\n                    autoGainControl: true,\n                },\n            });\n\n            console.log('Windows capture started with loopback audio');\n\n            // Setup audio processing for Windows loopback audio only\n            setupWindowsLoopbackProcessing();\n\n            if (audioMode === 'mic_only' || audioMode === 'both') {\n                let micStream = null;\n                try {\n                    micStream = await navigator.mediaDevices.getUserMedia({\n                        audio: {\n                            sampleRate: SAMPLE_RATE,\n                            channelCount: 1,\n                            echoCancellation: true,\n                            noiseSuppression: true,\n                            autoGainControl: true,\n                        },\n                        video: false,\n                    });\n                    console.log('Windows microphone capture started');\n                    setupLinuxMicProcessing(micStream);\n                } catch (micError) {\n                    console.warn('Failed to get microphone access on Windows:', micError);\n                }\n            }\n        }`,
    `        } else {\n            // Windows: Electron's main-process display-media handler selects the\n            // primary screen and supplies WASAPI loopback. Do not apply microphone\n            // processing constraints to that loopback track.\n            const needsLoopback = audioMode !== 'mic_only';\n            mediaStream = await navigator.mediaDevices.getDisplayMedia({\n                video: {\n                    frameRate: 1,\n                    width: { ideal: 1920 },\n                    height: { ideal: 1080 },\n                },\n                audio: needsLoopback,\n            });\n\n            if (needsLoopback) {\n                if (mediaStream.getAudioTracks().length === 0) {\n                    throw new Error('Windows system-audio loopback was not available. Make sure audio is playing and try again.');\n                }\n                console.log('Windows capture started with loopback audio');\n                setupWindowsLoopbackProcessing();\n            } else {\n                console.log('Windows screen capture started without loopback (microphone-only mode)');\n            }\n\n            if (audioMode === 'mic_only' || audioMode === 'both') {\n                try {\n                    micMediaStream = await navigator.mediaDevices.getUserMedia({\n                        audio: {\n                            sampleRate: SAMPLE_RATE,\n                            channelCount: 1,\n                            echoCancellation: true,\n                            noiseSuppression: true,\n                            autoGainControl: true,\n                        },\n                        video: false,\n                    });\n                    console.log('Windows microphone capture started');\n                    setupLinuxMicProcessing(micMediaStream);\n                } catch (micError) {\n                    if (audioMode === 'mic_only') throw new Error('Microphone capture failed: ' + micError.message);\n                    console.warn('Failed to get microphone access on Windows; continuing with speaker audio:', micError);\n                    contextHalo.setStatus('Microphone unavailable; continuing with speaker audio');\n                }\n            }\n        }`,
    'Windows media capture flow'
);
replaceOnce(
    rendererFile,
    `function setupLinuxMicProcessing(micStream) {\n    // Setup microphone audio processing for Linux\n    const micAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });\n    const micSource = micAudioContext.createMediaStreamSource(micStream);`,
    `function setupLinuxMicProcessing(micStream) {\n    if (micAudioProcessor) {\n        try { micAudioProcessor.disconnect(); } catch {}\n        micAudioProcessor = null;\n    }\n    if (micAudioContext) {\n        micAudioContext.close().catch(() => {});\n    }\n    micAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });\n    const micSource = micAudioContext.createMediaStreamSource(micStream);`,
    'microphone audio context ownership'
);
replaceOnce(
    rendererFile,
    `    if (micAudioProcessor) {\n        micAudioProcessor.disconnect();\n        micAudioProcessor = null;\n    }\n\n    if (audioContext) {`,
    `    if (micAudioProcessor) {\n        try { micAudioProcessor.disconnect(); } catch {}\n        micAudioProcessor = null;\n    }\n\n    if (micAudioContext) {\n        micAudioContext.close().catch(() => {});\n        micAudioContext = null;\n    }\n\n    if (micMediaStream) {\n        micMediaStream.getTracks().forEach(track => track.stop());\n        micMediaStream = null;\n    }\n\n    if (audioContext) {`,
    'microphone media cleanup'
);
replaceOnce(
    rendererFile,
    `    getVersion: async () => ipcRenderer.invoke('get-app-version'),`,
    `    getVersion: async () => {\n        const result = await ipcRenderer.invoke('get-app-version');\n        return result?.success ? result.data : '';\n    },`,
    'app version response unwrap'
);

// -----------------------------------------------------------------------------
// Gemini Live: use main-process preferences, normalize the selected model, and
// omit empty session-resumption config.
// -----------------------------------------------------------------------------
const geminiFile = 'src/utils/gemini.js';
replaceOnce(
    geminiFile,
    `const { getAvailableModel, incrementLimitCount, getApiKey, getGroqApiKey, incrementCharUsage, getConfig } = require('../storage');`,
    `const { getAvailableModel, incrementLimitCount, getApiKey, getGroqApiKey, incrementCharUsage, getConfig, getPreferences } = require('../storage');`,
    'Gemini preference import'
);
const oldTools = `async function getEnabledTools() {\n    const tools = [];\n\n    // Check if Google Search is enabled (default: true)\n    const googleSearchEnabled = await getStoredSetting('googleSearchEnabled', 'true');\n    console.log('Google Search enabled:', googleSearchEnabled);\n\n    if (googleSearchEnabled === 'true') {\n        tools.push({ googleSearch: {} });\n        console.log('Added Google Search tool');\n    } else {\n        console.log('Google Search tool disabled');\n    }\n\n    return tools;\n}\n\nasync function getStoredSetting(key, defaultValue) {\n    try {\n        const windows = BrowserWindow.getAllWindows();\n        if (windows.length > 0) {\n            // Wait a bit for the renderer to be ready\n            await new Promise(resolve => setTimeout(resolve, 100));\n\n            // Try to get setting from renderer process localStorage\n            const value = await windows[0].webContents.executeJavaScript(\`\n                (function() {\n                    try {\n                        if (typeof localStorage === 'undefined') {\n                            console.log('localStorage not available yet for ${'${'}key}');\n                            return '${'${'}defaultValue}';\n                        }\n                        const stored = localStorage.getItem('${'${'}key}');\n                        console.log('Retrieved setting ${'${'}key}:', stored);\n                        return stored || '${'${'}defaultValue}';\n                    } catch (e) {\n                        console.error('Error accessing localStorage for ${'${'}key}:', e);\n                        return '${'${'}defaultValue}';\n                    }\n                })()\n            \`);\n            return value;\n        }\n    } catch (error) {\n        console.error('Error getting stored setting for', key, ':', error.message);\n    }\n    console.log('Using default value for', key, ':', defaultValue);\n    return defaultValue;\n}`;
const newTools = `async function getEnabledTools() {\n    const tools = [];\n    const googleSearchEnabled = getPreferences().googleSearchEnabled === true;\n    console.log('Google Search enabled:', googleSearchEnabled);\n    if (googleSearchEnabled) tools.push({ googleSearch: {} });\n    return tools;\n}\n\nasync function getStoredSetting(key, defaultValue) {\n    if (key === 'googleSearchEnabled') {\n        return String(getPreferences().googleSearchEnabled === true);\n    }\n    return defaultValue;\n}`;
replaceOnce(geminiFile, oldTools, newTools, 'main-process Google Search preference');
replaceOnce(
    geminiFile,
    `    const systemPrompt = getSystemPrompt(profile, customPrompt, googleSearchEnabled);\n    currentSystemPrompt = systemPrompt; // Store for Groq\n\n    // Initialize new conversation session only on first connect`,
    `    const systemPrompt = getSystemPrompt(profile, customPrompt, googleSearchEnabled);\n    currentSystemPrompt = systemPrompt; // Store for Groq\n    const liveModel = String(getConfig().geminiLiveModel || 'gemini-3.1-flash-live-preview')\n        .replace(/^models\\//, '')\n        .trim() || 'gemini-3.1-flash-live-preview';\n    sendToRenderer('update-status', \`Connecting to ${'${'}liveModel}...\`);\n\n    // Initialize new conversation session only on first connect`,
    'Gemini Live model normalization'
);
replaceOnce(geminiFile, `            model: getConfig().geminiLiveModel,`, `            model: liveModel,`, 'Gemini Live model use');
replaceOnce(
    geminiFile,
    `                sessionResumption: geminiSessionResumptionHandle\n                    ? { handle: geminiSessionResumptionHandle }\n                    : {},\n                tools: enabledTools,`,
    `                ...(geminiSessionResumptionHandle\n                    ? { sessionResumption: { handle: geminiSessionResumptionHandle } }\n                    : {}),\n                tools: enabledTools,`,
    'conditional Gemini session resumption'
);

// -----------------------------------------------------------------------------
// Home screen: useful session setup, visible status/errors, larger layout, and
// native option colors that remain readable in Windows dropdown popups.
// -----------------------------------------------------------------------------
const mainViewFile = 'src/components/views/MainView.js';
replaceOnce(
    mainViewFile,
    `        :host {\n            height: 100%;\n            display: flex;\n            flex-direction: column;\n            align-items: center;\n            justify-content: center;\n            padding: var(--space-xl) var(--space-lg);\n        }\n\n        .form-wrapper {\n            width: 100%;\n            max-width: 420px;\n            display: flex;\n            flex-direction: column;\n            gap: var(--space-md);\n        }`,
    `        :host {\n            height: 100%;\n            min-height: 100%;\n            display: block;\n            overflow-y: auto;\n            padding: 58px clamp(24px, 6vw, 72px) 44px;\n        }\n\n        .form-wrapper {\n            width: min(760px, 100%);\n            margin: 0 auto;\n            display: flex;\n            flex-direction: column;\n            gap: var(--space-md);\n        }`,
    'Home layout sizing'
);
replaceOnce(
    mainViewFile,
    `        select {\n            cursor: pointer;\n            appearance: none;\n            background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23999' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");\n            background-position: right 8px center;\n            background-repeat: no-repeat;\n            background-size: 14px;\n            padding-right: 28px;\n        }`,
    `        select {\n            cursor: pointer;\n            appearance: none;\n            color-scheme: dark;\n            background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23999' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");\n            background-position: right 8px center;\n            background-repeat: no-repeat;\n            background-size: 14px;\n            padding-right: 28px;\n        }\n\n        select option,\n        select optgroup {\n            background: #191919;\n            color: #f5f5f5;\n        }`,
    'Home select popup contrast'
);
replaceOnce(
    mainViewFile,
    `        /* ── Start button ── */\n\n        .start-button {`,
    `        .session-status {\n            display: flex;\n            align-items: flex-start;\n            gap: 8px;\n            padding: 10px 12px;\n            border: 1px solid var(--border);\n            border-radius: var(--radius-sm);\n            background: var(--bg-elevated);\n            color: var(--text-secondary);\n            font-size: var(--font-size-xs);\n            line-height: 1.45;\n        }\n\n        .session-status.error {\n            border-color: rgba(239, 68, 68, 0.55);\n            background: rgba(239, 68, 68, 0.08);\n            color: #fca5a5;\n        }\n\n        .session-status-dot {\n            width: 7px;\n            height: 7px;\n            flex: none;\n            margin-top: 5px;\n            border-radius: 50%;\n            background: currentColor;\n        }\n\n        /* ── Start button ── */\n\n        .start-button {`,
    'Home session status styles'
);
replaceOnce(
    mainViewFile,
    `        isInitializing: { type: Boolean },\n        whisperDownloading: { type: Boolean },`,
    `        isInitializing: { type: Boolean },\n        statusText: { type: String },\n        startError: { type: String },\n        whisperDownloading: { type: Boolean },`,
    'Home status properties'
);
replaceOnce(
    mainViewFile,
    `        this.isInitializing = false;\n        this.whisperDownloading = false;`,
    `        this.isInitializing = false;\n        this.statusText = '';\n        this.startError = '';\n        this.whisperDownloading = false;`,
    'Home status defaults'
);
replaceOnce(
    mainViewFile,
    `    _renderStartButton() {`,
    `    _renderProfileSelector() {\n        const profiles = [\n            ['interview', 'Job Interview'],\n            ['sales', 'Sales Call'],\n            ['meeting', 'Business Meeting'],\n            ['presentation', 'Presentation'],\n            ['negotiation', 'Negotiation'],\n            ['exam', 'Exam Assistant'],\n        ];\n        return html\`\n            <details class="config-section" open>\n                <summary class="config-summary">\n                    <span class="config-summary-text">\n                        <span class="config-summary-title">Session</span>\n                        <span class="config-summary-description">Choose how ContextHalo should assist you</span>\n                    </span>\n                    ${'${'}this._renderConfigChevron()}\n                </summary>\n                <div class="config-content">\n                    <div class="form-group">\n                        <label class="form-label">Session Profile</label>\n                        <select .value=${'${'}this.selectedProfile} @change=${'${'}event => this.onProfileChange(event.target.value)}>\n                            ${'${'}profiles.map(([value, label]) => html\`<option value=${'${'}value}>${'${'}label}</option>\`)}\n                        </select>\n                        <div class="form-hint">The profile changes the live system prompt for the session.</div>\n                    </div>\n                </div>\n            </details>\n        \`;\n    }\n\n    _renderSessionStatus() {\n        const error = String(this.startError || '').trim();\n        const text = error || (this.isInitializing ? (this.statusText || 'Starting session…') : '');\n        if (!text) return '';\n        return html\`\n            <div class="session-status ${'${'}error ? 'error' : ''}" role=${'${'}error ? 'alert' : 'status'}>\n                <span class="session-status-dot"></span>\n                <span>${'${'}text}</span>\n            </div>\n        \`;\n    }\n\n    _renderStartButton() {`,
    'Home profile and session status render helpers'
);
replaceOnce(
    mainViewFile,
    `${'${'}isDownloading ? (hasPercentage ? \`${'${'}percentage}%\` : 'Preparing...') : 'Start Session'}`,
    `${'${'}isDownloading ? (hasPercentage ? \`${'${'}percentage}%\` : 'Preparing...') : this.isInitializing ? 'Starting…' : 'Start Session'}`,
    'Start button initializing label'
);
replaceOnce(
    mainViewFile,
    `                <div class="page-subtitle">${'${'}this._mode === 'byok' ? 'Bring your own API keys' : 'Run models locally on your machine'}</div>\n\n                <!-- Cloud mode render branch intentionally disabled. -->`,
    `                <div class="page-subtitle">${'${'}this._mode === 'byok' ? 'Bring your own API keys' : 'Run models locally on your machine'}</div>\n                ${'${'}this._renderProfileSelector()}\n                ${'${'}this._renderSessionStatus()}\n\n                <!-- Cloud mode render branch intentionally disabled. -->`,
    'Home session setup content'
);

// The Groq-only runtime render bypasses MainView.render, so keep the same setup/status.
const runtimeProviderFile = 'src/utils/runtimeProviderFixes.js';
replaceOnce(
    runtimeProviderFile,
    `                <div class="page-subtitle">Use your Groq free-tier API key without opening a Gemini Live session</div>\n                ${'${'}this._renderGroqMode()}`,
    `                <div class="page-subtitle">Use your Groq API key without opening a Gemini Live session</div>\n                ${'${'}this._renderProfileSelector ? this._renderProfileSelector() : ''}\n                ${'${'}this._renderSessionStatus ? this._renderSessionStatus() : ''}\n                ${'${'}this._renderGroqMode()}`,
    'Groq Home session setup content'
);

// -----------------------------------------------------------------------------
// Dynamic provider registry: do not offer known-incompatible advanced models in
// the Live/transcription selectors, and repair a stale Live selection once the
// provider catalog is available.
// -----------------------------------------------------------------------------
const dynamicModelsFile = 'src/utils/dynamicModelRegistryRenderer.js';
replaceOnce(
    dynamicModelsFile,
    `        onSave,\n        helper = '',\n    } = options;`,
    `        onSave,\n        helper = '',\n        allowAdvanced = true,\n    } = options;`,
    'model picker advanced option flag'
);
replaceOnce(
    dynamicModelsFile,
    `    const advancedModels = uniqueModels(all.filter(model => !preferredIds.has(model.id)));`,
    `    const advancedModels = allowAdvanced ? uniqueModels(all.filter(model => !preferredIds.has(model.id))) : [];`,
    'model picker advanced filtering'
);
replaceOnce(
    dynamicModelsFile,
    `            this[catalogKey] = result.data;\n            if (result.data?.warning) this[errorKey] = \`Using cached catalog: ${'${'}result.data.warning}\`;`,
    `            this[catalogKey] = result.data;\n            if (isGemini && Array.isArray(result.data?.live) && result.data.live.length) {\n                const currentLive = this._geminiLiveModel || GEMINI_DEFAULTS.live;\n                if (!result.data.live.some(model => model.id === currentLive)) {\n                    await this._saveGeminiLiveModel(result.data.recommended?.live || GEMINI_DEFAULTS.live);\n                }\n            }\n            if (result.data?.warning) this[errorKey] = \`Using cached catalog: ${'${'}result.data.warning}\`;`,
    'stale Gemini Live model repair'
);
replaceOnce(
    dynamicModelsFile,
    `                        all,\n                        onSave: this._saveGeminiLiveModel,\n                        helper: 'Live-compatible models are identified from the provider-supported generation methods. Advanced choices may not support Live sessions.',`,
    `                        all: catalog?.live || [],\n                        onSave: this._saveGeminiLiveModel,\n                        allowAdvanced: false,\n                        helper: 'Only models that advertise Gemini Live (bidiGenerateContent) support are offered here.',`,
    'Gemini Live compatible-only picker'
);
replaceOnce(
    dynamicModelsFile,
    `                        all,\n                        onSave: this._saveGroqTranscriptionModel,\n                        helper: 'Whisper/transcription IDs are preferred. Advanced selections may not support the transcription endpoint.',`,
    `                        all: catalog?.transcription || [],\n                        onSave: this._saveGroqTranscriptionModel,\n                        allowAdvanced: false,\n                        helper: 'Only Whisper/transcription models detected from the Groq catalog are offered here.',`,
    'Groq transcription compatible-only picker'
);

// -----------------------------------------------------------------------------
// Shared Settings controls: readable native select popup.
// -----------------------------------------------------------------------------
const sharedStylesFile = 'src/components/views/sharedPageStyles.js';
replaceOnce(
    sharedStylesFile,
    `    select.control {\n        appearance: none;`,
    `    select.control {\n        appearance: none;\n        color-scheme: dark;`,
    'Settings select color scheme'
);
replaceOnce(
    sharedStylesFile,
    `    textarea.control {`,
    `    select.control option,\n    select.control optgroup {\n        background: #191919;\n        color: #f5f5f5;\n    }\n\n    textarea.control {`,
    'Settings select option contrast'
);

// -----------------------------------------------------------------------------
// Settings: expose the existing but previously hidden session/AI settings, make
// compact layout functional, and include emergency erase in keybind management.
// -----------------------------------------------------------------------------
const settingsFile = 'src/components/views/CustomizeView.js';
replaceOnce(
    settingsFile,
    `        selectedLanguage: { type: String },\n        selectedImageQuality: { type: String },`,
    `        selectedLanguage: { type: String },\n        selectedScreenshotInterval: { type: String },\n        selectedImageQuality: { type: String },`,
    'Settings screenshot interval property'
);
replaceOnce(
    settingsFile,
    `        onLanguageChange: { type: Function },\n        onImageQualityChange: { type: Function },`,
    `        onLanguageChange: { type: Function },\n        onScreenshotIntervalChange: { type: Function },\n        onImageQualityChange: { type: Function },`,
    'Settings screenshot interval callback property'
);
replaceOnce(
    settingsFile,
    `        this.selectedLanguage = 'en-US';\n        this.selectedImageQuality = 'medium';`,
    `        this.selectedLanguage = 'en-US';\n        this.selectedScreenshotInterval = '5';\n        this.selectedImageQuality = 'medium';`,
    'Settings screenshot interval default'
);
replaceOnce(
    settingsFile,
    `        this.onLanguageChange = () => {};\n        this.onImageQualityChange = () => {};`,
    `        this.onLanguageChange = () => {};\n        this.onScreenshotIntervalChange = () => {};\n        this.onImageQualityChange = () => {};`,
    'Settings screenshot callback default'
);
replaceOnce(
    settingsFile,
    `    handleImageQualitySelect(e) {\n        this.selectedImageQuality = e.target.value;\n        this.onImageQualityChange(this.selectedImageQuality);\n    }`,
    `    handleScreenshotIntervalSelect(e) {\n        this.selectedScreenshotInterval = e.target.value;\n        this.onScreenshotIntervalChange(this.selectedScreenshotInterval);\n    }\n\n    handleImageQualitySelect(e) {\n        this.selectedImageQuality = e.target.value;\n        this.onImageQualityChange(this.selectedImageQuality);\n    }`,
    'Settings screenshot interval handler'
);
replaceOnce(
    settingsFile,
    `            scrollDown: isMac ? 'Cmd+Shift+Down' : 'Ctrl+Shift+Down',\n        };`,
    `            scrollDown: isMac ? 'Cmd+Shift+Down' : 'Ctrl+Shift+Down',\n            emergencyErase: isMac ? 'Cmd+Shift+E' : 'Ctrl+Shift+E',\n        };`,
    'Settings emergency erase default'
);
replaceOnce(
    settingsFile,
    `            { key: 'scrollDown', name: 'Scroll Response Down', description: 'Scroll response content downward' },\n        ];`,
    `            { key: 'scrollDown', name: 'Scroll Response Down', description: 'Scroll response content downward' },\n            { key: 'emergencyErase', name: 'Emergency Erase', description: 'Close the app and clear sensitive local data' },\n        ];`,
    'Settings emergency erase action'
);
replaceOnce(
    settingsFile,
    `                selectedLanguage: 'en-US',\n                selectedScreenshotInterval: '5',`,
    `                selectedLanguage: 'en-US',\n                selectedScreenshotInterval: '5',`,
    'Settings reset screenshot default assertion'
);
replaceOnce(
    settingsFile,
    `            this.selectedLanguage = defaults.selectedLanguage;\n            this.selectedImageQuality = defaults.selectedImageQuality;`,
    `            this.selectedLanguage = defaults.selectedLanguage;\n            this.selectedScreenshotInterval = defaults.selectedScreenshotInterval;\n            this.selectedImageQuality = defaults.selectedImageQuality;`,
    'Settings reset screenshot state'
);
replaceOnce(
    settingsFile,
    `            this.onLanguageChange(defaults.selectedLanguage);\n            this.onImageQualityChange(defaults.selectedImageQuality);`,
    `            this.onLanguageChange(defaults.selectedLanguage);\n            this.onScreenshotIntervalChange(defaults.selectedScreenshotInterval);\n            this.onImageQualityChange(defaults.selectedImageQuality);\n            this.onLayoutModeChange('normal');`,
    'Settings reset callbacks'
);
replaceOnce(
    settingsFile,
    `    renderAudioSection() {`,
    `    renderSessionSection() {\n        return html\`\n            <section class="surface">\n                <div class="surface-title">Session Defaults</div>\n                <div class="surface-subtitle">Defaults used when you start a new assistant session.</div>\n                <div class="form-grid">\n                    <div class="form-group">\n                        <label class="form-label">Session Profile</label>\n                        <select class="control" .value=${'${'}this.selectedProfile} @change=${'${'}this.handleProfileSelect}>\n                            ${'${'}this.getProfiles().map(profile => html\`<option value=${'${'}profile.value}>${'${'}profile.name}</option>\`)}\n                        </select>\n                    </div>\n                    <div class="form-group">\n                        <label class="form-label">Window Layout</label>\n                        <select class="control" .value=${'${'}this.layoutMode} @change=${'${'}this.handleLayoutModeSelect}>\n                            <option value="normal">Normal</option>\n                            <option value="compact">Compact sidebar</option>\n                        </select>\n                    </div>\n                    <div class="form-group">\n                        <label class="form-label">Screenshot Interval</label>\n                        <select class="control" .value=${'${'}this.selectedScreenshotInterval} @change=${'${'}this.handleScreenshotIntervalSelect}>\n                            <option value="3">3 seconds</option>\n                            <option value="5">5 seconds</option>\n                            <option value="10">10 seconds</option>\n                            <option value="30">30 seconds</option>\n                        </select>\n                    </div>\n                </div>\n            </section>\n        \`;\n    }\n\n    renderAISection() {\n        return html\`\n            <section class="surface">\n                <div class="surface-title">AI Behavior</div>\n                <div class="surface-subtitle">Shared instructions and optional search grounding for new sessions.</div>\n                <div class="form-grid">\n                    <label class="toggle-row">\n                        <input class="toggle-input" type="checkbox" .checked=${'${'}this.googleSearchEnabled} @change=${'${'}this.handleGoogleSearchChange} />\n                        <span class="toggle-label">Enable Google Search grounding for Gemini Live</span>\n                    </label>\n                    <div class="form-group vertical">\n                        <label class="form-label">Custom Instructions</label>\n                        <textarea\n                            class="control"\n                            placeholder="Optional instructions applied to every new session"\n                            .value=${'${'}this.customPrompt}\n                            @input=${'${'}this.handleCustomPromptInput}\n                        ></textarea>\n                        <div class="form-help">Keep this focused. Profile-specific instructions are combined with these custom instructions.</div>\n                    </div>\n                </div>\n            </section>\n        \`;\n    }\n\n    renderAudioSection() {`,
    'Settings session and AI sections'
);
replaceOnce(
    settingsFile,
    `                    <div class="page-title">Settings</div>\n                    ${'${'}this.renderAudioSection()}\n                    ${'${'}this.renderLanguageSection()}`,
    `                    <div class="page-title">Settings</div>\n                    <div class="page-subtitle">Configure session defaults, AI behavior, audio, appearance, keyboard shortcuts, and local data.</div>\n                    ${'${'}this.renderSessionSection()}\n                    ${'${'}this.renderAISection()}\n                    ${'${'}this.renderAudioSection()}\n                    ${'${'}this.renderLanguageSection()}`,
    'Settings render order'
);

// -----------------------------------------------------------------------------
// Regression tests for the real user-reported failure modes.
// -----------------------------------------------------------------------------
const regression = `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\n\nconst read = file => fs.readFileSync(file, 'utf8');\n\ntest('session start surfaces initialization and capture failures on Home', () => {\n    const app = read('src/components/app/ContextHaloApp.js');\n    assert.match(app, /session-initializing/);\n    assert.match(app, /\.isInitializing=\\$\\{this\.isInitializing\\}/);\n    assert.match(app, /\.startError=\\$\\{this\.startError\\}/);\n    assert.match(app, /Starting Windows screen and audio capture/);\n    assert.match(app, /catch \(error\)/);\n});\n\ntest('Windows capture uses loopback-safe constraints and cleans microphone resources', () => {\n    const renderer = read('src/utils/renderer.js');\n    assert.match(renderer, /audio: needsLoopback/);\n    assert.match(renderer, /Windows system-audio loopback was not available/);\n    assert.match(renderer, /micMediaStream\.getTracks\(\)\.forEach\(track => track\.stop\(\)\)/);\n    assert.match(renderer, /return result\?\.success \? result\.data : ''/);\n});\n\ntest('Gemini Live reads preferences in main and normalizes the configured model', () => {\n    const gemini = read('src/utils/gemini.js');\n    assert.match(gemini, /getPreferences\(\)\.googleSearchEnabled === true/);\n    assert.match(gemini, /const liveModel = String\(getConfig\(\)\.geminiLiveModel \|\| 'gemini-3\.1-flash-live-preview'\)/);\n    assert.match(gemini, /model: liveModel/);\n    assert.doesNotMatch(gemini, /sessionResumption:[\\s\\S]{0,150}: \{\},/);\n});\n\ntest('model selectors are readable and capability restricted', () => {\n    const main = read('src/components/views/MainView.js');\n    const shared = read('src/components/views/sharedPageStyles.js');\n    const registry = read('src/utils/dynamicModelRegistryRenderer.js');\n    assert.match(main, /select option,/);\n    assert.match(main, /background: #191919/);\n    assert.match(shared, /select\.control option/);\n    assert.match(registry, /allowAdvanced: false/);\n    assert.match(registry, /all: catalog\?\.live \|\| \[\]/);\n    assert.match(registry, /recommended\?\.live/);\n});\n\ntest('Settings exposes session, AI behavior and emergency erase controls', () => {\n    const settings = read('src/components/views/CustomizeView.js');\n    assert.match(settings, /renderSessionSection\(\)/);\n    assert.match(settings, /renderAISection\(\)/);\n    assert.match(settings, /Enable Google Search grounding/);\n    assert.match(settings, /Custom Instructions/);\n    assert.match(settings, /emergencyErase/);\n    assert.match(settings, /Compact sidebar/);\n});\n`;
fs.writeFileSync('tests/runtime-session-ui-settings.test.js', regression, 'utf8');

console.log('Runtime session, Home, Settings, capture, and model-selector fixes applied.');
