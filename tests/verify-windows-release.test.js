const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { recordCandidate, verifyPublished, selectArtifact, main } = require('../scripts/verify-windows-release');

const repository = 'AaryaMody1301/ContextHalo';
const tag = 'v0.9.0-portable.501';
const commit = '1'.repeat(40);
const wrongCommit = '2'.repeat(40);
const runId = 456789;
const runNumber = 501;
const exe = 'ContextHalo-Windows-x64.exe';
const sums = 'SHA256SUMS.txt';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exeBytes = Buffer.from('synthetic EXE bytes');
const sumsBytes = Buffer.from(`${hash(exeBytes)}  ${exe}\r\n`);
const verifiedBytes = { [exe]: exeBytes, [sums]: sumsBytes };
const assets = Object.fromEntries(Object.entries(verifiedBytes).map(([name, bytes]) => [name, { sha256: hash(bytes), size: bytes.length }]));
const candidate = { schemaVersion: 1, repository, tag, commit, runId, runNumber, assets };

function publishedFixture({ object = { type: 'commit', sha: commit }, tags = {}, missing, contents = verifiedBytes } = {}) {
    const downloaded = [];
    const requests = [];
    const fetchImpl = async (input, options) => {
        const { hostname, pathname } = new URL(input);
        requests.push(pathname);
        if (hostname === 'github.com') {
            const name = path.posix.basename(pathname);
            assert.equal(pathname, `/${repository}/releases/download/${tag}/${name}`);
            assert.equal(options.headers, undefined, 'public asset requests carry no API credentials');
            downloaded.push(name);
            return new Response(contents[name]);
        }
        assert.equal(hostname, 'api.github.com');
        if (pathname === `/repos/${repository}/git/ref/tags/${tag}`) return Response.json({ object });
        if (pathname === `/repos/${repository}/releases/tags/${tag}`) return Response.json({
            tag_name: tag, target_commitish: wrongCommit, draft: false, immutable: true,
            assets: Object.entries(assets).filter(([name]) => name !== missing)
                .map(([name, file]) => ({ name, state: 'uploaded', digest: `sha256:${file.sha256}` })),
        });
        const target = tags[path.posix.basename(pathname)];
        assert.ok(target, `unexpected request ${pathname}`);
        return Response.json({ object: target });
    };
    return { fetchImpl, downloaded, requests };
}

test('published release verification accepts a matching lightweight tag and the downloaded asset bytes', async () => {
    const fixture = publishedFixture();
    assert.deepEqual(await verifyPublished(candidate, fixture), { tag, commit, assets, immutable: true });
    assert.deepEqual(fixture.downloaded, [exe, sums]);
});

test('published release verification peels annotated tags to the build commit', async () => {
    const outer = 'a'.repeat(40);
    const inner = 'b'.repeat(40);
    const fixture = publishedFixture({ object: { type: 'tag', sha: outer }, tags: {
        [outer]: { type: 'tag', sha: inner }, [inner]: { type: 'commit', sha: commit },
    } });
    assert.equal((await verifyPublished(candidate, fixture)).commit, commit);
    assert.ok(fixture.requests.includes(`/repos/${repository}/git/tags/${inner}`));
});

test('published release verification rejects an annotated tag on the wrong commit before downloading', async () => {
    const annotation = 'a'.repeat(40);
    const fixture = publishedFixture({ object: { type: 'tag', sha: annotation }, tags: {
        [annotation]: { type: 'commit', sha: wrongCommit },
    } });
    await assert.rejects(verifyPublished(candidate, fixture), /Remote tag .* points to .* Expected candidate commit/);
    assert.deepEqual(fixture.downloaded, []);
});

test('published release verification identifies a missing required asset before downloading', async () => {
    const fixture = publishedFixture({ missing: sums });
    await assert.rejects(verifyPublished(candidate, fixture), /needs exactly one uploaded SHA256SUMS\.txt \(found 0\)/);
    assert.deepEqual(fixture.downloaded, []);
});

test('both asset bodies are checked even when GitHub metadata advertises the expected digests', async () => {
    for (const name of [exe, sums]) {
        const changed = Buffer.from(verifiedBytes[name]);
        changed[0] ^= 1;
        const fixture = publishedFixture({ contents: { ...verifiedBytes, [name]: changed } });
        await assert.rejects(verifyPublished(candidate, fixture), error => {
            assert.ok(error.message.startsWith(`SHA-256 or size mismatch for ${name}.`));
            return true;
        });
        assert.ok(fixture.downloaded.includes(name));
    }
});

