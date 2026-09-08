const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {EventEmitter}=require('node:events');
const {loadMain}=require('./helpers/native-boundary');

function rendererModule(file,names,storage,invoke=async()=>({success:true,data:{}})) {
    const ipc=new EventEmitter(); ipc.invoke=invoke;
    const window=Object.assign(new EventTarget(),{require:()=>({ipcRenderer:ipc})});
    class CustomEvent extends Event { constructor(type,init){super(type);this.detail=init?.detail;} }
    const text=fs.readFileSync(file,'utf8').replace(/^export \{.*\};\r?\n?/gm,'').replace(/^export /gm,'');
    const api=new Function('window','contextHalo','CustomEvent',text+'\nreturn {'+names.join(',')+'};')(window,{storage},CustomEvent);
    return {api,ipc,window};
}
test('transcripts and markers are retained after save failure and listeners have one owner',async()=>{
    const writes=[]; let fail=true;
    const storage={saveSession:async(id,value)=>{writes.push([id,value]);return {success:!fail};},getSession:async()=>({})};
    const f=rendererModule('src/utils/realtimeContextRenderer.js',['getRealtimeState','initRealtimeContext','flushSessionContext','addMarker'],storage);
    const dispose=f.api.initRealtimeContext(); f.ipc.emit('save-session-context',null,{sessionId:'one'});
    f.ipc.emit('live-transcript',null,{text:'A deterministic fixture, not a recording',provider:'gemini',final:true,timestamp:10});
    await f.api.addMarker('decision'); await assert.rejects(f.api.flushSessionContext(),/save/);
    assert.equal(f.api.getRealtimeState().transcriptEntries.length,1); assert.equal(f.api.getRealtimeState().markers.length,1);
    fail=false; await f.api.flushSessionContext(); assert.equal(writes.at(-1)[0],'one');
    f.ipc.emit('save-session-context',null,{sessionId:'two'}); await f.api.flushSessionContext();
    assert.equal(writes.at(-1)[0],'two'); assert.equal(writes.at(-1)[1].liveTranscript.length,0);
    assert.equal(writes[0][1].liveTranscript.length,1); dispose();
    assert.equal(f.ipc.listenerCount('live-transcript'),0); assert.equal(f.ipc.listenerCount('save-session-context'),0);
});
test('quick commands expand without mutating context; failed pack writes retain bounded edits',async()=>{
    let fail=true;const saves=[];
    const f=rendererModule('src/utils/contextCaptureRenderer.js',['loadContextState','setPackField','getContextState','saveSessionPack','expandQuickCommand','selectAndAnalyzeRegion'],{
        getPreferences:async()=>({sessionPack:{title:'Saved title'}}),updatePreference:async(key,value)=>{saves.push(value);return {success:!fail};}
    },async channel=>channel==='context-capture:select-region'?Promise.reject(Error('denied')):{success:true,data:{sources:[]}});
    await f.api.loadContextState();f.api.setPackField('notes','n'.repeat(7000));
    await assert.rejects(f.api.saveSessionPack(),/save/); assert.equal(f.api.getContextState().sessionPack.notes.length,6000);
    assert.match(f.api.expandQuickCommand('/shorter'),/previous answer/); assert.match(f.api.expandQuickCommand('/translate Hindi'),/Hindi/);
    assert.equal(f.api.expandQuickCommand('ordinary draft'),null); fail=false;await f.api.saveSessionPack();assert.equal(saves.at(-1).title,'Saved title');
    const assistant={isConnected:true}; const result=await f.api.selectAndAnalyzeRegion(assistant);
    assert.equal(result.success,false); assert.match(assistant.analysisError,/choose a different screen/);assert.equal(assistant.regionSelecting,false);
});
test('capture selection includes monitors/windows but never the app; untrusted frames cannot change it',async()=>{
    const handlers=new Map();let capture;const prefs={captureSource:{kind:'screen',displayId:'2',sourceId:'screen:2:0'}};
    const frame={};const window={webContents:{id:1,mainFrame:frame},isDestroyed:()=>false,getBounds:()=>({}),getMediaSourceId:()=> 'window:own:0'};
    const screens=[{id:'screen:1:0',display_id:'1',name:'Primary'},{id:'screen:2:0',display_id:'2',name:'Second'},{id:'window:editor:0',name:'Editor'},{id:'window:own:0',name:'ContextHalo'}];
    const f=loadMain('src/utils/contextCaptureMain.js',{
        electron:{desktopCapturer:{getSources:async()=>screens},screen:{getPrimaryDisplay:()=>({id:1}),getDisplayMatching:()=>({id:1})},session:{defaultSession:{setDisplayMediaRequestHandler(fn){capture=fn;}}}},
        '../storage':{getPreferences:()=>prefs,updatePreference:(key,value)=>{prefs[key]=value;}}
    },{process:{platform:'win32'}});
    f.setupContextCaptureMain(window,{handle:(key,fn)=>handlers.set(key,fn),removeHandler(){}});
    const list=await f.listCaptureSources(window);assert.equal(list.sources.some(s=>s.sourceId==='window:own:0'),false);assert.equal(list.sources.some(s=>s.sourceId==='window:editor:0'),true);
    assert.equal((await handlers.get('context-capture:set-source')({sender:{id:1},senderFrame:{}},{kind:'primary-display'})).success,false);
    const selected=await new Promise(resolve=>capture({},resolve));assert.equal(selected.video.id,'screen:2:0');assert.equal(selected.audio,'loopback');
});


