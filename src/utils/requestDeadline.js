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
module.exports = { abortable, deadlineSignal };
