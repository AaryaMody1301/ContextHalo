const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DEFAULT_SAMPLE_MS = 60_000;
const MIN_SAMPLE_MS = 10_000;
const MAX_SAMPLE_MS = 5 * 60_000;
const CHECKPOINTS_MS = [60 * 60_000, 4 * 60 * 60_000, 8 * 60 * 60_000];
const STORAGE_BUCKETS = ['history', 'logs', 'knowledge', 'practice', 'models', 'binaries'];

function clampSampleInterval(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_SAMPLE_MS;
    return Math.max(MIN_SAMPLE_MS, Math.min(MAX_SAMPLE_MS, Math.round(parsed)));
}

function acceptanceRequested(argv = process.argv) {
    return Array.isArray(argv) && argv.includes('--reliability-acceptance');
}

function safeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function normalizeProcessMetric(metric = {}) {
    return {
        pid: safeNumber(metric.pid),
        creationTime: safeNumber(metric.creationTime),
        type: String(metric.type || 'Unknown').slice(0, 80),
        name: String(metric.name || metric.serviceName || '').slice(0, 120),
        sandboxed: metric.sandboxed === true,
        integrityLevel: metric.integrityLevel ? String(metric.integrityLevel).slice(0, 40) : undefined,
        cpuPercent: safeNumber(metric.cpu?.percentCPUUsage),
        cumulativeCpuSeconds: safeNumber(metric.cpu?.cumulativeCPUUsage),
        workingSetKb: safeNumber(metric.memory?.workingSetSize),
        peakWorkingSetKb: safeNumber(metric.memory?.peakWorkingSetSize),
        privateKb: safeNumber(metric.memory?.privateBytes),
    };
}

function aggregateProcessMetrics(metrics = []) {
    const processes = metrics.map(normalizeProcessMetric);
    return {
        processCount: processes.length,
        totalCpuPercent: processes.reduce((sum, item) => sum + item.cpuPercent, 0),
        totalWorkingSetKb: processes.reduce((sum, item) => sum + item.workingSetKb, 0),
        totalPrivateKb: processes.reduce((sum, item) => sum + item.privateKb, 0),
        processes,
    };
}

async function directoryBytes(root, { maxEntries = 20_000 } = {}) {
    let bytes = 0;
    let entries = 0;
    const pending = [root];

    while (pending.length) {
        const directory = pending.pop();
        let children;
        try {
            children = await fs.promises.readdir(directory, { withFileTypes: true });
        } catch (error) {
            if (error?.code === 'ENOENT') continue;
            return { bytes, entries, truncated: false, error: error?.code || 'READ_FAILED' };
        }
        for (const child of children) {
            entries += 1;
            if (entries > maxEntries) return { bytes, entries, truncated: true };
            const target = path.join(directory, child.name);
            if (child.isDirectory()) pending.push(target);
            else if (child.isFile()) {
                try { bytes += (await fs.promises.stat(target)).size; }
                catch (error) {
                    if (error?.code !== 'ENOENT') return { bytes, entries, truncated: false, error: error?.code || 'STAT_FAILED' };
                }
            }
        }
    }
    return { bytes, entries, truncated: false };
}

async function storageSnapshot(configDir) {
    const buckets = {};
    for (const name of STORAGE_BUCKETS) {
        buckets[name] = await directoryBytes(path.join(configDir, name));
    }

    const rootFiles = {};
    let children = [];
    try { children = await fs.promises.readdir(configDir, { withFileTypes: true }); }
    catch (error) {
        if (error?.code !== 'ENOENT') rootFiles.error = error?.code || 'READ_FAILED';
    }
    for (const child of children) {
        if (!child.isFile()) continue;
        try { rootFiles[child.name] = (await fs.promises.stat(path.join(configDir, child.name))).size; }
        catch {}
    }

    return { buckets, rootFiles };
}

function summarizeStorage(storage) {
    if (!storage?.buckets) return { knownBytes: 0 };
    return {
        knownBytes: Object.values(storage.buckets).reduce((sum, item) => sum + safeNumber(item?.bytes), 0)
            + Object.values(storage.rootFiles || {}).reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0),
        buckets: Object.fromEntries(Object.entries(storage.buckets).map(([name, item]) => [name, safeNumber(item?.bytes)])),
    };
}

