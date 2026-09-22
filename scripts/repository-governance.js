const fs = require('node:fs');
const path = require('node:path');

const POLICY_PATH = path.join(__dirname, '..', 'docs', 'PHASE_8_REPOSITORY_GOVERNANCE.json');

function readPolicy() {
    return JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
}

function comparableRuleset(value) {
    if (!value || typeof value !== 'object') return null;
    return {
        name: value.name,
        target: value.target,
        enforcement: value.enforcement,
        conditions: value.conditions,
        rules: value.rules,
    };
}

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function samePolicy(left, right) {
    return JSON.stringify(stable(comparableRuleset(left))) === JSON.stringify(stable(comparableRuleset(right)));
}

function governanceStatus({ rulesets, immutable }) {
    const policy = readPolicy();
    const ruleset = Array.isArray(rulesets) ? rulesets.find(item => item.name === policy.mainRuleset.name) : null;
    return {
        rulesetPresent: Boolean(ruleset),
        rulesetMatches: samePolicy(ruleset, policy.mainRuleset),
        immutableReleases: immutable === true,
        compliant: Boolean(ruleset && samePolicy(ruleset, policy.mainRuleset) && immutable === true),
    };
}

async function run({ apply = false, fetchImpl = globalThis.fetch } = {}) {
    const policy = readPolicy();
    const repository = process.env.GITHUB_REPOSITORY || policy.repository;
    if (repository !== policy.repository) throw new Error('Governance policy is restricted to the ContextHalo repository.');

    const token = process.env.GH_ADMIN_TOKEN;
    if (!token) throw new Error('GH_ADMIN_TOKEN with repository Administration permission is required.');

    const root = `https://api.github.com/repos/${repository}`;
    const request = async (endpoint, options = {}) => {
        const response = await fetchImpl(root + endpoint, {
            method: options.method || 'GET',
            body: options.body ? JSON.stringify(options.body) : undefined,
            signal: AbortSignal.timeout(30000),
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2026-03-10',
            },
        });
        if (options.allow404 && response.status === 404) return null;
        if (!response.ok) throw new Error(`GitHub ${options.method || 'GET'} ${endpoint} returned ${response.status}`);
        return response.status === 204 ? null : response.json();
    };

    let rulesets = await request('/rulesets');
    let immutable = Boolean(await request('/immutable-releases', { allow404: true }));

    if (apply) {
        const current = rulesets.find(item => item.name === policy.mainRuleset.name);
        if (!current) {
            await request('/rulesets', { method: 'POST', body: policy.mainRuleset });
        } else if (!samePolicy(current, policy.mainRuleset)) {
            await request(`/rulesets/${current.id}`, { method: 'PUT', body: policy.mainRuleset });
        }
        if (!immutable) await request('/immutable-releases', { method: 'PUT' });
        rulesets = await request('/rulesets');
        immutable = Boolean(await request('/immutable-releases', { allow404: true }));
    }

    const status = governanceStatus({ rulesets, immutable });
    const report = {
        repository,
        apply,
        checkedAt: new Date().toISOString(),
        status,
        desiredRuleset: policy.mainRuleset,
    };
    const destination = path.join('qa-results', 'repository-governance.json');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));

    if (!status.compliant) {
        const mode = apply ? 'could not establish' : 'does not currently satisfy';
        throw new Error(`Repository ${mode} the Phase 8 governance policy.`);
    }
    return report;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.some(arg => !['--audit', '--apply'].includes(arg)) || args.length !== 1) {
        throw new Error('Use exactly one of --audit or --apply.');
    }
    run({ apply: args[0] === '--apply' }).catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = { comparableRuleset, samePolicy, governanceStatus, readPolicy };
