const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMain } = require('./helpers/native-boundary');

function fixture(t) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-privacy-fixture-'));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    let failurePath = null;
    const storage = loadMain('src/storage.js', {
        os: { platform: () => 'linux', homedir: () => home },
        fs: { ...fs, promises: { ...fs.promises, rm: async (target, options) => {
            if (target === failurePath) throw Object.assign(new Error('Fixture permission failure'), { code: 'EACCES' });
            return fs.promises.rm(target, options);
        } } },
    });
    storage.initializeStorage();
    const writeFixture = (relative, value) => {
        const file = path.join(storage.getConfigDir(), relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, value);
        return file;
    };
    const files = () => ({
        model: writeFixture('models/llama/fixture.gguf', Buffer.alloc(1024)),
        runner: writeFixture('binaries/llama/fixture.exe', Buffer.alloc(1024)),
        knowledge: writeFixture('knowledge/docs/fixture.json', '{}'),
        transcript: writeFixture('history/100.json', '{}'),
        practice: writeFixture('practice/attempts.json', '{}'),
        log: writeFixture('logs/fixture.jsonl', '{}'),
        settings: path.join(storage.getConfigDir(), 'preferences.json'),
        credentials: path.join(storage.getConfigDir(), 'credentials.json'),
    });
    return { home, storage, files, failRemoval: file => { failurePath = file; } };
}

test('scoped data deletion requires trusted confirmation and only erases the selected files', { timeout: 5000 }, async t => {
    const { home, storage, files } = fixture(t);
    const outsideProfile = path.join(home, 'unrelated.txt');
    fs.writeFileSync(outsideProfile, 'outside fixture');
    const browserFile = path.join(storage.getConfigDir(), 'Preferences');
    fs.writeFileSync(browserFile, 'Chromium fixture');
    const abandonedWrite = path.join(storage.getConfigDir(), 'credentials.json.00000000-0000-0000-0000-000000000000.tmp');
    fs.writeFileSync(abandonedWrite, 'old atomic-write fixture');
    const all = files();
    await storage.setApiKey('fixture-credential');
    const dialogs = [];
    let reply;
    const window = {};
    const { createDataDeletionController } = loadMain('src/utils/dataDeletionMain.js', {
        '../storage': storage,
        electron: { dialog: { showMessageBox: (owner, options) => {
            assert.equal(owner, window);
            dialogs.push(options);
            return new Promise(resolve => { reply = response => resolve({ response }); });
        } } },
    });
    const events = [];
    const create = () => createDataDeletionController({
        getWindow: () => window,
        stopActivity: async scope => { events.push(scope); },
        quit: () => { events.push('quit'); },
    });
    let controller = create();
    const trusted = () => true;
    assert.equal((await controller.request('personal', () => false)).success, false);
    assert.equal((await controller.request('../', trusted)).success, false);
    assert.equal(dialogs.length, 0);
    const cancel = controller.request('personal', trusted);
    assert.deepEqual(await controller.request('personal', trusted), { success: true, cancelled: true });
    assert.equal(dialogs[0].defaultId, 0);
    assert.equal(dialogs[0].cancelId, 0);
    assert.equal(dialogs[0].buttons[0], 'Cancel');
    reply(0);
    assert.deepEqual(await cancel, { success: true, cancelled: true });
    assert.equal(Object.values(all).every(file => fs.existsSync(file)), true);
    assert.deepEqual(events, []);

    let sameFrame = true;
    const navigated = controller.request('personal', () => sameFrame);
    sameFrame = false;
    reply(1);
    assert.equal((await navigated).cancelled, true);
    assert.equal(fs.existsSync(all.transcript), true);

    const downloads = controller.request('downloads', trusted);
    while (dialogs.length < 3) await new Promise(resolve => setImmediate(resolve));
    assert.match(dialogs[2].detail, /2.0 KiB/);
    reply(1);
    assert.equal((await downloads).success, true);
    assert.equal(fs.existsSync(all.runner) || fs.existsSync(all.model), false);
    assert.equal(fs.existsSync(all.transcript) && fs.existsSync(all.knowledge), true);
    assert.equal(fs.existsSync(abandonedWrite), true);
    assert.equal(storage.getApiKey(), 'fixture-credential');

    files();
    controller = create();
    const personal = controller.request('personal', trusted);
    reply(1);
    assert.equal((await personal).success, true);
    assert.equal(fs.existsSync(all.runner) && fs.existsSync(all.model), true);
    for (const name of ['knowledge', 'transcript', 'practice', 'log', 'settings', 'credentials']) {
        assert.equal(fs.existsSync(all[name]), false, name);
    }
    assert.equal(fs.existsSync(abandonedWrite), false);
    assert.equal(storage.getApiKey(), '');

    files();
    controller = create();
    const full = controller.request('all', trusted);
    reply(1);
    assert.equal((await full).success, true);
    assert.equal(Object.values(all).some(file => fs.existsSync(file)), false);
    assert.equal(fs.readFileSync(browserFile, 'utf8'), 'Chromium fixture');
    assert.equal(fs.readFileSync(outsideProfile, 'utf8'), 'outside fixture');
    assert.deepEqual(events, ['downloads', 'quit', 'personal', 'quit', 'all', 'quit']);
});

