const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');

test('provider credentials are write-only from the sandboxed renderer', () => {
    const main = read('src/index.js');
    const renderer = read('src/utils/renderer.js');
    const preload = read('preload.js');
    const view = read('src/components/views/MainView.js');

    for (const channel of ['storage:get-api-key', 'storage:get-groq-api-key', 'storage:get-credentials', 'storage:set-credentials']) {
        assert.equal(main.includes(channel), false);
        assert.equal(preload.includes(channel), false);
        assert.equal(renderer.includes(channel), false);
    }
    assert.match(main, /storage:get-credential-status/);
    assert.match(renderer, /getCredentialStatus/);
    assert.match(view, /_geminiKeyPresent/);
    assert.match(view, /_groqKeyPresent/);
});

test('retired cloud provider cannot be invoked through renderer IPC', () => {
    assert.equal(fs.existsSync('src/utils/cloud.js'), false);
    for (const path of ['preload.js', 'src/utils/renderer.js', 'src/utils/gemini.js']) {
        assert.equal(read(path).includes('initialize-cloud'), false);
    }
});
