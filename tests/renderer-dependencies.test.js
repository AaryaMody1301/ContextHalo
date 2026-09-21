const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(file, 'utf8');

function gitBlobSha(file) {
    const bytes = fs.readFileSync(file);
    const header = Buffer.from(`blob ${bytes.length}\0`);
    return crypto.createHash('sha1').update(header).update(bytes).digest('hex');
}

function runtimeJavaScriptFiles() {
    const root = path.join(process.cwd(), 'src');
    return fs.readdirSync(root, { recursive: true })
        .filter(file => file.endsWith('.js'))
        .map(file => path.join(root, file))
        .filter(file => fs.statSync(file).isFile());
}

test('Lit 3.3.3 uses the exact official lit/dist core bundle and all renderer imports moved', () => {
    const manifest = JSON.parse(read('docs/PHASE_5_RENDERER_DEPENDENCIES.json'));
    const lit = manifest.rendererDependencies.find(item => item.component === 'Lit');
    assert.equal(lit.version, '3.3.3');
    assert.equal(lit.sourceRepository, 'https://github.com/lit/dist');
    assert.equal(lit.sourceRef, 'v3.3.3');
    assert.equal(gitBlobSha(lit.path), lit.sourceBlobSha);
    assert.match(read(lit.path), /SPDX-License-Identifier: BSD-3-Clause/);

    for (const file of runtimeJavaScriptFiles()) {
        const source = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(source, /lit-core-2\.7\.4\.min\.js/, file);
        if (source.includes('LitElement') || /\bhtml\b/.test(source) || /\bcss\b/.test(source)) {
            if (source.includes('assets/lit-core-')) {
                assert.match(source, /lit-core-3\.3\.3\.min\.js/, file);
            }
        }
    }
});

test('Marked 18.0.13 is lockfile-managed and its packaged browser build is the only markdown parser script', async () => {
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    assert.equal(pkg.dependencies.marked, '18.0.13');
    assert.equal(lock.packages[''].dependencies.marked, '18.0.13');
    assert.deepEqual(lock.packages['node_modules/marked'], {
        version: '18.0.13',
        resolved: 'https://registry.npmjs.org/marked/-/marked-18.0.13.tgz',
        integrity: 'sha512-xTxVzZsBFwunP6HDmtBkabUQEYArnP7/rMDGmPj9SlrKlQ4i8MdYVow+nJL0eOqwpUqhzBoTBRADGN6uYwPyOw==',
        license: 'MIT',
        bin: { marked: 'bin/marked.js' },
        engines: { node: '>= 20' },
    });

    const installed = JSON.parse(read('node_modules/marked/package.json'));
    assert.equal(installed.version, '18.0.13');
    assert.equal(fs.existsSync('node_modules/marked/lib/marked.umd.js'), true);

    const html = read('src/index.html');
    assert.match(html, /\.\.\/node_modules\/marked\/lib\/marked\.umd\.js/);
    assert.doesNotMatch(html, /assets\/marked-|highlight/i);

    const { marked } = await import('marked');
    const parsed = marked.parse('| A | B |\n| - | - |\n| 1 | 2 |\n\nline one\nline two', { gfm: true, breaks: true });
    assert.match(parsed, /<table>/);
    assert.match(parsed, /line one<br>\nline two/);
});

test('Marked output remains explicitly untrusted and flows through the renderer allowlist sanitizer', async () => {
    const { marked } = await import('marked');
    const raw = marked.parse('<script>globalThis.pwned = true</script>\n\n[bad](javascript:alert(1))');
    assert.match(raw, /<script>/i, 'Marked intentionally does not sanitize HTML');

    const assistant = read('src/components/views/AssistantView.js');
    const sanitizer = read('src/utils/responseSanitizerRenderer.js');
    assert.match(assistant, /sanitizeAssistantHtml\(window\.marked\s*\?\s*window\.marked\.parse/);
    assert.match(sanitizer, /DROP_WITH_CONTENT[\s\S]*'SCRIPT'/);
    assert.match(sanitizer, /\['https:', 'http:'\]\.includes\(parsed\.protocol\)/);
    assert.match(sanitizer, /element\.setAttribute\('rel', 'noopener noreferrer'\)/);
});

test('unused highlight.js assets and the superseded vendored Marked/Lit files are explicitly retired', () => {
    const manifest = JSON.parse(read('docs/PHASE_5_RENDERER_DEPENDENCIES.json'));
    const expected = [
        'src/assets/lit-core-2.7.4.min.js',
        'src/assets/marked-4.3.0.min.js',
        'src/assets/highlight-11.9.0.min.js',
        'src/assets/highlight-vscode-dark.min.css',
    ];
    assert.deepEqual(manifest.retiredBaselinePaths, expected);
    for (const file of expected) assert.equal(fs.existsSync(file), false, file);

    const index = read('src/index.html');
    assert.doesNotMatch(index, /highlight(?:\.js|-11|-vscode)|hljs/i);
    for (const file of runtimeJavaScriptFiles()) {
        assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\bhljs\s*\./, file);
    }
});
