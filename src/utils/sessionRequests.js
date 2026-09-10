const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

const context = new AsyncLocalStorage();
let epoch = 0;
let active = false;
const queues = new Map();
const controllers = new Map();

function abortError(message) {
    return Object.assign(new Error(message), { name: 'AbortError' });
}

function laneForRequest(kind) {
    // Screen analysis owns a separate lane so continuous interview transcription
    // cannot consume its deadline while it waits behind voice/text work. Voice and
    // typed questions stay serialized because both can mutate conversation history.
    return kind === 'screen' ? 'screen' : 'conversation';
}

function resetQueues() {
    queues.clear();
}

function closeSessionRequests() {
    active = false;
    epoch += 1;
    for (const controller of controllers.keys()) controller.abort(abortError('Session ended'));
    controllers.clear();
    resetQueues();
}

function cancelSessionRequests(kind) {
    for (const [controller, requestKind] of controllers) {
        if (requestKind === kind) controller.abort(abortError(`${kind} request cancelled`));
    }
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
    return request ? { requestId: request.requestId, kind: request.kind, epoch: request.epoch, uiEpoch: request.uiEpoch } : undefined;
}

function getRequestSignal() {
    return context.getStore()?.signal;
}

// Serialize work only where shared state requires it. Screen analysis uses an
// independent lane so it stays responsive during long-running voice activity.
// Deadlines still include queue time within each lane. Closing a session
// invalidates queued work and late callbacks, even for a non-abortable SDK.
function runSessionRequest(kind, work, options = {}) {
    if (context.getStore()) {
        assertCurrentRequest();
        return Promise.resolve().then(work);
    }
    if (!active) return Promise.reject(abortError('Start a session before sending a request'));
    const controller = new AbortController();
    controllers.set(controller, kind);
    const timeoutMs = options.timeoutMs || 65000;
    const request = {
        requestId: options.requestId || randomUUID(), kind, epoch, uiEpoch: options.uiEpoch,
        signal: controller.signal,
    };
    let timer;
    let onAbort;
    const interrupted = new Promise((_, reject) => {
        onAbort = () => reject(controller.signal.reason || abortError('Request cancelled'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => controller.abort(abortError(`${kind} request timed out. Try again.`)), timeoutMs);
    });
    const lane = options.lane || laneForRequest(kind);
    const previous = queues.get(lane) || Promise.resolve();
    const workPromise = previous.then(() => context.run(request, async () => {
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
    queues.set(lane, result.catch(() => {}));
    return result;
}

module.exports = {
    closeSessionRequests, cancelSessionRequests, resetSessionRequests, runSessionRequest,
    requestIsCurrent, assertCurrentRequest, getRequestMetadata, getRequestSignal,
};