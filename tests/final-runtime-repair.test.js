const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { geminiFixture } = require('./helpers/gemini-fixture');
const { appFixture, componentClass } = require('./helpers/component-fixture');
const { classifyGeminiFailure } = require('../src/utils/geminiFailure');
const { recoverGeminiSetup } = require('../src/utils/geminiSetupRecovery');
const { resizeBounds, createWindowModeController } = require('../src/utils/windowModeController');
const tick = () => new Promise(resolve => setImmediate(resolve));
const closed = reason => params => { params.callbacks.onopen({}); params.callbacks.onclose({ code: 1011, reason }); return new Promise(() => {}); };
const ready = () => ({ close() {}, sendRealtimeInput() {}, sendClientContent() {} });

for (const reason of ['Quota exceeded', 'RESOURCE_EXHAUSTED', '429 grounding quota exceeded']) {
    test(`Search setup ${reason}: one same-model control restores Live without changing HTTP Search`, async t => {
        const f = geminiFixture({ search: true, live: (params, n) => n === 1 ? closed(reason)(params) : ready() });
        t.after(() => f.close());
        const result = await f.start('byok', { uiEpoch: 3 });
        assert.equal(result.success, true);
        assert.equal(f.connections.length, 2);
        const [first, second] = f.connections;
        assert.equal(second.model, first.model);
        assert.deepEqual(second.config.sessionResumption, first.config.sessionResumption);
        assert.deepEqual(second.config.contextWindowCompression, first.config.contextWindowCompression);
        assert.equal(second.config.tools, undefined);
        assert.doesNotMatch(second.config.systemInstruction, /SEARCH TOOL USAGE/);
        assert.equal(result.search.liveEffective, false);
        assert.equal(result.search.httpEffective, true);
        assert.equal(f.preferences.googleSearchEnabled, true);
        assert.match(result.search.liveReason, /unconfirmed/);
        await f.call('send-text-message', 'Question');
        assert.ok(f.generated[0].config.tools.some(tool => tool.googleSearch));
        assert.match(f.generated[0].config.systemInstruction, /SEARCH TOOL USAGE/);
    });
}

test('failed quota control terminates after two setups and never claims Search is the cause', async t => {
    const f = geminiFixture({ search: true, live: closed('Quota exceeded') }); t.after(() => f.close());
    const result = await f.start();
    assert.equal(result.success, false);
    assert.equal(f.connections.length, 2);
    assert.equal(result.search.liveEffective, true, 'Failed diagnostic must not commit a Search fallback');
    assert.equal(result.failure.searchControl, 'failed');
    assert.equal(result.failure.quotaScope, 'unknown');
    assert.match(result.error, /no Search-specific cause/);
    assert.doesNotMatch(result.error, /project quota is exhausted|Turning Search off does not/);
});

test('quota control failure with transient status cannot cause another diagnostic attempt', async () => {
    let calls = 0;
    await assert.rejects(recoverGeminiSetup(async () => {
        calls++;
        throw { stage: 'setup', code: 1011, reason: calls === 1 ? 'Quota exceeded' : 'unavailable' };
    }, { searchEnabled: true, model: 'same-model' }), error => error.noRetryAfterSearchControl === true);
    assert.equal(calls, 2);
});

for (const reason of ['Internal server error', 'Invalid configuration', 'Quota exceeded']) {
    test(`failed Search comparison is terminal for ${reason}, including outer Live retries`, async t => {
        const f = geminiFixture({ search: true, live: closed(reason) });
        t.after(() => f.close());
        const result = await f.start();
        assert.equal(result.success, false);
        assert.equal(f.connections.length, 2);
        assert.equal(result.failure.searchControl, 'failed');
        assert.equal(result.failure.canDisableSearch, false);
        assert.equal(result.search.liveEffective, true);
        assert.equal(result.search.httpEffective, true);
        assert.deepEqual(f.connections[1].config.contextWindowCompression, f.connections[0].config.contextWindowCompression);
    });
}

test('setup control respects provider delay and cancellation without publishing false success', async () => {
    const controller = new AbortController(); let calls = 0; const waits = [];
    await assert.rejects(recoverGeminiSetup(async () => {
        calls++; throw { stage: 'setup', code: 1011, reason: 'Quota exceeded', headers: { 'retry-after': '2' } };
    }, { searchEnabled: true, signal: controller.signal, model: 'same-model',
        wait: async ms => { waits.push(ms); controller.abort(); }, onSearchFallback: () => assert.fail('No fallback was adopted') }), error => error.name === 'AbortError');
    assert.deepEqual(waits, [2000]); assert.equal(calls, 1);
});

