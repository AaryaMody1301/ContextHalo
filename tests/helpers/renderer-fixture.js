const fs = require('node:fs');
const vm = require('node:vm');
class Track extends EventTarget {
    constructor(kind) { super(); this.kind = kind; this.readyState = 'live'; this.stops = 0; }
    stop() { this.stops++; this.readyState = 'ended'; }
    end() { this.readyState = 'ended'; this.dispatchEvent(new Event('ended')); }
}
function stream(...kinds) {
    const tracks = kinds.map(kind => new Track(kind));
    return { getTracks: () => tracks, getVideoTracks: () => tracks.filter(t => t.kind === 'video'), getAudioTracks: () => tracks.filter(t => t.kind === 'audio') };
}
function rendererFixture(options = {}) {
    const calls = [];
    const contexts = [];
    const variables = new Map();
    const events = [];
    const prefs = { audioMode: options.audioMode || 'speaker_only', theme: 'dark', backgroundTransparency: 0.37, ...options.prefs };
    const media = options.media || stream('video', ...(prefs.audioMode === 'mic_only' ? [] : ['audio']));
    const microphone = options.microphone || stream('audio');
    const app = { setStatus() {}, addNewResponse() {}, updateCurrentResponse() {}, responses: [] };
    const ipc = {
        on() {},
        invoke: async (channel, ...args) => {
            calls.push([channel, ...args]);
            if (channel === 'storage:get-preferences') return { success: true, data: { ...prefs } };
            if (channel === 'storage:update-preference') { prefs[args[0]] = args[1]; return { success: true }; }
            if (channel === 'send-image-content') return options.image ? options.image(...args) : { success: true, text: 'Complete answer' };
            return { success: true };
        },
    };
    class AudioContext {
        constructor() { this.state = 'suspended'; contexts.push(this); }
        resume() { this.state = 'running'; return Promise.resolve(); }
        close() { this.state = 'closed'; return Promise.resolve(); }
        createMediaStreamSource() { return { connect() {} }; }
        createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null }; }
    }
    const window = new EventTarget();
    window.addEventListener('capture-state-changed', event => events.push(event.detail));
    const document = {
        readyState: 'loading', addEventListener() {}, querySelector: () => app,
        documentElement: { style: { setProperty: (key, value) => variables.set(key, value) } },
        createElement: tag => {
            if (tag === 'video') return { play: async () => {}, pause() {}, readyState: 2, videoWidth: 1920, videoHeight: 1080, srcObject: null };
            if (tag === 'canvas') return { getContext: () => ({ drawImage() {} }), toBlob: callback => callback(new Blob([new Uint8Array(1200)])) };
            throw new Error('Unexpected element: ' + tag);
        },
    };
    const scope = { window, document, AudioContext, AbortController, CustomEvent, Blob, URL, console: { log() {}, warn() {}, error() {} },
        process: { platform: options.platform || 'win32' }, setTimeout, clearTimeout, setInterval, clearInterval,
        btoa: value => Buffer.from(value, 'binary').toString('base64'), require: () => ({ ipcRenderer: ipc }),
        navigator: { mediaDevices: {
            getDisplayMedia: constraints => { calls.push(['display', constraints]); return options.display ? options.display(constraints) : Promise.resolve(media); },
            getUserMedia: constraints => { calls.push(['microphone', constraints]); return options.mic ? options.mic(constraints) : Promise.resolve(microphone); },
        } },
    };
    vm.runInNewContext(fs.readFileSync('src/utils/renderer.js', 'utf8'), scope);
    return { api: window.contextHalo, calls, contexts, variables, events, prefs, media, microphone, window, scope };
}
module.exports = { rendererFixture, stream };
