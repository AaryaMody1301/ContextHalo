const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

// Only the isolated --ci-smoke-test profile may temporarily disable capture
// protection. Production sessions never use this path or capture the desktop.
async function verifyWindowsCompositor(window, directory) {
    const { app, BrowserWindow, screen, nativeImage } = require('electron');
    if (process.platform !== 'win32' || !process.argv.includes('--ci-smoke-test')) throw new Error('Compositor verification requires the isolated Windows smoke profile');
    if (window.webContents.isDevToolsOpened()) throw new Error('Close DevTools before transparency acceptance');
    if (window.isResizable()) throw new Error('Transparent window unexpectedly enables native resizing');
    const evaluate = code => window.webContents.executeJavaScript(code, true);
    const originalBounds = window.getBounds();
    const area = screen.getDisplayMatching(originalBounds).workArea;
    const originalAppearance = await evaluate(`({theme:contextHalo.theme.current,alpha:contextHalo.theme.currentAlpha})`);
    const backdrop = new BrowserWindow({ ...area, frame: false, show: false, resizable: false, focusable: false,
        skipTaskbar: true, backgroundColor: '#000000', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const evidence = { scope: 'Windows desktop compositor with isolated fixture surfaces', packaged: app.isPackaged,
        platform: process.platform, electron: process.versions.electron, os: require('node:os').release(), samples: [] };
    // Graphics.CopyFromScreen on Windows PowerShell/.NET Framework rejects
    // SRCCOPY | CAPTUREBLT as an enum value. Call GDI directly so layered
    // transparent windows remain part of the real desktop capture.
    const powershell = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CaptureNative {
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("gdi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool BitBlt(IntPtr destination, int x, int y, int width, int height,
        IntPtr source, int sourceX, int sourceY, uint operation);
}
'@
[CaptureNative]::SetProcessDPIAware() | Out-Null
$r = $env:CONTEXTHALO_TEST_RECT.Split(',') | ForEach-Object { [int]$_ }
$desktopDc = [CaptureNative]::GetDC([IntPtr]::Zero)
if ($desktopDc -eq [IntPtr]::Zero) { throw 'Could not acquire the desktop device context' }
try {
    # The composed desktop is opaque RGB; do not invent a bitmap alpha channel.
    $bitmap = New-Object System.Drawing.Bitmap($r[2], $r[3], [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $destinationDc = $graphics.GetHdc()
            try {
                # DWORD raster operation: SRCCOPY | CAPTUREBLT, including layered windows.
                $operation = [uint32](0x00CC0020 -bor 0x40000000)
                $copied = [CaptureNative]::BitBlt($destinationDc, 0, 0, $r[2], $r[3], $desktopDc, $r[0], $r[1], $operation)
                if (!$copied) { throw [System.ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
            } finally { $graphics.ReleaseHdc($destinationDc) }
        } finally { $graphics.Dispose() }
        # GDI+ cannot save while the Graphics HDC is held.
        $bitmap.Save($env:CONTEXTHALO_TEST_PNG, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $bitmap.Dispose() }
} finally { [CaptureNative]::ReleaseDC([IntPtr]::Zero, $desktopDc) | Out-Null }
`;
    try {
        await backdrop.loadURL('data:text/html,<html><body style="margin:0;background:transparent"></body></html>');
        backdrop.setAlwaysOnTop(true, 'screen-saver');
        backdrop.showInactive();
        window.show(); window.moveTop();
        await delay(100);
        // Fixture-only content is visible. No account requests or real user data
        // are loaded by the smoke profile. Put the opaque probe inside the real
        // app shell so it shares the window's compositor surface, and return its
        // renderer-relative geometry instead of assuming a hard-coded crop.
        window.setContentProtection(false);
        const fixture = await evaluate(`(()=>{const root=document.querySelector('context-halo-app').shadowRoot;
            const shell=root.querySelector('.app-shell');
            const style=document.createElement('style');style.id='compositor-test-style';
            style.textContent='.app-shell > :not(#compositor-test-marker) { visibility:hidden !important; } #compositor-test-marker { visibility:visible !important; }';root.append(style);
            const marker=document.createElement('div');marker.id='compositor-test-marker';
            marker.style.cssText='position:fixed;left:164px;top:100px;width:24px;height:24px;background:rgb(224,224,224);z-index:2147483647;pointer-events:none';shell.append(marker);
            const rect=marker.getBoundingClientRect();
            const capture={x:Math.round(rect.left-64),y:Math.round(rect.top),width:Math.round(rect.width+64),height:Math.round(rect.height)};
            return {capture,surface:{x:capture.x+24,y:Math.round(rect.top+rect.height/2)},foreground:{x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)}};})()`);
        if (!fixture?.capture || fixture.capture.width <= 0 || fixture.capture.height <= 0) throw new Error('Compositor fixture geometry is unavailable');
        evidence.fixture = fixture;
        const sampleFraction = point => ({
            x: (point.x - fixture.capture.x) / fixture.capture.width,
            y: (point.y - fixture.capture.y) / fixture.capture.height,
        });
        const surfaceSample = sampleFraction(fixture.surface);
        const foregroundSample = sampleFraction(fixture.foreground);
        for (const alpha of [0, 0.25, 0.5, 0.8, 1]) {
            await evaluate(`contextHalo.theme.apply('dark',${alpha})`);
            const sample = { alpha, captures: [] };
            evidence.samples.push(sample);
            for (const background of [0, 255]) {
                backdrop.setBackgroundColor(background ? '#ffffff' : '#000000');
                await delay(160);
                const bounds = window.getContentBounds();
                const capture = fixture.capture;
                const physical = screen.dipToScreenRect(window, { x: bounds.x + capture.x, y: bounds.y + capture.y, width: capture.width, height: capture.height });
                const filename = path.join(directory, `compositor-${alpha}-${background}.png`);
                await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', powershell], {
                    windowsHide: true, timeout: 10000,
                    env: { ...process.env, CONTEXTHALO_TEST_RECT: [physical.x, physical.y, physical.width, physical.height].join(','), CONTEXTHALO_TEST_PNG: filename },
                });
                const image = nativeImage.createFromPath(filename);
                const size = image.getSize(), bitmap = image.toBitmap();
                if (!size.width || !size.height) throw new Error('Desktop capture produced no pixels');
                const pixel = point => {
                    const x = Math.min(size.width - 1, Math.max(0, Math.round((size.width - 1) * point.x)));
                    const y = Math.min(size.height - 1, Math.max(0, Math.round((size.height - 1) * point.y)));
                    const offset = (y * size.width + x) * 4;
                    return [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]];
                };
                const surface = pixel(surfaceSample), foreground = pixel(foregroundSample);
                const expected = Math.round(16 * alpha + background * (1 - alpha));
                sample.captures.push({ background, surface, foreground, physical });
                if (surface.some(value => Math.abs(value - expected) > 12)) throw new Error(`Desktop alpha mismatch at ${alpha}, backdrop ${background}: ${surface.join(',')}, expected ${expected}`);
                if (foreground.some(value => Math.abs(value - 224) > 8)) throw new Error(`Opaque foreground mismatch at ${alpha}, backdrop ${background}: ${foreground.join(',')}`);
            }
        }
        evidence.success = true;
        return evidence;
    } catch (error) {
        evidence.success = false; evidence.error = error.message;
        throw error;
    } finally {
        window.setContentProtection(true);
        if (!backdrop.isDestroyed()) backdrop.destroy();
        await evaluate(`(()=>{const root=document.querySelector('context-halo-app').shadowRoot;root.getElementById('compositor-test-style')?.remove();root.getElementById('compositor-test-marker')?.remove();contextHalo.theme.apply(${JSON.stringify(originalAppearance.theme)},${JSON.stringify(originalAppearance.alpha)});})()`).catch(() => {});
        fs.writeFileSync(path.join(directory, 'compositor.json'), JSON.stringify(evidence, null, 2));
    }
}
module.exports = { verifyWindowsCompositor };
