const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { auditRepository, classifyTrackedFile } = require('../scripts/final-readiness-audit');
const { evaluatePhase9Evidence } = require('../scripts/phase9-evidence');

test('Phase 10 static release-readiness audit passes while unresolved external gates remain explicit', () => {
    const report = auditRepository();
    assert.equal(report.staticReady, true, JSON.stringify(report.details, null, 2));
    assert.equal(report.finalReady, false, 'admin/physical blockers must prevent a final-clean claim');
    assert.deepEqual(report.details.unclassified, []);
    assert.deepEqual(report.details.missingPhaseEvidence, []);
    assert.deepEqual(report.details.directDependencyMismatches, []);
    assert.deepEqual(report.details.vendoredMismatches, []);
    assert.deepEqual(report.details.nativeProblems, []);
    assert.equal(report.details.workflowChecks.authenticodeMeasured, true);
    assert.deepEqual(
        report.details.openBlockers.map(item => item.id).sort(),
        ['immutable-releases', 'main-ruleset', 'physical-phase9-acceptance']
    );
    assert.deepEqual(report.details.physicalStatusCounts, { Blocked: 11, Fail: 2, Pass: 1 });
    assert.ok(report.details.physicalEvidenceIssues.includes('Physical evidence does not match the current candidate.'));
});

test('Phase 9 readiness requires complete evidence for the exact EXE and source commit', () => {
    const sourceCommit = 'a'.repeat(40);
    const portableExeSha256 = 'b'.repeat(64);
    const expected = { sourceCommit, portableExeSha256 };
    const matrix = { requiredScenarios: [{ id: 'launch' }, { id: 'soak', durationHours: 1, checkpointsHours: [1] }] };
    const evidence = (id, reference) => ({
        id, ...expected, result: 'Pass', reason: 'Reviewed physical result', evidence: [reference],
        utcTimestamp: '2026-11-26T09:02:00Z', device: 'Physical PC', windowsBuild: 'Windows 11 build 26300',
    });
    const report = {
        schemaVersion: 1, phase: 9,
        candidate: { ...expected, verifiedBeforeLaunch: true, verifiedAtUtc: '2026-11-26T08:00:00.001Z', appVersion: 'test' },
        scenarios: [evidence('launch', 'launch report'), evidence('soak', 'recorded soak')],
        runs: [{
            ...expected, directory: 'recorded soak', startedAtUtc: '2026-11-26T08:01:00Z', endedAtUtc: '2026-11-26T09:01:00Z',
            elapsedMs: 3600000, reportMinimumHours: 1, verifiedCheckpointsHours: [1], missingCheckpointsHours: [],
            activeSessionSamples: 59, fatalElectronEvents: 0, automatedRecorderChecksPassed: true,
        }],
    };
    const evaluate = (value = report, target = expected) => evaluatePhase9Evidence(matrix, value, target);
    assert.equal(evaluate().complete, true);
    assert.equal(evaluatePhase9Evidence(matrix, undefined, expected).complete, false);
    for (const target of [{}, { ...expected, sourceCommit: 'c'.repeat(40) }, { ...expected, portableExeSha256: 'd'.repeat(64) }]) {
        assert.equal(evaluate(report, target).complete, false);
    }
    for (const result of ['Fail', 'Blocked', 'Not applicable']) {
        const invalid = structuredClone(report);
        invalid.scenarios[0].result = result;
        assert.equal(evaluate(invalid).complete, false);
    }
    const duplicate = { ...report, scenarios: [...report.scenarios, report.scenarios[0]] };
    assert.equal(evaluate(duplicate).complete, false);
    for (const change of [{ elapsedMs: 1 }, { verifiedCheckpointsHours: [] }, { missingCheckpointsHours: [1] },
        { fatalElectronEvents: 1 }, { activeSessionSamples: 0 }, { sourceCommit: 'c'.repeat(40) }]) {
        const invalid = { ...report, runs: [{ ...report.runs[0], ...change }] };
        assert.equal(evaluate(invalid).complete, false);
    }
});

test('tracked-file classification covers the intended repository ownership classes without catch-all matching', () => {
    assert.equal(classifyTrackedFile('README.md'), 'root');
    assert.equal(classifyTrackedFile('.github/workflows/build-windows.yml'), 'repository-automation');
    assert.equal(classifyTrackedFile('docs/PHASE_10_RELEASE_READINESS.json'), 'documentation-evidence');
    assert.equal(classifyTrackedFile('scripts/final-readiness-audit.js'), 'build-test-maintenance');
    assert.equal(classifyTrackedFile('tests/phase10-release-readiness.test.js'), 'test');
    assert.equal(classifyTrackedFile('src/assets/lit-core-3.3.3.min.js'), 'runtime-asset');
    assert.equal(classifyTrackedFile('src/components/app/ContextHaloApp.js'), 'runtime-ui');
    assert.equal(classifyTrackedFile('src/utils/gemini.js'), 'runtime-utility');
    assert.equal(classifyTrackedFile('src/index.js'), 'runtime-entry');
    assert.equal(classifyTrackedFile('mystery.bin'), null);
});

test('Phase 10 manifest matches the observed post-Phase-9 baseline and does not self-certify external work', () => {
    const manifest = JSON.parse(fs.readFileSync('docs/PHASE_10_RELEASE_READINESS.json', 'utf8'));
    assert.equal(manifest.phase, 10);
    assert.equal(manifest.baseline.mainSha, '2914c8873666603aaaf1f4791019258693219ce6');
    assert.equal(manifest.baseline.releaseTag, 'v0.8.0-portable.381');
    assert.equal(manifest.baseline.mainWorkflowConclusion, 'success');
    assert.equal(manifest.baseline.attestationJobConclusion, 'success');
    assert.equal(manifest.baseline.releasePublishJobConclusion, 'success');
    assert.equal(manifest.baseline.repositoryRulesetCount, 0);
    assert.equal(manifest.baseline.latestReleaseImmutable, false);
    assert.equal(manifest.designation.finalCleanDesignation, false);

    const blockers = Object.fromEntries(manifest.externalBlockers.map(item => [item.id, item]));
    assert.equal(blockers['main-ruleset'].status, 'open');
    assert.equal(blockers['immutable-releases'].status, 'open');
    assert.equal(blockers['physical-phase9-acceptance'].status, 'open');
    assert.match(manifest.releasePosture.authenticode.phase10Change, /Get-AuthenticodeSignature/);
});
