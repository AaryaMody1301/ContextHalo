const test = require('node:test');
const assert = require('node:assert/strict');
const { geminiFixture } = require('./helpers/gemini-fixture');

function pcmChunk(sampleRate, seconds = 0.1) {
    const samples = Math.round(sampleRate * seconds);
    const buffer = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) buffer.writeInt16LE((i % 200) - 100, i * 2);
    return buffer;
}

test('Gemini audio is normalized to native 16 kHz without changing other provider input contracts', async t => {
    const f = geminiFixture();
    t.after(() => f.close());
    assert.equal((await f.start()).success, true);

    const source = pcmChunk(24000);
    const result = await f.call('send-audio-content', {
        data: source.toString('base64'),
        mimeType: 'audio/pcm;rate=24000',
    });
    assert.equal(result.success, true);
    const sent = f.realtime.at(-1)?.audio;
    assert.equal(sent.mimeType, 'audio/pcm;rate=16000');
    assert.equal(Buffer.from(sent.data, 'base64').length, 16000 * 0.1 * 2);
});

test('Gemini microphone audio also uses 16 kHz and audioStreamEnd closes a paused capture stream', async t => {
    const f = geminiFixture();
    t.after(() => f.close());
    assert.equal((await f.start()).success, true);

    const source = pcmChunk(48000);
    assert.equal((await f.call('send-mic-audio-content', {
        data: source.toString('base64'),
        mimeType: 'audio/pcm;rate=48000',
    })).success, true);
    const sent = f.realtime.at(-1)?.audio;
    assert.equal(sent.mimeType, 'audio/pcm;rate=16000');
    assert.equal(Buffer.from(sent.data, 'base64').length, 16000 * 0.1 * 2);

    assert.equal((await f.call('audio-stream-end')).success, true);
    assert.equal(f.realtime.at(-1)?.audioStreamEnd, true);
});
