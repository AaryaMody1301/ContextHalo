const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { samePolicy, governanceStatus, readPolicy } = require('../scripts/repository-governance');
const { pullRequestScope, validationScope } = require('../scripts/pr-validation-scope');

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

test('PR validation runs portable checks when change scope requires them', () => {
    assert.equal(pullRequestScope(['README.md', 'docs/guide.md']), 'source');
    assert.equal(pullRequestScope(['tests/phase4-knowledge.test.js']), 'windows');
    assert.equal(pullRequestScope(['src/utils/practiceCore.js', 'README.md']), 'windows');
    assert.equal(pullRequestScope(['src/components/views/HistoryView.js']), 'windows');
    for (const file of ['package.json', 'package-lock.json', 'preload.js', 'src/index.js',
        'src/assets/logo.ico', 'src/utils/windowsRuntimeMain.js', 'scripts/check-source.js',
        '.github/workflows/build-windows.yml', 'docs/PHASE_8_REPOSITORY_GOVERNANCE.json']) {
        assert.equal(pullRequestScope(['docs/guide.md', file]), 'portable', file);
    }
    assert.equal(pullRequestScope([]), 'portable');
    assert.equal(validationScope('push'), 'portable');
    assert.equal(validationScope('workflow_dispatch'), 'portable');
    assert.equal(validationScope('pull_request', 'unavailable'), 'portable');
});

test('source and dependency checks gate the Windows build for pushes and PRs', () => {
    const workflow = read('.github/workflows/build-windows.yml').replace(/\r\n/g, '\n');
    assert.match(workflow, /^  push:\n    branches: \[main\]\n  pull_request:\n    branches: \[main\]$/m);

    const sourceCheck = workflowJob(workflow, 'source-check');
    assert.match(sourceCheck, /^    name: Check ContextHalo source and provenance$/m);
    assert.match(sourceCheck, /^        run: node --test tests\/repository-provenance\.test\.js$/m);
    assert.match(sourceCheck, /^        run: npm run check$/m);
    assert.match(sourceCheck, /scope: \$\{\{ steps\.scope\.outputs\.scope \}\}/);
    assert.match(sourceCheck, /fetch-depth: 2/);
    assert.match(sourceCheck, /run: node scripts\/pr-validation-scope\.js/);

    const build = workflowJob(workflow, 'build');
    assert.match(build, /^    name: Build ContextHalo Windows x64 EXE$/m);
    assert.match(build, /^    needs: source-check$/m);
    assert.match(build, /^    if: needs\.source-check\.outputs\.scope != 'source' && !\(github\.event_name == 'workflow_dispatch' && inputs\.publish == true\)$/m);
    assert.match(build, /BUILD_PORTABLE: \$\{\{ needs\.source-check\.outputs\.scope != 'windows' \}\}/);
    assert.match(build, /npm test \| Tee-Object -FilePath/);
    assert.match(build, /npm audit --audit-level=high/);
    assert.doesNotMatch(build, /npm audit --omit=dev/);
    const benchmark = build.split('- name: Compare synthetic retrieval performance')[1]?.split('- name:')[0] || '';
    assert.match(benchmark, /git diff --name-only[^\n]*-- @benchmarkPaths/);
    assert.match(benchmark, /'src\/utils\/knowledgeCore\.js'/);
    assert.match(benchmark, /'src\/utils\/knowledgeRagMain\.js'/);
    assert.doesNotMatch(build, /- name: Run Electron behavior and layout smoke test\n        if:/);
    for (const step of ['Resolve release metadata', 'Build portable Windows EXE',
        'Verify portable EXE and record checksum', 'Record portable EXE Authenticode state',
        'Launch portable EXE at 100, 125, 150 and 200 percent Chromium scale', 'Record verified release candidate', 'Upload portable EXE artifact']) {
        assert.ok(build.includes('      - name: ' + step + '\n        if: env.BUILD_PORTABLE == \'true\'\n'), step);
    }
});

test('release workflow requires explicit publication from main and verifies published identity', () => {
    const workflow = read('.github/workflows/build-windows.yml').replace(/\r\n/g, '\n');
    const releaseGate = "github.repository == 'AaryaMody1301/ContextHalo' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.publish == true";
    assert.match(workflow, /^  workflow_dispatch:\n    inputs:\n      publish:\n(?:        [^\n]+\n)*        type: boolean\n        default: false\n      candidate_run_id:$/m);
    for (const jobId of ['attest-release', 'publish-release']) {
        const condition = workflowJob(workflow, jobId).match(/^    if: (.+)$/m)?.[1];
        assert.equal(condition, releaseGate, jobId);
    }
    assert.match(workflow, /Attest validated release artifacts/);
    assert.match(workflow, /actions\/attest@1e69f48acb82d1966a394da916b4c1698aa569d6/);
    assert.match(workflow, /name: Attest ContextHalo Windows release/);
    const attest = workflowJob(workflow, 'attest-release');
    const publish = workflowJob(workflow, 'publish-release');
    assert.match(attest, /needs: source-check/);
    assert.match(attest, /run: node scripts\/verify-windows-release\.js select/);
    for (const job of [attest, publish]) {
        assert.match(job, /run-id: \$\{\{ inputs\.candidate_run_id \}\}/);
        assert.match(job, /node scripts\/verify-windows-release\.js check-files release\/release-candidate\.json/);
        assert.match(job, /release\/ContextHalo-Windows-x64\.exe/);
        assert.match(job, /release\/SHA256SUMS\.txt/);
    }
    assert.match(attest, /artifact-ids: \$\{\{ steps\.candidate\.outputs\.artifact_id \}\}/);
    assert.match(publish, /needs: attest-release/);
    assert.match(publish, /artifact-ids: \$\{\{ needs\.attest-release\.outputs\.artifact_id \}\}/);
    assert.match(publish, /target_commitish: \$\{\{ needs\.attest-release\.outputs\.release_commit \}\}/);
    assert.match(publish, /overwrite_files: false/);
    assert.match(publish, /fail_on_unmatched_files: true/);
    assert.ok(publish.indexOf('preflight release/release-candidate.json') < publish.indexOf('uses: softprops/'));
    assert.match(publish, /node scripts\/verify-windows-release\.js verify release\/release-candidate\.json/);
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
