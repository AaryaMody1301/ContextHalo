const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: tick } = require('node:timers/promises');
const { geminiFixture } = require('./helpers/gemini-fixture');
const { groqTranscriptText } = require('../src/utils/groqRequestPolicy');

function answer(text = '12') {
    return new Response('data:' + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }) + '\n\ndata:[DONE]\n\n');
}

async function audio(fixture, seconds, voiced, sampleRate = 24000, chunkSeconds = 0.1) {
    let remaining = Math.round(seconds * sampleRate);
    while (remaining > 0) {
        const samples = Math.min(remaining, Math.round(chunkSeconds * sampleRate));
        const pcm = Buffer.alloc(samples * 2);
        if (voiced) for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(6000 * Math.sin(i * Math.PI / 20)), i * 2);
        const result = await fixture.call('send-audio-content', { data: pcm.toString('base64'), mimeType: `audio/pcm;rate=${sampleRate}` });
        assert.equal(result.success, true, result.error);
        remaining -= samples;
    }
}

async function settle() {
    for (let i = 0; i < 10; i++) await tick();
}

function voiceFixture(options = {}) {
    const uploads = [];
    const chats = [];
    const fixture = geminiFixture({ audio: true, ...options,
        fetch: async (url, init) => {
            if (String(url).endsWith('/transcriptions')) {
                uploads.push(init);
                return options.transcribe ? options.transcribe(init, uploads.length)
                    : Response.json({ text: 'What is six plus six?', segments: [{ text: 'What is six plus six?', avg_logprob: -0.2, no_speech_prob: 0.01 }] });
            }
            chats.push(JSON.parse(init.body));
            return options.chat ? options.chat(init, chats.length) : answer();
        } });
    return { fixture, uploads, chats };
}

for (const [sampleRate, chunkSeconds] of [[16000, 0.02], [24000, 0.1], [48000, 0.25]]) {
    test(`Groq retains both sides of a thinking pause at ${sampleRate} Hz and ${chunkSeconds}s chunks`, async t => {
        const { fixture: f, uploads, chats } = voiceFixture();
        t.after(() => f.close());
        assert.equal((await f.start('groq')).success, true);
        await audio(f, 1, true, sampleRate, chunkSeconds);
        await audio(f, 1.2, false, sampleRate, chunkSeconds);
        await settle();
        assert.equal(uploads.length, 0, 'a mid-question pause must not trigger inference');
        await audio(f, 1, true, sampleRate, chunkSeconds);
        await audio(f, 1.7, false, sampleRate, chunkSeconds);
        await settle();
        assert.equal(uploads.length, 1);
        assert.equal(uploads[0].body.get('response_format'), 'verbose_json');
        assert.equal(uploads[0].body.get('temperature'), '0');
        const wav = Buffer.from(await uploads[0].body.get('file').arrayBuffer());
        assert.equal(wav.readUInt32LE(24), sampleRate);
        assert.ok(wav.length >= 44 + sampleRate * 2 * 4.7, 'the upload includes the beginning, pause and final words');
        assert.equal(chats.length, 1);
        assert.match(chats[0].messages.at(-1).content, /What is six plus six/);
        assert.equal(f.api.getCurrentSessionData().history.length, 1);
    });
}

test('Groq waits for silence after speech longer than the former 35 second limit', async t => {
    const { fixture: f, uploads, chats } = voiceFixture();
    t.after(() => f.close());
    await f.start('groq');
    await audio(f, 36, true);
    await settle();
    assert.equal(uploads.length, 0);
    assert.equal(chats.length, 0);
    await audio(f, 1.7, false);
    await settle();
    assert.equal(uploads.length, 1);
    assert.equal(chats.length, 1);
});

