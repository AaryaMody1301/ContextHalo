const { BrowserWindow, desktopCapturer, ipcMain, screen, session } = require('electron');
const storage = require('../storage');
const {
    abortProviderSession,
    resetProviderSession,
    runWithProviderScope,
} = require('./windowsProviderTransport');

const windowsHandlers = new Map();
const modelByAnalysisTimestamp = new Map();

let originalIpcHandle = null;
let providerMode = 'byok';
let systemAudioQueue = [];
let microphoneAudioQueue = [];
let mixedAudioDispatch = Promise.resolve();
let lastAudioFallbackNoticeAt = 0;

const MAX_UNPAIRED_AUDIO_CHUNKS = 12;
const ANALYZE_SCOPE_MS = 58000;

function resetAudioMixer() {
    systemAudioQueue = [];
    microphoneAudioQueue = [];
    mixedAudioDispatch = Promise.resolve();
}

function mixPcm16(systemBuffer, microphoneBuffer) {
    const bytes = Math.min(systemBuffer.length, microphoneBuffer.length);
    const evenBytes = bytes - (bytes % 2);
    const mixed = Buffer.alloc(evenBytes);

    for (let offset = 0; offset < evenBytes; offset += 2) {
        const systemSample = systemBuffer.readInt16LE(offset);
        const microphoneSample = microphoneBuffer.readInt16LE(offset);
        const value = Math.round((systemSample + microphoneSample) / 2);
        mixed.writeInt16LE(Math.max(-32768, Math.min(32767, value)), offset);
    }

    return mixed;
}

function sendRendererStatus(message) {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window || window.isDestroyed()) return;
    window.webContents.send('update-status', message);
}

function dispatchMixedPayload(event, payload) {
    const systemHandler = windowsHandlers.get('send-audio-content');
    if (!systemHandler) return;

    mixedAudioDispatch = mixedAudioDispatch
        .then(() => systemHandler(event, payload))
        .catch(error => {
            console.error('Mixed Windows audio dispatch failed:', error);
            sendRendererStatus('Audio error: ' + error.message);
        });
}

function flushUnpairedAudioIfNeeded() {
    if (systemAudioQueue.length > MAX_UNPAIRED_AUDIO_CHUNKS) {
        const entry = systemAudioQueue.shift();
        dispatchMixedPayload(entry.event, entry.payload);
        const now = Date.now();
        if (now - lastAudioFallbackNoticeAt > 10000) {
            lastAudioFallbackNoticeAt = now;
            sendRendererStatus('Microphone audio is delayed or unavailable; continuing with speaker audio.');
        }
    }

    if (microphoneAudioQueue.length > MAX_UNPAIRED_AUDIO_CHUNKS) {
        const entry = microphoneAudioQueue.shift();
        // Route microphone-only fallback through the system channel so Groq's
        // single VAD pipeline and the other providers receive one coherent stream.
        dispatchMixedPayload(entry.event, entry.payload);
        const now = Date.now();
        if (now - lastAudioFallbackNoticeAt > 10000) {
            lastAudioFallbackNoticeAt = now;
            sendRendererStatus('Speaker audio is delayed or unavailable; continuing with microphone audio.');
        }
    }
}

function enqueueMixedWindowsAudio(channel, event, payload) {
    const data = payload?.data || '';
    if (!data) return { success: true, ignored: true };

    const entry = { event, payload };
    if (channel === 'send-audio-content') systemAudioQueue.push(entry);
    else microphoneAudioQueue.push(entry);

    while (systemAudioQueue.length && microphoneAudioQueue.length) {
        const systemEntry = systemAudioQueue.shift();
        const microphoneEntry = microphoneAudioQueue.shift();
        const systemBuffer = Buffer.from(systemEntry.payload.data, 'base64');
        const microphoneBuffer = Buffer.from(microphoneEntry.payload.data, 'base64');
        const mixed = mixPcm16(systemBuffer, microphoneBuffer);
        if (!mixed.length) continue;

        dispatchMixedPayload(systemEntry.event, {
            data: mixed.toString('base64'),
            mimeType: systemEntry.payload.mimeType || microphoneEntry.payload.mimeType || 'audio/pcm;rate=24000',
        });
    }

    flushUnpairedAudioIfNeeded();
    return { success: true, queued: true, mixed: true };
}

function correctAnalyzeResult(result) {
    if (providerMode !== 'byok' || !result || result.success !== true) return result;
    const actualModel = global.__lastAnalyzeActualModel;
    if (!actualModel) return result;
    return { ...result, model: actualModel };
}

