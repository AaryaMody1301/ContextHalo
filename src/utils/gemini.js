const { GoogleGenAI, Modality } = require('@google/genai');
const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const { getSystemPrompt } = require('./prompts');
const { getAvailableModel, incrementLimitCount, getApiKey, getGroqApiKey, incrementCharUsage, getConfig, getPreferences } = require('../storage');
const { connectCloud, sendCloudAudio, sendCloudText, sendCloudImage, closeCloud, isCloudActive, setOnTurnComplete } = require('./cloud');
const { startTransportLog, logTransportEvent, closeTransportLog } = require('./transportLogger');
const { listProviderModels } = require('./providerModelRegistry');
const { randomUUID, createHash } = require('node:crypto');
const { setTimeout: sleep } = require('node:timers/promises');
const { emitLiveTranscript, extractGeminiTranscript, tuneLiveSystemInstruction } = require('./realtimeContextMain');
const { augmentGenerateParams, augmentLiveTextPayload, retrieveContext, appendContextToInstruction } = require('./knowledgeRagMain');
const { readSseJson } = require('./sse');
const { appendSessionPack } = require('./sessionPackMain');
const { runSessionRequest, resetSessionRequests, closeSessionRequests, cancelSessionRequests, requestIsCurrent,
    assertCurrentRequest, getRequestMetadata, getRequestSignal } = require('./sessionRequests');
let liveGeneration = 0;
let reconnectPromise = null;
let initializePromise = null;
let liveController = new AbortController();
let mainSessionActive = false;
let providerUiEpoch;
let lastGeminiFailure = null;
let searchState = { requested: false, effective: false, status: 'off' };
const geminiCooldowns = new Map();


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
const MAX_RECONNECT_ATTEMPTS = 2;

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

function saveConversationTurn(transcription, aiResponse, grounding) {
    if (!requestIsCurrent()) return;
    if (!currentSessionId) {
        initializeNewSession();
    }

    const conversationTurn = {
        timestamp: Date.now(),
        transcription: transcription.trim(),
        ai_response: aiResponse.trim(),
        ...(grounding ? { grounding } : {}),
    };

    conversationHistory.push(conversationTurn);


    // Send to renderer to save in IndexedDB
    sendToRenderer('save-conversation-turn', {
        sessionId: currentSessionId,
        turn: conversationTurn,
        fullHistory: conversationHistory,
    });
}

