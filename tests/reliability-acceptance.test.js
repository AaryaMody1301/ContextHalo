const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
    MIN_SAMPLE_MS,
    MAX_SAMPLE_MS,
    acceptanceRequested,
    clampSampleInterval,
    normalizeProcessMetric,
    aggregateProcessMetrics,
    directoryBytes,
    storageSnapshot,
    createReliabilityAcceptance,
} = require('../src/utils/reliabilityAcceptanceMain');

function tempDir(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-halo-reliability-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}

test('reliability acceptance is explicit and sample cadence is bounded', () => {
    assert.equal(acceptanceRequested(['app.exe']), false);
    assert.equal(acceptanceRequested(['app.exe', '--reliability-acceptance']), true);
    assert.equal(clampSampleInterval('bad'), 60_000);
    assert.equal(clampSampleInterval(1), MIN_SAMPLE_MS);
    assert.equal(clampSampleInterval(9999999), MAX_SAMPLE_MS);
    assert.equal(clampSampleInterval(30_000), 30_000);
});

test('process metrics normalize and aggregate Electron resource data without arbitrary fields', () => {
    const metric = normalizeProcessMetric({
        pid: 42,
        creationTime: 1234,
        type: 'Tab',
        name: 'Renderer',
        sandboxed: true,
        integrityLevel: 'low',
        cpu: { percentCPUUsage: 12.5, cumulativeCPUUsage: 4.2 },
        memory: { workingSetSize: 1000, peakWorkingSetSize: 1500, privateBytes: 800 },
        secret: 'must-not-copy',
    });
    assert.deepEqual(metric, {
        pid: 42,
        creationTime: 1234,
        type: 'Tab',
        name: 'Renderer',
        sandboxed: true,
        integrityLevel: 'low',
        cpuPercent: 12.5,
        cumulativeCpuSeconds: 4.2,
        workingSetKb: 1000,
        peakWorkingSetKb: 1500,
        privateKb: 800,
    });

    const aggregate = aggregateProcessMetrics([
        metric,
        {
            pid: 43,
            type: 'GPU',
            cpu: { percentCPUUsage: 2.5 },
            memory: { workingSetSize: 500, privateBytes: 400 },
        },
    ]);
    assert.equal(aggregate.processCount, 2);
    assert.equal(aggregate.totalCpuPercent, 15);
    assert.equal(aggregate.totalWorkingSetKb, 1500);
    assert.equal(aggregate.totalPrivateKb, 1200);
});

test('disk accounting measures known ContextHalo buckets without reading file contents', async t => {
    const root = tempDir(t);
    fs.mkdirSync(path.join(root, 'history'), { recursive: true });
    fs.mkdirSync(path.join(root, 'models', 'llama'), { recursive: true });
    fs.writeFileSync(path.join(root, 'history', '1.json'), 'abc');
    fs.writeFileSync(path.join(root, 'models', 'llama', 'model.gguf'), Buffer.alloc(11));
    fs.writeFileSync(path.join(root, 'config.json'), '12345');

    assert.deepEqual(await directoryBytes(path.join(root, 'history')), { bytes: 3, entries: 1, truncated: false });
    const snapshot = await storageSnapshot(root);
    assert.equal(snapshot.buckets.history.bytes, 3);
    assert.equal(snapshot.buckets.models.bytes, 11);
    assert.equal(snapshot.rootFiles['config.json'], 5);
    assert.equal(Object.hasOwn(snapshot, 'fileContents'), false);
});

