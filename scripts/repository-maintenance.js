const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Retain this pre-cleanup build until an explicitly reviewed replacement exists.
const ROLLBACK_TAG = 'v0.8.0-portable.306';

// These historical branches were reviewed after Phase 10 and are fully superseded
// by later main-line work. Deletion is allowed only while the branch still points
// at the exact audited SHA; any new push automatically preserves the branch.
const SUPERSEDED_BRANCHES = new Map([
    ['audit/final-repo-readiness-2026-09-13', 'bc78353799d2e75d427e478e13f835110615731a'],
    ['cleanup/ponytail-windows-only', '73d0edd50ad6404ada9341494a6fb74e981b1815'],
    ['final-api-ui-audit-20260913', '763ec5f2ed02f4d23ef4880868e3dae4b79b94d5'],
    ['fix/final-api-runtime-hardening', '04ebee29fa905107882b68fbb11f2dc0f2d8d020'],
    ['fix/gemini-screen-reliability', 'a72f2e09224312653e0da01b74c05e8642a07660'],
    ['fix/ws-8.21.3-security', '09ab0d743069b9f94f46b77b0ab5f39989597c6a'],
]);
function branchRetention(branch, { defaultBranch, currentBranch, openHeads, merged }) {
    if (branch.name === 'main' || branch.name === defaultBranch) return 'default branch';
    if (branch.name === currentBranch) return 'current workflow branch';
    if (branch.protected) return 'protected branch';
    if (openHeads.has(branch.name)) return 'open pull request';
    const supersededSha = SUPERSEDED_BRANCHES.get(branch.name);
    if (supersededSha) return branch.commit?.sha === supersededSha ? null : 'superseded branch changed';
    return merged ? null : 'unmerged work';
}
function releasePlan(releases, latestId) {
    const automated = releases.filter(release => /^v\d+\.\d+\.\d+-portable\.\d+$/.test(release.tag_name)
        && release.author?.login === 'github-actions[bot]' && !release.draft && !release.prerelease)
        .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
    const complete = automated.filter(release => ['ContextHalo-Windows-x64.exe', 'SHA256SUMS.txt']
        .every(name => release.assets?.some(asset => asset.name === name && asset.state === 'uploaded')));
    if (complete.length < 3) return [];
    const cutoff = complete[2].published_at;
    // Older builds predate checksum publishing. Do not keep them forever, but
    // leave newer/in-progress uploads alone until three complete successors exist.
    return automated.filter(release => release.published_at < cutoff && release.id !== latestId && release.tag_name !== ROLLBACK_TAG);
}

