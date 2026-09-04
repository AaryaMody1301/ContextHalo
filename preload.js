const { contextBridge, ipcRenderer } = require('electron');

const allowedChannels = {
    invoke: [
        'storage:get-config',
        'storage:set-config',
        'storage:update-config',
        'storage:get-credentials',
        'storage:set-credentials',
        'storage:get-api-key',
        'storage:set-api-key',
        'storage:get-groq-api-key',
        'storage:set-groq-api-key',
        'storage:get-preferences',
        'storage:set-preferences',
        'storage:update-preference',
        'storage:get-keybinds',
        'storage:set-keybinds',
        'storage:get-all-sessions',
        'storage:get-session',
        'storage:save-session',
        'storage:delete-session',
        'storage:delete-all-sessions',
        'storage:get-today-limits',
        'storage:clear-all',
        'provider-models:list',
        'context-capture:list-sources',
        'context-capture:get-state',
        'context-capture:set-source',
        'context-capture:read-clipboard',
        'context-capture:select-region',
        'knowledge:list',
        'knowledge:import',
        'knowledge:add-text',
        'knowledge:set-enabled',
        'knowledge:delete',
        'knowledge:search',
        'practice:generate',
        'practice:grade',
        'practice:history',
        'review:list',
        'review:get',
        'get-app-version',
        'quit-application',
        'open-external',
        'window-minimize',
        'window-toggle-maximize',
        'toggle-window-visibility',
        'initialize-cloud',
        'initialize-gemini',
        'initialize-local',
        'cancel-local-initialization',
        'send-audio-content',
        'send-mic-audio-content',
        'send-image-content',
        'send-text-message',
        'start-macos-audio',
        'stop-macos-audio',
        'close-session',
        'get-current-session',
        'start-new-session',
        'update-google-search-setting',
    ],
    send: ['update-keybinds', 'log-message', 'view-changed'],
    on: [
        'update-status',
        'new-response',
        'update-response',
        'session-initializing',
        'save-session-context',
        'save-conversation-turn',
        'save-screen-analysis',
        'screen-analysis-started',
        'screen-analysis-complete',
        'reconnect-failed',
        'clear-sensitive-data',
        'click-through-toggled',
        'navigate-previous-response',
        'navigate-next-response',
        'scroll-response-up',
        'scroll-response-down',
        'shortcut',
        'whisper-downloading',
        'local-ai-download-progress',
        'groq-rate-limit',
        'live-transcript',
    ],
};

function assertAllowed(list, channel) {
    if (!list.includes(channel)) {
        throw new Error(`IPC channel not allowed: ${channel}`);
    }
}

const safeIpcRenderer = {
    invoke(channel, ...args) {
        assertAllowed(allowedChannels.invoke, channel);
        return ipcRenderer.invoke(channel, ...args);
    },
    send(channel, ...args) {
        assertAllowed(allowedChannels.send, channel);
        return ipcRenderer.send(channel, ...args);
    },
    on(channel, listener) {
        assertAllowed(allowedChannels.on, channel);
        ipcRenderer.on(channel, listener);
        return safeIpcRenderer;
    },
    once(channel, listener) {
        assertAllowed(allowedChannels.on, channel);
        ipcRenderer.once(channel, listener);
        return safeIpcRenderer;
    },
    removeListener(channel, listener) {
        assertAllowed(allowedChannels.on, channel);
        ipcRenderer.removeListener(channel, listener);
        return safeIpcRenderer;
    },
    removeAllListeners(channel) {
        assertAllowed(allowedChannels.on, channel);
        ipcRenderer.removeAllListeners(channel);
        return safeIpcRenderer;
    },
};

contextBridge.exposeInMainWorld('electronAPI', safeIpcRenderer);

// Backward-compatible shim for renderer code while still exposing only the
// channel-filtered facade instead of Electron's real ipcRenderer object.
contextBridge.exposeInMainWorld('require', moduleName => {
    if (moduleName === 'electron') {
        return { ipcRenderer: safeIpcRenderer };
    }
    throw new Error(`Module access denied: ${moduleName}`);
});

contextBridge.exposeInMainWorld('process', {
    platform: process.platform,
    arch: process.arch,
});
