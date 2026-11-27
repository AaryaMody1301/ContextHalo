function abortable(work, signal) {
    if (signal.aborted) return Promise.reject(signal.reason);
    let onAbort;
    const cancelled = new Promise((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
    });
    return Promise.race([Promise.resolve().then(() => {
        signal.throwIfAborted();
        return work();
    }), cancelled]).finally(() => signal.removeEventListener('abort', onAbort));
}

function deadlineSignal(parent, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(Object.assign(new Error('Provider operation timed out'), {
        name: 'TimeoutError',
    })), Math.max(1, timeoutMs));
    const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
    return {
        signal,
        close() {
            clearTimeout(timer);
            controller.abort(Object.assign(new Error('Operation finished'), { name: 'AbortError' }));
        },
    };
}
function parseRetryAfterMs(headers) {
    const value = headers?.get?.('retry-after')?.trim();
    if (!value || value.length > 128) return null;
    if (/^\d+(?:\.\d+)?$/.test(value)) {
        const ms = Math.ceil(Number(value) * 1000);
        return Number.isSafeInteger(ms) ? ms : null;
    }
    const date = /[a-z]{3}/i.test(value) ? Date.parse(value) : NaN;
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

module.exports = { abortable, deadlineSignal, parseRetryAfterMs };
