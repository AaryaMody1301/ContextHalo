const PACKAGE_METADATA = require('../../package.json');

const RELEASE_REPOSITORY = 'AaryaMody1301/ContextHalo';
const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
const RELEASE_PAGE_BASE = `https://github.com/${RELEASE_REPOSITORY}/releases/tag/`;
const RELEASE_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)-portable\.(\d+)$/;
const SHA256_PATTERN = /^sha256:([a-f0-9]{64})$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const EXPECTED_EXECUTABLE = 'ContextHalo-Windows-x64.exe';
const EXPECTED_CHECKSUM = 'SHA256SUMS.txt';
const MIN_EXECUTABLE_BYTES = 1024 * 1024;
const MAX_CHECKSUM_BYTES = 4096;
const MAX_RELEASE_JSON_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;
const CACHE_MS = 15 * 60 * 1000;

function parsePortableReleaseTag(value) {
    const match = RELEASE_TAG_PATTERN.exec(String(value || ''));
    if (!match) return null;
    const [major, minor, patch, build] = match.slice(1).map(Number);
    if (![major, minor, patch, build].every(Number.isSafeInteger)) return null;
    const version = `${major}.${minor}.${patch}`;
    return { tag: match[0], version, appVersion: `${version}-portable.${build}`, major, minor, patch, build };
}

function comparePortableReleases(left, right) {
    for (const key of ['major', 'minor', 'patch', 'build']) {
        const delta = Number(left?.[key]) - Number(right?.[key]);
        if (delta) return delta < 0 ? -1 : 1;
    }
    return 0;
}

function readCurrentRelease(appLike, packageMetadata = PACKAGE_METADATA) {
    const version = String(appLike?.getVersion?.() || packageMetadata?.version || '').trim();
    const releaseTag = String(packageMetadata?.releaseTag || '').trim();
    const releaseBuild = Number(packageMetadata?.releaseBuild);
    const releaseCommit = String(packageMetadata?.releaseCommit || '').trim().toLowerCase();
    const parsed = parsePortableReleaseTag(releaseTag);
    const versionMatches = Boolean(parsed && (version === parsed.version || version === parsed.appVersion));
    const valid = Boolean(parsed
        && versionMatches
        && Number.isSafeInteger(releaseBuild)
        && releaseBuild >= 0
        && parsed.build === releaseBuild
        && COMMIT_PATTERN.test(releaseCommit));

    return {
        version,
        build: valid ? releaseBuild : null,
        tag: valid ? releaseTag : null,
        commit: valid ? releaseCommit : null,
        provenance: valid ? 'ci-release' : 'unversioned',
    };
}

function findAsset(assets, name) {
    const matches = assets.filter(asset => asset?.name === name);
    if (matches.length !== 1) throw new Error(`Release must contain exactly one ${name} asset.`);
    return matches[0];
}

function validatedAsset(asset, { minSize = 1, maxSize = Number.MAX_SAFE_INTEGER } = {}) {
    const size = Number(asset?.size);
    const digestMatch = SHA256_PATTERN.exec(String(asset?.digest || ''));
    if (!Number.isSafeInteger(size) || size < minSize || size > maxSize || !digestMatch) {
        throw new Error('Release asset metadata is incomplete.');
    }
    return { name: asset.name, size, sha256: digestMatch[1] };
}

