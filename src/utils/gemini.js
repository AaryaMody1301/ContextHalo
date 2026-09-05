const { GoogleGenAI, Modality } = require('@google/genai');
const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const { saveDebugAudio } = require('../audioUtils');
const { getSystemPrompt } = require('./prompts');
const { getAvailableModel, incrementLimitCount, getApiKey, getGroqApiKey, incrementCharUsage, getConfig, getPreferences } = require('../storage');
const { connectCloud, sendCloudAudio, sendCloudText, sendCloudImage, closeCloud, isCloudActive, setOnTurnComplete } = require('./cloud');
const { startTransportLog, logTransportEvent, closeTransportLog } = require('./transportLogger');
const { listProviderModels } = require('./providerModelRegistry');
const { randomUUID } = require('node:crypto');
const { readSseJson } = require('./sse');
const { appendSessionPack } = require('./sessionPackMain');
const { runSessionRequest, resetSessionRequests, closeSessionRequests, requestIsCurrent,
    assertCurrentRequest, getRequestMetadata, getRequestSignal } = require('./sessionRequests');
let liveGeneration = 0;
let reconnectPromise = null;


// Lazy-loaded to avoid circular dependency (localai.js imports from gemini.js)
let _localai = null;
function getLocalAi() {
    if (!_localai) _localai = require('./localai');
    return _localai;
}

// Provider mode: 'byok', 'groq', 'cloud', or 'local'
let currentProviderMode = 'byok';

// Groq conversation history for context
let groqConversationHistory = [];

// Conversation tracking variables
let currentSessionId = null;
let currentTranscription = '';
let conversationHistory = [];
let screenAnalysisHistory = [];
let currentProfile = null;
let currentCustomPrompt = null;
let isInitializingSession = false;
let currentSystemPrompt = null;

function formatSpeakerResults(results) {
    let text = '';
    for (const result of results) {
        if (result.transcript && result.speakerId) {
            const speakerLabel = result.speakerId === 1 ? 'Interviewer' : 'Candidate';
            text += `[${speakerLabel}]: ${result.transcript}\n`;
        }
    }
    return text;
}

module.exports.formatSpeakerResults = formatSpeakerResults;

// Audio capture variables
let systemAudioProc = null;
let messageBuffer = '';

const GROQ_MAX_COMPLETION_TOKENS = 2048;
const GROQ_MAX_HISTORY_MESSAGES = 8;
const GROQ_MAX_HISTORY_CHARS = 12000;
const GROQ_MAX_SYSTEM_PROMPT_CHARS = 6000;
const GROQ_AUDIO_CHUNK_SECONDS = 8;
let groqSystemAudioBuffer = Buffer.alloc(0);
let groqTranscriptionInFlight = false;
let groqRateLimitState = null;
let geminiSessionResumptionHandle = null;
let lastGeminiInitializationError = '';
const GROQ_EMPTY_RESPONSE_MESSAGE =
    'Groq reached the maximum completion-token limit before returning a final answer. Disable thinking in Home → AI responses and try again.';

// Reconnection variables
let isUserClosing = false;
let sessionParams = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY = 2000;

function sendToRenderer(channel, data, metadata = getRequestMetadata()) {
    if (!requestIsCurrent()) return;
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        if (!windows[0].isDestroyed()) windows[0].webContents.send(channel, data, metadata);
    }
}

// Build context message for session restoration
function buildContextMessage() {
    const lastTurns = conversationHistory.slice(-20);
    const validTurns = lastTurns.filter(turn => turn.transcription?.trim() && turn.ai_response?.trim());

    if (validTurns.length === 0) return null;

    const contextLines = validTurns.map(turn => `[Interviewer]: ${turn.transcription.trim()}\n[Your answer]: ${turn.ai_response.trim()}`);

    return `Session reconnected. Here's the conversation so far:\n\n${contextLines.join('\n\n')}\n\nContinue from here.`;
}

// Conversation management functions
function initializeNewSession(profile = null, customPrompt = null) {
    currentSessionId = String(Math.max(Date.now(), Number(currentSessionId || 0) + 1));
    messageBuffer = '';
    startTransportLog(currentSessionId);
    currentTranscription = '';
    conversationHistory = [];
    screenAnalysisHistory = [];
    groqConversationHistory = [];
    currentProfile = profile;
    currentCustomPrompt = customPrompt;
    console.log('New conversation session started:', currentSessionId, 'profile:', profile);

    // Save initial session with profile context
    if (profile) {
        sendToRenderer('save-session-context', {
            sessionId: currentSessionId,
            profile: profile,
            customPrompt: customPrompt || '',
        });
    }
}

function saveConversationTurn(transcription, aiResponse) {
    if (!requestIsCurrent()) return;
    if (!currentSessionId) {
        initializeNewSession();
    }

    const conversationTurn = {
        timestamp: Date.now(),
        transcription: transcription.trim(),
        ai_response: aiResponse.trim(),
    };

    conversationHistory.push(conversationTurn);


    // Send to renderer to save in IndexedDB
    sendToRenderer('save-conversation-turn', {
        sessionId: currentSessionId,
        turn: conversationTurn,
        fullHistory: conversationHistory,
    });
}

function saveScreenAnalysis(prompt, response, model) {
    if (!requestIsCurrent()) return;
    if (!currentSessionId) {
        initializeNewSession();
    }

    const analysisEntry = {
        timestamp: Date.now(),
        prompt: prompt,
        response: response.trim(),
        model: model,
    };

    screenAnalysisHistory.push(analysisEntry);


    // Send to renderer to save
    sendToRenderer('save-screen-analysis', {
        sessionId: currentSessionId,
        analysis: analysisEntry,
        fullHistory: screenAnalysisHistory,
        profile: currentProfile,
        customPrompt: currentCustomPrompt,
    });
}

function getCurrentSessionData() {
    return {
        sessionId: currentSessionId,
        history: conversationHistory,
    };
}

async function getEnabledTools() {
    const tools = [];
    const googleSearchEnabled = getPreferences().googleSearchEnabled === true;
    console.log('Google Search enabled:', googleSearchEnabled);
    if (googleSearchEnabled) tools.push({ googleSearch: {} });
    return tools;
}

async function getStoredSetting(key, defaultValue) {
    if (key === 'googleSearchEnabled') {
        return String(getPreferences().googleSearchEnabled === true);
    }
    return defaultValue;
}

