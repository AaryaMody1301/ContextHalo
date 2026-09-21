const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
    parsePortableReleaseTag,
    comparePortableReleases,
    readCurrentRelease,
    validateLatestRelease,
    createPortableUpdateController,
    LATEST_RELEASE_API,
} = require('../src/utils/updateMain');

const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const EXE_DIGEST = '1'.repeat(64);
const SUM_DIGEST = '2'.repeat(64);

function releasePayload(build = 368, overrides = {}) {
    return {
        tag_name: `v0.8.0-portable.${build}`,
        target_commitish: COMMIT_B,
        draft: false,
        prerelease: false,
        published_at: '2026-09-21T13:19:31Z',
        html_url: 'https://evil.invalid/ignored',
        assets: [
            {
                name: 'ContextHalo-Windows-x64.exe',
                size: 100_000_000,
                digest: `sha256:${EXE_DIGEST}`,
                browser_download_url: 'https://evil.invalid/fake.exe',
            },
            {
                name: 'SHA256SUMS.txt',
                size: 95,
                digest: `sha256:${SUM_DIGEST}`,
                browser_download_url: 'https://evil.invalid/fake.txt',
            },
        ],
        ...overrides,
    };
}

function response(payload, options = {}) {
    const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
    return {
        ok: options.ok ?? true,
        status: options.status ?? 200,
        headers: {
            get(name) {
                if (String(name).toLowerCase() === 'content-length') return String(options.contentLength ?? bytes.byteLength);
                return null;
            },
        },
        async arrayBuffer() {
            return Uint8Array.from(bytes).buffer;
        },
    };
}

function packagedApp(version = '0.8.0') {
    return { isPackaged: true, getVersion: () => version };
}

function metadata(build = 367) {
    return {
        version: '0.8.0',
        releaseBuild: build,
        releaseTag: `v0.8.0-portable.${build}`,
        releaseCommit: COMMIT_A,
    };
}

test('portable release tags compare semantic version and CI build number', () => {
    const current = parsePortableReleaseTag('v0.8.0-portable.367');
    const newerBuild = parsePortableReleaseTag('v0.8.0-portable.368');
    const newerVersion = parsePortableReleaseTag('v0.9.0-portable.1');
    assert.deepEqual(current, { tag: 'v0.8.0-portable.367', version: '0.8.0', major: 0, minor: 8, patch: 0, build: 367 });
    assert.equal(comparePortableReleases(newerBuild, current), 1);
    assert.equal(comparePortableReleases(newerVersion, newerBuild), 1);
    assert.equal(comparePortableReleases(current, current), 0);
    for (const invalid of ['0.8.0', 'v0.8.0', 'v0.8.0-portable.x', 'v0.8.0-portable.1.exe']) {
        assert.equal(parsePortableReleaseTag(invalid), null);
    }
});

test('installed portable provenance is accepted only when version, tag, build and commit agree', () => {
    const current = readCurrentRelease(packagedApp(), metadata(367));
    assert.equal(current.tag, 'v0.8.0-portable.367');
    assert.equal(current.build, 367);
    assert.equal(current.commit, COMMIT_A);

    for (const bad of [
        { ...metadata(367), releaseBuild: 366 },
        { ...metadata(367), releaseTag: 'v0.8.1-portable.367' },
        { ...metadata(367), releaseCommit: 'not-a-commit' },
        { version: '0.8.0' },
    ]) {
        const value = readCurrentRelease(packagedApp(), bad);
        assert.equal(value.tag, null);
        assert.equal(value.provenance, 'unversioned');
    }
});

test('latest release validation ignores remote URLs and requires immutable official portable assets', () => {
    const latest = validateLatestRelease(releasePayload());
    assert.equal(latest.releasePageUrl, 'https://github.com/AaryaMody1301/ContextHalo/releases/tag/v0.8.0-portable.368');
    assert.equal(latest.executable.sha256, EXE_DIGEST);
    assert.equal(latest.checksum.sha256, SUM_DIGEST);
    assert.equal(latest.targetCommit, COMMIT_B);

    for (const invalid of [
        releasePayload(368, { draft: true }),
        releasePayload(368, { prerelease: true }),
        releasePayload(368, { tag_name: 'v0.8.0' }),
        releasePayload(368, { target_commitish: 'main' }),
        releasePayload(368, { assets: [] }),
        releasePayload(368, { assets: [{ name: 'ContextHalo-Windows-x64.exe', size: 1, digest: `sha256:${EXE_DIGEST}` }] }),
    ]) assert.throws(() => validateLatestRelease(invalid));
});

