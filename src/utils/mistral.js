const { readSseJson } = require('./sse');
const { abortable, deadlineSignal } = require('./requestDeadline');
const { assertChatCompletionOutcome } = require('./chatCompletionOutcome');
const { recordRequestUsage } = require('./sessionRequests');
const { setTimeout: sleep } = require('node:timers/promises');

const MISTRAL_MODEL = 'mistral-small-2603';
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function classifyMistralFailure(error, operation) {
    const httpStatus = Number(error?.status) || null;
    const cancelled = error?.name === 'AbortError' && !/timeout|timed out/i.test(error.message || '');
    const category = cancelled ? 'cancelled' : httpStatus === 401 || httpStatus === 403 ? 'authentication'
        : httpStatus === 429 ? 'throttled' : httpStatus === 400 ? 'invalid-configuration'
        : httpStatus === 404 ? 'model-unavailable' : error?.completionFailure ? 'generation-failed' : 'request-failed';
    const messages = {
        cancelled: 'Request cancelled.',
        authentication: 'Mistral rejected the credential or project permissions. Check your Mistral API key in provider settings.',
        throttled: 'Mistral reported a rate or quota limit. Check your account limits and wait before retrying.',
        'invalid-configuration': 'Mistral rejected the request configuration. Review the question and image input.',
        'model-unavailable': 'The selected Mistral model is unavailable to this account. Check model access in Mistral Studio.',
        'generation-failed': 'Mistral did not complete this answer. Try a narrower question or smaller screen region. The incomplete answer was not saved.',
        'request-failed': 'Mistral could not complete this request. Check connectivity or retry later; your draft is retained.',
    };
    const retryAfterMs = Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : null;
    return { operation, model: MISTRAL_MODEL, category, httpStatus, retryAfterMs,
        retryAt: retryAfterMs === null ? null : Date.now() + retryAfterMs,
        retryable: !cancelled && (RETRYABLE_STATUS.has(httpStatus) || !httpStatus && !error?.completionFailure),
        message: messages[category] + (httpStatus ? ` (HTTP ${httpStatus})` : '') };
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
                response = await abortable(() => fetch('https://api.mistral.ai/v1/chat/completions', {
                    method: 'POST', signal: request.signal,
                    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: MISTRAL_MODEL, messages, stream: true, reasoning_effort: 'none', max_tokens: 2048 }),
                }), request.signal);
                if (!response.ok) throw Object.assign(new Error('Mistral HTTP request failed'), { status: response.status, retryAfterMs: retryDelay(response.headers) });
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
            const waitMs = Math.max(500 + Math.floor(Math.random() * 250), failure.retryAfterMs || 0);
            if (attempt || text || !(RETRYABLE_STATUS.has(failure.status) || networkFailure) || waitMs >= remaining()) throw failure;
            await sleep(waitMs, undefined, { signal: deadline.signal });
        }
    } finally {
        deadline.close();
    }
}

module.exports = { MISTRAL_MODEL, streamMistral, classifyMistralFailure };
