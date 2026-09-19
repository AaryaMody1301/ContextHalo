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


test('Local AI bounds repeated prompt work and output for interactive latency', async () => {
    const bodies=[];
    const native={ensureNativeBinary:async()=>'/runner',ensureWhisperModel:async()=>'/whisper',ensureLlamaModel:async()=>({modelPath:'/model',projectorPath:'/projector'}),getAvailablePort:async()=>1234,getModelsDirectory:()=>'/models',startNativeServer:()=>({}),stopNativeServer(){},waitForServer:async()=>{}};
    const api=loadMain('src/utils/localai.js',{
        fs:{existsSync:()=>true,readdirSync:()=>[]},'./native-ai-runtime':native,'./sessionRequests':requests,
        './gemini':{sendToRenderer(){},initializeNewSession:()=>requests.resetSessionRequests(),saveConversationTurn(){}}
    },{console:{log(){},warn(){}},fetch:async(_url,init)=>{bodies.push(JSON.parse(init.body));return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',{status:200});}});
    assert.equal(await api.initializeLocalSession('existing-model','tiny.en','interview','','en-US'),true);
    for (let index=0; index<12; index++) {
        const result=await requests.runSessionRequest('text',()=>api.sendLocalText('question-'+index+' '+('x'.repeat(1200))));
        assert.equal(result.success,true);
    }
    const last=bodies.at(-1);
    assert.equal(last.max_tokens,768);
    assert.equal(last.cache_prompt,true);
    assert.ok(last.messages.length<=10, 'system plus bounded history stays small');
    assert.ok(JSON.stringify(last.messages).length<14000, 'prompt history remains bounded');
    requests.closeSessionRequests();api.closeLocalSession();
});
