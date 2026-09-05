import json
from pathlib import Path

changes = {}
def edit(name, old, new):
    text = changes.get(name, Path(name).read_text(encoding='utf-8'))
    assert text.count(old) == 1, (name, 'Expected one matching source section')
    changes[name] = text.replace(old, new)

def append(name, text):
    changes[name] = changes.get(name, Path(name).read_text(encoding='utf-8')) + text

edit('src/components/app/ContextHaloApp.js', '    async handleSendText(message) {\n        const epoch', '    async handleSendText(message) {\n        // A new question returns to the newest card, unlike background updates.\n        this.currentResponseIndex = this.responses.length - 1;\n        this.requestUpdate();\n        const epoch')
edit('src/components/app/ContextHaloApp.js', '        .sidebar-nav {\n            flex: 1;', '        .sidebar-nav {\n            flex: 1;\n            min-height: 0;\n            overflow-y: auto;')
edit('src/components/app/ContextHaloApp.js', '        .sidebar-footer {\n            padding:', '        .sidebar-footer {\n            flex-shrink: 0;\n            padding:')
edit('src/utils/window.js', '    const mainWindow = new BrowserWindow({\n        width: DEFAULT_MAIN_WINDOW_SIZE.width,\n        height: DEFAULT_MAIN_WINDOW_SIZE.height,', '    const workArea = screen.getPrimaryDisplay().workArea;\n    const mainWindow = new BrowserWindow({\n        width: Math.min(DEFAULT_MAIN_WINDOW_SIZE.width, workArea.width),\n        height: Math.min(DEFAULT_MAIN_WINDOW_SIZE.height, workArea.height),')
edit('src/utils/windowModeController.js', 'HUD_MINIMUM_SIZE.height, Math.min(HUD_MAXIMUM_SIZE.height, workArea.height)', 'Math.min(460, workArea.height), Math.min(HUD_MAXIMUM_SIZE.height, workArea.height)')
edit('src/utils/windowModeController.js', '    let normalBounds = mainWindow.getBounds();', '    let normalBounds = mainWindow.getBounds();\n    let normalWasMaximized = false;')
edit('src/utils/windowModeController.js', '            if (mainWindow.isMaximized()) mainWindow.unmaximize();\n            normalBounds = mainWindow.getBounds();', '            normalWasMaximized = mainWindow.isMaximized();\n            normalBounds = normalWasMaximized && typeof mainWindow.getNormalBounds === \'function\'\n                ? mainWindow.getNormalBounds() : mainWindow.getBounds();\n            if (normalWasMaximized) mainWindow.unmaximize();')
edit('src/utils/windowModeController.js', '            mainWindow.setBounds(clampBoundsToWorkArea(normalBounds, display.workArea), false);', '            mainWindow.setBounds(clampBoundsToWorkArea(normalBounds, display.workArea), false);\n            if (normalWasMaximized) mainWindow.maximize();')
edit('tests/windows-live-hud.test.js', '{ x: 387, y: 74, width: 792, height: 364 }', '{ x: 387, y: 74, width: 792, height: 460 }')
append('tests/windows-live-hud.test.js', '''

test('returning from HUD restores the maximized state and original normal bounds', () => {
    const { createWindowModeController } = require('../src/utils/windowModeController');
    const original = { x: 50, y: 60, width: 900, height: 650 };
    let bounds = { x: 0, y: 0, width: 1920, height: 1040 };
    let maximized = true;
    const window = {
        getBounds: () => bounds, getNormalBounds: () => original,
        isDestroyed: () => false, isMaximized: () => maximized,
        unmaximize() { maximized = false; bounds = { width: 700, height: 320, x: 0, y: 0 }; },
        maximize() { maximized = true; }, setBounds(value) { bounds = value; },
        setContentProtection() {}, setBackgroundMaterial() {}, setMinimumSize() {},
        setResizable() {}, setSkipTaskbar() {}, setAlwaysOnTop() {}, setIgnoreMouseEvents() {}, moveTop() {},
    };
    const display = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
    const controller = createWindowModeController(window, { getDisplayMatching: () => display });
    controller.enterHudMode();
    assert.equal(maximized, false);
    controller.enterNormalMode();
    assert.equal(maximized, true);
    assert.deepEqual(bounds, original);
});
''')
edit('scripts/renderer-behavior-smoke.js', "        await setDraft('First question'); button.click(); await settle(assistant);", "        app.addNewResponse('Earlier answer'); app.addNewResponse('Latest answer');\n        app.currentResponseIndex=0;\n        await setDraft('First question'); button.click(); await settle(assistant);\n        verify(app.currentResponseIndex===app.responses.length-1,'New typed question returns to the newest response');\n        await waitUntil(()=>root.querySelector('#responseContainer').clientHeight>=100);\n        verify(root.querySelector('#responseContainer').clientHeight>=100,'Default HUD reserves a usable answer area');")
edit('scripts/renderer-behavior-smoke.js', "    app.currentView='main';app.requestUpdate();await settle(app);", "    app.navigate('main');await settle(app);\n    verify(getComputedStyle(app.shadowRoot.querySelector('.sidebar-nav')).overflowY==='auto','Sidebar navigation remains scrollable in short windows');")
edit('src/index.js', '                    app.currentView = ${JSON.stringify(view)};\n                    app.requestUpdate(); await app.updateComplete;', '                    app.navigate(${JSON.stringify(view)});\n                    if (${JSON.stringify(view)} === \'assistant\') {\n                        app.responses = [\'## Session assistance ready\\\\n\\\\nTyped answers, live audio, and screen context stay separate.\\\\n\\\\nUse the composer below to ask a question.\'];\n                        app.currentResponseIndex = 0;\n                    }\n                    app.requestUpdate(); await app.updateComplete;')
for name, text in changes.items():
    Path(name).write_text(text, encoding='utf-8', newline='\n')
p = Path('package.json')
d = json.loads(p.read_text(encoding='utf-8'))
d['build']['files'] = ['**/*', '!qa-results/**', '!tests/**', '!docs/**', '!.github/**']
p.write_text(json.dumps(d, indent=4) + '\n', encoding='utf-8')
print('Applied visual acceptance fixes to', len(changes)+1, 'files')