async function maintain({ apply = false } = {}) {
    const repository = process.env.GITHUB_REPOSITORY;
    if (repository !== 'AaryaMody1301/ContextHalo') throw new Error('Maintenance is restricted to the ContextHalo repository');
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) throw new Error('A repository-scoped GitHub token is required');
    const root = `https://api.github.com/repos/${repository}`;
    const api = async (endpoint, method = 'GET') => {
        const response = await fetch(root + endpoint, { method, signal: AbortSignal.timeout(30000), headers: {
            Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        } });
        if (!response.ok) throw new Error(`GitHub ${method} ${endpoint} returned ${response.status}`);
        return response.status === 204 ? null : response.json();
    };
    const list = async endpoint => {
        const items = [];
        for (let page = 1; ; page++) {
            const batch = await api(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
            if (!Array.isArray(batch)) throw new Error('Unexpected GitHub list response');
            items.push(...batch);
            if (batch.length < 100) return items;
        }
    };
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const ancestor = (head, main) => {
        if (!/^[a-f0-9]{40}$/.test(head || '')) return false;
        try { git('merge-base', '--is-ancestor', head, main); return true; }
        catch (error) { if (error.status === 1) return false; throw new Error('Full Git history is required to prove branch ancestry'); }
    };
    const repo = await api('');
    const defaultBranch = repo.default_branch;
    const mainSha = (await api(`/branches/${encodeURIComponent(defaultBranch)}`)).commit.sha;
    const branches = await list('/branches');
    const releases = await list('/releases');
    const pulls = await list('/pulls?state=all');
    const openHeads = new Set(pulls.filter(pr => pr.state === 'open' && pr.head.repo?.full_name === repository).map(pr => pr.head.ref));
    const report = { apply, base: mainSha, startedAt: new Date().toISOString(), before: { branches: branches.length, releases: releases.length },
        branchInventory: branches.map(branch => ({ name: branch.name, sha: branch.commit.sha })),
        releaseInventory: releases.map(release => ({ id: release.id, tag: release.tag_name, commit: release.target_commitish, immutable: release.immutable === true })),
        deletedBranches: [], keptBranches: [], deletedReleases: [], keptReleases: [], errors: [] };
    try {
        for (const branch of branches) {
            const merged = ancestor(branch.commit.sha, mainSha) || pulls.some(pr => pr.merged_at && pr.base.ref === defaultBranch
                && pr.head.repo?.full_name === repository && pr.head.sha === branch.commit.sha && ancestor(pr.merge_commit_sha, mainSha));
            let reason = branchRetention(branch, { defaultBranch, currentBranch: process.env.GITHUB_REF_NAME, openHeads, merged });
            if (!reason && apply) {
                try {
                    const fresh = await api(`/branches/${encodeURIComponent(branch.name)}`);
                    const active = await list(`/pulls?state=open&head=${encodeURIComponent(repository.split('/')[0] + ':' + branch.name)}`);
                    if (fresh.protected || fresh.commit.sha !== branch.commit.sha || active.length) reason = 'branch changed or became active';
                    else {
                        // Compare-and-delete: a concurrent push must not lose new work.
                        const ref = `refs/heads/${branch.name}`;
                        git('push', `--force-with-lease=${ref}:${branch.commit.sha}`, 'origin', `:${ref}`);
                    }
                } catch { reason = 'deletion refused'; report.errors.push(`Branch ${branch.name}: deletion refused; left untouched`); }
            }
            if (reason) report.keptBranches.push({ name: branch.name, reason });
            else report.deletedBranches.push({ name: branch.name, sha: branch.commit.sha });
        }
        // Re-read releases after branch maintenance so concurrent builds are retained.
        const currentReleases = await list('/releases');
        const latest = currentReleases.some(release => !release.draft && !release.prerelease) ? await api('/releases/latest') : null;
        const obsolete = releasePlan(currentReleases, latest?.id);
        for (const release of obsolete) {
            try {
                if (apply) {
                    const fresh = await api(`/releases/${release.id}`);
                    if (fresh.updated_at !== release.updated_at || fresh.draft || fresh.prerelease) continue;
                    await api(`/releases/${release.id}`, 'DELETE');
                }
                report.deletedReleases.push({ id: release.id, tag: release.tag_name });
            } catch { report.errors.push(`Release ${release.tag_name}: deletion refused; left untouched`); }
        }
        const deleted = new Set(report.deletedReleases.map(release => release.id));
        report.keptReleases = currentReleases.filter(release => !deleted.has(release.id)).map(release => ({ id: release.id, tag: release.tag_name }));
        report.after = { branches: (await list('/branches')).length, releases: (await list('/releases')).length };
    } finally {
        const destination = path.join('qa-results', 'repository-maintenance.json');
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify(report, null, 2));
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
            `## Repository maintenance (${apply ? 'applied' : 'dry run'})\n\nBranches: ${report.before.branches} -> ${report.after?.branches ?? 'not completed'}. Releases: ${report.before.releases} -> ${report.after?.releases ?? 'not completed'}. Tags are unchanged.\n`);
    }
    if (report.errors.length) throw new Error('Some maintenance operations were refused; inspect the retained inventory');
    return report;
}
if (require.main === module) {
    if (process.argv.slice(2).some(arg => !['--apply', '--dry-run'].includes(arg))) throw new Error('Use --dry-run or --apply');
    maintain({ apply: process.argv.includes('--apply') }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { branchRetention, releasePlan, ROLLBACK_TAG, SUPERSEDED_BRANCHES };
