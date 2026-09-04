const fs = require('node:fs');

const regression = `const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(file, 'utf8');

test('session start surfaces initialization and capture failures on Home', () => {
    const app = read('src/components/app/ContextHaloApp.js');
    assert.ok(app.includes('session-initializing'));
    assert.ok(app.includes('.isInitializing='));
    assert.ok(app.includes('this.isInitializing'));
    assert.ok(app.includes('.startError='));
    assert.ok(app.includes('this.startError'));
    assert.ok(app.includes('Starting Windows screen and audio capture...'));
    assert.ok(app.includes('catch (error)'));
});

test('Windows capture uses loopback-safe constraints and cleans microphone resources', () => {
    const renderer = read('src/utils/renderer.js');
    assert.ok(renderer.includes('audio: needsLoopback'));
    assert.ok(renderer.includes('Windows system-audio loopback was not available'));
    assert.ok(renderer.includes('micMediaStream.getTracks().forEach(track => track.stop())'));
    assert.ok(renderer.includes("return result?.success ? result.data : '';"));
});

test('Gemini Live reads preferences in main and normalizes the configured model', () => {
    const gemini = read('src/utils/gemini.js');
    assert.ok(gemini.includes('getPreferences().googleSearchEnabled === true'));
    assert.ok(gemini.includes("const liveModel = String(getConfig().geminiLiveModel || 'gemini-3.1-flash-live-preview')"));
    assert.ok(gemini.includes('model: liveModel'));
    assert.ok(gemini.includes('...(geminiSessionResumptionHandle'));
    assert.ok(gemini.includes('sessionResumption: { handle: geminiSessionResumptionHandle }'));
});

test('model selectors are readable and capability restricted', () => {
    const main = read('src/components/views/MainView.js');
    const shared = read('src/components/views/sharedPageStyles.js');
    const registry = read('src/utils/dynamicModelRegistryRenderer.js');
    assert.ok(main.includes('select option,'));
    assert.ok(main.includes('background: #191919'));
    assert.ok(shared.includes('select.control option'));
    assert.ok(registry.includes('allowAdvanced: false'));
    assert.ok(registry.includes('all: catalog?.live || []'));
    assert.ok(registry.includes('result.data.recommended?.live'));
});

test('Settings exposes session, AI behavior and emergency erase controls', () => {
    const settings = read('src/components/views/CustomizeView.js');
    assert.ok(settings.includes('renderSessionSection()'));
    assert.ok(settings.includes('renderAISection()'));
    assert.ok(settings.includes('Enable Google Search grounding'));
    assert.ok(settings.includes('Custom Instructions'));
    assert.ok(settings.includes('emergencyErase'));
    assert.ok(settings.includes('Compact sidebar'));
});
`;

fs.writeFileSync('tests/runtime-session-ui-settings.test.js', regression, 'utf8');

const storagePath = 'tests/storage.test.js';
let storage = fs.readFileSync(storagePath, 'utf8').replace(/\r\n/g, '\n');
const before = "    assert.match(gemini, /model: getConfig\\(\\)\\.geminiLiveModel/);";
const after = [
    "    assert.match(gemini, /const liveModel = String\\(getConfig\\(\\)\\.geminiLiveModel/);",
    "    assert.match(gemini, /model: liveModel/);",
].join('\n');
if (!storage.includes(before)) throw new Error('Could not find the legacy Gemini Live model assertion');
storage = storage.replace(before, after);
fs.writeFileSync(storagePath, storage, 'utf8');

console.log('Runtime UI regression assertions updated for normalized model and literal source checks.');
