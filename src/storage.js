const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('node:crypto');

const CONFIG_VERSION = 8;
const CREDENTIAL_FORMAT = 'windows-safe-storage-v1';
const DEFAULT_CONFIG = {
    configVersion: CONFIG_VERSION,
    onboarded: false,
    layout: 'normal',
    geminiLiveModel: 'gemini-3.8-live',
    geminiHttpModel: 'gemini-3.8-flash',
    groqModel: 'openai/gpt-oss-120b',
    groqImageModel: 'qwen/qwen3.8-27b',
    groqTranscriptionModel: 'whisper-large-v3-turbo',
    disableGroqThinking: true,
};
const DEFAULT_CREDENTIALS = { apiKey: '', groqApiKey: '' };
let credentialCache = { ...DEFAULT_CREDENTIALS };
let credentialStorageReady = false;
let credentialStorageLocked = false;
const DEFAULT_PREFERENCES = {
    customPrompt: '',
    providerMode: 'byok',
    selectedProfile: 'interview',
    selectedLanguage: 'en-US',
    selectedScreenshotInterval: '5',
    selectedImageQuality: 'medium',
    audioMode: 'speaker_only',
    fontSize: 20,
    backgroundTransparency: 0.8,
    googleSearchEnabled: false,
    localLlmModel: 'unsloth/Qwen3.5-2B-GGUF:Q4_K_M',
    localModelDefaultVersion: 1,
    whisperModel: 'tiny.en',
};
const DEFAULT_KEYBINDS = null;
const DEFAULT_LIMITS = { data: [] };

const RETIRED_GEMINI_LIVE_MODELS = new Set([
    'gemini-live-2.5-flash',
    'gemini-2.5-flash-native-audio-preview-09-2025',
    'gemini-2.5-flash-native-audio-preview-12-2025',
    'gemini-3.1-flash-live-preview',
    'gemini-2.0-flash-live-001',
]);
const RETIRED_GEMINI_HTTP_MODELS = new Set([
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
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
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temporary, filePath);
        return true;
    } catch (error) {
        try { fs.unlinkSync(temporary); } catch {}
        console.error(`Error writing ${filePath}:`, error.message);
        return false;
    }
}

function normalizeCredentials(credentials) {
    return {
        apiKey: String(credentials?.apiKey || '').trim(),
        groqApiKey: String(credentials?.groqApiKey || '').trim(),
    };
}

function isPackagedWindows() {
    if (os.platform() !== 'win32') return false;
    try { return require('electron').app?.isPackaged === true; }
    catch { return false; }
}

async function getWindowsAsyncSafeStorage() {
    if (os.platform() !== 'win32') return null;
    try {
        const electron = require('electron');
        const safeStorage = electron && typeof electron === 'object' ? electron.safeStorage : null;
        if (!safeStorage
            || typeof safeStorage.isAsyncEncryptionAvailable !== 'function'
            || typeof safeStorage.encryptStringAsync !== 'function'
            || typeof safeStorage.decryptStringAsync !== 'function') return null;
        return await safeStorage.isAsyncEncryptionAvailable() ? safeStorage : null;
    } catch {
        return null;
    }
}

function isEncryptedCredentialFile(raw) {
    return raw?.format === CREDENTIAL_FORMAT && raw?.encrypted && typeof raw.encrypted === 'object';
}

async function encryptCredentialAsync(value, safeStorage) {
    if (!value) return '';
    return (await safeStorage.encryptStringAsync(String(value))).toString('base64');
}

async function decryptCredentialAsync(value, safeStorage) {
    if (!value) return { result: '', shouldReEncrypt: false };
    const decoded = await safeStorage.decryptStringAsync(Buffer.from(String(value), 'base64'));
    if (!decoded || typeof decoded.result !== 'string') throw new Error('Windows credential decryption returned an invalid result.');
    return { result: decoded.result, shouldReEncrypt: decoded.shouldReEncrypt === true };
}

