const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { samePolicy, governanceStatus, readPolicy } = require('../scripts/repository-governance');

const read = path => fs.readFileSync(path, 'utf8');

function workflowJob(workflow, jobId) {
    return workflow.split(`\n  ${jobId}:\n`)[1]?.split(/\n  [\w-]+:\n/)[0] || '';
}

test('Phase 8 policy protects main without making a solo repository require an outside reviewer or signed feature commits', () => {
    const policy = readPolicy();
    assert.equal(policy.repository, 'AaryaMody1301/ContextHalo');
    assert.equal(policy.immutableReleases, true);
    assert.deepEqual(policy.requiredStatusChecks, [
        'Check ContextHalo source and provenance',
        'Build ContextHalo Windows x64 EXE',
    ]);
    assert.equal(policy.mainRuleset.enforcement, 'active');
    assert.deepEqual(policy.mainRuleset.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
    assert.equal(policy.mainRuleset.bypass_actors, undefined);

    const byType = Object.fromEntries(policy.mainRuleset.rules.map(rule => [rule.type, rule]));
    for (const type of ['deletion', 'non_fast_forward', 'pull_request', 'required_status_checks']) {
        assert.ok(byType[type], type);
    }
    assert.equal(byType.required_signatures, undefined);
    assert.equal(policy.signingPolicy.requiredSignatures, false);
    assert.match(policy.signingPolicy.decision, /head commits.*verified signatures/i);
    assert.deepEqual(byType.pull_request.parameters.allowed_merge_methods, ['merge', 'squash']);
    assert.equal(byType.pull_request.parameters.required_approving_review_count, 0);
    assert.equal(byType.pull_request.parameters.required_review_thread_resolution, true);
    assert.deepEqual(byType.required_status_checks.parameters.required_status_checks, [
        { context: 'Check ContextHalo source and provenance' },
        { context: 'Build ContextHalo Windows x64 EXE' },
    ]);
    assert.equal(byType.required_status_checks.parameters.strict_required_status_checks_policy, true);
});

test('governance comparison ignores GitHub server metadata but detects policy drift', () => {
    const policy = readPolicy();
    const server = {
        id: 123,
        node_id: 'RRS_fixture',
        source_type: 'Repository',
        source: 'AaryaMody1301/ContextHalo',
        created_at: '2026-09-22T00:00:00Z',
        ...policy.mainRuleset,
    };
    assert.equal(samePolicy(server, policy.mainRuleset), true);

    const drifted = structuredClone(server);
    drifted.rules.find(rule => rule.type === 'required_status_checks')
        .parameters.required_status_checks[0].context = 'Some other check';
    assert.equal(samePolicy(drifted, policy.mainRuleset), false);
});

test('governance status requires both the exact main ruleset and immutable releases', () => {
    const policy = readPolicy();
    assert.equal(governanceStatus({ rulesets: [policy.mainRuleset], immutable: true }).compliant, true);
    assert.equal(governanceStatus({ rulesets: [policy.mainRuleset], immutable: false }).compliant, false);
    assert.equal(governanceStatus({ rulesets: [], immutable: true }).compliant, false);
});

test('governance application cannot run accidentally under the normal Actions token', () => {
    const script = read('scripts/repository-governance.js');
    const workflows = fs.readdirSync('.github/workflows')
        .filter(name => name.endsWith('.yml'))
        .map(name => read('.github/workflows/' + name))
        .join('\n');

    assert.match(script, /process\.env\.GH_ADMIN_TOKEN/);
    assert.doesNotMatch(script, /process\.env\.GITHUB_TOKEN|github\.token/);
    assert.doesNotMatch(workflows, /repository-governance\.js\s+--apply/);
});

test('source and dependency checks gate the Windows build for pushes and PRs', () => {
    const workflow = read('.github/workflows/build-windows.yml').replace(/\r\n/g, '\n');
    assert.match(workflow, /^  push:\n    branches: \[main\]\n  pull_request:\n    branches: \[main\]$/m);

    const sourceCheck = workflowJob(workflow, 'source-check');
    assert.match(sourceCheck, /^    name: Check ContextHalo source and provenance$/m);
    assert.match(sourceCheck, /^        run: node --test tests\/repository-provenance\.test\.js$/m);
    assert.match(sourceCheck, /^        run: npm run check$/m);

    const build = workflowJob(workflow, 'build');
    assert.match(build, /^    name: Build ContextHalo Windows x64 EXE$/m);
    assert.match(build, /^    needs: source-check$/m);
});

test('release workflow requires explicit publication from main and verifies published identity', () => {
    const workflow = read('.github/workflows/build-windows.yml').replace(/\r\n/g, '\n');
    const releaseGate = "github.repository == 'AaryaMody1301/ContextHalo' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.publish == true";
    assert.match(workflow, /^  workflow_dispatch:\n    inputs:\n      publish:\n(?:        [^\n]+\n)*        type: boolean\n        default: false$/m);
    for (const jobId of ['attest-release', 'publish-release']) {
        const condition = workflowJob(workflow, jobId).match(/^    if: (.+)$/m)?.[1];
        assert.equal(condition, releaseGate, jobId);
    }
    assert.match(workflow, /Attest validated release artifacts/);
    assert.match(workflow, /actions\/attest@1e69f48acb82d1966a394da916b4c1698aa569d6/);
    assert.match(workflow, /name: Attest ContextHalo Windows release/);
    assert.match(workflow, /needs: build/);
    assert.match(workflow, /release\/ContextHalo-Windows-x64\.exe/);
    assert.match(workflow, /release\/SHA256SUMS\.txt/);
    assert.match(workflow, /needs: \[build, attest-release\]/);
    assert.match(workflow, /name: ContextHalo Windows Portable \$\{\{ needs\.build\.outputs\.release_tag \}\}/);
    assert.match(workflow, /overwrite_files: false/);
    assert.match(workflow, /fail_on_unmatched_files: true/);
    assert.match(workflow, /Published release target does not match workflow commit/);
    assert.match(workflow, /asset\[0\]\.digest -notmatch '\^sha256:/);
});

test('automatic release maintenance follows successful publication', () => {
    const workflow = read('.github/workflows/build-windows.yml').replace(/\r\n/g, '\n');
    const maintenance = read('.github/workflows/repository-maintenance.yml');
    const call = workflowJob(workflow, 'maintain-release');
    assert.match(call, /^    needs: publish-release$/m);
    assert.match(call, /^    uses: \.\/\.github\/workflows\/repository-maintenance\.yml$/m);
    assert.match(call, /^    with:\n      apply: true$/m);
    assert.doesNotMatch(call, /\balways\(\)/);
    assert.doesNotMatch(maintenance, /^\s*workflow_run:/m);
    assert.match(maintenance, /^  workflow_call:/m);
    assert.match(maintenance, /^  workflow_dispatch:/m);
    assert.match(maintenance, /default: false/);
});

test('electron-builder v27 is evaluated but intentionally excluded from the governance PR', () => {
    const policy = readPolicy();
    const pkg = JSON.parse(read('package.json'));
    assert.match(pkg.devDependencies['electron-builder'], /^\^26\./);
    assert.equal(policy.builderPolicy.evaluatedMajor, '27');
    assert.match(policy.builderPolicy.decision, /dedicated build-system PR/i);
});