function saveScreenAnalysis(prompt, response, model, grounding) {
    if (!requestIsCurrent()) return;
    if (!currentSessionId) {
        initializeNewSession();
    }

    const analysisEntry = {
        timestamp: Date.now(),
        prompt: prompt,
        response: response.trim(),
        model: model,
        ...(grounding ? { grounding } : {}),
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

// Search is a session policy, not a preference read on every request. Explicit
// fallback changes all three Gemini paths and never changes the saved preference.
function configureSearch(provider, override) {
    const requested = getPreferences().googleSearchEnabled === true;
    const effective = provider === 'byok' && requested && override !== false;
    searchState = { requested, effective, status: provider !== 'byok' ? 'not-supported'
        : effective ? 'pending' : requested ? 'user-disabled' : 'off' };
    sendToRenderer('search-state', { ...searchState });
}

async function getEnabledTools() {
    return searchState.effective ? [{ googleSearch: {} }] : [];
}

function publishProviderState(state, error = null) {
    sendToRenderer('provider-state', { state, provider: currentProviderMode, error,
        search: { ...searchState }, uiEpoch: providerUiEpoch });
}

function geminiErrorObject(value) {
    let parsed = value;
    const message = typeof value === 'string' ? value : value?.message;
    if (typeof message === 'string') {
        try { parsed = JSON.parse(message.slice(message.indexOf('{'))); } catch {}
    }
    return parsed?.error && typeof parsed.error === 'object' ? parsed.error : parsed || {};
}

// Never return arbitrary provider messages/headers to diagnostics: these can
// contain request URLs, credentials, or parts of a confidential prompt.
function classifyGeminiFailure(error, operation = 'live', model = '', now = Date.now()) {
    if (error?.failure) return { ...error.failure, operation, model };
    const detail = geminiErrorObject(error);
    const text = [detail?.message, detail?.status, detail?.code, error?.message, error?.reason]
        .filter(value => typeof value === 'string').join(' ').slice(0, 32000).toLowerCase();
    const number = [error?.status, error?.statusCode, detail?.code, error?.code]
        .map(Number).find(value => value >= 400 && value <= 599);
    const httpStatus = number || Number(text.match(/\b(400|401|403|404|408|429|500|502|503|504)\b/)?.[1]) || null;
    const socketCode = Number(error?.code) >= 1000 && Number(error?.code) <= 4999 ? Number(error.code) : null;
    const details = Array.isArray(detail.details) ? detail.details : [];
    const quotaText = JSON.stringify(details.filter(item => /QuotaFailure/.test(item?.['@type'] || ''))).toLowerCase();
    const combined = text + quotaText;
    const headers = error?.headers || error?.response?.headers;
    const retryHeader = headers?.get?.('retry-after') ?? headers?.['retry-after'];
    let retryAfterMs = null;
    if (retryHeader !== undefined && retryHeader !== null && String(retryHeader).trim()) {
        const seconds = Number(retryHeader);
        if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = Math.ceil(seconds * 1000);
        else if (Number.isFinite(Date.parse(retryHeader))) retryAfterMs = Math.max(0, Date.parse(retryHeader) - now);
    }
    for (const item of details) {
        if (!/RetryInfo/.test(item?.['@type'] || '')) continue;
        const duration = item.retryDelay;
        const seconds = typeof duration === 'string' && /^\d+(?:\.\d+)?s$/.test(duration)
            ? Number(duration.slice(0, -1))
            : typeof duration === 'object' ? Number(duration.seconds || 0) + Number(duration.nanos || 0) / 1e9 : NaN;
        if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = Math.max(retryAfterMs || 0, Math.ceil(seconds * 1000));
    }
    const cancelled = error?.name === 'AbortError' && !/timed?\s*out|timeout/i.test(text);
    const quota = /quota_exceeded|per.?day|daily|per.?month|monthly|limit[: =]+0\b/.test(combined);
    const throttled = /rate_limit_exceeded|per.?minute|per.?second|requestsperminute|tokensperminute/.test(combined);
    const searchRelated = /google.?search|grounding/.test(combined);
    let category = 'unknown';
    if (cancelled) category = 'cancelled';
    else if (httpStatus === 401 || /unauthenticated|api.?key.?invalid|api key not valid/.test(text)) category = 'authentication';
    else if (httpStatus === 403 || /permission_denied|forbidden/.test(text)) category = 'permission';
    else if (httpStatus === 429 || /resource[_ -]?exhausted|quota_exceeded|rate_limit_exceeded/.test(text)) {
        category = quota ? 'quota-exhausted' : throttled || retryAfterMs !== null ? 'throttled' : 'rate-or-quota';
    } else if (httpStatus === 404 || /model_not_found|model.+not found/.test(text)) category = 'model-unavailable';
    else if ((httpStatus === 400 || socketCode === 1007 || socketCode === 1008) && /tool|google.?search|grounding/.test(text)) category = 'unsupported-tool';
    else if (httpStatus === 400 || socketCode === 1007 || socketCode === 1008) category = 'invalid-configuration';
    else if ([408, 500, 502, 503, 504].includes(httpStatus) || [1006, 1011, 1012, 1013].includes(socketCode)
        || /network|fetch failed|econnreset|socket|unavailable|timed?\s*out|timeout/.test(text)) category = 'transient';
    else if (/empty|no text/.test(text)) category = 'empty-response';
    const messages = {
        authentication: 'Gemini authentication failed. Check the API key in Home; it has not been changed.',
        permission: 'Gemini denied access. Check API-key restrictions, project access and the selected model in Settings.',
        'quota-exhausted': 'Gemini project quota is exhausted. Wait for the project quota reset or review usage in Google AI Studio. Turning Search off does not bypass model quotas.',
        throttled: 'Gemini temporarily throttled this request. Wait before retrying; your session and draft are retained.',
        'rate-or-quota': 'Gemini returned 429 without enough detail to distinguish throttling from exhausted quota. Check project usage before retrying.',
        'model-unavailable': 'The configured Gemini model is unavailable to this project. Select a supported model in Home; your saved model has not been changed.',
        'unsupported-tool': 'Gemini rejected the configured tool/model combination. Review model capabilities, or explicitly continue this session without Search.',
        'invalid-configuration': 'Gemini rejected the session configuration. Review the selected model and API project settings.',
        transient: 'Gemini could not complete the request because of a network, timeout or server failure. Retry when connectivity recovers.',
        cancelled: 'Request cancelled.',
        'empty-response': 'Gemini returned no text. Review the prompt or model safety settings, then retry.',
        unknown: 'Gemini could not complete the request. Review provider settings and retry. No provider or account was changed.',
    };
    const retryable = ['throttled', 'transient'].includes(category);
    const retryAt = retryAfterMs === null ? null : now + retryAfterMs;
    return { category, httpStatus, socketCode, operation, model: String(model).slice(0, 160), retryable,
        retryAfterMs, retryAt, canDisableSearch: category === 'unsupported-tool' || searchRelated && ['quota-exhausted', 'throttled', 'rate-or-quota'].includes(category),
        message: messages[category] + (retryAfterMs === null ? '' : ` Provider retry delay: ${Math.ceil(retryAfterMs / 1000)} seconds.`) };
}

function failureError(failure) {
    return Object.assign(new Error(failure.message), { failure, name: failure.category === 'cancelled' ? 'AbortError' : 'GeminiRequestError' });
}

function cooldownKey(apiKey, model) {
    return createHash('sha256').update(apiKey).digest('hex') + ':' + model;
}

// The only Gemini retry owner. SDK retries are disabled in every owned call.
// A provider delay longer than the request budget is surfaced, never shortened.
async function runGeminiRequest(work, { operation, model, apiKey = '', signal, budgetMs = 55000,
    now = Date.now, random = Math.random, wait = sleep } = {}) {
    const started = now();
    const key = cooldownKey(apiKey, model || '');
    const cooling = geminiCooldowns.get(key);
    if (cooling?.retryAt > now()) throw failureError(cooling);
    geminiCooldowns.delete(key);
    for (const [storedKey, failure] of geminiCooldowns) if (!(failure.retryAt > now())) geminiCooldowns.delete(storedKey);
    // Bound metadata-only account/model cooldowns; the API key is never retained here.
    while (geminiCooldowns.size > 64) geminiCooldowns.delete(geminiCooldowns.keys().next().value);
    for (let attempt = 0; attempt < 2; attempt++) {
        signal?.throwIfAborted();
        try {
            const result = await work(Math.max(1, budgetMs - (now() - started)), attempt);
            signal?.throwIfAborted();
            return result;
        } catch (error) {
            if (signal?.aborted) throw signal.reason;
            const failure = classifyGeminiFailure(error, operation, model, now());
            const backoff = failure.retryAfterMs ?? Math.round(600 * 2 ** attempt + random() * 300);
            // A final short-term failure also gates rapid user actions/reconnects.
            if (failure.retryable && failure.retryAt === null) failure.retryAt = now() + backoff;
            if (failure.retryAt > now()) geminiCooldowns.set(key, failure);
            logTransportEvent('gemini.request.failure', { model, operation, category: failure.category,
                status: failure.httpStatus || 0, code: failure.socketCode || 0, retryAfterMs: failure.retryAfterMs ?? -1,
                attempt: attempt + 1, durationMs: now() - started });
            if (!failure.retryable || attempt === 1 || now() - started + backoff + 1000 >= budgetMs) throw failureError(failure);
            sendToRenderer('update-status', `Gemini is retrying once after ${Math.ceil(backoff / 1000)} seconds. Search settings are unchanged.`);
            await wait(backoff, undefined, { signal });
            geminiCooldowns.delete(key);
        }
    }
}

function groundingFromResponse(response) {
    const value = response?.candidates?.[0]?.groundingMetadata || response?.serverContent?.groundingMetadata || response?.groundingMetadata;
    if (!value || typeof value !== 'object') return undefined;
    // Keep provider attribution, queries and citation offsets in response/history,
    // not logs. The renderer isolates provider HTML in a scriptless sandbox.
    const sources = (value.groundingChunks || []).slice(0, 64).map(chunk => {
        try {
            const url = new URL(chunk?.web?.uri);
            if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
            return { uri: url.href, title: String(chunk.web.title || url.hostname).slice(0, 500) };
        } catch { return null; }
    });
    return { sources, supports: (value.groundingSupports || []).slice(0, 256),
        queries: (value.webSearchQueries || []).slice(0, 32).map(query => String(query).slice(0, 1000)),
        renderedContent: String(value.searchEntryPoint?.renderedContent || '').slice(0, 128000) };
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
    return classifyGeminiFailure(error).message;
}

async function getGeminiLivePreflightError(apiKey, liveModel) {
    try {
        const catalog = await listProviderModels('gemini', apiKey);
        if (!catalog?.stale && catalog?.live?.length && !catalog.live.some(model => model.id === liveModel)) {
            return Object.assign(new Error('Configured model not found in Live catalog'), { status: 404 });
        }
    } catch (error) {
        if ([401, 403].includes(classifyGeminiFailure(error).httpStatus)) return error;
        // Discovery is advisory. Its outage must not force a model change.
    }
    return null;
}

function connectGeminiLiveWithGuard(client, params, timeoutMs = 15000, signal) {
    let setupFinished = false;
    let abandoned = false;
    let timer;
    let onAbort;
    let rejectEarly;
    const earlyFailure = new Promise((_, reject) => { rejectEarly = reject; });
    const callbacks = params.callbacks || {};
    const fail = value => {
        const error = Object.assign(new Error(value?.reason || value?.message || 'Live socket closed during setup'),
            { code: value?.code, status: value?.status, headers: value?.headers });
        rejectEarly(error);
    };
    const wrappedCallbacks = {
        ...callbacks,
        onerror(event) { if (!abandoned) callbacks.onerror?.(event); if (!setupFinished) fail(event); },
        onclose(event) { if (!abandoned) callbacks.onclose?.(event); if (!setupFinished) fail(event); },
        onmessage(event) { if (!abandoned) callbacks.onmessage?.(event); },
        onopen(event) { if (!abandoned) callbacks.onopen?.(event); },
    };
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Gemini Live setup timed out')), timeoutMs);
        onAbort = () => reject(signal.reason || Object.assign(new Error('Live setup cancelled'), { name: 'AbortError' }));
        if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
    });
    return Promise.race([
        Promise.resolve().then(() => {
            signal?.throwIfAborted();
            return client.live.connect({ ...params, callbacks: wrappedCallbacks });
        }).then(session => {
            if (abandoned || signal?.aborted) { session.close(); throw Object.assign(new Error('Live setup cancelled'), { name: 'AbortError' }); }
            return session;
        }), earlyFailure, deadline,
    ]).then(session => { setupFinished = true; return session; }, error => {
        abandoned = true;
        setupFinished = true;
        throw error;
    }).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); });
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
            console.warn('Groq transcription error:');
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
        console.warn('Groq audio transcription failed:');
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

    let requestHistory = [...groqConversationHistory];
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
            console.warn('Groq API error:');
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
        console.warn('Error calling Groq API:');
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
            console.warn('Groq image API error:');
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
        console.warn('Error calling Groq image API:');
        logTransportEvent('groq.image.error', {
            error: error.message,
            stack: error.stack,
        });
        return { success: false, error: error.message };
    }
}

