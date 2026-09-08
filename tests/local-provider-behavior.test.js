const test=require('node:test');
const assert=require('node:assert/strict');
const {loadMain}=require('./helpers/native-boundary');
const requests=require('../src/utils/sessionRequests');

test('Local AI text and vision use successful history only and forward cancellation',async()=>{
    const bodies=[],turns=[],stopped=[];let status=200;
    const native={ensureNativeBinary:async()=>'/runner',ensureWhisperModel:async()=>'/whisper',ensureLlamaModel:async()=>({modelPath:'/model',projectorPath:'/projector'}),getAvailablePort:async()=>1234,getModelsDirectory:()=>'/models',startNativeServer:()=>({}),stopNativeServer:p=>{if(p)stopped.push(p);},waitForServer:async()=>{}};
    const api=loadMain('src/utils/localai.js',{
        fs:{existsSync:()=>true,readdirSync:()=>[]},'./native-ai-runtime':native,'./sessionRequests':requests,
        './gemini':{sendToRenderer(){},initializeNewSession:()=>requests.resetSessionRequests(),saveConversationTurn:(question,answer)=>turns.push([question,answer])}
    },{console:{log(){},warn(){}},fetch:async(_url,init)=>{assert.ok(init.signal);bodies.push(JSON.parse(init.body));return new Response(status===200?'data: {"choices":[{"delta":{"content":"Local answer"}}]}\n\ndata: [DONE]\n\n':'private response body',{status});}});
    assert.equal(await api.initializeLocalSession('existing-model','tiny.en','interview','','en-US'),true);
    const run=fn=>requests.runSessionRequest('text',fn);
    const first=await run(()=>api.sendLocalText('first'));assert.equal(first.text,'Local answer');
    status=500;assert.equal((await run(()=>api.sendLocalText('failed'))).success,false);
    status=200;assert.equal((await requests.runSessionRequest('screen',()=>api.sendLocalImage('aW1hZ2U=','screen question'))).success,true);
    assert.equal(turns.length,2);assert.equal(JSON.stringify(bodies.at(-1)).includes('failed'),false);assert.equal(JSON.stringify(bodies.at(-1)).includes('first'),true);
    requests.closeSessionRequests();api.closeLocalSession();assert.equal(api.isLocalSessionActive(),false);assert.equal(stopped.length,2);
});
