const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');

test('portable package uses an explicit runtime allowlist', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.deepEqual(pkg.build.files, [
        'src/**/*',
        'preload.js',
        'scripts/renderer-behavior-smoke.js',
        'LICENSE',
        'CREDITS.md',
        'THIRD_PARTY_NOTICES.md',
    ]);
    for (const forbidden of ['**/*', 'tests/**', 'docs/**', '.github/**', 'scripts/check-source.js', 'scripts/repository-maintenance.js']) {
        assert.equal(pkg.build.files.includes(forbidden), false, forbidden + ' must not be part of the runtime allowlist');
    }
});

test('Phase 1 baseline inventory is complete and all baseline paths still exist', () => {
    const inventory = JSON.parse(read('docs/PHASE_1_FILE_INVENTORY.json'));
    assert.equal(inventory.schemaVersion, 1);
    assert.equal(inventory.auditBaseline, '8b7b28e312d33c45ee9e3ca5909804ebb9e3b1ad');
    assert.equal(inventory.fileCount, 146);
    assert.equal(inventory.files.length, 146);
    assert.equal(new Set(inventory.files.map(item => item.path)).size, 146);
    for (const item of inventory.files) {
        assert.equal(typeof item.ownerClass, 'string');
        assert.ok(item.ownerClass.length > 0);
        assert.equal(fs.existsSync(item.path), true, item.path + ' disappeared without a Phase 1 deletion decision');
    }
});

test('machine-readable npm provenance matches the production lockfile', () => {
    const lock = JSON.parse(read('package-lock.json'));
    const provenance = JSON.parse(read('docs/THIRD_PARTY_PROVENANCE.json'));
    const expected = Object.entries(lock.packages || {})
        .filter(([path, pkg]) => path.startsWith('node_modules/') && pkg && pkg.dev !== true)
        .map(([path, pkg]) => ({
            package: path.replace(/^node_modules\//, ''),
            version: pkg.version || null,
            license: pkg.license || null,
            resolved: pkg.resolved || null,
            integrity: pkg.integrity || null,
            optional: pkg.optional === true,
        }))
        .sort((a, b) => a.package.localeCompare(b.package));

    assert.deepEqual(provenance.productionNpm, expected);
    assert.ok(provenance.productionNpm.some(item => item.package === '@google/genai'));
});

test('vendored and native provenance records point to owned artifacts', () => {
    const provenance = JSON.parse(read('docs/THIRD_PARTY_PROVENANCE.json'));
    const notices = read('THIRD_PARTY_NOTICES.md');
    const nativeRuntime = read('src/utils/native-ai-runtime.js');

    for (const item of provenance.vendoredRenderer) {
        assert.equal(fs.existsSync(item.path), true, item.path);
        assert.ok(item.version);
        assert.ok(item.license);
        assert.match(item.upstream, /^https:\/\/github\.com\//);
    }

    for (const item of provenance.nativeRuntime) {
        assert.match(item.sha256, /^[a-f0-9]{64}$/);
        assert.match(item.source, /^https:\/\/github\.com\//);
    }

    for (const item of provenance.whisperModels) {
        assert.match(item.sha256, /^[a-f0-9]{64}$/);
        assert.match(item.source, /^https:\/\/huggingface\.co\//);
        assert.match(nativeRuntime, new RegExp(`sha256: '${item.sha256}'`));
        assert.ok(nativeRuntime.includes(item.source), item.source + ' must match the runtime download source');
    }

    assert.match(notices, /GPL-3\.0/);
    assert.match(notices, /Lit 2\.7\.4/);
    assert.match(notices, /Marked 4\.3\.0/);
    assert.match(notices, /highlight\.js 11\.9\.0/);
    assert.match(notices, /b10964/);
    assert.match(notices, /mutable `main`/);
});
