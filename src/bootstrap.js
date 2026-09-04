const { app, ipcMain } = require('electron');

// Gemini Live accepts typed text through realtimeInput, but realtime input does
// not carry an explicit turnComplete flag. ContextHalo also keeps an audio
// stream open for the duration of a session, so a typed prompt can otherwise
// remain grouped with ongoing audio activity. Pause audio forwarding for the
// typed request, close the current audio stream, and reopen normal capture as
// soon as the model begins responding (or after a bounded fail-safe timeout).
const originalHandle = ipcMain.handle.bind(ipcMain);
const TYPED_PROMPT_AUDIO_GATE_MS = 30000;

let providerMode = 'byok';
let typedPromptAudioGateUntil = 0;
let typedPromptAudioGateActive = false;

function updateProviderMode(channel, args) {
    if (channel === 'initialize-gemini') {
        providerMode = args[4] === 'groq' ? 'groq' : 'byok';
    } else if (channel === 'initialize-local') {
        providerMode = 'local';
    } else if (channel === 'initialize-cloud') {
        providerMode = 'cloud';
    }
}

function startTypedPromptAudioGate() {
    typedPromptAudioGateActive = true;
    typedPromptAudioGateUntil = Date.now() + TYPED_PROMPT_AUDIO_GATE_MS;
}

function clearTypedPromptAudioGate() {
    typedPromptAudioGateActive = false;
    typedPromptAudioGateUntil = 0;
}

function typedPromptAudioGateIsActive() {
    if (!typedPromptAudioGateActive) return false;
    if (Date.now() >= typedPromptAudioGateUntil) {
        clearTypedPromptAudioGate();
        return false;
    }
    return true;
}

function observeRendererResponses(window) {
    const webContents = window?.webContents;
    if (!webContents || webContents.__typedPromptResponseObserver) return;

    const originalSend = webContents.send.bind(webContents);
    webContents.send = (channel, ...args) => {
        if (typedPromptAudioGateIsActive() && (channel === 'new-response' || channel === 'update-response')) {
            clearTypedPromptAudioGate();
        }

        if (typedPromptAudioGateIsActive() && channel === 'update-status') {
            const status = String(args[0] || '');
            if (/Gemini.*(?:error|closed)|Session closed|reconnect failed/i.test(status)) {
                clearTypedPromptAudioGate();
            }
        }

        return originalSend(channel, ...args);
    };

    Object.defineProperty(webContents, '__typedPromptResponseObserver', { value: true });
}

app.on('browser-window-created', (_event, window) => observeRendererResponses(window));

async function finalizeTypedGeminiTurn(event) {
    const session = global.geminiSessionRef?.current;
    if (!session || typeof session.sendRealtimeInput !== 'function') {
        clearTypedPromptAudioGate();
        return;
    }

    try {
        await Promise.resolve(session.sendRealtimeInput({ audioStreamEnd: true }));
    } catch (error) {
        // The text itself has already been accepted. Do not convert a best-effort
        // turn-boundary hint into a failed send; surface it for diagnostics and
        // resume capture so a provider-side incompatibility cannot mute a session.
        clearTypedPromptAudioGate();
        console.warn('Could not close Gemini audio stream after typed input:', error?.message || error);
        try {
            event?.sender?.send('update-status', 'Typed message sent; waiting for Gemini Live response...');
        } catch {}
    }
}

ipcMain.handle = (channel, handler) => originalHandle(channel, async (event, ...args) => {
    updateProviderMode(channel, args);

    if (
        providerMode === 'byok'
        && typedPromptAudioGateIsActive()
        && (channel === 'send-audio-content' || channel === 'send-mic-audio-content')
    ) {
        return { success: true, ignored: true, reason: 'typed-prompt-turn' };
    }

    const typedGeminiMessage = channel === 'send-text-message' && providerMode === 'byok';
    if (typedGeminiMessage) startTypedPromptAudioGate();

    let result;
    try {
        result = await handler(event, ...args);
    } catch (error) {
        if (typedGeminiMessage) clearTypedPromptAudioGate();
        throw error;
    }

    if (typedGeminiMessage) {
        if (result?.success === false) clearTypedPromptAudioGate();
        else await finalizeTypedGeminiTurn(event);
    }

    if (channel === 'close-session') {
        providerMode = 'byok';
        clearTypedPromptAudioGate();
    }
    return result;
});

require('./index');
