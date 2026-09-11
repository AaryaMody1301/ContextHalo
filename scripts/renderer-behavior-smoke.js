// Runs inside the real sandboxed Electron renderer. Provider replies are mocked;
// storage, knowledge, practice and review IPC use their real main-process handlers.
async function rendererBehaviorSmoke() {
    const checks = [];
    const verify = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
    const settle = async element => { await element.updateComplete; await new Promise(resolve => setTimeout(resolve, 25)); };
    const waitUntil = async condition => {
        for (let n=0;n<100;n++) { if (condition()) return; await new Promise(resolve=>setTimeout(resolve,20)); }
        const view=document.querySelector('context-halo-app')?.shadowRoot?.querySelector('assistant-view');
        const sizes=[...(view?.shadowRoot?.children || [])].filter(e=>e.tagName!=='STYLE').map(e=>[e.className,e.clientHeight]);
        throw new Error('Renderer condition did not settle after '+checks.join(', ')+'; viewport='+innerWidth+'x'+innerHeight+'; layout='+JSON.stringify(sizes));
    };
    const app = document.querySelector('context-halo-app');
    const api = window.contextHalo;
    await waitUntil(()=>app._storageLoaded);
    app.currentView='assistant'; app._sessionStarted=true; app.providerState='ready';
    app.captureState={state:'ready',screen:true,audioReady:true,microphone:true};
    app._setLifecycle('active','Controlled renderer fixture - no live account or device'); await settle(app);
    const assistant=app.shadowRoot.querySelector('assistant-view');
    await settle(assistant);
    const root=assistant.shadowRoot;
    const input=root.querySelector('#textInput');
    const button=root.querySelector('.send-btn');
    verify(input?.tagName==='TEXTAREA' && button,'Multiline composer and Send button render');
    await assistant.openTools(); await settle(assistant);
    verify(root.querySelector('.tools-dialog').open, 'Secondary workspace is a native modal');
    assistant.toolsTab='actions'; await settle(assistant);
    verify(Boolean(root.querySelector('.phase3-capture-tools')), 'Capture actions remain reachable in their workspace');
    root.querySelector('.phase3-context-toggle').click(); await settle(assistant);
    verify(Boolean(root.querySelector('.phase3-context-inspector')), 'Context inspector remains independent of transcript rendering');
    root.querySelector('.phase3-transcript-toggle').click(); await settle(assistant);
    verify(Boolean(root.querySelector('.phase3-transcript-history')), 'Transcript controls remain reachable in a full panel');
    assistant.closeTools(); await settle(assistant);
    const setDraft=async text=>{ input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));await settle(assistant); };
    const original=api.sendTextMessage;
    try {
        let release;
        let calls=0;
        api.sendTextMessage=()=>{calls++;return new Promise(resolve=>{release=resolve;});};
        app.addNewResponse('Earlier answer'); app.addNewResponse('Latest answer');
        app.currentResponseIndex=0;
        await setDraft('First question'); button.click(); await settle(assistant);
        verify(app.currentResponseIndex===app.responses.length-1,'New typed question returns to the newest response');
        await waitUntil(()=>root.querySelector('#responseContainer').clientHeight>=100);
        verify(root.querySelector('#responseContainer').clientHeight>=100,'Default HUD reserves a usable answer area');
        verify(assistant.sending && button.disabled && calls===1,'Pending send is disabled');
        app.addNewResponse('Unrelated voice answer',{requestId:'voice-smoke',kind:'voice'});
        await settle(app);
        verify(assistant.sending,'Voice output does not complete a typed request');
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
        verify(calls===1,'Repeated Enter cannot duplicate an active request');
        await setDraft('Next unsent draft'); release({success:true,text:'Response'}); await waitUntil(()=>!assistant.sending);await settle(assistant);
        verify(input.value==='Next unsent draft','In-flight response preserves a newer draft');
        api.sendTextMessage=async()=>({success:false,error:'Mock quota exceeded'});
        button.click();await waitUntil(()=>assistant.sendError);await settle(assistant);
        verify(input.value==='Next unsent draft' && assistant.sendError.includes('Mock quota exceeded') && app.requestError?.message.includes('Mock quota exceeded'),'Failed send retains draft and exposes its owned recovery error');
        api.sendTextMessage=async()=>{calls++;return {success:true,text:'Done'};};
        const before=calls;
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true}));
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));
        verify(calls===before,'Shift+Enter and IME composition do not send');
        button.click();await waitUntil(()=>!assistant.sending && !assistant.draft);await settle(assistant);
        verify(input.value==='','Successful send clears the submitted draft');
        verify(!app.requestError && !assistant.sendError, 'Successful text retry removes the obsolete banner and Retry action');
        const originalCapture = window.captureManualScreenshot;
        try {
            window.captureManualScreenshot = async () => ({success:false,error:'Controlled screen failure'});
            await assistant.handleScreenAnswer(); await settle(assistant);
            verify(app.requestError?.operation === 'screen' && assistant.analysisError.includes('Controlled screen failure'), 'Screen failure has screen-owned recovery');
            window.captureManualScreenshot = async () => ({success:true,text:'Controlled screen answer'});
            await app.retryRequest(); await settle(assistant);
            verify(!app.requestError && !assistant.analysisError, 'Successful screen Retry removes its obsolete banner and action');
        } finally { window.captureManualScreenshot = originalCapture; }
        app.addNewResponse('Typed start',{requestId:'text-smoke',kind:'text'});
        app.addNewResponse('Screen start',{requestId:'screen-smoke',kind:'screen'});
        app.updateCurrentResponse('Typed final',{requestId:'text-smoke'});
        app.updateCurrentResponse('Screen final',{requestId:'screen-smoke'});
        verify(app.responses.includes('Typed final') && app.responses.includes('Screen final'),'Concurrent response cards stay isolated');
        app.addNewResponse('<script>window.__unsafe=true</script><img src=x onerror="window.__unsafe=true"><svg onload="window.__unsafe=true"></svg><a href="javascript:alert(1)" onclick="alert(1)">unsafe</a><p><strong>Safe</strong></p>',{requestId:'sanitize-smoke'});
        app.currentResponseIndex=app.responses.length-1;await settle(app);await settle(assistant);
        const response=root.querySelector('#responseContainer');
        verify(!response.querySelector('script,img,svg,[onclick],[onerror],a[href^="javascript"]') && !window.__unsafe && response.querySelector('strong')?.textContent==='Safe','Rendered Markdown removes active HTML but preserves formatting');
    } finally { api.sendTextMessage=original;app._sessionStarted=false;app._setLifecycle('idle','Fixture complete'); }
    const ipc=window.electronAPI;
    const call=async(channel,...args)=>{const result=await ipc.invoke(channel,...args);if(!result?.success)throw new Error(channel+': '+result?.error);return result.data;};
    const text='The data pipeline uses idempotent ingestion to prevent duplicate events. Atomic checkpoints record the last committed offset so interrupted jobs resume safely. Partitioned tables and bounded retries improve recovery without silently discarding records.';
    const knowledgeDoc=await call('knowledge:add-text','Smoke test data pipeline',text);
    try {
        const hits=await call('knowledge:search','idempotent ingestion');
        verify(hits.some(hit=>hit.text.includes('idempotent')),'Knowledge add and retrieval use real IPC');
        const practice=await call('practice:generate',{sourceType:'knowledge',documentIds:[knowledgeDoc.id],count:2});
        verify(practice.questions.length>0,'Practice generation creates source-grounded questions');
        const grade=await call('practice:grade',practice.setId,practice.questions[0].id,text);
        verify(Number.isFinite(grade.score) && typeof grade.reference==='string','Practice grading returns score and reference');
        await call('knowledge:set-enabled',knowledgeDoc.id,false);
        verify((await call('knowledge:search','idempotent ingestion')).length===0,'Disabled knowledge is excluded from retrieval');
    } finally { await call('knowledge:delete',knowledgeDoc.id); }
    const sessionId='1234567890123';
    await call('storage:save-session',sessionId,{profile:'meeting',liveTranscript:[{text:'We decided to deploy on Friday.',provider:'gemini',timestamp:1}],markers:[{type:'decision',timestamp:1}],sessionPack:{title:'Smoke session'}});
    await call('storage:save-session',sessionId,{conversationHistory:[{transcription:'What is next?',ai_response:'Test the deployment.'}]});
    const saved=await call('storage:get-session',sessionId);
    verify(saved.liveTranscript.length===1 && saved.markers.length===1 && saved.sessionPack.title==='Smoke session','Session updates preserve transcript, markers and context pack');
    const review=await call('review:get',sessionId);
    verify(Boolean(review && typeof review==='object'),'Session review reads persisted context');
    app.navigate('history'); await settle(app);
    const historyView = app.shadowRoot.querySelector('history-view');
    await waitUntil(() => !historyView.loading);
    verify(historyView.sessions.some(session => session.title === 'Smoke session'), 'Saved titles arrive in History list metadata');
    historyView.searchQuery = 'Smoke session'; await settle(historyView);
    verify(historyView.shadowRoot.querySelector('.session-profile')?.textContent === 'Smoke session', 'History titles are primary labels and searchable');
    historyView.searchQuery = 'nonexistent session fixture'; await settle(historyView);
    verify(historyView.shadowRoot.textContent.includes('No sessions match'), 'Filtered-empty history is specific to the query');
    const originalHistoryRead = api.storage.getAllSessions;
    api.storage.getAllSessions = async () => { throw new Error('Controlled read failure'); };
    try {
        await historyView.loadSessions(); await settle(historyView);
        verify(historyView.sessions.length === 1 && Boolean(historyView.loadError), 'Transient History failure preserves the last loaded list');
    } finally { api.storage.getAllSessions = originalHistoryRead; }
    await historyView.loadSessions(); historyView.searchQuery = ''; await settle(historyView);
    await historyView.openSession(sessionId); await settle(historyView);
    verify(historyView.shadowRoot.querySelector('.back-btn')?.getAttribute('aria-label') === 'Back to session history', 'History Back has an accessible action name');
    await call('storage:delete-session',sessionId);
    verify((await ipc.invoke('storage:get-session','../escape')).success===false,'IPC rejects invalid session paths');
    app.navigate('main');await settle(app);
    const home=app.shadowRoot.querySelector('main-view'); await settle(home);
    await waitUntil(()=>home.shadowRoot.querySelector('.page-title')?.getBoundingClientRect().top>=40);
    verify(home.shadowRoot.querySelector('.page-title').getBoundingClientRect().top>=40,'Home heading is below the draggable caption');
    verify(getComputedStyle(app.shadowRoot.querySelector('.sidebar-nav')).overflowY==='auto','Sidebar navigation remains scrollable in short windows');
    const previousLayout = app.layoutMode;
    for (const layout of ['normal', 'compact']) {
        app.layoutMode = layout; await settle(app);
        const content = app.shadowRoot.querySelector('.content-inner');
        verify(content.clientWidth >= 250 && getComputedStyle(content).overflowY === 'auto', `${layout} pages retain a usable scroll owner`);
        const settingsButton = [...app.shadowRoot.querySelectorAll('.nav-item')].find(element => element.title === 'Settings');
        verify(Boolean(settingsButton), `${layout} navigation retains Settings`);
        settingsButton.click(); await settle(app);
        verify(Boolean(app.shadowRoot.querySelector('customize-view')), `${layout} Settings opens`);
        app.navigate('main'); await settle(app);
    }
    app.layoutMode = previousLayout; await settle(app);
    for (const id of ['phase4-knowledge-nav','phase4-practice-nav','phase4-review-nav']) {
        await waitUntil(()=>app.shadowRoot.getElementById(id));
        app.shadowRoot.getElementById(id).click();
        await new Promise(resolve=>setTimeout(resolve,80));
        verify(app.shadowRoot.querySelector('.phase4-overlay')?.open,'Workspace opens: '+id);
        verify(app.shadowRoot.activeElement?.closest('.phase4-overlay'),'Workspace focus is inside the modal: '+id);
        app.shadowRoot.querySelector('.phase4-close')?.click();
    }
    // Real native controls and isolated provider attribution; no external account needed.
    app.navigate('assistant');await settle(app);
    const live=app.shadowRoot.querySelector('.live-bar');
    verify([...live.querySelectorAll('button')].some(b=>b.textContent==='Hide'),'Hide is a keyboard-accessible native button');
    const liveView=app.shadowRoot.querySelector('assistant-view'); await settle(liveView);
    liveView.grounding={sources:[{uri:'https://ai.google.dev/',title:'Fixture source'}],renderedContent:'<style>p{margin:4px}</style><p><a href="https://www.google.com/search?q=fixture">Google Search suggestion</a></p><script>window.__unsafe=true</script>'};
    await settle(liveView);const attribution=liveView.shadowRoot.querySelector('grounding-sources');await settle(attribution);
    verify(attribution.shadowRoot.querySelector('a')?.href==='https://ai.google.dev/','Grounding source links are usable HTTP(S) URLs');
    const frame=attribution.shadowRoot.querySelector('iframe');
    await waitUntil(()=>frame?.contentDocument?.querySelector('a'));
    verify(!frame.contentDocument.querySelector('script') && !window.__unsafe,'Search attribution is displayed without active provider HTML');
    const storedAlpha=(await api.storage.getPreferences()).backgroundTransparency ?? 0.8;
    await api.storage.updatePreference('backgroundTransparency',0.37);await api.theme.save('light');await api.theme.save('dark');await api.theme.load();
    verify(api.theme.currentAlpha===0.37,'Changing theme and reloading appearance preserve saved alpha');
    await api.storage.updatePreference('backgroundTransparency',storedAlpha);
    app.searchState={requested:true,effective:false,status:'disabled-for-session'};app.setStatus('Listening...');await settle(app);
    verify(app.shadowRoot.querySelector('.search-state').textContent.includes('off (session)'),'Requested/effective Search remains visible independently of transient status');
    app.navigate('customize'); await settle(app);
    const settings = app.shadowRoot.querySelector('customize-view'); await waitUntil(() => !settings.settingsLoading);
    const originalSave = api.storage.updatePreference;
    api.storage.updatePreference = async () => ({ success:false, error:'Controlled save failure' });
    try {
        await settings.handleAudioModeSelect({ target: { value:'mic_only' } }); await settle(settings);
        verify(settings.audioMode === 'mic_only' && settings.saveStates.audioMode === 'failed', 'Settings keeps unsaved edits and reports explicit unsuccessful writes');
    } finally { api.storage.updatePreference = originalSave; }
    await settings.retrySaves(); await settle(settings);
    verify(settings.saveStates.audioMode === 'saved', 'Settings Retry confirms persistence');
    await api.storage.updatePreference('audioMode', 'speaker_only');
    for (const page of ['main','customize','ai-customize','history','help','feedback','onboarding']) {
        app.navigate(page); await settle(app);
        const view = app.shadowRoot.querySelector(page === 'customize' ? 'customize-view' : page === 'main' ? 'main-view' : page === 'ai-customize' ? 'ai-customize-view' : `${page}-view`);
        await settle(view);
        const unnamed = [...view.shadowRoot.querySelectorAll('input,textarea,select')].filter(control => !control.labels?.length && !control.getAttribute('aria-label') && !control.getAttribute('aria-labelledby'));
        verify(unnamed.length === 0, `${page}: every form control has a programmatic label`);
    }
    app.navigate('assistant'); await settle(app);
    const reading = app.shadowRoot.querySelector('assistant-view');
    app.responses = [Array.from({length:60}, (_,n)=>`Paragraph ${n}: long fixture answer with readable text.`).join('\n\n'), 'Background card'];
    app.currentResponseIndex = 0; await settle(app); await settle(reading);
    const scroll = reading.shadowRoot.querySelector('#responseContainer');
    scroll.scrollTop = 90; const position = scroll.scrollTop;
    const body = scroll.querySelector('.response-body'); const oldNode = body.firstChild;
    app.responses = [app.responses[0], 'An updated background card']; await settle(app); await settle(reading);
    verify(scroll.scrollTop === position && body.firstChild === oldNode, 'Background responses preserve reading position and the current DOM');
    app.responses = [app.responses[0] + '\n\nAdditional streaming paragraph', app.responses[1]]; await settle(app); await settle(reading);
    verify(scroll.scrollTop === position, 'Streaming growth does not pull a reader away from older content');
    app.responses = [app.responses[0]]; app.currentResponseIndex = 0; await settle(app); await settle(reading);
    scroll.scrollTop = 90; const latestPosition = scroll.scrollTop;
    app.addNewResponse('A newly arrived voice answer', {requestId:'reading-voice-new',kind:'voice'});
    await settle(app); await settle(reading);
    verify(app.currentResponseIndex === 0 && scroll.scrollTop === latestPosition, 'A new voice card does not replace the latest answer while its earlier paragraphs are being read');
    return checks;
}


