const NORMAL_MINIMUM_SIZE = { width: 700, height: 320 };
const HUD_MINIMUM_SIZE = { width: 640, height: 320 };
const HUD_MAXIMUM_SIZE = { width: 960, height: 560 };
const HUD_WIDTH_RATIO = 0.58;
const HUD_HEIGHT_RATIO = 0.5;
const HUD_TOP_MARGIN = 24;

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function clampBoundsToWorkArea(bounds, workArea) {
    const width = clamp(bounds.width, NORMAL_MINIMUM_SIZE.width, workArea.width);
    const height = clamp(bounds.height, NORMAL_MINIMUM_SIZE.height, workArea.height);
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

function createWindowModeController(mainWindow, screen) {
    let hudActive = false;
    let normalBounds = mainWindow.getBounds();
    let normalWasMaximized = false;

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

        if (!hudActive) {
            normalWasMaximized = mainWindow.isMaximized();
            normalBounds = normalWasMaximized && typeof mainWindow.getNormalBounds === 'function'
                ? mainWindow.getNormalBounds() : mainWindow.getBounds();
            if (normalWasMaximized) mainWindow.unmaximize();
        }

        const display = getDisplayForBounds(screen, mainWindow.getBounds());
        mainWindow.setMinimumSize(HUD_MINIMUM_SIZE.width, HUD_MINIMUM_SIZE.height);
        mainWindow.setResizable(true);
        mainWindow.setContentProtection(true);
        setSkipTaskbar(mainWindow, true);
        setBackgroundMaterial(mainWindow, 'acrylic');
        mainWindow.setBounds(getHudBounds(display), false);
        hudActive = true;
        reassertHudMode();
    };

    const enterNormalMode = () => {
        if (mainWindow.isDestroyed()) return;

        mainWindow.setIgnoreMouseEvents(false);
        mainWindow.setMinimumSize(NORMAL_MINIMUM_SIZE.width, NORMAL_MINIMUM_SIZE.height);
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
    };

    const repositionHud = () => {
        if (!hudActive || mainWindow.isDestroyed()) return;
        const display = getDisplayForBounds(screen, mainWindow.getBounds());
        mainWindow.setBounds(getHudBounds(display), false);
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
        reassertHudMode();
    };

    mainWindow.setContentProtection(true);
    setBackgroundMaterial(mainWindow, 'mica');

    return {
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