test('packaged update check returns sanitized notification metadata and shares one request', async () => {
    let calls = 0;
    let request;
    const controller = createPortableUpdateController({
        app: packagedApp(),
        packageMetadata: metadata(367),
        platform: 'win32',
        arch: 'x64',
        fetchImpl: async (url, options) => {
            calls += 1;
            request = { url, options };
            return response(releasePayload(368));
        },
    });

    const [first, second] = await Promise.all([controller.check(), controller.check()]);
    assert.equal(calls, 1);
    assert.equal(request.url, LATEST_RELEASE_API);
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.redirect, 'error');
    assert.equal(first.status, 'update-available');
    assert.equal(first.currentTag, 'v0.8.0-portable.367');
    assert.equal(first.latestTag, 'v0.8.0-portable.368');
    assert.equal(first.releasePageUrl, 'https://github.com/AaryaMody1301/ContextHalo/releases/tag/v0.8.0-portable.368');
    assert.equal(first.executable.sha256, EXE_DIGEST);
    assert.deepEqual(second, first);
    assert.equal(Object.hasOwn(first, 'browser_download_url'), false);
});

test('older/equal latest releases never downgrade the portable app', async () => {
    for (const latestBuild of [366, 367]) {
        const controller = createPortableUpdateController({
            app: packagedApp(),
            packageMetadata: metadata(367),
            platform: 'win32',
            arch: 'x64',
            fetchImpl: async () => response(releasePayload(latestBuild)),
        });
        assert.equal((await controller.check()).status, 'up-to-date');
    }
});

test('development, smoke and unknown builds do not contact the release service', async () => {
    for (const options of [
        { app: { isPackaged: false, getVersion: () => '0.8.0' }, packageMetadata: metadata(367), expected: 'development' },
        { app: packagedApp(), packageMetadata: metadata(367), smokeMode: true, expected: 'smoke-disabled' },
        { app: packagedApp(), packageMetadata: { version: '0.8.0' }, expected: 'unknown-build' },
    ]) {
        let calls = 0;
        const controller = createPortableUpdateController({
            ...options,
            platform: 'win32',
            arch: 'x64',
            fetchImpl: async () => { calls += 1; throw new Error('must not fetch'); },
        });
        assert.equal((await controller.check()).status, options.expected);
        assert.equal(calls, 0);
    }
});

test('bad status, oversized or malformed release metadata fails closed without remote error content', async () => {
    const cases = [
        async () => ({ ok: false, status: 500, headers: { get: () => '0' }, arrayBuffer: async () => new ArrayBuffer(0) }),
        async () => response(releasePayload(), { contentLength: 300_000 }),
        async () => response(releasePayload(368, { assets: [] })),
    ];
    for (const fetchImpl of cases) {
        const controller = createPortableUpdateController({
            app: packagedApp(),
            packageMetadata: metadata(367),
            platform: 'win32',
            arch: 'x64',
            fetchImpl,
        });
        const result = await controller.check();
        assert.equal(result.status, 'error');
        assert.equal(result.message, 'Could not check the official ContextHalo release feed. Your current app is unchanged.');
        assert.equal(result.releasePageUrl, undefined);
    }
});

test('Phase 7 portable updates remain notification-only and build provenance is injected by CI', () => {
    const updateMain = fs.readFileSync('src/utils/updateMain.js', 'utf8');
    const index = fs.readFileSync('src/index.js', 'utf8');
    const renderer = fs.readFileSync('src/utils/renderer.js', 'utf8');
    const workflow = fs.readFileSync('.github/workflows/build-windows.yml', 'utf8');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

    assert.doesNotMatch(updateMain, /child_process|spawn\(|execFile\(|writeFile|createWriteStream|shell\.openExternal/);
    assert.doesNotMatch(index + renderer, /autoUpdater|electron-updater/);
    assert.deepEqual(pkg.build.win.target, [{ target: 'portable', arch: ['x64'] }]);
    assert.match(workflow, /extraMetadata\.releaseBuild=\$\{\{ github\.run_number \}\}/);
    assert.match(workflow, /extraMetadata\.releaseTag=v0\.8\.0-portable\.\$\{\{ github\.run_number \}\}/);
    assert.match(workflow, /extraMetadata\.releaseCommit=\$\{\{ github\.sha \}\}/);
    assert.match(workflow, /releaseTag -ne "v0\.8\.0-portable\.\$\{\{ github\.run_number \}\}"/);
});