function createReliabilityAcceptance({
    app,
    powerMonitor,
    mainWindow,
    configDir,
    outputDir,
    release = null,
    displayScales = [],
    rendererState = async () => ({ available: false }),
    getMainMemory = async () => ({}),
    getNodeMemory = () => process.memoryUsage(),
    sampleMs = DEFAULT_SAMPLE_MS,
    autoStart = true,
    now = Date.now,
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
} = {}) {
    if (!app || !mainWindow || !configDir || !outputDir) throw new Error('Reliability acceptance requires app, window, config and output directory.');

    const startedAtMs = now();
    const intervalMs = clampSampleInterval(sampleMs);
    const destination = path.resolve(outputDir);
    fs.mkdirSync(destination, { recursive: true });

    const metadata = {
        schemaVersion: 1,
        startedAt: new Date(startedAtMs).toISOString(),
        appVersion: String(app.getVersion?.() || ''),
        release: release ? {
            tag: release.tag || null,
            build: release.build ?? null,
            commit: release.commit || null,
        } : null,
        platform: process.platform,
        arch: process.arch,
        osRelease: os.release(),
        electron: process.versions.electron || null,
        chromium: process.versions.chrome || null,
        node: process.versions.node,
        sampleIntervalMs: intervalMs,
        displayScaleFactors: [...new Set(displayScales.map(safeNumber).filter(value => value > 0))],
        privacy: 'Resource/process/state metadata only. No prompts, transcripts, audio, screenshots, API keys, file paths or provider response bodies are recorded.',
    };
    fs.writeFileSync(path.join(destination, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');

    const summary = {
        schemaVersion: 1,
        startedAt: metadata.startedAt,
        endedAt: null,
        durationMs: 0,
        sampleCount: 0,
        checkpoints: {},
        maxima: {
            totalCpuPercent: 0,
            totalWorkingSetKb: 0,
            totalPrivateKb: 0,
            mainResidentSetKb: 0,
            mainPrivateKb: 0,
            nodeHeapUsedBytes: 0,
            knownStorageBytes: 0,
        },
        first: null,
        last: null,
        eventCounts: {},
        fatalEvents: [],
    };

    const listeners = [];
    let timer = null;
    let stopped = false;
    let sampleInFlight = false;
    let sampleIndex = 0;
    let writeQueue = Promise.resolve();

    function queueAppend(file, value) {
        const line = JSON.stringify(value) + '\n';
        writeQueue = writeQueue.then(() => fs.promises.appendFile(path.join(destination, file), line, 'utf8')).catch(() => {});
    }

    function writeSummarySync() {
        fs.writeFileSync(path.join(destination, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    }

    function recordEvent(type, detail = {}) {
        const event = {
            at: new Date(now()).toISOString(),
            elapsedMs: Math.max(0, now() - startedAtMs),
            type: String(type).slice(0, 80),
            detail,
        };
        summary.eventCounts[event.type] = (summary.eventCounts[event.type] || 0) + 1;
        if (['render-process-gone', 'child-process-gone', 'unresponsive'].includes(event.type)) {
            summary.fatalEvents.push(event);
        }
        queueAppend('events.jsonl', event);
        return event;
    }

    function listen(emitter, name, handler) {
        if (!emitter?.on) return;
        emitter.on(name, handler);
        listeners.push(() => emitter.removeListener?.(name, handler));
    }

    for (const name of ['suspend', 'resume', 'lock-screen', 'unlock-screen', 'on-ac', 'on-battery']) {
        listen(powerMonitor, name, () => recordEvent('power-' + name));
    }
    listen(powerMonitor, 'speed-limit-change', (_event, details) => recordEvent('power-speed-limit-change', {
        limit: safeNumber(details?.limit),
    }));
    listen(mainWindow, 'unresponsive', () => recordEvent('unresponsive'));
    listen(mainWindow, 'responsive', () => recordEvent('responsive'));
    listen(mainWindow, 'session-end', () => recordEvent('windows-session-end'));
    listen(mainWindow.webContents, 'render-process-gone', (_event, details) => recordEvent('render-process-gone', {
        reason: String(details?.reason || 'unknown').slice(0, 80),
        exitCode: safeNumber(details?.exitCode),
    }));
    listen(app, 'child-process-gone', (_event, details) => {
        if (details?.reason === 'clean-exit') return;
        recordEvent('child-process-gone', {
            type: String(details?.type || 'Unknown').slice(0, 80),
            reason: String(details?.reason || 'unknown').slice(0, 80),
            exitCode: safeNumber(details?.exitCode),
            name: String(details?.name || details?.serviceName || '').slice(0, 120),
        });
    });

    async function sample() {
        if (stopped || sampleInFlight) return null;
        sampleInFlight = true;
        try {
            const atMs = now();
            const elapsedMs = Math.max(0, atMs - startedAtMs);
            let appMetrics = [];
            try { appMetrics = app.getAppMetrics?.() || []; }
            catch { recordEvent('sample-error', { source: 'app-metrics' }); }
            const aggregate = aggregateProcessMetrics(appMetrics);

            let mainMemory = {};
            try { mainMemory = await getMainMemory(); }
            catch { recordEvent('sample-error', { source: 'main-memory' }); }

            let renderer = { available: false };
            try { renderer = await rendererState(); }
            catch { recordEvent('sample-error', { source: 'renderer-state' }); }

            let storage = null;
            if (sampleIndex === 0 || sampleIndex % 5 === 0) {
                storage = await storageSnapshot(configDir);
            }

            const nodeMemory = getNodeMemory() || {};
            const sampleValue = {
                at: new Date(atMs).toISOString(),
                elapsedMs,
                app: aggregate,
                mainMemoryKb: {
                    residentSet: safeNumber(mainMemory.residentSet),
                    private: safeNumber(mainMemory.private),
                    shared: safeNumber(mainMemory.shared),
                },
                nodeMemoryBytes: {
                    rss: safeNumber(nodeMemory.rss),
                    heapTotal: safeNumber(nodeMemory.heapTotal),
                    heapUsed: safeNumber(nodeMemory.heapUsed),
                    external: safeNumber(nodeMemory.external),
                    arrayBuffers: safeNumber(nodeMemory.arrayBuffers),
                },
                renderer,
                storage: storage ? summarizeStorage(storage) : null,
                onBattery: powerMonitor?.isOnBatteryPower?.() === true,
            };

            summary.sampleCount += 1;
            summary.durationMs = elapsedMs;
            summary.last = {
                at: sampleValue.at,
                elapsedMs,
                totalWorkingSetKb: aggregate.totalWorkingSetKb,
                totalPrivateKb: aggregate.totalPrivateKb,
                mainResidentSetKb: sampleValue.mainMemoryKb.residentSet,
                nodeHeapUsedBytes: sampleValue.nodeMemoryBytes.heapUsed,
                knownStorageBytes: sampleValue.storage?.knownBytes ?? summary.last?.knownStorageBytes ?? 0,
                renderer,
            };
            if (!summary.first) summary.first = { ...summary.last };
            summary.maxima.totalCpuPercent = Math.max(summary.maxima.totalCpuPercent, aggregate.totalCpuPercent);
            summary.maxima.totalWorkingSetKb = Math.max(summary.maxima.totalWorkingSetKb, aggregate.totalWorkingSetKb);
            summary.maxima.totalPrivateKb = Math.max(summary.maxima.totalPrivateKb, aggregate.totalPrivateKb);
            summary.maxima.mainResidentSetKb = Math.max(summary.maxima.mainResidentSetKb, sampleValue.mainMemoryKb.residentSet);
            summary.maxima.mainPrivateKb = Math.max(summary.maxima.mainPrivateKb, sampleValue.mainMemoryKb.private);
            summary.maxima.nodeHeapUsedBytes = Math.max(summary.maxima.nodeHeapUsedBytes, sampleValue.nodeMemoryBytes.heapUsed);
            if (sampleValue.storage) summary.maxima.knownStorageBytes = Math.max(summary.maxima.knownStorageBytes, sampleValue.storage.knownBytes);

            for (const checkpoint of CHECKPOINTS_MS) {
                if (elapsedMs >= checkpoint && !summary.checkpoints[String(checkpoint)]) {
                    summary.checkpoints[String(checkpoint)] = { ...summary.last };
                    recordEvent('checkpoint', { hours: checkpoint / 3_600_000 });
                }
            }

            queueAppend('samples.jsonl', sampleValue);
            writeSummarySync();
            sampleIndex += 1;
            return sampleValue;
        } finally {
            sampleInFlight = false;
        }
    }

    function stop(reason = 'stopped') {
        if (stopped) return summary;
        stopped = true;
        if (timer !== null) clearIntervalImpl(timer);
        for (const remove of listeners.splice(0)) {
            try { remove(); } catch {}
        }
        const endedAtMs = now();
        summary.endedAt = new Date(endedAtMs).toISOString();
        summary.durationMs = Math.max(summary.durationMs, endedAtMs - startedAtMs);
        if (summary.first && summary.last) {
            summary.growth = {
                workingSetKb: summary.last.totalWorkingSetKb - summary.first.totalWorkingSetKb,
                privateKb: summary.last.totalPrivateKb - summary.first.totalPrivateKb,
                mainResidentSetKb: summary.last.mainResidentSetKb - summary.first.mainResidentSetKb,
                nodeHeapUsedBytes: summary.last.nodeHeapUsedBytes - summary.first.nodeHeapUsedBytes,
                knownStorageBytes: summary.last.knownStorageBytes - summary.first.knownStorageBytes,
            };
        }
        recordEvent('acceptance-stop', { reason: String(reason).slice(0, 80) });
        writeSummarySync();
        return summary;
    }

    recordEvent('acceptance-start');
    if (autoStart) {
        void sample();
        timer = setIntervalImpl(() => { void sample(); }, intervalMs);
        timer?.unref?.();
    }

    return {
        sample,
        stop,
        recordEvent,
        getSummary: () => JSON.parse(JSON.stringify(summary)),
        flush: () => writeQueue,
        paths: {
            metadata: path.join(destination, 'metadata.json'),
            samples: path.join(destination, 'samples.jsonl'),
            events: path.join(destination, 'events.jsonl'),
            summary: path.join(destination, 'summary.json'),
        },
    };
}

module.exports = {
    DEFAULT_SAMPLE_MS,
    MIN_SAMPLE_MS,
    MAX_SAMPLE_MS,
    CHECKPOINTS_MS,
    STORAGE_BUCKETS,
    acceptanceRequested,
    clampSampleInterval,
    normalizeProcessMetric,
    aggregateProcessMetrics,
    directoryBytes,
    storageSnapshot,
    summarizeStorage,
    createReliabilityAcceptance,
};
