const test = require('node:test');
const assert = require('node:assert/strict');
const { geminiFixture } = require('./helpers/gemini-fixture');

test('production Live connection enables compression and resumption updates', async () => {
    const fixture = geminiFixture();
    const result = await fixture.start('byok', { uiEpoch: 1 });

    assert.equal(result.success, true);
    assert.equal(fixture.connections.length, 1);
    assert.deepEqual(fixture.connections[0].config.contextWindowCompression, { slidingWindow: {} });
    assert.deepEqual(fixture.connections[0].config.sessionResumption, {});
});

test('409 ABORTED is retryable but ALREADY_EXISTS is not', () => {
    const fixture = geminiFixture();
    const aborted = fixture.api.classifyGeminiFailure({ status: 409, message: 'ABORTED' }, 'live', 'gemini-3.1-flash-live-preview');
    const exists = fixture.api.classifyGeminiFailure({ status: 409, message: 'ALREADY_EXISTS' }, 'live', 'gemini-3.1-flash-live-preview');

    assert.equal(aborted.category, 'aborted-conflict');
    assert.equal(aborted.retryable, true);
    assert.equal(exists.retryable, false);
});

test('manual reconnect uses a safe server resumption handle without replaying local history', async () => {
    const fixture = geminiFixture();
    const started = await fixture.start('byok', { uiEpoch: 2 });
    assert.equal(started.success, true);

    fixture.api.saveConversationTurn('What did we discuss?', 'Data pipelines.');
    fixture.callbacks.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'safe-handle' } });

    const result = await fixture.call('retry-session-connection', { withoutSearch: false });
    assert.equal(result.success, true);
    assert.equal(fixture.connections.length, 2);
    assert.deepEqual(fixture.connections[1].config.sessionResumption, { handle: 'safe-handle' });
    assert.equal(fixture.realtime.some(item => String(item?.text || '').includes('Session reconnected.')), false);
});

test('manual reconnect falls back to local history when no safe resumption handle exists', async () => {
    const fixture = geminiFixture();
    const started = await fixture.start('byok', { uiEpoch: 3 });
    assert.equal(started.success, true);

    fixture.api.saveConversationTurn('What did we discuss?', 'Data pipelines.');
    fixture.callbacks.onmessage({ sessionResumptionUpdate: { resumable: false, newHandle: 'unsafe-handle' } });

    const result = await fixture.call('retry-session-connection', { withoutSearch: false });
    assert.equal(result.success, true);
    assert.equal(fixture.connections.length, 2);
    assert.deepEqual(fixture.connections[1].config.sessionResumption, {});
    assert.equal(fixture.realtime.some(item => String(item?.text || '').includes('Session reconnected.')), true);
});
