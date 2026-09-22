const test = require('node:test');
const assert = require('node:assert/strict');

const { parseJsonLines, buildReliabilityReport, markdown } = require('../scripts/reliability-acceptance-report');

function fixture(overrides = {}) {
    const metadata = {
        appVersion: '0.8.0-portable.999',
        release: { tag: 'v0.8.0-portable.999', build: 999, commit: 'a'.repeat(40) },
        platform: 'win32',
        arch: 'x64',
        sampleIntervalMs: 60_000,
        ...overrides.metadata,
    };
    const summary = {
        durationMs: 60 * 60_000 + 1,
        sampleCount: 61,
        endedAt: '2026-09-22T01:00:00.000Z',
        checkpoints: {
            [60 * 60_000]: { elapsedMs: 60 * 60_000 },
        },
        eventCounts: { 'acceptance-start': 1, checkpoint: 1, 'acceptance-stop': 1 },
        fatalEvents: [],
        first: { totalWorkingSetKb: 1000, totalPrivateKb: 800, knownStorageBytes: 1024 },
        last: { totalWorkingSetKb: 1200, totalPrivateKb: 900, knownStorageBytes: 2048 },
        maxima: {
            totalWorkingSetKb: 1400,
            totalPrivateKb: 1000,
            mainResidentSetKb: 600,
            nodeHeapUsedBytes: 1024 * 1024,
        },
        growth: {
            workingSetKb: 200,
            privateKb: 100,
            mainResidentSetKb: 50,
            nodeHeapUsedBytes: 1000,
            knownStorageBytes: 1024,
        },
        ...overrides.summary,
    };
    const samples = [
        { renderer: { available: true, sessionActive: true, providerState: 'ready', captureState: 'ready' } },
        ...Array.from({ length: 60 }, () => ({ renderer: { available: true, sessionActive: true } })),
    ];
    return { metadata, summary, samples: overrides.samples || samples };
}

test('JSONL parser ignores blank lines and preserves samples', () => {
    assert.deepEqual(parseJsonLines('{"a":1}\n\n{"a":2}\r\n'), [{ a: 1 }, { a: 2 }]);
});

test('one-hour evidence passes only the automated resource/lifecycle checks', () => {
    const report = buildReliabilityReport({ ...fixture(), minimumHours: 1 });
    assert.equal(report.automatedEvidencePass, true);
    assert.equal(report.checks.durationMet, true);
    assert.equal(report.checks.activeSessionObserved, true);
    assert.equal(report.checks.noFatalElectronEvents, true);
    assert.equal(report.resources.workingSetGrowthMb, 0.2);
    assert.ok(report.manualReviewStillRequired.includes('sleep/wake recovery'));
    assert.match(markdown(report), /Manual observations still required/);
});

test('missing duration, sparse samples, fatal Electron events and absent checkpoints fail evidence checks', () => {
    const base = fixture({
        summary: {
            durationMs: 30 * 60_000,
            sampleCount: 4,
            endedAt: null,
            checkpoints: {},
            fatalEvents: [{ type: 'render-process-gone' }],
        },
        samples: [{ renderer: { available: true, sessionActive: false } }],
    });
    const report = buildReliabilityReport({ ...base, minimumHours: 1 });
    assert.equal(report.automatedEvidencePass, false);
    assert.equal(report.checks.durationMet, false);
    assert.equal(report.checks.sampleCoverageMet, false);
    assert.equal(report.checks.activeSessionObserved, false);
    assert.equal(report.checks.noFatalElectronEvents, false);
    assert.equal(report.checks.checkpointsMet, false);
    assert.equal(report.checks.finalized, false);
});

test('four/eight hour gates require their corresponding recorder checkpoints', () => {
    const four = fixture({
        summary: {
            durationMs: 4 * 60 * 60_000 + 1,
            sampleCount: 241,
            checkpoints: {
                [60 * 60_000]: {},
                [4 * 60 * 60_000]: {},
            },
        },
        samples: Array.from({ length: 241 }, () => ({ renderer: { available: true, sessionActive: true } })),
    });
    assert.equal(buildReliabilityReport({ ...four, minimumHours: 4 }).checks.checkpointsMet, true);
    assert.equal(buildReliabilityReport({ ...four, minimumHours: 8 }).checks.durationMet, false);
});
