const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = file => fs.readFileSync(file, 'utf8');
test('sanitizer uses an allowlist and permits only HTTP(S) external links', () => {
    const source = read('src/utils/responseSanitizerRenderer.js');
    assert.match(source, /ALLOWED_TAGS/);
    assert.match(source, /DROP_WITH_CONTENT/);
    assert.match(source, /SCRIPT/);
    assert.match(source, /IFRAME/);
    assert.match(source, /name.startsWith\('on'\)/);
    assert.match(source, /\['https:', 'http:'\]/);
    assert.match(source, /element.removeAttribute\('href'\)/);
});
