const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('storage v4 migration upgrades provider models without deleting user data', { concurrency: false }, t => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'context-halo-storage-'));
    const originalHomedir = os.homedir;
    os.homedir = () => tempHome;

    const storagePath = require.resolve('../src/storage');
    delete require.cache[storagePath];
    const storage = require(storagePath);

    t.after(() => {
        delete require.cache[storagePath];
        os.homedir = originalHomedir;
        fs.rmSync(tempHome, { recursive: true, force: true });
    });

    const configDir = storage.getConfigDir();
    const historyDir = path.join(configDir, 'history');
    fs.mkdirSync(historyDir, { recursive: true });

    fs.writeFileSync(
        path.join(configDir, 'config.json'),
        JSON.stringify({
            configVersion: 3,
            onboarded: true,
            layout: 'compact',
            geminiLiveModel: 'gemini-2.5-flash-native-audio-preview-09-2025',
            geminiHttpModel: 'gemini-2.5-flash',
            groqModel: 'qwen/qwen3.6-27b',
            groqImageModel: 'qwen/qwen3.6-27b',
        })
    );
    fs.writeFileSync(
        path.join(configDir, 'credentials.json'),
        JSON.stringify({ apiKey: 'gemini-secret', groqApiKey: 'groq-secret', cloudToken: '' })
    );
    fs.writeFileSync(
        path.join(configDir, 'preferences.json'),
        JSON.stringify({
            providerMode: 'groq',
            fontSize: 'medium',
            whisperModel: 'Xenova/whisper-tiny',
            googleSearchEnabled: 'true',
        })
    );
    fs.writeFileSync(path.join(historyDir, '123.json'), JSON.stringify({ sessionId: '123', conversationHistory: [] }));

    storage.initializeStorage();

    const config = storage.getConfig();
    assert.equal(config.configVersion, 5);
    assert.equal(config.geminiLiveModel, 'gemini-3.1-flash-live-preview');
    assert.equal(config.geminiHttpModel, 'gemini-3.7-flash');
    assert.equal(config.groqModel, 'openai/gpt-oss-120b');
    assert.equal(config.groqImageModel, 'qwen/qwen3.6-27b');
    assert.equal(config.groqTranscriptionModel, 'whisper-large-v3-turbo');
    assert.equal(config.onboarded, true);
    assert.equal(config.layout, 'compact');

    const preferences = storage.getPreferences();
    assert.equal(preferences.providerMode, 'groq');
    assert.equal(preferences.fontSize, 20);
    assert.equal(preferences.whisperModel, 'tiny.en');
    assert.equal(preferences.googleSearchEnabled, true);

    assert.equal(storage.getAvailableModel(), 'gemini-3.7-flash');
    assert.equal(storage.getCredentials().apiKey, 'gemini-secret');
    assert.equal(storage.getCredentials().groqApiKey, 'groq-secret');
    assert.equal(fs.existsSync(path.join(historyDir, '123.json')), true);

    storage.updatePreference('providerMode', 'cloud');
    assert.equal(storage.getPreferences().providerMode, 'byok');
});

test('renderer entrypoint loads provider fixes and removes the stale script reference', () => {
    const indexHtml = fs.readFileSync(path.join(process.cwd(), 'src', 'index.html'), 'utf8');
    assert.equal(indexHtml.includes('src="script.js"'), false);
    assert.equal(indexHtml.includes('src="utils/runtimeProviderFixes.js"'), true);
});

test('provider UI exposes Gemini, Groq, and Local modes with the intended free-tier models', () => {
    const fixes = fs.readFileSync(path.join(process.cwd(), 'src', 'utils', 'runtimeProviderFixes.js'), 'utf8');
    assert.match(fixes, /_saveMode\('groq'\)/);
    assert.match(fixes, /_saveMode\('byok'\)/);
    assert.match(fixes, /_saveMode\('local'\)/);
    assert.match(fixes, /whisper-large-v3-turbo/);
    assert.match(fixes, /Gemini 3\.7 Flash/);
    assert.match(fixes, /does not require a Gemini key/);
});

test('backend keeps providers isolated and routes screenshots to the matching provider', () => {
    const gemini = fs.readFileSync(path.join(process.cwd(), 'src', 'utils', 'gemini.js'), 'utf8');
    assert.match(gemini, /currentProviderMode = 'groq'/);
    assert.match(gemini, /geminiSessionRef\.current = null/);
    assert.match(gemini, /currentProviderMode === 'groq' \? await sendImageToGroq\(data, prompt\) : await sendImageToGeminiHttp\(data, prompt\)/);
    assert.match(gemini, /groqTranscriptionModel/);
    assert.match(gemini, /whisper-large-v3-turbo/);
    assert.match(gemini, /const liveModel = String\(getConfig\(\)\.geminiLiveModel/);
    assert.match(gemini, /model: liveModel/);
});

test('supported Electron runtime and lockfile stay aligned', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    const lockfile = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf8'));
    assert.equal(packageJson.devDependencies.electron, '^43.6.0');
    assert.equal(lockfile.packages[''].devDependencies.electron, '^43.6.0');
    assert.equal(lockfile.packages['node_modules/electron'].version, '43.6.0');
});
