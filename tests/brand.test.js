const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const skipDirs = new Set(['.git', 'node_modules', 'dist', 'out', '.webpack']);
const textExtensions = new Set(['.js', '.json', '.md', '.yml', '.yaml', '.html', '.css', '.plist', '.txt', '.example']);
const textFiles = new Set(['.gitignore', '.editorconfig', '.prettierrc', '.prettierignore']);
const legacyBrand = /cheating(?:[ _-]?daddy)/i;
const allowedUpstreamFiles = new Set(['src/utils/native-ai-runtime.js']);
const upstreamReleaseMarker = ['github.com/sohzm/', 'cheating', '-', 'daddy', '/releases/'].join('');

function walk(dir, files = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, files);
        else files.push(full);
    }
    return files;
}

test('ContextHalo branding replaces the legacy product identity', () => {
    const violations = [];
    for (const file of walk(root)) {
        const relative = path.relative(root, file).replaceAll('\\', '/');
        if (legacyBrand.test(relative)) violations.push(relative);
        const ext = path.extname(file).toLowerCase();
        if (!textExtensions.has(ext) && !textFiles.has(path.basename(file))) continue;
        const text = fs.readFileSync(file, 'utf8');
        if (!legacyBrand.test(text)) continue;
        if (allowedUpstreamFiles.has(relative)) {
            const badLines = text.split(/\r?\n/).filter(line => legacyBrand.test(line) && !line.includes(upstreamReleaseMarker));
            if (badLines.length === 0) continue;
        }
        violations.push(relative);
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
    assert.ok(!fs.existsSync(path.join(root, 'src/components/app/CheatingDaddyApp.js')));
});
