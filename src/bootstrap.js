const { ipcMain } = require('electron');

// Gemini Live accepts typed text through realtimeInput, but realtime input does
// not carry an explicit turnComplete flag. ContextHalo also keeps an audio
// stream open for the duration of a session, so a typed prompt can otherwise
// remain grouped with ongoing audio activity. End the current audio stream
// after a successful typed Gemini send; the next audio chunk automatically
// reopens it according to the Live API contract.
const originalHandle = ipcMain.handle.bind(ipcMain);
let providerMode = 'byok';

function updateProviderMode(channel, args) {
    if (channel === 'initialize-gemini') {
        providerMode = args[4] === 'groq' ? 'groq' : 'byok';
    } else if (channel === 'initialize-local') {
        providerMode = 'local';
    } else if (channel === 'initialize-cloud') {
        providerMode = 'cloud';
    }
}

async function finalizeTypedGeminiTurn(event) {
    const session = global.geminiSessionRef?.current;
    if (!session || typeof session.sendRealtimeInput !== 'function') return;

    try {
        await Promise.resolve(session.sendRealtimeInput({ audioStreamEnd: true }));
    } catch (error) {
        // The text itself has already been accepted. Do not convert a best-effort
        // turn-boundary hint into a failed send; surface it for diagnostics.
        console.warn('Could not close Gemini audio stream after typed input:', error?.message || error);
        try {
            event?.sender?.send('update-status', 'Typed message sent; waiting for Gemini Live response...');
        } catch {}
    }
}

ipcMain.handle = (channel, handler) => originalHandle(channel, async (event, ...args) => {
    updateProviderMode(channel, args);

    const result = await handler(event, ...args);

    if (channel === 'send-text-message' && providerMode === 'byok' && result?.success !== false) {
        await finalizeTypedGeminiTurn(event);
    }

    if (channel === 'close-session') providerMode = 'byok';
    return result;
});

require('./index');
