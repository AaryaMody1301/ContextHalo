const { BrowserWindow, ipcMain } = require('electron');
const storage = require('../storage');
const { randomUUID } = require('node:crypto');
const { runSessionRequest, assertCurrentRequest, getRequestSignal, cancelSessionRequests } = require('./sessionRequests');
const { groqHttpFailure, groqTranscriptText } = require('./groqRequestPolicy');

let runtimeProviderMode = 'byok';
let originalIpcHandle = null;
const registeredHandlers = new Map();

const GROQ_VAD = {
    energyThreshold: 0.012,
    speechStartMs: 100,
    minimumSpeechMs: 250,
    silenceMs: 1600,
    preRollMs: 500,
    maxUtteranceSeconds: 120,
};

let groqVadState = createGroqVadState();

function createGroqVadState() {
    return {
        speaking: false,
        speechMs: 0,
        voicedMs: 0,
        silenceMs: 0,
        sampleRate: 0,
        preRoll: [],
        preRollMs: 0,
        chunks: [],
        bytes: 0,
        pending: false,
        revision: 0,
        requestId: randomUUID(),
        tooLong: false,
    };
}

function resetGroqVad() {
    if (groqVadState.pending) cancelSessionRequests('voice', groqVadState.requestId);
    groqVadState = createGroqVadState();
}

function calculatePcmRms(buffer) {
    if (!buffer || buffer.length < 2) return 0;
    const sampleCount = Math.floor(buffer.length / 2);
    let sumSquares = 0;
    for (let i = 0; i < sampleCount; i++) {
        const sample = buffer.readInt16LE(i * 2) / 32768;
        sumSquares += sample * sample;
    }
    return Math.sqrt(sumSquares / sampleCount);
}

function parseSampleRate(mimeType) {
    const match = String(mimeType || '').match(/rate=(\d+)/i);
    return match ? Number(match[1]) : 24000;
}

