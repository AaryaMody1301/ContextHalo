const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_VERSION = 6;
const CREDENTIAL_FORMAT = 'windows-safe-storage-v1';
const DEFAULT_CONFIG = {
    configVersion: CONFIG_VERSION,
    onboarded: false,
    layout: 'normal',
    geminiLiveModel: 'gemini-3.1-flash-live-preview',
    geminiHttpModel: 'gemini-3.8-flash',
    groqModel: 'openai/gpt-oss-120b',
    groqImageModel: 'qwen/qwen3.6-27b',
    groqTranscriptionModel: 'whisper-large-v3-turbo',
    disableGroqThinking: true,
};
const DEFAULT_CREDENTIALS = { apiKey: '', groqApiKey: '', cloudToken: '' };
const DEFAULT_PREFERENCES = {
    customPrompt: '',
    providerMode: 'byok',
    selectedProfile: 'interview',
    selectedLanguage: 'en-US',
    selectedScreenshotInterval: '5',
    selectedImageQuality: 'medium',
    advancedMode: false,
    audioMode: 'speaker_only',
    fontSize: 20,
    backgroundTransparency: 0.8,
    googleSearchEnabled: false,
    localLlmModel: 'unsloth/Qwen3.5-4B-GGUF:Q4_K_M',
    whisperModel: 'tiny.en',
};
const DEFAULT_KEYBINDS = null;
const DEFAULT_LIMITS = { data: [] };

const RETIRED_GEMINI_LIVE_MODELS = new Set([
    'gemini-live-2.5-flash',
    'gemini-2.5-flash-native-audio-preview-09-2025',
    'gemini-2.0-flash-live-001',
]);
const RETIRED_GEMINI_HTTP_MODELS = new Set([
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
]);
const LEGACY_WHISPER_MODELS = {
    'Xenova/whisper-tiny': 'tiny.en',
    'Xenova/whisper-base': 'base.en',
    'Xenova/whisper-small': 'small.en',
};
const VALID_PROVIDER_MODES = new Set(['byok', 'groq', 'local']);

function getConfigDir() {
    if (os.platform() === 'win32') return path.join(os.homedir(), 'AppData', 'Roaming', 'ContextHalo');
    if (os.platform() === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'ContextHalo');
    return path.join(os.homedir(), '.config', 'ContextHalo');
}
function getLegacyConfigDir() {
    if (os.platform() !== 'win32') return null;
    const legacyName = Buffer.from([99, 104, 101, 97, 116, 105, 110, 103, 45, 100, 97, 100, 100, 121, 45, 99, 111, 110, 102, 105, 103]).toString('utf8');
    return path.join(os.homedir(), 'AppData', 'Roaming', legacyName);
}

function migratePreContextHaloConfigDir() {
    const legacyDir = getLegacyConfigDir();
    const currentDir = getConfigDir();
    if (!legacyDir || legacyDir === currentDir || fs.existsSync(currentDir) || !fs.existsSync(legacyDir)) return;
    try {
        fs.renameSync(legacyDir, currentDir);
        console.log('Migrated pre-ContextHalo configuration to the ContextHalo data directory.');
    } catch (error) {
        console.warn('Could not migrate the pre-ContextHalo configuration directory:', error.message);
    }
}

function getConfigPath() { return path.join(getConfigDir(), 'config.json'); }
function getCredentialsPath() { return path.join(getConfigDir(), 'credentials.json'); }
function getPreferencesPath() { return path.join(getConfigDir(), 'preferences.json'); }
function getKeybindsPath() { return path.join(getConfigDir(), 'keybinds.json'); }
function getLimitsPath() { return path.join(getConfigDir(), 'limits.json'); }
function getHistoryDir() { return path.join(getConfigDir(), 'history'); }

function readJsonFile(filePath, defaultValue) {
    try {
        return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : defaultValue;
    } catch (error) {
        console.warn(`Error reading ${filePath}:`, error.message);
        return defaultValue;
    }
}

function writeJsonFile(filePath, data) {
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error(`Error writing ${filePath}:`, error.message);
        return false;
    }
}

