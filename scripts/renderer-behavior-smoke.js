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
    app.currentView='assistant'; app.sessionActive=true; app.requestUpdate(); await settle(app);
    const assistant=app.shadowRoot.querySelector('assistant-view');
    await settle(assistant);
    const root=assistant.shadowRoot;
    const input=root.querySelector('#textInput');
    const button=root.querySelector('.send-btn');
    verify(input?.tagName==='TEXTAREA' && button,'Multiline composer and Send button render');
    await waitUntil(()=>root.querySelector('.phase3-capture-tools'));
    root.querySelector('.phase3-transcript-toggle').click(); await settle(assistant);
    verify(Boolean(root.querySelector('.phase3-capture-tools')),'Capture tools survive transcript refresh');
    [...root.querySelectorAll('.phase3-tool-button')].find(b=>b.textContent==='Context').click();
    root.querySelector('.phase3-transcript-toggle').click(); await settle(assistant);
    verify(Boolean(root.querySelector('.phase3-context-inspector')),'Context inspector survives transcript refresh');
    [...root.querySelectorAll('.phase3-tool-button')].find(b=>b.textContent==='Context').click();
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
        verify(input.value==='Next unsent draft' && root.querySelector('[role="alert"]')?.textContent.includes('Mock quota exceeded'),'Failed send retains draft and shows an alert');
        api.sendTextMessage=async()=>{calls++;return {success:true,text:'Done'};};
        const before=calls;
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true}));
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));
        verify(calls===before,'Shift+Enter and IME composition do not send');
        button.click();await waitUntil(()=>!assistant.sending && !assistant.draft);await settle(assistant);
        verify(input.value==='','Successful send clears the submitted draft');
        app.addNewResponse('Typed start',{requestId:'text-smoke',kind:'text'});
        app.addNewResponse('Screen start',{requestId:'screen-smoke',kind:'screen'});
        app.updateCurrentResponse('Typed final',{requestId:'text-smoke'});
        app.updateCurrentResponse('Screen final',{requestId:'screen-smoke'});
        verify(app.responses.includes('Typed final') && app.responses.includes('Screen final'),'Concurrent response cards stay isolated');
        app.addNewResponse('<script>window.__unsafe=true</script><img src=x onerror="window.__unsafe=true"><svg onload="window.__unsafe=true"></svg><a href="javascript:alert(1)" onclick="alert(1)">unsafe</a><p><strong>Safe</strong></p>',{requestId:'sanitize-smoke'});
        app.currentResponseIndex=app.responses.length-1;await settle(app);await settle(assistant);
        const response=root.querySelector('#responseContainer');
        verify(!response.querySelector('script,img,svg,[onclick],[onerror],a[href^="javascript"]') && !window.__unsafe && response.querySelector('strong')?.textContent==='Safe','Rendered Markdown removes active HTML but preserves formatting');
    } finally { api.sendTextMessage=original;app.sessionActive=false; }

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
    await call('storage:delete-session',sessionId);
    verify((await ipc.invoke('storage:get-session','../escape')).success===false,'IPC rejects invalid session paths');
    app.navigate('main');await settle(app);
    const home=app.shadowRoot.querySelector('main-view'); await settle(home);
    await waitUntil(()=>home.shadowRoot.querySelector('.page-title')?.getBoundingClientRect().top>=40);
    verify(home.shadowRoot.querySelector('.page-title').getBoundingClientRect().top>=40,'Home heading is below the draggable caption');
    verify(getComputedStyle(app.shadowRoot.querySelector('.sidebar-nav')).overflowY==='auto','Sidebar navigation remains scrollable in short windows');
    for (const id of ['phase4-knowledge-nav','phase4-practice-nav','phase4-review-nav']) {
        await waitUntil(()=>app.shadowRoot.getElementById(id));
        app.shadowRoot.getElementById(id).click();
        await new Promise(resolve=>setTimeout(resolve,80));
        verify(Boolean(app.shadowRoot.querySelector('.phase4-overlay')),'Workspace opens: '+id);
        app.shadowRoot.querySelector('.phase4-close')?.click();
    }
    return checks;
}
module.exports={rendererBehaviorSmoke};
