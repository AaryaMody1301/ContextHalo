const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { runSessionRequest, resetSessionRequests, closeSessionRequests, getRequestMetadata, requestIsCurrent } = require('../src/utils/sessionRequests');

test('request queue serializes history changes and keeps per-request metadata', async () => {
    resetSessionRequests();
    const order = [];
    const first = runSessionRequest('text', async () => { order.push('a'); await delay(10); order.push(getRequestMetadata().kind); });
    const second = runSessionRequest('screen', async () => { order.push('b'); });
    await Promise.all([first, second]);
    assert.deepEqual(order, ['a', 'text', 'b']);
});

test('closing a session cancels active/queued work and suppresses late callbacks', async () => {
    resetSessionRequests();
    let finish;
    let lateIsCurrent;
    let queuedRan = false;
    const first = runSessionRequest('text', async () => { await new Promise(resolve => { finish = resolve; }); lateIsCurrent = requestIsCurrent(); });
    const second = runSessionRequest('screen', () => { queuedRan = true; });
    const a = assert.rejects(first, /Session ended/);
    const b = assert.rejects(second, /Session ended/);
    await delay(0);
    closeSessionRequests();
    resetSessionRequests();
    finish();
    await Promise.all([a,b]);
    await delay(0);
    assert.equal(queuedRan, false);
    assert.equal(lateIsCurrent, false);
    assert.equal(await runSessionRequest('text', () => 'new session'), 'new session');
});

test('hard deadline releases the queue even when a provider ignores abort', async () => {
    resetSessionRequests();
    await assert.rejects(runSessionRequest('text', () => new Promise(() => {}), { timeoutMs: 15 }), /timed out/);
    assert.equal(await runSessionRequest('text', () => 'recovered'), 'recovered');
});

test('nested provider calls retain the parent request instead of deadlocking', async () => {
    resetSessionRequests();
    const id = await runSessionRequest('text', () => runSessionRequest('voice', () => getRequestMetadata().requestId), { requestId: 'typed-1' });
    assert.equal(id, 'typed-1');
});
