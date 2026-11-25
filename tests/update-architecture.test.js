const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMain } = require('./helpers/native-boundary');
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
    return new Response(bytes, {
        status: options.status ?? 200,
        headers: { 'content-length': String(options.contentLength ?? bytes.byteLength) },
    });
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

test('Offline cancels external work, pauses updates and permits only non-redirecting loopback', async () => {
    const calls = [];
    const scope = { fetch: async (input, init) => {
        calls.push({ input, init });
        if (input.startsWith('http://127.0.0.1:')) return new Response('ready');
        return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    } };
    const gate = loadMain('src/utils/offlineMode.js', {}, { global: scope });
    gate.installOfflineNetworkBoundary();
    const inFlight = scope.fetch('https://api.example.test/catalog');
    const inactive = createPortableUpdateController({
        app: packagedApp(), packageMetadata: metadata(), platform: 'win32', arch: 'x64',
        isOffline: gate.isOfflineMode, fetchImpl: scope.fetch,
    });
    gate.setOfflineMode(gate.offlineSelected({ providerMode: 'local', localOffline: true }));
    await assert.rejects(inFlight, { code: 'OFFLINE_MODE' });
    assert.equal((await inactive.check()).status, 'offline');
    await assert.rejects(scope.fetch('https://example.test/model.gguf'), { code: 'OFFLINE_MODE' });
    await assert.rejects(scope.fetch('http://localhost.example.test:1234/health'), { code: 'OFFLINE_MODE' });
    assert.equal(await (await scope.fetch('http://127.0.0.1:1234/health')).text(), 'ready');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].init.redirect, 'error');
    gate.setOfflineMode(gate.offlineSelected({ providerMode: 'groq', localOffline: true }));
    assert.equal(gate.isOfflineMode(), false);
    const controller = new AbortController();
    const resumed = scope.fetch('https://api.example.test/catalog', { signal: controller.signal });
    controller.abort();
    await assert.rejects(resumed, { name: 'AbortError' });
    assert.equal(calls.length, 3);
});

test('portable release tags compare semantic version and CI build number', () => {
    const current = parsePortableReleaseTag('v0.8.0-portable.367');
    const newerBuild = parsePortableReleaseTag('v0.8.0-portable.368');
    const newerVersion = parsePortableReleaseTag('v0.9.0-portable.1');
    assert.deepEqual(current, { tag: 'v0.8.0-portable.367', version: '0.8.0', appVersion: '0.8.0-portable.367', major: 0, minor: 8, patch: 0, build: 367 });
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

    const exact = readCurrentRelease(packagedApp('0.8.0-portable.367'), {
        ...metadata(367),
        version: '0.8.0-portable.367',
    });
    assert.equal(exact.tag, 'v0.8.0-portable.367');
    assert.equal(exact.version, '0.8.0-portable.367');

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
    assert.equal(request.options.headers['X-GitHub-Api-Version'], '2026-03-10');
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

test('update metadata streams within 256 KiB and cancels oversize or stalled bodies', async () => {
    const bytes = Buffer.from(JSON.stringify(releasePayload()));
    for (const mode of ['valid', 'declared', 'streamed', 'stalled']) {
        let cancelled = false;
        let sent = false;
        const body = new ReadableStream({
            pull(stream) {
                if (mode === 'stalled') return;
                if (mode === 'valid') {
                    if (!sent) stream.enqueue(bytes.subarray(0, 32));
                    else {
                        stream.enqueue(bytes.subarray(32));
                        stream.close();
                    }
                } else if (!sent) stream.enqueue(new Uint8Array(256 * 1024));
                else stream.enqueue(Uint8Array.of(32));
                sent = true;
            },
            cancel() { cancelled = true; },
        });
        const controller = createPortableUpdateController({
            app: packagedApp(),
            packageMetadata: metadata(),
            platform: 'win32',
            arch: 'x64',
            timeoutMs: mode === 'stalled' ? 20 : 1000,
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                body,
                headers: new Headers(mode === 'declared' ? { 'content-length': '262145' } : {}),
                arrayBuffer() { throw new Error('Full response buffering is disabled in this fixture'); },
            }),
        });
        assert.equal((await controller.check()).status, mode === 'valid' ? 'update-available' : 'error', mode);
        assert.equal(cancelled, mode !== 'valid', mode);
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
    assert.match(workflow, /id: release_metadata/);
    assert.match(workflow, /node -p "require\('\.\/package\.json'\)\.version"/);
    assert.match(workflow, /extraMetadata\.version=\$\{\{ steps\.release_metadata\.outputs\.app_version \}\}/);
    assert.match(workflow, /extraMetadata\.releaseBuild=\$\{\{ github\.run_number \}\}/);
    assert.match(workflow, /extraMetadata\.releaseTag=\$\{\{ steps\.release_metadata\.outputs\.tag \}\}/);
    assert.match(workflow, /extraMetadata\.releaseCommit=\$\{\{ github\.sha \}\}/);
    assert.match(workflow, /tag_name: \$\{\{ needs\.build\.outputs\.release_tag \}\}/);
    assert.match(workflow, /outcome\.version -ne "\$\{\{ steps\.release_metadata\.outputs\.app_version \}\}"/);
    assert.match(workflow, /releaseTag -ne "\$\{\{ steps\.release_metadata\.outputs\.tag \}\}"/);
});