test('emergency erase waits for shutdown, reports a partial failure, and retries before quitting', async t => {
    const { storage, files, failRemoval } = fixture(t);
    const all = files();
    const { createDataDeletionController } = loadMain('src/utils/dataDeletionMain.js', { '../storage': storage });
    let stop;
    let quits = 0;
    let failStop = true;
    const controller = createDataDeletionController({
        stopActivity: async () => {
            if (failStop) throw new Error('Fixture activity did not stop');
            await new Promise(resolve => { stop = resolve; });
        },
        quit: () => { quits++; assert.equal(fs.existsSync(all.transcript), false); },
    });
    assert.equal((await controller.emergencyErase()).success, false);
    assert.equal(fs.existsSync(all.transcript), true);
    failStop = false;
    failRemoval(path.dirname(all.transcript));
    const initial = controller.emergencyErase();
    await Promise.resolve();
    assert.equal(controller.blocksQuit(), true);
    assert.equal(quits, 0);
    assert.equal(fs.existsSync(all.knowledge), true);
    assert.equal(storage.updatePreference('customPrompt', 'late write'), false);
    stop();
    const partial = await initial;
    assert.equal(partial.success, false);
    assert.match(partial.error, /retry/i);
    assert.equal(quits, 0);
    assert.equal(fs.existsSync(all.transcript), true);
    assert.equal(fs.existsSync(all.model), true);
    assert.equal(controller.blocksQuit(), false);
    failRemoval(null);
    const retry = controller.emergencyErase();
    await Promise.resolve();
    stop();
    assert.equal((await retry).success, true);
    assert.equal(quits, 1);
    assert.equal(controller.blocksQuit(), false);
});

test('transport diagnostic files close before erase and only retain permitted metadata', async t => {
    const { storage } = fixture(t);
    const logger = loadMain('src/utils/transportLogger.js', { '../storage': storage }, {
        process: { env: { CONTEXTHALO_DIAGNOSTICS: '1' } },
    });
    logger.startTransportLog('123');
    logger.logTransportEvent('provider.response', {
        provider: 'gemini', model: 'fixture', durationMs: 42, transcript: 'private transcript',
        prompt: 'private prompt', credential: 'private credential', image: 'private image',
    });
    await logger.closeTransportLog();
    const output = fs.readFileSync(path.join(storage.getConfigDir(), 'logs', '123.jsonl'), 'utf8');
    assert.doesNotMatch(output, /private/);
    assert.deepEqual(JSON.parse(output.trim().split('\n').at(-1)).data, { provider: 'gemini', model: 'fixture', durationMs: 42 });
});
