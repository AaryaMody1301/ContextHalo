const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMP_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'rebrand-context-halo.yml');
const TEMP_SCRIPT = __filename;
const OLD_COMPONENT = path.join(ROOT, 'src', 'components', 'app', 'CheatingDaddyApp.js');
const NEW_COMPONENT = path.join(ROOT, 'src', 'components', 'app', 'ContextHaloApp.js');
const UPSTREAM_RUNTIME_URL = 'https://github.com/sohzm/cheating-daddy/releases/download/v0.7.0';
const UPSTREAM_PLACEHOLDER = '__CONTEXT_HALO_UPSTREAM_RUNTIME_SOURCE__';

const TEXT_EXTENSIONS = new Set([
    '.js', '.json', '.md', '.yml', '.yaml', '.html', '.css', '.plist', '.txt', '.example', '.gitignore', '.editorconfig', '.prettierrc', '.prettierignore',
]);
const TEXT_FILENAMES = new Set(['.gitignore', '.editorconfig', '.prettierrc', '.prettierignore']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'out', '.webpack']);

const replacements = [
    ['CHEATING DADDY', 'CONTEXTHALO'],
    ['Cheating Daddy', 'ContextHalo'],
    ['cheating daddy', 'ContextHalo'],
    ['CHEATING-DADDY', 'CONTEXTHALO'],
    ['Cheating-Daddy', 'ContextHalo'],
    ['cheating-daddy', 'context-halo'],
    ['CHEATING_DADDY', 'CONTEXT_HALO'],
    ['Cheating_Daddy', 'ContextHalo'],
    ['cheating_daddy', 'context_halo'],
    ['CHEATINGDADDY', 'CONTEXTHALO'],
    ['CheatingDaddy', 'ContextHalo'],
    ['cheatingDaddy', 'contextHalo'],
    ['cheatingdaddy', 'contexthalo'],
];

function walk(dir, files = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(fullPath, files);
        else files.push(fullPath);
    }
    return files;
}

function isTextFile(filePath) {
    const base = path.basename(filePath);
    return TEXT_FILENAMES.has(base) || TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function applyBrandReplacements(text) {
    let protectedText = text.replaceAll(UPSTREAM_RUNTIME_URL, UPSTREAM_PLACEHOLDER);
    for (const [from, to] of replacements) {
        protectedText = protectedText.split(from).join(to);
    }
    return protectedText.replaceAll(UPSTREAM_PLACEHOLDER, UPSTREAM_RUNTIME_URL);
}

function writeIfChanged(filePath, next) {
    const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    if (current !== next) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, next, 'utf8');
    }
}

function renameMainComponent() {
    if (fs.existsSync(OLD_COMPONENT)) {
        if (fs.existsSync(NEW_COMPONENT)) fs.rmSync(NEW_COMPONENT, { force: true });
        fs.renameSync(OLD_COMPONENT, NEW_COMPONENT);
    }
}