test('publication selects only a retained successful build for this main commit', async () => {
    const run = { id: runId, path: '.github/workflows/build-windows.yml', head_branch: 'main', head_sha: commit,
        event: 'push', status: 'completed', conclusion: 'success', run_number: runNumber };
    const artifact = { id: 88, name: 'ContextHalo-Windows-x64-Portable', expired: false };
    const get = (metadata, items = [artifact]) => async endpoint => endpoint.includes('/artifacts') ? { artifacts: items } : metadata;
    const options = { repository, commit, runId };
    assert.deepEqual(await selectArtifact({ ...options, get: get(run) }), { artifact_id: 88, run_number: runNumber });
    for (const unexpected of [{ head_sha: wrongCommit }, { event: 'pull_request' }, { conclusion: 'failure' }]) {
        await assert.rejects(selectArtifact({ ...options, get: get({ ...run, ...unexpected }) }), /not a successful Windows candidate/);
    }
    await assert.rejects(selectArtifact({ ...options, get: get(run, [{ ...artifact, expired: true }]) }), /exactly one retained/);
});

test('the candidate record binds both files and all four measured smoke scales to the tested commit', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-halo-release-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const directory = path.join(root, 'dist');
    const evidence = path.join(root, 'qa-results');
    const testLog = path.join(root, 'tests.log');
    const putJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
    fs.mkdirSync(directory);
    for (const name of [exe, sums]) fs.writeFileSync(path.join(directory, name), verifiedBytes[name]);
    fs.writeFileSync(testLog, '# tests 515\n# pass 515\n# fail 0\n# skipped 0\n');
    const version = tag.slice(1);
    for (const scale of [1, 1.25, 1.5, 2]) {
        const folder = path.join(evidence, `portable-${scale}`);
        fs.mkdirSync(folder, { recursive: true });
        putJson(path.join(folder, 'outcome.json'), { success: true, packaged: true, platform: 'win32', arch: 'x64', version,
            releaseTag: tag, releaseCommit: commit, completedAt: '2026-11-26T18:00:00Z' });
        putJson(path.join(folder, 'checks.json'), { appearance: [{ devicePixelRatio: scale }] });
    }
    fs.mkdirSync(path.join(evidence, 'release'));
    putJson(path.join(evidence, 'release', 'authenticode.json'), { status: 'NotSigned', appVersion: version, releaseTag: tag, releaseCommit: commit });
    const env = { GITHUB_SHA: commit, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: String(runId),
        GITHUB_RUN_NUMBER: String(runNumber), CANDIDATE_TAG: tag, TESTED_EXE_SHA256: assets[exe].sha256 };
    const record = await recordCandidate({ directory, evidence, testLog, env });
    assert.equal(record.commit, commit);
    assert.deepEqual(record.assets, assets);
    assert.deepEqual(record.verification.tests, { tests: 515, pass: 515, fail: 0, skipped: 0 });
    assert.deepEqual(record.verification.smoke.map(item => [item.scale, item.status]), [[1, 'passed'], [1.25, 'passed'], [1.5, 'passed'], [2, 'passed']]);
    const matrix = require('../docs/PHASE_9_ACCEPTANCE_MATRIX_TEMPLATE.json');
    assert.deepEqual(record.verification.physicalScenarios, matrix.requiredScenarios.map(({ id }) => ({ id, status: 'skipped' })));
    const manifest = path.join(directory, 'release-candidate.json');
    putJson(manifest, record);
    const selection = { ...env, CANDIDATE_RUN_ID: String(runId), CANDIDATE_RUN_NUMBER: String(runNumber) };
    await main(['check-files', manifest], selection);
    await assert.rejects(main(['check-files', manifest], { ...selection, GITHUB_SHA: wrongCommit }), /does not match the selected main run/);
    putJson(path.join(evidence, 'portable-2', 'checks.json'), { appearance: [{ devicePixelRatio: 1.5 }] });
    await assert.rejects(recordCandidate({ directory, evidence, testLog, env }), /mismatched at 200%/);
    fs.appendFileSync(path.join(directory, exe), 'changed');
    await assert.rejects(recordCandidate({ directory, evidence, testLog, env }), /changed after its pre-smoke checksum/);
    await assert.rejects(main(['check-files', manifest], selection), /SHA-256 or size mismatch for ContextHalo-Windows-x64\.exe/);
});
