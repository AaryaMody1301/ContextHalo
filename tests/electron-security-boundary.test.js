const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMain } = require('./helpers/native-boundary');
const { normalizeExternalUrl } = require('../src/utils/electronSecurity');

function read(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('main-window IPC and permissions reject child frames and unrelated documents', () => {
    const windowModule = loadMain('src/utils/window.js', {
        electron: {},
        '../storage': {},
        './windowModeController': {},
    });
    const { isTrustedEvent, isTrustedMainFramePermission, MAIN_PAGE_URL } = windowModule._test;

    const mainFrame = {};
    const webContents = { id: 7, mainFrame, getURL: () => MAIN_PAGE_URL };
    const mainWindow = { isDestroyed: () => false, webContents };

    assert.equal(isTrustedEvent({ sender: webContents, senderFrame: mainFrame }, mainWindow), true);
    assert.equal(isTrustedEvent({ sender: webContents, senderFrame: {} }, mainWindow), false);
    assert.equal(isTrustedEvent({ sender: { id: 8 }, senderFrame: mainFrame }, mainWindow), false);

    const details = { isMainFrame: true, requestingUrl: MAIN_PAGE_URL };
    assert.equal(isTrustedMainFramePermission(webContents, mainWindow, 'media', details, 'null'), true);
    assert.equal(isTrustedMainFramePermission(webContents, mainWindow, 'display-capture', details, 'file://'), true);
    assert.equal(isTrustedMainFramePermission(webContents, mainWindow, 'geolocation', details, 'null'), false);
    assert.equal(isTrustedMainFramePermission(webContents, mainWindow, 'media', { ...details, isMainFrame: false }, 'null'), false);
    assert.equal(isTrustedMainFramePermission(webContents, mainWindow, 'media',
        { ...details, requestingUrl: 'https://example.invalid/' }, 'null'), false);
    assert.equal(isTrustedMainFramePermission(webContents, mainWindow, 'media', details, 'https://example.invalid'), false);
    assert.equal(isTrustedMainFramePermission(null, mainWindow, 'media', details, 'null'), false);
});

test('region selector and display capture accept only their expected main frame', () => {
    const capture = loadMain('src/utils/contextCaptureMain.js', {
        electron: {},
        '../storage': {},
    });
    const frame = {};
    const selector = { isDestroyed: () => false, webContents: { mainFrame: frame } };
    const mainWindow = { isDestroyed: () => false, webContents: { mainFrame: frame } };

    assert.equal(capture.isTrustedSelectorEvent({ senderFrame: frame }, selector), true);
    assert.equal(capture.isTrustedSelectorEvent({ senderFrame: {} }, selector), false);
    assert.equal(capture.isTrustedSelectorEvent({}, selector), false);

    assert.equal(capture.isTrustedDisplayMediaRequest({ frame }, mainWindow), true);
    assert.equal(capture.isTrustedDisplayMediaRequest({ frame: {} }, mainWindow), false);
    assert.equal(capture.isTrustedDisplayMediaRequest({}, mainWindow), false);
});

test('external URL boundary allows only credential-free HTTP(S) links', () => {
    assert.equal(normalizeExternalUrl('https://example.com/path?q=1'), 'https://example.com/path?q=1');
    assert.equal(normalizeExternalUrl('http://example.com/'), 'http://example.com/');
    for (const value of [
        'javascript:alert(1)',
        'file:///C:/Windows/System32/drivers/etc/hosts',
        'data:text/html,hello',
        'mailto:test@example.com',
        'https://user:secret@example.com/',
        'not a url',
        'https://' + 'a'.repeat(5000) + '.example/',
    ]) assert.equal(normalizeExternalUrl(value), null, value);
});

test('renderer windows retain sandbox, isolation, web security, popup denial and restrictive CSP', () => {
    const main = read('src/utils/window.js');
    const selector = read('src/utils/contextCaptureMain.js');
    const html = read('src/index.html');
    const selectorHtml = read('src/region-selector.html');

    for (const source of [main, selector]) {
        assert.match(source, /nodeIntegration:\s*false/);
        assert.match(source, /contextIsolation:\s*true/);
        assert.match(source, /sandbox:\s*true/);
        assert.match(source, /webSecurity:\s*true/);
        assert.match(source, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
        assert.match(source, /will-navigate/);
    }
    assert.match(main, /allowRunningInsecureContent:\s*false/);
    assert.doesNotMatch(main, /nodeIntegration:\s*true|contextIsolation:\s*false|sandbox:\s*false|webSecurity:\s*false/);
    assert.doesNotMatch(selector, /nodeIntegration:\s*true|contextIsolation:\s*false|sandbox:\s*false|webSecurity:\s*false/);

    for (const source of [main, html]) {
        assert.match(source, /frame-src 'self'/);
        assert.doesNotMatch(source, /forms\.gle|docs\.google\.com/);
        assert.match(source, /object-src 'none'/);
        assert.match(source, /base-uri 'none'/);
        assert.match(source, /form-action 'none'/);
    }
    assert.match(selectorHtml, /default-src 'self'/);
    assert.match(selectorHtml, /img-src 'none'/);
});

test('packaged Electron fuses disable Node injection and require ASAR integrity', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.deepEqual(pkg.build.electronFuses, {
        runAsNode: false,
        enableCookieEncryption: true,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: false,
        enableEmbeddedAsarIntegrityValidation: true,
        onlyLoadAppFromAsar: true,
    });
    assert.match(read('src/utils/window.js'), /loadFile\(MAIN_PAGE_PATH\)/,
        'file:// remains explicit until the planned custom-protocol migration is validated');
});

test('Windows async safeStorage reads legacy ciphertext and rotates it without changing the file format', async t => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-async-safe-storage-'));
    t.after(() => fs.rmSync(tempHome, { recursive: true, force: true }));

    const calls = { decrypt: 0, encrypt: 0 };
    const safeStorage = {
        isAsyncEncryptionAvailable: async () => true,
        decryptStringAsync: async encrypted => {
            calls.decrypt += 1;
            const value = encrypted.toString('utf8').replace(/^legacy:/, '');
            return { result: value, shouldReEncrypt: true };
        },
        encryptStringAsync: async value => {
            calls.encrypt += 1;
            return Buffer.from('async:' + value, 'utf8');
        },
    };
    const fakeOs = { platform: () => 'win32', homedir: () => tempHome };
    const storage = loadMain('src/storage.js', {
        os: fakeOs,
        electron: { app: { isPackaged: true }, safeStorage },
    });

    const configDir = storage.getConfigDir();
    fs.mkdirSync(configDir, { recursive: true });
    const credentialsPath = path.join(configDir, 'credentials.json');
    fs.writeFileSync(credentialsPath, JSON.stringify({
        format: 'windows-safe-storage-v1',
        encrypted: {
            apiKey: Buffer.from('legacy:gemini-secret').toString('base64'),
            groqApiKey: Buffer.from('legacy:groq-secret').toString('base64'),
        },
    }));

    storage.initializeStorage();
    assert.equal(storage.getApiKey(), '');
    assert.equal(await storage.initializeCredentialStorage(), true);
    assert.equal(storage.getApiKey(), 'gemini-secret');
    assert.equal(storage.getGroqApiKey(), 'groq-secret');
    assert.equal(calls.decrypt, 2);
    assert.equal(calls.encrypt, 2);

    const migrated = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    assert.equal(migrated.format, 'windows-safe-storage-v1');
    assert.equal(Buffer.from(migrated.encrypted.apiKey, 'base64').toString('utf8'), 'async:gemini-secret');
    assert.equal(Buffer.from(migrated.encrypted.groqApiKey, 'base64').toString('utf8'), 'async:groq-secret');
});

