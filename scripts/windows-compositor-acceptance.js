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

function intersects(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function backdropControlRect(display, windowBounds, size = 40) {
    const area = display?.workArea;
    if (!area || !windowBounds) return null;
    const width = Math.min(size, Math.max(0, area.width - 16));
    const height = Math.min(size, Math.max(0, area.height - 16));
    if (width < 8 || height < 8) return null;
    const margin = 8;
    const x1 = area.x + margin;
    const x2 = area.x + area.width - width - margin;
    const y1 = area.y + margin;
    const y2 = area.y + area.height - height - margin;
    const xm = Math.round(area.x + (area.width - width) / 2);
    const ym = Math.round(area.y + (area.height - height) / 2);
    const candidates = [
        { x: x1, y: y1, width, height }, { x: x2, y: y1, width, height },
        { x: x1, y: y2, width, height }, { x: x2, y: y2, width, height },
        { x: xm, y: y1, width, height }, { x: xm, y: y2, width, height },
        { x: x1, y: ym, width, height }, { x: x2, y: ym, width, height },
    ];
    return candidates.find(candidate => !intersects(candidate, windowBounds)) || null;
}

// Only the isolated --ci-smoke-test profile may temporarily disable capture
// protection. Production sessions never use this path or capture the desktop.
async function verifyWindowsCompositor(window, directory) {
    const { app, BrowserWindow, desktopCapturer, screen } = require('electron');
    if (process.platform !== 'win32' || !process.argv.includes('--ci-smoke-test')) throw new Error('Compositor verification requires the isolated Windows smoke profile');
    if (window.webContents.isDevToolsOpened()) throw new Error('Close DevTools before transparency acceptance');
    if (window.webContents.debugger?.isAttached()) throw new Error('Detach the debugger before transparency acceptance');
    if (window.isResizable()) throw new Error('Transparent window unexpectedly enables native resizing');
    if (window.isContentProtected?.()) throw new Error('Transparency acceptance must start before Windows capture protection is applied');
    const evaluate = code => window.webContents.executeJavaScript(code, true);
    const originalBounds = window.getBounds();
    const display = screen.getDisplayMatching(originalBounds);
    const area = display.workArea;
    const controlRect = backdropControlRect(display, originalBounds);
    if (!controlRect) throw new Error('Compositor acceptance needs visible backdrop space outside the ContextHalo window');
    const originalAppearance = await evaluate(`({theme:contextHalo.theme.current,alpha:contextHalo.theme.currentAlpha})`);
    const canvasState = await evaluate(`({colorScheme:document.documentElement.style.colorScheme || '',
        htmlBackground:getComputedStyle(document.documentElement).backgroundColor,
        bodyBackground:getComputedStyle(document.body).backgroundColor})`);
    if (canvasState.colorScheme) throw new Error(`Root color-scheme must stay unset for a transparent canvas; found ${canvasState.colorScheme}`);
    const backdrop = new BrowserWindow({ ...area, frame: false, show: false, resizable: false, focusable: false,
        skipTaskbar: true, backgroundColor: '#000000', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const evidence = { scope: 'Electron screen-source capture of the Windows desktop compositor with isolated fixture surfaces',
        packaged: app.isPackaged, platform: process.platform, electron: process.versions.electron,
        os: require('node:os').release(), display: { id: String(display.id), bounds: display.bounds, workArea: display.workArea },
        canvasState, controlRect, samples: [] };
    const setBackdrop = async value => {
        const color = `rgb(${value},${value},${value})`;
        await backdrop.webContents.executeJavaScript(`new Promise(resolve=>{document.documentElement.style.background=${JSON.stringify(color)};document.body.style.background=${JSON.stringify(color)};requestAnimationFrame(()=>requestAnimationFrame(resolve));})`, true);
    };
    try {
        const html = '<!doctype html><html style="margin:0;width:100%;height:100%;background:#000"><body style="margin:0;width:100%;height:100%;background:#000"></body></html>';
        await backdrop.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        backdrop.showInactive();
        window.show();
        try { window.moveAbove(backdrop.getMediaSourceId()); } catch { window.moveTop(); }
        await delay(100);
        // The smoke window has never had SetWindowDisplayAffinity applied.
        // Give DWM one composition interval before the first screen-source capture.
        await delay(250);
        const fixture = await evaluate(`(()=>{const root=document.querySelector('context-halo-app').shadowRoot;
            const shell=root.querySelector('.app-shell');
            const style=document.createElement('style');style.id='compositor-test-style';
            style.textContent='.app-shell > * { visibility:hidden !important; } .live-bar button { visibility:visible !important; }';root.append(style);
            const rect=shell.getBoundingClientRect();
            const inset=Math.max(12,Math.min(48,Math.floor(Math.min(rect.width,rect.height)/6)));
            const width=Math.max(8,Math.min(48,Math.floor(rect.width-inset*2)));
            const height=Math.max(8,Math.min(48,Math.floor(rect.height-inset*2)));
            const button=root.querySelector('.live-bar button');
            if(!button)throw new Error('A real HUD foreground control is required');
            const foreground=button.getBoundingClientRect();
            return {capture:{x:Math.round(rect.left+inset),y:Math.round(rect.top+inset),width,height},
                foreground:{x:Math.round(foreground.left+foreground.width/2-2),y:Math.round(foreground.top+3),width:4,height:2}};})()`);
        if (!fixture?.capture || fixture.capture.width <= 0 || fixture.capture.height <= 0) throw new Error('Compositor fixture geometry is unavailable');
        evidence.fixture = fixture;
        const displayCount = screen.getAllDisplays().length;
        for (const alpha of [0, 0.25, 0.5, 0.8, 1]) {
            await evaluate(`contextHalo.theme.apply('dark',${alpha})`);
            const rendererState = await evaluate(`(()=>{const root=document.querySelector('context-halo-app').shadowRoot;
                const shell=root.querySelector('.app-shell'),button=root.querySelector('.live-bar button');
                return {surface:getComputedStyle(shell).backgroundColor,foreground:getComputedStyle(button).backgroundColor,
                    html:getComputedStyle(document.documentElement).backgroundColor,body:getComputedStyle(document.body).backgroundColor};})()`);
            const foregroundExpected = rendererState.foreground.match(/[\d.]+/g)?.map(Number);
            if (!foregroundExpected || foregroundExpected.length < 3 || foregroundExpected.length > 3 && foregroundExpected[3] !== 1) {
                throw new Error('HUD control must have an opaque foreground background');
            }
            const sample = { alpha, rendererState, captures: [] };
            evidence.samples.push(sample);
            for (const background of [0, 255]) {
                await setBackdrop(background);
                try { window.moveAbove(backdrop.getMediaSourceId()); } catch { window.moveTop(); }
                await delay(180);
                const bounds = window.getContentBounds();
                const capture = fixture.capture;
                const screenRect = { x: bounds.x + capture.x, y: bounds.y + capture.y, width: capture.width, height: capture.height };
                const foregroundRect = { ...fixture.foreground, x: bounds.x + fixture.foreground.x, y: bounds.y + fixture.foreground.y };
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
                const controlCropRect = thumbnailCropForDipRect(display, thumbnailSize, controlRect);
                const surfaceCropRect = thumbnailCropForDipRect(display, thumbnailSize, screenRect);
                const foregroundCropRect = thumbnailCropForDipRect(display, thumbnailSize, foregroundRect);
                if (!controlCropRect || !surfaceCropRect || !foregroundCropRect) throw new Error('Desktop capture crop is outside the selected display');
                const controlImage = thumbnail.crop(controlCropRect);
                const surfaceImage = thumbnail.crop(surfaceCropRect);
                const foregroundImage = thumbnail.crop(foregroundCropRect);
                const control = representativeRgb(controlImage);
                const surface = representativeRgb(surfaceImage);
                const foreground = representativeRgb(foregroundImage);
                if (!control || !surface || !foreground) throw new Error('Desktop capture crop produced no pixels');
                fs.writeFileSync(path.join(directory, `compositor-control-${alpha}-${background}.png`), controlImage.toPNG());
                fs.writeFileSync(path.join(directory, `compositor-${alpha}-${background}.png`), surfaceImage.toPNG());
                fs.writeFileSync(path.join(directory, `compositor-foreground-${alpha}-${background}.png`), foregroundImage.toPNG());
                const expected = Math.round(16 * alpha + background * (1 - alpha));
                sample.captures.push({ background, control, surface, foreground, screenRect, thumbnail: { size: thumbnailSize,
                    controlCrop: controlCropRect, surfaceCrop: surfaceCropRect, foregroundCrop: foregroundCropRect, sourceId: selected.source.id,
                    displayId: selected.source.display_id, selection: selected.selection } });
                if (control.some(value => Math.abs(value - background) > 8)) {
                    throw new Error(`Backdrop control mismatch for ${background}: ${control.join(',')}`);
                }
                if (surface.some(value => Math.abs(value - expected) > 12)) {
                    throw new Error(`Desktop alpha mismatch at ${alpha}, backdrop ${background}: ${surface.join(',')}, expected ${expected}`);
                }
                if (foreground.some((value, index) => Math.abs(value - foregroundExpected[index]) > 12)) {
                    throw new Error(`Desktop foreground faded at ${alpha}, backdrop ${background}: ${foreground.join(',')}`);
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
        if (!backdrop.isDestroyed()) backdrop.destroy();
        await evaluate(`(()=>{const root=document.querySelector('context-halo-app').shadowRoot;root.getElementById('compositor-test-style')?.remove();contextHalo.theme.apply(${JSON.stringify(originalAppearance.theme)},${JSON.stringify(originalAppearance.alpha)});})()`).catch(() => {});
        fs.writeFileSync(path.join(directory, 'compositor.json'), JSON.stringify(evidence, null, 2));
    }
}

module.exports = { verifyWindowsCompositor, _test: { thumbnailCropForDipRect, representativeRgb, selectScreenSource, backdropControlRect } };
