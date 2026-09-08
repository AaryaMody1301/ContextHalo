const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { componentClass } = require('./helpers/component-fixture');
const tick = () => new Promise(resolve => setImmediate(resolve));

function storageFixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-halo-ui-history-'));
    const homedir = os.homedir;
    os.homedir = () => root;
    const filename = require.resolve('../src/storage'); delete require.cache[filename];
    const storage = require(filename); storage.initializeStorage();
    const history = path.join(storage.getConfigDir(), 'history');
    fs.mkdirSync(history, { recursive: true });
    t.after(() => { os.homedir = homedir; delete require.cache[filename]; fs.rmSync(root, { recursive: true, force: true }); });
    return { storage, history };
}

test('history metadata includes named, duplicate, non-English and legacy sessions without transcripts', t => {
    const { storage } = storageFixture(t);
    for (const [id, title] of [['101', 'Platform interview'], ['102', 'Platform interview'], ['103', '\u65e5\u672c\u8a9e \u9762\u63a5'], ['104', '']]) {
        assert.equal(storage.saveSession(id, { profile: 'meeting', sessionPack: { title }, conversationHistory: [{ transcription: 'private transcript' }] }), true);
    }
    const all = storage.getAllSessions(); assert.equal(all.length, 4);
    assert.equal(all.filter(item => item.title === 'Platform interview').length, 2);
    assert.equal(all.find(item => item.sessionId === '103').title, '\u65e5\u672c\u8a9e \u9762\u63a5');
    assert.equal(all.find(item => item.sessionId === '104').title, '');
    assert.doesNotMatch(JSON.stringify(all), /private transcript|conversationHistory/);
    let reads = 0; const readFile = fs.readFileSync;
    fs.readFileSync = function(file, ...args) { if (String(file).includes('history')) reads++; return readFile.call(this, file, ...args); };
    try { storage.getAllSessions(); storage.getAllSessions(); assert.equal(reads, 0, 'unchanged files use cached metadata'); }
    finally { fs.readFileSync = readFile; }
    storage.saveSession('101', { sessionPack: { title: 'Updated title' } });
    assert.equal(storage.getAllSessions().find(item => item.sessionId === '101').title, 'Updated title');
});

test('empty history, directory failure and unreadable entries are distinct; corrupt data is not overwritten', t => {
    const { storage, history } = storageFixture(t);
    assert.deepEqual(storage.getAllSessions(), []);
    const readdir = fs.readdirSync;
    fs.readdirSync = function(directory, ...args) { if (directory === history) throw Object.assign(new Error('private filesystem path'), { code: 'EACCES' }); return readdir.call(this, directory, ...args); };
    try { assert.throws(() => storage.getAllSessions(), error => error.code === 'HISTORY_UNAVAILABLE' && !error.message.includes('private filesystem path')); }
    finally { fs.readdirSync = readdir; }
    fs.writeFileSync(path.join(history, '201.json'), '{ broken data');
    const list = storage.getAllSessions(); assert.equal(list.length, 1); assert.equal(list[0].unreadable, true);
    assert.throws(() => storage.getSession('201'), error => error.code === 'SESSION_UNREADABLE');
    assert.throws(() => storage.saveSession('201', { sessionPack: { title: 'Do not overwrite' } }));
    assert.equal(fs.readFileSync(path.join(history, '201.json'), 'utf8'), '{ broken data');
    assert.equal(storage.getSession('202'), null);
});

function historyView(storage) {
    const { Target } = componentClass('src/components/views/HistoryView.js', 'HistoryView', { unifiedPageStyles: [], contextHalo: { storage } });
    return new Target();
}

test('history retains the last successful list on transient failure and retry replaces it', async () => {
    let fail = false;
    const view = historyView({ getAllSessions: async () => { if (fail) throw Error('disk'); return [{ sessionId: '1', title: 'Saved session' }]; } });
    await tick(); const before = view.sessions;
    fail = true; assert.equal(await view.loadSessions(), false); assert.equal(view.sessions, before); assert.match(view.loadError, /retry/i);
    assert.doesNotMatch(view.renderListView(), /Your saved sessions will appear|No sessions match/);
    fail = false; assert.equal(await view.loadSessions(), true); assert.equal(view.loadError, '');
});

test('empty and filtered-empty copy is specific; saved titles are searchable with legacy fallbacks', async () => {
    const view = historyView({ getAllSessions: async () => [] }); await tick();
    assert.match(view.renderListView(), /first session/);
    view.sessions = [
        { sessionId: '1', title: 'Architecture Review', profile: 'meeting', createdAt: 1000 },
        { sessionId: '2', title: 'Architecture Review', profile: 'meeting', createdAt: 2000 },
        { sessionId: '3', title: '\u65e5\u672c\u8a9e', createdAt: 3000 },
        { sessionId: '4', title: '', profile: 'interview', createdAt: 4000 },
    ];
    view.searchQuery = 'architecture'; assert.equal(view.getFilteredSessions().length, 2);
    view.searchQuery = '\u65e5\u672c'; assert.equal(view.getFilteredSessions()[0].sessionId, '3');
    view.searchQuery = 'absent'; assert.equal(view.getFilteredSessions().length, 0); assert.match(view.renderListView(), /No sessions match "absent"/);
    assert.match(view.getSessionTitle(view.sessions[3]), /Interview.*1970/);
});

test('failed or missing detail loads explain only that entry, and a retry can open it', async () => {
    let fail = true;
    const view = historyView({ getAllSessions: async () => [{ sessionId: '1' }], getSession: async () => fail ? null : { sessionId: '1', profile: 'meeting' } });
    await tick(); assert.equal(await view.openSession('1'), false); assert.equal(view.sessions.length, 1);
    assert.match(view.detailError, /Other history is unchanged/); assert.equal(view.selectedSession, null);
    fail = false; assert.equal(await view.openSession('1'), true); assert.equal(view.selectedSessionId, '1'); assert.equal(view.detailError, '');
});

test('late history/detail loads cannot replace a newer selection or detached view', async () => {
    let release;
    const view = historyView({ getAllSessions: async () => [], getSession: id => id === 'old' ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ sessionId: id }) });
    await tick(); const old = view.openSession('old'); await view.openSession('new'); release({ sessionId: 'old' });
    assert.equal(await old, false); assert.equal(view.selectedSessionId, 'new');
});
