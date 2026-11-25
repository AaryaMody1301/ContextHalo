const { execFileSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');

const featureModules = new Set([
    'src/utils/knowledgeCore.js',
    'src/utils/knowledgeRagMain.js',
    'src/utils/knowledgeStore.js',
    'src/utils/phase4Main.js',
    'src/utils/phase4Renderer.js',
    'src/utils/practiceCore.js',
]);

function isDocumentation(file) {
    return file === 'README.md' || file === 'CONTRIBUTING.md' ||
        (file.startsWith('docs/') && file.endsWith('.md'));
}

function isApplicationSourceOrTest(file) {
    return featureModules.has(file) ||
        /^src\/components\/.+\.(?:js|css)$/.test(file) ||
        (file.startsWith('tests/') && file.endsWith('.js'));
}

function pullRequestScope(paths) {
    if (!paths.length) return 'portable';
    if (paths.every(isDocumentation)) return 'source';
    if (paths.every(file => isDocumentation(file) || isApplicationSourceOrTest(file))) return 'windows';
    return 'portable';
}

function validationScope(event, baseSha) {
    if (event !== 'pull_request' || !/^[a-f0-9]{40}$/.test(baseSha || '')) return 'portable';
    try {
        // A move out of application code must still include the original path.
        const changed = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', baseSha, 'HEAD', '--'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return pullRequestScope(changed.split('\0').filter(Boolean));
    } catch {
        return 'portable';
    }
}

if (require.main === module) {
    const scope = validationScope(process.env.GITHUB_EVENT_NAME, process.env.PR_BASE_SHA);
    appendFileSync(process.env.GITHUB_OUTPUT, 'scope=' + scope + '\n');
}

module.exports = { pullRequestScope, validationScope };
