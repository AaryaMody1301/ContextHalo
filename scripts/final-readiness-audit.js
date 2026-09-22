const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT_ALLOWED = new Set([
    '.editorconfig',
    '.env.example',
    '.gitattributes',
    '.gitignore',
    '.prettierignore',
    '.prettierrc',
    'AGENTS.md',
    'CODE_OF_CONDUCT.md',
    'CONTRIBUTING.md',
    'CREDITS.md',
    'LICENSE',
    'README.md',
    'SECURITY.md',
    'SUPPORT.md',
    'THIRD_PARTY_NOTICES.md',
    'package.json',
    'package-lock.json',
    'preload.js',
]);

const REQUIRED_PHASE_EVIDENCE = [
    'docs/PHASE_0_BASELINE_FREEZE_2026-09-20.md',
    'docs/PHASE_1_REPOSITORY_PROVENANCE_AUDIT_2026-09-20.md',
    'docs/PHASE_2_API_CONTRACT_AUDIT_2026-09-21.md',
    'docs/PHASE_3_ELECTRON_SECURITY_AUDIT_2026-09-21.md',
    'docs/PHASE_4_LOCAL_AI_SUPPLY_CHAIN_AUDIT_2026-09-21.md',
    'docs/PHASE_5_RENDERER_DEPENDENCY_AUDIT_2026-09-21.md',
    'docs/PHASE_6_ARCHITECTURE_AUDIT_2026-09-21.md',
    'docs/PHASE_7_SAFE_PORTABLE_UPDATE_AUDIT_2026-09-21.md',
    'docs/PHASE_8_RELEASE_GOVERNANCE_AUDIT_2026-09-22.md',
    'docs/PHASE_9_REAL_WORLD_ACCEPTANCE_2026-09-22.md',
];

function trackedFiles() {
    return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
        .split('\0')
        .filter(Boolean)
        .sort();
}

function classifyTrackedFile(file) {
    if (ROOT_ALLOWED.has(file)) return 'root';
    if (file.startsWith('.github/')) return 'repository-automation';
    if (file.startsWith('docs/')) return 'documentation-evidence';
    if (file.startsWith('scripts/')) return 'build-test-maintenance';
    if (file.startsWith('tests/')) return 'test';
    if (file.startsWith('src/assets/')) return 'runtime-asset';
    if (file.startsWith('src/components/')) return 'runtime-ui';
    if (file.startsWith('src/utils/')) return 'runtime-utility';
    if (/^src\/[^/]+\.(?:js|html)$/.test(file)) return 'runtime-entry';
    return null;
}

function gitBlob(file) {
    return execFileSync('git', ['hash-object', '--', file], { encoding: 'utf8' }).trim();
}

function isSha256(value) {
    return /^[a-f0-9]{64}$/i.test(String(value || ''));
}

