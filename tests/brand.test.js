const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const skipDirs = new Set(['.git', 'node_modules', 'dist', 'out', '.webpack']);
const textExtensions = new Set(['.js', '.json', '.md', '.yml', '.yaml', '.html', '.css', '.plist', '.txt', '.example']);
const textFiles = new Set(['.gitignore', '.editorconfig', '.prettierrc', '.prettierignore']);
const legacyBrand = /cheating(?:[ _-]?daddy)/i;
const legacyRepositoryNames = [
    Buffer.from([85, 112, 100, 97, 116, 101, 100, 95, 80, 117, 98, 108, 105, 99, 95, 82, 101, 112, 111]).toString('utf8'),
    Buffer.from([76, 105, 118, 101, 95, 72, 101, 108, 112, 101, 114]).toString('utf8'),
];
const oldComponentFile = ['Cheating', 'Daddy', 'App.js'].join('');

function walk(dir, files = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, files);
        else files.push(full);
    }
    return files;
}

function containsLegacyIdentity(value) {
    if (legacyBrand.test(value)) return true;
    const lower = value.toLowerCase();
    return legacyRepositoryNames.some(name => lower.includes(name.toLowerCase()));
}

test('ContextHalo branding replaces the legacy product and repository identities', () => {
    const violations = [];
    for (const file of walk(root)) {
        const relative = path.relative(root, file).replaceAll('\\', '/');
        if (containsLegacyIdentity(relative)) violations.push(relative);
        const ext = path.extname(file).toLowerCase();
        if (!textExtensions.has(ext) && !textFiles.has(path.basename(file))) continue;
        const text = fs.readFileSync(file, 'utf8');
        if (containsLegacyIdentity(text)) violations.push(relative);
    }
    assert.deepEqual(violations, []);
});

test('public-facing ContextHalo identifiers are consistent', () => {
    const pkg = require('../package.json');
    assert.equal(pkg.name, 'context-halo');
    assert.equal(pkg.productName, 'ContextHalo');
    assert.equal(pkg.build.appId, 'com.aaryamody.contexthalo');
    assert.equal(pkg.build.win.artifactName, 'ContextHalo-Windows-x64.exe');
    assert.ok(fs.existsSync(path.join(root, 'src/components/app/ContextHaloApp.js')));
    assert.ok(!fs.existsSync(path.join(root, 'src/components/app', oldComponentFile)));
});
