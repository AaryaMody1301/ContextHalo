const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const fs = require('node:fs');
test('preload strips privileged events and removes only its registered callbacks', () => {
    const ipc = new EventEmitter();
    ipc.invoke = async () => ({success:true});
    ipc.send = () => {};
    const exposed = {};
    vm.runInNewContext(fs.readFileSync('preload.js','utf8'), {
        require: () => ({ ipcRenderer:ipc, contextBridge:{exposeInMainWorld:(name,value) => { exposed[name]=value; }} }),
        process:{platform:'win32',arch:'x64'},
    });
    const api = exposed.electronAPI;
    let calls = 0;
    const listener = (event, value) => { assert.equal(event, undefined); assert.equal(value, 'answer'); calls++; };
    api.on('new-response', listener);
    ipc.emit('new-response', { sender:ipc }, 'answer');
    assert.equal(calls,1);
    api.removeListener('new-response',listener);
    ipc.emit('new-response', { sender:ipc }, 'answer');
    assert.equal(calls,1);
    api.once('new-response',listener);
    ipc.emit('new-response', { sender:ipc }, 'answer');
    ipc.emit('new-response', { sender:ipc }, 'answer');
    assert.equal(calls,2);
    const internal = () => {};
    ipc.on('new-response',internal);
    api.on('new-response',listener);
    api.removeAllListeners('new-response');
    assert.deepEqual(ipc.listeners('new-response'),[internal]);
    assert.throws(() => api.on('secret-channel',listener), /not allowed/);
});
