// Runs inside the real sandboxed Electron renderer. Provider replies are mocked;
// storage, knowledge, practice and review IPC use their real main-process handlers.
const { extendedWindowsAcceptance } = require('./windows-acceptance');
async function rendererBehaviorSmoke() {
    const checks = [];
    const verify = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
    const settle = async element => { await element.updateComplete; await new Promise(resolve => setTimeout(resolve, 25)); };
    const waitUntil = async (condition, timeoutMs = 2000) => {
        for (let n=0;n<Math.ceil(timeoutMs/20);n++) { if (condition()) return; await new Promise(resolve=>setTimeout(resolve,20)); }
        const view=document.querySelector('context-halo-app')?.shadowRoot?.querySelector('assistant-view');
        const sizes=[...(view?.shadowRoot?.children || [])].filter(e=>e.tagName!=='STYLE').map(e=>[e.className,e.clientHeight]);
        throw new Error('Renderer condition did not settle after '+checks.join(', ')+'; viewport='+innerWidth+'x'+innerHeight+'; layout='+JSON.stringify(sizes));
    };
    // Exercise the real bundled worklet and MessagePort in sandboxed Electron,
    // using an oscillator rather than claiming physical microphone acceptance.
    const audio = new AudioContext({ sampleRate: 16000 });
    let oscillator;
    let processor;
    try {
        await audio.audioWorklet.addModule('./utils/audioCaptureWorklet.js');
        processor = new AudioWorkletNode(audio, 'context-halo-audio-capture', {
            processorOptions: { samplesPerChunk: 640 },
            channelCount: 1, channelCountMode: 'explicit',
        });
        let messages = 0;
        let bytes = 0;
        processor.port.onmessage = event => {
            messages++; bytes = event.data.pcm.byteLength;
            processor.port.postMessage({ ack: event.data.sequence });
        };
        oscillator = audio.createOscillator();
        oscillator.connect(processor); processor.connect(audio.destination);
        oscillator.start(); await audio.resume();
        await waitUntil(() => messages >= 2, 8000);
        verify(bytes === 1280, 'Real AudioWorklet emits acknowledged 40 ms / 16 kHz Gemini PCM chunks');
    } finally {
        try { oscillator?.stop(); oscillator?.disconnect(); processor?.disconnect(); } catch {}
        processor?.port.close(); await audio.close();
    }
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
        const originalCapture = api.captureManualScreenshot;
        try {
            api.captureManualScreenshot = async () => ({success:false,error:'Controlled screen failure'});
            await assistant.handleScreenAnswer(); await settle(assistant);
            verify(app.requestError?.operation === 'screen' && assistant.analysisError.includes('Controlled screen failure'), 'Screen failure has screen-owned recovery');
            api.captureManualScreenshot = async () => ({success:true,text:'Controlled screen answer'});
            await app.retryRequest(); await settle(assistant);
            verify(!app.requestError && !assistant.analysisError, 'Successful screen Retry removes its obsolete banner and action');
        } finally { api.captureManualScreenshot = originalCapture; }
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
    // Exercise the real Home controls and persistence. Only the final provider
    // launch callback is controlled: smoke must not download models or use keys.
    const originalMode = (await api.storage.getPreferences()).providerMode;
    try {
        app.currentView = 'main'; await settle(app);
        let home = app.shadowRoot.querySelector('main-view');
        await waitUntil(() => home && !home._configurationLoading);
        await settle(home);
        const select = home.shadowRoot.querySelector('#provider-choice');
        select.value = 'local'; select.dispatchEvent(new Event('change', { bubbles: true }));
        await home._configurationWrites; await settle(home);
        verify(home._mode === 'local' && (await api.storage.getPreferences()).providerMode === 'local', 'Home provider dropdown selects and persists Local AI without a platform shim');
        let starts = 0;
        home.onStart = () => { starts++; };
        home.shadowRoot.querySelector('.start-button').click();
        await waitUntil(() => starts === 1);
        verify(!home._keyError, 'Local AI Start reaches session launch without a cloud API key');
        app.currentView = 'help'; await settle(app);
        app.currentView = 'main'; await settle(app);
        home = app.shadowRoot.querySelector('main-view');
        await waitUntil(() => home && !home._configurationLoading); await settle(home);
        verify(home._mode === 'local', 'Home reload retains the Local AI provider choice');
        home.onStart = () => { starts++; };
        home.shadowRoot.querySelector('.start-button').click();
        await waitUntil(() => starts === 2);
    } finally {
        await api.storage.updatePreference('providerMode', originalMode || 'byok');
        app.currentView = 'assistant'; await settle(app);
    }
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
    app.searchState={requested:true,effective:false,httpEffective:true,status:'live-setup-fallback'};await settle(app);
    verify(app.shadowRoot.querySelector('.search-state').textContent.includes('text/screen only'),'Live fallback keeps HTTP Search visibly enabled');
    app.requestError={operation:'text',httpStatus:503,model:'gemini-3.8-flash',message:'Controlled service unavailable',retryAt:0};
    await app.openSessionDetails();await settle(app);
    verify(app.shadowRoot.querySelector('.session-details').textContent.includes('Text and screen Search: enabled'),'Session details distinguish Live and HTTP Search');
    verify(app.shadowRoot.querySelector('.session-details').textContent.includes('gemini-3.8-flash'),'Request recovery identifies the selected HTTP model');
    app.closeSessionDetails();app.requestError=null;
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
    const { readCurrentRelease } = require('../src/utils/updateMain');

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
        const release = readCurrentRelease(app);
        fs.writeFileSync(path.join(directory, 'outcome.json'), JSON.stringify({ success, detail, packaged: app.isPackaged, version: app.getVersion(), releaseTag: release.tag, releaseCommit: release.commit, platform: process.platform, arch: process.arch, windowsRelease: require('node:os').release(), electron: process.versions.electron, commit: process.env.GITHUB_SHA || null, completedAt: new Date().toISOString() }, null, 2));
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
                    let settingsInApp = null;
                    let settingsReady = false;
                    for (let attempt = 0; attempt < 200 && !settingsReady; attempt++) {
                        settingsInApp = app.shadowRoot?.querySelector('customize-view') || null;
                        const settingsText = settingsInApp?.shadowRoot?.textContent || '';
                        settingsReady = Boolean(settingsInApp?.shadowRoot?.querySelector('.unified-page')) &&
                            settingsText.includes('Session Defaults') &&
                            settingsText.includes('AI Provider & Models') &&
                            settingsText.includes('AI Behavior') &&
                            settingsText.includes('Keyboard Shortcuts');
                        if (!settingsReady) await new Promise(resolve => setTimeout(resolve, 25));
                    }
                    let settingsUpdateError = '';
                    if (settingsInApp) {
                        try {
                            const updateResult = await Promise.race([
                                settingsInApp.updateComplete.then(() => 'complete', error => { throw error; }),
                                new Promise(resolve => setTimeout(() => resolve('timeout'), 2000)),
                            ]);
                            if (updateResult === 'timeout') settingsUpdateError = 'updateComplete timed out after 2000ms';
                        } catch (error) { settingsUpdateError = String(error?.stack || error?.message || error).slice(0, 4000); }
                    }
                    const unifiedPage = settingsInApp?.shadowRoot?.querySelector('.unified-page');
                    const settingsOverflow = unifiedPage ? getComputedStyle(unifiedPage).overflowY : '';
                    const navigationReset = Boolean(content && content.scrollTop === 0);
                    const singleScrollOwner = mainOverflow !== 'auto' && settingsOverflow !== 'auto';

                    mainView.remove();

                    return {
                        bridge: Boolean(window.electronAPI && !window.require && !window.process),
                        app: Boolean(document.querySelector('context-halo-app')),
                        home: homeReady,
                        sessionError: errorReady,
                        settings: settingsReady,
                        settingsDebug: {
                            currentView: app?.currentView || null,
                            appConnected: Boolean(app?.isConnected),
                            present: Boolean(settingsInApp),
                            isConnected: Boolean(settingsInApp?.isConnected),
                            parentClass: settingsInApp?.parentElement?.className || null,
                            rootIsAppShadow: settingsInApp?.getRootNode?.() === app?.shadowRoot,
                            shadow: Boolean(settingsInApp?.shadowRoot),
                            childCount: settingsInApp?.shadowRoot?.childNodes?.length ?? -1,
                            text: String(settingsInApp?.shadowRoot?.textContent || '').slice(0, 2000),
                            html: String(settingsInApp?.shadowRoot?.innerHTML || '').slice(0, 4000),
                            updateError: settingsUpdateError,
                            constructorName: settingsInApp?.constructor?.name || null,
                            definedName: customElements.get('customize-view')?.name || null,
                        },
                        parentCanScroll,
                        navigationReset,
                        singleScrollOwner,
                    };
                })()
            `, true);

            const ready = result?.bridge === true &&
                process.platform === 'win32' &&
                process.arch === 'x64' &&
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
