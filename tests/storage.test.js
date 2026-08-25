const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('storage v4 migration upgrades provider models without deleting user data', { concurrency: false }, t => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cheating-daddy-storage-'));
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
    assert.equal(config.configVersion, 4);
    assert.equal(config.geminiLiveModel, 'gemini-3.1-flash-live-preview');
    assert.equal(config.geminiHttpModel, 'gemini-3.7-flash');
    assert.equal(config.groqModel, 'openai/gpt-oss-120b');
    assert.equal(config.groqImageModel, 'qwen/qwen3.6-27b');
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
