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

function selectShape(value, template) {
    if (Array.isArray(template)) {
        if (!Array.isArray(value)) return value;
        if (template.every(item => item && typeof item === 'object' && typeof item.type === 'string')) {
            return template.map(item => selectShape(value.find(candidate => candidate?.type === item.type), item));
        }
        if (template.every(item => item && typeof item === 'object' && typeof item.context === 'string')) {
            return template.map(item => selectShape(value.find(candidate => candidate?.context === item.context), item));
        }
        return template.map((item, index) => selectShape(value[index], item));
    }
    if (!template || typeof template !== 'object') return value;
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(Object.keys(template).map(key => [key, selectShape(source[key], template[key])]));
}

function samePolicy(left, right) {
    const desired = comparableRuleset(right);
    const actual = selectShape(comparableRuleset(left), desired);
    return JSON.stringify(stable(actual)) === JSON.stringify(stable(desired));
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

    const loadGovernance = async () => {
        const summaries = await request('/rulesets');
        const details = [];
        for (const summary of summaries) {
            details.push(await request(`/rulesets/${summary.id}`));
        }
        const immutableState = await request('/immutable-releases', { allow404: true });
        return { rulesets: details, immutable: immutableState?.enabled === true };
    };

    let state = await loadGovernance();

    if (apply) {
        const current = state.rulesets.find(item => item.name === policy.mainRuleset.name);
        if (!current) {
            await request('/rulesets', { method: 'POST', body: policy.mainRuleset });
        } else if (!samePolicy(current, policy.mainRuleset)) {
            await request(`/rulesets/${current.id}`, { method: 'PUT', body: policy.mainRuleset });
        }
        if (!state.immutable) await request('/immutable-releases', { method: 'PUT' });
        state = await loadGovernance();
    }

    const status = governanceStatus(state);
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

module.exports = { comparableRuleset, selectShape, samePolicy, governanceStatus, readPolicy };
