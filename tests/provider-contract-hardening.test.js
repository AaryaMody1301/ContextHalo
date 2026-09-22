const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { groundingFragmentFromResponse, mergeGrounding, publicGrounding } = require('../src/utils/geminiGrounding');
const { appendModelParts } = require('../src/utils/geminiWorkingContext');
const { GROUNDED_HISTORY_RETENTION_MS, sanitizeConversationHistory, sanitizeScreenAnalysisHistory } = require('../src/utils/providerHistoryPolicy');
const { groqModelPolicy, groqCapabilityLabel } = require('../src/utils/groqModelPolicy');
const { getRetryDelayMs } = require('../src/utils/windowsProviderTransport');
const { geminiFixture } = require('./helpers/gemini-fixture');

test('Gemini streamed grounding accumulates incremental chunks and rebases local citation indexes', () => {
    const first = {
        candidates: [{ groundingMetadata: {
            groundingChunks: [{ web: { uri: 'https://one.example/source', title: 'One' } }],
            groundingSupports: [{ segment: { startIndex: 0, endIndex: 3 }, groundingChunkIndices: [0] }],
            webSearchQueries: ['first query'],
            searchEntryPoint: { renderedContent: '<div>Exact provider suggestions</div>' },
        } }],
    };
    const second = {
        candidates: [{ groundingMetadata: {
            groundingChunks: [{ web: { uri: 'https://two.example/source', title: 'Two' } }],
            groundingSupports: [{ segment: { startIndex: 4, endIndex: 7 }, groundingChunkIndices: [0] }],
            webSearchQueries: ['second query'],
        } }],
    };

    let state = mergeGrounding(undefined, groundingFragmentFromResponse(first));
    state = mergeGrounding(state, groundingFragmentFromResponse(second));
    const value = publicGrounding(state);

    assert.deepEqual(value.sources.map(source => source?.uri), ['https://one.example/source', 'https://two.example/source']);
    assert.deepEqual(value.supports.map(support => support.groundingChunkIndices), [[0], [1]]);
    assert.deepEqual(value.queries, ['first query', 'second query']);
    assert.equal(value.renderedContent, '<div>Exact provider suggestions</div>');
    assert.equal(Object.hasOwn(value, '_chunkCount'), false);
});

test('Gemini model-part accumulation preserves signatures even when the signature arrives in an empty final chunk', () => {
    let parts = appendModelParts([], { candidates: [{ content: { parts: [{ text: 'Visible answer' }] } }] });
    parts = appendModelParts(parts, { candidates: [{ content: { parts: [{ text: '', thoughtSignature: 'signature-1' }] } }] });
    assert.equal(parts[0].text, 'Visible answer');
    assert.equal(parts[1].text, '');
    assert.equal(parts[1].thoughtSignature, 'signature-1');
});

test('typed Gemini sends prior thought signatures back in bounded working context but never saves them to History', async t => {
    let secondRequest;
    const f = geminiFixture({
        model: 'gemini-3.8-flash',
        generate: async (params, count) => {
            if (count === 1) return { chunks: [
                { text: 'First answer', candidates: [{ content: { role: 'model', parts: [{ text: 'First answer' }] } }] },
                { text: '', candidates: [{ content: { role: 'model', parts: [{ text: '', thoughtSignature: 'sig-first' }] } }] },
            ] };
            secondRequest = params;
            return { text: 'Second answer', candidates: [{ content: { role: 'model', parts: [{ text: 'Second answer' }] } }] };
        },
    });
    t.after(() => f.close());
    assert.equal((await f.start()).success, true);
    assert.equal((await f.call('send-text-message', 'First question')).success, true);
    assert.equal((await f.call('send-text-message', 'Second question')).success, true);
    assert.match(JSON.stringify(secondRequest.contents), /sig-first/);
    const saved = f.events.filter(([channel]) => channel === 'save-conversation-turn');
    assert.equal(saved.length, 2);
    assert.doesNotMatch(JSON.stringify(saved), /sig-first/);
});

test('grounded History strips Search metadata immediately and expires displayed grounded text after two years', () => {
    const now = Date.parse('2026-09-22T00:00:00Z');
    const recent = now - 1000;
    const expired = now - GROUNDED_HISTORY_RETENTION_MS - 1;

    const conversations = sanitizeConversationHistory([
        { timestamp: recent, transcription: 'Recent question', ai_response: 'Recent grounded answer', grounding: { renderedContent: '<x>' } },
        { timestamp: expired, transcription: 'Old question', ai_response: 'Old grounded answer', grounding: { sources: [{ uri: 'https://example.org' }] } },
    ], now);
    assert.equal(conversations[0].ai_response, 'Recent grounded answer');
    assert.equal(conversations[0].grounded, true);
    assert.equal(Object.hasOwn(conversations[0], 'grounding'), false);
    assert.equal(conversations[1].ai_response, '');
    assert.equal(conversations[1].groundedExpired, true);
    assert.equal(conversations[1].transcription, 'Old question');

    const screens = sanitizeScreenAnalysisHistory([
        { timestamp: expired, prompt: 'Old screen', response: 'Old grounded screen answer', grounding: { queries: ['secret query'] } },
    ], now);
    assert.equal(screens[0].response, '');
    assert.equal(screens[0].prompt, 'Old screen');
    assert.equal(Object.hasOwn(screens[0], 'grounding'), false);
});

