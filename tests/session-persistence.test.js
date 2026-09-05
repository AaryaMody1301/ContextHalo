const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
test('atomic session updates preserve transcript, markers, pack and allow explicit clearing', t => {
    const home=fs.mkdtempSync(path.join(os.tmpdir(),'halo-persistence-'));
    const original=os.homedir; os.homedir=()=>home;
    const modulePath=require.resolve('../src/storage'); delete require.cache[modulePath];
    const storage=require(modulePath);
    t.after(()=>{os.homedir=original;delete require.cache[modulePath];fs.rmSync(home,{recursive:true,force:true});});
    storage.initializeStorage();
    storage.saveSession('123',{profile:'meeting',customPrompt:'old',liveTranscript:[{text:'hello',provider:'gemini',timestamp:1}],markers:[{type:'decision',timestamp:2}],sessionPack:{title:'Test'}});
    storage.saveSession('123',{conversationHistory:[{transcription:'question',ai_response:'answer'}]});
    let data=storage.getSession('123');
    assert.equal(data.liveTranscript[0].text,'hello'); assert.equal(data.markers[0].type,'decision');
    assert.equal(data.sessionPack.title,'Test');
    storage.saveSession('123',{customPrompt:'',liveTranscript:[]});
    data=storage.getSession('123'); assert.equal(data.customPrompt,'');assert.equal(data.liveTranscript.length,0);
    assert.throws(()=>storage.saveSession('../escape',{}),/Invalid session/);
    assert.equal(fs.readdirSync(path.join(storage.getConfigDir(),'history')).some(file=>file.endsWith('.tmp')),false);
    const rename=fs.renameSync;fs.renameSync=()=>{throw new Error('disk failure');};
    try {assert.equal(storage.saveSession('123',{customPrompt:'lost'}),false);} finally {fs.renameSync=rename;}
    assert.equal(storage.getSession('123').customPrompt,'');
});
