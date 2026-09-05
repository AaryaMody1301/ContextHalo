const { requestIsCurrent } = require('./sessionRequests');
const { BrowserWindow } = require('electron');
const storage = require('../storage');
const {
    normalizeResponseMode,
    applyResponseModeInstruction,
    tuneChatRequestBody,
    normalizeTranscriptEvent,
} = require('./realtimeContextCore');

let installed = false;
let fetchPatched = false;
let googleGenAiPatched = false;

function emitLiveTranscript(payload) {
    if (!requestIsCurrent()) return;
    const event = normalizeTranscriptEvent(payload);
    if (!event) return;

    for (const window of BrowserWindow.getAllWindows()) {
        if (!window || window.isDestroyed()) continue;
        window.webContents.send('live-transcript', event);
    }
}

function getResponseMode() {
    return normalizeResponseMode(storage.getPreferences()?.responseMode);
}

function requestUrl(input) {
    try {
        if (typeof input === 'string' || input instanceof URL) return new URL(input.toString());
        if (input && typeof input.url === 'string') return new URL(input.url);
    } catch {}
    return null;
}

function isChatRequest(url) {
    if (!url) return false;
    if (url.hostname === 'api.groq.com' && url.pathname.includes('/chat/completions')) return true;
    return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.pathname.includes('/v1/chat/completions');
}

function getTranscriptProvider(url) {
    if (!url) return null;
    if (url.hostname === 'api.groq.com' && url.pathname.includes('/audio/transcriptions')) return 'groq';
    if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.pathname.includes('/inference')) return 'local';
    return null;
}

function tuneRequestInit(url, init = {}) {
    if (!isChatRequest(url) || typeof init.body !== 'string') return init;

    try {
        const body = JSON.parse(init.body);
        const tuned = tuneChatRequestBody(body, getResponseMode());
        return { ...init, body: JSON.stringify(tuned) };
    } catch {
        return init;
    }
}

function observeTranscriptResponse(response, provider) {
    if (!provider || !response?.ok || typeof response.clone !== 'function') return;

    try {
        const copy = response.clone();
        void copy.json().then(result => {
            const text = typeof result?.text === 'string' ? result.text : '';
            emitLiveTranscript({ provider, text, final: true, timestamp: Date.now() });
        }).catch(() => {});
    } catch {}
}

function patchProviderFetch() {
    if (fetchPatched || typeof global.fetch !== 'function') return;

    const previousFetch = global.fetch.bind(global);
    global.fetch = async (input, init = {}) => {
        const url = requestUrl(input);
        const nextInit = tuneRequestInit(url, init);
        const response = await previousFetch(input, nextInit);
        observeTranscriptResponse(response, getTranscriptProvider(url));
        return response;
    };

    fetchPatched = true;
}

function extractGeminiTranscript(message, field) {
    const transcription = message?.serverContent?.[field];
    if (!transcription) return '';
    if (typeof transcription.text === 'string') return transcription.text.trim();
    if (!Array.isArray(transcription.results)) return '';
    return transcription.results
        .map(result => result?.transcript || result?.text || '')
        .filter(Boolean)
        .join(' ')
        .trim();
}

function tuneLiveSystemInstruction(systemInstruction, mode) {
    if (typeof systemInstruction === 'string') {
        return applyResponseModeInstruction(systemInstruction, mode);
    }

    if (systemInstruction && typeof systemInstruction === 'object') {
        const parts = Array.isArray(systemInstruction.parts) ? systemInstruction.parts.map(part => ({ ...part })) : [];
        const textIndex = parts.findIndex(part => typeof part?.text === 'string');
        if (textIndex >= 0) {
            parts[textIndex].text = applyResponseModeInstruction(parts[textIndex].text, mode);
        } else {
            parts.push({ text: applyResponseModeInstruction('', mode) });
        }
        return { ...systemInstruction, parts };
    }

    return { parts: [{ text: applyResponseModeInstruction('', mode) }] };
}

function replaceGoogleGenAiExport(genai, PatchedGoogleGenAI) {
    try {
        genai.GoogleGenAI = PatchedGoogleGenAI;
    } catch {}
    if (genai.GoogleGenAI === PatchedGoogleGenAI) return true;

    try {
        const modulePath = require.resolve('@google/genai');
        const cachedModule = require.cache[modulePath];
        if (!cachedModule) return false;
        cachedModule.exports = { ...genai, GoogleGenAI: PatchedGoogleGenAI };
        return require('@google/genai').GoogleGenAI === PatchedGoogleGenAI;
    } catch {
        return false;
    }
}

function patchGeminiLive() {
    if (googleGenAiPatched) return;

    try {
        const genai = require('@google/genai');
        const CurrentGoogleGenAI = genai.GoogleGenAI;
        if (!CurrentGoogleGenAI || CurrentGoogleGenAI.__realtimeContextPatched) {
            googleGenAiPatched = true;
            return;
        }

        class RealtimeContextGoogleGenAI extends CurrentGoogleGenAI {
            constructor(options) {
                super(options);

                const live = this.live;
                const originalConnect = live?.connect?.bind(live);
                if (!originalConnect) return;

                live.connect = async params => {
                    const mode = getResponseMode();
                    let connectedSession = null;
                    const originalOnMessage = params?.callbacks?.onmessage;
                    const callbacks = {
                        ...(params?.callbacks || {}),
                        onmessage(message) {
                            if (connectedSession && global.geminiSessionRef?.current !== connectedSession) return;
                            const interim = extractGeminiTranscript(message, 'interimInputTranscription');
                            if (interim) {
                                emitLiveTranscript({ provider: 'gemini', text: interim, final: false, timestamp: Date.now() });
                            }

                            const finalText = extractGeminiTranscript(message, 'inputTranscription');
                            if (finalText) {
                                emitLiveTranscript({ provider: 'gemini', text: finalText, final: true, timestamp: Date.now() });
                            }

                            if (typeof originalOnMessage === 'function') {
                                return originalOnMessage.call(this, message);
                            }
                            return undefined;
                        },
                    };

                    const config = {
                        ...(params?.config || {}),
                        systemInstruction: tuneLiveSystemInstruction(params?.config?.systemInstruction, mode),
                    };

                    connectedSession = await originalConnect({ ...params, callbacks, config });
                    return connectedSession;
                };
            }
        }

        Object.defineProperty(RealtimeContextGoogleGenAI, '__realtimeContextPatched', { value: true });
        if (!replaceGoogleGenAiExport(genai, RealtimeContextGoogleGenAI)) {
            throw new Error('The @google/genai CommonJS export could not be wrapped for realtime context');
        }
        googleGenAiPatched = true;
    } catch (error) {
        console.warn('Could not install realtime Gemini context bridge:', error.message);
    }
}

const { sanitizeTranscriptHistory, sanitizeMarkers } = require('./sessionData');

function installRealtimeContextMain() {
    if (installed) return;
    patchProviderFetch();
    patchGeminiLive();
    installed = true;
}

module.exports = {
    installRealtimeContextMain,
    emitLiveTranscript,
    extractGeminiTranscript,
    tuneLiveSystemInstruction,
    sanitizeTranscriptHistory,
    sanitizeMarkers,
};