async function decodeStoredCredentialsAsync(raw, safeStorage) {
    if (!isEncryptedCredentialFile(raw)) {
        return { credentials: normalizeCredentials(raw), shouldReEncrypt: false };
    }
    if (!safeStorage) return null;

    try {
        const [apiKey, groqApiKey] = await Promise.all([
            decryptCredentialAsync(raw.encrypted.apiKey, safeStorage),
            decryptCredentialAsync(raw.encrypted.groqApiKey, safeStorage),
        ]);
        return {
            credentials: normalizeCredentials({ apiKey: apiKey.result, groqApiKey: groqApiKey.result }),
            shouldReEncrypt: apiKey.shouldReEncrypt || groqApiKey.shouldReEncrypt,
        };
    } catch (error) {
        console.error('Could not decrypt Windows credentials:', error.message);
        return null;
    }
}

async function writeCredentialsFileAsync(credentials, safeStorageOverride) {
    const normalized = normalizeCredentials(credentials);
    const safeStorage = safeStorageOverride === undefined ? await getWindowsAsyncSafeStorage() : safeStorageOverride;

    if (safeStorage) {
        const [apiKey, groqApiKey] = await Promise.all([
            encryptCredentialAsync(normalized.apiKey, safeStorage),
            encryptCredentialAsync(normalized.groqApiKey, safeStorage),
        ]);
        const saved = writeJsonFile(getCredentialsPath(), {
            format: CREDENTIAL_FORMAT,
            encrypted: { apiKey, groqApiKey },
        });
        if (saved) {
            credentialCache = normalized;
            credentialStorageReady = true;
            credentialStorageLocked = false;
        }
        return saved;
    }

    if (isPackagedWindows()) {
        throw new Error('Windows credential encryption is unavailable. Existing keys were not changed.');
    }

    // Plain JSON remains only as a development/test fallback when Electron's
    // Windows DPAPI-backed async safeStorage API is unavailable.
    const saved = writeJsonFile(getCredentialsPath(), normalized);
    if (saved) {
        credentialCache = normalized;
        credentialStorageReady = true;
        credentialStorageLocked = false;
    }
    return saved;
}

