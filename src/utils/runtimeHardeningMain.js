const { app, BrowserWindow, desktopCapturer, ipcMain, screen, session } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const storage = require('../storage');
const { runSessionRequest, assertCurrentRequest } = require('./sessionRequests');

let runtimeProviderMode = 'byok';
let originalIpcHandle = null;
let runtimeMacAudioProc = null;
let beforeQuitCleanupInstalled = false;
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
        form.append('response_format', 'json');
        form.append('file', new Blob([pcmToWavBuffer(pcm, sampleRate)], { type: 'audio/wav' }), 'utterance.wav');
        if (language) form.append('language', language);

        try {
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
                return {
                    success: false,
                    error: `Groq transcription HTTP ${response.status}: ${String(detail).slice(0, 240)}`,
                };
            }

            return { success: true, text: JSON.parse(body)?.text?.trim() || '' };
        } catch (error) {
            return { success: false, error: error?.message || String(error) };
        }
    })();

    if (!result?.success) throw new Error(result?.error || 'Groq transcription failed');
    return result.text || '';
}

function queueGroqUtterance(event, pcm, sampleRate) {
    if (!pcm.length) return;

    runSessionRequest('voice', async () => {
            const transcript = await transcribeGroqUtterance(pcm, sampleRate);
            assertCurrentRequest();
            if (!transcript) return;
            const textHandler = registeredHandlers.get('send-text-message');
            if (!textHandler) throw new Error('Groq text handler is not ready');
            const result = await textHandler(event, transcript);
            if (result?.success === false) throw new Error(result.error || 'Groq response failed');
        })
        .catch(error => {
            if (error.name === 'AbortError') return;
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

function convertStereoToMono(stereoBuffer) {
    const samples = Math.floor(stereoBuffer.length / 4);
    const mono = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
        const left = stereoBuffer.readInt16LE(i * 4);
        mono.writeInt16LE(left, i * 2);
    }
    return mono;
}

function stopRuntimeMacAudio() {
    if (runtimeMacAudioProc) {
        try {
            runtimeMacAudioProc.kill('SIGTERM');
        } catch {}
        runtimeMacAudioProc = null;
    }
}

function startRuntimeMacGroqAudio(event) {
    stopRuntimeMacAudio();

    const executablePath = app.isPackaged
        ? path.join(process.resourcesPath, 'SystemAudioDump')
        : path.join(__dirname, '../assets', 'SystemAudioDump');

    runtimeMacAudioProc = spawn(executablePath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
    });

    if (!runtimeMacAudioProc.pid) {
        runtimeMacAudioProc = null;
        return false;
    }

    const sampleRate = 24000;
    const bytesPerFrame = 4;
    const chunkSize = Math.floor(sampleRate * bytesPerFrame * 0.1);
    let pending = Buffer.alloc(0);

    runtimeMacAudioProc.stdout.on('data', data => {
        pending = Buffer.concat([pending, data]);
        while (pending.length >= chunkSize) {
            const stereo = pending.subarray(0, chunkSize);
            pending = pending.subarray(chunkSize);
            const mono = convertStereoToMono(stereo);
            processGroqVadChunk(event, mono.toString('base64'), 'audio/pcm;rate=24000');
        }
    });

    runtimeMacAudioProc.stderr.on('data', data => {
        console.error('SystemAudioDump stderr:', data.toString());
    });
    runtimeMacAudioProc.once('close', () => {
        runtimeMacAudioProc = null;
    });
    runtimeMacAudioProc.once('error', error => {
        console.error('SystemAudioDump error:', error);
        runtimeMacAudioProc = null;
    });

    return true;
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
            stopRuntimeMacAudio();
            const result = await handler(event, ...args);
            runtimeProviderMode = 'byok';
            resetGroqVad();
            return result;
        };
    }

    if (channel === 'start-macos-audio') {
        return async (event, ...args) => {
            const audioMode = storage.getPreferences().audioMode || 'speaker_only';
            if (audioMode === 'mic_only') return { success: true, skipped: true };
            if (runtimeProviderMode === 'groq') {
                const success = startRuntimeMacGroqAudio(event);
                return { success, error: success ? undefined : 'Could not start SystemAudioDump' };
            }
            return handler(event, ...args);
        };
    }

    if (channel === 'stop-macos-audio') {
        return async (event, ...args) => {
            stopRuntimeMacAudio();
            return handler(event, ...args);
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

function prepareRuntimeProvider(mode) {
    runtimeProviderMode = mode;
    resetGroqVad();
    stopRuntimeMacAudio();
}

function installIpcHandlerHardening() {
    if (!beforeQuitCleanupInstalled) { app.on('before-quit', stopRuntimeMacAudio); beforeQuitCleanupInstalled = true; }
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

function setupRuntimeWindowHardening(mainWindow) {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    try {
        ipcMain.removeHandler('window-toggle-maximize');
    } catch {}

    ipcMain.handle('window-toggle-maximize', event => {
        if (!event?.sender || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id || event.senderFrame !== mainWindow.webContents.mainFrame) {
            return { success: false, error: 'Untrusted renderer' };
        }
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
        return { success: true, maximized: mainWindow.isMaximized() };
    });

    // Windows selection, loopback and monitor fallback have one owner.
    if (process.platform === 'win32') return;
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
    resetRuntimeAudio: resetGroqVad,
    prepareRuntimeProvider,
    installIpcHandlerHardening,
    setupRuntimeWindowHardening,
};
