const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: tick } = require('node:timers/promises');
const { geminiFixture } = require('./helpers/gemini-fixture');

const screenPayload = () => ({
    data: Buffer.alloc(1200).toString('base64'),
    mimeType: 'image/jpeg',
    prompt: 'Analyze the visible interview question',
});

test('Analyze Screen remains usable while Gemini Live reconnect is pending', async t => {
    let releaseReconnect;
    const reconnectGate = new Promise(resolve => { releaseReconnect = resolve; });
    const liveSessions = [];
    const fixture = geminiFixture({
        generate: async () => ({ text: 'Screen answer during reconnect' }),
        live: async (_params, count) => {
            const session = { close() {}, sendRealtimeInput() {} };
            liveSessions.push(session);
            if (count === 1) return session;
            await reconnectGate;
            return session;
        },
    });
    t.after(() => fixture.close());

    assert.equal((await fixture.start()).success, true);
    fixture.callbacks.onerror({ status: 503, message: 'Service unavailable' });
    await tick();
    assert.equal(fixture.connections.length, 2, 'automatic reconnect has started');

    const screen = await fixture.call('send-image-content', screenPayload());
    assert.equal(screen.success, true);
    assert.equal(screen.text, 'Screen answer during reconnect');

    releaseReconnect();
    await tick();
    await tick();
    assert.equal(fixture.connections.length, 2);
});

test('six Live connection rotations preserve context with interleaved screen analysis', async t => {
    const fixture = geminiFixture({ generate: async (_params, count) => ({ text: `Screen answer ${count}` }) });
    t.after(() => fixture.close());

    assert.equal((await fixture.start()).success, true);
    assert.equal(fixture.connections.length, 1);

    for (let rotation = 1; rotation <= 6; rotation++) {
        const handle = `soak-handle-${rotation}`;
        const callbacks = fixture.callbacks;
        callbacks.onmessage({
            sessionResumptionUpdate: { resumable: true, newHandle: handle },
            goAway: { timeLeft: '0.25s' },
        });
        await tick();
        await tick();

        assert.equal(fixture.connections.length, rotation + 1, `rotation ${rotation} opened one replacement connection`);
        assert.deepEqual(fixture.connections.at(-1).config.sessionResumption, { handle });

        const screen = await fixture.call('send-image-content', screenPayload());
        assert.equal(screen.success, true);
        assert.equal(screen.text, `Screen answer ${rotation}`);
    }

    assert.equal(fixture.connections.length, 7, 'six controlled rotations require seven connections');
    assert.equal(fixture.realtime.some(item => String(item?.text || '').includes('Session reconnected.')), false,
        'server-resumed rotations must not duplicate local history');
});