test('resumed speech cancels an unfinished transcription and retries the complete audio', async t => {
    let release;
    const { fixture: f, uploads, chats } = voiceFixture({
        transcribe: (_init, count) => count === 1 ? new Promise(resolve => { release = resolve; })
            : Response.json({ text: 'Complete question with the final condition' }),
    });
    t.after(() => f.close());
    await f.start('groq');
    await audio(f, 1, true);
    await audio(f, 1.7, false);
    await settle();
    assert.equal(uploads.length, 1);
    await audio(f, 1, true);
    assert.equal(uploads[0].signal.aborted, true);
    release(Response.json({ text: 'Incomplete question' }));
    await settle();
    assert.equal(chats.length, 0);
    await audio(f, 1.7, false);
    await settle();
    assert.equal(uploads.length, 2);
    assert.ok(uploads[1].body.get('file').size > uploads[0].body.get('file').size);
    assert.equal(chats.length, 1);
    assert.match(chats[0].messages.at(-1).content, /final condition/);
    assert.equal(f.api.getCurrentSessionData().history.length, 1);
});

test('resumed speech cancels a generating reply without saving the incomplete question', async t => {
    let release;
    let firstSignal;
    const { fixture: f, chats } = voiceFixture({ chat: (init, count) => {
        if (count > 1) return answer('Complete answer');
        firstSignal = init.signal;
        return new Promise(resolve => { release = resolve; });
    } });
    t.after(() => f.close());
    await f.start('groq');
    await audio(f, 1, true);
    await audio(f, 1.7, false);
    await settle();
    assert.equal(chats.length, 1);
    await audio(f, 1, true);
    release(answer('Answer to incomplete question'));
    await settle();
    assert.equal(f.api.getCurrentSessionData().history.length, 0);
    await audio(f, 1.7, false);
    await settle();
    assert.equal(chats.length, 2);
    assert.equal(f.api.getCurrentSessionData().history.length, 1);
    assert.equal(f.api.getCurrentSessionData().history[0].ai_response, 'Complete answer');
    // The voice request owns cancellation even when fetch itself ignores a signal.
    assert.equal(firstSignal.aborted, true);
});

test('noise, brief clicks and low-confidence non-speech never become Groq questions', async t => {
    const { fixture: f, uploads, chats } = voiceFixture({ transcribe: () => Response.json({
        text: 'Thank you for watching', segments: [{ text: 'Thank you for watching', avg_logprob: -1.8, no_speech_prob: 0.95 }],
    }) });
    t.after(() => f.close());
    await f.start('groq');
    await audio(f, 3, false);
    await audio(f, 0.12, true);
    await audio(f, 1.7, false);
    await settle();
    assert.equal(uploads.length, 0);
    await audio(f, 1, true);
    await audio(f, 1.7, false);
    await settle();
    assert.equal(uploads.length, 1);
    assert.equal(chats.length, 0);
    assert.equal(f.api.getCurrentSessionData().history.length, 0);
    assert.equal(groqTranscriptText({ text: 'Quiet speech', segments: [{ text: 'Quiet speech', no_speech_prob: 0.9, avg_logprob: -0.2 }] }), 'Quiet speech');
});

test('oversized speech is bounded and never answered as a truncated question', async t => {
    const { fixture: f, uploads } = voiceFixture();
    t.after(() => f.close());
    await f.start('groq');
    await audio(f, 121, true);
    await audio(f, 1.7, false);
    await settle();
    assert.equal(uploads.length, 0);
    assert.ok(f.events.some(([name, text]) => name === 'update-status' && /shorter question/.test(text)));
    await audio(f, 1, true);
    await audio(f, 1.7, false);
    await settle();
    assert.equal(uploads.length, 1);
});

test('closing or restarting capture invalidates pending Groq audio', async t => {
    let release;
    const { fixture: f, uploads, chats } = voiceFixture({ transcribe: () => new Promise(resolve => { release = resolve; }) });
    t.after(() => f.close());
    await f.start('groq');
    await audio(f, 1, true);
    await audio(f, 1.7, false);
    await settle();
    await f.close();
    assert.equal(uploads[0].signal.aborted, true);
    release(Response.json({ text: 'Ended session question' }));
    await settle();
    assert.equal(chats.length, 0);
    assert.equal(f.api.getCurrentSessionData().history.length, 0);
});
