const path = require('node:path');
const {
    BrowserWindow,
    clipboard,
    desktopCapturer,
    screen,
    session,
} = require('electron');
const storage = require('../storage');

const DEFAULT_SELECTION = Object.freeze({
    kind: 'active-display',
    sourceId: null,
    displayId: null,
    label: 'Display hosting ContextHalo',
});

let selectorWindow = null;

function sanitizeText(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function sanitizeSelection(value) {
    if (!value || typeof value !== 'object') return { ...DEFAULT_SELECTION };
    const allowedKinds = new Set(['active-display', 'primary-display', 'screen', 'window']);
    if (!allowedKinds.has(value.kind)) return { ...DEFAULT_SELECTION };

    return {
        kind: value.kind,
        sourceId: sanitizeText(value.sourceId, 256) || null,
        displayId: sanitizeText(value.displayId, 128) || null,
        label: sanitizeText(value.label, 240) || DEFAULT_SELECTION.label,
    };
}

function getStoredSelection() {
    return sanitizeSelection(storage.getPreferences()?.captureSource);
}

function saveSelection(selection) {
    const normalized = sanitizeSelection(selection);
    storage.updatePreference('captureSource', normalized);
    return normalized;
}

function getDisplayForSelection(mainWindow, selection = getStoredSelection()) {
    if (selection.kind === 'primary-display') return screen.getPrimaryDisplay();
    if (selection.kind === 'screen' && selection.displayId) {
        const match = screen.getAllDisplays().find(display => String(display.id) === String(selection.displayId));
        if (match) return match;
    }
    return screen.getDisplayMatching(mainWindow.getBounds());
}

async function getDesktopSources() {
    return desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
    });
}

function sourceType(source) {
    return String(source?.id || '').startsWith('screen:') ? 'screen' : 'window';
}

async function listCaptureSources(mainWindow) {
    const sources = await getDesktopSources();
    const ownSourceId = typeof mainWindow.getMediaSourceId === 'function' ? mainWindow.getMediaSourceId() : null;
    const items = [
        { ...DEFAULT_SELECTION, key: 'active-display' },
        {
            kind: 'primary-display',
            sourceId: null,
            displayId: String(screen.getPrimaryDisplay().id),
            label: 'Primary display',
            key: 'primary-display',
        },
    ];

    const screens = sources
        .filter(source => sourceType(source) === 'screen')
        .map(source => ({
            kind: 'screen',
            sourceId: source.id,
            displayId: String(source.display_id || ''),
            label: source.name || 'Display',
            key: `screen:${source.display_id || source.id}`,
        }));

    const windows = sources
        .filter(source => sourceType(source) === 'window' && source.id !== ownSourceId)
        .filter(source => sanitizeText(source.name, 240))
        .slice(0, 50)
        .map(source => ({
            kind: 'window',
            sourceId: source.id,
            displayId: null,
            label: source.name,
            key: `window:${source.id}`,
        }));

    return {
        selected: getStoredSelection(),
        sources: [...items, ...screens, ...windows],
    };
}

async function resolveVideoSource(mainWindow) {
    const selection = getStoredSelection();
    const sources = await getDesktopSources();

    if (selection.kind === 'window' && selection.sourceId) {
        const windowSource = sources.find(source => source.id === selection.sourceId);
        if (windowSource) return { source: windowSource, selection };
    }

    if (selection.kind === 'screen' && selection.displayId) {
        const screenSource = sources.find(source => String(source.display_id) === String(selection.displayId));
        if (screenSource) return { source: screenSource, selection };
    }

    const display = selection.kind === 'primary-display'
        ? screen.getPrimaryDisplay()
        : screen.getDisplayMatching(mainWindow.getBounds());
    const source = sources.find(candidate => String(candidate.display_id) === String(display.id))
        || sources.find(candidate => sourceType(candidate) === 'screen');

    return {
        source,
        selection: selection.kind === 'window' || selection.kind === 'screen'
            ? { ...DEFAULT_SELECTION, label: `${DEFAULT_SELECTION.label} (fallback)` }
            : selection,
    };
}