test('quota diagnosis uses structured scope while keeping provider secrets out of the result', () => {
    for (const [metric, scope] of [['generate_content_requests', 'model'], ['grounding_requests', 'search']]) {
        const error = { status: 429, message: 'RESOURCE_EXHAUSTED confidential-key', details: [
            { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: metric, quotaId: 'per_day', description: 'private prompt' }] },
        ] };
        const failure = classifyGeminiFailure(error, 'live', 'model', 0, { searchAttached: true });
        assert.equal(failure.quotaScope, scope);
        assert.equal(failure.canDisableSearch, scope === 'search');
        assert.doesNotMatch(JSON.stringify(failure), /confidential-key|private prompt/);
    }
});

for (const operation of ['text', 'screen']) test(`${operation}: explicit HTTP Search opt-out neither reconnects nor disables Live`, async t => {
    const f = geminiFixture({ search: true, generate: async params => {
        if (params.config.tools) throw { status: 429, message: 'Quota exceeded' };
        return { text: 'Answer without Search' };
    } }); t.after(() => f.close());
    await f.start('byok', { uiEpoch: 9 });
    const send = () => operation === 'text' ? f.call('send-text-message', 'Question')
        : f.call('send-image-content', { data: Buffer.alloc(1100).toString('base64'), mimeType: 'image/jpeg', prompt: 'Analyze' });
    const failed = await send();
    assert.equal(failed.success, false); assert.equal(failed.failure.canDisableSearch, true);
    assert.equal((await f.call('disable-http-search', { uiEpoch: 8 })).success, false);
    const changed = await f.call('disable-http-search', { uiEpoch: 9 });
    assert.equal(changed.success, true);
    assert.equal(changed.search.liveEffective, true); assert.equal(changed.search.httpEffective, false);
    assert.equal((await send()).success, true);
    assert.equal(f.connections.length, 1); assert.equal(f.preferences.googleSearchEnabled, true);
    assert.doesNotMatch(f.generated.at(-1).config.systemInstruction, /SEARCH TOOL USAGE/);
});

test('HTTP retry-without-Search is owned by the failed request, not the Live reconnect action', async () => {
    const calls = [];
    const f = appFixture({ ipc: async (channel, options) => {
        calls.push([channel, options]);
        return { success: true, search: { requested: true, liveEffective: true, httpEffective: false } };
    } }); await tick();
    f.app._sessionStarted = true; f.app._setLifecycle('active');
    f.app.navigate = () => {};
    let retried;
    f.app.shadowRoot.querySelector = () => ({ handleSendText: value => { retried = value; } });
    const request = f.app._beginRequest('text', { text: 'Retain this exact question' });
    f.app._finishRequest(request, { success: false, failure: { message: 'Quota limit', canDisableSearch: true } });
    await f.app.retryRequest(true);
    assert.equal(calls.filter(([channel]) => channel === 'disable-http-search').length, 1);
    assert.equal(calls.some(([channel]) => channel === 'retry-session-connection'), false);
    assert.equal(retried.retryText, 'Retain this exact question');
});

test('resize math preserves opposite edges, fractional DIP positions and small/negative-origin displays', () => {
    const area = { x: -1920, y: -200, width: 1920, height: 1080 };
    const bounds = { x: -1400, y: 0, width: 800, height: 500 };
    const result = resizeBounds(bounds, 'nw', -80.5, -40.5, area);
    assert.equal(result.x + result.width, bounds.x + bounds.width);
    assert.equal(result.y + result.height, bounds.y + bounds.height);
    assert.deepEqual(resizeBounds(bounds, 'se', 10000, 10000, area), { x: -1400, y: 0, width: 1400, height: 880 });
    const small = { x: 0, y: 0, width: 512, height: 300 };
    assert.deepEqual(resizeBounds(small, 'nw', 500, 500, small), small);
    assert.equal(resizeBounds(bounds, 'invalid', 1, 1, area), null);
    assert.equal(resizeBounds(bounds, 'se', NaN, 1, area), null);
});

