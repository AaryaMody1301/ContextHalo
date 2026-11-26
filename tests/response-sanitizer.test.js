const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = file => fs.readFileSync(file, 'utf8');
test('sanitizer uses an allowlist and permits only credential-free HTTP(S) external links', () => {
    const source = read('src/utils/responseSanitizerRenderer.js');
    assert.match(source, /ALLOWED_TAGS/);
    assert.match(source, /DROP_WITH_CONTENT/);
    assert.match(source, /SCRIPT/);
    assert.match(source, /IFRAME/);
    assert.match(source, /name.startsWith\('on'\)/);
    assert.match(source, /\['https:', 'http:'\]/);
    assert.match(source, /!parsed\.username && !parsed\.password/);
    assert.match(source, /element.removeAttribute\('href'\)/);
});

test('assistant Markdown escapes raw provider HTML before the DOM sanitizer', () => {
    const view = read('src/components/views/AssistantView.js');
    assert.match(view, /renderer\.html = token => this\.escapeText\(token\.text\)/);
    assert.match(view, /sanitizeAssistantHtml\(marked\.parse\(text, \{ breaks: true, gfm: true, renderer \}\)\)/);
});
