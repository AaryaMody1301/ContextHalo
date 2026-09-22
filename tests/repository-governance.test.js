const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { samePolicy, governanceStatus, readPolicy } = require('../scripts/repository-governance');

const read = path => fs.readFileSync(path, 'utf8');

test('Phase 8 policy protects main without making a solo repository require an outside reviewer or signed feature commits', () => {
    const policy = readPolicy();
    assert.equal(policy.repository, 'AaryaMody1301/ContextHalo');
    assert.equal(policy.immutableReleases, true);
    assert.equal(policy.requiredStatusCheck, 'Build ContextHalo Windows x64 EXE');
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

test('release workflow attests only validated main artifacts and verifies published identity', () => {
    const workflow = read('.github/workflows/build-windows.yml');
    assert.match(workflow, /Attest validated release artifacts/);
    assert.match(workflow, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /actions\/attest@1e69f48acb82d1966a394da916b4c1698aa569d6/);
    assert.match(workflow, /dist\/ContextHalo-Windows-x64\.exe/);
    assert.match(workflow, /dist\/SHA256SUMS\.txt/);
    assert.match(workflow, /Published release target does not match workflow commit/);
    assert.match(workflow, /asset\[0\]\.digest -notmatch '\^sha256:/);
});

test('electron-builder v27 is evaluated but intentionally excluded from the governance PR', () => {
    const policy = readPolicy();
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.devDependencies['electron-builder'], '^26.15.3');
    assert.equal(policy.builderPolicy.evaluatedMajor, '27');
    assert.match(policy.builderPolicy.decision, /dedicated build-system PR/i);
});
