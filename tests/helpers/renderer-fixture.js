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
    const workletNodes = [];
    const variables = new Map();
    const events = [];
    const prefs = { audioMode: options.audioMode || 'speaker_only', providerMode: 'byok', theme: 'dark', backgroundTransparency: 0.37, ...options.prefs };
    const media = options.media || stream('video', ...(prefs.audioMode === 'mic_only' ? [] : ['audio']));
    const microphone = options.microphone || stream('audio');
    const app = { setStatus() {}, addNewResponse() {}, updateCurrentResponse() {}, responses: [] };
    const ipc = {
        on() {},
        invoke: async (channel, ...args) => {
            calls.push([channel, ...args]);
            const override = options.invoke?.(channel, ...args);
            if (override !== undefined) return override;
            if (channel === 'storage:get-preferences') return { success: true, data: { ...prefs } };
            if (channel === 'storage:update-preference') { prefs[args[0]] = args[1]; return { success: true }; }
            if (channel === 'send-image-content') return options.image ? options.image(...args) : { success: true, text: 'Complete answer' };
            return { success: true };
        },
    };
    class AudioContext {
        constructor(settings = {}) {
            this.state = 'suspended';
            this.sampleRate = settings.sampleRate || 24000;
            this.destination = {};
            this.audioWorklet = { addModule: async url => { calls.push(['audio-worklet', url]); await options.addModule?.(url); } };
            contexts.push(this);
        }
        resume() { this.state = 'running'; return Promise.resolve(); }
        close() { this.state = 'closed'; return Promise.resolve(); }
        createMediaStreamSource() { return { connect() {} }; }
    }
    class AudioWorkletNode {
        constructor(_context, name, options) {
            this.name = name;
            this.options = options;
            this.port = { onmessage: null, postMessage: data => calls.push(['worklet-ack', data]), close() {} };
            workletNodes.push(this);
        }
        connect() {}
        disconnect() {}
    }
    const window = new EventTarget();
    window.addEventListener('capture-state-changed', event => events.push(event.detail));
    const document = {
        readyState: 'loading', addEventListener() {}, querySelector: () => app,
        documentElement: { style: { setProperty: (key, value) => variables.set(key, value) } },
        createElement: tag => {
            if (tag === 'video') {
                let presentedFrames = 0;
                return {
                    play: async () => {}, pause() {}, readyState: 2, videoWidth: options.videoWidth || 1920, videoHeight: options.videoHeight || 1080, srcObject: null,
                    requestVideoFrameCallback(callback) {
                        const id = setTimeout(() => callback(Date.now(), { presentedFrames: ++presentedFrames, mediaTime: presentedFrames }), 0);
                        return id;
                    },
                    cancelVideoFrameCallback(id) { clearTimeout(id); },
                };
            }
            if (tag === 'canvas') {
                const canvas = { width: 0, height: 0 };
                canvas.getContext = () => ({
                    drawImage() {},
                    getImageData: () => {
                        const count = 32 * 18;
                        const data = new Uint8ClampedArray(count * 4);
                        const blank = typeof options.blankFrame === 'function' ? options.blankFrame() : options.blankFrame === true;
                        for (let i = 0; i < count; i++) {
                            const value = blank ? 0 : (i % 2 ? 70 : 180);
                            data[i * 4] = value; data[i * 4 + 1] = value; data[i * 4 + 2] = value; data[i * 4 + 3] = 255;
                        }
                        return { data };
                    },
                });
                canvas.toBlob = callback => {
                    calls.push(['canvas-encoded', canvas.width, canvas.height]);
                    callback(new Blob([new Uint8Array(1200)]));
                };
                return canvas;
            }
            throw new Error('Unexpected element: ' + tag);
        },
    };
    const scope = { structuredClone, window, document, AudioContext, AudioWorkletNode, AbortController, CustomEvent, Blob, URL, Uint8ClampedArray, console: { log() {}, warn() {}, error() {} },
        process: { platform: options.platform || 'win32' }, setTimeout, clearTimeout, setInterval, clearInterval,
        btoa: value => Buffer.from(value, 'binary').toString('base64'), require: () => ({ ipcRenderer: ipc }),
        navigator: { mediaDevices: {
            getDisplayMedia: constraints => { calls.push(['display', constraints]); return options.display ? options.display(constraints) : Promise.resolve(media); },
            getUserMedia: constraints => { calls.push(['microphone', constraints]); return options.mic ? options.mic(constraints) : Promise.resolve(microphone); },
        } },
    };
    vm.runInNewContext(fs.readFileSync('src/utils/renderer.js', 'utf8') + '\nthis.testCapture = { waitForFreshVideoFrame };', scope);
    return { api: window.contextHalo, calls, contexts, workletNodes, variables, events, prefs, media, microphone, window, scope };
}
module.exports = { rendererFixture, stream };
