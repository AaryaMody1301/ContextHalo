const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { runSessionRequest, resetSessionRequests, closeSessionRequests, getRequestMetadata, requestIsCurrent } = require('../src/utils/sessionRequests');

test('conversation requests serialize history changes and keep per-request metadata', async () => {
    resetSessionRequests();
    const order = [];
    const first = runSessionRequest('text', async () => { order.push('a'); await delay(10); order.push(getRequestMetadata().kind); });
    const second = runSessionRequest('voice', async () => { order.push('b'); });
    await Promise.all([first, second]);
    assert.deepEqual(order, ['a', 'text', 'b']);
});

test('screen analysis does not wait behind long-running interview work', async () => {
    resetSessionRequests();
    let releaseVoice;
    let voiceStarted = false;
    const voice = runSessionRequest('voice', async () => {
        voiceStarted = true;
        await new Promise(resolve => { releaseVoice = resolve; });
        return 'voice complete';
    });
    await delay(0);
    assert.equal(voiceStarted, true);

    const screen = await runSessionRequest('screen', () => ({ success: true, kind: getRequestMetadata().kind }), { timeoutMs: 100 });
    assert.deepEqual(screen, { success: true, kind: 'screen' });

    releaseVoice();
    assert.equal(await voice, 'voice complete');
});

test('screen requests remain serialized with other screen requests', async () => {
    resetSessionRequests();
    const order = [];
    const first = runSessionRequest('screen', async () => { order.push('first-start'); await delay(10); order.push('first-end'); });
    const second = runSessionRequest('screen', async () => { order.push('second'); });
    await Promise.all([first, second]);
    assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});

test('closing a session cancels active/queued work and suppresses late callbacks', async () => {
    resetSessionRequests();
    let finish;
    let lateIsCurrent;
    let queuedRan = false;
    const first = runSessionRequest('text', async () => { await new Promise(resolve => { finish = resolve; }); lateIsCurrent = requestIsCurrent(); });
    const second = runSessionRequest('voice', () => { queuedRan = true; });
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

test('hard deadline releases a lane even when a provider ignores abort', async () => {
    resetSessionRequests();
    await assert.rejects(runSessionRequest('text', () => new Promise(() => {}), { timeoutMs: 15 }), /timed out/);
    assert.equal(await runSessionRequest('text', () => 'recovered'), 'recovered');
});

test('nested provider calls retain the parent request instead of deadlocking', async () => {
    resetSessionRequests();
    const id = await runSessionRequest('text', () => runSessionRequest('voice', () => getRequestMetadata().requestId), { requestId: 'typed-1' });
    assert.equal(id, 'typed-1');
});