function getWindowsSafeStorage() {
    if (os.platform() !== 'win32') return null;
    try {
        const electron = require('electron');
        const safeStorage = electron && typeof electron === 'object' ? electron.safeStorage : null;
        if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') return null;
        return safeStorage.isEncryptionAvailable() ? safeStorage : null;
    } catch {
        return null;
    }
}

function isEncryptedCredentialFile(raw) {
    return raw?.format === CREDENTIAL_FORMAT && raw?.encrypted && typeof raw.encrypted === 'object';
}

function encryptCredential(value, safeStorage) {
    if (!value) return '';
    return safeStorage.encryptString(String(value)).toString('base64');
}

function decryptCredential(value, safeStorage) {
    if (!value) return '';
    return safeStorage.decryptString(Buffer.from(String(value), 'base64'));
}

function decodeStoredCredentials(raw) {
    if (!isEncryptedCredentialFile(raw)) {
        return { ...DEFAULT_CREDENTIALS, ...(raw && typeof raw === 'object' ? raw : {}) };
    }

    const safeStorage = getWindowsSafeStorage();
    if (!safeStorage) {
        console.warn('Windows credential encryption is unavailable; encrypted API keys cannot be read in this process.');
        return null;
    }

    try {
        return {
            apiKey: decryptCredential(raw.encrypted.apiKey, safeStorage),
            groqApiKey: decryptCredential(raw.encrypted.groqApiKey, safeStorage),
            cloudToken: decryptCredential(raw.encrypted.cloudToken, safeStorage),
        };
    } catch (error) {
        console.error('Could not decrypt Windows credentials:', error.message);
        return null;
    }
}

function writeCredentialsFile(credentials) {
    const normalized = { ...DEFAULT_CREDENTIALS, ...(credentials || {}) };
    const safeStorage = getWindowsSafeStorage();

    if (safeStorage) {
        return writeJsonFile(getCredentialsPath(), {
            format: CREDENTIAL_FORMAT,
            encrypted: {
                apiKey: encryptCredential(normalized.apiKey, safeStorage),
                groqApiKey: encryptCredential(normalized.groqApiKey, safeStorage),
                cloudToken: encryptCredential(normalized.cloudToken, safeStorage),
            },
        });
    }

    // Plain JSON remains only as a development/test fallback when Electron's
    // Windows DPAPI-backed safeStorage API is not available (for example node:test).
    return writeJsonFile(getCredentialsPath(), normalized);
}

function normalizeFontSize(value) {
    const legacy = { small: 16, medium: 20, large: 24 };
    if (typeof value === 'string' && legacy[value]) return legacy[value];
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 12 && numeric <= 48 ? numeric : DEFAULT_PREFERENCES.fontSize;
}

function migrateConfig(rawConfig = {}) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    const previousVersion = Number(source.configVersion) || 0;
    const config = { ...DEFAULT_CONFIG, ...source, configVersion: CONFIG_VERSION };

    if (!config.geminiLiveModel || RETIRED_GEMINI_LIVE_MODELS.has(config.geminiLiveModel)) {
        config.geminiLiveModel = DEFAULT_CONFIG.geminiLiveModel;
    }
    if (!config.geminiHttpModel || RETIRED_GEMINI_HTTP_MODELS.has(config.geminiHttpModel)) {
        config.geminiHttpModel = DEFAULT_CONFIG.geminiHttpModel;
    }
    if (previousVersion < 6 && source.geminiHttpModel === 'gemini-3.7-flash') {
        config.geminiHttpModel = DEFAULT_CONFIG.geminiHttpModel;
    }
    if (previousVersion < 4 && source.groqModel === 'qwen/qwen3.6-27b') {
        config.groqModel = DEFAULT_CONFIG.groqModel;
    }
    if (!config.groqModel) config.groqModel = DEFAULT_CONFIG.groqModel;
    if (!config.groqImageModel) config.groqImageModel = DEFAULT_CONFIG.groqImageModel;
    if (!config.groqTranscriptionModel) config.groqTranscriptionModel = DEFAULT_CONFIG.groqTranscriptionModel;

    return config;
}

