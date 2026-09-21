const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
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

test('a Vulkan startup failure falls back once to the verified CPU runner without changing the selected model', async t => {
    const started = [], stopped = [], binaries = [], bodies = [];
    const native = {
        ensureNativeBinary: async (type, _progress, _signal, options) => {
            binaries.push([type, options]);
            return type === 'llama' ? options?.cpuOnly ? '/binaries/llama-b10964-cpu/llama-server.exe' : '/binaries/llama-b10964-vulkan/llama-server.exe' : '/whisper.exe';
        },
        ensureWhisperModel: async () => '/whisper', ensureLlamaModel: async () => ({ modelPath: '/model', projectorPath: '/projector' }),
        getAvailablePort: async () => 1234, getModelsDirectory: () => '/models',
        startNativeServer: options => { started.push(options); return options; },
        stopNativeServer: process => { if (process) stopped.push(process); },
        waitForServer: async (_url, process) => { if (process.executablePath.includes('vulkan')) throw new Error('GPU backend failed'); },
    };
    const api = loadMain('src/utils/localai.js', {
        fs: { existsSync: () => true, readdirSync: () => [] }, './native-ai-runtime': native, './sessionRequests': requests,
        './gemini': { sendToRenderer() {}, initializeNewSession: () => requests.resetSessionRequests(), saveConversationTurn() {} },
    }, { console: { log() {}, warn() {} }, fetch: async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        return new Response('data: {"choices":[{"delta":{"content":"Answer"}}]}\n\ndata: [DONE]\n\n');
    } });
    t.after(() => { requests.closeSessionRequests(); api.closeLocalSession(); });
    assert.equal(await api.initializeLocalSession('my-selected-model', 'tiny.en', 'interview', '', 'en-US'), true);
    assert.deepEqual(started.map(item => item.executablePath), ['/whisper.exe', '/binaries/llama-b10964-vulkan/llama-server.exe', '/binaries/llama-b10964-cpu/llama-server.exe']);
    assert.deepEqual(started[0].arguments, ['-m', '/whisper', '--host', '127.0.0.1', '--port', '1234']);
    assert.ok(started[1].arguments.includes('--alias') && started[1].arguments.includes('local'));
    assert.ok(started[1].arguments.includes('-m') && started[1].arguments.includes('/model'));
    assert.ok(started[1].arguments.includes('--mmproj') && started[1].arguments.includes('/projector'));
    assert.ok(started[1].arguments.includes('--cache-reuse') && started[1].arguments.includes('256'));
    assert.ok(started[2].arguments.includes('--cache-reuse') && started[2].arguments.includes('256'), 'official b10964 CPU fallback shares the audited CLI contract');
    assert.equal(stopped[0], started[1]);
    assert.equal(binaries[2][1].cpuOnly, true);
    const question = 'Preserve my leading instructions. ' + 'x'.repeat(10000);
    const result = await requests.runSessionRequest('text', () => api.sendLocalText(question));
    assert.equal(result.success, true);
    assert.equal(result.model, 'my-selected-model');
    assert.equal(bodies[0].messages.at(-1).content, question, 'a long current question must never be silently truncated');
    assert.equal(bodies[0].model, 'local');
    assert.equal(bodies[0].stream, true);
    assert.equal(bodies[0].max_tokens, 768);
    assert.equal(bodies[0].cache_prompt, true);
    assert.deepEqual(bodies[0].chat_template_kwargs, { enable_thinking: false });
});


test('fast local presets use a smaller native context and current Vulkan cache reuse', () => {
    const source = fs.readFileSync('src/utils/localai.js', 'utf8');
    assert.match(source, /LOCAL_FAST_CONTEXT_TOKENS = 4096/);
    assert.ok(source.includes('Qwen3\\.5-(?:0\\.8B|2B)-'));
    assert.match(source, /argumentsList\.push\('--cache-reuse', '256'\)/);
});
