const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { auditRepository, classifyTrackedFile } = require('../scripts/final-readiness-audit');

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
    assert.ok((report.details.physicalStatusCounts['not-run'] || 0) > 0);
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
