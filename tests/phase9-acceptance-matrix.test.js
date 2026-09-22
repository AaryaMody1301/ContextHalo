const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('Phase 9 matrix keeps physical/device evidence separate from automated CI', () => {
    const matrix = JSON.parse(fs.readFileSync('docs/PHASE_9_ACCEPTANCE_MATRIX_TEMPLATE.json', 'utf8'));
    assert.equal(matrix.phase, 9);
    assert.equal(matrix.status, 'template-not-executed');
    assert.deepEqual(matrix.recorder.checkpointsHours, [1, 4, 8]);
    assert.match(matrix.recorder.privacy, /no prompts, transcripts, audio, screenshots, API keys/i);

    const byId = Object.fromEntries(matrix.requiredScenarios.map(item => [item.id, item]));
    for (const id of [
        'win10-launch',
        'win11-launch',
        'gemini-live-8h',
        'groq-1h',
        'local-cpu-1h',
        'local-vulkan-1h',
        'audio-modes',
        'network-interruption',
        'sleep-wake',
        'multi-monitor',
        'region-dpi',
        'content-protection',
        'quota-throttle',
        'download-interruption',
    ]) {
        assert.ok(byId[id], id);
        assert.equal(byId[id].status, 'not-run');
    }
    assert.deepEqual(byId['gemini-live-8h'].checkpointsHours, [1, 4, 8]);
    assert.match(matrix.exitCriteria.physical, /all required scenarios have recorded pass evidence/i);
    assert.match(matrix.exitCriteria.history, /full saved History remains intact/i);
});

test('normal runtime does not enable reliability recording implicitly', () => {
    const index = fs.readFileSync('src/index.js', 'utf8');
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const workflow = fs.readFileSync('.github/workflows/build-windows.yml', 'utf8');

    assert.match(index, /process\.argv\.includes\('--reliability-acceptance'\)/);
    assert.match(index, /if \(RELIABILITY_ACCEPTANCE_MODE\)/);
    assert.match(index, /require\('\.\/utils\/reliabilityAcceptanceMain'\)/);
    assert.doesNotMatch(packageJson.scripts.start, /reliability-acceptance/);
    assert.match(workflow, /--reliability-acceptance/);
    assert.match(workflow, /CONTEXTHALO_ACCEPTANCE_DIR/);
    assert.match(workflow, /Reliability evidence provenance does not match the packaged release/);
});
