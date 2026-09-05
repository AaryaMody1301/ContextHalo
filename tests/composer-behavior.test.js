const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function loadClass(file, name) {
    const source = fs.readFileSync(file, 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export class ', 'class ');
    const context = { LitElement: class {}, html: () => '', css: () => '', customElements: { define() {} }, window: {}, console };
    vm.runInNewContext(source + `\nthis.Target = ${name};`, context);
    return context.Target;
}
const Assistant = loadClass('src/components/views/AssistantView.js', 'AssistantView');
function composer(onSendText) {
    const input = { value: '  question  ', focus() {} };
    const view = Object.assign(Object.create(Assistant.prototype), {
        shadowRoot: { querySelector: () => input }, onSendText, sending: false, sendError: '', draft: '',
    });
    return { view, input };
}
test('failed sends retain the draft and surface the provider error', async () => {
    const {view,input} = composer(async () => ({success:false,error:'Quota exceeded'}));
    assert.equal((await view.handleSendText()).success,false);
    assert.equal(input.value,'  question  ');
    assert.equal(view.sendError,'Quota exceeded');
    assert.equal(view.sending,false);
});
test('successful sends clear only the submitted draft, never newly typed input', async () => {
    let resolve;
    const {view,input} = composer(() => new Promise(done => {resolve=done;}));
    const pending=view.handleSendText();
    assert.equal(view.sending,true);
    assert.equal((await view.handleSendText()).success,false);
    input.value='next question'; view.draft=input.value;
    resolve({success:true}); await pending;
    assert.equal(input.value,'next question');
    const next=await Object.assign(view,{onSendText:async()=>({success:true})}).handleSendText();
    assert.equal(next.success,true); assert.equal(view.draft,''); assert.equal(input.value,'');
});
test('composition, newline, and shortcut Enter do not accidentally send', () => {
    let sent=0; let prevented=0;
    const view=Object.assign(Object.create(Assistant.prototype),{handleSendText:()=>{sent++;}});
    const event={key:'Enter',preventDefault:()=>{prevented++;}};
    for (const extra of [{isComposing:true},{keyCode:229},{shiftKey:true},{ctrlKey:true},{metaKey:true},{altKey:true}]) view.handleTextKeydown({...event,...extra});
    assert.equal(sent,0); assert.equal(prevented,0);
    view.handleTextKeydown(event); assert.equal(sent,1); assert.equal(prevented,1);
});
test('interleaved response streams update their own cards and preserve navigation', () => {
    const App=loadClass('src/components/app/ContextHaloApp.js','ContextHaloApp');
    const app=Object.assign(Object.create(App.prototype),{responses:[],_responseIds:[],_responseRequestIndex:new Map(),currentResponseIndex:-1,requestUpdate(){}});
    app.addNewResponse('typed',{requestId:'t'}); app.addNewResponse('voice',{requestId:'v'});
    app.currentResponseIndex=0;
    app.updateCurrentResponse('typed final',{requestId:'t'}); app.updateCurrentResponse('voice final',{requestId:'v'});
    assert.deepEqual(Array.from(app.responses),['typed final','voice final']);
    assert.equal(app.currentResponseIndex,0);
    app.updateCurrentResponse('screen',{requestId:'s'}); assert.equal(app.responses.length,3);
});
