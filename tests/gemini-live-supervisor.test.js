const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createLiveRecoveryState,
    liveConnectReliabilityConfig,
    markLiveConnected,
    observeLiveMessage,
    isRecoverableLiveFailure,
    recordLiveFailure,
} = require('../src/utils/geminiLiveSupervisor');

test('new Live recovery state enables compression and requests resumption updates', () => {
    const state = createLiveRecoveryState();
    assert.deepEqual(liveConnectReliabilityConfig(state), {
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: {},
    });
});

test('only safe resumable handles are carried into the next Live connection', () => {
    let state = createLiveRecoveryState();
    state = observeLiveMessage(state, { sessionResumptionUpdate: { resumable: false, newHandle: 'unsafe' } }, 1000).state;
    assert.equal(state.resumptionHandle, null);

    state = observeLiveMessage(state, { sessionResumptionUpdate: { resumable: true, newHandle: 'safe-token' } }, 1100).state;
    assert.equal(state.resumptionHandle, 'safe-token');
    assert.deepEqual(liveConnectReliabilityConfig(state).sessionResumption, { handle: 'safe-token' });
});

test('GoAway schedules controlled rotation before the provider deadline', () => {
    const state = markLiveConnected(createLiveRecoveryState(), 1000);
    const observed = observeLiveMessage(state, { goAway: { timeLeft: '2s' } }, 2000);
    assert.equal(observed.shouldRotate, true);
    assert.equal(observed.rotateInMs, 1750);
    assert.equal(observed.state.plannedRotationAt, 3750);
});

test('409 ABORTED is recoverable but ALREADY_EXISTS is not blindly retried', () => {
    assert.equal(isRecoverableLiveFailure({ httpStatus: 409, providerStatus: 'ABORTED' }), true);
    assert.equal(isRecoverableLiveFailure({ httpStatus: 409, providerStatus: 'ALREADY_EXISTS' }), false);
    assert.equal(isRecoverableLiveFailure({ httpStatus: 401, providerStatus: 'UNAUTHENTICATED' }), false);
});

test('transient server and socket failures remain recoverable', () => {
    for (const httpStatus of [408, 500, 502, 503, 504]) {
        assert.equal(isRecoverableLiveFailure({ httpStatus }), true);
    }
    for (const socketCode of [1006, 1011, 1012, 1013]) {
        assert.equal(isRecoverableLiveFailure({ socketCode }), true);
    }
});

test('failure streak is consecutive and resets after a stable connection', () => {
    let state = markLiveConnected({ ...createLiveRecoveryState(), failureStreak: 4 }, 1000);
    const afterStableFailure = recordLiveFailure(state, { category: 'transient' }, 31000, () => 0);
    assert.equal(afterStableFailure.state.failureStreak, 1);
    assert.equal(afterStableFailure.retryDelayMs, 750);

    state = markLiveConnected({ ...afterStableFailure.state, resumptionHandle: 'resume' }, 40000);
    const quickFailure = recordLiveFailure(state, { category: 'transient' }, 40500, () => 0);
    assert.equal(quickFailure.state.failureStreak, 2);
    assert.equal(quickFailure.retryDelayMs, 1500);
    assert.equal(quickFailure.useResumption, true);
});

test('non-recoverable failures do not schedule reconnects', () => {
    const state = markLiveConnected(createLiveRecoveryState(), 1000);
    const result = recordLiveFailure(state, { category: 'authentication', httpStatus: 401 }, 1200, () => 0);
    assert.equal(result.recoverable, false);
    assert.equal(result.retryDelayMs, null);
    assert.equal(result.useResumption, false);
});
