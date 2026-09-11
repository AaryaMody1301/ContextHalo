const fs = require('node:fs');

const smokeFile = 'scripts/renderer-behavior-smoke.js';
let smoke = fs.readFileSync(smokeFile, 'utf8');

smoke = smoke.replace(/\n\s*const stage = value => \{ window\.__contextHaloSmokeStage = value; console\.log\('\[Smoke stage\] ' \+ value\); \};/, '');
smoke = smoke.replace(/^\s*stage\('[^']+'\);\r?\n/gm, '');
smoke = smoke.replace(/^\s*if \(String\(message\.message \|\| ''\)\.startsWith\('\[Smoke stage\]'\)\) console\.log\(String\(message\.message\)\);\r?\n/gm, '');
smoke = smoke.replace(/^\s*console\.log\('\[Smoke stage\] shell-[^\n]*\);\r?\n/gm, '');
smoke = smoke.replace(/^\s*console\.log\('\[Windows smoke\] shell ready ' \+ JSON\.stringify\(result\)\);\r?\n/gm, '');
smoke = smoke.replace("const timeout = setTimeout(() => finish(false, 'renderer did not become ready within diagnostic 20 seconds'), 20000);",
    "const timeout = setTimeout(() => finish(false, 'renderer did not become ready within 120 seconds'), 120000);");

const detachedStartMarker = "                    const settingsView = document.createElement('customize-view');";
const detachedStart = smoke.indexOf(detachedStartMarker);
if (detachedStart < 0) throw new Error('Detached Settings probe start not found.');
const detachedLineStart = smoke.lastIndexOf('\n', detachedStart) + 1;
const detachedEndMarker = '                    settingsView.remove();';
const detachedEndStart = smoke.indexOf(detachedEndMarker, detachedStart);
if (detachedEndStart < 0) throw new Error('Detached Settings probe end not found.');
const detachedEndNewline = smoke.indexOf('\n', detachedEndStart + detachedEndMarker.length);
const detachedEnd = detachedEndNewline >= 0 ? detachedEndNewline + 1 : detachedEndStart + detachedEndMarker.length;
smoke = smoke.slice(0, detachedLineStart) + smoke.slice(detachedEnd);

const mountedOld = `                    const settingsInApp = app.shadowRoot?.querySelector('customize-view');
                    for (let attempt = 0; attempt < 100 && !settingsReady; attempt++) {
                        await settingsInApp?.updateComplete;
                        const settingsText = settingsInApp?.shadowRoot?.textContent || '';
                        settingsReady = settingsText.includes('Session Defaults') &&
                            settingsText.includes('AI Provider & Models') &&
                            settingsText.includes('AI Behavior') &&
                            settingsText.includes('Keyboard Shortcuts');
                        if (!settingsReady) await new Promise(resolve => setTimeout(resolve, 20));
                    }`;
const mountedNew = `                    const settingsInApp = app.shadowRoot?.querySelector('customize-view');
                    let settingsReady = false;
                    for (let attempt = 0; attempt < 100 && !settingsReady; attempt++) {
                        const settingsText = settingsInApp?.shadowRoot?.textContent || '';
                        settingsReady = settingsText.includes('Session Defaults') &&
                            settingsText.includes('AI Provider & Models') &&
                            settingsText.includes('AI Behavior') &&
                            settingsText.includes('Keyboard Shortcuts');
                        if (!settingsReady) await new Promise(resolve => setTimeout(resolve, 20));
                    }`;
if (!smoke.includes(mountedOld)) throw new Error('Mounted Settings readiness loop not found.');
smoke = smoke.replace(mountedOld, mountedNew);
smoke = smoke.replace(/\n\s*settingsView\.remove\(\);/, '');
fs.writeFileSync(smokeFile, smoke);

const assistantFile = 'src/components/views/AssistantView.js';
let assistant = fs.readFileSync(assistantFile, 'utf8');
const timerLine = "        const timer = setTimeout(() => controller.abort(), 65000);\n";
const clearLine = "            clearTimeout(timer);\n";
if (!assistant.includes(timerLine) || !assistant.includes(clearLine)) throw new Error('Expected AssistantView screen timer was not found.');
assistant = assistant.replace(timerLine, '').replace(clearLine, '');
fs.writeFileSync(assistantFile, assistant);

const testFile = 'tests/gemini-screen-reliability.test.js';
let tests = fs.readFileSync(testFile, 'utf8');
if (!tests.includes("const fs = require('node:fs');")) {
    tests = tests.replace("const assert = require('node:assert/strict');\n", "const assert = require('node:assert/strict');\nconst fs = require('node:fs');\n");
}
const testBlock = `

test('Assistant screen UI leaves the renderer watchdog as the only UI deadline owner', () => {
    const source = fs.readFileSync('src/components/views/AssistantView.js', 'utf8');
    const start = source.indexOf('    async handleScreenAnswer(options = {}) {');
    const end = source.indexOf('    handleResponseLink(event) {', start);
    assert.ok(start >= 0 && end > start);
    const handler = source.slice(start, end);
    assert.doesNotMatch(handler, /setTimeout\\s*\\(/);
    assert.doesNotMatch(handler, /clearTimeout\\s*\\(/);
    assert.match(handler, /new AbortController\\(\\)/);
});`;
if (!tests.includes('Assistant screen UI leaves the renderer watchdog')) tests += testBlock + '\n';
fs.writeFileSync(testFile, tests);