test('temporary async safeStorage unavailability never overwrites existing encrypted credentials', async t => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-safe-storage-locked-'));
    t.after(() => fs.rmSync(tempHome, { recursive: true, force: true }));

    const fakeOs = { platform: () => 'win32', homedir: () => tempHome };
    const safeStorage = {
        isAsyncEncryptionAvailable: async () => false,
        encryptStringAsync: async () => { throw new Error('must not encrypt'); },
        decryptStringAsync: async () => { throw new Error('must not decrypt'); },
    };
    const storage = loadMain('src/storage.js', {
        os: fakeOs,
        electron: { app: { isPackaged: true }, safeStorage },
    });
    const configDir = storage.getConfigDir();
    fs.mkdirSync(configDir, { recursive: true });
    const credentialsPath = path.join(configDir, 'credentials.json');
    const original = JSON.stringify({
        format: 'windows-safe-storage-v1',
        encrypted: { apiKey: 'YWJj', groqApiKey: 'ZGVm' },
    });
    fs.writeFileSync(credentialsPath, original);

    storage.initializeStorage();
    assert.equal(await storage.initializeCredentialStorage(), false);
    await assert.rejects(storage.setApiKey('replacement'), /encryption is unavailable/i);
    assert.equal(fs.readFileSync(credentialsPath, 'utf8'), original);
    assert.equal(storage.getApiKey(), '');
});

test('credential storage no longer calls synchronous safeStorage encryption APIs', () => {
    const storage = read('src/storage.js');
    assert.match(storage, /isAsyncEncryptionAvailable/);
    assert.match(storage, /encryptStringAsync/);
    assert.match(storage, /decryptStringAsync/);
    assert.doesNotMatch(storage, /safeStorage\.isEncryptionAvailable\s*\(/);
    assert.doesNotMatch(storage, /safeStorage\.encryptString\s*\(/);
    assert.doesNotMatch(storage, /safeStorage\.decryptString\s*\(/);
});
