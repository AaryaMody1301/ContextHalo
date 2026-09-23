const NORMAL_MINIMUM_SIZE = { width: 700, height: 320 };
const HUD_MINIMUM_SIZE = { width: 640, height: 320 };
const HUD_MAXIMUM_SIZE = { width: 960, height: 560 };
const RESIZE_EDGES = new Set(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);

function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
function validBounds(bounds) {
    return bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key])) && bounds.width > 0 && bounds.height > 0;
}
function clampBoundsToWorkArea(bounds, workArea, minimum = NORMAL_MINIMUM_SIZE) {
    bounds = validBounds(bounds) ? bounds : workArea;
    const width = Math.round(clamp(bounds.width, minimum.width, workArea.width));
    const height = Math.round(clamp(bounds.height, minimum.height, workArea.height));
    return { x: Math.round(clamp(bounds.x, workArea.x, workArea.x + workArea.width - width)),
        y: Math.round(clamp(bounds.y, workArea.y, workArea.y + workArea.height - height)), width, height };
}
function getHudBounds(display) {
    const area = display.workArea;
    const width = clamp(Math.round(area.width * 0.58), HUD_MINIMUM_SIZE.width, Math.min(HUD_MAXIMUM_SIZE.width, area.width));
    const height = clamp(Math.round(area.height * 0.5), Math.min(520, area.height), Math.min(HUD_MAXIMUM_SIZE.height, area.height));
    return { x: area.x + Math.round((area.width - width) / 2), y: Math.min(area.y + area.height - height, area.y + 24), width, height };
}
function getDisplayForBounds(screen, bounds) {
    try { return screen.getDisplayMatching(bounds); } catch { return screen.getPrimaryDisplay(); }
}
function setSkipTaskbar(window, value) {
    try { window.setSkipTaskbar(value); } catch { console.warn('Could not update ContextHalo taskbar visibility'); }
}
function disableBackdrop(window) {
    if (process.platform !== 'win32' || typeof window.setBackgroundMaterial !== 'function') return;
    try { window.setBackgroundMaterial('none'); } catch { console.warn('Could not disable Windows backdrop material'); }
}