function migratePreferences(rawPreferences = {}) {
    const source = rawPreferences && typeof rawPreferences === 'object' ? rawPreferences : {};
    const preferences = { ...DEFAULT_PREFERENCES, ...source };

    if (preferences.providerMode === 'cloud') preferences.providerMode = 'byok';
    if (!VALID_PROVIDER_MODES.has(preferences.providerMode)) preferences.providerMode = 'byok';

    preferences.fontSize = normalizeFontSize(preferences.fontSize);
    preferences.whisperModel = LEGACY_WHISPER_MODELS[preferences.whisperModel] || preferences.whisperModel || DEFAULT_PREFERENCES.whisperModel;

    if (typeof preferences.googleSearchEnabled === 'string') {
        preferences.googleSearchEnabled = preferences.googleSearchEnabled === 'true';
    } else {
        preferences.googleSearchEnabled = preferences.googleSearchEnabled === true;
    }

    return preferences;
}

function initializeStorage() {
    migratePreContextHaloConfigDir();
    fs.mkdirSync(getConfigDir(), { recursive: true });
    writeJsonFile(getConfigPath(), migrateConfig(readJsonFile(getConfigPath(), {})));

    const rawCredentials = readJsonFile(getCredentialsPath(), {});
    if (isEncryptedCredentialFile(rawCredentials)) {
        // Never rewrite an encrypted file if DPAPI is temporarily unavailable.
        const decoded = decodeStoredCredentials(rawCredentials);
        if (decoded && getWindowsSafeStorage()) writeCredentialsFile(decoded);
    } else {
        writeCredentialsFile({ ...DEFAULT_CREDENTIALS, ...rawCredentials });
    }

    writeJsonFile(getPreferencesPath(), migratePreferences(readJsonFile(getPreferencesPath(), {})));
    if (!fs.existsSync(getLimitsPath())) writeJsonFile(getLimitsPath(), DEFAULT_LIMITS);
    fs.mkdirSync(getHistoryDir(), { recursive: true });
}

function getConfig() { return migrateConfig(readJsonFile(getConfigPath(), {})); }
function setConfig(config) { return writeJsonFile(getConfigPath(), migrateConfig({ ...getConfig(), ...config })); }
function updateConfig(key, value) { return setConfig({ [key]: value }); }
function getCredentials() {
    const decoded = decodeStoredCredentials(readJsonFile(getCredentialsPath(), {}));
    return decoded || { ...DEFAULT_CREDENTIALS };
}
function setCredentials(credentials) { return writeCredentialsFile({ ...getCredentials(), ...credentials }); }
function getApiKey() { return getCredentials().apiKey || ''; }
function setApiKey(apiKey) { return setCredentials({ apiKey }); }
function getGroqApiKey() { return getCredentials().groqApiKey || ''; }
function setGroqApiKey(groqApiKey) { return setCredentials({ groqApiKey }); }
function getPreferences() { return migratePreferences(readJsonFile(getPreferencesPath(), {})); }
function setPreferences(preferences) { return writeJsonFile(getPreferencesPath(), migratePreferences({ ...getPreferences(), ...preferences })); }
function updatePreference(key, value) { return setPreferences({ [key]: value }); }
function getKeybinds() { return readJsonFile(getKeybindsPath(), DEFAULT_KEYBINDS); }
function setKeybinds(keybinds) { return writeJsonFile(getKeybindsPath(), keybinds); }

