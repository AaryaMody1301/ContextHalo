const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

const context = new AsyncLocalStorage();
let epoch = 0;
let active = false;
let queue = Promise.resolve();
const controllers = new Set();

function abortError(message) {
    return Object.assign(new Error(message), { name: 'AbortError' });
}

function closeSessionRequests() {
    active = false;
    epoch += 1;
    for (const controller of controllers) controller.abort(abortError('Session ended'));
    controllers.clear();
    queue = Promise.resolve();
}

function resetSessionRequests() {
    closeSessionRequests();
    active = true;
}

function requestIsCurrent() {
    const request = context.getStore();
    return !request || (active && request.epoch === epoch && !request.signal.aborted);
}

function assertCurrentRequest() {
    if (!requestIsCurrent()) throw abortError('Request belongs to an ended session');
}

function getRequestMetadata() {
    const request = context.getStore();
    return request ? { requestId: request.requestId, kind: request.kind, epoch: request.epoch } : undefined;
}

function getRequestSignal() {
    return context.getStore()?.signal;
}

// Serialize history-mutating work. Deadlines include queue time. Closing a
// session invalidates queued work and late callbacks, even for a non-abortable SDK.
function runSessionRequest(kind, work, options = {}) {
    if (context.getStore()) {
        assertCurrentRequest();
        return Promise.resolve().then(work);
    }
    if (!active) return Promise.reject(abortError('Start a session before sending a request'));
    const controller = new AbortController();
    controllers.add(controller);
    const timeoutMs = options.timeoutMs || 65000;
    const request = {
        requestId: options.requestId || randomUUID(), kind, epoch,
        signal: controller.signal,
    };
    let timer;
    let onAbort;
    const interrupted = new Promise((_, reject) => {
        onAbort = () => reject(controller.signal.reason || abortError('Request cancelled'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => controller.abort(abortError(`${kind} request timed out. Try again.`)), timeoutMs);
    });
    const workPromise = queue.then(() => context.run(request, async () => {
        assertCurrentRequest();
        const result = await work();
        assertCurrentRequest();
        return result;
    }));
    const result = Promise.race([workPromise, interrupted]).finally(() => {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
        controllers.delete(controller);
        controller.abort(abortError('Request finished'));
    });
    queue = result.catch(() => {});
    return result;
}

module.exports = {
    closeSessionRequests, resetSessionRequests, runSessionRequest,
    requestIsCurrent, assertCurrentRequest, getRequestMetadata, getRequestSignal,
};
