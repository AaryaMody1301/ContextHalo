const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    sanitizeSelection,
    normalizeRegion,
} = require('../src/utils/contextCaptureMain');
const {
    sanitizeSessionPack,
    formatSessionPack,
    appendSessionPack,
} = require('../src/utils/sessionPackMain');

function read(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('capture selections and regions are normalized before main-process use', () => {
    assert.deepEqual(sanitizeSelection({ kind: 'screen', displayId: '42', sourceId: 'screen:42:0', label: 'Display 2' }), {
        kind: 'screen',
        displayId: '42',
        sourceId: 'screen:42:0',
        label: 'Display 2',
    });
    assert.equal(sanitizeSelection({ kind: 'unsafe', sourceId: 'x' }).kind, 'active-display');

    const region = normalizeRegion({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 });
    assert.ok(Math.abs(region.width - 0.5) < 1e-10);
    assert.ok(Math.abs(region.height - 0.4) < 1e-10);
    assert.equal(normalizeRegion({ x: 1, y: 0, width: 0.5, height: 0.4 }), null);
    assert.equal(normalizeRegion({ x: -2, y: 0, width: 0.5, height: 0.4 }), null);
    assert.equal(normalizeRegion({ x: 0, y: 0, width: 0.001, height: 0.4 }), null);
});

test('session packs are bounded and idempotently appended to provider context', () => {
    const pack = sanitizeSessionPack({
        title: 'Roadmap meeting',
        goal: 'Decide the release order',
        notes: 'Preserve compatibility.',
        clipboardText: 'Selected requirement text',
    });
    assert.equal(pack.title, 'Roadmap meeting');
    assert.match(formatSessionPack(pack), /Decide the release order/);
    assert.match(formatSessionPack(pack), /Selected requirement text/);

    const prompt = appendSessionPack('Base instructions', pack);
    assert.match(prompt, /\[ContextHalo session pack\]/);
    assert.equal(appendSessionPack(prompt, pack), prompt);
});

test('desktop source selection stays in the trusted main process and region selector is capture protected', () => {
    const main = read('src/utils/contextCaptureMain.js');
    const preload = read('preload.js');
    const selectorPreload = read('src/utils/regionSelectorPreload.js');
    const selectorHtml = read('src/region-selector.html');

    assert.match(main, /types: \['screen', 'window'\]/);
    assert.match(main, /thumbnailSize: \{ width: 0, height: 0 \}/);
    assert.match(main, /setDisplayMediaRequestHandler/);
    assert.match(main, /useSystemPicker: false/);
    assert.match(main, /setContentProtection\(true\)/);
    assert.match(main, /sandbox: true/);
    assert.match(main, /source\.id !== ownSourceId/);
    assert.match(preload, /context-capture:list-sources/);
    assert.match(preload, /context-capture:select-region/);
    assert.match(preload, /context-capture:read-clipboard/);
    assert.match(selectorPreload, /region-selector-complete/);
    assert.match(selectorHtml, /Content-Security-Policy/);
});

test('context capture UI exposes session packs, multi-source context, inspector, region crop, and quick commands', () => {
    const renderer = read('src/utils/contextCaptureRenderer.js');
    const index = read('src/index.html');
    const mainIndex = read('src/index.js');

    assert.match(renderer, /Session context/);
    assert.match(renderer, /Refresh windows/);
    assert.match(renderer, /Use copied text/);
    assert.match(renderer, /Context source:/);
    assert.match(renderer, /phase3-context-inspector/);
    assert.match(renderer, /CanvasRenderingContext2D/);
    assert.match(renderer, /selectAndAnalyzeRegion/);
    assert.match(renderer, /\/say/);
    assert.match(renderer, /\/shorter/);
    assert.match(renderer, /\/recap/);
    assert.match(renderer, /\/actions/);
    assert.match(renderer, /\/decisions/);
    assert.match(renderer, /\/questions/);
    assert.match(renderer, /\/translate/);
    assert.match(index, /contextCaptureRenderer\.js/);
    assert.match(mainIndex, /installSessionPackMain\(\)/);
    assert.match(mainIndex, /setupContextCaptureMain\(mainWindow, ipcMain\)/);
});

test('session pack runtime injects context into Gemini, Groq, and local chat without replacing provider implementations', () => {
    const packMain = read('src/utils/sessionPackMain.js');
    assert.match(packMain, /api\.groq\.com/);
    assert.match(packMain, /127\.0\.0\.1/);
    assert.match(packMain, /live\.connect/);
    assert.match(packMain, /systemInstruction/);
    assert.match(packMain, /sessionPack/);
    assert.doesNotMatch(packMain, /previousSaveSession/);
    assert.match(read('src/storage.js'), /sanitizeSessionPack\(data.sessionPack\)/);
});
