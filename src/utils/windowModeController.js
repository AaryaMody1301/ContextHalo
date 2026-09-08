const NORMAL_MINIMUM_SIZE = { width: 700, height: 320 };
const HUD_MINIMUM_SIZE = { width: 640, height: 320 };
const HUD_MAXIMUM_SIZE = { width: 960, height: 560 };
const HUD_WIDTH_RATIO = 0.58;
const HUD_HEIGHT_RATIO = 0.5;
const HUD_TOP_MARGIN = 24;

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function validBounds(bounds) {
    return bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]))
        && bounds.width > 0 && bounds.height > 0;
}

function clampBoundsToWorkArea(bounds, workArea, minimum = NORMAL_MINIMUM_SIZE) {
    bounds = validBounds(bounds) ? bounds : workArea;
    const width = Math.round(clamp(bounds.width, minimum.width, workArea.width));
    const height = Math.round(clamp(bounds.height, minimum.height, workArea.height));
    const maxX = workArea.x + workArea.width - width;
    const maxY = workArea.y + workArea.height - height;

    return {
        x: clamp(bounds.x, workArea.x, maxX),
        y: clamp(bounds.y, workArea.y, maxY),
        width,
        height,
    };
}

function getHudBounds(display) {
    const workArea = display.workArea;
    const width = clamp(Math.round(workArea.width * HUD_WIDTH_RATIO), HUD_MINIMUM_SIZE.width, Math.min(HUD_MAXIMUM_SIZE.width, workArea.width));
    const height = clamp(Math.round(workArea.height * HUD_HEIGHT_RATIO), Math.min(520, workArea.height), Math.min(HUD_MAXIMUM_SIZE.height, workArea.height));
    const x = workArea.x + Math.round((workArea.width - width) / 2);
    const maxY = workArea.y + workArea.height - height;
    const y = Math.min(maxY, workArea.y + HUD_TOP_MARGIN);

    return { x, y, width, height };
}

function getDisplayForBounds(screen, bounds) {
    try {
        return screen.getDisplayMatching(bounds);
    } catch {
        return screen.getPrimaryDisplay();
    }
}

function setSkipTaskbar(mainWindow, value) {
    try {
        mainWindow.setSkipTaskbar(value);
    } catch (error) {
        console.warn(`Could not ${value ? 'hide' : 'show'} ContextHalo in the taskbar:`, error.message);
    }
}

function setBackgroundMaterial(mainWindow, material) {
    if (process.platform !== 'win32' || typeof mainWindow.setBackgroundMaterial !== 'function') return;
    try {
        mainWindow.setBackgroundMaterial(material);
    } catch (error) {
        console.warn(`Could not apply Windows ${material} material:`, error.message);
    }
}

