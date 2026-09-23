const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

function thumbnailCropForDipRect(display, thumbnailSize, rect) {
    const bounds = display?.bounds;
    if (!bounds || !thumbnailSize?.width || !thumbnailSize?.height || bounds.width <= 0 || bounds.height <= 0) return null;
    const left = Math.max(0, Math.floor((rect.x - bounds.x) * thumbnailSize.width / bounds.width));
    const top = Math.max(0, Math.floor((rect.y - bounds.y) * thumbnailSize.height / bounds.height));
    const right = Math.min(thumbnailSize.width, Math.ceil((rect.x + rect.width - bounds.x) * thumbnailSize.width / bounds.width));
    const bottom = Math.min(thumbnailSize.height, Math.ceil((rect.y + rect.height - bounds.y) * thumbnailSize.height / bounds.height));
    if (right <= left || bottom <= top) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
}

function representativeRgb(image) {
    const size = image.getSize();
    const bitmap = image.toBitmap();
    if (!size.width || !size.height || bitmap.length < size.width * size.height * 4) return null;
    const values = [[], [], []];
    for (const yf of [0.25, 0.5, 0.75]) {
        for (const xf of [0.25, 0.5, 0.75]) {
            const x = Math.min(size.width - 1, Math.max(0, Math.round((size.width - 1) * xf)));
            const y = Math.min(size.height - 1, Math.max(0, Math.round((size.height - 1) * yf)));
            const offset = (y * size.width + x) * 4;
            values[0].push(bitmap[offset + 2]);
            values[1].push(bitmap[offset + 1]);
            values[2].push(bitmap[offset]);
        }
    }
    return values.map(channel => channel.sort((a, b) => a - b)[Math.floor(channel.length / 2)]);
}

function selectScreenSource(sources, display, displayCount) {
    const exact = sources.find(source => String(source.display_id) === String(display.id));
    if (exact) return { source: exact, selection: 'display-id' };
    if (displayCount === 1 && sources.length === 1 && !sources[0].display_id) {
        return { source: sources[0], selection: 'single-display' };
    }
    return null;
}