function installWindowsSmokeCheck(window) {
    const { app } = require('electron');

    const fs = require('node:fs');
    const path = require('node:path');
    const directory = path.resolve(process.env.CONTEXTHALO_QA_DIR || path.join(process.cwd(), 'qa-results'));
    fs.mkdirSync(directory, { recursive: true });
    const rendererErrors = [];
    window.webContents.on('console-message', (_event, ...details) => {
        const message = typeof details[0] === 'object' ? details[0] : { level: details[0], message: details[1] };
        if (message.level === 'error' || message.level === 3) rendererErrors.push(String(message.message).slice(0, 2000));
    });
    let finished = false;
    const finish = (success, detail) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        fs.writeFileSync(path.join(directory, 'outcome.json'), JSON.stringify({ success, detail, packaged: app.isPackaged, version: app.getVersion(), platform: process.platform, arch: process.arch, windowsRelease: require('node:os').release(), electron: process.versions.electron, commit: process.env.GITHUB_SHA || null, completedAt: new Date().toISOString() }, null, 2));
        console.log(success ? `[Windows smoke] PASS: ${detail}` : `[Windows smoke] FAIL: ${detail}`);
        setTimeout(() => app.exit(success ? 0 : 1), 50);
    };

    const timeout = setTimeout(() => finish(false, 'renderer did not become ready within 120 seconds'), 120000);

    window.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
        finish(false, `load failed (${errorCode}): ${errorDescription}`);
    });
    window.webContents.once('render-process-gone', (_event, details) => {
        finish(false, `renderer process exited: ${details.reason}`);
    });
    window.webContents.once('did-finish-load', async () => {
        try {
            const result = await window.webContents.executeJavaScript(`
                (async () => {
                    await customElements.whenDefined('context-halo-app');
                    await customElements.whenDefined('main-view');
                    await customElements.whenDefined('assistant-view');
                    await customElements.whenDefined('customize-view');

                    const mainView = document.createElement('main-view');
                    mainView.style.display = 'none';
                    document.body.appendChild(mainView);
                    await mainView.updateComplete;
                    mainView.startError = 'Smoke test session failure';
                    mainView.requestUpdate();
                    await mainView.updateComplete;
                    const mainText = mainView.shadowRoot?.textContent || '';
                    const homeReady = Boolean(mainView.shadowRoot.querySelector('.start-button') && mainView.shadowRoot.querySelector('label[for="session-profile"]'));
                    const errorReady = Boolean(mainView.shadowRoot?.querySelector('.session-status.error'));

                    await customElements.whenDefined('customize-view');

                    const app = document.querySelector('context-halo-app');
                    for (let i = 0; i < 80 && app?._storageLoaded !== true; i++) {
                        await new Promise(resolve => setTimeout(resolve, 25));
                    }
                    app.currentView = 'main';
                    app.requestUpdate();
                    await app.updateComplete;
                    const content = app.shadowRoot?.querySelector('.content-inner');
                    const liveMain = app.shadowRoot?.querySelector('main-view');
                    const mainOverflow = liveMain ? getComputedStyle(liveMain).overflowY : '';
                    if (liveMain) liveMain.style.minHeight = '1800px';
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    if (content) content.scrollTop = content.scrollHeight;
                    const parentCanScroll = Boolean(content && content.scrollTop > 0);
                    app.navigate('customize');
                    await app.updateComplete;
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    const settingsInApp = app.shadowRoot?.querySelector('customize-view');
                    let settingsReady = false;
                    for (let attempt = 0; attempt < 100 && !settingsReady; attempt++) {
                        const settingsText = settingsInApp?.shadowRoot?.textContent || '';
                        settingsReady = settingsText.includes('Session Defaults') &&
                            settingsText.includes('AI Provider & Models') &&
                            settingsText.includes('AI Behavior') &&
                            settingsText.includes('Keyboard Shortcuts');
                        if (!settingsReady) await new Promise(resolve => setTimeout(resolve, 20));
                    }
                    const unifiedPage = settingsInApp?.shadowRoot?.querySelector('.unified-page');
                    const settingsOverflow = unifiedPage ? getComputedStyle(unifiedPage).overflowY : '';
                    const navigationReset = Boolean(content && content.scrollTop === 0);
                    const singleScrollOwner = mainOverflow !== 'auto' && settingsOverflow !== 'auto';

                    mainView.remove();

                    return {
                        bridge: Boolean(window.electronAPI && window.require),
                        platform: window.process?.platform,
                        arch: window.process?.arch,
                        app: Boolean(document.querySelector('context-halo-app')),
                        home: homeReady,
                        sessionError: errorReady,
                        settings: settingsReady,
                        parentCanScroll,
                        navigationReset,
                        singleScrollOwner,
                    };
                })()
            `, true);

            const ready = result?.bridge === true &&
                result?.platform === 'win32' &&
                result?.arch === 'x64' &&
                result?.app === true &&
                result?.home === true &&
                result?.sessionError === true &&
                result?.settings === true &&
                result?.parentCanScroll === true &&
                result?.navigationReset === true &&
                result?.singleScrollOwner === true;
            if (!ready) throw new Error(`unexpected renderer state ${JSON.stringify(result)}`);
            
            const checks = await window.webContents.executeJavaScript(`(${rendererBehaviorSmoke.toString()})()`, true);
            console.log('[Windows behavior smoke] ' + JSON.stringify(checks));
            const fs = require('node:fs');
            const path = require('node:path');
            fs.mkdirSync(directory, { recursive: true });
            for (const view of ['main', 'customize', 'assistant']) {
                await window.webContents.executeJavaScript(`(async () => {
                    const app = document.querySelector('context-halo-app');
                    app.navigate(${JSON.stringify(view)});
                    if (${JSON.stringify(view)} === 'assistant') {
                        app.responses = ['## Session assistance ready\\n\\nTyped answers, live audio, and screen context stay separate.\\n\\nUse the composer below to ask a question.'];
                        app.currentResponseIndex = 0;
                    }
                    app.requestUpdate(); await app.updateComplete;
                    await new Promise(resolve => setTimeout(resolve, 150));
                })()`);
                fs.writeFileSync(path.join(directory, view + '.png'), (await window.webContents.capturePage()).toPNG());
            }
            // Capture actual Lit/native-window output, including alpha variants.
            const appearance = [];
            for (const theme of ['dark', 'light']) {
                for (const alpha of [0.25, 0.5, 0.8, 1]) {
                    const state = await window.webContents.executeJavaScript(`(async () => {
                        const app = document.querySelector('context-halo-app');
                        contextHalo.theme.apply(${JSON.stringify(theme)}, ${alpha});
                        app.navigate('assistant'); await app.updateComplete;
                        app.providerState = 'ready'; app.statusText = 'Controlled renderer fixture - no live account or device';
                        app.searchState = {requested:true,effective:false,status:'disabled-for-session'};
                        await app.updateComplete; await new Promise(resolve=>setTimeout(resolve,100));
                        const shell=app.shadowRoot.querySelector('.app-shell');
                        return { theme:${JSON.stringify(theme)}, alpha:${alpha}, background:getComputedStyle(shell).backgroundColor, devicePixelRatio, width:innerWidth, height:innerHeight };
                    })()`);
                    appearance.push(state);
                    fs.writeFileSync(path.join(directory, `hud-${theme}-${alpha}.png`), (await window.webContents.capturePage()).toPNG());
                }
            }
            const { minimum, keyboard, accessibility } = await extendedWindowsAcceptance(window, directory);
            fs.writeFileSync(path.join(directory, 'checks.json'), JSON.stringify({ shell: result, behavior: checks, appearance, minimum, keyboard, accessibility, rendererErrors, scaleMode: 'Chromium device scale factor; not physical Windows DPI acceptance' }, null, 2));
            if (rendererErrors.length) throw new Error('Renderer console errors: '+rendererErrors.join('; '));
            finish(true, 'sandboxed preload, navigation, typed composer, response routing, knowledge, practice and review verified');
        } catch (error) {
            try {
                const fs = require('node:fs');
                const path = require('node:path');
                    fs.mkdirSync(directory, { recursive: true });
                fs.writeFileSync(path.join(directory, 'failure.txt'), error.stack || error.message);
                fs.writeFileSync(path.join(directory, 'failure.png'), (await window.webContents.capturePage()).toPNG());
            } catch {}
            finish(false, error.message);
        }
    });
}

module.exports={rendererBehaviorSmoke,installWindowsSmokeCheck};

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
            const palette = await evaluate(`(async()=>{const view=document.querySelector('context-halo-app').shadowRoot.querySelector('customize-view');for(let n=0;view.settingsLoading&&n<100;n++)await new Promise(r=>setTimeout(r,10));const root=view.shadowRoot;return {theme:view.theme,background:getComputedStyle(root.querySelector('.unified-page')).backgroundColor,text:getComputedStyle(root.querySelector('.page-title')).color,scheme:getComputedStyle(root.querySelector('select')).colorScheme};})()`);
            const expected = theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(16, 16, 16)';
            verify(palette.theme === theme && palette.background === expected && palette.text !== palette.background && palette.scheme === theme, `${theme}/${layout}: persisted Settings hydration keeps foreground, background and native palette consistent`);
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
    return { minimum, keyboard, accessibility };
}