function createWindowModeController(mainWindow, screen, options = {}) {
    let hudActive = false;
    let normalBounds = validBounds(options.bounds?.normal) ? options.bounds.normal : mainWindow.getBounds();
    let hudBounds = validBounds(options.bounds?.hud) ? options.bounds.hud : null;
    let normalWasMaximized = false;
    const rememberBounds = () => {
        if (mainWindow.isDestroyed()) return;
        if (hudActive) hudBounds = mainWindow.getBounds();
        else normalBounds = mainWindow.isMaximized() && mainWindow.getNormalBounds
            ? mainWindow.getNormalBounds() : mainWindow.getBounds();
        options.saveBounds?.({ normal: normalBounds, hud: hudBounds });
    };

    const reassertHudMode = () => {
        if (!hudActive || mainWindow.isDestroyed()) return;
        mainWindow.setContentProtection(true);
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        try {
            mainWindow.moveTop();
        } catch {}
    };

    const enterHudMode = () => {
        if (mainWindow.isDestroyed()) return;
        if (hudActive) { reassertHudMode(); return; }

        if (!hudActive) {
            normalWasMaximized = mainWindow.isMaximized();
            normalBounds = normalWasMaximized && typeof mainWindow.getNormalBounds === 'function'
                ? mainWindow.getNormalBounds() : mainWindow.getBounds();
            if (normalWasMaximized) mainWindow.unmaximize();
        }

        const display = getDisplayForBounds(screen, hudBounds || mainWindow.getBounds());
        mainWindow.setMinimumSize(Math.min(HUD_MINIMUM_SIZE.width, display.workArea.width), Math.min(HUD_MINIMUM_SIZE.height, display.workArea.height));
        mainWindow.setResizable(true);
        mainWindow.setContentProtection(true);
        setSkipTaskbar(mainWindow, true);
        // Acrylic/mica are compositor backdrops, not CSS alpha. Disable them
        // in the HUD so the saved background alpha exposes the real desktop.
        setBackgroundMaterial(mainWindow, 'none');
        hudActive = true;
        mainWindow.setBounds(hudBounds ? clampBoundsToWorkArea(hudBounds, display.workArea, HUD_MINIMUM_SIZE) : getHudBounds(display), false);
        rememberBounds();
        reassertHudMode();
    };

    const enterNormalMode = () => {
        if (mainWindow.isDestroyed()) return;

        if (hudActive) hudBounds = mainWindow.getBounds();
        mainWindow.setIgnoreMouseEvents(false);
        const normalDisplay = getDisplayForBounds(screen, normalBounds);
        mainWindow.setMinimumSize(Math.min(NORMAL_MINIMUM_SIZE.width, normalDisplay.workArea.width), Math.min(NORMAL_MINIMUM_SIZE.height, normalDisplay.workArea.height));
        mainWindow.setContentProtection(true);
        mainWindow.setAlwaysOnTop(false);
        setSkipTaskbar(mainWindow, false);
        setBackgroundMaterial(mainWindow, 'mica');

        if (hudActive && normalBounds) {
            const display = getDisplayForBounds(screen, normalBounds);
            mainWindow.setBounds(clampBoundsToWorkArea(normalBounds, display.workArea), false);
            if (normalWasMaximized) mainWindow.maximize();
        }

        hudActive = false;
        rememberBounds();
    };

    const repositionHud = () => {
        if (mainWindow.isDestroyed()) return;
        const display = getDisplayForBounds(screen, mainWindow.getBounds());
        const minimum = hudActive ? HUD_MINIMUM_SIZE : NORMAL_MINIMUM_SIZE;
        mainWindow.setMinimumSize(Math.min(minimum.width, display.workArea.width), Math.min(minimum.height, display.workArea.height));
        mainWindow.setBounds(clampBoundsToWorkArea(mainWindow.getBounds(), display.workArea, minimum), false);
        rememberBounds();
        reassertHudMode();
    };

    const moveBy = (deltaX, deltaY) => {
        if (mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
        const bounds = mainWindow.getBounds();
        const display = getDisplayForBounds(screen, bounds);
        const workArea = display.workArea;
        const maxX = workArea.x + workArea.width - bounds.width;
        const maxY = workArea.y + workArea.height - bounds.height;
        const x = clamp(bounds.x + deltaX, workArea.x, maxX);
        const y = clamp(bounds.y + deltaY, workArea.y, maxY);
        mainWindow.setPosition(x, y);
        rememberBounds();
        reassertHudMode();
    };

    if (validBounds(options.bounds?.normal)) {
        const display = getDisplayForBounds(screen, normalBounds);
        mainWindow.setBounds(clampBoundsToWorkArea(normalBounds, display.workArea), false);
    }
    mainWindow.setContentProtection(true);
    setBackgroundMaterial(mainWindow, 'mica');

    return {
        rememberBounds,
        enterHudMode,
        enterNormalMode,
        repositionHud,
        reassertHudMode,
        moveBy,
        isHudActive: () => hudActive,
    };
}

module.exports = {
    NORMAL_MINIMUM_SIZE,
    HUD_MINIMUM_SIZE,
    HUD_MAXIMUM_SIZE,
    clampBoundsToWorkArea,
    getHudBounds,
    createWindowModeController,
};
