const { BrowserWindow, ipcMain } = require('electron');
const storage = require('../storage');
const {
    abortProviderSession,
    resetProviderSession,
    runWithProviderScope,
} = require('./windowsProviderTransport');
const { SCREEN_WINDOWS_SCOPE_MS } = require('./geminiScreenReliability');

const windowsHandlers = new Map();

let originalIpcHandle = null;
let providerMode = 'byok';
let sessionEpoch;
let acceptingAudio = false;
let systemAudioQueue = [];
let microphoneAudioQueue = [];
let mixedAudioDispatchQueue = [];
let mixedAudioDispatchGeneration = null;
let mixerGeneration = 0;
let lastAudioFallbackNoticeAt = 0;

const MAX_UNPAIRED_AUDIO_CHUNKS = 12;
const MAX_MIXED_DISPATCH_CHUNKS = 6;
const MAX_MIXED_DISPATCH_AGE_MS = 900;

function resetAudioMixer() {
    mixerGeneration += 1;
    systemAudioQueue = [];
    microphoneAudioQueue = [];
    mixedAudioDispatchQueue = [];
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

async function drainMixedAudioDispatch(generation) {
    if (generation !== mixerGeneration || mixedAudioDispatchGeneration === generation) return;
    mixedAudioDispatchGeneration = generation;
    try {
        while (generation === mixerGeneration && mixedAudioDispatchQueue.length) {
            const entry = mixedAudioDispatchQueue.shift();
            if (!entry || entry.generation !== generation) continue;
            if (Date.now() - entry.queuedAt > MAX_MIXED_DISPATCH_AGE_MS) continue;
            const systemHandler = windowsHandlers.get('send-audio-content');
            if (!systemHandler) continue;
            try {
                await systemHandler(entry.event, entry.payload);
            } catch (error) {
                if (generation !== mixerGeneration) continue;
                console.error('Mixed Windows audio dispatch failed:', error);
                sendRendererStatus('Audio error: ' + error.message);
            }
        }
    } finally {
        if (mixedAudioDispatchGeneration === generation) mixedAudioDispatchGeneration = null;
        if (generation === mixerGeneration && mixedAudioDispatchQueue.length) void drainMixedAudioDispatch(generation);
    }
}

function dispatchMixedPayload(event, payload) {
    if (mixedAudioDispatchQueue.length >= MAX_MIXED_DISPATCH_CHUNKS) mixedAudioDispatchQueue.shift();
    const generation = mixerGeneration;
    mixedAudioDispatchQueue.push({ event, payload, generation, queuedAt: Number.isFinite(payload.capturedAtMs) ? payload.capturedAtMs : Date.now() });
    void drainMixedAudioDispatch(generation);
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

    const queuedAt = Number.isFinite(payload.capturedAtMs) ? payload.capturedAtMs : Date.now();
    if (Date.now() - queuedAt > MAX_MIXED_DISPATCH_AGE_MS) return { success: true, dropped: true };
    const entry = { event, payload, queuedAt };
    if (channel === 'send-audio-content') systemAudioQueue.push(entry);
    else microphoneAudioQueue.push(entry);

    while (systemAudioQueue.length && microphoneAudioQueue.length) {
        const skew = systemAudioQueue[0].queuedAt - microphoneAudioQueue[0].queuedAt;
        if (Math.abs(skew) > 200) {
            const unpaired = (skew < 0 ? systemAudioQueue : microphoneAudioQueue).shift();
            dispatchMixedPayload(unpaired.event, unpaired.payload);
            continue;
        }
        if (systemAudioQueue[0].payload.mimeType !== microphoneAudioQueue[0].payload.mimeType) {
            // Never interpret a differently sampled track as time-aligned PCM.
            const unpaired = systemAudioQueue.shift(); microphoneAudioQueue.shift();
            dispatchMixedPayload(unpaired.event, unpaired.payload);
            continue;
        }
        const systemEntry = systemAudioQueue.shift();
        const microphoneEntry = microphoneAudioQueue.shift();
        const systemBuffer = Buffer.from(systemEntry.payload.data, 'base64');
        const microphoneBuffer = Buffer.from(microphoneEntry.payload.data, 'base64');
        const mixed = mixPcm16(systemBuffer, microphoneBuffer);
        if (!mixed.length) continue;

        dispatchMixedPayload(systemEntry.event, {
            ...systemEntry.payload,
            capturedAtMs: Math.min(systemEntry.queuedAt, microphoneEntry.queuedAt),
            data: mixed.toString('base64'),
            mimeType: systemEntry.payload.mimeType || microphoneEntry.payload.mimeType || 'audio/pcm;rate=24000',
        });
    }

    flushUnpairedAudioIfNeeded();
    return { success: true, queued: true, mixed: true };
}

function prepareWindowsProvider(mode, uiEpoch) {
    sessionEpoch = uiEpoch;
    acceptingAudio = true;
    providerMode = mode;
    global.__windowsProviderMode = mode;
    resetProviderSession();
    resetAudioMixer();
}

function wrapWindowsIpcHandler(channel, handler) {
    windowsHandlers.set(channel, handler);

    if (channel === 'close-session') {
        return async (event, ...args) => {
            acceptingAudio = false;
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

    if (channel === 'audio-stream-end') {
        return async (event, payload) => {
            if (sessionEpoch !== undefined && payload?.uiEpoch !== sessionEpoch) return { success: true, ignored: true };
            resetAudioMixer();
            require('./runtimeHardeningMain').resetRuntimeAudio();
            return handler(event, payload);
        };
    }

    if (channel === 'send-image-content') {
        return async (event, ...args) => {
            const result = await runWithProviderScope('Analyze Screen', SCREEN_WINDOWS_SCOPE_MS, () => handler(event, ...args));
            return result;
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
            if (!acceptingAudio || (sessionEpoch !== undefined && payload?.uiEpoch !== sessionEpoch)) return { success: true, ignored: true };
            if (!payload || typeof payload.data !== 'string' || payload.data.length > 262144) return { success: false, error: 'Invalid audio payload' };
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
    ipcMain.handle = (channel, handler) => {
        const wrapped = wrapWindowsIpcHandler(channel, handler);
        return originalIpcHandle(channel, (event, ...args) => {
            const window = BrowserWindow.getAllWindows().find(candidate => !candidate.isDestroyed()
                && candidate.webContents.id === event?.sender?.id);
            if (!window || event.senderFrame !== window.webContents.mainFrame) return { success: false, error: 'Untrusted renderer' };
            return wrapped(event, ...args);
        });
    };

    return () => {
        if (!originalIpcHandle) return;
        ipcMain.handle = originalIpcHandle;
        originalIpcHandle = null;
    };
}

module.exports = {
    installWindowsIpcHardening,
    prepareWindowsProvider,
    mixPcm16,
    resetAudioMixer,
    MAX_MIXED_DISPATCH_CHUNKS,
    MAX_MIXED_DISPATCH_AGE_MS,
};
