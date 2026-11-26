const { createHash } = require('node:crypto');
const { createReadStream, readFileSync, writeFileSync, appendFileSync } = require('node:fs');
const path = require('node:path');

const ASSETS = ['ContextHalo-Windows-x64.exe', 'SHA256SUMS.txt'];
const ARTIFACT_NAME = 'ContextHalo-Windows-x64-Portable';
const MANIFEST = 'release-candidate.json';
const SCALES = [1, 1.25, 1.5, 2];
const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PORTABLE_TAG = /^v\d+\.\d+\.\d+-portable\.(\d+)$/;
const REPOSITORY = /^[\w-]+\/[\w-]+(?:\.[\w-]+)*$/;
const readJson = file => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function validateCandidate(candidate) {
    const build = PORTABLE_TAG.exec(candidate?.tag || '');
    if (candidate?.schemaVersion !== 1 || !REPOSITORY.test(candidate.repository || '')
        || !COMMIT.test(candidate.commit || '') || !positiveInteger(candidate.runId)
        || !build || !positiveInteger(candidate.runNumber) || build[1] !== String(candidate.runNumber)) {
        throw new Error('Invalid release candidate repository, tag, commit or workflow run');
    }
    if (Object.keys(candidate.assets || {}).length !== ASSETS.length || ASSETS.some(name =>
        !SHA256.test(candidate.assets?.[name]?.sha256 || '') || !positiveInteger(candidate.assets[name].size))) {
        throw new Error('Release candidate needs both build asset sizes and SHA-256 hashes');
    }
    return candidate;
}

async function measure(stream, maxSize = Infinity) {
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of stream) {
        size += chunk.byteLength;
        if (size > maxSize) throw new Error('Asset exceeds the verified build size');
        hash.update(chunk);
    }
    return { sha256: hash.digest('hex'), size };
}

function assertAssetMatch(name, expected, actual) {
    if (actual.sha256 !== expected.sha256 || actual.size !== expected.size) {
        throw new Error(`SHA-256 or size mismatch for ${name}. Expected ${expected.sha256} (${expected.size} bytes), got ${actual.sha256} (${actual.size} bytes)`);
    }
}

function testCounts(output) {
    const totals = Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map(name => [
        name, Number(output.match(new RegExp(`^(?:#|ℹ)\\s+${name}\\s+(\\d+)\\s*$`, 'mu'))?.[1]),
    ]));
    if (!positiveInteger(totals.pass) || totals.fail !== 0 || !Number.isSafeInteger(totals.skipped)
        || totals.tests !== totals.pass + totals.skipped) throw new Error('Missing or incomplete regression test totals');
    return totals;
}