// Only the isolated --ci-smoke-test profile may temporarily disable capture
// protection. Production sessions never use this path or capture the desktop.
async function verifyWindowsCompositor(window, directory) {
    const { app, BrowserWindow, desktopCapturer, screen } = require('electron');
    if (process.platform !== 'win32' || !process.argv.includes('--ci-smoke-test')) throw new Error('Compositor verification requires the isolated Windows smoke profile');
    if (window.webContents.isDevToolsOpened()) throw new Error('Close DevTools before transparency acceptance');
    if (window.isResizable()) throw new Error('Transparent window unexpectedly enables native resizing');
    const evaluate = code => window.webContents.executeJavaScript(code, true);
    const originalBounds = window.getBounds();
    const display = screen.getDisplayMatching(originalBounds);
    const area = display.workArea;
    const originalAppearance = await evaluate(`({theme:contextHalo.theme.current,alpha:contextHalo.theme.currentAlpha})`);
    const backdrop = new BrowserWindow({ ...area, frame: false, show: false, resizable: false, focusable: false,
        skipTaskbar: true, backgroundColor: '#000000', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const evidence = { scope: 'Electron screen-source capture of the Windows desktop compositor with isolated fixture surfaces',
        packaged: app.isPackaged, platform: process.platform, electron: process.versions.electron,
        os: require('node:os').release(), display: { id: String(display.id), bounds: display.bounds, workArea: display.workArea }, samples: [] };
    try {
        await backdrop.loadURL('data:text/html,<html><body style="margin:0;background:transparent"></body></html>');
        backdrop.showInactive();
        window.show();
        try { window.moveAbove(backdrop.getMediaSourceId()); } catch { window.moveTop(); }
        await delay(100);
        window.setContentProtection(false);
        // Give SetWindowDisplayAffinity/DWM one composition interval before the
        // first supported screen-source capture.
        await delay(250);
        const fixture = await evaluate(`(()=>{const root=document.querySelector('context-halo-app').shadowRoot;
            const shell=root.querySelector('.app-shell');
            const style=document.createElement('style');style.id='compositor-test-style';
            style.textContent='.app-shell > * { visibility:hidden !important; }';root.append(style);
            const rect=shell.getBoundingClientRect();
            const inset=Math.max(12,Math.min(48,Math.floor(Math.min(rect.width,rect.height)/6)));
            const width=Math.max(8,Math.min(48,Math.floor(rect.width-inset*2)));
            const height=Math.max(8,Math.min(48,Math.floor(rect.height-inset*2)));
            return {capture:{x:Math.round(rect.left+inset),y:Math.round(rect.top+inset),width,height}};})()`);
        if (!fixture?.capture || fixture.capture.width <= 0 || fixture.capture.height <= 0) throw new Error('Compositor fixture geometry is unavailable');
        evidence.fixture = fixture;
        const displayCount = screen.getAllDisplays().length;
        for (const alpha of [0, 0.25, 0.5, 0.8, 1]) {
            await evaluate(`contextHalo.theme.apply('dark',${alpha})`);
            const sample = { alpha, captures: [] };
            evidence.samples.push(sample);
            for (const background of [0, 255]) {
                backdrop.setBackgroundColor(background ? '#ffffff' : '#000000');
                try { window.moveAbove(backdrop.getMediaSourceId()); } catch { window.moveTop(); }
                await delay(180);
                const bounds = window.getContentBounds();
                const capture = fixture.capture;
                const screenRect = { x: bounds.x + capture.x, y: bounds.y + capture.y, width: capture.width, height: capture.height };
                const sources = await desktopCapturer.getSources({
                    types: ['screen'],
                    thumbnailSize: { width: Math.max(1, Math.round(display.bounds.width)), height: Math.max(1, Math.round(display.bounds.height)) },
                    fetchWindowIcons: false,
                });
                const selected = selectScreenSource(sources, display, displayCount);
                if (!selected) throw new Error(`Desktop capture source for display ${display.id} is unavailable`);
                const thumbnail = selected.source.thumbnail;
                const thumbnailSize = thumbnail.getSize();
                if (!thumbnailSize.width || !thumbnailSize.height) throw new Error('Desktop capture produced no pixels');
                const cropRect = thumbnailCropForDipRect(display, thumbnailSize, screenRect);
                if (!cropRect) throw new Error('Desktop capture crop is outside the selected display');
                const image = thumbnail.crop(cropRect);
                const surface = representativeRgb(image);
                if (!surface) throw new Error('Desktop capture crop produced no pixels');
                const filename = path.join(directory, `compositor-${alpha}-${background}.png`);
                fs.writeFileSync(filename, image.toPNG());
                const expected = Math.round(16 * alpha + background * (1 - alpha));
                sample.captures.push({ background, surface, screenRect, thumbnail: { size: thumbnailSize, crop: cropRect,
                    sourceId: selected.source.id, displayId: selected.source.display_id, selection: selected.selection } });
                if (surface.some(value => Math.abs(value - expected) > 12)) {
                    throw new Error(`Desktop alpha mismatch at ${alpha}, backdrop ${background}: ${surface.join(',')}, expected ${expected}`);
                }
            }
        }
        evidence.success = true;
        return evidence;
    } catch (error) {
        evidence.success = false;
        evidence.error = error.message;
        throw error;
    } finally {
        window.setContentProtection(true);
        if (!backdrop.isDestroyed()) backdrop.destroy();
        await evaluate(`(()=>{const root=document.querySelector('context-halo-app').shadowRoot;root.getElementById('compositor-test-style')?.remove();contextHalo.theme.apply(${JSON.stringify(originalAppearance.theme)},${JSON.stringify(originalAppearance.alpha)});})()`).catch(() => {});
        fs.writeFileSync(path.join(directory, 'compositor.json'), JSON.stringify(evidence, null, 2));
    }
}

module.exports = { verifyWindowsCompositor, _test: { thumbnailCropForDipRect, representativeRgb, selectScreenSource } };
