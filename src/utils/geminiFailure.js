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
    // ws ErrorEvent stores the useful error under .error; fetch uses .cause.
    // Inspect a bounded chain, but never expose its arbitrary messages to the UI.
    const chain = [];
    for (let value = error; value && chain.length < 5 && !chain.includes(value); value = value.error || value.cause) chain.push(value);
    const parsed = chain.map(geminiErrorObject);
    const text = [...chain, ...parsed].flatMap(value => [value?.message, value?.reason, value?.status, value?.code])
        .filter(value => typeof value === 'string').join(' ').slice(0, 32000).toLowerCase();
    const number = [...chain, ...parsed].flatMap(value => [value?.status, value?.statusCode, value?.code])
        .map(Number).find(value => value >= 400 && value <= 599);
    const httpStatus = number || Number(text.match(/\b(400|401|403|404|407|408|409|429|500|502|503|504)\b/)?.[1]) || null;
    const socketCode = chain.map(value => Number(value?.code)).find(value => value >= 1000 && value <= 4999) || null;
    const networkCode = chain.map(value => value?.code).find(value => [
        'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH',
        'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    ].includes(value)) || null;
    const stage = ['catalog', 'transport', 'setup'].includes(error?.stage) ? error.stage : null;
    const details = parsed.flatMap(value => Array.isArray(value?.details) ? value.details : []);
    const quotaText = JSON.stringify(details.filter(item => /QuotaFailure/.test(item?.['@type'] || ''))).toLowerCase();
    const combined = text + quotaText;
    const headers = chain.map(value => value?.headers || value?.response?.headers).find(Boolean);
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
    const cancelled = chain.some(value => value?.name === 'AbortError') && !/timed?\s*out|timeout/i.test(text);
    const quota = /quota_exceeded|quota.{0,24}exceeded|exceeded.{0,24}quota|per.?day|daily|per.?month|monthly|limit[: =]+0\b/.test(combined);
    const throttled = /rate_limit_exceeded|per.?minute|per.?second|requestsperminute|tokensperminute/.test(combined);
    const searchRelated = /google.?search|grounding/.test(combined);
    let category = 'unknown';
    if (cancelled) category = 'cancelled';
    else if (networkCode && /CERT|SELF_SIGNED|ISSUER|SIGNATURE/.test(networkCode)) category = 'tls';
    else if (httpStatus === 407) category = 'proxy-authentication';
    else if (httpStatus === 401 || /unauthenticated|api.?key.?invalid|api key not valid/.test(text)) category = 'authentication';
    else if (httpStatus === 403 || /permission_denied|forbidden/.test(text)) category = 'permission';
    else if (httpStatus === 429 || /resource[_ -]?exhausted|quota_exceeded|quota.{0,24}exceeded|exceeded.{0,24}quota|rate_limit_exceeded/.test(text)) {
        category = throttled ? 'throttled' : quota ? 'quota-exhausted' : retryAfterMs !== null ? 'throttled' : 'rate-or-quota';
    } else if (httpStatus === 404 || /model_not_found|model.+not found/.test(text)) category = 'model-unavailable';
    else if (httpStatus === 409 && /\baborted\b/.test(text) && !/already[_ -]?exists/.test(text)) category = 'aborted-conflict';
    else if (httpStatus === 409) category = 'state-conflict';
    else if (httpStatus === 400 && /resum|session.?handle/.test(text) && /expired|invalid|not found|not resumable/.test(text)) category = 'resume-unavailable';
    else if ((httpStatus === 400 || socketCode === 1007 || socketCode === 1008) && /tool|google.?search|grounding/.test(text)) category = 'unsupported-tool';
    else if (httpStatus === 400 || socketCode === 1007 || socketCode === 1008) category = 'invalid-configuration';
    else if (networkCode || [408, 500, 502, 503, 504].includes(httpStatus) || [1000, 1001, 1006, 1011, 1012, 1013].includes(socketCode)
        || /network|fetch failed|econnreset|socket|unavailable|timed?\s*out|timeout/.test(text)) category = 'transient';
    else if (/empty|no text/.test(text)) category = 'empty-response';
    const messages = {
        tls: 'Gemini secure connection failed certificate verification. Check the Windows clock and trusted certificates or contact your network administrator. Certificate verification remains enabled.',
        'proxy-authentication': 'The network proxy requires authentication before Gemini can connect. Review the system proxy configuration with your network administrator.',
        authentication: 'Gemini authentication failed. Check the API key in Home; it has not been changed.',
        permission: 'Gemini denied access. Check API-key restrictions, project access and the selected model in Settings.',
        'quota-exhausted': 'Gemini project quota is exhausted. Wait for the project quota reset or review usage in Google AI Studio. Turning Search off does not bypass model quotas.',
        throttled: 'Gemini temporarily throttled this request. Wait before retrying; your session and draft are retained.',
        'rate-or-quota': 'Gemini returned 429 without enough detail to distinguish throttling from exhausted quota. Check project usage before retrying.',
        'model-unavailable': 'The configured Gemini model is unavailable to this project. Select a supported model in Home; your saved model has not been changed.',
        'aborted-conflict': 'Gemini interrupted the Live connection because of a transient session conflict. ContextHalo will reconnect without ending the interview.',
        'state-conflict': 'Gemini reported a non-retryable state conflict. Review this operation before retrying.',
        'resume-unavailable': 'The previous Gemini session can no longer be resumed. A fresh connection is required.',
        'unsupported-tool': 'Gemini rejected the configured tool/model combination. Review model capabilities, or explicitly continue this session without Search.',
        'invalid-configuration': 'Gemini rejected the session configuration. Review the selected model and API project settings.',
        transient: 'Gemini could not complete the request because of a network, timeout or server failure. Retry when connectivity recovers.',
        cancelled: 'Request cancelled.',
        'empty-response': 'Gemini returned no text. Review the prompt or model safety settings, then retry.',
        unknown: 'Gemini could not complete the request. Review provider settings and retry. No provider or account was changed.',
    };
    const retryable = ['throttled', 'transient', 'aborted-conflict'].includes(category);
    const retryAt = retryAfterMs === null ? null : now + retryAfterMs;
    let message = messages[category];
    if (category === 'transient' && httpStatus === 503) {
        message = 'Gemini returned HTTP 503 (service unavailable or overloaded). ContextHalo retried with exponential backoff, but the service did not recover within this request. Retry later; your session and draft are retained. No model, Search setting, or account was changed.';
    } else if (category === 'transient' && ['ENOTFOUND', 'EAI_AGAIN'].includes(networkCode)) {
        message = 'Gemini hostname lookup failed. Check DNS and network connectivity, then retry.';
    } else if (category === 'transient' && operation === 'live' && stage) {
        message = stage === 'transport'
            ? 'Gemini Live could not establish its secure WebSocket connection. Check network or proxy access, then retry.'
            : 'Gemini Live connected, but session setup did not complete. Retry or review the selected model and project access.';
    }
    const diagnostic = [stage, httpStatus && `HTTP ${httpStatus}`, socketCode && `WebSocket ${socketCode}`, networkCode].filter(Boolean).join(', ');
    return { category, httpStatus, socketCode, networkCode, stage, operation, model: String(model).slice(0, 160), retryable,
        retryAfterMs, retryAt, canDisableSearch: category === 'unsupported-tool' || searchRelated && ['quota-exhausted', 'throttled', 'rate-or-quota'].includes(category),
        message: message + (diagnostic ? ` (${diagnostic})` : '')
            + (retryAfterMs === null ? '' : ` Provider retry delay: ${Math.ceil(retryAfterMs / 1000)} seconds.`) };
}

module.exports = { classifyGeminiFailure };