async function recordCandidate({ directory, evidence, testLog, env = process.env }) {
    const assets = {};
    for (const name of ASSETS) assets[name] = await measure(createReadStream(path.join(directory, name)));
    const candidate = validateCandidate({
        schemaVersion: 1, repository: env.GITHUB_REPOSITORY, commit: env.GITHUB_SHA, tag: env.CANDIDATE_TAG,
        runId: Number(env.GITHUB_RUN_ID), runNumber: Number(env.GITHUB_RUN_NUMBER), assets,
    });
    const exeHash = assets[ASSETS[0]].sha256;
    if (exeHash !== env.TESTED_EXE_SHA256) throw new Error('Portable EXE changed after its pre-smoke checksum');
    const checksums = readFileSync(path.join(directory, ASSETS[1]), 'utf8').replace(/^\uFEFF/, '').trim();
    if (checksums !== `${exeHash}  ${ASSETS[0]}`) throw new Error('SHA256SUMS.txt does not match the verified EXE');

    const version = candidate.tag.slice(1);
    const smoke = SCALES.map(scale => {
        const folder = path.join(evidence, `portable-${scale}`);
        const outcome = readJson(path.join(folder, 'outcome.json'));
        const details = readJson(path.join(folder, 'checks.json'));
        if (!outcome.success || !outcome.packaged || outcome.platform !== 'win32' || outcome.arch !== 'x64'
            || outcome.version !== version || outcome.releaseTag !== candidate.tag || outcome.releaseCommit !== candidate.commit
            || !details.appearance?.length || details.appearance.some(item => item.devicePixelRatio !== scale)) {
            throw new Error(`Verified packaged smoke evidence is missing or mismatched at ${scale * 100}% Chromium scale`);
        }
        return { scale, status: 'passed', completedAt: outcome.completedAt };
    });
    const signature = readJson(path.join(evidence, 'release', 'authenticode.json'));
    if (!['Valid', 'NotSigned'].includes(signature.status) || signature.appVersion !== version
        || signature.releaseTag !== candidate.tag || signature.releaseCommit !== candidate.commit) {
        throw new Error('Authenticode evidence does not match the verified build');
    }
    const physicalScenarios = candidate.tag.startsWith('v0.9.0-portable.')
        ? require('../docs/PHASE_9_ACCEPTANCE_MATRIX_TEMPLATE.json').requiredScenarios.map(({ id }) => ({ id, status: 'skipped' }))
        : [];
    return { ...candidate, verification: {
        tests: testCounts(readFileSync(testLog, 'utf8')), smoke, authenticode: signature.status, physicalScenarios,
        ...(physicalScenarios.length ? { physicalSkipReason: 'Phase 9 physical scenarios were skipped by agreement for this v0.9 candidate.' } : {}),
    } };
}

