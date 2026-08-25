const { BrowserWindow, desktopCapturer, ipcMain, screen, session } = require('electron');
const storage = require('../storage');

const RETRYABLE_PROVIDER_PATTERNS = [
    /\b409\b/i,
    /aborted/i,
    /conflict/i,
    /\b429\b/i,
    /resource[_ -]?exhausted/i,
    /\b500\b/i,
    /\b502\b/i,
    /\b503\b/i,
    /\b504\b/i,
    /internal/i,
    /unavailable/i,
];

let runtimeProviderMode = 'byok';
let imageRequestQueue = Promise.resolve();
let groqUtteranceQueue = Promise.resolve();
let originalIpcHandle = null;
let googleGenAiPatched = false;
const registeredHandlers = new Map();

const GROQ_VAD = {
    energyThreshold: 0.012,
    speechFramesRequired: 3,
    silenceFramesRequired: 8,
    preRollFrames: 5,
    maxUtteranceSeconds: 35,
};

let groqVadState = createGroqVadState();

function createGroqVadState() {
    return {
        speaking: false,
        speechFrames: 0,
        silenceFrames: 0,
        sampleRate: 24000,
        preRoll: [],
        chunks: [],
        bytes: 0,
    };
}

function resetGroqVad() {
    groqVadState = createGroqVadState();
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getErrorText(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return String(value.error || value.message || value);
}

function isRetryableProviderFailure(value) {
    const text = getErrorText(value);
    return RETRYABLE_PROVIDER_PATTERNS.some(pattern => pattern.test(text));
}

async function callWithProviderRetry(fn, attempts = 4) {
    let lastResult;
    let lastError;

    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const result = await fn();
            lastResult = result;
            if (!result || result.success !== false || !isRetryableProviderFailure(result)) {
                return result;
            }
        } catch (error) {
            lastError = error;
            if (!isRetryableProviderFailure(error) || attempt === attempts - 1) {
                throw error;
            }
        }

        if (attempt < attempts - 1) {
            const backoff = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
            await delay(backoff);
        }
    }

    if (lastError) throw lastError;
    return lastResult;
}

function installProviderRuntimeHardening() {
    if (googleGenAiPatched) return;

    try {
        const genai = require('@google/genai');
        const OriginalGoogleGenAI = genai.GoogleGenAI;
        if (!OriginalGoogleGenAI || OriginalGoogleGenAI.__runtimeHardened) {
            googleGenAiPatched = true;
            return;
        }

        class HardenedGoogleGenAI extends OriginalGoogleGenAI {
            constructor(options) {
                super(options);
                const live = this.live;
                const originalConnect = live?.connect?.bind(live);
                if (originalConnect) {
                    live.connect = async params => {
                        let nextParams = params;
                        if (global.__runtimeFreshGeminiSession === true && params?.config?.sessionResumption?.handle) {
                            nextParams = {
                                ...params,
                                config: {
                                    ...params.config,
                                    sessionResumption: {},
                                },
                            };
                        }
                        global.__runtimeFreshGeminiSession = false;
                        return originalConnect(nextParams);
                    };
                }
            }
        }

        Object.defineProperty(HardenedGoogleGenAI, '__runtimeHardened', { value: true });
        genai.GoogleGenAI = HardenedGoogleGenAI;
        googleGenAiPatched = true;
    } catch (error) {
        console.warn('Could not install Gemini fresh-session guard:', error.message);
    }
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

    const form = new FormData();
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'json');
    form.append('file', new Blob([pcmToWavBuffer(pcm, sampleRate)], { type: 'audio/wav' }), 'utterance.wav');

    const preferences = storage.getPreferences();
    const language = String(preferences.selectedLanguage || 'en-US').split('-')[0];
    if (language) form.append('language', language);

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
    });

    const body = await response.text();
    if (!response.ok) {
        let detail = body;
        try {
            detail = JSON.parse(body)?.error?.message || body;
        } catch {}
        throw new Error(`Groq transcription HTTP ${response.status}: ${String(detail).slice(0, 240)}`);
    }

    return JSON.parse(body)?.text?.trim() || '';
}

function queueGroqUtterance(event, pcm, sampleRate) {
    if (!pcm.length) return;

    groqUtteranceQueue = groqUtteranceQueue
        .then(async () => {
            const transcript = await transcribeGroqUtterance(pcm, sampleRate);
            if (!transcript) return;
            const textHandler = registeredHandlers.get('send-text-message');
            if (!textHandler) throw new Error('Groq text handler is not ready');
            await textHandler(event, transcript);
        })
        .catch(error => {
            console.error('Groq utterance processing failed:', error);
            const windows = BrowserWindow.getAllWindows();
            if (windows.length > 0 && !windows[0].isDestroyed()) {
                windows[0].webContents.send('update-status', 'Groq voice error: ' + error.message);
            }
        });
}

