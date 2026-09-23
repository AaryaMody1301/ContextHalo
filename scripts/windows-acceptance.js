// Native keyboard input and Chromium accessibility trees, not synthetic click-only
// acceptance. This runs against both the source app and the exact packaged EXE.
async function extendedWindowsAcceptance(window, directory) {
    const fs = require('node:fs');
    const path = require('node:path');
    const { screen, globalShortcut } = require('electron');
    const windowApi = require('../src/utils/window');
    const storage = require('../src/storage');
    const keyboard = [], accessibility = [];
    const evaluate = code => window.webContents.executeJavaScript(code, true);
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const verify = (value, label) => { if (!value) throw new Error(label); keyboard.push(label); };
    const key = async (keyCode, modifiers = []) => {
        window.webContents.sendInputEvent({ type:'keyDown', keyCode, modifiers });
        if (keyCode === 'Return' || keyCode === 'Space') window.webContents.sendInputEvent({ type:'char', keyCode:keyCode === 'Return' ? String.fromCharCode(13) : ' ', modifiers });
        window.webContents.sendInputEvent({ type:'keyUp', keyCode, modifiers });
        await delay(60);
    };
    const capture = async name => { await delay(100); fs.writeFileSync(path.join(directory, name+'.png'), (await window.webContents.capturePage()).toPNG()); };
    const navigate = async page => {
        await evaluate(`(async()=>{const app=document.querySelector('context-halo-app');app.navigate(${JSON.stringify(page)});await app.updateComplete;})()`);
        await delay(150);
    };
    window.show(); window.focus();
    await navigate('customize');
    const before = storage.getKeybinds();
    await evaluate(`document.querySelector('context-halo-app').shadowRoot.querySelector('customize-view').shadowRoot.getElementById('shortcut-toggleVisibility').focus()`);
    await key('Tab');
    verify(await evaluate(`document.querySelector('context-halo-app').shadowRoot.querySelector('customize-view').shadowRoot.activeElement?.id==='shortcut-toggleClickThrough'`), 'Native Tab navigates without capturing a shortcut');
    await key('Tab', ['shift']);
    verify(await evaluate(`document.querySelector('context-halo-app').shadowRoot.querySelector('customize-view').shadowRoot.activeElement?.id==='shortcut-toggleVisibility'`), 'Native Shift+Tab returns to the prior shortcut field');
    await key('Escape');
    verify(JSON.stringify(storage.getKeybinds()) === JSON.stringify(before), 'Native navigation and Escape leave persisted bindings unchanged');
    verify(await evaluate(`document.querySelector('context-halo-app').shadowRoot.querySelector('customize-view').shortcutStatus.toLowerCase().includes('cancel')`), 'Shortcut cancellation is announced without blurring');
    const traversed = [];
    for (let step=0; step<48; step++) {
        await key('Tab');
        traversed.push(await evaluate(`(()=>{let node=document.activeElement;while(node?.shadowRoot?.activeElement)node=node.shadowRoot.activeElement;return node?.id || node?.textContent.trim().slice(0,80) || node?.getAttribute('aria-label');})()`));
    }
    verify(traversed.includes('shortcut-emergencyErase'), 'Keyboard traversal reaches the final shortcut action');
    verify(traversed.some(text => /Reset shortcuts to defaults/.test(text)), 'Keyboard traversal reaches shortcut reset');
    verify(JSON.stringify(storage.getKeybinds()) === JSON.stringify(before), 'Traversing the whole Settings page never rewrites bindings');

    // Reserve a real native chord outside the application-owned bindings, then
    // attempt to save it through the actual Settings -> preload -> main path.
    const occupied = 'Ctrl+Alt+F24';
    verify(globalShortcut.register(occupied, () => {}), 'Controlled native registration-conflict fixture installed');
    const oldState = windowApi.getShortcutState();
    try {
        const failed = await evaluate(`(async()=>{const view=document.querySelector('context-halo-app').shadowRoot.querySelector('customize-view');return await view.saveKeybinds({...view.keybinds,toggleVisibility:${JSON.stringify(occupied)}});})()`);
        verify(failed === false, 'Settings reports an actual globalShortcut.register conflict');
        verify(JSON.stringify(storage.getKeybinds()) === JSON.stringify(before), 'A failed native binding is not persisted');
        verify(windowApi.getShortcutState().registered.toggleVisibility === oldState.registered.toggleVisibility, 'Failed registration restores the prior working native binding');
        verify(globalShortcut.isRegistered(occupied), 'Unrelated native shortcuts remain registered');
        await capture('settings-registration-conflict');
    } finally { globalShortcut.unregister(occupied); }
    await navigate('main'); await navigate('customize');
    verify(await evaluate(`document.querySelector('context-halo-app').shadowRoot.querySelector('customize-view').keybinds.toggleVisibility===${JSON.stringify(oldState.data.toggleVisibility)}`), 'Settings reload displays the previous saved working binding');

    // Accessibility snapshots exclude values (especially password field values).
    window.webContents.debugger.attach('1.3');
    try {
        await window.webContents.debugger.sendCommand('Accessibility.enable');
        for (const page of ['main','customize','ai-customize','history','help','feedback','onboarding']) {
            await navigate(page);
            const { nodes } = await window.webContents.debugger.sendCommand('Accessibility.getFullAXTree');
            const controls = nodes.filter(node => !node.ignored && ['button','textbox','combobox','slider','checkbox','dialog'].includes(node.role?.value))
                .map(node => ({ role:node.role.value, name:node.name?.value || '' }));
            verify(controls.every(control => Boolean(control.name.trim())), `${page}: accessibility tree exposes names for all interactive controls`);
            accessibility.push({ page, controls });
        }
        await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] });
        verify(await evaluate(`matchMedia('(prefers-reduced-motion:reduce)').matches && document.querySelector('context-halo-app').shadowRoot.querySelector('onboarding-view').shadowRoot.querySelectorAll('canvas').length===0`), 'Reduced-motion onboarding has no animated canvas or animation loop');
        await capture('onboarding-reduced-motion');
        await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features:[] });
        await navigate('main');
        for (const tab of ['knowledge','practice','review']) {
            await evaluate(`document.querySelector('context-halo-app').shadowRoot.querySelector('#phase4-${tab}-nav').focus()`);
            await key('Return'); await delay(150);
            verify(await evaluate(`document.querySelector('context-halo-app').shadowRoot.querySelector('.phase4-overlay').open`), `${tab}: native Enter opens the workspace`);
            for (let n=0;n<12;n++) {
                await key('Tab', n%3===0 ? ['shift'] : []);
                verify(await evaluate(`Boolean(document.querySelector('context-halo-app').shadowRoot.activeElement?.closest('.phase4-overlay'))`), `${tab}: native Tab and Shift+Tab stay in the workspace`);
            }
            const { nodes } = await window.webContents.debugger.sendCommand('Accessibility.getFullAXTree');
            const controls = nodes.filter(node => !node.ignored && ['button','textbox','combobox','slider','checkbox','dialog'].includes(node.role?.value)).map(node=>({role:node.role.value,name:node.name?.value||''}));
            verify(controls.every(control=>control.name.trim()), `${tab}: accessibility tree names every workspace control`);
            accessibility.push({page:tab,controls}); await capture(`workspace-${tab}`);
            await key('Escape');
            verify(await evaluate(`(()=>{const root=document.querySelector('context-halo-app').shadowRoot;return !root.querySelector('.phase4-overlay').open && root.activeElement?.id==='phase4-${tab}-nav';})()`), `${tab}: Escape closes and restores the opener`);
        }
    } finally { window.webContents.debugger.detach(); }

    await navigate('main');
    await evaluate(`(async()=>{const view=document.querySelector('context-halo-app').shadowRoot.querySelector('main-view');view._mode='local';view._setupOpen=true;await view.updateComplete;view.shadowRoot.querySelector('.mode-link[aria-label]')?.focus();})()`);
    // The help opener is a native button; Enter, Tab and Escape exercise the
    // browser's actual modal behavior and opener focus restoration.
    await evaluate(`(()=>{const view=document.querySelector('context-halo-app').shadowRoot.querySelector('main-view');[...view.shadowRoot.querySelectorAll('button')].find(button=>button.textContent.trim()==='Local AI setup help').focus();})()`);
    await key('Return');
    verify(await evaluate(`document.querySelector('context-halo-app').shadowRoot.querySelector('main-view').shadowRoot.querySelector('.help-dialog').open`), 'Native Enter opens Local AI help as a modal');
    for (let n=0;n<4;n++) { await key('Tab', n%2 ? ['shift'] : []); verify(await evaluate(`(()=>{const root=document.querySelector('context-halo-app').shadowRoot.querySelector('main-view').shadowRoot;return Boolean(root.activeElement?.closest('dialog'));})()`), 'Local help keeps native keyboard focus inside the modal'); }
    await key('Escape');
    verify(await evaluate(`(()=>{const root=document.querySelector('context-halo-app').shadowRoot.querySelector('main-view').shadowRoot;return !root.querySelector('dialog').open && root.activeElement?.textContent.trim()==='Local AI setup help';})()`), 'Escape closes Local help and returns focus to its opener');

    // Capture clean and saved setup at the same actual window size as baseline.
    for (const theme of ['dark','light']) {
        await evaluate(`(async()=>{const app=document.querySelector('context-halo-app');await contextHalo.storage.updatePreference('theme',${JSON.stringify(theme)});contextHalo.theme.apply(${JSON.stringify(theme)},0.5);app.layoutMode='normal';app.navigate('main');await app.updateComplete;const view=app.shadowRoot.querySelector('main-view');await view.updateComplete;})()`);
        await delay(150); await capture(`home-${theme}-clean`);
        await evaluate(`(async()=>{const view=document.querySelector('context-halo-app').shadowRoot.querySelector('main-view');view._mode='byok';view._geminiKey='controlled-fixture-not-an-account';view._setupOpen=false;await view.updateComplete;})()`);
        await capture(`home-${theme}-saved`);
        for (const layout of ['normal','compact']) {
            await evaluate(`(async()=>{const app=document.querySelector('context-halo-app');app.layoutMode=${JSON.stringify(layout)};await app.updateComplete;})()`);
            await capture(`home-${theme}-${layout}`);
            await navigate('customize');
            const palette = await evaluate(`(async()=>{const view=document.querySelector('context-halo-app').shadowRoot.querySelector('customize-view');for(let n=0;view.settingsLoading&&n<100;n++)await new Promise(r=>setTimeout(r,10));const root=view.shadowRoot;const styles=getComputedStyle(document.documentElement);return {theme:view.theme,pageBackground:getComputedStyle(root.querySelector('.unified-page')).backgroundColor,appBackground:styles.getPropertyValue('--bg-app').trim(),windowBackground:styles.getPropertyValue('--window-background').trim(),text:getComputedStyle(root.querySelector('.page-title')).color,scheme:getComputedStyle(root.querySelector('select')).colorScheme};})()`);
            const expected = theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(16, 16, 16)';
            verify(palette.theme === theme && palette.pageBackground === 'rgba(0, 0, 0, 0)' && palette.appBackground === expected
                && palette.windowBackground.startsWith(theme === 'light' ? 'rgba(255, 255, 255,' : 'rgba(16, 16, 16,')
                && palette.text !== palette.appBackground && palette.scheme === theme,
                `${theme}/${layout}: persisted Settings hydration keeps transparent window, foreground and native palette consistent`);
            await capture(`settings-${theme}-${layout}`); await navigate('main');
        }
    }

    // Explicit virtual viewport layout checks complement, rather than masquerade
    // as, the runner's actual Windows display scale. These are not physical DPI.
    window.setMinimumSize(640,320); window.setBounds({ x:0,y:0,width:1100,height:800 });
    await navigate('main');
    const launch = await evaluate(`(()=>{const view=document.querySelector('context-halo-app').shadowRoot.querySelector('main-view');const b=view.shadowRoot.querySelector('.start-button').getBoundingClientRect();const p=view.shadowRoot.querySelector('#provider-choice').getBoundingClientRect();return {width:innerWidth,height:innerHeight,start:b.bottom<=innerHeight && b.top>=38,provider:p.bottom<=innerHeight && p.top>=38};})()`);
    verify(launch.start && launch.provider, 'Default 1100x800 layout puts Start and provider choice in the first viewport');
    await capture('home-1100x800');

    await navigate('assistant');
    const workArea = screen.getDisplayMatching(window.getBounds()).workArea;
    window.setMinimumSize(Math.min(640,workArea.width),Math.min(320,workArea.height));
    window.setBounds({ x:workArea.x,y:workArea.y,width:Math.min(640,workArea.width),height:Math.min(320,workArea.height) });
    await evaluate(`(async()=>{const app=document.querySelector('context-halo-app');contextHalo.theme.apply('dark',0.5);app._sessionStarted=true;app.providerState='ready';app.captureState={state:'ready',audioReady:true,screen:true,microphone:true};app._setLifecycle('active','Long status '.repeat(100));
        const request=app._beginRequest('text',{text:'Controlled question'});app._finishRequest(request,{success:false,error:'A long recoverable provider error '.repeat(100)});
        app.responses=['## Long answer fixture\\n\\n'+('A readable answer paragraph. '.repeat(80))+'\\n\\n\x60\x60\x60js\\nconst longValue = "'+('x'.repeat(240))+'";\\n\x60\x60\x60\\n\\nhttps://example.invalid/'+('long-source-'.repeat(70))];app.currentResponseIndex=0;await app.updateComplete;
        const view=app.shadowRoot.querySelector('assistant-view');await view.updateComplete;await new Promise(resolve=>setTimeout(resolve,100));})()`);
    const minimum = await evaluate(`(()=>{const app=document.querySelector('context-halo-app');const root=app.shadowRoot.querySelector('assistant-view').shadowRoot;
        const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight+1&&r.left>=0&&r.right<=innerWidth+1;};
        const answer=root.querySelector('#responseContainer');
        return {width:innerWidth,height:innerHeight,answerWidth:answer.clientWidth,sidebarWidth:app.shadowRoot.querySelector('.sidebar').getBoundingClientRect().width,answerHeight:answer.clientHeight,composer:visible(root.querySelector('#textInput')),analyze:visible(root.querySelector('.analyze-btn')),headerButtons:[...app.shadowRoot.querySelectorAll('.live-bar button')].every(visible),horizontalOverflow:answer.scrollWidth>answer.clientWidth+2,statusHeight:app.shadowRoot.querySelector('.session-state').clientHeight};})()`);
    verify(minimum.composer && minimum.analyze && minimum.headerButtons && minimum.answerHeight>=100 && !minimum.horizontalOverflow && minimum.statusHeight<=40, 'Minimum HUD keeps essential controls, at least 100px answer space, and one concise status row');
    verify(minimum.sidebarWidth === 0 && minimum.answerWidth >= minimum.width - 40, 'Compact interview uses the full window width and removes hidden navigation from layout');
    await capture('hud-minimum-expanded'); // Matching baseline viewport/long-error state, tools are no longer cramped inline.
    await evaluate(`document.querySelector('context-halo-app').shadowRoot.querySelector('.live-bar button').focus()`);
    await key('Tab');
    verify(await evaluate(`document.querySelector('context-halo-app').shadowRoot.activeElement?.textContent.trim()==='Hide'`), 'Native Tab reaches Hide from End');
    await evaluate(`document.querySelector('context-halo-app').shadowRoot.querySelector('assistant-view').shadowRoot.querySelector('.tools-open').focus()`);
    await key('Return');
    verify(await evaluate(`document.querySelector('context-halo-app').shadowRoot.querySelector('assistant-view').shadowRoot.querySelector('.tools-dialog').open`), 'Native Enter opens session tools');
    for (let n=0;n<14;n++) {
        await key('Tab');
        verify(await evaluate(`(()=>{const root=document.querySelector('context-halo-app').shadowRoot.querySelector('assistant-view').shadowRoot;return Boolean(root.activeElement?.closest('dialog'));})()`), 'Session tools trap native keyboard traversal');
    }
    await capture('hud-minimum-tools');
    await evaluate(`(async()=>{const view=document.querySelector('context-halo-app').shadowRoot.querySelector('assistant-view');view.toolsTab='actions';await view.updateComplete;})()`);
    const toolBody = await evaluate(`(()=>{const root=document.querySelector('context-halo-app').shadowRoot.querySelector('assistant-view').shadowRoot;return {height:root.querySelector('.secondary-body').clientHeight,scrollOwners:[...root.querySelector('.secondary-body').querySelectorAll('*')].filter(e=>getComputedStyle(e).overflowY==='auto' || getComputedStyle(e).overflowY==='scroll').length};})()`);
    verify(toolBody.height>=140 && toolBody.scrollOwners===0, 'Expanded tools have a usable panel with no nested scroll strips');
    await capture('hud-minimum-actions');
    await key('Escape');
    verify(await evaluate(`(()=>{const root=document.querySelector('context-halo-app').shadowRoot.querySelector('assistant-view').shadowRoot;return !root.querySelector('dialog').open && root.activeElement?.classList.contains('tools-open');})()`), 'Escape closes session tools and restores opener focus');
    await evaluate(`document.querySelector('context-halo-app').shadowRoot.querySelector('.session-state button').focus()`);
    await key('Space');
    verify(await evaluate(`document.querySelector('context-halo-app').shadowRoot.querySelector('.session-details').open`), 'Native Space opens recovery without hiding it beneath long errors');
    await capture('hud-minimum-recovery');
    await evaluate(`document.querySelector('context-halo-app').shadowRoot.querySelector('.session-details .error-details').open=true`);
    await capture('hud-minimum-error-details'); await key('Escape');
    await evaluate(`document.documentElement.style.setProperty('--response-font-size','28px')`);
    await capture('hud-minimum-large-text');
    await evaluate(`document.documentElement.style.removeProperty('--response-font-size')`);

    await evaluate(`contextHalo.storage.getPreferences()`);
    await evaluate(`window.electronAPI.invoke('toggle-window-visibility')`); await delay(80);
    verify(!window.isVisible() || window.isMinimized(), 'Hide uses the real native window path');
    await evaluate(`window.electronAPI.invoke('toggle-window-visibility')`); await delay(80);
    verify(window.isVisible() && !window.isMinimized(), 'Hidden or minimized HUD is restored through its recovery path');
    verify(await evaluate(`document.querySelector('context-halo-app').sessionActive`), 'Hide and restore do not end the active session');
    minimum.launch = launch; minimum.tools = toolBody; minimum.recovery = windowApi.getShortcutState().recovery;
    // One compositor check on the exact package at 100%, not four redundant
    // runs and not a renderer capture presented as desktop transparency proof.
    let compositor;
    if (require('electron').app.isPackaged && process.argv.includes('--force-device-scale-factor=1')) {
        compositor = await require('./windows-compositor-acceptance').verifyWindowsCompositor(window, directory);
    }
    return { minimum, keyboard, accessibility, compositor };
}

module.exports = { extendedWindowsAcceptance };
