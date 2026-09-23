const { abortable, deadlineSignal } = require('./requestDeadline');
const { GoogleGenAI, Modality } = require('@google/genai');
const { BrowserWindow, ipcMain } = require('electron');
const { getSystemPrompt } = require('./prompts');
const { getAvailableModel, incrementLimitCount, getApiKey, getGroqApiKey, incrementCharUsage, getConfig, getPreferences } = require('../storage');
const { startTransportLog, logTransportEvent, closeTransportLog } = require('./transportLogger');
const { listProviderModels } = require('./providerModelRegistry');
const { randomUUID, createHash } = require('node:crypto');
const { setTimeout: sleep } = require('node:timers/promises');
const { emitLiveTranscript, extractGeminiTranscript, tuneLiveSystemInstruction } = require('./realtimeContextMain');
const { augmentGenerateParams, augmentLiveTextPayload, retrieveContext, appendContextToInstruction } = require('./knowledgeRagMain');
const { readSseJson } = require('./sse');
const { getResponseMode } = require('./realtimeContextCore');
const { buildGroqMessages, getGroqReasoningOptions } = require('./groqRequestPolicy');
const { appendSessionPack } = require('./sessionPackMain');
const { runSessionRequest, resetSessionRequests, closeSessionRequests, cancelSessionRequests, requestIsCurrent,
    assertCurrentRequest, getRequestMetadata, getRequestSignal } = require('./sessionRequests');
const { createGeminiLiveRuntime } = require('./geminiLiveRuntime');
const { SCREEN_PROVIDER_BUDGET_MS, SCREEN_SESSION_TIMEOUT_MS, screenThinkingConfig } = require('./geminiScreenReliability');
const { classifyGeminiFailure } = require('./geminiFailure');
const { recoverGeminiSetup } = require('./geminiSetupRecovery');
const { groundingFragmentFromResponse, mergeGrounding, publicGrounding } = require('./geminiGrounding');
const { appendModelParts, modelPartsForHistory } = require('./geminiWorkingContext');
let liveGeneration = 0;
let manualReconnectPromise = null;
let initializePromise = null;
let liveController = new AbortController();
let mainSessionActive = false;
let providerUiEpoch;
let lastGeminiFailure = null;
let searchState = { requested: false, liveEffective: false, httpEffective: false, status: 'off', liveReason: '', httpReason: '' };
let liveSetupCompatibility = false;
const geminiCooldowns = new Map();


// Lazy-loaded to avoid circular dependency (localai.js imports from gemini.js)
let _localai = null;
function getLocalAi() {
    if (!_localai) _localai = require('./localai');
    return _localai;
}

// Provider mode: 'byok', 'groq', or 'local'
let currentProviderMode = 'byok';

// Groq conversation history for context
let groqConversationHistory = [];

// Conversation tracking variables
let currentSessionId = null;
let currentTranscription = '';
let conversationHistory = [];
let screenAnalysisHistory = [];
let geminiTurnModelParts = new WeakMap();
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
let messageBuffer = '';

const GROQ_MAX_COMPLETION_TOKENS = 2048;
const GROQ_MAX_HISTORY_MESSAGES = 8;
const GROQ_MAX_HISTORY_CHARS = 12000;
const GROQ_MAX_SYSTEM_PROMPT_CHARS = 6000;
const GROQ_AUDIO_CHUNK_SECONDS = 8;
const LIVE_RECONNECT_CONTEXT_MAX_CHARS = 16000;
const LIVE_RECONNECT_TURN_PART_MAX_CHARS = 2500;
let groqSystemAudioBuffer = Buffer.alloc(0);
let groqTranscriptionInFlight = false;
let groqRateLimitState = null;
let geminiLiveRuntime = null;
let lastGeminiInitializationError = '';
const GROQ_EMPTY_RESPONSE_MESSAGE =
    'Groq reached the maximum completion-token limit before returning a final answer. Disable thinking in Home → AI responses and try again.';

// Reconnection variables
let isUserClosing = false;
let sessionParams = null;

function sendToRenderer(channel, data, metadata = getRequestMetadata()) {
    metadata = { uiEpoch: providerUiEpoch, ...metadata };
    if (!requestIsCurrent()) return;
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        if (!windows[0].isDestroyed()) windows[0].webContents.send(channel, data, metadata);
    }
}

// Build context message for session restoration
function buildContextMessage() {
    const header = "Session reconnected. Here's the recent conversation:";
    const footer = 'Continue from here.';
    const blocks = [];
    let chars = header.length + footer.length + 4;

    // Replay only recent bounded context when a provider resumption handle is not
    // available. Full history remains persisted locally for History.
    for (let index = conversationHistory.length - 1; index >= 0 && blocks.length < 20; index--) {
        const turn = conversationHistory[index];
        if (turn?.grounded === true) continue;
        const transcription = String(turn?.transcription || '').trim();
        const answer = String(turn?.ai_response || '').trim();
        if (!transcription || !answer) continue;
        const clippedQuestion = transcription.slice(0, LIVE_RECONNECT_TURN_PART_MAX_CHARS);
        const clippedAnswer = answer.slice(0, LIVE_RECONNECT_TURN_PART_MAX_CHARS);
        const block = `[Interviewer]: ${clippedQuestion}\n[Your answer]: ${clippedAnswer}`;
        if (blocks.length && chars + block.length + 2 > LIVE_RECONNECT_CONTEXT_MAX_CHARS) break;
        blocks.unshift(block);
        chars += block.length + 2;
    }

    if (!blocks.length) return null;
    return `${header}\n\n${blocks.join('\n\n')}\n\n${footer}`;
}

