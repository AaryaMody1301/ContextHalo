const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = file => fs.readFileSync(file, 'utf8');

test('normal pages use one parent scroll owner and navigation resets to top', () => {
    const app = read('src/components/app/ContextHaloApp.js');
    const main = read('src/components/views/MainView.js');
    const shared = read('src/components/views/sharedPageStyles.js');
    assert.ok(app.includes('this.updateComplete.then(() => this._resetContentScroll())'));
    assert.ok(app.includes('content.scrollTop = 0'));
    assert.ok(main.includes('height: auto;'));
    assert.ok(main.includes('overflow: visible;'));
    assert.ok(shared.includes('.unified-page'));
    assert.ok(shared.includes('overflow: visible;'));
});

test('Settings links provider/model setup to the canonical Home editor', () => {
    const app = read('src/components/app/ContextHaloApp.js');
    const settings = read('src/components/views/CustomizeView.js');
    assert.ok(settings.includes('AI Provider & Models'));
    assert.ok(settings.includes('Open provider setup'));
    assert.ok(settings.includes('onOpenProviderSettings'));
    assert.ok(app.includes(".onOpenProviderSettings=${() => this.navigate('main')}"));
});

test('Gemini Live validates model access and exposes setup failures', () => {
    const gemini = read('src/utils/gemini.js');
    assert.ok(gemini.includes("listProviderModels('gemini', apiKey)"));
    assert.ok(gemini.includes('geminiSessionResumptionHandle = null'));
    assert.ok(gemini.includes('connectGeminiLiveWithGuard'));
    assert.ok(gemini.includes('Gemini Live closed during setup'));
    assert.ok(gemini.includes('lastGeminiInitializationError'));
    assert.ok(gemini.includes('preferredConfig'));
    assert.ok(gemini.includes('retrying without Search'));
    assert.ok(!gemini.includes('thinkingConfig: { thinkingLevel'));
});
