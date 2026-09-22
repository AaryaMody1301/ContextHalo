const fs = require('node:fs');
const path = require('node:path');

function parseJsonLines(text) {
    return String(text || '')
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => JSON.parse(line));
}

function mbFromKb(value) {
    return Math.round((Number(value) || 0) / 1024 * 100) / 100;
}

function mbFromBytes(value) {
    return Math.round((Number(value) || 0) / (1024 * 1024) * 100) / 100;
}

function buildReliabilityReport({ metadata, summary, samples, minimumHours = 1 } = {}) {
    const minimumMs = Math.max(0, Number(minimumHours) || 0) * 60 * 60_000;
    const durationMs = Number(summary?.durationMs) || 0;
    const sampleIntervalMs = Number(metadata?.sampleIntervalMs) || 60_000;
    const expectedSamples = durationMs > 0 ? Math.max(1, Math.floor(durationMs / sampleIntervalMs)) : 1;
    const sampleCoverage = expectedSamples ? (Number(summary?.sampleCount) || 0) / expectedSamples : 0;
    const rendererSamples = (samples || []).filter(item => item?.renderer?.available === true);
    const activeSessionSamples = rendererSamples.filter(item => item?.renderer?.sessionActive === true);
    const fatalEvents = Array.isArray(summary?.fatalEvents) ? summary.fatalEvents : [];

    const requiredCheckpointHours = [1, 4, 8].filter(hours => hours <= minimumHours);
    const checkpointHours = new Set(Object.keys(summary?.checkpoints || {}).map(value => Number(value) / 3_600_000));
    const missingCheckpoints = requiredCheckpointHours.filter(hours => !checkpointHours.has(hours));

    const checks = {
        durationMet: durationMs >= minimumMs,
        sampleCoverageMet: sampleCoverage >= 0.75,
        rendererObserved: rendererSamples.length > 0,
        activeSessionObserved: minimumHours <= 0 || activeSessionSamples.length > 0,
        noFatalElectronEvents: fatalEvents.length === 0,
        checkpointsMet: missingCheckpoints.length === 0,
        finalized: Boolean(summary?.endedAt),
    };

    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        release: metadata?.release || null,
        appVersion: metadata?.appVersion || null,
        platform: metadata?.platform || null,
        arch: metadata?.arch || null,
        minimumHours,
        durationHours: Math.round(durationMs / 3_600_000 * 1000) / 1000,
        sampleCount: Number(summary?.sampleCount) || 0,
        expectedSamples,
        sampleCoverage: Math.round(sampleCoverage * 1000) / 1000,
        rendererSamples: rendererSamples.length,
        activeSessionSamples: activeSessionSamples.length,
        eventCounts: summary?.eventCounts || {},
        fatalEvents,
        missingCheckpoints,
        resources: {
            firstWorkingSetMb: mbFromKb(summary?.first?.totalWorkingSetKb),
            lastWorkingSetMb: mbFromKb(summary?.last?.totalWorkingSetKb),
            peakWorkingSetMb: mbFromKb(summary?.maxima?.totalWorkingSetKb),
            workingSetGrowthMb: mbFromKb(summary?.growth?.workingSetKb),
            firstPrivateMb: mbFromKb(summary?.first?.totalPrivateKb),
            lastPrivateMb: mbFromKb(summary?.last?.totalPrivateKb),
            peakPrivateMb: mbFromKb(summary?.maxima?.totalPrivateKb),
            privateGrowthMb: mbFromKb(summary?.growth?.privateKb),
            peakMainResidentSetMb: mbFromKb(summary?.maxima?.mainResidentSetKb),
            peakNodeHeapMb: mbFromBytes(summary?.maxima?.nodeHeapUsedBytes),
            firstKnownStorageMb: mbFromBytes(summary?.first?.knownStorageBytes),
            lastKnownStorageMb: mbFromBytes(summary?.last?.knownStorageBytes),
            knownStorageGrowthMb: mbFromBytes(summary?.growth?.knownStorageBytes),
        },
        automatedEvidencePass: Object.values(checks).every(Boolean),
        checks,
        manualReviewStillRequired: [
            'provider/session correctness and answer continuity',
            'network interruption and quota/throttling behavior',
            'microphone/speaker removal and reacquisition',
            'sleep/wake recovery',
            'multi-monitor active-display retargeting',
            'region-capture coordinate accuracy at physical Windows DPI',
            'content-protection behavior in real sharing/meeting applications',
            'Local AI CPU/Vulkan behavior and model-download interruption',
            'memory/CPU/disk trend interpretation at 1h/4h/8h checkpoints',
        ],
    };
}