test('acceptance recorder captures resources, checkpoints and platform lifecycle events without user content', async t => {
    const root = tempDir(t);
    const config = path.join(root, 'config');
    const output = path.join(root, 'evidence');
    fs.mkdirSync(path.join(config, 'history'), { recursive: true });
    fs.writeFileSync(path.join(config, 'history', '123.json'), 'saved-history-size-only');

    const app = new EventEmitter();
    app.getVersion = () => '0.8.0-portable.999';
    app.getAppMetrics = () => [
        {
            pid: 1,
            creationTime: 100,
            type: 'Browser',
            cpu: { percentCPUUsage: 5, cumulativeCPUUsage: 20 },
            memory: { workingSetSize: 2000, peakWorkingSetSize: 2200, privateBytes: 1700 },
        },
        {
            pid: 2,
            creationTime: 101,
            type: 'Tab',
            cpu: { percentCPUUsage: 7, cumulativeCPUUsage: 10 },
            memory: { workingSetSize: 3000, peakWorkingSetSize: 3200, privateBytes: 2500 },
            sandboxed: true,
        },
    ];

    const powerMonitor = new EventEmitter();
    powerMonitor.isOnBatteryPower = () => false;
    const mainWindow = new EventEmitter();
    mainWindow.webContents = new EventEmitter();

    let clock = 1_000_000;
    const recorder = createReliabilityAcceptance({
        app,
        powerMonitor,
        mainWindow,
        configDir: config,
        outputDir: output,
        release: { tag: 'v0.8.0-portable.999', build: 999, commit: 'a'.repeat(40) },
        displayScales: [1, 1.25, 1.25],
        rendererState: async () => ({
            available: true,
            sessionActive: true,
            lifecycleState: 'active',
            providerState: 'ready',
            captureState: 'ready',
            audioReady: true,
            screen: true,
            microphone: true,
            system: false,
        }),
        getMainMemory: async () => ({ residentSet: 900, private: 700, shared: 100 }),
        getNodeMemory: () => ({ rss: 100, heapTotal: 80, heapUsed: 60, external: 10, arrayBuffers: 5 }),
        autoStart: false,
        now: () => clock,
    });

    const first = await recorder.sample();
    assert.equal(first.app.totalWorkingSetKb, 5000);
    assert.equal(first.mainMemoryKb.residentSet, 900);
    assert.equal(first.renderer.providerState, 'ready');
    assert.ok(first.storage.knownBytes > 0);

    powerMonitor.emit('suspend');
    powerMonitor.emit('resume');
    mainWindow.emit('unresponsive');
    mainWindow.emit('responsive');
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'clean-exit', exitCode: 0 });
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 1, name: 'GPU' });
    mainWindow.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 9 });

    clock += 60 * 60_000 + 1;
    await recorder.sample();
    const summary = recorder.stop('test-complete');
    await recorder.flush();

    assert.equal(summary.sampleCount, 2);
    assert.ok(summary.checkpoints[String(60 * 60_000)]);
    assert.equal(summary.eventCounts['power-suspend'], 1);
    assert.equal(summary.eventCounts['power-resume'], 1);
    assert.equal(summary.eventCounts.unresponsive, 1);
    assert.equal(summary.eventCounts.responsive, 1);
    assert.equal(summary.eventCounts['child-process-gone'], 1, 'clean utility exits are ignored');
    assert.equal(summary.eventCounts['render-process-gone'], 1);
    assert.equal(summary.fatalEvents.length, 3);
    assert.equal(summary.maxima.totalWorkingSetKb, 5000);

    const metadataText = fs.readFileSync(recorder.paths.metadata, 'utf8');
    const summaryText = fs.readFileSync(recorder.paths.summary, 'utf8');
    const samplesText = fs.readFileSync(recorder.paths.samples, 'utf8');
    const eventsText = fs.readFileSync(recorder.paths.events, 'utf8');
    for (const text of [metadataText, summaryText, samplesText, eventsText]) {
        assert.doesNotMatch(text, /saved-history-size-only/);
        assert.doesNotMatch(text, /api[_-]?key/i);
        assert.doesNotMatch(text, /transcript|prompt body|screenshot data/i);
    }

    const metadata = JSON.parse(metadataText);
    assert.deepEqual(metadata.displayScaleFactors, [1, 1.25]);
    assert.match(metadata.privacy, /No prompts, transcripts, audio, screenshots, API keys/i);
});

test('stopping acceptance removes listeners and freezes further samples', async t => {
    const root = tempDir(t);
    const app = new EventEmitter();
    app.getVersion = () => '0.8.0';
    app.getAppMetrics = () => [];
    const powerMonitor = new EventEmitter();
    powerMonitor.isOnBatteryPower = () => false;
    const mainWindow = new EventEmitter();
    mainWindow.webContents = new EventEmitter();

    const recorder = createReliabilityAcceptance({
        app,
        powerMonitor,
        mainWindow,
        configDir: path.join(root, 'config'),
        outputDir: path.join(root, 'evidence'),
        autoStart: false,
    });
    const before = {
        power: powerMonitor.listenerCount('resume'),
        child: app.listenerCount('child-process-gone'),
        renderer: mainWindow.webContents.listenerCount('render-process-gone'),
    };
    assert.deepEqual(before, { power: 1, child: 1, renderer: 1 });

    recorder.stop();
    assert.equal(powerMonitor.listenerCount('resume'), 0);
    assert.equal(app.listenerCount('child-process-gone'), 0);
    assert.equal(mainWindow.webContents.listenerCount('render-process-gone'), 0);
    assert.equal(await recorder.sample(), null);
});