function processGroqVadChunk(event, data, mimeType) {
    const pcm = Buffer.from(data, 'base64');
    if (pcm.length < 2) return { success: true };

    const sampleRate = parseSampleRate(mimeType);
    groqVadState.sampleRate = sampleRate;
    const rms = calculatePcmRms(pcm);
    const voice = rms >= GROQ_VAD.energyThreshold;

    groqVadState.preRoll.push(pcm);
    if (groqVadState.preRoll.length > GROQ_VAD.preRollFrames) groqVadState.preRoll.shift();

    if (!groqVadState.speaking) {
        if (voice) {
            groqVadState.speechFrames += 1;
            if (groqVadState.speechFrames >= GROQ_VAD.speechFramesRequired) {
                groqVadState.speaking = true;
                groqVadState.chunks = [...groqVadState.preRoll];
                groqVadState.bytes = groqVadState.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                groqVadState.silenceFrames = 0;
            }
        } else {
            groqVadState.speechFrames = 0;
        }
        return { success: true };
    }

    groqVadState.chunks.push(pcm);
    groqVadState.bytes += pcm.length;
    groqVadState.silenceFrames = voice ? 0 : groqVadState.silenceFrames + 1;

    const seconds = groqVadState.bytes / (sampleRate * 2);
    if (groqVadState.silenceFrames >= GROQ_VAD.silenceFramesRequired || seconds >= GROQ_VAD.maxUtteranceSeconds) {
        const utterance = Buffer.concat(groqVadState.chunks);
        resetGroqVad();
        queueGroqUtterance(event, utterance, sampleRate);
    }

    return { success: true };
}

function shouldForwardAudioChannel(channel) {
    const mode = storage.getPreferences().audioMode || 'speaker_only';
    if (mode === 'mic_only') return channel === 'send-mic-audio-content';
    if (mode === 'both') return true;
    return channel === 'send-audio-content';
}

function wrapIpcHandler(channel, handler) {
    registeredHandlers.set(channel, handler);

    if (channel === 'initialize-gemini') {
        return async (event, ...args) => {
            const provider = args[4] === 'groq' ? 'groq' : 'byok';
            runtimeProviderMode = provider;
            resetGroqVad();
            global.__runtimeFreshGeminiSession = provider === 'byok';
            return handler(event, ...args);
        };
    }

    if (channel === 'initialize-local') {
        return async (event, ...args) => {
            runtimeProviderMode = 'local';
            resetGroqVad();
            return handler(event, ...args);
        };
    }

    if (channel === 'initialize-cloud') {
        return async (event, ...args) => {
            runtimeProviderMode = 'cloud';
            resetGroqVad();
            return handler(event, ...args);
        };
    }

    if (channel === 'close-session') {
        return async (event, ...args) => {
            const result = await handler(event, ...args);
            runtimeProviderMode = 'byok';
            resetGroqVad();
            global.__runtimeFreshGeminiSession = false;
            return result;
        };
    }

    if (channel === 'send-image-content') {
        return (event, ...args) => {
            const queued = imageRequestQueue.then(() => callWithProviderRetry(() => handler(event, ...args)));
            imageRequestQueue = queued.catch(() => {});
            return queued;
        };
    }

    if (channel === 'send-audio-content' || channel === 'send-mic-audio-content') {
        return async (event, payload, ...rest) => {
            if (!shouldForwardAudioChannel(channel)) return { success: true, ignored: true };
            if (runtimeProviderMode === 'groq') {
                return processGroqVadChunk(event, payload?.data || '', payload?.mimeType || 'audio/pcm;rate=24000');
            }
            return handler(event, payload, ...rest);
        };
    }

    return handler;
}

function installIpcHandlerHardening() {
    if (originalIpcHandle) return () => {};

    originalIpcHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, handler) => originalIpcHandle(channel, wrapIpcHandler(channel, handler));

    return () => {
        if (originalIpcHandle) {
            ipcMain.handle = originalIpcHandle;
            originalIpcHandle = null;
        }
    };
}

function setupRuntimeWindowHardening(mainWindow) {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    try {
        ipcMain.removeHandler('window-toggle-maximize');
    } catch {}

    ipcMain.handle('window-toggle-maximize', event => {
        if (!event?.sender || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
            return { success: false, error: 'Untrusted renderer' };
        }
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
        return { success: true, maximized: mainWindow.isMaximized() };
    });

    session.defaultSession.setDisplayMediaRequestHandler(
        async (request, callback) => {
            try {
                const sources = await desktopCapturer.getSources({ types: ['screen'] });
                const primaryDisplayId = String(screen.getPrimaryDisplay().id);
                const source = sources.find(candidate => String(candidate.display_id) === primaryDisplayId) || sources[0];
                if (!source) {
                    callback({});
                    return;
                }
                callback({ video: source, audio: 'loopback' });
            } catch (error) {
                console.error('Display media selection failed:', error);
                callback({});
            }
        },
        { useSystemPicker: true }
    );
}

module.exports = {
    installProviderRuntimeHardening,
    installIpcHandlerHardening,
    setupRuntimeWindowHardening,
};
