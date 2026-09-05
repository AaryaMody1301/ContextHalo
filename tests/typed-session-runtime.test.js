const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(path, 'utf8');
test('obsolete typed audio gate and missing component export stay removed', () => {
    assert.equal(JSON.parse(read('package.json')).main, 'src/index.js');
    assert.equal(fs.existsSync('src/bootstrap.js'), false);
    assert.doesNotMatch(read('src/utils/runtimeFinalRenderer.js'), /typedPromptAudioGate|patchTypedPromptDelivery/);
    assert.doesNotMatch(read('src/components/index.js'), /AdvancedView/);
});
test('composer uses a native multiline input, explicit send, and returned provider outcomes', () => {
    const source = read('src/components/views/AssistantView.js');
    assert.match(source, /<textarea/);
    assert.match(source, /send-btn/);
    assert.match(source, /isComposing/);
    assert.match(source, /await this.onSendText/);
    assert.match(source, /'alert' : 'status'/);
});
test('provider discovery cannot silently overwrite saved models', () => {
    const source = read('src/utils/dynamicModelRegistryRenderer.js');
    assert.doesNotMatch(source, /await this._saveGeminiLiveModel\(result.data.recommended/);
    assert.match(source, /not in this catalog/);
    assert.doesNotMatch(read('src/utils/runtimeFinalRenderer.js'), /patchProviderModelSelectionGuard/);
});
