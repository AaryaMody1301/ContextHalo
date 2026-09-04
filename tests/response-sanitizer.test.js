const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relativePath => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('assistant response sanitizer is loaded and wraps Markdown output before innerHTML rendering', () => {
    const indexHtml = read('src/index.html');
    const sanitizer = read('src/utils/responseSanitizerRenderer.js');
    const assistant = read('src/components/views/AssistantView.js');

    assert.match(indexHtml, /responseSanitizerRenderer\.js/);
    assert.ok(
        indexHtml.indexOf('responseSanitizerRenderer.js') < indexHtml.indexOf('runtimeFinalRenderer.js'),
        'response sanitizer should load before final UI hardening'
    );
    assert.match(assistant, /container\.innerHTML = renderedResponse/);
    assert.match(sanitizer, /proto\.renderMarkdown = function/);
    assert.match(sanitizer, /sanitizeAssistantHtml\(originalRenderMarkdown\.call\(this, content\)\)/);
});

test('assistant response sanitizer drops active content and unsafe URL or event attributes', () => {
    const sanitizer = read('src/utils/responseSanitizerRenderer.js');

    assert.match(sanitizer, /SCRIPT/);
    assert.match(sanitizer, /IFRAME/);
    assert.match(sanitizer, /OBJECT/);
    assert.match(sanitizer, /FORM/);
    assert.match(sanitizer, /name\.startsWith\('on'\)/);
    assert.match(sanitizer, /name === 'style'/);
    assert.match(sanitizer, /\['https:', 'http:', 'mailto:'\]/);
    assert.match(sanitizer, /element\.removeAttribute\('href'\)/);
});