// Provider limits are telemetry only. The API response is the source of truth for quota.
function getLimits() { return readJsonFile(getLimitsPath(), DEFAULT_LIMITS); }
function setLimits(limits) { return writeJsonFile(getLimitsPath(), limits); }
function getTodayDateString() { return new Date().toISOString().slice(0, 10); }
function getTodayLimits() {
    const limits = getLimits();
    const today = getTodayDateString();
    let entry = limits.data.find(item => item.date === today);
    if (!entry) {
        limits.data = [];
        entry = { date: today, providers: {} };
        limits.data.push(entry);
        setLimits(limits);
    }
    return entry;
}
function incrementLimitCount(model) {
    const limits = getLimits();
    const entry = getTodayLimits();
    entry.gemini = entry.gemini || {};
    entry.gemini[model] = (entry.gemini[model] || 0) + 1;
    const saved = limits.data.find(item => item.date === entry.date);
    if (saved) Object.assign(saved, entry);
    else limits.data = [entry];
    setLimits(limits);
    return entry;
}
function incrementCharUsage(provider, model, charCount) {
    const limits = getLimits();
    const entry = getTodayLimits();
    entry.providers = entry.providers || {};
    entry.providers[provider] = entry.providers[provider] || {};
    const usage = entry.providers[provider][model] || { chars: 0, requests: 0 };
    usage.chars += Math.max(0, Number(charCount) || 0);
    usage.requests += 1;
    entry.providers[provider][model] = usage;
    const saved = limits.data.find(item => item.date === entry.date);
    if (saved) Object.assign(saved, entry);
    else limits.data = [entry];
    setLimits(limits);
    return entry;
}
function getAvailableModel() { return getConfig().geminiHttpModel || DEFAULT_CONFIG.geminiHttpModel; }
function getModelForToday() { return getConfig().groqModel; }
function getSessionPath(sessionId) { return path.join(getHistoryDir(), `${sessionId}.json`); }
function saveSession(sessionId, data) {
    const existing = readJsonFile(getSessionPath(sessionId), null);
    return writeJsonFile(getSessionPath(sessionId), {
        sessionId,
        createdAt: existing?.createdAt || Number(sessionId) || Date.now(),
        lastUpdated: Date.now(),
        profile: data.profile || existing?.profile || null,
        customPrompt: data.customPrompt || existing?.customPrompt || null,
        conversationHistory: data.conversationHistory || existing?.conversationHistory || [],
        screenAnalysisHistory: data.screenAnalysisHistory || existing?.screenAnalysisHistory || [],
    });
}
function getSession(sessionId) { return readJsonFile(getSessionPath(sessionId), null); }
function getAllSessions() {
    try {
        if (!fs.existsSync(getHistoryDir())) return [];
        return fs.readdirSync(getHistoryDir())
            .filter(file => file.endsWith('.json'))
            .sort((a, b) => Number(b.slice(0, -5)) - Number(a.slice(0, -5)))
            .map(file => {
                const data = readJsonFile(path.join(getHistoryDir(), file), null);
                return data ? {
                    sessionId: file.slice(0, -5),
                    createdAt: data.createdAt,
                    lastUpdated: data.lastUpdated,
                    messageCount: data.conversationHistory?.length || 0,
                    screenAnalysisCount: data.screenAnalysisHistory?.length || 0,
                    profile: data.profile || null,
                    customPrompt: data.customPrompt || null,
                } : null;
            })
            .filter(Boolean);
    } catch (error) {
        console.error('Error reading sessions:', error.message);
        return [];
    }
}
function deleteSession(sessionId) {
    try {
        const sessionPath = getSessionPath(sessionId);
        if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
        return true;
    } catch (error) {
        console.error('Error deleting session:', error.message);
        return false;
    }
}
function deleteAllSessions() {
    try {
        if (fs.existsSync(getHistoryDir())) {
            for (const file of fs.readdirSync(getHistoryDir()).filter(name => name.endsWith('.json'))) {
                fs.unlinkSync(path.join(getHistoryDir(), file));
            }
        }
        return true;
    } catch (error) {
        console.error('Error deleting all sessions:', error.message);
        return false;
    }
}
function clearAllData() {
    try {
        fs.rmSync(getConfigDir(), { recursive: true, force: true });
        initializeStorage();
        return true;
    } catch (error) {
        console.error('Error clearing data:', error.message);
        return false;
    }
}

module.exports = {
    initializeStorage,
    getConfigDir,
    getConfig,
    setConfig,
    updateConfig,
    getCredentials,
    setCredentials,
    getApiKey,
    setApiKey,
    getGroqApiKey,
    setGroqApiKey,
    getPreferences,
    setPreferences,
    updatePreference,
    getKeybinds,
    setKeybinds,
    getLimits,
    setLimits,
    getTodayLimits,
    incrementLimitCount,
    incrementCharUsage,
    getAvailableModel,
    getModelForToday,
    saveSession,
    getSession,
    getAllSessions,
    deleteSession,
    deleteAllSessions,
    clearAllData,
};
