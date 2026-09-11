const test = require('node:test');
const assert = require('node:assert/strict');
const { createGeminiLiveRuntime } = require('../src/utils/geminiLiveRuntime');

function fakeTimers() {
    const timers = [];
    return {
        timers,
        setTimer(fn, ms) {
            const timer = { fn, ms, cancelled: false };
            timers.push(timer);
            return timer;
        },
        clearTimer(timer) {
            if (timer) timer.cancelled = true;
        },
        async runNext() {
            const timer = timers.find(item => !item.cancelled && !item.ran);
            assert.ok(timer, 'expected a pending timer');
            timer.ran = true;
            await timer.fn();
            return timer;
        },
    };
}

test('runtime exposes compression and ordinary resumption configuration', () => {
    const runtime = createGeminiLiveRuntime({ reconnect: async () => {} });
    assert.deepEqual(runtime.getConnectConfig(), {
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: {},
    });

    runtime.onMessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'safe-handle' } });
    assert.deepEqual(runtime.getConnectConfig().sessionResumption, { handle: 'safe-handle' });
});

test('GoAway schedules one controlled rotation using the safe resumption handle', async () => {
    let clock = 1000;
    const fake = fakeTimers();
    const reconnects = [];
    const runtime = createGeminiLiveRuntime({
        reconnect: async details => reconnects.push(details),
        now: () => clock,
        setTimer: fake.setTimer,
        clearTimer: fake.clearTimer,
    });

    runtime.onOpen();
    runtime.onMessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'resume-me' } });
    clock = 2000;
    const observed = runtime.onMessage({ goAway: { timeLeft: '2s' } });

    assert.equal(observed.shouldRotate, true);
    assert.equal(observed.rotateInMs, 1750);
    assert.equal(fake.timers.length, 1);
    assert.equal(fake.timers[0].ms, 1750);

    await fake.runNext();
    assert.equal(reconnects.length, 1);
    assert.equal(reconnects[0].reason, 'go-away');
    assert.deepEqual(reconnects[0].config.sessionResumption, { handle: 'resume-me' });
});

test('onerror followed by onclose schedules only one reconnect', () => {
    let clock = 1000;
    const fake = fakeTimers();
    const runtime = createGeminiLiveRuntime({
        reconnect: async () => {},
        normalizeFailure: value => value,
        now: () => clock,
        random: () => 0,
        setTimer: fake.setTimer,
        clearTimer: fake.clearTimer,
    });

    runtime.onOpen();
    const first = runtime.onFailure({ httpStatus: 503 }, 'error');
    clock = 1100;
    const duplicate = runtime.onFailure({ socketCode: 1006 }, 'close');

    assert.equal(first.recoverable, true);
    assert.equal(first.retryDelayMs, 750);
    assert.equal(duplicate.deduplicated, true);
    assert.equal(fake.timers.filter(item => !item.cancelled).length, 1);
    assert.equal(runtime.getState().failureStreak, 1);
});

test('non-recoverable failures are surfaced without a reconnect loop', () => {
    const fake = fakeTimers();
    const states = [];
    const runtime = createGeminiLiveRuntime({
        reconnect: async () => {},
        normalizeFailure: value => value,
        publishState: (state, failure) => states.push({ state, failure }),
        setTimer: fake.setTimer,
        clearTimer: fake.clearTimer,
    });

    const result = runtime.onFailure({ httpStatus: 401, category: 'authentication' });
    assert.equal(result.recoverable, false);
    assert.equal(fake.timers.length, 0);
    assert.equal(states.at(-1).state, 'failed');
    assert.equal(states.at(-1).failure.httpStatus, 401);
});

test('a reconnect failure is reclassified and rescheduled with bounded backoff', async () => {
    let clock = 1000;
    const fake = fakeTimers();
    let attempts = 0;
    const runtime = createGeminiLiveRuntime({
        reconnect: async () => {
            attempts += 1;
            throw { httpStatus: 503 };
        },
        normalizeFailure: value => value,
        now: () => clock,
        random: () => 0,
        setTimer: fake.setTimer,
        clearTimer: fake.clearTimer,
    });

    runtime.onFailure({ httpStatus: 503 });
    assert.equal(fake.timers[0].ms, 750);
    clock = 1750;
    await fake.runNext();

    assert.equal(attempts, 1);
    const pending = fake.timers.filter(item => !item.cancelled && !item.ran);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].ms, 1500);
    assert.equal(runtime.getState().failureStreak, 2);
});

test('stop cancels a planned GoAway rotation', () => {
    const fake = fakeTimers();
    const runtime = createGeminiLiveRuntime({
        reconnect: async () => {},
        setTimer: fake.setTimer,
        clearTimer: fake.clearTimer,
    });

    runtime.onMessage({ goAway: { timeLeft: '4s' } });
    assert.equal(fake.timers.length, 1);
    runtime.stop();
    assert.equal(fake.timers[0].cancelled, true);
    assert.equal(runtime.getState().stopped, true);
});
