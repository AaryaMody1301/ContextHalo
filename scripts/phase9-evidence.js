const REPORT_RESULTS = new Set(['Pass', 'Fail', 'Blocked', 'Not applicable']);

function isSha256(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isCommit(value) {
    return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
}

function utcMillis(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) return NaN;
    const date = new Date(value);
    const normalized = value.replace(/(?:\.(\d+))?Z$/, (_, fraction = '') => `.${fraction.padEnd(3, '0')}Z`);
    return Number.isFinite(date.getTime()) && date.toISOString() === normalized ? date.getTime() : NaN;
}

function hasText(value) {
    return typeof value === 'string' && Boolean(value.trim());
}

function hasTimedEvidence(scenario, evidence, runs, candidate) {
    const minimumHours = scenario.durationHours || 0;
    const minimumMs = minimumHours ? minimumHours * 3600000 : scenario.durationMinutes * 60000;
    return evidence.evidence.some(reference => {
        const run = runs.get(reference);
        if (!run) return false;
        const start = utcMillis(run.startedAtUtc);
        const end = utcMillis(run.endedAtUtc);
        return run.sourceCommit === candidate.sourceCommit && run.portableExeSha256 === candidate.portableExeSha256
            && start >= utcMillis(candidate.verifiedAtUtc)
            && run.automatedRecorderChecksPassed === true
            && end <= utcMillis(evidence.utcTimestamp)
            && Number.isSafeInteger(run.elapsedMs) && run.elapsedMs >= minimumMs
            && Math.abs(end - start - run.elapsedMs) <= 2
            && Number.isSafeInteger(run.reportMinimumHours) && run.reportMinimumHours >= minimumHours
            && Number.isSafeInteger(run.activeSessionSamples) && run.activeSessionSamples > 0
            && run.fatalElectronEvents === 0
            && Array.isArray(run.missingCheckpointsHours) && run.missingCheckpointsHours.length === 0;
    });
}

function evaluatePhase9Evidence(matrix, report, expectedCandidate = {}) {
    const requirements = Array.isArray(matrix?.requiredScenarios) ? matrix.requiredScenarios : [];
    const rows = Array.isArray(report?.scenarios) ? report.scenarios : [];
    const issues = [];
    const statusCounts = {};
    const candidate = report?.candidate;
    if (!requirements.length || new Set(requirements.map(row => row.id)).size !== requirements.length) {
        issues.push('Invalid Phase 9 scenario definitions.');
    }
    if (report?.schemaVersion !== 1 || report?.phase !== 9 || !rows.length) {
        issues.push('Missing or invalid Phase 9 results.');
    }
    if (!isCommit(candidate?.sourceCommit) || !isSha256(candidate?.portableExeSha256)
        || candidate?.verifiedBeforeLaunch !== true || !Number.isFinite(utcMillis(candidate?.verifiedAtUtc))
        || !hasText(candidate?.appVersion)) {
        issues.push('Candidate provenance or pre-launch verification is incomplete.');
    }
    if (!isCommit(expectedCandidate.sourceCommit) || !isSha256(expectedCandidate.portableExeSha256)) {
        issues.push('An independently verified candidate commit and EXE SHA-256 are required.');
    }
    if (String(candidate?.sourceCommit || '').toLowerCase() !== String(expectedCandidate.sourceCommit || '').toLowerCase()
        || String(candidate?.portableExeSha256 || '').toLowerCase() !== String(expectedCandidate.portableExeSha256 || '').toLowerCase()) {
        issues.push('Physical evidence does not match the current candidate.');
    }

    const byId = new Map();
    const requiredIds = new Set(requirements.map(row => row.id));
    for (const row of rows) {
        if (!requiredIds.has(row?.id) || byId.has(row.id)) {
            issues.push('Results contain an unknown or duplicate scenario.');
            continue;
        }
        byId.set(row.id, row);
    }
    const runs = new Map();
    for (const run of Array.isArray(report?.runs) ? report.runs : []) {
        if (!hasText(run?.directory) || runs.has(run.directory)) {
            issues.push('Results contain an invalid or duplicate recorder run.');
            continue;
        }
        runs.set(run.directory, run);
    }
    for (const scenario of requirements) {
        const row = byId.get(scenario.id);
        const result = REPORT_RESULTS.has(row?.result) ? row.result : row ? 'invalid' : 'missing';
        statusCounts[result] = (statusCounts[result] || 0) + 1;
        if (result !== 'Pass' && !(result === 'Not applicable' && scenario.allowNotApplicable === true)) {
            issues.push(`${scenario.id}: ${result}.`);
            continue;
        }
        if (!candidate || row.sourceCommit !== candidate.sourceCommit || row.portableExeSha256 !== candidate.portableExeSha256
            || !(utcMillis(row.utcTimestamp) >= utcMillis(candidate.verifiedAtUtc))
            || !hasText(row.reason) || !Array.isArray(row.evidence) || !row.evidence.length || !row.evidence.every(hasText)
            || (result === 'Pass' && (!hasText(row.device) || !hasText(row.windowsBuild)))) {
            issues.push(`${scenario.id}: incomplete or mismatched evidence.`);
        } else if (result === 'Pass' && (scenario.durationHours || scenario.durationMinutes) && !hasTimedEvidence(scenario, row, runs, candidate)) {
            issues.push(`${scenario.id}: required elapsed time and recorder checkpoints are unverified.`);
        }
    }
    return { complete: issues.length === 0, statusCounts, issues };
}

module.exports = { evaluatePhase9Evidence };