function auditRepository(root = process.cwd()) {
    const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    const read = file => fs.readFileSync(path.join(root, file), 'utf8');
    const files = trackedFiles();
    const unclassified = files.filter(file => !classifyTrackedFile(file));
    const missingPhaseEvidence = REQUIRED_PHASE_EVIDENCE.filter(file => !fs.existsSync(path.join(root, file)));

    const pkg = readJson('package.json');
    const lock = readJson('package-lock.json');
    const provenance = readJson('docs/THIRD_PARTY_PROVENANCE.json');
    const phase9 = readJson('docs/PHASE_9_ACCEPTANCE_MATRIX_TEMPLATE.json');
    const phase10 = readJson('docs/PHASE_10_RELEASE_READINESS.json');

    const provenancePackages = new Map((provenance.productionNpm || []).map(item => [item.package, item]));
    const directDependencyMismatches = [];
    for (const [name, version] of Object.entries(pkg.dependencies || {})) {
        const recorded = provenancePackages.get(name);
        if (!recorded || recorded.version !== version) {
            directDependencyMismatches.push({ package: name, packageVersion: version, provenanceVersion: recorded?.version || null });
        }
        const locked = lock.packages?.[`node_modules/${name}`]?.version;
        if (locked !== version) {
            directDependencyMismatches.push({ package: name, packageVersion: version, lockVersion: locked || null });
        }
    }

    const vendoredJs = files.filter(file => /^src\/assets\/.*\.js$/i.test(file));
    const provenanceByPath = new Map((provenance.vendoredRenderer || []).map(item => [item.path, item]));
    const vendoredMismatches = [];
    for (const file of vendoredJs) {
        const record = provenanceByPath.get(file);
        if (!record) {
            vendoredMismatches.push({ path: file, reason: 'missing provenance' });
            continue;
        }
        const blob = gitBlob(file);
        if (record.trackedBlobSha !== blob) vendoredMismatches.push({ path: file, reason: 'blob mismatch', expected: record.trackedBlobSha, actual: blob });
        if (!record.version || !record.license || !record.upstream) vendoredMismatches.push({ path: file, reason: 'incomplete provenance' });
    }

    const nativeProblems = [];
    for (const runtime of provenance.nativeRuntime || []) {
        if (!isSha256(runtime.sha256)) nativeProblems.push({ role: runtime.role, reason: 'invalid sha256' });
        if (!runtime.source || !runtime.revision || !runtime.license) nativeProblems.push({ role: runtime.role, reason: 'incomplete provenance' });
        if (!/official checksum-pinned/i.test(String(runtime.status || ''))) nativeProblems.push({ role: runtime.role, reason: 'not recorded as official checksum-pinned' });
    }
    for (const model of provenance.whisperModels || []) {
        if (!isSha256(model.sha256) || !/^[a-f0-9]{40}$/i.test(String(model.revision || ''))) {
            nativeProblems.push({ role: `whisper model ${model.id}`, reason: 'model revision/checksum is not immutable' });
        }
    }

    const workflow = read('.github/workflows/build-windows.yml');
    const security = read('docs/PHASE_3_ELECTRON_SECURITY_AUDIT_2026-09-21.md');
    const workflowChecks = {
        productionAudit: /npm audit --omit=dev --audit-level=high/.test(workflow),
        artifactAttestation: /name: Attest ContextHalo Windows release/.test(workflow) && /actions\/attest@1e69f48acb82d1966a394da916b4c1698aa569d6/.test(workflow),
        authenticodeMeasured: /Get-AuthenticodeSignature/.test(workflow) && /authenticode\.json/.test(workflow),
        packagedScaleMatrix: /100, 125, 150 and 200 percent Chromium scale/.test(workflow),
        trustedIpcDocumented: /sender/i.test(security) && /IPC/i.test(security),
    };

    const physicalStatusCounts = {};
    for (const scenario of phase9.requiredScenarios || []) {
        const status = String(scenario.status || 'missing');
        physicalStatusCounts[status] = (physicalStatusCounts[status] || 0) + 1;
    }
    const physicalComplete = (phase9.requiredScenarios || []).length > 0
        && (phase9.requiredScenarios || []).every(item => ['pass', 'not-applicable'].includes(item.status));

    const openBlockers = (phase10.externalBlockers || []).filter(item => item.status !== 'resolved');

    const staticChecks = {
        allTrackedFilesClassified: unclassified.length === 0,
        phaseEvidenceComplete: missingPhaseEvidence.length === 0,
        directDependenciesProvenanced: directDependencyMismatches.length === 0,
        vendoredRendererProvenanced: vendoredMismatches.length === 0,
        nativeDownloadsImmutableAndVerified: nativeProblems.length === 0,
        workflowReleaseChecksPresent: Object.values(workflowChecks).every(Boolean),
        phase10ManifestBaselineMatches: phase10.baseline?.mainSha === '2914c8873666603aaaf1f4791019258693219ce6'
            && phase10.baseline?.releaseTag === 'v0.8.0-portable.381',
    };

    const staticReady = Object.values(staticChecks).every(Boolean);
    const finalReady = staticReady && physicalComplete && openBlockers.length === 0;

    return {
        staticReady,
        finalReady,
        staticChecks,
        details: {
            trackedFileCount: files.length,
            unclassified,
            missingPhaseEvidence,
            directDependencyMismatches,
            vendoredMismatches,
            nativeProblems,
            workflowChecks,
            physicalStatusCounts,
            openBlockers: openBlockers.map(item => ({ id: item.id, type: item.type, status: item.status })),
        },
    };
}

function main(argv = process.argv.slice(2)) {
    const report = auditRepository();
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (!report.staticReady) process.exitCode = 1;
    if (argv.includes('--require-final') && !report.finalReady) process.exitCode = 2;
    return report;
}

if (require.main === module) main();

module.exports = {
    ROOT_ALLOWED,
    REQUIRED_PHASE_EVIDENCE,
    classifyTrackedFile,
    auditRepository,
    main,
};