// Conversation management functions
function initializeNewSession(profile = null, customPrompt = null) {
    currentSessionId = String(Math.max(Date.now(), Number(currentSessionId || 0) + 1));
    messageBuffer = '';
    startTransportLog(currentSessionId);
    currentTranscription = '';
    conversationHistory = [];
    screenAnalysisHistory = [];
    geminiTurnModelParts = new WeakMap();
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

function saveConversationTurn(transcription, aiResponse, grounding, modelParts) {
    if (!requestIsCurrent()) return;
    if (!currentSessionId) {
        initializeNewSession();
    }

    const timestamp = Date.now();
    const grounded = Boolean(grounding);
    const conversationTurn = {
        timestamp,
        transcription: transcription.trim(),
        ai_response: aiResponse.trim(),
        ...(grounded ? { grounded: true, groundedAt: timestamp } : {}),
    };

    conversationHistory.push(conversationTurn);
    if (Array.isArray(modelParts) && modelParts.length) {
        geminiTurnModelParts.set(conversationTurn, modelPartsForHistory(modelParts));
    }

    // Persist only displayed answer text and a grounded marker. Search
    // Suggestions, queries, source Links and citation metadata remain ephemeral.
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

    const timestamp = Date.now();
    const grounded = Boolean(grounding);
    const analysisEntry = {
        timestamp,
        prompt: prompt,
        response: response.trim(),
        model: model,
        ...(grounded ? { grounded: true, groundedAt: timestamp } : {}),
    };

    screenAnalysisHistory.push(analysisEntry);

    // Provider Search metadata is active-response-only and is never written to
    // History. The displayed grounded answer text is governed by the disk
    // retention policy in storage.js.
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

// Explicit user fallback disables Search everywhere. A Live setup workaround
// applies only to Live, never to the independent HTTP text/screen API.
function configureSearch(provider, override) {
    const requested = getPreferences().googleSearchEnabled === true;
    const effective = provider === 'byok' && requested && override !== false;
    searchState = { requested, liveEffective: effective, httpEffective: effective, liveReason: '', httpReason: '', status: provider !== 'byok' ? 'not-supported'
        : effective ? 'pending' : requested ? 'user-disabled' : 'off' };
    sendToRenderer('search-state', { ...searchState });
}

function disableLiveSearchForSetupCompatibility(failure) {
    geminiLiveRuntime?.clearResumption();
    searchState = { ...searchState, liveEffective: false, status: 'live-setup-fallback',
        liveReason: ['quota-exhausted', 'rate-or-quota', 'throttled'].includes(failure.category)
            ? 'Search-enabled Live setup hit a rate or quota limit; the same model connected without Search. The exact tool quota or access cause is unconfirmed.'
            : 'Live setup succeeded without Search after a tool/configuration failure.' };
    sendToRenderer('search-state', { ...searchState });
    sendToRenderer('update-status', 'Gemini Live connected without Search. Text and screen Search and your saved preference are unchanged. See Session details.');
}

function enableLiveSetupCompatibility() {
    liveSetupCompatibility = true;
    geminiLiveRuntime?.clearResumption();
    sendToRenderer('update-status', 'Retrying with the core Live configuration after a setup failure. Reconnects will restore local conversation context.');
}

function getHttpSearchTools() {
    return searchState.httpEffective ? [{ googleSearch: {} }] : [];
}

function publishProviderState(state, error = null) {
    sendToRenderer('provider-state', { state, provider: currentProviderMode, error,
        search: { ...searchState }, uiEpoch: providerUiEpoch });
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
    now = Date.now, random = Math.random, wait = sleep, searchAttached = false } = {}) {
    const started = now();
    const httpOperation = operation === 'text' || operation === 'screen';
    // Google documents exponential backoff for transient 429/5xx failures and
    // describes up to four retries in its client guidance. Count the initial
    // request separately so HTTP operations can make at most five attempts.
    const maxAttempts = httpOperation ? 5 : 2;
    const baseKey = cooldownKey(apiKey, model || '');
    const key = searchAttached ? `${baseKey}:${httpOperation ? 'http' : 'live'}:search` : baseKey;
    const cooling = [geminiCooldowns.get(baseKey), geminiCooldowns.get(key)].find(failure => failure?.retryAt > now());
    if (cooling?.retryAt > now()) throw failureError(cooling);
    geminiCooldowns.delete(key);
    for (const [storedKey, failure] of geminiCooldowns) if (!(failure.retryAt > now())) geminiCooldowns.delete(storedKey);
    // Bound metadata-only account/model cooldowns; the API key is never retained here.
    while (geminiCooldowns.size > 64) geminiCooldowns.delete(geminiCooldowns.keys().next().value);
    const deadline = deadlineSignal(signal, budgetMs);
    const operationSignal = deadline.signal;
    try {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            operationSignal.throwIfAborted();
            if (now() - started >= budgetMs) throw failureError(classifyGeminiFailure(new Error('Provider operation timed out'), operation, model));
            try {
                const result = await abortable(() => work(Math.max(1, budgetMs - (now() - started)), attempt, operationSignal), operationSignal);
                operationSignal.throwIfAborted();
                if (now() - started >= budgetMs) throw failureError(classifyGeminiFailure(new Error('Provider operation timed out'), operation, model));
                return result;
            } catch (error) {
                if (signal?.aborted) throw signal.reason;
                if (operationSignal.aborted) throw failureError(classifyGeminiFailure(operationSignal.reason, operation, model));
                const failure = classifyGeminiFailure(error, operation, model, now(), { searchAttached });
                // Once a streaming response has rendered tokens, retrying the same
                // request would duplicate visible output. Pre-response failures keep
                // the normal bounded retry policy.
                const terminal = error?.noRetryAfterPartial || error?.noRetryAfterSearchControl;
                const localBackoff = Math.round(Math.min(10000, (httpOperation ? 1000 : 600) * 2 ** attempt)
                    + random() * (httpOperation ? 250 : 300));
                // Retry-After is a provider minimum, not permission to spin.
                // A zero/short provider delay must not defeat exponential backoff
                // during a 503 overload burst.
                const backoff = failure.retryAfterMs === null ? localBackoff : Math.max(localBackoff, failure.retryAfterMs);
                // A final short-term failure also gates rapid user actions/reconnects.
                if (failure.retryable) failure.retryAt = now() + backoff;
                if (failure.retryAt > now()) geminiCooldowns.set(failure.quotaScope === 'model' || !failure.searchAttached ? baseKey : key, failure);
                logTransportEvent('gemini.request.failure', { model, operation, category: failure.category,
                    status: failure.httpStatus || 0, code: failure.socketCode || 0, retryAfterMs: failure.retryAfterMs ?? -1,
                    attempt: attempt + 1, durationMs: now() - started, quotaScope: failure.quotaScope, searchAttached: failure.searchAttached, searchControl: failure.searchControl || '' });
                if (terminal || !failure.retryable || attempt === maxAttempts - 1 || now() - started + backoff + 1000 >= budgetMs) throw failureError(failure);
                sendToRenderer('update-status', `Gemini ${operation || 'request'} retry ${attempt + 2}/${maxAttempts} in ${Math.ceil(backoff / 1000)} seconds. Model and Search settings are unchanged.`);
                await abortable(() => wait(backoff, undefined, { signal: operationSignal }), operationSignal);
                geminiCooldowns.delete(key);
            }
        }
    } finally { deadline.close(); }
}

