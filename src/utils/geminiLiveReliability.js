const DEFAULT_RECONNECT_BASE_MS = 750;
const DEFAULT_RECONNECT_CAP_MS = 15000;
const DEFAULT_STABLE_RESET_MS = 30000;

function normalizeHandle(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildLiveReliabilityConfig(resumptionHandle = null) {
    const handle = normalizeHandle(resumptionHandle);
    return {
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: handle ? { handle } : {},
    };
}

function retainSafeResumptionHandle(currentHandle, update) {
    const previous = normalizeHandle(currentHandle);
    if (update?.resumable === false) return null;
    if (!update || update.resumable !== true) return previous;
    return normalizeHandle(update.newHandle) || previous;
}

function durationToMilliseconds(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : null;
    if (typeof value === 'string') {
        const match = value.trim().match(/^(\d+(?:\.\d+)?)s$/);
        return match ? Math.round(Number(match[1]) * 1000) : null;
    }
    if (typeof value === 'object') {
        const seconds = Number(value.seconds || 0);
        const nanos = Number(value.nanos || 0);
        if (!Number.isFinite(seconds) || !Number.isFinite(nanos) || seconds < 0 || nanos < 0) return null;
        return Math.round(seconds * 1000 + nanos / 1e6);
    }
    return null;
}

function goAwayDelayMs(message) {
    return durationToMilliseconds(message?.goAway?.timeLeft);
}

function reconnectDelayMs(failureStreak, random = Math.random, options = {}) {
    const baseMs = Number.isFinite(options.baseMs) ? Math.max(1, options.baseMs) : DEFAULT_RECONNECT_BASE_MS;
    const capMs = Number.isFinite(options.capMs) ? Math.max(baseMs, options.capMs) : DEFAULT_RECONNECT_CAP_MS;
    const streak = Math.max(1, Math.floor(Number(failureStreak) || 1));
    const exponential = Math.min(capMs, baseMs * 2 ** Math.min(streak - 1, 6));
    const sample = Math.min(1, Math.max(0, Number(random()) || 0));
    const jitter = Math.round(exponential * 0.25 * sample);
    return Math.min(capMs, exponential + jitter);
}

function failureStreakAfterStablePeriod(failureStreak, connectedAt, now = Date.now(), stableResetMs = DEFAULT_STABLE_RESET_MS) {
    if (!Number.isFinite(connectedAt) || connectedAt <= 0) return Math.max(0, Number(failureStreak) || 0);
    return now - connectedAt >= stableResetMs ? 0 : Math.max(0, Number(failureStreak) || 0);
}

module.exports = {
    buildLiveReliabilityConfig,
    retainSafeResumptionHandle,
    durationToMilliseconds,
    goAwayDelayMs,
    reconnectDelayMs,
    failureStreakAfterStablePeriod,
    _constants: {
        DEFAULT_RECONNECT_BASE_MS,
        DEFAULT_RECONNECT_CAP_MS,
        DEFAULT_STABLE_RESET_MS,
    },
};