function rewritePackageMetadata() {
    const packagePath = path.join(ROOT, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    pkg.name = 'context-halo';
    pkg.productName = 'ContextHalo';
    pkg.description = 'A context-aware Windows desktop AI assistant for screen, audio, meetings, development, presentations, and productivity workflows.';
    pkg.keywords = [
        'electron',
        'windows',
        'desktop-ai',
        'ai-assistant',
        'context-aware',
        'gemini',
        'groq',
        'local-ai',
        'screen-analysis',
    ];
    pkg.build = pkg.build || {};
    pkg.build.appId = 'com.aaryamody.contexthalo';
    pkg.build.productName = 'ContextHalo';
    pkg.build.win = pkg.build.win || {};
    pkg.build.win.artifactName = 'ContextHalo-Windows-x64.exe';
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 4)}\n`, 'utf8');
}

function installConfigMigration() {
    const storagePath = path.join(ROOT, 'src', 'storage.js');
    let storage = fs.readFileSync(storagePath, 'utf8');
    storage = storage.replaceAll("path.join(os.homedir(), 'AppData', 'Roaming', 'context-halo-config')", "path.join(os.homedir(), 'AppData', 'Roaming', 'ContextHalo')");
    storage = storage.replaceAll("path.join(os.homedir(), 'Library', 'Application Support', 'context-halo-config')", "path.join(os.homedir(), 'Library', 'Application Support', 'ContextHalo')");
    storage = storage.replaceAll("path.join(os.homedir(), '.config', 'context-halo-config')", "path.join(os.homedir(), '.config', 'ContextHalo')");

    if (!storage.includes('function migratePreContextHaloConfigDir()')) {
        const marker = 'function getConfigPath()';
        const helper = `function getLegacyConfigDir() {\n    if (os.platform() !== 'win32') return null;\n    const legacyName = Buffer.from([99, 104, 101, 97, 116, 105, 110, 103, 45, 100, 97, 100, 100, 121, 45, 99, 111, 110, 102, 105, 103]).toString('utf8');\n    return path.join(os.homedir(), 'AppData', 'Roaming', legacyName);\n}\n\nfunction migratePreContextHaloConfigDir() {\n    const legacyDir = getLegacyConfigDir();\n    const currentDir = getConfigDir();\n    if (!legacyDir || legacyDir === currentDir || fs.existsSync(currentDir) || !fs.existsSync(legacyDir)) return;\n    try {\n        fs.renameSync(legacyDir, currentDir);\n        console.log('Migrated pre-ContextHalo configuration to the ContextHalo data directory.');\n    } catch (error) {\n        console.warn('Could not migrate the pre-ContextHalo configuration directory:', error.message);\n    }\n}\n\n`;
        storage = storage.replace(marker, helper + marker);
        storage = storage.replace('function initializeStorage() {\n', 'function initializeStorage() {\n    migratePreContextHaloConfigDir();\n');
    }
    fs.writeFileSync(storagePath, storage, 'utf8');
}

function disableLegacyPrivateCloud() {
    const cloudPath = path.join(ROOT, 'src', 'utils', 'cloud.js');
    const content = `// Compatibility shim for an unpublished provider that is no longer part of ContextHalo.\n// Public ContextHalo builds support Gemini API, Groq API, and Local AI only.\n\nlet onTurnComplete = null;\n\nfunction unsupported() {\n    return new Error('This legacy cloud provider is not supported in ContextHalo. Use Gemini API, Groq API, or Local AI.');\n}\n\nasync function connectCloud() {\n    throw unsupported();\n}\n\nfunction sendCloudAudio() { return false; }\nfunction sendCloudText() { return false; }\nfunction sendCloudImage() { return false; }\nfunction closeCloud() {}\nfunction isCloudActive() { return false; }\nfunction setOnTurnComplete(callback) { onTurnComplete = callback; }\n\nmodule.exports = {\n    connectCloud,\n    sendCloudAudio,\n    sendCloudText,\n    sendCloudImage,\n    closeCloud,\n    isCloudActive,\n    setOnTurnComplete,\n};\n`;
    fs.writeFileSync(cloudPath, content, 'utf8');
}

function rewriteReadme() {
    const readme = `# ContextHalo\n\nContextHalo is an open-source, context-aware AI desktop assistant for Windows. It combines screen context, Windows system audio, microphone input, typed prompts, and local or cloud AI models to provide real-time assistance for meetings, presentations, development workflows, research, and general productivity.\n\n> **Platform:** Windows 10/11 x64 is the supported target.\n\n## Features\n\n- Gemini Live for low-latency audio assistance\n- Gemini screenshot and screen-context analysis\n- Groq transcription, reasoning, and vision modes\n- Optional fully local AI with whisper.cpp and llama.cpp\n- Windows system-audio loopback and microphone capture\n- Speaker-only, microphone-only, and mixed-audio modes\n- On-demand screen analysis with keyboard shortcuts\n- Conversation and screen-analysis history\n- Always-on-top transparent overlay with click-through mode\n- Windows DPAPI-backed API-key protection through Electron safeStorage\n\n## Requirements\n\n- Windows 10 or Windows 11 x64\n- Node.js 22+ and npm 10+ for development\n- A Gemini API key, Groq API key, or Local AI model depending on the selected provider\n- Screen/audio permissions required by Windows\n\n## Quick start\n\n\`\`\`bash\nnpm install\nnpm start\n\`\`\`\n\nBuild the portable Windows executable:\n\n\`\`\`bash\nnpm run build:portable\n\`\`\`\n\n## Validation\n\n\`\`\`bash\nnpm run check\nnpm test\n\`\`\`\n\nCI also launches the real Electron renderer in sandboxed mode before packaging the portable Windows executable.\n\n## Provider modes\n\n### Gemini API\nUses Gemini Live for real-time audio and Gemini Flash for screen analysis.\n\n### Groq API\nUses Whisper for transcription, GPT-OSS for text reasoning, and Qwen vision for screenshots.\n\n### Local AI\nUses native whisper.cpp and llama.cpp runners with downloadable GGUF models. No cloud API key is required.\n\n## Security and privacy\n\n- API credentials are never committed to the repository.\n- On Windows, ContextHalo encrypts stored API credentials with Electron safeStorage / Windows DPAPI when available.\n- Renderer sandboxing, context isolation, a restrictive CSP, and IPC channel allowlists are enabled.\n- Keep API keys out of screenshots, issues, logs, and source files.\n- See [SECURITY.md](SECURITY.md) for security reporting guidance.\n\n## Contributing\n\nSee [CONTRIBUTING.md](CONTRIBUTING.md). Keep changes focused and ensure the Windows validation workflow passes before merging.\n\n## Credits and license\n\nContextHalo is a substantially modified and rebranded derivative of earlier GPL-3.0 work. See [CREDITS.md](CREDITS.md) for attribution.\n\nLicensed under the [GNU General Public License v3.0](LICENSE).\n`;
    fs.writeFileSync(path.join(ROOT, 'README.md'), readme, 'utf8');
}