test('resize controller rejects stale gestures and never enables native resizing or fades foreground', () => {
    let bounds = { x: 50, y: 50, width: 800, height: 500 }, cursor = { x: 850, y: 550 }, visible = true;
    const window = { getBounds: () => bounds, isDestroyed: () => false, isVisible: () => visible, isFocused: () => true,
        setBounds: value => { bounds = value; }, setMinimumSize() {}, setContentProtection() {}, setBackgroundMaterial() {},
        setResizable() { assert.fail('Native resizing breaks transparency'); }, setOpacity() { assert.fail('Never fade text'); } };
    const screen = { getCursorScreenPoint: () => cursor, getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) };
    const controller = createWindowModeController(window, screen);
    assert.equal(controller.resize({ phase: 'update' }).success, false);
    assert.equal(controller.resize({ phase: 'begin', edge: 'se', width: 99999 }).success, true);
    cursor = { x: 930, y: 590 };
    assert.equal(controller.resize({ phase: 'update' }).success, true);
    assert.equal(bounds.width, 880); assert.equal(bounds.height, 540);
    controller.cancelResize();
    assert.equal(controller.resize({ phase: 'update' }).success, false);
    controller.resize({ phase: 'keyboard', key: 'ArrowLeft', large: true }); assert.equal(bounds.width, 840);
    visible = false; assert.equal(controller.resize({ phase: 'begin', edge: 'se' }).success, false);
});

test('resize renderer bounds in-flight IPC and releases pointer capture on teardown', async () => {
    const calls = []; let resolveUpdate;
    const { Target, context } = componentClass('src/components/WindowResizeHandles.js', 'WindowResizeHandles');
    context.window.electronAPI.invoke = async (_channel, request) => {
        calls.push(request.phase);
        if (request.phase === 'update') return new Promise(resolve => { resolveUpdate = resolve; });
        return { success: true };
    };
    let captured = false;
    const element = { setPointerCapture() { captured = true; }, hasPointerCapture: () => captured, releasePointerCapture() { captured = false; } };
    const view = new Target();
    await view.begin({ button: 0, pointerId: 7, currentTarget: element, preventDefault() {} }, 'se');
    const first = view.move({ pointerId: 7 }); await view.move({ pointerId: 7 });
    assert.deepEqual(calls, ['begin', 'update']);
    view.finish(); assert.equal(captured, false);
    resolveUpdate({ success: true }); await first;
    assert.deepEqual(calls, ['begin', 'update', 'end']); assert.equal(view._gesture, null);
});

test('unsupported transparent-window and duplicate maximize owners are removed', () => {
    const window = fs.readFileSync('src/utils/window.js', 'utf8');
    assert.match(window, /transparent: true/); assert.match(window, /resizable: false/); assert.match(window, /thickFrame: false/);
    assert.match(window, /contentProtection:\s*!process\.argv\.includes\('--ci-smoke-test'\)/);
    assert.doesNotMatch(fs.readFileSync('src/utils/windowModeController.js', 'utf8'), /setResizable\(true\)|\.maximize\(/);
    assert.doesNotMatch(fs.readFileSync('src/utils/runtimeHardeningMain.js', 'utf8'), /setupRuntimeWindowHardening|window-toggle-maximize/);
});

test('Search fallback on reconnect starts fresh rather than reusing a Search-enabled resumption handle', async t => {
    const content = [];
    const f = geminiFixture({ search: true, live: (params, n) => {
        if (n === 2) return closed('Quota exceeded')(params);
        return { ...ready(), sendClientContent: value => content.push(value) };
    } }); t.after(() => f.close());
    await f.start('byok', { uiEpoch: 13 });
    f.api.saveConversationTurn('Remember this', 'Context');
    f.callbacks.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'search-handle' } });
    const result = await f.call('retry-session-connection', { withoutSearch: false });
    assert.equal(result.success, true);
    assert.equal(f.connections.length, 3);
    assert.equal(f.connections[1].config.sessionResumption.handle, 'search-handle');
    assert.equal(f.connections[2].config.sessionResumption.handle, undefined);
    assert.equal(f.connections[2].config.tools, undefined);
    assert.equal(f.connections[2].config.historyConfig.initialHistoryInClientContent, true);
    assert.equal(content.length, 1);
    assert.match(JSON.stringify(content), /Remember this/);
    assert.equal(result.search.httpEffective, true);
});
