const { AsyncLocalStorage } = require('node:async_hooks');
const { setTimeout: delay } = require('node:timers/promises');

const providerScope = new AsyncLocalStorage();
const activeControllers = new Set();

let installed = false;
let originalFetch = null;
let sessionController = new AbortController();

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

const POLICIES = {
    'groq-transcription': { totalMs: 30000, attemptMs: 14000, idleMs: 10000, attempts: 2 },
    'groq-image': { totalMs: 52000, attemptMs: 24000, idleMs: 12000, attempts: 2 },
    'groq-text': { totalMs: 60000, attemptMs: 28000, idleMs: 15000, attempts: 2 },
    'local-image': { totalMs: 55000, attemptMs: 54000, idleMs: 45000, attempts: 1 },
    'local-text': { totalMs: 180000, attemptMs: 179000, idleMs: 60000, attempts: 1 },
    'local-whisper': { totalMs: 60000, attemptMs: 59000, idleMs: 30000, attempts: 1 },
    'local-health': { totalMs: 10000, attemptMs: 9000, idleMs: 5000, attempts: 1 },
};

function createAbortError(message) {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

function requestUrl(input) {
    try {
        if (typeof input === 'string' || input instanceof URL) return new URL(input.toString());
        if (input && typeof input.url === 'string') return new URL(input.url);
    } catch {}
    return null;
}

function bodyContainsImage(body) {
    if (typeof body !== 'string') return false;
    return body.includes('image_url') || body.includes('data:image/');
}

function classifyProviderRequest(input, init = {}) {
    const url = requestUrl(input);
    if (!url) return null;

    if (url.hostname === 'api.groq.com') {
        if (url.pathname.includes('/audio/transcriptions')) return 'groq-transcription';
        if (url.pathname.includes('/chat/completions')) {
            return bodyContainsImage(init.body) ? 'groq-image' : 'groq-text';
        }
        return null;
    }

    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
        if (url.pathname.includes('/v1/chat/completions')) {
            return bodyContainsImage(init.body) ? 'local-image' : 'local-text';
        }
        if (url.pathname.includes('/inference')) return 'local-whisper';
        return 'local-health';
    }

    return null;
}

function tuneProviderRequest(kind, init) {
    if (kind !== 'groq-text' || typeof init.body !== 'string') return init;

    try {
        const body = JSON.parse(init.body);
        if (!String(body.model || '').startsWith('openai/gpt-oss-')) return init;

        body.reasoning_effort = 'low';
        body.include_reasoning = false;
        body.max_completion_tokens = Math.max(Number(body.max_completion_tokens) || 0, 4096);
        return { ...init, body: JSON.stringify(body) };
    } catch {
        return init;
    }
}

function parseRetryAfterMs(headers) {
    const value = headers?.get?.('retry-after');
    if (!value) return null;

    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);

    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
    return null;
}

function getRetryDelayMs(response, attempt) {
    const providerDelay = parseRetryAfterMs(response?.headers);
    if (providerDelay !== null) return providerDelay;
    return 500 * 2 ** attempt + Math.floor(Math.random() * 250);
}

function isRetryableFetchError(error) {
    if (!error) return false;
    const text = String(error.message || error).toLowerCase();
    if (error.name === 'AbortError') return text.includes('timed out') || text.includes('timeout');
    return (
        text.includes('fetch failed') ||
        text.includes('network') ||
        text.includes('socket') ||
        text.includes('econnreset') ||
        text.includes('etimedout')
    );
}

function makeSignal(controller, extraSignals) {
    const signals = [controller.signal, ...extraSignals.filter(Boolean)];
    return signals.length === 1 ? controller.signal : AbortSignal.any(signals);
}

function remainingScopeMs() {
    const scope = providerScope.getStore();
    if (!scope?.deadline) return Number.POSITIVE_INFINITY;
    return Math.max(0, scope.deadline - Date.now());
}

function cleanupResponseController(controller, timer) {
    clearTimeout(timer);
    activeControllers.delete(controller);
}