async function initializeGeminiSession(apiKey, customPrompt = '', profile = 'interview', language = 'en-US', isReconnect = false) {
    if (isInitializingSession) return null;
    const generation = liveGeneration;
    const signal = liveController.signal;
    isInitializingSession = true;
    if (!isReconnect) {
        geminiSessionResumptionHandle = null;
        sessionParams = { apiKey, customPrompt, profile, language, provider: 'byok' };
        reconnectAttempts = 0;
    }
    let liveSessionReady = false;
    let liveResponseId = randomUUID();
    let modelTextBuffer = '';
    let audioTextBuffer = '';
    let liveGrounding;
    const liveModel = String(getConfig().geminiLiveModel || 'gemini-3.1-flash-live-preview').replace(/^models\//, '').trim();
    const current = () => generation === liveGeneration && !signal.aborted;
    currentSystemPrompt = getSystemPrompt(profile, customPrompt, searchState.effective);
    let instruction = tuneLiveSystemInstruction(appendSessionPack(currentSystemPrompt), getPreferences().responseMode);
    instruction = appendContextToInstruction(instruction, retrieveContext('', { limit: 4, maxChars: 6500 }));
    publishProviderState(isReconnect ? 'reconnecting' : 'connecting');
    try {
        if (!isReconnect) {
            const preflight = await getGeminiLivePreflightError(apiKey, liveModel);
            signal.throwIfAborted();
            if (preflight) throw preflight;
        }
        const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1beta', retryOptions: { attempts: 1 } } });
        const callbacks = {
            onopen() { if (current()) sendToRenderer('update-status', 'Gemini connected; preparing the session...'); },
            onmessage(message) {
                if (!current()) return;
                const interim = extractGeminiTranscript(message, 'interimInputTranscription');
                const finalText = extractGeminiTranscript(message, 'inputTranscription');
                if (interim) emitLiveTranscript({ provider: 'gemini', text: interim, final: false, timestamp: Date.now() });
                if (finalText) {
                    emitLiveTranscript({ provider: 'gemini', text: finalText, final: true, timestamp: Date.now() });
                    currentTranscription += message.serverContent?.inputTranscription?.text || finalText;
                }
                const grounding = groundingFromResponse(message);
                if (grounding) {
                    liveGrounding = grounding;
                    if (messageBuffer) sendToRenderer('update-response', messageBuffer, { requestId: liveResponseId, kind: 'voice', grounding });
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
                            { requestId: liveResponseId, kind: 'voice', grounding: liveGrounding });
                    }
                    const resumeHandle = message.sessionResumptionUpdate?.newHandle;
                    if (resumeHandle) geminiSessionResumptionHandle = resumeHandle;
                    // generationComplete can precede the final transcription. Save
                    // once at turnComplete (or interruption), not at generationComplete.
                    if (content.turnComplete || content.interrupted) {
                        if (currentTranscription.trim() && messageBuffer.trim()) {
                            saveConversationTurn(currentTranscription, messageBuffer, liveGrounding);
                        }
                        currentTranscription = '';
                        messageBuffer = '';
                        modelTextBuffer = '';
                        audioTextBuffer = '';
                        liveGrounding = undefined;
                        liveResponseId = randomUUID();
                        sendToRenderer('update-status', content.interrupted ? 'Response interrupted' : 'Gemini ready');
                    }

            },
            onerror(error) {
                if (!current() || !liveSessionReady) return;
                lastGeminiFailure = classifyGeminiFailure(error, 'live', liveModel);
                publishProviderState('failed', lastGeminiFailure);
            },
            onclose(event) {
                if (!current() || !liveSessionReady || isUserClosing) return;
                global.geminiSessionRef.current = null;
                lastGeminiFailure = classifyGeminiFailure(event, 'live', liveModel);
                if (lastGeminiFailure.retryAt > Date.now()) {
                    geminiCooldowns.set(cooldownKey(apiKey, liveModel), lastGeminiFailure);
                }
                publishProviderState('failed', lastGeminiFailure);
                if (lastGeminiFailure.retryable && reconnectAttempts < MAX_RECONNECT_ATTEMPTS && !reconnectPromise) {
                    reconnectAttempts++;
                    reconnectPromise = attemptReconnect().finally(() => { reconnectPromise = null; });
                }
            },
        };
        const tools = await getEnabledTools();
        const session = await runGeminiRequest(remaining => connectGeminiLiveWithGuard(client, {
            model: liveModel, callbacks,
            config: { responseModalities: [Modality.AUDIO], inputAudioTranscription: {}, outputAudioTranscription: {},
                systemInstruction: instruction, ...(tools.length ? { tools } : {}) },
        }, Math.min(15000, remaining), signal), { operation: 'live', model: liveModel, apiKey, signal, budgetMs: 35000 });
        if (!current()) { session.close(); return null; }
        liveSessionReady = true;
        if (!isReconnect) initializeNewSession(profile, customPrompt);
        lastGeminiFailure = null;
        lastGeminiInitializationError = '';
        searchState = { ...searchState, status: searchState.effective ? 'enabled' : searchState.status };
        publishProviderState('ready');
        return session;
    } catch (error) {
        if (!current()) return null;
        lastGeminiFailure = classifyGeminiFailure(error, 'live', liveModel);
        lastGeminiInitializationError = lastGeminiFailure.message;
        publishProviderState('failed', lastGeminiFailure);
        sendToRenderer('update-status', lastGeminiInitializationError);
        return null;
    } finally {
        if (generation === liveGeneration) {
            isInitializingSession = false;
            sendToRenderer('session-initializing', false);
        }
    }
}