// helper to check if groq has been configured
function hasGroqKey() {
    const key = getGroqApiKey();
    return key && key.trim() != '';
}

function trimConversationHistory(history, maxChars = 42000) {
    if (!history || history.length === 0) return [];
    let totalChars = 0;
    const trimmed = [];

    for (let i = history.length - 1; i >= 0; i--) {
        const turn = history[i];
        const turnChars = (turn.content || '').length;

        if (totalChars + turnChars > maxChars) break;
        totalChars += turnChars;
        trimmed.unshift(turn);
    }
    return trimmed;
}

function stripThinkingTags(text) {
    const trimmedStart = text.trimStart();
    if ('<think>'.startsWith(trimmedStart)) {
        return '';
    }

    return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
}

function getGroqReasoningOptions(model, disableThinking) {
    if (model.includes('qwen3')) {
        const options = {
            reasoning_format: 'hidden',
        };

        if (disableThinking) {
            options.reasoning_effort = 'none';
        }

        return options;
    }

    if (model.startsWith('openai/gpt-oss-')) {
        return {
            include_reasoning: false,
        };
    }

    return {};
}

function getGeminiErrorDetail(error) {
    const values = [
        error?.message,
        error?.reason,
        error?.error?.message,
        error?.error?.status,
        error?.status,
        Number.isFinite(error?.code) ? `code ${error.code}` : '',
    ].filter(Boolean).map(String);
    return [...new Set(values)].join(' · ') || String(error || 'Unknown Gemini error');
}

function formatGeminiError(error) {
    const detail = getGeminiErrorDetail(error);
    const normalized = detail.toLowerCase();
    if (normalized.includes('api key') || normalized.includes('unauthenticated') || normalized.includes('401')) {
        return `Gemini authentication failed: ${detail}. Check the API key and that the Gemini API is enabled for its project.`;
    }
    if (normalized.includes('permission_denied') || normalized.includes('forbidden') || normalized.includes('403')) {
        return `Gemini permission denied: ${detail}. Check API-key restrictions and project access.`;
    }
    if (normalized.includes('resource_exhausted') || normalized.includes('quota') || normalized.includes('429')) {
        return `Gemini quota or rate limit reached: ${detail}`;
    }
    if (normalized.includes('not found') || normalized.includes('404')) {
        return `Gemini could not access the configured Live model: ${detail}`;
    }
    if (normalized.includes('invalid argument') || normalized.includes('1007')) {
        return `Gemini rejected the Live session setup: ${detail}`;
    }
    return `Gemini Live connection failed: ${detail}`;
}

async function getGeminiLivePreflightError(apiKey, liveModel) {
    try {
        const catalog = await listProviderModels('gemini', apiKey);
        const liveModels = Array.isArray(catalog?.live) ? catalog.live : [];
        if (!catalog?.stale && liveModels.length && !liveModels.some(model => model.id === liveModel)) {
            const suggested = catalog?.recommended?.live || liveModels[0]?.id || 'a Live-compatible model';
            return `Gemini API key is valid, but ${liveModel} is not available as a Live model for this key. Choose ${suggested} and try again.`;
        }
        return '';
    } catch (error) {
        const detail = getGeminiErrorDetail(error);
        if (/\b(401|403)\b/.test(detail)) return `Gemini API preflight failed: ${detail}`;
        return ''; // Allow the actual Live connection to decide on discovery outages.
    }
}

