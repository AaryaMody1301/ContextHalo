const test=require('node:test');
const assert=require('node:assert/strict');
const {appFixture,componentClass}=require('./helpers/component-fixture');
const turn=()=>new Promise(resolve=>setImmediate(resolve));

for (const mode of ['byok','groq','local']) test(`${mode}: preparation, capture-ready, active and end have one owner`,async()=>{
    const f=appFixture({mode}); const states=[];
    const original=f.app._setLifecycle;
    f.app._setLifecycle=function(state,message){states.push(state);return original.call(this,state,message);};
    const first=f.app.handleStart(); assert.equal(f.app.handleStart(),first);
    assert.equal((await first).success,true);
    assert.deepEqual(states,['preparing','connecting','preparing-capture','capture-ready','active']);
    assert.equal(f.app.isRecording,true); assert.equal(f.calls.filter(x=>x==='capture').length,1);
    f.app.sessionDraft='retained'; await f.app.endSession();
    assert.equal(f.app.isRecording,false); assert.equal(f.app.sessionActive,false); assert.equal(f.app.isInitializing,false);
    assert.equal(f.app.sessionDraft,'retained'); assert.equal(f.app._timerInterval,null);
});
test('failure then retry closes partial initialization without leaking the duplicate-start guard',async()=>{
    const f=appFixture({api:{startCapture:async()=>{throw new Error('Microphone denied');}}});
    assert.equal((await f.app.handleStart()).success,false);
    assert.match(f.app.startError,/Microphone denied/); assert.equal(f.app.isInitializing,false);
    assert.equal(f.calls.filter(x=>x==='close-session').length,1);
    f.api.startCapture=async()=>true;
    assert.equal((await f.app.handleStart()).success,true); await f.app.endSession();
});
test('end during pending initialization cannot activate the abandoned session',async()=>{
    let release; const f=appFixture({api:{initializeGemini:()=>new Promise(resolve=>{release=resolve;})}});
    const pending=f.app.handleStart(); await turn(); await f.app.endSession(); release(true);
    assert.equal((await pending).cancelled,true);
    assert.equal(f.calls.includes('capture'),false); assert.equal(f.app.sessionActive,false);
    assert.equal(f.app.lifecycleState,'idle');
});
test('capture/provider availability, not a Listening status string, determines recording state',async()=>{
    const f=appFixture(); await f.app.handleStart();
    f.app._captureChanged({state:'stopped',audioReady:false,screen:false}); f.app.setStatus('Listening...');
    assert.equal(f.app.isRecording,false); assert.doesNotMatch(f.app.statusText,/Listening/);
    assert.equal(f.app.lifecycleState,'capture-stopped');
    f.app.setProviderState({state:'reconnecting'}); assert.equal(f.app.isRecording,false);
    f.app._captureChanged({state:'ready',audioReady:true}); assert.equal(f.app.isRecording,false);
    f.app.setProviderState({state:'ready'}); assert.equal(f.app.isRecording,true);
    f.app.setProviderState({state:'failed',uiEpoch:f.app._uiSessionEpoch-1}); assert.equal(f.app.providerState,'ready');
    await f.app.endSession();
});
test('failed final save blocks next-session reset and can be retried without losing the draft',async()=>{
    let fail=false; const f=appFixture({globals:{flushSessionContext:async()=>{if(fail)throw Error('disk');}}});
    await f.app.handleStart(); f.app.sessionDraft='pending'; fail=true;
    assert.equal((await f.app.endSession()).success,false); assert.equal(f.app._unsavedSession,true);
    const calls=f.calls.filter(x=>x==='provider').length;
    assert.equal((await f.app.handleStart()).success,false); assert.equal(f.calls.filter(x=>x==='provider').length,calls);
    fail=false; assert.equal((await f.app.retrySave()).success,true); assert.equal(f.app._unsavedSession,false);
    assert.equal(f.app.sessionDraft,'pending'); await f.app.handleStart(); await f.app.endSession();
});
test('cleanup failure blocks starting another provider; retry clicks honor the cooldown',async()=>{
    const f=appFixture({ipc:async channel=>({success:channel!=='close-session'})});
    await f.app.handleStart(); await f.app.endSession();
    assert.equal((await f.app.handleStart()).success,false);
    const g=appFixture(); g.app.providerError={retryAt:Date.now()+60000,message:'Wait'};
    assert.equal((await g.app.handleStart()).success,false); assert.equal((await g.app.retryProvider()).success,false);
    assert.equal(g.calls.length,0);
});
test('model discovery leaves manual choices intact and late catalogs do not update detached forms',async()=>{
    const {Target,context}=componentClass('src/components/views/MainView.js','MainView');
    const view=Object.assign(Object.create(Target.prototype),{_geminiLiveModel:'manual-model',_catalogEpochs:{gemini:0},_keySavePromise:Promise.resolve(),isConnected:true,requestUpdate(){}});
    context.window.electronAPI.invoke=async()=>({success:true,data:{all:[{id:'different'}],live:[{id:'different'}],recommended:{live:'different'}}});
    await view._refreshProviderModels('gemini'); assert.equal(view._geminiLiveModel,'manual-model'); assert.match(view._geminiCatalogError,/preserved/);
    const catalog=view._geminiCatalog; view.isConnected=false; await view._refreshProviderModels('gemini'); assert.equal(view._geminiCatalog,catalog);
});
test('failed credential writes block Start until a newer value is securely saved',async()=>{
    const writes=[]; let fail=true;
    const {Target}=componentClass('src/components/views/MainView.js','MainView',{contextHalo:{storage:{setApiKey:async value=>{writes.push(value);return {success:!fail};}}}});
    let starts=0; const view=Object.assign(Object.create(Target.prototype),{_mode:'byok',_catalogEpochs:{gemini:0},_catalogTimers:{},_keySavePromise:Promise.resolve(),downloadProgress:{active:false},requestUpdate(){},onStart(){starts++;}});
    await view._saveGeminiKey('fixture'); await view._handleStart(); assert.equal(starts,0); assert.equal(view._geminiKey,'fixture');
    fail=false; await view._saveGeminiKey('retry'); await view._handleStart(); assert.equal(starts,1); assert.deepEqual(writes,['fixture','retry']);
});