test('Groq policy distinguishes production, Preview, account-dependent deprecations and retired systems', () => {
    assert.equal(groqModelPolicy('openai/gpt-oss-120b').lifecycle, 'production');
    assert.equal(groqModelPolicy('qwen/qwen3.8-27b').lifecycle, 'preview');
    assert.equal(groqModelPolicy('minimaxai/minimax-m2.7').lifecycle, 'preview');
    assert.equal(groqModelPolicy('qwen/qwen3.6-27b').lifecycle, 'deprecated-account-dependent');
    assert.equal(groqModelPolicy('groq/compound').lifecycle, 'retired');
    assert.match(groqCapabilityLabel('minimaxai/minimax-m2.7'), /Preview.*Enterprise/);
});

test('Groq dynamic discovery is access data while static policy supplies lifecycle and excludes retired systems', () => {
    const { _test } = require('../src/utils/providerModelRegistry');
    const catalog = _test.buildGroqCatalog([
        { id: 'openai/gpt-oss-120b', active: true },
        { id: 'qwen/qwen3.8-27b', active: true },
        { id: 'minimaxai/minimax-m2.7', active: true },
        { id: 'groq/compound', active: true },
        { id: 'vendor/new-model', active: true },
    ]);
    assert.equal(catalog.all.some(model => model.id === 'groq/compound'), false);
    assert.equal(catalog.all.find(model => model.id === 'openai/gpt-oss-120b').lifecycle, 'production');
    assert.equal(catalog.all.find(model => model.id === 'qwen/qwen3.8-27b').preview, true);
    assert.match(catalog.all.find(model => model.id === 'minimaxai/minimax-m2.7').capabilityLabel, /Preview/);
    assert.equal(catalog.all.find(model => model.id === 'vendor/new-model').lifecycle, 'unverified');
    assert.equal(catalog.recommended.chat, 'openai/gpt-oss-120b');
});

test('Groq Retry-After is a minimum and cannot disable exponential backoff', () => {
    assert.equal(getRetryDelayMs({ headers: new Headers({ 'retry-after': '0' }) }, 0, () => 0), 500);
    assert.equal(getRetryDelayMs({ headers: new Headers({ 'retry-after': '2' }) }, 0, () => 0), 2000);
    assert.equal(getRetryDelayMs({ headers: new Headers() }, 1, () => 0), 1000);
});

test('Search suggestions remain verbatim, non-framed and ephemeral at the renderer boundary', () => {
    const source = fs.readFileSync('src/components/GroundingSources.js', 'utf8');
    assert.doesNotMatch(source, /DOMParser|groundingDocument|<iframe|srcdoc/);
    assert.match(source, /shadowRoot\.innerHTML = next/);
    assert.match(source, /do not log, persist, count/);
    assert.match(source, /google-search-suggestions/);
    const settings = fs.readFileSync('src/components/views/CustomizeView.js', 'utf8');
    assert.match(settings, /Google retains the prompt, contextual information and grounded output for 30 days/);
    assert.match(settings, /does not store them in History/);
});

test('Gemini Live uses 40 ms capture chunks without changing Groq or Local VAD chunk duration', () => {
    const source = fs.readFileSync('src/utils/renderer.js', 'utf8');
    assert.match(source, /AUDIO_CHUNK_DURATION = 0\.1/);
    assert.match(source, /GEMINI_AUDIO_CHUNK_DURATION = 0\.04/);
    assert.match(source, /providerMode === 'byok' \? GEMINI_AUDIO_CHUNK_DURATION : AUDIO_CHUNK_DURATION/);
    assert.match(source, /samplesPerChunk: Math\.round\(context\.sampleRate \* preferredAudioChunkDuration\(\)\)/);
});

test('storage v9 removes retired Compound selections and legacy persisted Search metadata', { concurrency: false }, t => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'context-halo-provider-v9-'));
    const originalHomedir = os.homedir;
    os.homedir = () => tempHome;
    const storagePath = require.resolve('../src/storage');
    delete require.cache[storagePath];
    const storage = require(storagePath);
    t.after(() => {
        delete require.cache[storagePath];
        os.homedir = originalHomedir;
        fs.rmSync(tempHome, { recursive: true, force: true });
    });

    const configDir = storage.getConfigDir();
    const historyDir = path.join(configDir, 'history');
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
        configVersion: 8,
        groqModel: 'groq/compound',
        groqImageModel: 'groq/compound-mini',
    }));
    fs.writeFileSync(path.join(historyDir, '123.json'), JSON.stringify({
        sessionId: '123',
        conversationHistory: [{
            timestamp: Date.now(),
            transcription: 'Question',
            ai_response: 'Grounded answer',
            grounding: { renderedContent: '<div>suggestions</div>', queries: ['query'], sources: [{ uri: 'https://example.org' }] },
        }],
        screenAnalysisHistory: [],
    }));

    storage.initializeStorage();
    const config = storage.getConfig();
    assert.equal(config.configVersion, 9);
    assert.equal(config.groqModel, 'openai/gpt-oss-120b');
    assert.equal(config.groqImageModel, 'qwen/qwen3.8-27b');
    const saved = JSON.parse(fs.readFileSync(path.join(historyDir, '123.json'), 'utf8'));
    assert.equal(saved.conversationHistory[0].grounded, true);
    assert.equal(saved.conversationHistory[0].ai_response, 'Grounded answer');
    assert.equal(Object.hasOwn(saved.conversationHistory[0], 'grounding'), false);
});