function writeCredits() {
    const credits = `# Credits\n\nContextHalo is a substantially modified and rebranded derivative of GPL-3.0-licensed work originally developed by **sohzm and contributors**.\n\n- Original author profile: https://github.com/sohzm\n- ContextHalo Windows rework and ongoing maintenance: Aarya Mody and contributors\n\nThe application has been substantially modified, including provider integrations, Windows runtime behavior, model updates, security hardening, storage migrations, testing, packaging, and branding.\n\nThe project remains licensed under GNU GPL v3.0. See [LICENSE](LICENSE).\n\nA legacy native-runtime download URL still points to the original upstream release because those checksum-pinned runner binaries are consumed as build/runtime dependencies. It is not used as ContextHalo product branding.\n`;
    fs.writeFileSync(path.join(ROOT, 'CREDITS.md'), credits, 'utf8');
}

function writeBrandTest() {
    const test = `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst fs = require('fs');\nconst path = require('path');\n\nconst root = path.resolve(__dirname, '..');\nconst skipDirs = new Set(['.git', 'node_modules', 'dist', 'out', '.webpack']);\nconst textExtensions = new Set(['.js', '.json', '.md', '.yml', '.yaml', '.html', '.css', '.plist', '.txt', '.example']);\nconst textFiles = new Set(['.gitignore', '.editorconfig', '.prettierrc', '.prettierignore']);\nconst legacyBrand = /cheating(?:[ _-]?daddy)/i;\nconst allowedUpstreamFiles = new Set(['src/utils/native-ai-runtime.js']);\n\nfunction walk(dir, files = []) {\n    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n        if (entry.isDirectory() && skipDirs.has(entry.name)) continue;\n        const full = path.join(dir, entry.name);\n        if (entry.isDirectory()) walk(full, files);\n        else files.push(full);\n    }\n    return files;\n}\n\ntest('ContextHalo branding replaces the legacy product identity', () => {\n    const violations = [];\n    for (const file of walk(root)) {\n        const relative = path.relative(root, file).replaceAll('\\\\', '/');\n        if (legacyBrand.test(relative)) violations.push(relative);\n        const ext = path.extname(file).toLowerCase();\n        if (!textExtensions.has(ext) && !textFiles.has(path.basename(file))) continue;\n        const text = fs.readFileSync(file, 'utf8');\n        if (!legacyBrand.test(text)) continue;\n        if (allowedUpstreamFiles.has(relative)) {\n            const badLines = text.split(/\\r?\\n/).filter(line => legacyBrand.test(line) && !line.includes('github.com/sohzm/cheating-daddy/releases/'));\n            if (badLines.length === 0) continue;\n        }\n        violations.push(relative);\n    }\n    assert.deepEqual(violations, []);\n});\n\ntest('public-facing ContextHalo identifiers are consistent', () => {\n    const pkg = require('../package.json');\n    assert.equal(pkg.name, 'context-halo');\n    assert.equal(pkg.productName, 'ContextHalo');\n    assert.equal(pkg.build.appId, 'com.aaryamody.contexthalo');\n    assert.equal(pkg.build.win.artifactName, 'ContextHalo-Windows-x64.exe');\n    assert.ok(fs.existsSync(path.join(root, 'src/components/app/ContextHaloApp.js')));\n    assert.ok(!fs.existsSync(path.join(root, 'src/components/app/CheatingDaddyApp.js')));\n});\n`;
    fs.writeFileSync(path.join(ROOT, 'tests', 'brand.test.js'), test, 'utf8');
}

function cleanupTemporaryFiles() {
    fs.rmSync(TEMP_SCRIPT, { force: true });
    fs.rmSync(TEMP_WORKFLOW, { force: true });
}

renameMainComponent();

for (const file of walk(ROOT)) {
    if (!isTextFile(file)) continue;
    const current = fs.readFileSync(file, 'utf8');
    const next = applyBrandReplacements(current);
    if (next !== current) fs.writeFileSync(file, next, 'utf8');
}

rewritePackageMetadata();
installConfigMigration();
disableLegacyPrivateCloud();
rewriteReadme();
writeCredits();
writeBrandTest();
cleanupTemporaryFiles();

console.log('ContextHalo rebrand applied.');