function markdown(report) {
    const resources = report.resources;
    return [
        '# ContextHalo reliability acceptance evidence',
        '',
        '- Application: ' + (report.appVersion || 'unknown'),
        '- Release tag: ' + (report.release?.tag || 'unknown'),
        '- Duration: ' + report.durationHours + ' h (required: ' + report.minimumHours + ' h)',
        '- Samples: ' + report.sampleCount + ' / expected ~' + report.expectedSamples + ' (coverage ' + Math.round(report.sampleCoverage * 100) + '%)',
        '- Automated evidence checks: **' + (report.automatedEvidencePass ? 'PASS' : 'INCOMPLETE/FAIL') + '**',
        '',
        '## Resources',
        '',
        '- Total working set: ' + resources.firstWorkingSetMb + ' MB -> ' + resources.lastWorkingSetMb + ' MB; peak ' + resources.peakWorkingSetMb + ' MB; growth ' + resources.workingSetGrowthMb + ' MB',
        '- Total private memory: ' + resources.firstPrivateMb + ' MB -> ' + resources.lastPrivateMb + ' MB; peak ' + resources.peakPrivateMb + ' MB; growth ' + resources.privateGrowthMb + ' MB',
        '- Main-process peak resident set: ' + resources.peakMainResidentSetMb + ' MB',
        '- Main-process peak Node heap: ' + resources.peakNodeHeapMb + ' MB',
        '- Known ContextHalo storage: ' + resources.firstKnownStorageMb + ' MB -> ' + resources.lastKnownStorageMb + ' MB; growth ' + resources.knownStorageGrowthMb + ' MB',
        '',
        '## Electron/runtime events',
        '',
        '~~~json',
        JSON.stringify(report.eventCounts, null, 2),
        '~~~',
        '',
        '## Manual observations still required',
        '',
        ...report.manualReviewStillRequired.map(item => '- [ ] ' + item),
        '',
        '> Automated evidence is resource/lifecycle telemetry only. It does not certify provider answers, physical devices, Windows DPI, or sharing-app capture behavior.',
        '',
    ].join('\n');
}

function loadEvidence(directory) {
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'metadata.json'), 'utf8'));
    const summary = JSON.parse(fs.readFileSync(path.join(directory, 'summary.json'), 'utf8'));
    const samplesPath = path.join(directory, 'samples.jsonl');
    const samples = fs.existsSync(samplesPath) ? parseJsonLines(fs.readFileSync(samplesPath, 'utf8')) : [];
    return { metadata, summary, samples };
}

function main(argv = process.argv.slice(2)) {
    const directory = argv.find(arg => !arg.startsWith('--'));
    if (!directory) throw new Error('Usage: node scripts/reliability-acceptance-report.js <evidence-dir> [--minimum-hours=1|4|8]');
    const hoursArg = argv.find(arg => arg.startsWith('--minimum-hours='));
    const minimumHours = hoursArg ? Number(hoursArg.split('=')[1]) : 1;
    if (![0, 1, 4, 8].includes(minimumHours)) throw new Error('--minimum-hours must be 0, 1, 4, or 8');

    const evidence = loadEvidence(path.resolve(directory));
    const report = buildReliabilityReport({ ...evidence, minimumHours });
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(directory, 'report.md'), markdown(report));
    console.log(JSON.stringify(report, null, 2));
    if (!report.automatedEvidencePass) process.exitCode = 1;
    return report;
}

if (require.main === module) {
    try { main(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { parseJsonLines, buildReliabilityReport, markdown, loadEvidence, main };