// Preserve the opposite edge and clamp against the originating monitor. Cursor
// and bounds are both Electron DIPs; renderer screenX/Y are deliberately unused.
function resizeBounds(bounds, edge, dx, dy, area, minimum = NORMAL_MINIMUM_SIZE) {
    if (!RESIZE_EDGES.has(edge) || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    const start = clampBoundsToWorkArea(bounds, area, minimum);
    let left = start.x, top = start.y, right = left + start.width, bottom = top + start.height;
    const minWidth = Math.min(minimum.width, area.width), minHeight = Math.min(minimum.height, area.height);
    if (edge.includes('w')) left = clamp(left + dx, area.x, right - minWidth);
    if (edge.includes('e')) right = clamp(right + dx, left + minWidth, area.x + area.width);
    if (edge.includes('n')) top = clamp(top + dy, area.y, bottom - minHeight);
    if (edge.includes('s')) bottom = clamp(bottom + dy, top + minHeight, area.y + area.height);
    left = Math.round(left); top = Math.round(top); right = Math.round(right); bottom = Math.round(bottom);
    return { x: left, y: top, width: right - left, height: bottom - top };
}

function createWindowModeController(mainWindow, screen, options = {}) {
    let hudActive = false;
    let normalBounds = validBounds(options.bounds?.normal) ? options.bounds.normal : mainWindow.getBounds();
    let hudBounds = validBounds(options.bounds?.hud) ? options.bounds.hud : null;
    let normalExpanded = options.bounds?.normalExpanded === true;
    let gesture = null;
    const cancelResize = () => { gesture = null; };
    const rememberBounds = () => {
        if (mainWindow.isDestroyed()) return;
        if (hudActive) hudBounds = mainWindow.getBounds();
        else if (!normalExpanded) normalBounds = mainWindow.getBounds();
        options.saveBounds?.({ normal: normalBounds, hud: hudBounds, normalExpanded });
    };
    const reassertHudMode = () => {
        if (!hudActive || mainWindow.isDestroyed()) return;
        mainWindow.setContentProtection(true);
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        try { mainWindow.moveTop(); } catch {}
    };
    const applyBounds = (bounds, minimum) => {
        const area = getDisplayForBounds(screen, bounds).workArea;
        mainWindow.setMinimumSize(Math.min(minimum.width, area.width), Math.min(minimum.height, area.height));
        mainWindow.setBounds(clampBoundsToWorkArea(bounds, area, minimum), false);
    };
    const enterHudMode = () => {
        if (mainWindow.isDestroyed()) return;
        if (hudActive) { reassertHudMode(); return; }
        cancelResize();
        if (!normalExpanded) normalBounds = mainWindow.getBounds();
        const display = getDisplayForBounds(screen, hudBounds || mainWindow.getBounds());
        hudActive = true;
        applyBounds(hudBounds || getHudBounds(display), HUD_MINIMUM_SIZE);
        setSkipTaskbar(mainWindow, true);
        disableBackdrop(mainWindow);
        rememberBounds(); reassertHudMode();
    };
    const enterNormalMode = () => {
        if (mainWindow.isDestroyed()) return;
        cancelResize();
        const wasHud = hudActive;
        if (wasHud) hudBounds = mainWindow.getBounds();
        hudActive = false;
        mainWindow.setIgnoreMouseEvents(false);
        mainWindow.setContentProtection(true);
        mainWindow.setAlwaysOnTop(false);
        setSkipTaskbar(mainWindow, false);
        disableBackdrop(mainWindow);
        if (wasHud) applyBounds(normalExpanded ? getDisplayForBounds(screen, normalBounds).workArea : normalBounds, NORMAL_MINIMUM_SIZE);
        rememberBounds();
    };
    // Transparent windows cannot use Windows native maximize. Fit/restore the
    // work area without changing WS_THICKFRAME or recreating the live renderer.
    const toggleExpanded = () => {
        if (mainWindow.isDestroyed() || hudActive) return { success: false, error: 'Return to the workspace to expand it' };
        cancelResize();
        if (!normalExpanded) normalBounds = mainWindow.getBounds();
        normalExpanded = !normalExpanded;
        applyBounds(normalExpanded ? getDisplayForBounds(screen, normalBounds).workArea : normalBounds, NORMAL_MINIMUM_SIZE);
        rememberBounds();
        return { success: true, maximized: normalExpanded };
    };
    const repositionHud = () => {
        if (mainWindow.isDestroyed()) return;
        cancelResize();
        const bounds = mainWindow.getBounds();
        applyBounds(!hudActive && normalExpanded ? getDisplayForBounds(screen, bounds).workArea : bounds,
            hudActive ? HUD_MINIMUM_SIZE : NORMAL_MINIMUM_SIZE);
        rememberBounds(); reassertHudMode();
    };
    const moveBy = (deltaX, deltaY) => {
        if (mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
        cancelResize();
        const bounds = mainWindow.getBounds();
        const area = getDisplayForBounds(screen, bounds).workArea;
        mainWindow.setPosition(clamp(bounds.x + deltaX, area.x, area.x + area.width - bounds.width),
            clamp(bounds.y + deltaY, area.y, area.y + area.height - bounds.height));
        rememberBounds(); reassertHudMode();
    };
    const resize = request => {
        if (!request || typeof request !== 'object' || Array.isArray(request) || mainWindow.isDestroyed()) return { success: false };
        if (request.phase === 'end') { cancelResize(); return { success: true }; }
        if (!mainWindow.isVisible() || mainWindow.isFocused?.() === false) { cancelResize(); return { success: false }; }
        const minimum = hudActive ? HUD_MINIMUM_SIZE : NORMAL_MINIMUM_SIZE;
        if (request.phase === 'begin') {
            if (!RESIZE_EDGES.has(request.edge)) return { success: false };
            const bounds = mainWindow.getBounds();
            gesture = { bounds, edge: request.edge, cursor: screen.getCursorScreenPoint(), area: getDisplayForBounds(screen, bounds).workArea, updated: Date.now() };
            return { success: true };
        }
        let bounds;
        if (request.phase === 'keyboard') {
            const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[request.key];
            if (!delta) return { success: false };
            cancelResize();
            const step = request.large === true ? 40 : 10;
            const current = mainWindow.getBounds();
            bounds = resizeBounds(current, 'se', delta[0] * step, delta[1] * step, getDisplayForBounds(screen, current).workArea, minimum);
        } else if (request.phase === 'update') {
            if (!gesture || Date.now() - gesture.updated > 60000) { cancelResize(); return { success: false }; }
            const cursor = screen.getCursorScreenPoint();
            bounds = resizeBounds(gesture.bounds, gesture.edge, cursor.x - gesture.cursor.x, cursor.y - gesture.cursor.y, gesture.area, minimum);
            gesture.updated = Date.now();
        } else return { success: false };
        if (!bounds) return { success: false };
        if (!hudActive) normalExpanded = false;
        mainWindow.setBounds(bounds, false);
        rememberBounds();
        return { success: true };
    };

    if (normalExpanded || validBounds(options.bounds?.normal)) {
        applyBounds(normalExpanded ? getDisplayForBounds(screen, normalBounds).workArea : normalBounds, NORMAL_MINIMUM_SIZE);
    }
    mainWindow.setContentProtection(true);
    disableBackdrop(mainWindow);
    return { rememberBounds, enterHudMode, enterNormalMode, repositionHud, reassertHudMode, moveBy,
        resize, cancelResize, toggleExpanded, isHudActive: () => hudActive };
}
module.exports = { NORMAL_MINIMUM_SIZE, HUD_MINIMUM_SIZE, HUD_MAXIMUM_SIZE, clampBoundsToWorkArea, getHudBounds, resizeBounds, createWindowModeController };
