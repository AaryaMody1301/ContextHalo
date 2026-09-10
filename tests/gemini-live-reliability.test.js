const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildLiveReliabilityConfig,
    retainSafeResumptionHandle,
    durationToMilliseconds,
    goAwayDelayMs,
    reconnectDelayMs,
    failureStreakAfterStablePeriod,
} = require('../src/utils/geminiLiveReliability');

test('Live reliability config enables compression and ordinary session resumption', () => {
    assert.deepEqual(buildLiveReliabilityConfig(), {
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: {},
    });
    assert.deepEqual(buildLiveReliabilityConfig(' resume-token '), {
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: { handle: 'resume-token' },
    });
    assert.equal(Object.hasOwn(buildLiveReliabilityConfig('token').sessionResumption, 'transparent'), false);
});

test('only a server-marked resumable update replaces the saved handle', () => {
    assert.equal(retainSafeResumptionHandle('old', { resumable: false, newHandle: 'unsafe' }), 'old');
    assert.equal(retainSafeResumptionHandle('old', { resumable: true, newHandle: '' }), 'old');
    assert.equal(retainSafeResumptionHandle('old', { resumable: true, newHandle: ' new ' }), 'new');
    assert.equal(retainSafeResumptionHandle(null, { resumable: true, newHandle: 'first' }), 'first');
});

test('GoAway duration parsing accepts protobuf object and JSON duration forms', () => {
    assert.equal(durationToMilliseconds('2.5s'), 2500);
    assert.equal(durationToMilliseconds({ seconds: '2', nanos: 500000000 }), 2500);
    assert.equal(goAwayDelayMs({ goAway: { timeLeft: { seconds: 4 } } }), 4000);
    assert.equal(durationToMilliseconds('invalid'), null);
    assert.equal(goAwayDelayMs({}), null);
});

test('reconnect backoff grows with bounded jitter and caps at fifteen seconds', () => {
    assert.equal(reconnectDelayMs(1, () => 0), 750);
    assert.equal(reconnectDelayMs(2, () => 0), 1500);
    assert.equal(reconnectDelayMs(3, () => 1), 3750);
    assert.equal(reconnectDelayMs(20, () => 1), 15000);
});

test('stable connections reset a consecutive failure streak', () => {
    assert.equal(failureStreakAfterStablePeriod(4, 1000, 30999), 4);
    assert.equal(failureStreakAfterStablePeriod(4, 1000, 31000), 0);
    assert.equal(failureStreakAfterStablePeriod(0, 1000, 5000), 0);
});
