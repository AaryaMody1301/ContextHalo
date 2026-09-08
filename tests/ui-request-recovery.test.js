const test = require('node:test');
const assert = require('node:assert/strict');
const { appFixture, componentClass } = require('./helpers/component-fixture');
const { geminiFixture } = require('./helpers/gemini-fixture');
const tick = () => new Promise(resolve => setImmediate(resolve));

function requestApp() {
    const f = appFixture();
    f.app._scheduleRecoveryRefresh = () => {};
    return f;
}
for (const operation of ['text', 'screen']) test(`${operation}: failure followed by retry success clears only owned recovery actions`, async () => {
    const { app } = requestApp();
    await tick();
    const first = app._beginRequest(operation, operation === 'text' ? { text: 'original' } : { region: { x: 1 } });
    app._finishRequest(first, { success: false, error: 'Temporary problem' });
    assert.equal(app.requestError.requestId, first.requestId);
    const retry = app._beginRequest(operation, first.retry);
    app._finishRequest(retry, { success: true });
    assert.equal(app.requestError, null);
    app.handleRequestError({ message: 'Late obsolete failure' }, { requestId: first.requestId, kind: operation, uiEpoch: first.uiEpoch });
    app.handleRequestError({ message: 'Failure after completed result' }, { requestId: retry.requestId, kind: operation, uiEpoch: retry.uiEpoch });
    assert.equal(app.requestError, null);
});

test('an older success cannot clear a newer unrelated failure or provider connection error', async () => {
    const { app } = requestApp(); await tick();
    app.providerError = { message: 'Provider disconnected' };
    const text = app._beginRequest('text', { text: 'old' });
    const screen = app._beginRequest('screen', {});
    app._finishRequest(screen, { success: false, error: 'New screenshot failure' });
    app._finishRequest(text, { success: true });
    assert.equal(app.requestError.requestId, screen.requestId);
    assert.equal(app.providerError.message, 'Provider disconnected');
    const another = app._beginRequest('text', { text: 'new' });
    app._finishRequest(another, { success: false, error: 'Newest text failure' });
    app._finishRequest(text, { success: true });
    assert.equal(app.requestError.requestId, another.requestId);
});

test('end/restart and cancellation cannot resurrect stale request recovery or answers', async () => {
    const { app } = requestApp(); await tick();
    const old = app._beginRequest('text', { text: 'first session' });
    await app.endSession();
    app.handleRequestError({ message: 'late failure' }, { requestId: old.requestId, uiEpoch: old.uiEpoch, kind: 'text' });
    app._finishRequest(old, { success: false, error: 'late error' });
    app.addNewResponse('late answer', { requestId: old.requestId, uiEpoch: old.uiEpoch });
    assert.equal(app.requestError, null); assert.equal(app.responses.length, 0);
    const next = app._beginRequest('screen', {});
    app._finishRequest(next, { success: false, error: 'failed' });
    const retry = app._beginRequest('screen', {});
    app._finishRequest(retry, { success: false, cancelled: true });
    assert.equal(app.requestError, null);
});

test('Retry preserves the original operation and respects cooldown and session availability', async () => {
    const { app } = requestApp(); await tick();
    app._sessionStarted = true; app._setLifecycle('active');
    const calls = [];
    app.shadowRoot.querySelector = () => ({ handleScreenAnswer: value => calls.push(['screen', value]), handleSendText: value => calls.push(['text', value]) });
    app.navigate = () => {};
    const text = app._beginRequest('text', { text: 'original failed question' });
    app._finishRequest(text, { success: false, failure: { message: 'Wait', retryAt: Date.now() + 60000 } });
    await app.retryRequest(); assert.equal(calls.length, 0);
    app.requestError.retryAt = 0;
    await app.retryRequest(); assert.equal(calls[0][1].retryText, 'original failed question');
    const screen = app._beginRequest('screen', { region: { x: 5, y: 7, width: 100, height: 100 } });
    app._finishRequest(screen, { success: false, error: 'Screen failed' });
    await app.retryRequest(); assert.equal(calls[1][0], 'screen'); assert.equal(calls[1][1].region.x, 5);
    app._sessionStarted = false; app._setLifecycle('idle'); await app.retryRequest(); assert.equal(calls.length, 2);
});

test('retrying the old text sends that text without erasing a newer draft or stealing focus', async () => {
    const { Target } = componentClass('src/components/views/AssistantView.js', 'AssistantView', { expandQuickCommand: () => null });
    const sent = [], field = { value: 'new draft', focus() { assert.fail('No async focus stealing'); } };
    const view = Object.assign(Object.create(Target.prototype), {
        shadowRoot: { querySelector: () => field }, onSendText: async text => { sent.push(text); return { success: true }; },
        sending: false, retryBlocked: false, draft: 'new draft', dispatchEvent() {},
    });
    assert.equal((await view.handleSendText({ retryText: 'old failed question' })).success, true);
    assert.deepEqual(sent, ['old failed question']); assert.equal(field.value, 'new draft');
});

for (const provider of ['byok', 'groq', 'local']) test(`${provider}: actual IPC results retain request ID, operation and UI epoch`, async t => {
    const f = geminiFixture(); t.after(() => f.close());
    await f.start(provider, { uiEpoch: 37 });
    const result = await f.call('send-text-message', 'controlled text', { requestId: 'ui-37-test', uiEpoch: 37 });
    assert.equal(result.success, true);
    const metadata = result.request;
    assert.equal(metadata.requestId, 'ui-37-test');
    assert.equal(metadata.kind, 'text'); assert.equal(metadata.uiEpoch, 37);
    const stale = await f.call('send-text-message', 'stale request', { requestId: 'ui-36-test', uiEpoch: 36 });
    assert.notEqual(stale.success, true);
});

test('new background cards do not pull a reader away, but a deliberate current question can follow', async () => {
    const { app } = requestApp(); await tick();
    app.responses = ['A long answer being read']; app.currentResponseIndex = 0;
    app.shadowRoot.querySelector = () => ({ canFollowResponse: () => false });
    app.addNewResponse('New live voice answer', { requestId: 'voice-reading', kind: 'voice' });
    assert.equal(app.currentResponseIndex, 0);
    app.currentResponseIndex = app.responses.length - 1;
    const owner = app._beginRequest('text', { text: 'deliberate question' });
    app.addNewResponse('Answer to deliberate question', { requestId: owner.requestId, uiEpoch: owner.uiEpoch, kind: 'text' });
    assert.equal(app.currentResponseIndex, 2);
    app.currentResponseIndex = 0;
    app.addNewResponse('Another response', { requestId: 'voice-older', kind: 'voice' });
    assert.equal(app.currentResponseIndex, 0);
});