function pcmToWavBuffer(pcm, sampleRate = 24000) {
    const header = Buffer.alloc(44);
    const channels = 1;
    const bitsPerSample = 16;
    const blockAlign = channels * bitsPerSample / 8;
    const byteRate = sampleRate * blockAlign;
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

async function transcribeGroqUtterance(pcm, sampleRate) {
    const apiKey = storage.getGroqApiKey();
    if (!apiKey) throw new Error('No Groq API key configured');

    const preferences = storage.getPreferences();
    const language = String(preferences.selectedLanguage || 'en-US').split('-')[0];

    const result = await (async () => {
        const form = new FormData();
        form.append('model', storage.getConfig().groqTranscriptionModel || 'whisper-large-v3-turbo');
        form.append('response_format', 'verbose_json');
        form.append('temperature', '0');
        form.append('file', new Blob([pcmToWavBuffer(pcm, sampleRate)], { type: 'audio/wav' }), 'utterance.wav');
        if (language) form.append('language', language);

        try {
            const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}` },
                body: form,
                signal: getRequestSignal(),
            });

            if (!response.ok) {
                return groqHttpFailure(response, 'transcription', form.get('model'));
            }
            return { success: true, text: groqTranscriptText(await response.json()) };
        } catch (error) {
            return { success: false, error: error?.message || String(error) };
        }
    })();

    if (!result?.success) throw new Error(result?.error || 'Groq transcription failed');
    return result.text || '';
}

function queueGroqUtterance(event, state) {
    const revision = ++state.revision;
    state.pending = true;

    runSessionRequest('voice', async () => {
            const transcript = await transcribeGroqUtterance(Buffer.concat(state.chunks), state.sampleRate);
            assertCurrentRequest();
            if (!transcript) return;
            const textHandler = registeredHandlers.get('send-text-message');
            if (!textHandler) throw new Error('Groq text handler is not ready');
            const result = await textHandler(event, transcript);
            if (result?.success === false) throw new Error(result.error || 'Groq response failed');
        }, { requestId: state.requestId })
        .catch(error => {
            if (state !== groqVadState || state.revision !== revision) return;
            // Keep transcripts and provider-returned error bodies out of diagnostics.
            const windows = BrowserWindow.getAllWindows();
            if (windows.length > 0 && !windows[0].isDestroyed()) {
                windows[0].webContents.send('update-status', 'Groq voice error: ' + error.message);
            }
        })
        .finally(() => {
            if (state === groqVadState && state.revision === revision) resetGroqVad();
        });
}

function processGroqVadFrame(event, pcm, sampleRate) {
    const state = groqVadState;
    const durationMs = pcm.length / (sampleRate * 2) * 1000;
    const rms = calculatePcmRms(pcm);
    const voice = rms >= GROQ_VAD.energyThreshold;

    if (!state.speaking) {
        state.preRoll.push(pcm);
        state.preRollMs += durationMs;
        while (state.preRollMs > GROQ_VAD.preRollMs && state.preRoll.length > 1) {
            state.preRollMs -= state.preRoll.shift().length / (sampleRate * 2) * 1000;
        }
        state.speechMs = voice ? state.speechMs + durationMs : 0;
        if (state.speechMs >= GROQ_VAD.speechStartMs) {
            state.speaking = true;
            state.voicedMs = state.speechMs;
            state.chunks = state.preRoll;
            state.preRoll = [];
            state.bytes = state.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        }
        return;
    }

    if (state.pending) {
        if (!voice) return;
        // A pause can end before transcription or generation finishes. Cancel
        // that answer and retain the full audio for the continued question.
        state.pending = false;
        state.revision += 1;
        cancelSessionRequests('voice', state.requestId);
    }
    state.silenceMs = voice ? 0 : state.silenceMs + durationMs;
    if (voice) state.voicedMs += durationMs;
    if (!state.tooLong) {
        state.chunks.push(pcm);
        state.bytes += pcm.length;
        if (state.bytes > sampleRate * 2 * GROQ_VAD.maxUtteranceSeconds) {
            state.tooLong = true;
            state.chunks = [];
            state.bytes = 0;
        }
    }

    if (state.silenceMs >= GROQ_VAD.silenceMs) {
        if (state.tooLong) {
            resetGroqVad();
            const window = BrowserWindow.getAllWindows().find(candidate => !candidate.isDestroyed());
            window?.webContents.send('update-status', 'Groq voice input exceeded two minutes. Please repeat a shorter question.');
        } else if (state.voicedMs < GROQ_VAD.minimumSpeechMs) resetGroqVad();
        else queueGroqUtterance(event, state);
    }
}

function processGroqVadChunk(event, data, mimeType) {
    if (!data) return { success: true };
    const pcm = Buffer.from(data, 'base64');
    if (pcm.length % 2) return { success: false, error: 'Invalid PCM audio' };
    const sampleRate = parseSampleRate(mimeType);
    if (groqVadState.sampleRate && groqVadState.sampleRate !== sampleRate) {
        resetGroqVad();
    }
    // Fixed 20 ms analysis windows make turn timing independent of IPC chunk size.
    const frameBytes = sampleRate * 2 / 50;
    for (let offset = 0; offset < pcm.length; offset += frameBytes) {
        groqVadState.sampleRate = sampleRate;
        processGroqVadFrame(event, pcm.subarray(offset, offset + frameBytes), sampleRate);
    }
    return { success: true };
}

function shouldForwardAudioChannel(channel) {
    const mode = storage.getPreferences().audioMode || 'speaker_only';

    if (runtimeProviderMode === 'groq') {
        if (mode === 'mic_only') return channel === 'send-mic-audio-content';
        return channel === 'send-audio-content';
    }

    if (mode === 'mic_only') return channel === 'send-mic-audio-content';
    if (mode === 'both') return true;
    return channel === 'send-audio-content';
}

function wrapIpcHandler(channel, handler) {
    registeredHandlers.set(channel, handler);

    if (channel === 'close-session') {
        return async (event, ...args) => {
            resetGroqVad();
            const result = await handler(event, ...args);
            runtimeProviderMode = 'byok';
            return result;
        };
    }

    if (channel === 'send-audio-content' || channel === 'send-mic-audio-content') {
        return async (event, payload, ...rest) => {
            if (runtimeProviderMode === 'mistral') return { success: false, error: 'Mistral supports text and screenshots only.' };
            if (!shouldForwardAudioChannel(channel)) return { success: true, ignored: true };
            if (runtimeProviderMode === 'groq') {
                return processGroqVadChunk(event, payload?.data || '', payload?.mimeType || 'audio/pcm;rate=24000');
            }
            return handler(event, payload, ...rest);
        };
    }

    return handler;
}

function prepareRuntimeProvider(mode) {
    runtimeProviderMode = mode;
    resetGroqVad();
}

function installIpcHandlerHardening() {
    if (originalIpcHandle) return () => {};

    originalIpcHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, handler) => {
        const wrapped = wrapIpcHandler(channel, handler);
        return originalIpcHandle(channel, (event, ...args) => {
            const window = BrowserWindow.getAllWindows().find(candidate => !candidate.isDestroyed()
                && candidate.webContents.id === event?.sender?.id);
            if (!window || event.senderFrame !== window.webContents.mainFrame) {
                return { success: false, error: 'Untrusted renderer' };
            }
            if (channel === 'send-audio-content' || channel === 'send-mic-audio-content') {
                const payload = args[0];
                if (typeof payload?.data !== 'string' || payload.data.length > 262144
                    || payload.data.length % 4 || (payload.data && !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.data))
                    || !/^audio\/pcm;rate=(16000|24000|48000)$/.test(payload.mimeType || '')) {
                    return { success: false, error: 'Invalid audio payload' };
                }
            }
            return wrapped(event, ...args);
        });
    };

    return () => {
        if (originalIpcHandle) {
            ipcMain.handle = originalIpcHandle;
            originalIpcHandle = null;
        }
    };
}

module.exports = {
    resetRuntimeAudio: resetGroqVad,
    prepareRuntimeProvider,
    installIpcHandlerHardening,
};