function connectGeminiLiveWithGuard(client, params, timeoutMs = 15000) {
    let setupFinished = false;
    let abandoned = false;
    let rejectEarly = () => {};
    let timer = null;
    const earlyFailure = new Promise((_, reject) => { rejectEarly = reject; });
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Gemini Live setup timed out after ${Math.ceil(timeoutMs / 1000)} seconds`)), timeoutMs);
    });
    const callbacks = params.callbacks || {};
    const wrappedCallbacks = {
        ...callbacks,
        onerror(event) {
            callbacks.onerror?.(event);
            if (!setupFinished) rejectEarly(new Error(`Gemini Live socket error: ${getGeminiErrorDetail(event)}`));
        },
        onclose(event) {
            callbacks.onclose?.(event);
            if (!setupFinished) {
                const code = Number.isFinite(event?.code) ? `code ${event.code}` : 'no close code';
                const reason = event?.reason ? `: ${event.reason}` : '';
                rejectEarly(new Error(`Gemini Live closed during setup (${code})${reason}`));
            }
        },
    };
    return Promise.race([
        client.live.connect({ ...params, callbacks: wrappedCallbacks }).then(session => {
            if (abandoned) { session.close(); throw new Error('Live setup was cancelled'); }
            return session;
        }),
        earlyFailure,
        timeout,
    ]).then(session => {
        setupFinished = true;
        if (timer) clearTimeout(timer);
        return session;
    }, error => {
        abandoned = true;
        setupFinished = true;
        if (timer) clearTimeout(timer);
        throw error;
    });
}

function compactGroqErrorBody(body) {
    try {
        const parsed = JSON.parse(body);
        return parsed?.error?.message || parsed?.message || body;
    } catch {
        return body || '';
    }
}

function captureGroqRateLimitHeaders(headers) {
    if (!headers || typeof headers.get !== 'function') return;
    const read = name => headers.get(name) || null;
    groqRateLimitState = {
        limitRequests: read('x-ratelimit-limit-requests'),
        remainingRequests: read('x-ratelimit-remaining-requests'),
        resetRequests: read('x-ratelimit-reset-requests'),
        limitTokens: read('x-ratelimit-limit-tokens'),
        remainingTokens: read('x-ratelimit-remaining-tokens'),
        resetTokens: read('x-ratelimit-reset-tokens'),
        retryAfter: read('retry-after'),
        updatedAt: Date.now(),
    };
    sendToRenderer('groq-rate-limit', groqRateLimitState);
}

function formatGroqError(status, body, headers) {
    if (status === 429) {
        const retryAfter = headers?.get?.('retry-after');
        const reset = headers?.get?.('x-ratelimit-reset-tokens') || headers?.get?.('x-ratelimit-reset-requests');
        const detail = compactGroqErrorBody(body);
        return retryAfter ? `Groq rate limit reached. Retry in ${retryAfter}s.` : `Groq rate limit reached${reset ? ` (reset ${reset})` : ''}${detail ? `: ${detail.slice(0, 180)}` : '.'}`;
    }
    if (status === 401) return 'Groq authentication failed. Check the API key.';
    if (status === 403) return 'Groq request is not permitted for this key/model.';
    if (status === 413) return 'Groq request is too large. Reduce context.';
    return `Groq error: ${status}${body ? ` - ${body.slice(0, 180)}` : ''}`;
}

// Groq-only voice path. This deliberately avoids opening Gemini Live when a
// Groq key is selected, so Gemini quota exhaustion cannot block Groq chats.
function pcmToWavBuffer(pcm, sampleRate = 24000, channels = 1) {
    const bitsPerSample = 16;
    const blockAlign = channels * bitsPerSample / 8;
    const byteRate = sampleRate * blockAlign;
    const header = Buffer.alloc(44);
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

function getPcmSampleRate(mimeType) {
    const match = String(mimeType || '').match(/rate=(\d+)/i);
    return match ? Number(match[1]) : 24000;
}

async function sendGroqSystemAudio(data, mimeType, language = 'en-US') {
    const sampleRate = getPcmSampleRate(mimeType);
    const pcm = Buffer.from(data, 'base64');

    // Always enqueue audio first. The previous implementation returned while a
    // transcription was in flight and silently discarded every chunk that arrived
    // during the request.
    groqSystemAudioBuffer = Buffer.concat([groqSystemAudioBuffer, pcm]);

    if (groqTranscriptionInFlight) return { success: true, queued: true };

    return processGroqAudioQueue(sampleRate, language);
}

async function processGroqAudioQueue(sampleRate, language) {
    const minBytes = sampleRate * 2 * GROQ_AUDIO_CHUNK_SECONDS;
    if (groqSystemAudioBuffer.length < minBytes) return { success: true };

    const chunk = groqSystemAudioBuffer.subarray(0, minBytes);
    groqSystemAudioBuffer = groqSystemAudioBuffer.subarray(minBytes);
    groqTranscriptionInFlight = true;

    try {
        const wav = pcmToWavBuffer(chunk, sampleRate, 1);
        const form = new FormData();
        form.append('model', getConfig().groqTranscriptionModel || 'whisper-large-v3-turbo');
        form.append('language', String(language).split('-')[0]);
        form.append('response_format', 'json');
        form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');

        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${getGroqApiKey()}` },
            body: form,
        });

        captureGroqRateLimitHeaders(response.headers);
        const body = await response.text();
        if (!response.ok) {
            const message = formatGroqError(response.status, body, response.headers);
            console.error('Groq transcription error:', response.status, body);
            sendToRenderer('update-status', message);
            return { success: false, error: message };
        }

        const transcript = JSON.parse(body)?.text?.trim();
        if (transcript) {
            currentTranscription = transcript;
            sendToRenderer('update-status', 'Generating Groq response...');
            const groqResult = await sendToGroq(transcript);
            currentTranscription = '';
            return groqResult;
        }
        return { success: true };
    } catch (error) {
        console.error('Groq audio transcription failed:', error);
        sendToRenderer('update-status', 'Groq transcription error: ' + error.message);
        return { success: false, error: error.message };
    } finally {
        groqTranscriptionInFlight = false;
        // Drain queued audio after the active request finishes. Keep this
        // asynchronous so the IPC caller is never blocked by the next chunk.
        if (groqSystemAudioBuffer.length >= sampleRate * 2 * GROQ_AUDIO_CHUNK_SECONDS) {
            void processGroqAudioQueue(sampleRate, language);
        }
    }
}

function sendToGroq(transcription) {
    return runSessionRequest('voice', () => sendToGroqNow(transcription));
}

async function sendToGroqNow(transcription) {
    const groqApiKey = getGroqApiKey();
    if (!groqApiKey) {
        console.log('No Groq API key configured, skipping Groq response');
        return { success: false, error: 'No Groq API key configured' };
    }

    if (!transcription || transcription.trim() === '') {
        console.log('Empty transcription, skipping Groq');
        return { success: false, error: 'Empty message' };
    }

    const config = getConfig();
    const modelToUse = config.groqModel;

    logTransportEvent('groq.text.request', {
        model: modelToUse,
        transcription,
    });

    let requestHistory = [...requestHistory];
    requestHistory.push({
        role: 'user',
        content: transcription.trim(),
    });

    if (requestHistory.length > GROQ_MAX_HISTORY_MESSAGES) {
        requestHistory = requestHistory.slice(-GROQ_MAX_HISTORY_MESSAGES);
    }
    requestHistory = trimConversationHistory(requestHistory, GROQ_MAX_HISTORY_CHARS);

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${groqApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: modelToUse,
                messages: [{ role: 'system', content: (currentSystemPrompt || 'You are a helpful assistant.').slice(0, GROQ_MAX_SYSTEM_PROMPT_CHARS) }, ...requestHistory],
                stream: true,
                temperature: 0.7,
                max_completion_tokens: GROQ_MAX_COMPLETION_TOKENS,
                ...getGroqReasoningOptions(modelToUse, config.disableGroqThinking),
            }),
        });

        captureGroqRateLimitHeaders(response.headers);
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Groq API error:', response.status, errorText);
            logTransportEvent('groq.text.http_error', {
                status: response.status,
                body: errorText,
            });
            const message = formatGroqError(response.status, errorText, response.headers);
            sendToRenderer('update-status', message);
            sendToRenderer('new-response', message);
            return { success: false, error: message };
        }

        logTransportEvent('groq.text.http_response', {
            status: response.status,
        });

        let fullText = '';
        let isFirst = true;
        let finishReason = null;
        for await (const event of readSseJson(response.body, getRequestSignal())) {
            assertCurrentRequest();
            finishReason = event.choices?.[0]?.finish_reason || finishReason;
            fullText += event.choices?.[0]?.delta?.content || '';
            const displayText = stripThinkingTags(fullText);
            if (displayText) {
                sendToRenderer(isFirst ? 'new-response' : 'update-response', displayText);
                isFirst = false;
            }
        }

        assertCurrentRequest();
        const cleanedResponse = stripThinkingTags(fullText);
        const modelKey = modelToUse.split('/').pop();

        const systemPromptChars = (currentSystemPrompt || 'You are a helpful assistant.').length;
        const historyChars = requestHistory.reduce((sum, msg) => sum + (msg.content || '').length, 0);
        const inputChars = systemPromptChars + historyChars;
        const outputChars = cleanedResponse.length;

        incrementCharUsage('groq', modelKey, inputChars + outputChars);

        if (cleanedResponse) {
            groqConversationHistory = [...requestHistory, { role: 'assistant', content: cleanedResponse }];

            saveConversationTurn(transcription, cleanedResponse);
        } else {
            console.warn(`Groq returned no final answer (${modelToUse})`);
            logTransportEvent('groq.text.empty_response', {
                model: modelToUse,
                fullText,
                finishReason,
            });
            sendToRenderer('new-response', GROQ_EMPTY_RESPONSE_MESSAGE);
            sendToRenderer('update-status', 'Groq reached the completion-token limit');
            return { success: false, error: GROQ_EMPTY_RESPONSE_MESSAGE };
        }

        logTransportEvent('groq.text.completed', {
            model: modelToUse,
            response: cleanedResponse,
        });
        console.log(`Groq response completed (${modelToUse})`);
        sendToRenderer('update-status', 'Listening...');
        return { success: true, text: cleanedResponse, model: modelToUse };
    } catch (error) {
        console.error('Error calling Groq API:', error);
        logTransportEvent('groq.text.error', {
            error: error.message,
            stack: error.stack,
        });
        const message = 'Groq error: ' + error.message;
        sendToRenderer('update-status', message);
        return { success: false, error: message };
    }
}