function validateLatestRelease(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.draft === true || payload.prerelease === true) {
        throw new Error('Latest release metadata is invalid.');
    }

    const parsed = parsePortableReleaseTag(payload.tag_name);
    if (!parsed) throw new Error('Latest release tag is not a ContextHalo portable release.');
    const targetCommit = String(payload.target_commitish || '').trim().toLowerCase();
    if (!COMMIT_PATTERN.test(targetCommit)) throw new Error('Latest release commit is not immutable.');

    const assets = Array.isArray(payload.assets) ? payload.assets : [];
    const executable = validatedAsset(findAsset(assets, EXPECTED_EXECUTABLE), { minSize: MIN_EXECUTABLE_BYTES });
    const checksum = validatedAsset(findAsset(assets, EXPECTED_CHECKSUM), { maxSize: MAX_CHECKSUM_BYTES });
    const publishedAt = String(payload.published_at || '');
    if (!Number.isFinite(Date.parse(publishedAt))) throw new Error('Latest release publication time is invalid.');

    return {
        ...parsed,
        targetCommit,
        publishedAt,
        releasePageUrl: RELEASE_PAGE_BASE + encodeURIComponent(parsed.tag),
        executable,
        checksum,
    };
}

async function readBoundedJson(response) {
    const declared = Number(response?.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > MAX_RELEASE_JSON_BYTES) throw new Error('Release metadata response is too large.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_RELEASE_JSON_BYTES) throw new Error('Release metadata response is too large.');
    return JSON.parse(buffer.toString('utf8'));
}

function publicCurrent(current) {
    return {
        currentVersion: current.version,
        currentBuild: current.build,
        currentTag: current.tag,
        currentCommit: current.commit,
    };
}

function createPortableUpdateController({
    app,
    fetchImpl = globalThis.fetch,
    platform = process.platform,
    arch = process.arch,
    smokeMode = false,
    packageMetadata = PACKAGE_METADATA,
    now = Date.now,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    let cached = null;
    let inFlight = null;

    const current = () => readCurrentRelease(app, packageMetadata);

    async function performCheck() {
        const installed = current();
        const base = publicCurrent(installed);

        if (smokeMode) return { status: 'smoke-disabled', ...base };
        if (platform !== 'win32' || arch !== 'x64') return { status: 'unsupported-platform', ...base };
        if (!app?.isPackaged) return { status: 'development', ...base };
        if (!installed.tag) return { status: 'unknown-build', ...base };

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(Object.assign(new Error('Update check timed out'), { name: 'AbortError' })), timeoutMs);
        try {
            const response = await fetchImpl(LATEST_RELEASE_API, {
                method: 'GET',
                redirect: 'error',
                signal: controller.signal,
                headers: {
                    Accept: 'application/vnd.github+json',
                    'User-Agent': `ContextHalo/${installed.version}`,
                    'X-GitHub-Api-Version': '2022-11-28',
                },
            });
            if (!response?.ok || response.status !== 200) throw new Error('Release service returned an unexpected status.');
            const latest = validateLatestRelease(await readBoundedJson(response));
            const installedParsed = parsePortableReleaseTag(installed.tag);
            const newer = comparePortableReleases(latest, installedParsed) > 0;

            return {
                status: newer ? 'update-available' : 'up-to-date',
                ...base,
                latestVersion: latest.version,
                latestBuild: latest.build,
                latestTag: latest.tag,
                latestCommit: latest.targetCommit,
                publishedAt: latest.publishedAt,
                releasePageUrl: latest.releasePageUrl,
                executable: latest.executable,
            };
        } catch {
            return {
                status: 'error',
                ...base,
                message: 'Could not check the official ContextHalo release feed. Your current app is unchanged.',
            };
        } finally {
            clearTimeout(timer);
        }
    }

    async function check() {
        const timestamp = now();
        if (cached && timestamp - cached.checkedAt < CACHE_MS) return { ...cached.value };
        if (inFlight) return inFlight;
        inFlight = performCheck().then(value => {
            cached = { checkedAt: now(), value };
            return { ...value };
        }).finally(() => { inFlight = null; });
        return inFlight;
    }

    return { check, current };
}

module.exports = {
    RELEASE_REPOSITORY,
    LATEST_RELEASE_API,
    EXPECTED_EXECUTABLE,
    EXPECTED_CHECKSUM,
    parsePortableReleaseTag,
    comparePortableReleases,
    readCurrentRelease,
    validateLatestRelease,
    createPortableUpdateController,
};
