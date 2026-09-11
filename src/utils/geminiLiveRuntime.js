const {
    createLiveRecoveryState,
    liveConnectReliabilityConfig,
    markLiveConnected,
    observeLiveMessage,
    recordLiveFailure,
} = require('./geminiLiveSupervisor');

function createGeminiLiveRuntime(options = {}) {
    const reconnect = options.reconnect;
    if (typeof reconnect !== 'function') throw new TypeError('reconnect callback is required');

    const publishState = typeof options.publishState === 'function' ? options.publishState : () => {};
    const normalizeFailure = typeof options.normalizeFailure === 'function' ? options.normalizeFailure : value => value || {};
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const random = typeof options.random === 'function' ? options.random : Math.random;
    const setTimer = typeof options.setTimer === 'function' ? options.setTimer : setTimeout;
    const clearTimer = typeof options.clearTimer === 'function' ? options.clearTimer : clearTimeout;

    let state = createLiveRecoveryState();
    let timer = null;
    let scheduledAt = null;
    let scheduledReason = null;
    let reconnecting = false;
    let stopped = false;
    let generation = 0;

    function clearScheduledReconnect() {
        if (timer !== null) clearTimer(timer);
        timer = null;
        scheduledAt = null;
        scheduledReason = null;
    }

    function getState() {
        return {
            ...state,
            reconnecting,
            stopped,
            generation,
            scheduledAt,
            scheduledReason,
        };
    }

    function getConnectConfig() {
        return liveConnectReliabilityConfig(state);
    }

    function scheduleReconnect(reason, delayMs = 0) {
        if (stopped || reconnecting) return false;
        const delay = Math.max(0, Number(delayMs) || 0);
        const dueAt = now() + delay;

        // Keep the earliest recovery already scheduled. This de-duplicates the
        // common onerror -> onclose pair emitted for one failed WebSocket.
        if (timer !== null && scheduledAt !== null && scheduledAt <= dueAt) return false;
        clearScheduledReconnect();
        scheduledAt = dueAt;
        scheduledReason = reason;
        publishState('reconnecting', { reason, delayMs: delay });

        timer = setTimer(async () => {
            timer = null;
            scheduledAt = null;
            const activeReason = scheduledReason;
            scheduledReason = null;
            if (stopped || reconnecting) return;

            reconnecting = true;
            generation += 1;
            try {
                await reconnect({
                    reason: activeReason,
                    generation,
                    config: liveConnectReliabilityConfig(state),
                    state: { ...state },
                });
            } catch (error) {
                const failure = normalizeFailure(error);
                const recorded = recordLiveFailure(state, failure, now(), random);
                state = recorded.state;
                reconnecting = false;
                if (recorded.recoverable) scheduleReconnect('reconnect-failed', recorded.retryDelayMs);
                else publishState('failed', failure);
                return;
            }
            reconnecting = false;
        }, delay);
        return true;
    }

    function onOpen() {
        if (stopped) return;
        clearScheduledReconnect();
        state = markLiveConnected(state, now());
        publishState('ready', null);
    }

    function onMessage(message) {
        if (stopped) return { shouldRotate: false, rotateInMs: null };
        const observed = observeLiveMessage(state, message, now());
        state = observed.state;
        if (observed.shouldRotate) scheduleReconnect('go-away', observed.rotateInMs);
        return observed;
    }

    function onFailure(rawFailure, source = 'error') {
        if (stopped) return { recoverable: false, stopped: true };

        // A WebSocket failure frequently raises both onerror and onclose. Once a
        // reconnect is already scheduled/running, ignore the duplicate lifecycle
        // callback instead of incrementing the consecutive-failure streak twice.
        if (timer !== null || reconnecting) {
            return { recoverable: true, deduplicated: true, retryDelayMs: scheduledAt === null ? null : Math.max(0, scheduledAt - now()) };
        }

        const failure = normalizeFailure(rawFailure);
        const recorded = recordLiveFailure(state, failure, now(), random);
        state = recorded.state;
        if (recorded.recoverable) scheduleReconnect(source, recorded.retryDelayMs);
        else publishState('failed', failure);
        return recorded;
    }

    function callbacks() {
        return {
            onopen: onOpen,
            onmessage: onMessage,
            onerror: event => onFailure(event, 'error'),
            onclose: event => onFailure(event, 'close'),
        };
    }

    function stop() {
        stopped = true;
        clearScheduledReconnect();
    }

    return {
        callbacks,
        getConnectConfig,
        getState,
        onOpen,
        onMessage,
        onFailure,
        scheduleReconnect,
        stop,
    };
}

module.exports = { createGeminiLiveRuntime };