async function sendImageToGroq(base64Data, prompt) {
    const groqApiKey = getGroqApiKey();
    const config = getConfig();
    const model = config.groqImageModel;

    logTransportEvent('groq.image.request', {
        model,
        prompt,
        imageBytes: Buffer.byteLength(base64Data, 'base64'),
    });

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${groqApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: currentSystemPrompt || 'You are a helpful assistant.' },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:image/jpeg;base64,${base64Data}`,
                                },
                            },
                        ],
                    },
                ],
                stream: true,
                temperature: 0.7,
                max_completion_tokens: GROQ_MAX_COMPLETION_TOKENS,
                ...getGroqReasoningOptions(model, config.disableGroqThinking),
            }),
        });

        captureGroqRateLimitHeaders(response.headers);
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Groq image API error:', response.status, errorText);
            logTransportEvent('groq.image.http_error', {
                status: response.status,
                body: errorText,
            });
            return { success: false, error: formatGroqError(response.status, errorText, response.headers) };
        }

        logTransportEvent('groq.image.http_response', {
            status: response.status,
        });

        let fullText = '';
        let isFirst = true;
        let finishReason = null;
        for await (const event of readSseJson(response.body, getRequestSignal())) {
            assertCurrentRequest();
            finishReason = event.choices?.[0]?.finish_reason || finishReason;
            fullText += event.choices?.[0]?.delta?.content || '';
            const displayText = stripThinkingTags(fullText);
            if (displayText) {
                sendToRenderer(isFirst ? 'new-response' : 'update-response', displayText);
                isFirst = false;
            }
        }

        const cleanedResponse = stripThinkingTags(fullText);
        if (!cleanedResponse) {
            logTransportEvent('groq.image.empty_response', {
                model,
                fullText,
                finishReason,
            });
            return { success: false, error: GROQ_EMPTY_RESPONSE_MESSAGE };
        }

        saveScreenAnalysis(prompt, cleanedResponse, model);
        logTransportEvent('groq.image.completed', {
            model,
            response: cleanedResponse,
        });
        return { success: true, text: cleanedResponse, model };
    } catch (error) {
        console.error('Error calling Groq image API:', error);
        logTransportEvent('groq.image.error', {
            error: error.message,
            stack: error.stack,
        });
        return { success: false, error: error.message };
    }
}

async function initializeGeminiSession(apiKey, customPrompt = '', profile = 'interview', language = 'en-US', isReconnect = false) {
    if (isInitializingSession) {
        console.log('Session initialization already in progress');
        return false;
    }

    const generation = liveGeneration;
    isInitializingSession = true;
    if (!isReconnect) {
        geminiSessionResumptionHandle = null;
        isUserClosing = false;
        lastGeminiInitializationError = '';
        sendToRenderer('session-initializing', true);
    }

    // Store params for reconnection
    if (!isReconnect) {
        sessionParams = { apiKey, customPrompt, profile, language };
        reconnectAttempts = 0;
    }

    const client = new GoogleGenAI({
        vertexai: false,
        apiKey: apiKey,
        // Gemini Live uses the v1beta WebSocket API. The old v1alpha override
        // caused avoidable connection failures as the Live API evolved.
        httpOptions: { apiVersion: 'v1beta' },
    });

    // Get enabled tools first to determine Google Search status
    const enabledTools = await getEnabledTools();
    const googleSearchEnabled = enabledTools.some(tool => tool.googleSearch);

    const systemPrompt = getSystemPrompt(profile, customPrompt, googleSearchEnabled);
    currentSystemPrompt = systemPrompt; // Store for Groq
    const liveModel = String(getConfig().geminiLiveModel || 'gemini-3.1-flash-live-preview')
        .replace(/^models\//, '')
        .trim() || 'gemini-3.1-flash-live-preview';
    sendToRenderer('update-status', `Connecting to ${liveModel}...`);

    if (!isReconnect) {
        const preflightError = await getGeminiLivePreflightError(apiKey, liveModel);
        if (preflightError) {
            lastGeminiInitializationError = preflightError;
            sendToRenderer('update-status', preflightError);
            isInitializingSession = false;
            sendToRenderer('session-initializing', false);
            return null;
        }
    }

    let liveResponseId = randomUUID();
    let modelTextBuffer = '';
    let audioTextBuffer = '';
    let liveSessionReady = false;
    let connectedWithoutSearch = false;

    try {
        const callbacks = {
                onopen: function () {
                    logTransportEvent('gemini.live.opened', {});
                    sendToRenderer('update-status', 'Live session connected');
                },
                onmessage: function (message) {
                    if (generation !== liveGeneration || isUserClosing) return;
                    logTransportEvent('gemini.live.message', message);

                    // Handle input transcription (what was spoken)
                    if (message.serverContent?.inputTranscription?.results) {
                        currentTranscription += formatSpeakerResults(message.serverContent.inputTranscription.results);
                    } else if (message.serverContent?.inputTranscription?.text) {
                        const text = message.serverContent.inputTranscription.text;
                        if (text.trim() !== '') {
                            currentTranscription += text;
                        }
                    }

                    const content = message.serverContent || {};
                    for (const part of content.modelTurn?.parts || []) {
                        if (part?.text && !part.thought) modelTextBuffer += part.text;
                    }
                    if (content.outputTranscription?.text) audioTextBuffer += content.outputTranscription.text;
                    // Some Live models emit both text parts and an audio transcript.
                    // They are alternative views, not two strings to concatenate.
                    const visible = audioTextBuffer || modelTextBuffer;
                    if (visible && visible !== messageBuffer) {
                        const isFirstChunk = messageBuffer === '';
                        messageBuffer = visible;
                        sendToRenderer(isFirstChunk ? 'new-response' : 'update-response', messageBuffer,
                            { requestId: liveResponseId, kind: 'voice' });
                    }
                    const resumeHandle = message.sessionResumptionUpdate?.newHandle;
                    if (resumeHandle) geminiSessionResumptionHandle = resumeHandle;
                    // generationComplete can precede the final transcription. Save
                    // once at turnComplete (or interruption), not at generationComplete.
                    if (content.turnComplete || content.interrupted) {
                        if (currentTranscription.trim() && messageBuffer.trim()) {
                            saveConversationTurn(currentTranscription, messageBuffer);
                        }
                        currentTranscription = '';
                        messageBuffer = '';
                        modelTextBuffer = '';
                        audioTextBuffer = '';
                        liveResponseId = randomUUID();
                                            sendToRenderer('update-status', content.interrupted ? 'Response interrupted' : 'Listening...');
                    }
                },
                onerror: function (e) {
                    if (generation !== liveGeneration) return;
                    const detail = formatGeminiError(e);
                    console.log('Session error:', getGeminiErrorDetail(e));
                    logTransportEvent('gemini.live.error', { error: getGeminiErrorDetail(e) });
                    if (!liveSessionReady) lastGeminiInitializationError = detail;
                    sendToRenderer('update-status', detail);
                },
                onclose: function (e) {
                    if (generation !== liveGeneration) return;
                    const closeDetail = `Gemini Live closed${Number.isFinite(e?.code) ? ` (code ${e.code})` : ''}${e?.reason ? `: ${e.reason}` : ''}`;
                    console.log('Session closed:', closeDetail);
                    logTransportEvent('gemini.live.closed', { reason: closeDetail });

                    if (!liveSessionReady) {
                        lastGeminiInitializationError = closeDetail;
                        sendToRenderer('update-status', closeDetail);
                        return;
                    }

                    // Don't reconnect if user intentionally closed
                    if (isUserClosing) {
                        isUserClosing = false;
                        closeTransportLog();
                        sendToRenderer('update-status', 'Session closed');
                        return;
                    }

                    // Attempt reconnection
                    if (sessionParams && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        if (!reconnectPromise) {
                            reconnectPromise = attemptReconnect().finally(() => { reconnectPromise = null; });
                        }
                    } else {
                        closeTransportLog();
                        sendToRenderer('update-status', 'Session closed');
                    }
                },
            };

        const baseConfig = {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: { parts: [{ text: systemPrompt }] },
        };
        const preferredConfig = enabledTools.length ? { ...baseConfig, tools: enabledTools } : baseConfig;

        let session;
        try {
            session = await connectGeminiLiveWithGuard(client, {
                model: liveModel,
                callbacks,
                config: preferredConfig,
            });
        } catch (firstError) {
            if (!enabledTools.length) throw firstError;
            sendToRenderer('update-status', 'Gemini Live setup failed with Search enabled; retrying without Search...');
            session = await connectGeminiLiveWithGuard(client, {
                model: liveModel,
                callbacks,
                config: baseConfig,
            });
            connectedWithoutSearch = true;
        }

        if (generation !== liveGeneration || isUserClosing) {
            session.close();
            return null;
        }
        liveSessionReady = true;
        if (!isReconnect) initializeNewSession(profile, customPrompt);
        lastGeminiInitializationError = '';
        if (connectedWithoutSearch) {
            sendToRenderer('update-status', 'Live session connected (Google Search disabled for this session)');
        }

        isInitializingSession = false;
        if (!isReconnect) {
            sendToRenderer('session-initializing', false);
        }
        return session;
    } catch (error) {
        let message = formatGeminiError(error);
        if (!isReconnect && /api request error|socket|setup|closed|timed out/i.test(getGeminiErrorDetail(error))) {
            const preflightError = await getGeminiLivePreflightError(apiKey, liveModel);
            if (!preflightError) {
                message = `${message}. The API key can list ${liveModel}, so the failure is in the Live WebSocket/setup path rather than model discovery.`;
            } else {
                message = preflightError;
            }
        }
        lastGeminiInitializationError = message;
        console.error('Failed to initialize Gemini session:', error);
        logTransportEvent('gemini.live.connect_error', {
            error: error?.message || String(error),
        });
        sendToRenderer('update-status', message);
        isInitializingSession = false;
        if (!isReconnect) {
            sendToRenderer('session-initializing', false);
        }
        return null;
    }
}

async function attemptReconnect() {
    const generation = liveGeneration;
    if (!sessionParams || isUserClosing) return false;
    reconnectAttempts++;
    console.log(`Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

    // Clear stale buffers
    messageBuffer = '';
    currentTranscription = '';
    // Don't reset groqConversationHistory to preserve context across reconnects

    sendToRenderer('update-status', `Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    // Wait before attempting
    await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY));
    if (generation !== liveGeneration || isUserClosing || !sessionParams) return false;

    try {
        const session = await initializeGeminiSession(
            sessionParams.apiKey,
            sessionParams.customPrompt,
            sessionParams.profile,
            sessionParams.language,
            true // isReconnect
        );

        if (session && generation === liveGeneration && !isUserClosing && global.geminiSessionRef) {
            global.geminiSessionRef.current = session;

            // Restore context from conversation history via text message
            const contextMessage = buildContextMessage();
            if (contextMessage) {
                try {
                    console.log('Restoring conversation context...');
                    await session.sendRealtimeInput({ text: contextMessage });
                } catch (contextError) {
                    console.error('Failed to restore context:', contextError);
                    // Continue without context - better than failing
                }
            }

            // Don't reset reconnectAttempts here - let it reset on next fresh session
            sendToRenderer('update-status', 'Reconnected! Listening...');
            console.log('Session reconnected successfully');
            return true;
        }
    } catch (error) {
        console.error(`Reconnection attempt ${reconnectAttempts} failed:`, error);
    }

    // If we still have attempts left, try again
    if (generation === liveGeneration && !isUserClosing && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        return attemptReconnect();
    }

    if (geminiSessionResumptionHandle) {
        console.warn('Discarding stale Gemini session resumption handle after repeated failures');
        geminiSessionResumptionHandle = null;
    }

    // Max attempts reached - notify frontend
    console.log('Max reconnection attempts reached');
    sendToRenderer('reconnect-failed', {
        message: 'Tried 3 times to reconnect. Must be upstream/network issues. Try restarting or download updated app from site.',
    });
    sessionParams = null;
    return false;
}

function killExistingSystemAudioDump() {
    return new Promise(resolve => {
        console.log('Checking for existing SystemAudioDump processes...');

        // Kill any existing SystemAudioDump processes
        const killProc = spawn('pkill', ['-f', 'SystemAudioDump'], {
            stdio: 'ignore',
        });

        killProc.on('close', code => {
            if (code === 0) {
                console.log('Killed existing SystemAudioDump processes');
            } else {
                console.log('No existing SystemAudioDump processes found');
            }
            resolve();
        });

        killProc.on('error', err => {
            console.log('Error checking for existing processes (this is normal):', err.message);
            resolve();
        });

        // Timeout after 2 seconds
        setTimeout(() => {
            killProc.kill();
            resolve();
        }, 2000);
    });
}

async function startMacOSAudioCapture(geminiSessionRef) {
    if (process.platform !== 'darwin') return false;

    // Kill any existing SystemAudioDump processes first
    await killExistingSystemAudioDump();

    console.log('Starting macOS audio capture with SystemAudioDump...');

    const { app } = require('electron');
    const path = require('path');

    let systemAudioPath;
    if (app.isPackaged) {
        systemAudioPath = path.join(process.resourcesPath, 'SystemAudioDump');
    } else {
        systemAudioPath = path.join(__dirname, '../assets', 'SystemAudioDump');
    }

    console.log('SystemAudioDump path:', systemAudioPath);

    const spawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
        },
    };

    systemAudioProc = spawn(systemAudioPath, [], spawnOptions);

    if (!systemAudioProc.pid) {
        console.error('Failed to start SystemAudioDump');
        return false;
    }

    console.log('SystemAudioDump started with PID:', systemAudioProc.pid);

    const CHUNK_DURATION = 0.1;
    const SAMPLE_RATE = 24000;
    const BYTES_PER_SAMPLE = 2;
    const CHANNELS = 2;
    const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

    let audioBuffer = Buffer.alloc(0);

    systemAudioProc.stdout.on('data', data => {
        audioBuffer = Buffer.concat([audioBuffer, data]);

        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);

            const monoChunk = CHANNELS === 2 ? convertStereoToMono(chunk) : chunk;

            if (currentProviderMode === 'cloud') {
                sendCloudAudio(monoChunk);
            } else if (currentProviderMode === 'local') {
                getLocalAi().processLocalAudio(monoChunk);
            } else if (currentProviderMode === 'groq') {
                const base64Data = monoChunk.toString('base64');
                void sendGroqSystemAudio(base64Data, 'audio/pcm;rate=24000', sessionParams?.language || 'en-US');
            } else {
                const base64Data = monoChunk.toString('base64');
                sendAudioToGemini(base64Data, geminiSessionRef);
            }

            if (process.env.DEBUG_AUDIO) {
                console.log(`Processed audio chunk: ${chunk.length} bytes`);
                saveDebugAudio(monoChunk, 'system_audio');
            }
        }

        const maxBufferSize = SAMPLE_RATE * BYTES_PER_SAMPLE * 1;
        if (audioBuffer.length > maxBufferSize) {
            audioBuffer = audioBuffer.slice(-maxBufferSize);
        }
    });

    systemAudioProc.stderr.on('data', data => {
        console.error('SystemAudioDump stderr:', data.toString());
    });

    systemAudioProc.on('close', code => {
        console.log('SystemAudioDump process closed with code:', code);
        systemAudioProc = null;
    });

    systemAudioProc.on('error', err => {
        console.error('SystemAudioDump process error:', err);
        systemAudioProc = null;
    });

    return true;
}

function convertStereoToMono(stereoBuffer) {
    const samples = stereoBuffer.length / 4;
    const monoBuffer = Buffer.alloc(samples * 2);

    for (let i = 0; i < samples; i++) {
        const leftSample = stereoBuffer.readInt16LE(i * 4);
        monoBuffer.writeInt16LE(leftSample, i * 2);
    }

    return monoBuffer;
}

function stopMacOSAudioCapture() {
    if (systemAudioProc) {
        console.log('Stopping SystemAudioDump...');
        systemAudioProc.kill('SIGTERM');
        systemAudioProc = null;
    }
}

async function sendAudioToGemini(base64Data, geminiSessionRef) {
    if (!geminiSessionRef.current) return;

    try {
        process.stdout.write('.');
        await geminiSessionRef.current.sendRealtimeInput({
            audio: {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            },
        });
    } catch (error) {
        console.error('Error sending audio to Gemini:', error);
    }
}

async function sendImageToGeminiHttp(base64Data, prompt) {
    // Get available model based on rate limits
    const model = getAvailableModel();

    const apiKey = getApiKey();
    if (!apiKey) {
        return { success: false, error: 'No API key configured' };
    }

    try {
        const ai = new GoogleGenAI({ apiKey: apiKey });

        const contents = [
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Data,
                },
            },
            { text: prompt },
        ];

        console.log(`Sending image to ${model} (streaming)...`);
        const response = await ai.models.generateContentStream({
            model: model,
            contents: contents,
        });

        // Increment count after successful call
        incrementLimitCount(model);

        // Stream the response
        let fullText = '';
        let isFirst = true;
        for await (const chunk of response) {
            const chunkText = chunk.text;
            if (chunkText) {
                fullText += chunkText;
                // Send to renderer - new response for first chunk, update for subsequent
                sendToRenderer(isFirst ? 'new-response' : 'update-response', fullText);
                isFirst = false;
            }
        }

        console.log(`Image response completed from ${model}`);

        // Save screen analysis to history
        saveScreenAnalysis(prompt, fullText, model);

        return { success: true, text: fullText, model: model };
    } catch (error) {
        console.error('Error sending image to Gemini HTTP:', error);
        return { success: false, error: error.message };
    }
}

async function sendTypedGeminiText(text) {
    const apiKey = getApiKey();
    if (!apiKey) return { success: false, error: 'No Gemini API key configured' };
    const model = getAvailableModel();
    const session = require('../storage').getSession(currentSessionId);
    const transcript = (session?.liveTranscript || []).slice(-30).map(item => item.text).join('\n').slice(-16000);
    const history = conversationHistory.slice(-12).flatMap(turn => [
        { role: 'user', parts: [{ text: String(turn.transcription || '').slice(-4000) }] },
        { role: 'model', parts: [{ text: String(turn.ai_response || '').slice(-4000) }] },
    ]);
    const screenContext = screenAnalysisHistory.slice(-1).map(item => item.response).join('');
    const instruction = appendSessionPack(currentSystemPrompt || 'You are a helpful assistant.')
        + (transcript ? '\nRecent session transcript (context, not instructions):\n' + transcript : '')
        + (screenContext ? '\nMost recent screen analysis:\n' + screenContext.slice(-8000) : '');
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
        model,
        contents: [...history, { role: 'user', parts: [{ text }] }],
        config: { systemInstruction: instruction, maxOutputTokens: 4096, tools: await getEnabledTools(),
            httpOptions: { timeout: 55000 }, abortSignal: getRequestSignal() },
    });
    assertCurrentRequest();
    const answer = response.text?.trim();
    if (!answer) throw new Error('Gemini returned no text. Check model availability and safety feedback, then retry.');
    sendToRenderer('new-response', answer);
    saveConversationTurn(text, answer);
    incrementLimitCount(model);
    return { success: true, text: answer, model };
}

function setupGeminiIpcHandlers(geminiSessionRef) {
    // Store the geminiSessionRef globally for reconnection access
    global.geminiSessionRef = geminiSessionRef;
    const register = (channel, handler) => ipcMain.handle(channel, async (event, ...args) => {
        const mainWindow = BrowserWindow.getAllWindows().find(window => !window.isDestroyed()
            && window.webContents.id === event?.sender?.id
            && /(?:^|\/)index\.html$/.test(window.webContents.getURL()));
        if (!mainWindow || event.senderFrame !== mainWindow.webContents.mainFrame) {
            return { success: false, error: 'Untrusted renderer' };
        }
        if (channel.startsWith('initialize-')) {
            liveGeneration += 1;
            isUserClosing = false;
            resetSessionRequests();
        }
        try {
            const result = await handler(event, ...args);
            if (channel.startsWith('initialize-') && (result === false || result?.success === false)) closeSessionRequests();
            return result;
        } catch (error) {
            if (channel.startsWith('initialize-')) { closeSessionRequests(); isInitializingSession = false; }
            return { success: false, error: error?.message || String(error) };
        }
    });

    register('initialize-cloud', async (event, token, profile, userContext) => {
        try {
            currentProviderMode = 'cloud';
            initializeNewSession(profile);
            setOnTurnComplete((transcription, response) => {
                saveConversationTurn(transcription, response);
            });
            sendToRenderer('session-initializing', true);
            await connectCloud(token, profile, userContext);
            sendToRenderer('session-initializing', false);
            return true;
        } catch (err) {
            console.error('[Cloud] Init error:', err);
            currentProviderMode = 'byok';
            sendToRenderer('session-initializing', false);
            return false;
        }
    });

    register('initialize-gemini', async (event, apiKey, customPrompt, profile = 'interview', language = 'en-US', provider = 'byok') => {
        const selectedProvider = provider === 'groq' ? 'groq' : 'byok';

        // Provider choice is explicit. A saved Groq key must never override a
        // user who selected Gemini, and Gemini must not be opened for Groq.
        if (selectedProvider === 'groq') {
            if (!hasGroqKey()) {
                const error = 'No Groq API key configured.';
                sendToRenderer('update-status', error);
                return { success: false, error };
            }

            currentProviderMode = 'groq';
            geminiSessionRef.current = null;
            const enabledTools = await getEnabledTools();
            currentSystemPrompt = getSystemPrompt(profile, customPrompt, enabledTools.some(tool => tool.googleSearch));
            initializeNewSession(profile, customPrompt);
            sessionParams = { language, profile, customPrompt, provider: 'groq' };
            reconnectAttempts = 0;
            groqSystemAudioBuffer = Buffer.alloc(0);
            sendToRenderer('update-status', 'Groq ready');
            return { success: true, provider: 'groq' };
        }

        if (!apiKey || !apiKey.trim()) {
            const error = 'No Gemini API key configured.';
            sendToRenderer('update-status', error);
            return { success: false, error };
        }

        currentProviderMode = 'byok';
        const session = await initializeGeminiSession(apiKey, customPrompt, profile, language);
        if (session) {
            geminiSessionRef.current = session;
            return { success: true, provider: 'gemini' };
        }
        return { success: false, error: lastGeminiInitializationError || 'Gemini session could not be initialized.' };
    });

    register('initialize-local', async (event, localLlmModel, whisperModel, profile, customPrompt, language = 'en-US') => {
        currentProviderMode = 'local';
        const success = await getLocalAi().initializeLocalSession(localLlmModel, whisperModel, profile, customPrompt, language);
        if (!success) {
            currentProviderMode = 'byok';
        }
        return success;
    });

    register('cancel-local-initialization', async () => {
        const cancelled = await getLocalAi().cancelLocalInitialization();
        if (cancelled) {
            currentProviderMode = 'byok';
        }
        return cancelled;
    });

    register('send-audio-content', async (event, payload) => {
        const { data, mimeType } = payload || {};
        if (typeof data !== 'string' || data.length > 262144 || !/^audio\/pcm;rate=(16000|24000|48000)$/.test(mimeType || '')) {
            return { success: false, error: 'Invalid PCM audio payload' };
        }
        if (currentProviderMode === 'cloud') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                sendCloudAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending cloud audio:', error);
                return { success: false, error: error.message };
            }
        }
        if (currentProviderMode === 'local') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                getLocalAi().processLocalAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending local audio:', error);
                return { success: false, error: error.message };
            }
        }
        if (currentProviderMode === 'groq') {
            return await sendGroqSystemAudio(data, mimeType, sessionParams?.language || 'en-US');
        }
        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };
        try {
            process.stdout.write('.');
            await geminiSessionRef.current.sendRealtimeInput({
                audio: { data: data, mimeType: mimeType },
            });
            return { success: true };
        } catch (error) {
            console.error('Error sending system audio:', error);
            return { success: false, error: error.message };
        }
    });

    // Handle microphone audio on a separate channel
    register('send-mic-audio-content', async (event, payload) => {
        const { data, mimeType } = payload || {};
        if (typeof data !== 'string' || data.length > 262144 || !/^audio\/pcm;rate=(16000|24000|48000)$/.test(mimeType || '')) {
            return { success: false, error: 'Invalid PCM audio payload' };
        }
        if (currentProviderMode === 'cloud') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                sendCloudAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending cloud mic audio:', error);
                return { success: false, error: error.message };
            }
        }
        if (currentProviderMode === 'local') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                getLocalAi().processLocalAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.error('Error sending local mic audio:', error);
                return { success: false, error: error.message };
            }
        }
        // Candidate microphone audio is not sent back as a new Groq question.
        if (currentProviderMode === 'groq') return { success: true };
        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };
        try {
            process.stdout.write(',');
            await geminiSessionRef.current.sendRealtimeInput({
                audio: { data: data, mimeType: mimeType },
            });
            return { success: true };
        } catch (error) {
            console.error('Error sending mic audio:', error);
            return { success: false, error: error.message };
        }
    });

    register('send-image-content', async (event, payload) => {
        const { data, prompt } = payload || {};
        if (typeof data !== 'string' || data.length > 20000000 || typeof prompt !== 'string' || prompt.length > 32000) {
            return { success: false, error: 'Invalid image request' };
        }
        try {
            if (!data || typeof data !== 'string') {
                console.error('Invalid image data received');
                return { success: false, error: 'Invalid image data' };
            }

            const buffer = Buffer.from(data, 'base64');

            if (buffer.length < 1000) {
                console.error(`Image buffer too small: ${buffer.length} bytes`);
                return { success: false, error: 'Image buffer too small' };
            }

            process.stdout.write('!');

            if (currentProviderMode === 'cloud') {
                const sent = sendCloudImage(data);
                if (!sent) {
                    return { success: false, error: 'Cloud connection not active' };
                }
                return { success: true, model: 'cloud' };
            }

            if (currentProviderMode === 'local') {
                const result = await getLocalAi().sendLocalImage(data, prompt);
                return result;
            }

            const result = currentProviderMode === 'groq' ? await sendImageToGroq(data, prompt) : await sendImageToGeminiHttp(data, prompt);
            return result;
        } catch (error) {
            console.error('Error sending image:', error);
            return { success: false, error: error.message };
        }
    });

    register('send-text-message', async (event, text) => {
        if (typeof text !== 'string' || !text.trim() || text.length > 32000) {
            return { success: false, error: 'Enter a message between 1 and 32,000 characters' };
        }
        const cleanText = text.trim();
        return runSessionRequest('text', async () => {
            if (currentProviderMode === 'local') return getLocalAi().sendLocalText(cleanText);
            if (currentProviderMode === 'groq') return sendToGroq(cleanText);
            return sendTypedGeminiText(cleanText);
        }, { timeoutMs: currentProviderMode === 'local' ? 180000 : 65000 });
    });

    register('start-macos-audio', async event => {
        if (process.platform !== 'darwin') {
            return {
                success: false,
                error: 'macOS audio capture only available on macOS',
            };
        }

        try {
            const success = await startMacOSAudioCapture(geminiSessionRef);
            return { success };
        } catch (error) {
            console.error('Error starting macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    register('stop-macos-audio', async event => {
        try {
            stopMacOSAudioCapture();
            return { success: true };
        } catch (error) {
            console.error('Error stopping macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    register('close-session', async event => {
        liveGeneration += 1;
        isUserClosing = true;
        sessionParams = null;
        currentTranscription = '';
        messageBuffer = '';
        closeSessionRequests();
        try {
            stopMacOSAudioCapture();

            if (currentProviderMode === 'cloud') {
                closeCloud();
                currentProviderMode = 'byok';
                closeTransportLog();
                return { success: true };
            }

            if (currentProviderMode === 'local') {
                getLocalAi().closeLocalSession();
                currentProviderMode = 'byok';
                closeTransportLog();
                return { success: true };
            }

            if (currentProviderMode === 'groq') {
                groqSystemAudioBuffer = Buffer.alloc(0);
                groqConversationHistory = [];
                currentProviderMode = 'byok';
                closeTransportLog();
                sendToRenderer('update-status', 'Session closed');
                return { success: true };
            }

            // Set flag to prevent reconnection attempts
            isUserClosing = true;
            sessionParams = null;

            // Cleanup session
            if (geminiSessionRef.current) {
                await geminiSessionRef.current.close();
                geminiSessionRef.current = null;
            } else {
                closeTransportLog();
            }

            return { success: true };
        } catch (error) {
            console.error('Error closing session:', error);
            return { success: false, error: error.message };
        }
    });

    // Conversation history IPC handlers
    register('get-current-session', async event => {
        try {
            return { success: true, data: getCurrentSessionData() };
        } catch (error) {
            console.error('Error getting current session:', error);
            return { success: false, error: error.message };
        }
    });

    register('start-new-session', async event => {
        try {
            initializeNewSession();
            return { success: true, sessionId: currentSessionId };
        } catch (error) {
            console.error('Error starting new session:', error);
            return { success: false, error: error.message };
        }
    });

    register('update-google-search-setting', async (event, enabled) => {
        try {
            console.log('Google Search setting updated to:', enabled);
            // The setting is already saved in localStorage by the renderer
            // This is just for logging/confirmation
            return { success: true };
        } catch (error) {
            console.error('Error updating Google Search setting:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    initializeGeminiSession,
    getEnabledTools,
    getStoredSetting,
    sendToRenderer,
    initializeNewSession,
    saveConversationTurn,
    getCurrentSessionData,
    killExistingSystemAudioDump,
    startMacOSAudioCapture,
    convertStereoToMono,
    stopMacOSAudioCapture,
    sendAudioToGemini,
    sendImageToGeminiHttp,
    setupGeminiIpcHandlers,
    formatSpeakerResults,
};
