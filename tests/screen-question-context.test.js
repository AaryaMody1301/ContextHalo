const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: tick } = require('node:timers/promises');
const { geminiFixture } = require('./helpers/gemini-fixture');
const { loadMain } = require('./helpers/native-boundary');

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1300, 7)]).toString('base64');
const spokenQuestion = 'Which blue badge belongs to the final column?';

for (const [provider, model] of [
    ['byok', 'gemini-3.8-flash'], ['byok', 'gemini-4-hydrogen'], ['byok', 'gemini-2.5-flash-lite'],
    ['groq', 'qwen/qwen3.8-27b'], ['groq', 'qwen/qwen3.6-27b'], ['groq', 'meta-models/muse-spark-open'],
    ['mistral', 'ministral-3b-2512'], ['mistral', 'ministral-8b-2512'],
    ['mistral', 'ministral-14b-2512'], ['mistral', 'mistral-small-2603'],
]) {
    test(`${model} screen request keeps the selected image, model and recent question together`, async t => {
        const requests = [];
        const f = geminiFixture({ model, transcript: spokenQuestion, config: { groqImageModel: model, mistralModel: model },
            generate: params => { requests.push(params); return { text: 'Synthetic badge answer', candidates: [{ finishReason: 'STOP' }] }; },
            fetch: async (_url, init) => {
                requests.push(JSON.parse(init.body));
                return new Response('data:' + JSON.stringify({ choices: [{ delta: { content: 'Synthetic badge answer' }, finish_reason: 'stop' }] }) + '\n\ndata:[DONE]\n\n');
            } });
        t.after(() => f.close());
        assert.equal((await f.start(provider)).success, true);
        const result = await f.call('send-image-content', { data: jpeg, prompt: 'Analyze this chart' });
        assert.equal(result.success, true, result.error);
        assert.equal(result.model, model);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].model, model);
        if (provider === 'byok') {
            assert.equal(requests[0].contents[0].inlineData.data, jpeg);
            assert.match(requests[0].contents[1].text, new RegExp(spokenQuestion.replace('?', '\\?')));
            assert.match(requests[0].config.systemInstruction, /ask for clarification/);
        } else {
            const parts = requests[0].messages.at(-1).content;
            assert.equal(parts.find(part => part.type === 'image_url').image_url.url, `data:image/jpeg;base64,${jpeg}`);
            assert.ok(parts.find(part => part.type === 'text').text.includes(spokenQuestion));
            assert.match(JSON.stringify(requests[0].messages), /ask for clarification/);
        }
        const saved = f.events.filter(([name]) => name === 'save-screen-analysis');
        assert.equal(saved.length, 1);
        assert.equal(saved[0][1].analysis.prompt, 'Analyze this chart');
    });
}

for (const provider of ['byok', 'groq', 'mistral']) {
    test(`${provider} cancelled screen request cannot publish a late answer or History entry`, async t => {
        let release;
        const pending = () => new Promise(resolve => { release = resolve; });
        const f = geminiFixture({ model: 'gemini-4-hydrogen', transcript: spokenQuestion,
            generate: pending, fetch: pending, config: { groqImageModel: 'qwen/qwen3.8-27b' } });
        t.after(() => f.close());
        assert.equal((await f.start(provider, { uiEpoch: 8 })).success, true);
        const request = { requestId: 'screen-fixture', uiEpoch: 8 };
        const analysis = f.call('send-image-content', { data: jpeg, prompt: 'Read chart', request });
        for (let i = 0; i < 20 && !release; i++) await tick();
        assert.equal(typeof release, 'function');
        assert.equal((await f.call('cancel-screen-analysis', request)).success, true);
        const result = await analysis;
        assert.equal(result.success, false);
        release(provider === 'byok' ? { text: 'Late answer', candidates: [{ finishReason: 'STOP' }] }
            : new Response('data:{"choices":[{"delta":{"content":"Late answer"},"finish_reason":"stop"}]}\n\ndata:[DONE]\n\n'));
        for (let i = 0; i < 5; i++) await tick();
        assert.equal(f.events.some(([name]) => ['new-response', 'update-response', 'save-screen-analysis'].includes(name)), false);
    });
}

test('screen speech context includes only bounded recent final transcripts from the current session', () => {
    const { emitLiveTranscript, getRecentTranscript } = loadMain('src/utils/realtimeContextMain.js', {
        electron: { BrowserWindow: { getAllWindows: () => [] } },
    });
    const now = Date.now();
    emitLiveTranscript({ sessionId: 'previous', text: 'Earlier private session', final: true, timestamp: now });
    assert.equal(getRecentTranscript('current', now), '');
    emitLiveTranscript({ sessionId: 'current', text: 'Expired question', final: true, timestamp: now - 120001 });
    emitLiveTranscript({ sessionId: 'current', text: 'Unfinished phrase', final: false, timestamp: now });
    assert.equal(getRecentTranscript('current', now), '');
    emitLiveTranscript({ sessionId: 'current', text: spokenQuestion, final: true, timestamp: now });
    assert.equal(getRecentTranscript('current', now), spokenQuestion);
    assert.equal(getRecentTranscript('current', now + 120001), '');
    emitLiveTranscript({ sessionId: 'current', text: 'x'.repeat(8000), final: true, timestamp: now });
    assert.equal(getRecentTranscript('current', now).length, 6000);
});
