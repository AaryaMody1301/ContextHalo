const {
    buildLiveReliabilityConfig,
    retainSafeResumptionHandle,
    goAwayDelayMs,
    reconnectDelayMs,
    failureStreakAfterStablePeriod,
} = require('./geminiLiveReliability');

const GO_AWAY_ROTATION_MARGIN_MS = 250;

function createLiveRecoveryState() {
    return {
        resumptionHandle: null,
        failureStreak: 0,
        connectedAt: 0,
        lastMessageAt: 0,
        plannedRotationAt: null,
    };
}

function liveConnectReliabilityConfig(state) {
    return buildLiveReliabilityConfig(state?.resumptionHandle || null);
}

function markLiveConnected(state, now = Date.now()) {
    return {
        ...state,
        connectedAt: now,
        lastMessageAt: now,
        plannedRotationAt: null,
    };
}

function observeLiveMessage(state, message, now = Date.now()) {
    const nextHandle = retainSafeResumptionHandle(state?.resumptionHandle, message?.sessionResumptionUpdate);
    const goAwayMs = goAwayDelayMs(message);
    const rotateInMs = goAwayMs === null ? null : Math.max(0, goAwayMs - GO_AWAY_ROTATION_MARGIN_MS);
    return {
        state: {
            ...state,
            resumptionHandle: nextHandle,
            lastMessageAt: now,
            plannedRotationAt: rotateInMs === null ? state?.plannedRotationAt ?? null : now + rotateInMs,
        },
        shouldRotate: rotateInMs !== null,
        rotateInMs,
    };
}

function normalizedStatusText(failure) {
    return [failure?.providerStatus, failure?.status, failure?.codeName, failure?.message]
        .filter(value => typeof value === 'string')
        .join(' ')
        .toLowerCase();
}

function isRecoverableLiveFailure(failure) {
    const category = String(failure?.category || '').toLowerCase();
    if (['transient', 'aborted-conflict'].includes(category)) return true;

    const httpStatus = Number(failure?.httpStatus ?? failure?.statusCode ?? failure?.status);
    const socketCode = Number(failure?.socketCode ?? failure?.code);
    const text = normalizedStatusText(failure);

    if (httpStatus === 409) return /\baborted\b/.test(text) && !/already[_ -]?exists/.test(text);
    if ([408, 500, 502, 503, 504].includes(httpStatus)) return true;
    if ([1006, 1011, 1012, 1013].includes(socketCode)) return true;
    return false;
}

function recordLiveFailure(state, failure, now = Date.now(), random = Math.random) {
    const previousStreak = failureStreakAfterStablePeriod(
        state?.failureStreak || 0,
        state?.connectedAt || 0,
        now
    );
    const failureStreak = previousStreak + 1;
    const recoverable = isRecoverableLiveFailure(failure);

    return {
        state: {
            ...state,
            failureStreak,
            connectedAt: 0,
            plannedRotationAt: null,
        },
        recoverable,
        retryDelayMs: recoverable ? reconnectDelayMs(failureStreak, random) : null,
        useResumption: recoverable && Boolean(state?.resumptionHandle),
    };
}

module.exports = {
    createLiveRecoveryState,
    liveConnectReliabilityConfig,
    markLiveConnected,
    observeLiveMessage,
    isRecoverableLiveFailure,
    recordLiveFailure,
    _constants: { GO_AWAY_ROTATION_MARGIN_MS },
};