function installDisplayCaptureHandler(mainWindow) {
    session.defaultSession.setDisplayMediaRequestHandler(
        async (_request, callback) => {
            try {
                const { source } = await resolveVideoSource(mainWindow);
                callback(source ? { video: source, audio: 'loopback' } : {});
            } catch (error) {
                console.error('Context capture source selection failed:', error);
                callback({});
            }
        },
        { useSystemPicker: false }
    );
}

function normalizeRegion(region) {
    if (!region || typeof region !== 'object') return null;
    const x = Number(region.x);
    const y = Number(region.y);
    const width = Number(region.width);
    const height = Number(region.height);
    if (![x, y, width, height].every(Number.isFinite)) return null;
    if (width < 0.01 || height < 0.01) return null;

    return {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
        width: Math.max(0.01, Math.min(1 - Math.max(0, x), width)),
        height: Math.max(0.01, Math.min(1 - Math.max(0, y), height)),
    };
}

function selectRegion(mainWindow) {
    const selection = getStoredSelection();
    if (selection.kind === 'window') {
        return Promise.resolve({ success: false, error: 'Region capture requires a display source. Choose a display before starting the session.' });
    }
    if (selectorWindow && !selectorWindow.isDestroyed()) {
        return Promise.resolve({ success: false, error: 'A region selector is already open.' });
    }

    const display = getDisplayForSelection(mainWindow, selection);
    const selector = new BrowserWindow({
        ...display.bounds,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        show: false,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, 'regionSelectorPreload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            backgroundThrottling: false,
        },
    });
    selectorWindow = selector;
    selector.setContentProtection(true);
    selector.setAlwaysOnTop(true, 'screen-saver', 2);
    selector.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    selector.webContents.on('will-navigate', event => event.preventDefault());

    return new Promise(resolve => {
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            selectorWindow = null;
            if (!selector.isDestroyed()) selector.close();
            resolve(result);
        };

        selector.webContents.on('ipc-message', (_event, channel, payload) => {
            if (channel === 'region-selector-cancel') {
                finish({ success: false, cancelled: true });
                return;
            }
            if (channel !== 'region-selector-complete') return;
            const region = normalizeRegion(payload);
            if (!region) {
                finish({ success: false, error: 'The selected region was too small.' });
                return;
            }
            finish({
                success: true,
                region,
                displayId: String(display.id),
                displayLabel: selection.label || 'Display',
            });
        });

        selector.once('closed', () => {
            selectorWindow = null;
            if (!settled) {
                settled = true;
                resolve({ success: false, cancelled: true });
            }
        });
        selector.once('ready-to-show', () => {
            selector.show();
            selector.focus();
        });
        selector.loadFile(path.join(__dirname, '../region-selector.html')).catch(error => {
            finish({ success: false, error: error.message });
        });
    });
}

function setupContextCaptureMain(mainWindow, ipcMain) {
    if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
    installDisplayCaptureHandler(mainWindow);

    const isTrusted = event => Boolean(event?.sender && !mainWindow.isDestroyed() && event.sender.id === mainWindow.webContents.id);
    const installHandler = (channel, handler) => {
        try { ipcMain.removeHandler(channel); } catch {}
        ipcMain.handle(channel, async (event, ...args) => {
            if (!isTrusted(event)) return { success: false, error: 'Untrusted renderer' };
            try {
                return await handler(...args);
            } catch (error) {
                return { success: false, error: error?.message || String(error) };
            }
        });
    };

    installHandler('context-capture:list-sources', async () => ({ success: true, data: await listCaptureSources(mainWindow) }));
    installHandler('context-capture:get-state', () => ({ success: true, data: getStoredSelection() }));
    installHandler('context-capture:set-source', selection => ({ success: true, data: saveSelection(selection) }));
    installHandler('context-capture:read-clipboard', async () => {
        const text = sanitizeText(await Promise.resolve(clipboard.readText()), 20000);
        return text ? { success: true, text } : { success: false, error: 'Clipboard does not contain plain text.' };
    });
    installHandler('context-capture:select-region', () => selectRegion(mainWindow));
}

module.exports = {
    DEFAULT_SELECTION,
    sanitizeSelection,
    normalizeRegion,
    listCaptureSources,
    setupContextCaptureMain,
};
