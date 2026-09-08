const fs = require('node:fs');
const vm = require('node:vm');

// DOM layout is covered by the real sandboxed Electron smoke. This fixture tests
// the unchanged component methods against controlled permission/IPC failures.
function componentClass(file, name, overrides = {}) {
    const events = new EventTarget();
    const source = fs.readFileSync(file, 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export class ', 'class ');
    const context = {
        LitElement: class {
            constructor() { this.updateComplete = Promise.resolve(); this.isConnected = true; }
            requestUpdate() {} connectedCallback() {} disconnectedCallback() {} toggleAttribute() {}
            dispatchEvent() {} shadowRoot = { querySelector() { return null; } };
        },
        html: (strings, ...values) => strings.reduce((s, text, i) => s + text + (values[i] ?? ''), ''), css: () => '',
        customElements: { define() {} }, console, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
        navigator: { platform: 'Win32' }, document: {}, CustomEvent: class extends Event { constructor(type, init) { super(type); this.detail=init?.detail; } },
        window: Object.assign(events, { process: { platform: 'win32', arch: 'x64' }, electronAPI: { invoke: async () => ({ success: true }) } }),
        initRealtimeContext: () => () => {}, refreshPreferences: async () => {}, resolveSessionId: async () => 'session',
        flushSessionContext: async () => {}, saveSessionPack: async () => {}, persistPackToCurrentSession: async () => {}, loadContextState: async () => {},
        getContextState: () => ({ sessionPack: {}, captureState: {}, captureSources: [] }), getRealtimeState: () => ({}),
        GEMINI_DEFAULTS: { live: 'live', screen: 'http' }, GROQ_DEFAULTS: { chat: 'groq-chat', vision: 'groq-vision', transcription: 'whisper' },
        contextHalo: { getVersion: async () => '0.8.0', storage: { getConfig: async () => ({onboarded:true}), getPreferences: async () => ({}), getKeybinds: async () => ({}) } },
        ...overrides,
    };
    vm.runInNewContext(source + `\nthis.Target = ${name};`, context, { filename: file });
    return { Target: context.Target, context };
}
function appFixture(options = {}) {
    const calls=[];
    const api = {
        getVersion: async () => '0.8.0',
        storage: { getConfig: async () => ({onboarded:true}), getPreferences: async () => ({ providerMode: options.mode || 'byok' }), getKeybinds: async () => ({}), getApiKey: async () => 'fixture-key', getGroqApiKey: async () => 'fixture-groq' },
        initializeGemini: async () => { calls.push('provider'); return true; },
        initializeLocal: async () => { calls.push('local'); return true; },
        startCapture: async () => { calls.push('capture'); return true; }, stopCapture: () => calls.push('stop'),
        getCaptureState: () => ({ state:'ready', audioReady:true, microphone:true, screen:true }),
        ...options.api,
    };
    const loaded=componentClass('src/components/app/ContextHaloApp.js','ContextHaloApp',{ contextHalo:api, ...options.globals });
    loaded.context.window.electronAPI.invoke = async (channel,...args) => { calls.push(channel); return options.ipc ? options.ipc(channel,...args) : {success:true}; };
    const app=new loaded.Target();
    return { app, api, calls, context:loaded.context };
}
module.exports={componentClass,appFixture};
