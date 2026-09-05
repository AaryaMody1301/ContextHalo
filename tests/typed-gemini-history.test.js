const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');
const lifecycle = require('../src/utils/sessionRequests');
function fixture() {
    const handlers = new Map();
    const events = [];
    const generated = [];
    const realtime = [];
    let callbacks;
    const frame = {};
    const webContents = {id:1,mainFrame:frame,getURL:()=>'file:///app/src/index.html',send:(...args)=>events.push(args)};
    const storage = {
        getConfig:()=>({geminiLiveModel:'gemini-3.1-flash-live-preview',groqModel:'test-chat'}),
        getPreferences:()=>({googleSearchEnabled:false}), getAvailableModel:()=> 'chosen-text-model',
        getApiKey:()=> 'test-key', getGroqApiKey:()=> 'groq-test-key',
        incrementLimitCount:()=>{},incrementCharUsage:()=>{},
        getSession:()=>({liveTranscript:[{text:'We discussed data pipelines'}]}),
    };
    class AI {
        models = {generateContent:async params => { generated.push(params); return {text:'The answer'}; }};
        live = { connect:async params => { callbacks=params.callbacks; return {close:()=>{},sendRealtimeInput:data=>realtime.push(data)}; }};
    }
    const filename=path.resolve('src/utils/gemini.js');
    const requireActual=createRequire(filename);
    const scope={module:{exports:{}}, console:{log(){},warn(){},error(){}}, process, Buffer, URL, AbortController,
        setTimeout, clearTimeout, global:{}, fetch:async()=>new Response('data:{"choices":[{"delta":{"content":"Groq answer"}}]}\n\n'),
        require:name=>{
            if(name==='electron') return {BrowserWindow:{getAllWindows:()=>[{isDestroyed:()=>false,webContents}]},ipcMain:{handle:(key,fn)=>handlers.set(key,fn)}};
            if(name==='@google/genai') return {GoogleGenAI:AI,Modality:{AUDIO:'AUDIO'}};
            if(name==='../storage') return storage;
            if(name==='./providerModelRegistry') return {listProviderModels:async()=>({live:[{id:'gemini-3.1-flash-live-preview'}]})};
            if(name==='./transportLogger') return {startTransportLog(){},logTransportEvent(){},closeTransportLog(){}};
            if(name==='./sessionPackMain') return {appendSessionPack:text=>text};
            return requireActual(name);
        },
    };
    vm.runInNewContext(fs.readFileSync(filename,'utf8'),scope,{filename});
    scope.module.exports.setupGeminiIpcHandlers({current:null});
    const event={sender:webContents,senderFrame:frame};
    return {handlers,events,generated,realtime,event,get callbacks(){return callbacks;}};
}
test('typed Gemini uses selected HTTP model and session context without muting live audio', async () => {
    const f=fixture();
    const start=await f.handlers.get('initialize-gemini')(f.event,'test-key','','meeting','en-US','byok');
    assert.equal(start.success,true);
    const result=await f.handlers.get('send-text-message')(f.event,'What did we discuss?');
    assert.equal(result.success,true);
    assert.equal(f.generated[0].model,'chosen-text-model');
    assert.match(f.generated[0].config.systemInstruction,/data pipelines/);
    assert.equal(f.realtime.length,0);
    assert.ok(f.events.some(([channel,payload])=>channel==='save-conversation-turn' && payload.turn.transcription==='What did we discuss?'));
    assert.ok(f.events.some(([channel,,metadata])=>channel==='new-response' && metadata.kind==='text'));
    lifecycle.closeSessionRequests();
});
test('Live saves final transcription only at turn completion and does not concatenate duplicate text modalities', async () => {
    const f=fixture();
    await f.handlers.get('initialize-gemini')(f.event,'test-key','','meeting','en-US','byok');
    f.callbacks.onmessage({serverContent:{inputTranscription:{text:'Question'},modelTurn:{parts:[{text:'Answer'}]},outputTranscription:{text:'Answer'},generationComplete:true}});
    assert.equal(f.events.filter(([channel])=>channel==='save-conversation-turn').length,0);
    f.callbacks.onmessage({serverContent:{outputTranscription:{text:' done'},turnComplete:true}});
    const saved=f.events.filter(([channel])=>channel==='save-conversation-turn');
    assert.equal(saved.length,1);
    assert.equal(saved[0][1].turn.ai_response,'Answer done');
    await f.handlers.get('close-session')(f.event);
    const count=f.events.length;
    f.callbacks.onmessage({serverContent:{modelTurn:{parts:[{text:'late'}]}}});
    assert.equal(f.events.length,count);
});
test('provider IPC rejects foreign frames and oversized typed requests', async () => {
    const f=fixture();
    const denied=await f.handlers.get('send-text-message')({...f.event,senderFrame:{}},'Hello');
    assert.equal(denied.success,false);
    const oversized=await f.handlers.get('send-text-message')(f.event,'x'.repeat(32001));
    assert.equal(oversized.success,false);
    assert.equal(f.generated.length,0);
});
