const { readSseJson } = require('./sse');
const { abortable, deadlineSignal } = require('./requestDeadline');
const { assertChatCompletionOutcome } = require('./chatCompletionOutcome');
const { recordRequestUsage } = require('./sessionRequests');
const { setTimeout: sleep } = require('node:timers/promises');

const MISTRAL_MODEL = 'mistral-small-2603';
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const SAFE_ERROR_CODES = new Set(['1300', 'rate_limit_exceeded', 'quota_exceeded', 'insufficient_quota']);
const SAFE_ERROR_TYPES = new Set(['rate_limited', 'rate_limit_error', 'invalid_request_error', 'authentication_error', 'server_error']);
let nextRequestAt = 0;

function classifyMistralFailure(error, operation) {
    const httpStatus = Number(error?.status) || null;
    const cancelled = error?.name === 'AbortError' && !/timeout|timed out/i.test(error.message || '');
    const category = cancelled ? 'cancelled' : httpStatus === 401 || httpStatus === 403 ? 'authentication'
        : httpStatus === 429 ? 'rate-or-quota' : httpStatus === 400 ? 'invalid-configuration'
        : httpStatus === 404 ? 'model-unavailable' : error?.completionFailure ? 'generation-failed' : 'request-failed';
    const messages = {
        cancelled: 'Request cancelled.',
        authentication: 'Mistral rejected the credential or project permissions. Check your Mistral API key in provider settings.',
        'rate-or-quota': 'Mistral rejected this request under an organization rate or usage limit. Check this model\'s limits and included monthly usage in Mistral Admin. A 429 alone does not identify the limit. If a small request still fails with unused allowance and positive limits, contact Mistral support.',
        'invalid-configuration': 'Mistral rejected the request configuration. Review the question and image input.',
        'model-unavailable': 'The selected Mistral model is unavailable to this account. Check model access in Mistral Studio.',
        'generation-failed': 'Mistral did not complete this answer. Try a narrower question or smaller screen region. The incomplete answer was not saved.',
        'request-failed': 'Mistral could not complete this request. Check connectivity or retry later; your draft is retained.',
    };
    const retryAfterMs = Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : null;
    return { operation, model: MISTRAL_MODEL, category, httpStatus, retryAfterMs,
        ...(SAFE_ERROR_CODES.has(error?.providerCode) ? { providerCode: error.providerCode } : {}),
        ...(SAFE_ERROR_TYPES.has(error?.providerType) ? { providerType: error.providerType } : {}),
        retryAt: retryAfterMs === null ? null : Date.now() + retryAfterMs,
        retryable: !cancelled && (RETRYABLE_STATUS.has(httpStatus) || !httpStatus && !error?.completionFailure),
        message: messages[category] + (httpStatus ? ` (HTTP ${httpStatus})` : '') };
}

async function httpFailure(response, signal) {
    const failure = Object.assign(new Error('Mistral HTTP request failed'), { status: response.status, retryAfterMs: retryDelay(response.headers) });
    const deadline = deadlineSignal(signal, 1000);
    const reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (reader) {
            const { value, done } = await abortable(() => reader.read(), deadline.signal);
            if (done) break;
            size += value.byteLength;
            if (size > 16384) throw new Error('Mistral error body is too large');
            chunks.push(Buffer.from(value));
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const error = body?.error || body;
        const code = String(error?.code ?? '');
        if (SAFE_ERROR_CODES.has(code)) failure.providerCode = code;
        if (SAFE_ERROR_TYPES.has(error?.type)) failure.providerType = error.type;
    } catch {
        // HTTP status and Retry-After remain authoritative if the error body cannot be read.
    } finally {
        try { void reader?.cancel().catch(() => {}); } catch {}
        reader?.releaseLock();
        deadline.close();
    }
    signal.throwIfAborted();
    return failure;
}

function retryDelay(headers) {
    const value = headers.get('retry-after');
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function textDelta(content) {
    if (typeof content === 'string') return content;
    return Array.isArray(content) ? content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('') : '';
}

async function streamMistral({ apiKey, messages, operation, signal, onText }) {
    if (!apiKey) throw Object.assign(new Error('Missing Mistral credential'), { status: 401 });
    const totalMs = operation === 'screen' ? 52000 : 60000;
    const started = Date.now();
    const deadline = deadlineSignal(signal, totalMs);
    let text = '';
    try {
        for (let attempt = 0; attempt < 2; attempt++) {
            let response;
            let failure;
            const remaining = () => totalMs - (Date.now() - started);
            const request = deadlineSignal(deadline.signal, Math.min(remaining(), operation === 'screen' ? 24000 : 28000));
            try {
                response = await abortable(async () => {
                    // Pace both request lanes and retries for 1-RPS evaluation accounts.
                    while (Date.now() < nextRequestAt) await sleep(nextRequestAt - Date.now(), undefined, { signal: request.signal });
                    request.signal.throwIfAborted();
                    nextRequestAt = Date.now() + 1000;
                    return fetch('https://api.mistral.ai/v1/chat/completions', {
                        method: 'POST', signal: request.signal,
                        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ model: MISTRAL_MODEL, messages, stream: true, reasoning_effort: 'none', max_tokens: 2048 }),
                    });
                }, request.signal);
                if (!response.ok) throw await httpFailure(response, request.signal);
                let finishReason = null;
                for await (const event of readSseJson(response.body, request.signal)) {
                    request.signal.throwIfAborted();
                    const choice = event.choices?.[0];
                    finishReason = choice?.finish_reason || finishReason;
                    try { assertChatCompletionOutcome(finishReason, 'mistral'); }
                    catch { throw Object.assign(new Error('Incomplete Mistral answer'), { completionFailure: true }); }
                    recordRequestUsage({ inputTokens: event.usage?.prompt_tokens, outputTokens: event.usage?.completion_tokens, totalTokens: event.usage?.total_tokens });
                    const delta = textDelta(choice?.delta?.content);
                    if (delta) { text += delta; onText(text); }
                }
                request.signal.throwIfAborted();
                if (finishReason !== 'stop' || !text.trim()) throw Object.assign(new Error('Incomplete Mistral answer'), { completionFailure: true });
                return { text: text.trim(), model: MISTRAL_MODEL };
            } catch (error) {
                failure = error;
            } finally {
                try { void response?.body?.cancel().catch(() => {}); } catch {}
                request.close();
            }
            deadline.signal.throwIfAborted();
            const networkFailure = !failure.status && !failure.completionFailure
                && (failure.name === 'TimeoutError' || /fetch failed|network|socket|econn|etimedout|timed out/i.test(failure.message || ''));
            const waitMs = Math.max(1000 + Math.floor(Math.random() * 250), failure.retryAfterMs || 0);
            if (attempt || text || !(RETRYABLE_STATUS.has(failure.status) || networkFailure) || waitMs >= remaining()) throw failure;
            await sleep(waitMs, undefined, { signal: deadline.signal });
        }
    } finally {
        deadline.close();
    }
}

module.exports = { MISTRAL_MODEL, streamMistral, classifyMistralFailure };
