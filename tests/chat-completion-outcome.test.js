const test = require('node:test');
const assert = require('node:assert/strict');
const { geminiFixture } = require('./helpers/gemini-fixture');
const { loadMain } = require('./helpers/native-boundary');
const requests = require('../src/utils/sessionRequests');

function response(reason) {
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Incomplete answer' }, finish_reason: reason }] })
        + '\n\ndata: [DONE]\n\n');
}

for (const reason of ['length', 'content_filter', 'tool_calls']) {
    test(`Groq ${reason} is not saved as a successful text or screen answer`, async t => {
        const f = geminiFixture({ fetch: async () => response(reason) });
        t.after(() => f.close()); await f.start('groq');
        const typed = await f.call('send-text-message', 'Explain this');
        const screen = await f.call('send-image-content', { data: Buffer.alloc(1100).toString('base64'), prompt: 'Read the code' });
        assert.equal(typed.success, false);
        assert.equal(screen.success, false);
        assert.equal(f.events.filter(([channel]) => ['save-screen-analysis', 'save-conversation-turn'].includes(channel)).length, 0);
    });
}

test('local length completion does not enter conversation history', async t => {
    const saved = [];
    const native = { ensureNativeBinary: async () => '/runner', ensureWhisperModel: async () => '/whisper',
        ensureLlamaModel: async () => ({ modelPath: '/model', projectorPath: '/projector' }),
        getAvailablePort: async () => 1234, getModelsDirectory: () => '/models', startNativeServer: () => ({}),
        stopNativeServer() {}, waitForServer: async () => {} };
    const api = loadMain('src/utils/localai.js', {
        fs: { existsSync: () => true, readdirSync: () => [] }, './native-ai-runtime': native, './sessionRequests': requests,
        './gemini': { sendToRenderer() {}, initializeNewSession: () => requests.resetSessionRequests(),
            saveConversationTurn: (...args) => saved.push(args) },
    }, { console: { log() {}, warn() {} }, fetch: async () => response('length') });
    t.after(() => { requests.closeSessionRequests(); api.closeLocalSession(); });
    await api.initializeLocalSession('existing-model', 'tiny.en', 'interview', '', 'en-US');
    assert.equal((await requests.runSessionRequest('text', () => api.sendLocalText('Explain'))).success, false);
    assert.equal((await requests.runSessionRequest('screen', () => api.sendLocalImage('aW1hZ2U=', 'Explain'))).success, false);
    assert.equal(saved.length, 0);
});