function wrapResponseBody(response, controller, timer, idleMs, requestLabel) {
    if (!response.body) {
        cleanupResponseController(controller, timer);
        return response;
    }

    const reader = response.body.getReader();
    let closed = false;

    const finish = () => {
        if (closed) return;
        closed = true;
        cleanupResponseController(controller, timer);
    };

    const wrappedBody = new ReadableStream({
        async pull(streamController) {
            let idleTimer = null;
            try {
                const readPromise = reader.read();
                const idlePromise = new Promise((_, reject) => {
                    idleTimer = setTimeout(() => {
                        const error = createAbortError(`${requestLabel} stream idle timed out after ${idleMs} ms`);
                        if (!controller.signal.aborted) controller.abort(error);
                        reject(error);
                    }, idleMs);
                });

                const result = await Promise.race([readPromise, idlePromise]);
                clearTimeout(idleTimer);

                if (result.done) {
                    finish();
                    streamController.close();
                    return;
                }
                streamController.enqueue(result.value);
            } catch (error) {
                if (idleTimer) clearTimeout(idleTimer);
                finish();
                streamController.error(error);
            }
        },
        async cancel(reason) {
            try {
                await reader.cancel(reason);
            } finally {
                if (!controller.signal.aborted) controller.abort(reason || createAbortError(`${requestLabel} cancelled`));
                finish();
            }
        },
    });

    return new Response(wrappedBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}

async function boundedFetch(input, init = {}) {
    const kind = classifyProviderRequest(input, init);
    if (!kind || !POLICIES[kind] || !originalFetch) return originalFetch(input, init);

    const requestInit = tuneProviderRequest(kind, init);
    const policy = POLICIES[kind];
    const startedAt = Date.now();
    let lastError = null;

    for (let attempt = 0; attempt < policy.attempts; attempt++) {
        const totalRemaining = policy.totalMs - (Date.now() - startedAt);
        const scopeRemaining = remainingScopeMs();
        const availableMs = Math.min(totalRemaining, scopeRemaining, policy.attemptMs);
        if (availableMs <= 0) {
            throw createAbortError(`${kind} request timed out`);
        }

        const controller = new AbortController();
        activeControllers.add(controller);
        const timeoutError = createAbortError(`${kind} request timed out after ${Math.ceil(availableMs / 1000)} seconds`);
        const timer = setTimeout(() => {
            if (!controller.signal.aborted) controller.abort(timeoutError);
        }, availableMs);

        const scopeSignal = providerScope.getStore()?.signal || null;
        const signals = [sessionController.signal, scopeSignal, requestInit.signal].filter(Boolean);
        const signal = makeSignal(controller, signals);

        try {
            const response = await originalFetch(input, { ...requestInit, signal });
            const retryableStatus = RETRYABLE_STATUS_CODES.has(response.status);

            if (retryableStatus && attempt < policy.attempts - 1) {
                const waitMs = getRetryDelayMs(response, attempt);
                const remainingAfterResponse = Math.min(
                    policy.totalMs - (Date.now() - startedAt),
                    remainingScopeMs()
                );

                // If Retry-After is larger than the remaining request budget, return
                // the real provider response so the normal UI can display the quota error.
                if (waitMs < remainingAfterResponse) {
                    try { await response.body?.cancel(); } catch {}
                    cleanupResponseController(controller, timer);
                    await delay(waitMs, undefined, { signal });
                    continue;
                }
            }

            // Health checks only need the status code and are not streamed by callers.
            if (kind === 'local-health') {
                cleanupResponseController(controller, timer);
                return response;
            }

            return wrapResponseBody(response, controller, timer, policy.idleMs, kind);
        } catch (error) {
            cleanupResponseController(controller, timer);
            lastError = error;

            const scopeAborted = providerScope.getStore()?.signal?.aborted;
            if (sessionController.signal.aborted || scopeAborted || requestInit.signal?.aborted) throw error;
            if (!isRetryableFetchError(error) || attempt >= policy.attempts - 1) throw error;

            const backoff = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
            const remaining = Math.min(policy.totalMs - (Date.now() - startedAt), remainingScopeMs());
            if (backoff >= remaining) throw error;
            await delay(backoff);
        }
    }

    throw lastError || createAbortError(`${kind} request failed`);
}

function installWindowsProviderTransport() {
    if (installed || process.platform !== 'win32') return;
    if (typeof global.fetch !== 'function') throw new Error('Global fetch is unavailable');
    originalFetch = global.fetch.bind(global);
    global.fetch = boundedFetch;
    installed = true;
}

async function runWithProviderScope(label, timeoutMs, fn) {
    const parent = providerScope.getStore();
    const controller = new AbortController();
    const parentSignal = parent?.signal || null;
    const signal = parentSignal ? AbortSignal.any([controller.signal, parentSignal]) : controller.signal;
    const deadline = Math.min(parent?.deadline || Number.POSITIVE_INFINITY, Date.now() + timeoutMs);
    const timeoutError = createAbortError(`${label} timed out after ${Math.ceil(timeoutMs / 1000)} seconds`);
    let timer = null;

    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            if (!controller.signal.aborted) controller.abort(timeoutError);
            reject(timeoutError);
        }, timeoutMs);
    });

    try {
        const workPromise = providerScope.run({ label, signal, deadline }, () => Promise.resolve().then(fn));
        return await Promise.race([workPromise, timeoutPromise]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function abortProviderSession(reason = 'Provider session closed') {
    const error = createAbortError(reason);
    if (!sessionController.signal.aborted) sessionController.abort(error);
    for (const controller of activeControllers) {
        if (!controller.signal.aborted) controller.abort(error);
    }
    activeControllers.clear();
}

function resetProviderSession() {
    abortProviderSession('Starting a new provider session');
    sessionController = new AbortController();
}

function setFetchImplementationForTests(fetchImplementation) {
    originalFetch = fetchImplementation;
}

module.exports = {
    installWindowsProviderTransport,
    runWithProviderScope,
    abortProviderSession,
    resetProviderSession,
    classifyProviderRequest,
    parseRetryAfterMs,
    tuneProviderRequest,
    boundedFetch,
    setFetchImplementationForTests,
    POLICIES,
};