async function attemptReconnect() {
    const params = sessionParams;
    if (!params?.apiKey || isUserClosing) return false;
    liveGeneration++;
    liveController.abort();
    liveController = new AbortController();
    isInitializingSession = false;
    const generation = liveGeneration;
    messageBuffer = '';
    currentTranscription = '';
    const model = String(getConfig().geminiLiveModel || 'gemini-3.1-flash-live-preview').replace(/^models\//, '').trim();
    const cooling = geminiCooldowns.get(cooldownKey(params.apiKey, model));
    if (cooling?.retryAt > Date.now()) {
        const delay = cooling.retryAt - Date.now();
        if (delay > 15000) { lastGeminiFailure = cooling; publishProviderState('failed', cooling); return false; }
        publishProviderState('reconnecting', cooling);
        try { await sleep(delay, undefined, { signal: liveController.signal }); }
        catch { return false; }
    }
    if (generation !== liveGeneration || isUserClosing) return false;
    const session = await initializeGeminiSession(params.apiKey, params.customPrompt, params.profile, params.language, true);
    if (!session || generation !== liveGeneration || isUserClosing) return false;
    global.geminiSessionRef.current = session;
    const contextMessage = buildContextMessage();
    if (contextMessage) {
        try { await session.sendRealtimeInput(augmentLiveTextPayload({ text: contextMessage })); }
        catch { sendToRenderer('update-status', 'Connected, but restoring Live context failed. Typed answers still retain session history.'); }
    }
    return true;
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
            }
        }

        const maxBufferSize = SAMPLE_RATE * BYTES_PER_SAMPLE * 1;
        if (audioBuffer.length > maxBufferSize) {
            audioBuffer = audioBuffer.slice(-maxBufferSize);
        }
    });

    systemAudioProc.stderr.on('data', data => {
        console.warn('SystemAudioDump stderr:');
    });

    systemAudioProc.on('close', code => {
        console.log('SystemAudioDump process closed with code:', code);
        systemAudioProc = null;
    });

    systemAudioProc.on('error', err => {
        console.warn('SystemAudioDump process error:');
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
        console.warn('Error sending audio to Gemini:');
    }
}