function github({ fetchImpl = fetch, token = process.env.GH_TOKEN } = {}) {
    return async function get(endpoint, { allowMissing = false } = {}) {
        const response = await fetchImpl('https://api.github.com' + endpoint, {
            headers: { Accept: 'application/vnd.github+json', 'Cache-Control': 'no-cache',
                ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            redirect: 'error', signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {
            await response.body?.cancel();
            if (allowMissing && response.status === 404) return null;
            throw new Error(`GitHub ${endpoint} returned HTTP ${response.status}`);
        }
        return response.json();
    };
}

async function resolveTag(get, candidate, allowMissing = false) {
    const root = `/repos/${candidate.repository}/git`;
    const ref = await get(`${root}/ref/tags/${encodeURIComponent(candidate.tag)}`, { allowMissing });
    if (!ref && allowMissing) return null;
    let object = ref?.object;
    const visited = new Set();
    while (object?.type === 'tag' && COMMIT.test(object.sha || '') && !visited.has(object.sha) && visited.size < 10) {
        visited.add(object.sha);
        object = (await get(`${root}/tags/${object.sha}`)).object;
    }
    if (object?.type !== 'commit' || !COMMIT.test(object.sha || '')) {
        throw new Error(`Remote tag ${candidate.tag} does not resolve to a commit`);
    }
    if (object.sha !== candidate.commit) {
        throw new Error(`Remote tag ${candidate.tag} points to ${object.sha}. Expected candidate commit ${candidate.commit}`);
    }
    return object.sha;
}

async function verifyPublished(candidate, options = {}) {
    validateCandidate(candidate);
    const get = github(options);
    await resolveTag(get, candidate);
    const tag = encodeURIComponent(candidate.tag);
    const release = await get(`/repos/${candidate.repository}/releases/tags/${tag}`);
    if (release.tag_name !== candidate.tag || release.draft !== false) throw new Error(`Release ${candidate.tag} is not published`);
    for (const name of ASSETS) {
        const matches = (release.assets || []).filter(asset => asset.name === name);
        if (matches.length !== 1 || matches[0].state !== 'uploaded') {
            throw new Error(`Release ${candidate.tag} needs exactly one uploaded ${name} (found ${matches.length})`);
        }
    }
    const fetchImpl = options.fetchImpl || fetch;
    for (const name of ASSETS) {
        // Use the public release download path and send no credentials to redirects.
        const url = `https://github.com/${candidate.repository}/releases/download/${tag}/${encodeURIComponent(name)}`;
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(180000) });
        if (!response.ok || !response.body) {
            await response.body?.cancel();
            throw new Error(`Download failed for ${name} (HTTP ${response.status})`);
        }
        const expected = candidate.assets[name];
        const actual = await measure(response.body, expected.size).catch(error => {
            throw new Error(`Could not verify downloaded ${name}: ${error.message}`);
        });
        assertAssetMatch(name, expected, actual);
        if (release.assets.find(asset => asset.name === name).digest !== `sha256:${expected.sha256}`) {
            throw new Error(`GitHub asset digest does not match verified bytes for ${name}`);
        }
    }
    return { tag: candidate.tag, commit: candidate.commit, assets: candidate.assets, immutable: release.immutable === true };
}

async function selectArtifact({ repository, commit, runId, get = github() }) {
    if (!REPOSITORY.test(repository || '') || !COMMIT.test(commit || '') || !positiveInteger(runId)) {
        throw new Error('Select a successful Windows candidate workflow run ID');
    }
    const root = `/repos/${repository}/actions/runs/${runId}`;
    const run = await get(root);
    if (run.id !== runId || run.path !== '.github/workflows/build-windows.yml' || run.head_branch !== 'main'
        || run.head_sha !== commit || run.status !== 'completed' || run.conclusion !== 'success'
        || !['push', 'workflow_dispatch'].includes(run.event) || !positiveInteger(run.run_number)) {
        throw new Error(`Run ${runId} is not a successful Windows candidate for the selected main commit ${commit}`);
    }
    const { artifacts } = await get(`${root}/artifacts?name=${ARTIFACT_NAME}`);
    const matches = (artifacts || []).filter(item => item.name === ARTIFACT_NAME && item.expired === false);
    if (matches.length !== 1 || !positiveInteger(matches[0].id)) {
        throw new Error(`Run ${runId} needs exactly one retained ${ARTIFACT_NAME} artifact`);
    }
    return { artifact_id: matches[0].id, run_number: run.run_number };
}

async function main([mode, input, evidence, testLog], env = process.env) {
    if (mode === 'record' && input && evidence && testLog) {
        const candidate = await recordCandidate({ directory: input, evidence, testLog, env });
        writeFileSync(path.join(input, MANIFEST), JSON.stringify(candidate, null, 4) + '\n');
        console.log(JSON.stringify(candidate, null, 4));
        return;
    }
    if (mode === 'select' && input && env.GITHUB_OUTPUT) {
        const selection = await selectArtifact({ repository: env.GITHUB_REPOSITORY, commit: env.GITHUB_SHA, runId: Number(input) });
        for (const [key, value] of Object.entries(selection)) appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`);
        return;
    }
    if (!input || !['check-files', 'preflight', 'verify'].includes(mode)) {
        throw new Error(`Usage: node scripts/verify-windows-release.js <check-files|preflight|verify> <${MANIFEST}>`);
    }
    const candidate = validateCandidate(readJson(input));
    if (mode === 'check-files') {
        if (env.CANDIDATE_RUN_ID && (candidate.runId !== Number(env.CANDIDATE_RUN_ID)
            || candidate.runNumber !== Number(env.CANDIDATE_RUN_NUMBER) || candidate.commit !== env.GITHUB_SHA
            || candidate.repository !== env.GITHUB_REPOSITORY)) throw new Error('Candidate manifest does not match the selected main run');
        for (const name of ASSETS) {
            assertAssetMatch(name, candidate.assets[name], await measure(createReadStream(path.join(path.dirname(input), name))));
        }
        if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `tag=${candidate.tag}\ncommit=${candidate.commit}\n`);
    } else if (mode === 'preflight') {
        await resolveTag(github(), candidate, true);
    } else {
        const result = await verifyPublished(candidate);
        console.log(JSON.stringify(result, null, 4));
        if (!result.immutable) console.warn('GitHub does not report this release as immutable.');
    }
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { recordCandidate, verifyPublished, selectArtifact, main };