async function initializeCredentialStorage() {
    const rawCredentials = readJsonFile(getCredentialsPath(), {});

    if (os.platform() !== 'win32') {
        credentialCache = isEncryptedCredentialFile(rawCredentials)
            ? { ...DEFAULT_CREDENTIALS }
            : normalizeCredentials({ ...DEFAULT_CREDENTIALS, ...rawCredentials });
        credentialStorageReady = true;
        credentialStorageLocked = isEncryptedCredentialFile(rawCredentials);
        return !credentialStorageLocked;
    }

    const safeStorage = await getWindowsAsyncSafeStorage();
    if (isEncryptedCredentialFile(rawCredentials)) {
        if (!safeStorage) {
            console.warn('Windows credential encryption is temporarily unavailable; encrypted API keys were left unchanged.');
            credentialCache = { ...DEFAULT_CREDENTIALS };
            credentialStorageReady = false;
            credentialStorageLocked = true;
            return false;
        }
        const decoded = await decodeStoredCredentialsAsync(rawCredentials, safeStorage);
        if (!decoded) {
            credentialCache = { ...DEFAULT_CREDENTIALS };
            credentialStorageReady = false;
            credentialStorageLocked = true;
            return false;
        }
        credentialCache = decoded.credentials;
        credentialStorageReady = true;
        credentialStorageLocked = false;
        if (decoded.shouldReEncrypt && !await writeCredentialsFileAsync(decoded.credentials, safeStorage)) {
            console.warn('Windows credential key rotation could not be persisted; the decrypted keys remain available for this session.');
        }
        return true;
    }

    const normalized = normalizeCredentials({ ...DEFAULT_CREDENTIALS, ...rawCredentials });
    return writeCredentialsFileAsync(normalized, safeStorage);
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
    if (previousVersion < 4 && source.groqModel === 'qwen/qwen3.6-27b') {
        config.groqModel = DEFAULT_CONFIG.groqModel;
    }
    if (!config.groqModel) config.groqModel = DEFAULT_CONFIG.groqModel;
    // Groq shut down Qwen 3.6 for Free/Developer on 2026-09-14 and names
    // Qwen 3.8 as its replacement. Migrate the old ContextHalo default once.
    // Enterprise catalogs may still expose 3.6, so the dynamic picker can
    // surface it again after this migration when the account reports access.
    if (previousVersion < 8 && source.groqImageModel === 'qwen/qwen3.6-27b') {
        config.groqImageModel = DEFAULT_CONFIG.groqImageModel;
    }
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
    // Qwen 3.5 4B was the old implicit default. Move only that old default to
    // the faster 2B preset once; custom/explicit alternatives remain untouched.
    if ((Number(source.localModelDefaultVersion) || 0) < 1
        && (!source.localLlmModel || source.localLlmModel === 'unsloth/Qwen3.5-4B-GGUF:Q4_K_M')) {
        preferences.localLlmModel = DEFAULT_PREFERENCES.localLlmModel;
    }
    preferences.localModelDefaultVersion = 1;

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
        // Async safeStorage is initialized after app.ready. Never rewrite an
        // encrypted file from this synchronous bootstrap path.
        credentialCache = { ...DEFAULT_CREDENTIALS };
        credentialStorageReady = false;
        credentialStorageLocked = os.platform() !== 'win32';
    } else {
        credentialCache = normalizeCredentials({ ...DEFAULT_CREDENTIALS, ...rawCredentials });
        credentialStorageReady = os.platform() !== 'win32';
        credentialStorageLocked = false;
        if (os.platform() !== 'win32') writeJsonFile(getCredentialsPath(), credentialCache);
    }

    writeJsonFile(getPreferencesPath(), migratePreferences(readJsonFile(getPreferencesPath(), {})));
    if (!fs.existsSync(getLimitsPath())) writeJsonFile(getLimitsPath(), DEFAULT_LIMITS);
    fs.mkdirSync(getHistoryDir(), { recursive: true });
}

