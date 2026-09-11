const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

// Execute the real owning module. Only platform/account boundaries are mocked;
// request epochs, history, configuration, retry policy and IPC handlers are real.
function geminiFixture(options = {}) {
    const filename = path.resolve('src/utils/gemini.js');
    const actual = createRequire(filename);
    const liveRuntimeModule = actual('./geminiLiveRuntime');
    const handlers = new Map();
    const events = [];
    const generated = [];
    const connections = [];
    const clients = [];
    const realtime = [];
    const diagnostics = [];
    const preparations = [];
    const frame = {};
    const webContents = { id: 1, mainFrame: frame, getURL: () => 'file:///app/src/index.html', send: (...args) => events.push(args) };
    const preferences = { googleSearchEnabled: options.search === true, responseMode: 'balanced', ...options.preferences };
    const config = { geminiLiveModel: 'gemini-3.1-flash-live-preview', groqModel: 'test-chat', ...options.config };
    const storage = {
        getConfig: () => config, getPreferences: () => preferences,
        getAvailableModel: () => options.model || 'selected-http-model',
        getApiKey: () => 'test-key-not-a-real-credential', getGroqApiKey: () => 'groq-test-key',
        incrementLimitCount() {}, incrementCharUsage() {},
        getSession: () => ({ liveTranscript: [{ text: 'We discussed data pipelines' }] }),
    };
    const readySession = { close() {}, sendRealtimeInput: data => realtime.push(data) };
    class AI {
        constructor(params) { clients.push(params); }
        models = { generateContent: async params => {
            generated.push(params);
            return options.generate ? options.generate(params, generated.length) : { text: 'The answer' };
        } };
        live = { connect: async params => {
            connections.push(params);
            return options.live ? options.live(params, connections.length) : readySession;
        } };
    }
    let api;
    const local = {
        initializeLocalSession: async () => { api.initializeNewSession('interview', ''); return true; },
        cancelLocalInitialization: async () => true, closeLocalSession() {}, processLocalAudio() {},
        sendLocalText: async () => ({ success: true, text: 'Local answer' }),
        sendLocalImage: async () => ({ success: true, text: 'Local screen answer' }),
        ...options.local,
    };
    // The production runtime intentionally backs off before reconnecting. Unit tests
    // flush those timers on the next microtask so recovery assertions stay fast and
    // deterministic without weakening production retry behavior.
    const liveRuntimeOverrides = {
        setTimer(fn) {
            const timer = { cancelled: false };
            queueMicrotask(() => { if (!timer.cancelled) void fn(); });
            return timer;
        },
        clearTimer(timer) {
            if (timer) timer.cancelled = true;
        },
    };
    const scope = {
        module: { exports: {} }, console: { log() {}, warn() {}, error() {} }, process, Buffer, URL,
        AbortController, setTimeout, clearTimeout, global: {},
        fetch: options.fetch || (async () => new Response('data:{"choices":[{"delta":{"content":"Groq answer"}}]}\n\n')),
        require: name => {
            if (name === 'electron') return { BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents }] }, ipcMain: { handle: (key, fn) => handlers.set(key, fn) } };
            if (name === '@google/genai') return { GoogleGenAI: AI, Modality: { AUDIO: 'AUDIO' } };
            if (name === '../storage') return storage;
            if (name === './cloud') return { closeCloud() {}, isCloudActive: () => false };
            if (name === './localai') return local;
            if (name === './providerModelRegistry') return { listProviderModels: options.catalog || (async () => ({ live: [{ id: 'gemini-3.1-flash-live-preview' }] })) };
            if (name === './transportLogger') return { startTransportLog() {}, logTransportEvent: (...args) => diagnostics.push(args), closeTransportLog() {} };
            if (name === './sessionPackMain') return { appendSessionPack: text => text + '\nSession pack: mock goal' };
            if (name === './realtimeContextMain') return {
                emitLiveTranscript: data => events.push(['live-transcript', data]),
                extractGeminiTranscript: (message, field) => message.serverContent?.[field]?.text?.trim() || '',
                tuneLiveSystemInstruction: text => text,
            };
            if (name === './knowledgeRagMain') return {
                augmentGenerateParams: params => params,
                augmentLiveTextPayload: params => params,
                retrieveContext: () => null, appendContextToInstruction: text => text,
            };
            if (name === './windowsRuntimeMain') return { prepareWindowsProvider: mode => preparations.push(['windows', mode]) };
            if (name === './runtimeHardeningMain') return { prepareRuntimeProvider: mode => preparations.push(['runtime', mode]) };
            if (name === './contextCaptureMain') return { cancelRegionSelection() {} };
            if (name === './geminiLiveRuntime') return {
                ...liveRuntimeModule,
                createGeminiLiveRuntime: runtimeOptions => liveRuntimeModule.createGeminiLiveRuntime({
                    ...runtimeOptions,
                    ...liveRuntimeOverrides,
                }),
            };
            return actual(name);
        },
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), scope, { filename });
    api = scope.module.exports;
    api.setupGeminiIpcHandlers({ current: null });
    const event = { sender: webContents, senderFrame: frame };
    return {
        api, handlers, event, events, generated, connections, clients, realtime, preparations, diagnostics, preferences,
        get callbacks() { return connections.at(-1)?.callbacks; },
        call: (name, ...args) => handlers.get(name)(event, ...args),
        start: (provider = 'byok', settings = {}) => handlers.get('initialize-gemini')(event, 'test-key-not-a-real-credential', '', 'meeting', 'en-US', provider, settings),
        close: () => handlers.get('close-session')(event),
    };
}
module.exports = { geminiFixture };