function groundingFromResponse(response) {
    return publicGrounding(mergeGrounding(undefined, groundingFragmentFromResponse(response)));
}

function interactiveGeminiThinkingConfig(model, modeId = 'balanced') {
    const low = screenThinkingConfig(model);
    if (!low.thinkingConfig) return {};
    return modeId === 'detailed' ? { thinkingConfig: { thinkingLevel: 'medium' } } : low;
}

async function generateGeminiStream(ai, params, requestOptions, onText) {
    return runGeminiRequest(async (remaining, _attempt, operationSignal) => {
        let text = '';
        let groundingState;
        let modelParts = [];
        let emitted = false;
        try {
            const stream = await ai.models.generateContentStream({
                ...params, config: { ...params.config, abortSignal: operationSignal,
                    httpOptions: { timeout: remaining, retryOptions: { attempts: 1 } } },
            });
            for await (const chunk of stream) {
                operationSignal.throwIfAborted();
                const piece = String(chunk?.text || '');
                groundingState = mergeGrounding(groundingState, groundingFragmentFromResponse(chunk));
                modelParts = appendModelParts(modelParts, chunk);
                const grounding = publicGrounding(groundingState);
                if (!piece) continue;
                text += piece;
                emitted = true;
                onText?.(text, grounding);
            }
            if (!text.trim()) throw new Error('Gemini returned no text. Check model availability and safety feedback, then retry.');
            return { text: text.trim(), grounding: publicGrounding(groundingState), modelParts };
        } catch (error) {
            if (emitted && error && typeof error === 'object') error.noRetryAfterPartial = true;
            throw error;
        }
    }, { ...requestOptions, searchAttached: Boolean(params.config?.tools?.some(tool => tool.googleSearch)) });
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

async function getGeminiLivePreflightError(apiKey, liveModel, signal) {
    const deadline = deadlineSignal(signal, 10000);
    try {
        const catalog = await abortable(() => listProviderModels('gemini', apiKey, { signal: deadline.signal }), deadline.signal);
        if (!catalog?.stale && catalog?.live?.length && !catalog.live.some(model => model.id === liveModel)) {
            return Object.assign(new Error('Configured model not found in Live catalog'), { status: 404 });
        }
    } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if ([401, 403].includes(classifyGeminiFailure(error).httpStatus)) return error;
        // Discovery is advisory. Its outage must not force a model change.
    } finally { deadline.close(); }
    return null;
}

