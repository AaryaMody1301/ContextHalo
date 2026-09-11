const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('classic renderer exposes contextHalo as a global binding for ES-module UI code', () => {
    const source = fs.readFileSync('src/utils/renderer.js', 'utf8');
    assert.match(source, /var contextHalo = \{/);
    assert.match(source, /window\.contextHalo = contextHalo;/);
    assert.doesNotMatch(source, /const contextHalo = \{/);
});