function getConfig() { return migrateConfig(readJsonFile(getConfigPath(), {})); }
function setConfig(config) { return writeJsonFile(getConfigPath(), migrateConfig({ ...getConfig(), ...config })); }
function updateConfig(key, value) { return setConfig({ [key]: value }); }
function getCredentials() { return { ...credentialCache }; }
async function setCredentials(credentials) {
    if (os.platform() === 'win32' && !credentialStorageReady) {
        await initializeCredentialStorage();
        if (!credentialStorageReady && credentialStorageLocked) {
            throw new Error('Windows credential encryption is unavailable. Existing keys were not changed.');
        }
    }
    return writeCredentialsFileAsync({ ...credentialCache, ...credentials });
}
function getApiKey() { return credentialCache.apiKey || ''; }
function setApiKey(apiKey) { return setCredentials({ apiKey }); }
function getGroqApiKey() { return credentialCache.groqApiKey || ''; }
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
function getSessionPath(sessionId) {
    if (typeof sessionId !== 'string' || !/^\d{1,30}$/.test(sessionId)) throw new Error('Invalid session ID');
    return path.join(getHistoryDir(), `${sessionId}.json`);
}
function saveSession(sessionId, data) {
    const existing = getSession(sessionId);
    sessionMetadata.delete(`${sessionId}.json`);
    return writeJsonFile(getSessionPath(sessionId), {
        ...(existing || {}),
        sessionId,
        createdAt: existing?.createdAt || Number(sessionId) || Date.now(),
        lastUpdated: Date.now(),
        profile: data.profile ?? existing?.profile ?? null,
        customPrompt: data.customPrompt ?? existing?.customPrompt ?? null,
        ...(Object.hasOwn(data, 'liveTranscript') ? { liveTranscript: require('./utils/sessionData').sanitizeTranscriptHistory(data.liveTranscript) } : {}),
        ...(Object.hasOwn(data, 'markers') ? { markers: require('./utils/sessionData').sanitizeMarkers(data.markers) } : {}),
        ...(Object.hasOwn(data, 'sessionPack') ? { sessionPack: require('./utils/sessionData').sanitizeSessionPack(data.sessionPack) } : {}),
        conversationHistory: data.conversationHistory || existing?.conversationHistory || [],
        screenAnalysisHistory: data.screenAnalysisHistory || existing?.screenAnalysisHistory || [],
    });
}
// History reads must distinguish missing data from denied or corrupt data. Never
// send filesystem paths or transcript contents to the renderer in an error.
function historyReadError(code = 'HISTORY_UNAVAILABLE') {
    const message = code === 'SESSION_UNREADABLE'
        ? 'This session could not be read. It may be damaged or inaccessible. Other sessions are unchanged.'
        : 'History could not be loaded. Check access to the ContextHalo data folder and retry.';
    return Object.assign(new Error(message), { code });
}
function getSession(sessionId) {
    const file = getSessionPath(sessionId);
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid session');
        return data;
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw historyReadError('SESSION_UNREADABLE');
    }
}
// Cache list metadata only, not transcripts. Refresh a summary when the file
// changes; legacy session files need no migration or extra index on disk.
const sessionMetadata = new Map();
function getAllSessions() {
    let files;
    try { files = fs.readdirSync(getHistoryDir()).filter(file => /^\d{1,30}\.json$/.test(file)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw historyReadError(); }
    const present = new Set(files);
    for (const name of sessionMetadata.keys()) if (!present.has(name)) sessionMetadata.delete(name);
    return files.sort((a, b) => Number(b.slice(0, -5)) - Number(a.slice(0, -5))).map(file => {
        const sessionId = file.slice(0, -5);
        try {
            const stat = fs.statSync(path.join(getHistoryDir(), file));
            const version = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
            const cached = sessionMetadata.get(file);
            if (cached?.version === version) return { ...cached.summary };
            const data = getSession(sessionId);
            if (!data) return null; // Deleted by another process during this read.
            const summary = {
                sessionId,
                title: String(data.sessionPack?.title || data.title || '').trim().slice(0, 160),
                createdAt: data.createdAt || Number(sessionId),
                lastUpdated: data.lastUpdated,
                messageCount: Array.isArray(data.conversationHistory) ? data.conversationHistory.length : 0,
                screenAnalysisCount: Array.isArray(data.screenAnalysisHistory) ? data.screenAnalysisHistory.length : 0,
                profile: data.profile || null,
            };
            if (sessionMetadata.size >= 2000) sessionMetadata.delete(sessionMetadata.keys().next().value);
            sessionMetadata.set(file, { version, summary });
            return { ...summary };
        } catch {
            // Do not silently drop an unreadable entry and imply history is empty.
            sessionMetadata.delete(file);
            return { sessionId, createdAt: Number(sessionId), title: '', unreadable: true,
                messageCount: 0, screenAnalysisCount: 0, profile: null };
        }
    }).filter(Boolean);
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
        credentialCache = { ...DEFAULT_CREDENTIALS };
        credentialStorageReady = os.platform() !== 'win32';
        credentialStorageLocked = false;
        initializeStorage();
        return true;
    } catch (error) {
        console.error('Error clearing data:', error.message);
        return false;
    }
}

module.exports = {
    initializeStorage,
    initializeCredentialStorage,
    getConfigDir,
    getConfig,
    updateConfig,
    getApiKey,
    setApiKey,
    getGroqApiKey,
    setGroqApiKey,
    getPreferences,
    updatePreference,
    getKeybinds,
    setKeybinds,
    incrementLimitCount,
    incrementCharUsage,
    getAvailableModel,
    saveSession,
    getSession,
    getAllSessions,
    deleteSession,
    deleteAllSessions,
    clearAllData,
};