function connectGeminiLiveWithGuard(client, params, timeoutMs = 15000, signal) {
    let setupFinished = false;
    let opened = false;
    let socket;
    let abandoned = false;
    let timer;
    let onAbort;
    let rejectEarly;
    const earlyFailure = new Promise((_, reject) => { rejectEarly = reject; });
    const callbacks = params.callbacks || {};
    const fail = value => {
        const error = Object.assign(new Error(value?.reason || value?.message || 'Live socket closed during setup'),
            { code: value?.code, status: value?.status, headers: value?.headers, cause: value?.error || value?.cause,
                stage: opened ? 'setup' : 'transport' });
        rejectEarly(error);
    };
    const wrappedCallbacks = {
        ...callbacks,
        onerror(event) { if (!abandoned) callbacks.onerror?.(event); if (!setupFinished) fail(event); },
        onclose(event) { if (!abandoned) callbacks.onclose?.(event); if (!setupFinished) fail(event); },
        onmessage(event) { if (!abandoned) callbacks.onmessage?.(event); },
        onopen(event) {
            opened = true;
            socket = event?.target;
            if (abandoned) { try { socket?.close(); } catch {} }
            else callbacks.onopen?.(event);
        },
    };
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Gemini Live setup timed out'), { name: 'TimeoutError', stage: opened ? 'setup' : 'transport' })), timeoutMs);
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
        // SDK connect() can stay pending forever without setupComplete. Close
        // the opened transport now, rather than waiting for a Session object.
        try { socket?.close(); } catch {}
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
                messages: buildGroqMessages(modelToUse, currentSystemPrompt, requestHistory, GROQ_MAX_SYSTEM_PROMPT_CHARS),
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
                messages: buildGroqMessages(model, currentSystemPrompt, [
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
                ], GROQ_MAX_SYSTEM_PROMPT_CHARS),
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
        geminiLiveRuntime?.stop();
        geminiLiveRuntime = null;
        // A one-session compatibility fallback must not poison later sessions.
        liveSetupCompatibility = false;
        sessionParams = { apiKey, customPrompt, profile, language, provider: 'byok' };
    }
    let liveSessionReady = false;
    let setupMessages = [];
    let liveResponseId = randomUUID();
    let modelTextBuffer = '';
    let audioTextBuffer = '';
    let liveGrounding;
    const liveModel = String(getConfig().geminiLiveModel || 'gemini-3.8-live').replace(/^models\//, '').trim();
    if (!geminiLiveRuntime) {
        geminiLiveRuntime = createGeminiLiveRuntime({
            reconnect: async details => {
                const success = await attemptReconnect(details);
                if (!success) throw failureError(lastGeminiFailure || classifyGeminiFailure(new Error('Gemini reconnect failed'), 'live', liveModel));
            },
            normalizeFailure: error => classifyGeminiFailure(error, 'live', liveModel, Date.now(), { searchAttached: searchState.liveEffective }),
            publishState(state, detail) {
                if (state === 'reconnecting') {
                    publishProviderState('reconnecting');
                    sendToRenderer('update-status', 'Gemini connection interrupted; reconnecting…');
                } else if (state === 'failed') {
                    lastGeminiFailure = detail || lastGeminiFailure;
                    publishProviderState('failed', lastGeminiFailure);
                    if (lastGeminiFailure?.message) sendToRenderer('update-status', lastGeminiFailure.message);
                }
            },
        });
    }
    const current = () => generation === liveGeneration && !signal.aborted;
    const buildInstruction = (liveSearch = searchState.liveEffective) => {
        currentSystemPrompt = getSystemPrompt(profile, customPrompt, searchState.httpEffective);
        const livePrompt = getSystemPrompt(profile, customPrompt, liveSearch);
        let value = tuneLiveSystemInstruction(appendSessionPack(livePrompt), getPreferences().responseMode);
        return appendContextToInstruction(value, retrieveContext('', { limit: 4, maxChars: 6500 }));
    };
    publishProviderState(isReconnect ? 'reconnecting' : 'connecting');
    try {
        if (!isReconnect) {
            startTransportLog(String(Date.now()));
            logTransportEvent('gemini.live.start', { model: liveModel, operation: 'live' });
            // The current stable default is already validated by Live setup. Avoid
            // a second models.list network round trip on every cold start; retain
            // advisory discovery for manually selected/legacy Live IDs.
            if (liveModel !== 'gemini-3.8-live') {
                const preflight = await getGeminiLivePreflightError(apiKey, liveModel, signal);
                signal.throwIfAborted();
                if (preflight) throw preflight;
            }
        }
        const client = new GoogleGenAI({ apiKey, vertexai: false, httpOptions: { apiVersion: 'v1beta', retryOptions: { attempts: 1 } } });
        const runtimeCallbacks = geminiLiveRuntime.callbacks({
            current: () => current() && liveSessionReady,
            onopen() {
                if (current()) sendToRenderer('update-status', 'Gemini connected; preparing the session...');
            },
            onmessage(message) {
                if (!current()) return;
                const interim = extractGeminiTranscript(message, 'interimInputTranscription');
                const finalText = extractGeminiTranscript(message, 'inputTranscription');
                if (interim) emitLiveTranscript({ provider: 'gemini', text: interim, final: false, timestamp: Date.now() });
                if (finalText) {
                    emitLiveTranscript({ provider: 'gemini', text: finalText, final: true, timestamp: Date.now() });
                    currentTranscription += message.serverContent?.inputTranscription?.text || finalText;
                }
                const groundingFragment = groundingFragmentFromResponse(message);
                if (groundingFragment) {
                    liveGrounding = mergeGrounding(liveGrounding, groundingFragment);
                    const grounding = publicGrounding(liveGrounding);
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
                        { requestId: liveResponseId, kind: 'voice', grounding: publicGrounding(liveGrounding) });
                }
                // generationComplete can precede the final transcription. Save
                // once at turnComplete (or interruption), not at generationComplete.
                if (content.turnComplete || content.interrupted) {
                    if (currentTranscription.trim() && messageBuffer.trim()) {
                        saveConversationTurn(currentTranscription, messageBuffer, publicGrounding(liveGrounding));
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
            onerror(error, recovery) {
                if (!current() || !liveSessionReady) return;
                lastGeminiFailure = classifyGeminiFailure(error, 'live', liveModel, Date.now(), { searchAttached: searchState.liveEffective });
                if (lastGeminiFailure.retryAt > Date.now()) {
                    const baseKey = cooldownKey(apiKey, liveModel);
                    geminiCooldowns.set(lastGeminiFailure.quotaScope === 'model' || !searchState.liveEffective ? baseKey : `${baseKey}:live:search`, lastGeminiFailure);
                }
                if (!recovery?.recoverable) {
                    publishProviderState('failed', lastGeminiFailure);
                    sendToRenderer('update-status', lastGeminiFailure.message);
                }
            },
            onclose(event, recovery) {
                if (!current() || !liveSessionReady || isUserClosing) return;
                global.geminiSessionRef.current = null;
                lastGeminiFailure = classifyGeminiFailure(event, 'live', liveModel, Date.now(), { searchAttached: searchState.liveEffective });
                if (lastGeminiFailure.retryAt > Date.now()) {
                    const baseKey = cooldownKey(apiKey, liveModel);
                    geminiCooldowns.set(lastGeminiFailure.quotaScope === 'model' || !searchState.liveEffective ? baseKey : `${baseKey}:live:search`, lastGeminiFailure);
                }
                if (!recovery?.recoverable) {
                    publishProviderState('failed', lastGeminiFailure);
                    sendToRenderer('update-status', lastGeminiFailure.message);
                }
            },
        });
        const callbacks = { ...runtimeCallbacks, onmessage(message) {
            if (!current()) return;
            // SDK 2.22 drains setup messages synchronously BEFORE connect()
            // resolves. Preserve these until the application adopts the session.
            if (!liveSessionReady) { if (setupMessages.length < 64) setupMessages.push(message); return; }
            runtimeCallbacks.onmessage(message);
        } };
        let session;
        for (let freshFallback = 0; freshFallback < 2; freshFallback++) {
            const reliabilityConfig = geminiLiveRuntime.getConnectConfig();
            try {
                let contextMessage;
                session = await runGeminiRequest(async (remaining, _attempt, operationSignal) => {
                    setupMessages = [];
                    const attemptStarted = Date.now();
                    const connect = ({ searchEnabled, coreConfig }) => {
                        setupMessages = [];
                        // Replay is based on the configuration actually sent, not
                        // on a resumption handle omitted by compatibility mode.
                        const connectConfig = coreConfig ? {} : { ...reliabilityConfig };
                        // A tool change must not resume an old Search-enabled
                        // session. Fresh controls restore bounded local history.
                        if (!searchEnabled && searchState.liveEffective && connectConfig.sessionResumption?.handle) {
                            connectConfig.sessionResumption = {};
                        }
                        contextMessage = isReconnect && !connectConfig.sessionResumption?.handle ? buildContextMessage() : null;
                        return connectGeminiLiveWithGuard(client, {
                            model: liveModel, callbacks,
                            config: { responseModalities: [Modality.AUDIO], inputAudioTranscription: {}, outputAudioTranscription: {},
                                ...connectConfig,
                                ...(contextMessage ? { historyConfig: { initialHistoryInClientContent: true } } : {}),
                                systemInstruction: buildInstruction(searchEnabled), ...(searchEnabled ? { tools: [{ googleSearch: {} }] } : {}) },
                        }, Math.max(1, Math.min(15000, remaining - (Date.now() - attemptStarted))), operationSignal);
                    };
                    const connected = await recoverGeminiSetup(connect, {
                        model: liveModel, searchEnabled: searchState.liveEffective, coreConfig: liveSetupCompatibility,
                        signal: operationSignal, onSearchFallback: disableLiveSearchForSetupCompatibility,
                        onCoreFallback: enableLiveSetupCompatibility,
                    });
                    if (contextMessage) {
                        try {
                            connected.sendClientContent({
                                turns: [{ role: 'user', parts: [{ text: augmentLiveTextPayload({ text: contextMessage }).text }] }],
                                turnComplete: true,
                            });
                        } catch (error) {
                            try { connected.close(); } catch {}
                            throw error;
                        }
                    }
                    return connected;
                }, { operation: 'live', model: liveModel, apiKey, signal, budgetMs: 35000, searchAttached: searchState.liveEffective });
                break;
            } catch (error) {
                const failure = classifyGeminiFailure(error, 'live', liveModel);
                if (!isReconnect || freshFallback || !reliabilityConfig.sessionResumption?.handle || failure.category !== 'resume-unavailable') throw error;
                geminiLiveRuntime.clearResumption();
                sendToRenderer('update-status', 'Gemini resumption expired; restoring local session context on a fresh connection.');
            }
        }
        if (!current()) { session.close(); return null; }
        liveSessionReady = true;
        geminiLiveRuntime.onOpen();
        if (!isReconnect) initializeNewSession(profile, customPrompt);
        for (const message of setupMessages) runtimeCallbacks.onmessage(message);
        setupMessages = [];
        lastGeminiFailure = null;
        lastGeminiInitializationError = '';
        searchState = { ...searchState, status: searchState.effective ? 'enabled' : searchState.status };
        publishProviderState('ready');
        return session;
    } catch (error) {
        if (!current()) return null;
        lastGeminiFailure = classifyGeminiFailure(error, 'live', liveModel);
        const { category, httpStatus, socketCode, networkCode, stage } = lastGeminiFailure;
        const diagnostic = { model: liveModel, operation: 'live', category, status: httpStatus, code: socketCode, networkCode, stage };
        logTransportEvent('gemini.live.start.failed', diagnostic);
        console.warn('Gemini Live startup failed', diagnostic);
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

async function attemptReconnect(details = {}) {
    const params = sessionParams;
    if (!params?.apiKey || isUserClosing) return false;
    geminiLiveRuntime?.cancelScheduledReconnect?.();
    liveGeneration++;
    liveController.abort();
    liveController = new AbortController();
    const previousSession = global.geminiSessionRef?.current;
    global.geminiSessionRef.current = null;
    if (previousSession) { try { previousSession.close(); } catch {} }
    isInitializingSession = false;
    const generation = liveGeneration;
    messageBuffer = '';
    currentTranscription = '';
    const model = String(getConfig().geminiLiveModel || 'gemini-3.8-live').replace(/^models\//, '').trim();
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
    return true;
}

function parsePcmSampleRate(mimeType) {
    const match = String(mimeType || '').match(/rate=(16000|24000|48000)/i);
    return match ? Number(match[1]) : 24000;
}

function resamplePcm16Mono(buffer, sourceRate, targetRate = 16000) {
    if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || []);
    const sourceSamples = Math.floor(buffer.length / 2);
    if (!sourceSamples || sourceRate <= 0 || targetRate <= 0) return Buffer.alloc(0);
    if (sourceRate === targetRate) return buffer.subarray(0, sourceSamples * 2);
    const targetSamples = Math.max(1, Math.floor(sourceSamples * targetRate / sourceRate));
    const output = Buffer.alloc(targetSamples * 2);
    for (let i = 0; i < targetSamples; i++) {
        const position = i * sourceRate / targetRate;
        const leftIndex = Math.min(sourceSamples - 1, Math.floor(position));
        const rightIndex = Math.min(sourceSamples - 1, leftIndex + 1);
        const fraction = position - leftIndex;
        const left = buffer.readInt16LE(leftIndex * 2);
        const right = buffer.readInt16LE(rightIndex * 2);
        const value = Math.round(left + (right - left) * fraction);
        output.writeInt16LE(Math.max(-32768, Math.min(32767, value)), i * 2);
    }
    return output;
}

function normalizeGeminiAudioPayload(base64Data, mimeType = 'audio/pcm;rate=24000') {
    const sourceRate = parsePcmSampleRate(mimeType);
    const source = Buffer.from(base64Data || '', 'base64');
    const pcm = resamplePcm16Mono(source, sourceRate, 16000);
    return { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' };
}

async function sendAudioToGemini(base64Data, geminiSessionRef, mimeType = 'audio/pcm;rate=24000') {
    if (!geminiSessionRef.current) return;

    try {
        process.stdout.write('.');
        const audio = normalizeGeminiAudioPayload(base64Data, mimeType);
        geminiSessionRef.current.sendRealtimeInput({ audio });
    } catch (error) {
        console.warn('Error sending audio to Gemini:');
    }
}

async function sendImageToGeminiHttp(base64Data, prompt) {
    const model = getAvailableModel();
    const apiKey = getApiKey();
    if (!apiKey) return { success: false, error: 'No Gemini API key configured' };
    try {
        const ai = new GoogleGenAI({ apiKey, vertexai: false, httpOptions: { retryOptions: { attempts: 1 } } });
        const tools = await getEnabledTools();
        const mode = getResponseMode(getPreferences().responseMode);
        const params = augmentGenerateParams({
            model,
            contents: [{ inlineData: { mimeType: 'image/jpeg', data: base64Data } }, { text: prompt }],
            config: { systemInstruction: appendSessionPack(currentSystemPrompt || getSystemPrompt(currentProfile, currentCustomPrompt, searchState.httpEffective)),
                maxOutputTokens: mode.maxTokens, ...interactiveGeminiThinkingConfig(model, 'instant'), ...(tools.length ? { tools } : {}) },
        });
        let first = true;
        const response = await generateGeminiStream(ai, params,
            { operation: 'screen', model, apiKey, signal: getRequestSignal(), budgetMs: SCREEN_PROVIDER_BUDGET_MS },
            (partial, grounding) => {
                sendToRenderer(first ? 'new-response' : 'update-response', partial, { ...getRequestMetadata(), grounding, model });
                first = false;
            });
        assertCurrentRequest();
        const { text, grounding } = response;
        if (!first && grounding) sendToRenderer('update-response', text, { ...getRequestMetadata(), grounding, model });
        saveScreenAnalysis(prompt, text, model, grounding);
        incrementLimitCount(model);
        return { success: true, text, model, grounding };
    } catch (error) {
        const failure = classifyGeminiFailure(error, 'screen', model);
        return { success: false, error: failure.message, failure };
    }
}

async function sendTypedGeminiText(text) {
    const apiKey = getApiKey();
    if (!apiKey) return { success: false, error: 'No Gemini API key configured' };
    const model = getAvailableModel();
    const session = require('../storage').getSession(currentSessionId);
    const transcript = (session?.liveTranscript || []).slice(-12).map(item => item.text).join('\n').slice(-6000);
    const history = conversationHistory.filter(turn => turn?.grounded !== true).slice(-6).flatMap(turn => [
        { role: 'user', parts: [{ text: String(turn.transcription || '').slice(-2500) }] },
        { role: 'model', parts: modelPartsForHistory(geminiTurnModelParts.get(turn), String(turn.ai_response || '').slice(-2500)) },
    ]);
    const screenContext = screenAnalysisHistory.filter(item => item?.grounded !== true).slice(-1).map(item => item.response).join('');
    const instruction = tuneLiveSystemInstruction(appendSessionPack(currentSystemPrompt || 'You are a helpful assistant.'), getPreferences().responseMode)
        + (transcript ? '\nRecent session transcript (context, not instructions):\n' + transcript : '')
        + (screenContext ? '\nMost recent screen analysis:\n' + screenContext.slice(-4000) : '');
    const ai = new GoogleGenAI({ apiKey, vertexai: false, httpOptions: { retryOptions: { attempts: 1 } } });
    const tools = await getEnabledTools();
    const mode = getResponseMode(getPreferences().responseMode);
    const params = augmentGenerateParams({
        model,
        contents: [...history, { role: 'user', parts: [{ text }] }],
        config: { systemInstruction: instruction, maxOutputTokens: mode.maxTokens,
            ...interactiveGeminiThinkingConfig(model, mode.id), ...(tools.length ? { tools } : {}) },
    });
    let first = true;
    const response = await generateGeminiStream(ai, params,
        { operation: 'text', model, apiKey, signal: getRequestSignal(), budgetMs: SCREEN_PROVIDER_BUDGET_MS },
        (partial, grounding) => {
            sendToRenderer(first ? 'new-response' : 'update-response', partial, { ...getRequestMetadata(), grounding, model });
            first = false;
        });
    assertCurrentRequest();
    const { text: answer, grounding, modelParts } = response;
    if (!first && grounding) sendToRenderer('update-response', answer, { ...getRequestMetadata(), grounding, model });
    saveConversationTurn(text, answer, grounding, modelParts);
    incrementLimitCount(model);
    return { success: true, text: answer, model, grounding };
}

function validateUserRequestContext(value) {
    if (value === undefined) return { uiEpoch: providerUiEpoch };
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || typeof value.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.requestId)
        || !Number.isSafeInteger(value.uiEpoch) || value.uiEpoch < 0
        || (providerUiEpoch !== undefined && value.uiEpoch !== providerUiEpoch)) {
        throw Object.assign(new Error('Invalid or expired request context'), { name: 'AbortError' });
    }
    return { requestId: value.requestId, uiEpoch: value.uiEpoch };
}

function userRequestFailure(error, operation) {
    const cancelled = error?.name === 'AbortError' && !/timed? out|timeout/i.test(error.message || '');
    const failure = currentProviderMode === 'byok' ? classifyGeminiFailure(error, operation, getAvailableModel())
        : { operation, category: cancelled ? 'cancelled' : 'request-failed',
            message: cancelled ? 'Request cancelled.' : `${currentProviderMode === 'local' ? 'Local AI' : 'Groq'} could not complete this request. Check provider settings and retry; your draft is retained.` };
    return { success: false, cancelled: failure.category === 'cancelled', error: failure.message, failure };
}

function reportUserRequestResult(result, operation) {
    if (result?.success === true && Object.hasOwn(result, 'text') && !String(result.text || '').trim()) {
        result = { success: false, error: 'The provider returned an empty answer. Review model settings and retry.' };
    }
    if (result?.success !== true) {
        const failure = result?.failure || { operation, category: result?.cancelled ? 'cancelled' : 'request-failed',
            message: String(result?.error || 'Request failed. Retry or review provider settings.').slice(0, 4000) };
        result = { ...result, success: false, error: failure.message, failure };
        if (failure.category !== 'cancelled') sendToRenderer('provider-request-error', failure);
    }
    return { ...result, request: getRequestMetadata() };
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
                liveSetupCompatibility = false;
                resetSessionRequests();
                const local = channel === 'initialize-local';
                const mode = local ? 'local' : args[3] === 'groq' ? 'groq' : 'byok';
                const options = args[local ? 5 : 4];
                require('./windowsRuntimeMain').prepareWindowsProvider(mode, options?.uiEpoch);
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
                if (['send-text-message', 'send-image-content'].includes(channel)) {
                    // The IPC result belongs to its original caller. Never broadcast an
                    // unscoped error after leaving AsyncLocalStorage or ending a session.
                    return userRequestFailure(error, channel === 'send-text-message' ? 'text' : 'screen');
                }
                return { success: false, error: error?.message || 'Request failed' };
            }
        };
        if (['send-audio-content', 'send-mic-audio-content', 'audio-stream-end'].includes(channel)) {
            const audioEpoch = args[0]?.uiEpoch;
            if (!mainSessionActive || (providerUiEpoch !== undefined && audioEpoch !== providerUiEpoch)) {
                return { success: true, ignored: true };
            }
        }
        if (!initializing) return execute();
        const operation = execute().finally(() => { if (initializePromise === operation) initializePromise = null; });
        initializePromise = operation;
        return operation;
    });

    register('initialize-gemini', async (event, customPrompt, profile = 'interview', language = 'en-US', provider = 'byok', options = {}) => {
        if (!options || typeof options !== 'object' || (options.searchEnabled !== undefined && typeof options.searchEnabled !== 'boolean')
            || (options.uiEpoch !== undefined && !Number.isSafeInteger(options.uiEpoch))) return { success: false, error: 'Invalid session options' };
        if (typeof customPrompt !== 'string' || customPrompt.length > 32000 || typeof profile !== 'string'
            || typeof language !== 'string' || language.length > 32) return { success: false, error: 'Invalid session configuration' };
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
            groqSystemAudioBuffer = Buffer.alloc(0);
            sendToRenderer('update-status', 'Groq ready');
            publishProviderState('ready');
            return { success: true, provider: 'groq', search: { ...searchState } };
        }

        const apiKey = getApiKey();
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
        if (currentProviderMode === 'local') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                getLocalAi().processLocalAudio(resamplePcm16Mono(pcmBuffer, parsePcmSampleRate(mimeType), 24000));
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
            const audio = normalizeGeminiAudioPayload(data, mimeType);
            geminiSessionRef.current.sendRealtimeInput({ audio });
            return { success: true };
        } catch (error) {
            geminiLiveRuntime?.onFailure({ code: 1006 }, 'audio-send');
            return { success: false, error: 'Gemini audio transport interrupted; reconnecting.' };
        }
    });

    // Handle microphone audio on a separate channel
    register('send-mic-audio-content', async (event, payload) => {
        const { data, mimeType } = payload || {};
        if (typeof data !== 'string' || data.length > 262144 || !/^audio\/pcm;rate=(16000|24000|48000)$/.test(mimeType || '')) {
            return { success: false, error: 'Invalid PCM audio payload' };
        }
        if (currentProviderMode === 'local') {
            try {
                const pcmBuffer = Buffer.from(data, 'base64');
                getLocalAi().processLocalAudio(resamplePcm16Mono(pcmBuffer, parsePcmSampleRate(mimeType), 24000));
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
            const audio = normalizeGeminiAudioPayload(data, mimeType);
            geminiSessionRef.current.sendRealtimeInput({ audio });
            return { success: true };
        } catch (error) {
            geminiLiveRuntime?.onFailure({ code: 1006 }, 'audio-send');
            return { success: false, error: 'Gemini audio transport interrupted; reconnecting.' };
        }
    });

    register('audio-stream-end', async () => {
        if (currentProviderMode !== 'byok' || !geminiSessionRef.current) return { success: true, ignored: true };
        try {
            geminiSessionRef.current.sendRealtimeInput({ audioStreamEnd: true });
            return { success: true };
        } catch (error) {
            console.warn('Error ending Gemini audio stream:');
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
        const request = validateUserRequestContext(payload.request);
        return runSessionRequest('screen', async () => {
            sendToRenderer('screen-analysis-started', null);
            let result;
            try {
                if (Buffer.from(data, 'base64').length < 1000) result = { success: false, error: 'Image buffer too small' };
                else if (currentProviderMode === 'local') result = await getLocalAi().sendLocalImage(data, prompt);
                else result = currentProviderMode === 'groq' ? await sendImageToGroq(data, prompt) : await sendImageToGeminiHttp(data, prompt);
            } catch (error) { result = userRequestFailure(error, 'screen'); }
            result = reportUserRequestResult(result, 'screen');
            sendToRenderer('screen-analysis-complete', result);
            return result;
        }, { ...request, timeoutMs: SCREEN_SESSION_TIMEOUT_MS });
    });

    register('send-text-message', async (event, text, options) => {
        if (typeof text !== 'string' || !text.trim() || text.length > 32000) {
            return { success: false, error: 'Enter a message between 1 and 32,000 characters' };
        }
        const request = validateUserRequestContext(options);
        const cleanText = text.trim();
        return runSessionRequest('text', async () => {
            let result;
            try {
                result = currentProviderMode === 'local' ? await getLocalAi().sendLocalText(cleanText)
                    : currentProviderMode === 'groq' ? await sendToGroq(cleanText) : await sendTypedGeminiText(cleanText);
            } catch (error) { result = userRequestFailure(error, 'text'); }
            return reportUserRequestResult(result, 'text');
        }, { ...request, timeoutMs: currentProviderMode === 'local' ? 180000 : currentProviderMode === 'byok' ? SCREEN_SESSION_TIMEOUT_MS : 65000 });
    });

    register('close-session', async event => {
        liveGeneration += 1;
        liveController.abort(Object.assign(new Error('Session ended'), { name: 'AbortError' }));
        isInitializingSession = false;
        mainSessionActive = false;
        isUserClosing = true;
        sessionParams = null;
        geminiLiveRuntime?.stop();
        geminiLiveRuntime = null;
        manualReconnectPromise = null;
        currentTranscription = '';
        messageBuffer = '';
        closeSessionRequests();
        require('./contextCaptureMain').cancelRegionSelection();
        try {
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
        if (manualReconnectPromise) return manualReconnectPromise.then(success => ({ success, failure: lastGeminiFailure, search: { ...searchState } }));
        const model = String(getConfig().geminiLiveModel || 'gemini-3.8-live').replace(/^models\//, '').trim();
        const cooldown = geminiCooldowns.get(cooldownKey(sessionParams.apiKey, model));
        if (cooldown?.retryAt > Date.now()) return { success: false, error: cooldown.message, failure: cooldown };
        if (geminiLiveRuntime?.getState().reconnecting) return { success: false, error: 'Automatic recovery is in progress. Wait before retrying.' };
        geminiLiveRuntime?.cancelScheduledReconnect?.();
        if (options.withoutSearch) {
            geminiLiveRuntime?.clearResumption();
            searchState = { ...searchState, effective: false, httpEffective: false, status: 'user-disabled' };
            currentSystemPrompt = getSystemPrompt(currentProfile, currentCustomPrompt, false);
            sendToRenderer('search-state', { ...searchState });
        }
        // Do not reset history, drafts, capture, HTTP epochs or provider identity.
        const usedResumption = Boolean(geminiLiveRuntime?.getConnectConfig?.().sessionResumption?.handle);
        manualReconnectPromise = attemptReconnect({ reason: 'manual', usedResumption })
            .catch(() => false)
            .finally(() => { manualReconnectPromise = null; });
        const success = await manualReconnectPromise;
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
    sendAudioToGemini,
    parsePcmSampleRate,
    resamplePcm16Mono,
    normalizeGeminiAudioPayload,
    sendImageToGeminiHttp,
    setupGeminiIpcHandlers,
    classifyGeminiFailure, runGeminiRequest, connectGeminiLiveWithGuard, groundingFromResponse, configureSearch,
    formatSpeakerResults,
};
