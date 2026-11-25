const OFFLINE_MESSAGE = 'Offline is active. Turn it off in Home to use online services.';
let offline = false;
let online = new AbortController();
let installed = false;

function offlineSelected(preferences) {
    return preferences?.providerMode === 'local' && preferences.localOffline === true;
}

function isOfflineMode() {
    return offline;
}

function setOfflineMode(enabled) {
    if (offline === enabled) return;
    offline = enabled;
    if (offline) online.abort(Object.assign(new Error(OFFLINE_MESSAGE), { name: 'AbortError', code: 'OFFLINE_MODE' }));
    else online = new AbortController();
}

function isLoopback(input) {
    try {
        const url = new URL(input?.url || String(input));
        return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === '[::1]');
    } catch {
        return false;
    }
}

function installOfflineNetworkBoundary() {
    if (installed) return;
    const next = global.fetch.bind(global);
    global.fetch = (input, init = {}) => {
        if (isLoopback(input)) return next(input, { ...init, redirect: 'error' });
        const networkSignal = online.signal;
        if (offline) return Promise.reject(networkSignal.reason);
        const requestSignal = init?.signal || input?.signal;
        const signal = requestSignal ? AbortSignal.any([requestSignal, networkSignal]) : networkSignal;
        return next(input, { ...init, signal });
    };
    installed = true;
}

module.exports = { OFFLINE_MESSAGE, offlineSelected, isOfflineMode, setOfflineMode, installOfflineNetworkBoundary };
