const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');

test('final branch contains no one-shot migration workflow or duplicate UI/preload files', () => {
    for (const path of [
        '.github/workflows/apply-final-hardening.yml',
        '.github/workflows/apply-final-touchups.yml',
        '.github/workflows/apply-corrupt-cache-repair.yml',
        '.github/workflows/revert-redundant-cache-delete.yml',
        '.github/workflows/remove-unused-ws.yml',
    ]) assert.equal(fs.existsSync(path), false, `${path} must not ship`);
    assert.equal(fs.existsSync('src/components/app/AppHeader.js'), false);
    assert.equal(fs.existsSync('src/preload.js'), false);
    assert.doesNotMatch(read('src/components/index.js'), /AppHeader/);
});

test('credential editor has one explicit save owner and no stale Cloud copy', () => {
    const view = read('src/components/views/MainView.js');
    assert.doesNotMatch(view, /@change=\$\{event => \{[^\n]*_saveProviderKey/);
    assert.match(view, />Save key<\/button>/);
    assert.doesNotMatch(view, /Cloud UI intentionally disabled|backend cloud wiring/i);
});

test('Windows release workflow pins the current audited action releases by commit', () => {
    const workflow = read('.github/workflows/build-windows.yml');
    for (const sha of [
        '3d3c42e5aac5ba805825da76410c181273ba90b1', // actions/checkout v7.0.1
        '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', // actions/upload-artifact v7.0.1
        '820762786026740c76f36085b0efc47a31fe5020', // actions/setup-node v7.0.0
        '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c', // actions/download-artifact v8.0.1
        'efb35369e0ad2afab669f228072c1b0d510eae64', // softprops/action-gh-release v3.0.3
    ]) assert.match(workflow, new RegExp(sha));

    assert.doesNotMatch(workflow, /actions\/upload-artifact@v4/);
    assert.doesNotMatch(workflow, /actions\/download-artifact@v5/);
    assert.doesNotMatch(workflow, /softprops\/action-gh-release@v2/);
});

test('provider package and defaults match the audited 2026 contracts', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.dependencies['@google/genai'], '2.22.0');
    assert.equal(pkg.dependencies.ws, undefined, 'ws is supplied transitively by the Gemini SDK and is not an app dependency');
    assert.equal(pkg.devDependencies.electron, '^44.3.0');

    const storage = read('src/storage.js');
    assert.match(storage, /geminiLiveModel: 'gemini-3\.8-live'/);
    assert.match(storage, /geminiHttpModel: 'gemini-3\.8-flash'/);
    assert.match(storage, /groqModel: 'openai\/gpt-oss-120b'/);
    assert.match(storage, /groqImageModel: 'qwen\/qwen3\.6-27b'/);
    assert.match(storage, /groqTranscriptionModel: 'whisper-large-v3-turbo'/);
    assert.doesNotMatch(storage, /RETIRED_GEMINI_HTTP_MODELS[\s\S]{0,200}'gemini-2\.5-flash'/);
});

test('local model errors describe the supported projector fallback rather than BF16 only', () => {
    for (const path of ['src/utils/native-ai-runtime.js', 'src/utils/windowsLocalAiRuntime.js']) {
        const source = read(path);
        assert.doesNotMatch(source, /does not provide mmproj-BF16\.gguf/);
    }
});