test('rapid marker actions share the initial history read and never cross a session epoch', async () => {
    let release;
    let reads = 0;
    const f = rendererModule('src/utils/realtimeContextRenderer.js',
        ['getRealtimeState', 'initRealtimeContext', 'addMarker'], {
            getSession: async () => { reads++; return new Promise(resolve => { release = resolve; }); },
            saveSession: async () => ({ success: true }),
        }, async () => ({ success: true, data: { sessionId: 'one' } }));
    const dispose = f.api.initRealtimeContext();
    const first = f.api.addMarker('decision');
    const second = f.api.addMarker('important');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 1);
    release({ markers: [{ type: 'action', timestamp: 1, transcript: 'Stored fixture' }] });
    await Promise.all([first, second]);
    assert.deepEqual(f.api.getRealtimeState().markers.map(marker => marker.type), ['action', 'decision', 'important']);
    f.ipc.emit('save-session-context', null, {});
    const late = f.api.addMarker('question');
    await new Promise(resolve => setImmediate(resolve));
    f.ipc.emit('save-session-context', null, { sessionId: 'two' });
    release({ markers: [{ type: 'important', timestamp: 2, transcript: 'Old fixture' }] });
    await late;
    assert.equal(f.api.getRealtimeState().markers.length, 0);
    dispose();
});

test('missing explicitly selected monitor or window denies capture rather than sharing a different screen', async () => {
    let capture;
    const preferences = { captureSource: { kind: 'window', sourceId: 'window:closed:0' } };
    const mainWindow = { webContents: { id: 1, mainFrame: {} }, isDestroyed: () => false, getBounds: () => ({}) };
    const f = loadMain('src/utils/contextCaptureMain.js', {
        electron: {
            desktopCapturer: { getSources: async () => [{ id: 'screen:1:0', display_id: '1', name: 'Primary' }] },
            screen: { getPrimaryDisplay: () => ({ id: 1 }), getDisplayMatching: () => ({ id: 1 }) },
            session: { defaultSession: { setDisplayMediaRequestHandler(fn) { capture = fn; } } },
        },
        '../storage': { getPreferences: () => preferences },
    }, { process: { platform: 'win32' } });
    f.setupContextCaptureMain(mainWindow, { handle() {}, removeHandler() {} });
    for (const selection of [{ kind: 'window', sourceId: 'window:closed:0' }, { kind: 'screen', displayId: '2' }]) {
        preferences.captureSource = selection;
        const result = await new Promise(resolve => capture({}, resolve));
        assert.deepEqual(result, {});
        assert.deepEqual(preferences.captureSource, selection);
    }
});