async function sendImageToGeminiHttp(base64Data, prompt) {
    const model = getAvailableModel();
    const apiKey = getApiKey();
    if (!apiKey) return { success: false, error: 'No Gemini API key configured' };
    try {
        const ai = new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
        const tools = await getEnabledTools();
        const response = await runGeminiRequest(remaining => ai.models.generateContent(augmentGenerateParams({
            model,
            contents: [{ inlineData: { mimeType: 'image/jpeg', data: base64Data } }, { text: prompt }],
            config: { systemInstruction: appendSessionPack(currentSystemPrompt || getSystemPrompt(currentProfile, currentCustomPrompt, searchState.effective)),
                maxOutputTokens: 4096, ...(tools.length ? { tools } : {}), abortSignal: getRequestSignal(),
                httpOptions: { timeout: Math.min(27000, remaining), retryOptions: { attempts: 1 } } },
        })), { operation: 'screen', model, apiKey, signal: getRequestSignal() });
        assertCurrentRequest();
        const text = response.text?.trim();
        if (!text) throw new Error('Empty Gemini response');
        const grounding = groundingFromResponse(response);
        sendToRenderer('new-response', text, { ...getRequestMetadata(), grounding, model });
        saveScreenAnalysis(prompt, text, model, grounding);
        incrementLimitCount(model);
        sendToRenderer('provider-request-error', null);
        return { success: true, text, model, grounding };
    } catch (error) {
        const failure = classifyGeminiFailure(error, 'screen', model);
        if (failure.category !== 'cancelled') sendToRenderer('provider-request-error', failure);
        return { success: false, error: failure.message, failure };
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
    const ai = new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
    const tools = await getEnabledTools();
    const response = await runGeminiRequest(remaining => ai.models.generateContent(augmentGenerateParams({
        model,
        contents: [...history, { role: 'user', parts: [{ text }] }],
        config: { systemInstruction: instruction, maxOutputTokens: 4096, ...(tools.length ? { tools } : {}),
            httpOptions: { timeout: Math.min(27000, remaining), retryOptions: { attempts: 1 } }, abortSignal: getRequestSignal() },
    })), { operation: 'text', model, apiKey, signal: getRequestSignal() });
    assertCurrentRequest();
    const answer = response.text?.trim();
    if (!answer) throw new Error('Gemini returned no text. Check model availability and safety feedback, then retry.');
    const grounding = groundingFromResponse(response);
    sendToRenderer('new-response', answer, { ...getRequestMetadata(), grounding, model });
    sendToRenderer('provider-request-error', null);
    saveConversationTurn(text, answer, grounding);
    incrementLimitCount(model);
    return { success: true, text: answer, model, grounding };
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
        const initializing = channel.startsWith('initialize-');
        if (initializing && initializePromise && !liveController.signal.aborted) return initializePromise;
        if (initializing && initializePromise) await initializePromise.catch(() => {});
        if (initializing && mainSessionActive) return { success: true, provider: currentProviderMode, search: { ...searchState }, alreadyActive: true };
        const execute = async () => {
            if (initializing) {
                liveGeneration++;
                liveController.abort();
                liveController = new AbortController();
                isUserClosing = false;
                isInitializingSession = false;
                resetSessionRequests();
                const mode = channel === 'initialize-local' ? 'local' : channel === 'initialize-cloud' ? 'cloud' : args[4] === 'groq' ? 'groq' : 'byok';
                require('./windowsRuntimeMain').prepareWindowsProvider(mode);
                require('./runtimeHardeningMain').prepareRuntimeProvider(mode);
            }
            const generation = liveGeneration;
            try {
                const result = await handler(event, ...args);
                if (initializing && generation !== liveGeneration) return { success: false, error: 'Session start cancelled' };
                if (initializing) {
                    mainSessionActive = result === true || result?.success === true;
                    if (!mainSessionActive) closeSessionRequests();
                }
                return result;
            } catch (error) {
                if (initializing && generation === liveGeneration) { closeSessionRequests(); isInitializingSession = false; }
                if (currentProviderMode === 'byok' && ['send-text-message', 'send-image-content'].includes(channel)) {
                    const failure = classifyGeminiFailure(error, channel === 'send-text-message' ? 'text' : 'screen', getAvailableModel());
                    if (failure.category !== 'cancelled') sendToRenderer('provider-request-error', failure);
                    return { success: false, error: failure.message, failure };
                }
                return { success: false, error: error?.message || 'Request failed' };
            }
        };
        if (!initializing) return execute();
        const operation = execute().finally(() => { if (initializePromise === operation) initializePromise = null; });
        initializePromise = operation;
        return operation;
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
            console.warn('[Cloud] Init error:');
            currentProviderMode = 'byok';
            sendToRenderer('session-initializing', false);
            return false;
        }
    });

    register('initialize-gemini', async (event, apiKey, customPrompt, profile = 'interview', language = 'en-US', provider = 'byok', options = {}) => {
        if (!options || typeof options !== 'object' || (options.searchEnabled !== undefined && typeof options.searchEnabled !== 'boolean')
            || (options.uiEpoch !== undefined && !Number.isSafeInteger(options.uiEpoch))) return { success: false, error: 'Invalid session options' };
        providerUiEpoch = options.uiEpoch;
        configureSearch(provider === 'groq' ? 'groq' : 'byok', options.searchEnabled);
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
            currentSystemPrompt = getSystemPrompt(profile, customPrompt, false);
            initializeNewSession(profile, customPrompt);
            sessionParams = { language, profile, customPrompt, provider: 'groq' };
            reconnectAttempts = 0;
            groqSystemAudioBuffer = Buffer.alloc(0);
            sendToRenderer('update-status', 'Groq ready');
            publishProviderState('ready');
            return { success: true, provider: 'groq', search: { ...searchState } };
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
            return { success: true, provider: 'gemini', search: { ...searchState } };
        }
        return { success: false, error: lastGeminiInitializationError || 'Gemini session could not be initialized.', failure: lastGeminiFailure, search: { ...searchState } };
    });

    register('initialize-local', async (event, localLlmModel, whisperModel, profile, customPrompt, language = 'en-US', options = {}) => {
        providerUiEpoch = Number.isSafeInteger(options?.uiEpoch) ? options.uiEpoch : undefined;
        configureSearch('local');
        currentProviderMode = 'local';
        const success = await getLocalAi().initializeLocalSession(localLlmModel, whisperModel, profile, customPrompt, language);
        if (!success) {
            currentProviderMode = 'byok';
        }
        return { success: success === true, provider: 'local', search: { ...searchState } };
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
                console.warn('Error sending cloud audio:');
                return { success: false, error: error.message };
            }
        }
        if (currentProviderMode === 'local') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                getLocalAi().processLocalAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.warn('Error sending local audio:');
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
            console.warn('Error sending system audio:');
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
                console.warn('Error sending cloud mic audio:');
                return { success: false, error: error.message };
            }
        }
        if (currentProviderMode === 'local') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                getLocalAi().processLocalAudio(pcmBuffer);
                return { success: true };
            } catch (error) {
                console.warn('Error sending local mic audio:');
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
            console.warn('Error sending mic audio:');
            return { success: false, error: error.message };
        }
    });

    register('cancel-screen-analysis', async () => {
        cancelSessionRequests('screen');
        require('./contextCaptureMain').cancelRegionSelection();
        return { success: true };
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
            console.warn('Error sending image:');
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
            console.warn('Error starting macOS audio capture:');
            return { success: false, error: error.message };
        }
    });

    register('stop-macos-audio', async event => {
        try {
            stopMacOSAudioCapture();
            return { success: true };
        } catch (error) {
            console.warn('Error stopping macOS audio capture:');
            return { success: false, error: error.message };
        }
    });

    register('close-session', async event => {
        liveGeneration += 1;
        liveController.abort(Object.assign(new Error('Session ended'), { name: 'AbortError' }));
        isInitializingSession = false;
        mainSessionActive = false;
        isUserClosing = true;
        sessionParams = null;
        currentTranscription = '';
        messageBuffer = '';
        closeSessionRequests();
        require('./contextCaptureMain').cancelRegionSelection();
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
            console.warn('Error closing session:');
            return { success: false, error: error.message };
        }
    });

    // Conversation history IPC handlers
    register('get-current-session', async event => {
        try {
            return { success: true, data: getCurrentSessionData() };
        } catch (error) {
            console.warn('Error getting current session:');
            return { success: false, error: error.message };
        }
    });

    register('start-new-session', async event => {
        try {
            initializeNewSession();
            return { success: true, sessionId: currentSessionId };
        } catch (error) {
            console.warn('Error starting new session:');
            return { success: false, error: error.message };
        }
    });

    register('retry-session-connection', async (_event, options = {}) => {
        if (!options || typeof options !== 'object' || typeof options.withoutSearch !== 'boolean') return { success: false, error: 'Invalid recovery options' };
        if (currentProviderMode !== 'byok' || !sessionParams?.apiKey || !mainSessionActive) return { success: false, error: 'No Gemini session to reconnect' };
        if (reconnectPromise) return reconnectPromise.then(success => ({ success, failure: lastGeminiFailure, search: { ...searchState } }));
        const model = String(getConfig().geminiLiveModel || 'gemini-3.1-flash-live-preview').replace(/^models\//, '').trim();
        const cooldown = geminiCooldowns.get(cooldownKey(sessionParams.apiKey, model));
        if (cooldown?.retryAt > Date.now()) return { success: false, error: cooldown.message, failure: cooldown };
        liveGeneration++;
        liveController.abort();
        liveController = new AbortController();
        isInitializingSession = false;
        if (geminiSessionRef.current) { geminiSessionRef.current.close(); geminiSessionRef.current = null; }
        if (options.withoutSearch) {
            searchState = { ...searchState, effective: false, status: 'user-disabled' };
            currentSystemPrompt = getSystemPrompt(currentProfile, currentCustomPrompt, false);
            sendToRenderer('search-state', { ...searchState });
        }
        // Do not reset history, drafts, capture, HTTP epochs or provider identity.
        reconnectPromise = attemptReconnect().finally(() => { reconnectPromise = null; });
        const success = await reconnectPromise;
        return { success, error: success ? undefined : lastGeminiFailure?.message, failure: lastGeminiFailure, search: { ...searchState } };
    });

}

module.exports = {
    initializeGeminiSession,
    getEnabledTools,
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
    classifyGeminiFailure, runGeminiRequest, connectGeminiLiveWithGuard, groundingFromResponse, configureSearch,
    formatSpeakerResults,
};