function wrapWindowsIpcHandler(channel, handler) {
    windowsHandlers.set(channel, handler);

    if (channel === 'initialize-gemini') {
        return async (event, ...args) => {
            providerMode = args[4] === 'groq' ? 'groq' : 'byok';
            global.__windowsProviderMode = providerMode;
            resetProviderSession();
            resetAudioMixer();
            return handler(event, ...args);
        };
    }

    if (channel === 'initialize-local') {
        return async (event, ...args) => {
            providerMode = 'local';
            global.__windowsProviderMode = providerMode;
            resetProviderSession();
            resetAudioMixer();
            return handler(event, ...args);
        };
    }

    if (channel === 'initialize-cloud') {
        return async (event, ...args) => {
            providerMode = 'cloud';
            global.__windowsProviderMode = providerMode;
            resetProviderSession();
            resetAudioMixer();
            return handler(event, ...args);
        };
    }

    if (channel === 'close-session') {
        return async (event, ...args) => {
            abortProviderSession('Session closed');
            resetAudioMixer();
            try {
                return await handler(event, ...args);
            } finally {
                providerMode = 'byok';
                global.__windowsProviderMode = providerMode;
            }
        };
    }

    if (channel === 'send-image-content') {
        return async (event, ...args) => {
            if (providerMode === 'byok') global.__lastAnalyzeActualModel = null;
            const result = await runWithProviderScope('Analyze Screen', ANALYZE_SCOPE_MS, () => handler(event, ...args));
            return correctAnalyzeResult(result);
        };
    }

    if (channel === 'send-text-message') {
        return async (event, ...args) => {
            if (providerMode === 'groq') {
                return runWithProviderScope('Groq text request', 65000, () => handler(event, ...args));
            }
            if (providerMode === 'local') {
                return runWithProviderScope('Local AI text request', 180000, () => handler(event, ...args));
            }
            return handler(event, ...args);
        };
    }

    if (channel === 'send-audio-content' || channel === 'send-mic-audio-content') {
        return async (event, payload, ...rest) => {
            const mode = storage.getPreferences().audioMode || 'speaker_only';
            if (process.platform === 'win32' && mode === 'both') {
                return enqueueMixedWindowsAudio(channel, event, payload);
            }
            return handler(event, payload, ...rest);
        };
    }

    return handler;
}

function installWindowsIpcHardening() {
    if (process.platform !== 'win32' || originalIpcHandle) return () => {};

    originalIpcHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, handler) => originalIpcHandle(channel, wrapWindowsIpcHandler(channel, handler));

    return () => {
        if (!originalIpcHandle) return;
        ipcMain.handle = originalIpcHandle;
        originalIpcHandle = null;
    };
}

function setupWindowsWindowHardening(mainWindow) {
    if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;

    // This runs after the legacy shared window hardening and intentionally owns
    // the final Windows display-capture policy: primary display + WASAPI loopback.
    session.defaultSession.setDisplayMediaRequestHandler(
        async (request, callback) => {
            try {
                const sources = await desktopCapturer.getSources({ types: ['screen'] });
                const primaryDisplayId = String(screen.getPrimaryDisplay().id);
                const source = sources.find(candidate => String(candidate.display_id) === primaryDisplayId) || sources[0];
                callback(source ? { video: source, audio: 'loopback' } : {});
            } catch (error) {
                console.error('Windows display capture selection failed:', error);
                callback({});
            }
        },
        { useSystemPicker: false }
    );

    const webContents = mainWindow.webContents;
    if (webContents.__windowsSendPatched) return;

    const originalSend = webContents.send.bind(webContents);
    webContents.send = (channel, ...args) => {
        if (channel === 'save-screen-analysis' && global.__windowsProviderMode === 'byok' && global.__lastAnalyzeActualModel) {
            const payload = args[0];
            if (payload?.analysis?.timestamp) {
                modelByAnalysisTimestamp.set(payload.analysis.timestamp, global.__lastAnalyzeActualModel);
                const analysis = { ...payload.analysis, model: global.__lastAnalyzeActualModel };
                const fullHistory = Array.isArray(payload.fullHistory)
                    ? payload.fullHistory.map(item => {
                        const model = modelByAnalysisTimestamp.get(item.timestamp);
                        return model ? { ...item, model } : item;
                    })
                    : payload.fullHistory;
                args[0] = { ...payload, analysis, fullHistory };
            }
        }
        return originalSend(channel, ...args);
    };

    Object.defineProperty(webContents, '__windowsSendPatched', { value: true });
}

module.exports = {
    installWindowsIpcHardening,
    setupWindowsWindowHardening,
    mixPcm16,
    resetAudioMixer,
};
