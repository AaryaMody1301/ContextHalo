const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_VERSION = 3;
const DEFAULT_CONFIG = { configVersion: CONFIG_VERSION, onboarded: false, layout: 'normal', geminiLiveModel: 'gemini-3.1-flash-live-preview', groqModel: 'qwen/qwen3.6-27b', groqImageModel: 'qwen/qwen3.6-27b', disableGroqThinking: true };
const DEFAULT_CREDENTIALS = { apiKey: '', groqApiKey: '', cloudToken: '' };
const DEFAULT_PREFERENCES = { customPrompt: '', providerMode: 'byok', selectedProfile: 'interview', selectedLanguage: 'en-US', selectedScreenshotInterval: '5', selectedImageQuality: 'medium', advancedMode: false, audioMode: 'speaker_only', fontSize: 'medium', backgroundTransparency: 0.8, googleSearchEnabled: false, localLlmModel: 'unsloth/Qwen3.5-4B-GGUF:Q4_K_M', whisperModel: 'tiny.en' };
const DEFAULT_KEYBINDS = null;
const DEFAULT_LIMITS = { data: [] };
function getConfigDir() { if (os.platform() === 'win32') return path.join(os.homedir(), 'AppData', 'Roaming', 'cheating-daddy-config'); if (os.platform() === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'cheating-daddy-config'); return path.join(os.homedir(), '.config', 'cheating-daddy-config'); }
function getConfigPath() { return path.join(getConfigDir(), 'config.json'); }
function getCredentialsPath() { return path.join(getConfigDir(), 'credentials.json'); }
function getPreferencesPath() { return path.join(getConfigDir(), 'preferences.json'); }
function getKeybindsPath() { return path.join(getConfigDir(), 'keybinds.json'); }
function getLimitsPath() { return path.join(getConfigDir(), 'limits.json'); }
function getHistoryDir() { return path.join(getConfigDir(), 'history'); }
function readJsonFile(filePath, defaultValue) { try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : defaultValue; } catch (error) { console.warn(`Error reading ${filePath}:`, error.message); return defaultValue; } }
function writeJsonFile(filePath, data) { try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8'); return true; } catch (error) { console.error(`Error writing ${filePath}:`, error.message); return false; } }
function initializeStorage() { fs.mkdirSync(getConfigDir(), { recursive: true }); writeJsonFile(getConfigPath(), { ...DEFAULT_CONFIG, ...readJsonFile(getConfigPath(), {}), configVersion: CONFIG_VERSION }); writeJsonFile(getCredentialsPath(), { ...DEFAULT_CREDENTIALS, ...readJsonFile(getCredentialsPath(), {}) }); writeJsonFile(getPreferencesPath(), { ...DEFAULT_PREFERENCES, ...readJsonFile(getPreferencesPath(), {}) }); if (!fs.existsSync(getLimitsPath())) writeJsonFile(getLimitsPath(), DEFAULT_LIMITS); fs.mkdirSync(getHistoryDir(), { recursive: true }); }
function getConfig() { return { ...DEFAULT_CONFIG, ...readJsonFile(getConfigPath(), {}) }; }
function setConfig(config) { return writeJsonFile(getConfigPath(), { ...getConfig(), ...config, configVersion: CONFIG_VERSION }); }
function updateConfig(key, value) { return setConfig({ [key]: value }); }
function getCredentials() { return { ...DEFAULT_CREDENTIALS, ...readJsonFile(getCredentialsPath(), {}) }; }
function setCredentials(credentials) { return writeJsonFile(getCredentialsPath(), { ...getCredentials(), ...credentials }); }
function getApiKey() { return getCredentials().apiKey || ''; }
function setApiKey(apiKey) { return setCredentials({ apiKey }); }
function getGroqApiKey() { return getCredentials().groqApiKey || ''; }
function setGroqApiKey(groqApiKey) { return setCredentials({ groqApiKey }); }
function getPreferences() { const p = { ...DEFAULT_PREFERENCES, ...readJsonFile(getPreferencesPath(), {}) }; const legacy = { 'Xenova/whisper-tiny': 'tiny.en', 'Xenova/whisper-base': 'base.en', 'Xenova/whisper-small': 'small.en' }; p.whisperModel = legacy[p.whisperModel] || p.whisperModel; return p; }
function setPreferences(preferences) { return writeJsonFile(getPreferencesPath(), { ...getPreferences(), ...preferences }); }
function updatePreference(key, value) { return setPreferences({ [key]: value }); }
function getKeybinds() { return readJsonFile(getKeybindsPath(), DEFAULT_KEYBINDS); }
function setKeybinds(keybinds) { return writeJsonFile(getKeybindsPath(), keybinds); }
// Provider limits are telemetry only. The API response is the source of truth for quota.
function getLimits() { return readJsonFile(getLimitsPath(), DEFAULT_LIMITS); }
function setLimits(limits) { return writeJsonFile(getLimitsPath(), limits); }
function getTodayDateString() { return new Date().toISOString().slice(0, 10); }
function getTodayLimits() { const limits = getLimits(); const today = getTodayDateString(); let entry = limits.data.find(item => item.date === today); if (!entry) { limits.data = []; entry = { date: today, providers: {} }; limits.data.push(entry); setLimits(limits); } return entry; }
function incrementLimitCount(model) { const limits = getLimits(); const entry = getTodayLimits(); entry.gemini = entry.gemini || {}; entry.gemini[model] = (entry.gemini[model] || 0) + 1; const saved = limits.data.find(item => item.date === entry.date); if (saved) Object.assign(saved, entry); else limits.data = [entry]; setLimits(limits); return entry; }
function incrementCharUsage(provider, model, charCount) { const limits = getLimits(); const entry = getTodayLimits(); entry.providers = entry.providers || {}; entry.providers[provider] = entry.providers[provider] || {}; const usage = entry.providers[provider][model] || { chars: 0, requests: 0 }; usage.chars += Math.max(0, Number(charCount) || 0); usage.requests += 1; entry.providers[provider][model] = usage; const saved = limits.data.find(item => item.date === entry.date); if (saved) Object.assign(saved, entry); else limits.data = [entry]; setLimits(limits); return entry; }
function getAvailableModel() { return 'gemini-2.5-flash'; }
function getModelForToday() { return getConfig().groqModel; }
function getSessionPath(sessionId) { return path.join(getHistoryDir(), `${sessionId}.json`); }
function saveSession(sessionId, data) { const existing = readJsonFile(getSessionPath(sessionId), null); return writeJsonFile(getSessionPath(sessionId), { sessionId, createdAt: existing?.createdAt || Number(sessionId) || Date.now(), lastUpdated: Date.now(), profile: data.profile || existing?.profile || null, customPrompt: data.customPrompt || existing?.customPrompt || null, conversationHistory: data.conversationHistory || existing?.conversationHistory || [], screenAnalysisHistory: data.screenAnalysisHistory || existing?.screenAnalysisHistory || [] }); }
function getSession(sessionId) { return readJsonFile(getSessionPath(sessionId), null); }
function getAllSessions() { try { if (!fs.existsSync(getHistoryDir())) return []; return fs.readdirSync(getHistoryDir()).filter(f => f.endsWith('.json')).sort((a,b) => Number(b.slice(0,-5))-Number(a.slice(0,-5))).map(file => { const data = readJsonFile(path.join(getHistoryDir(), file), null); return data ? { sessionId: file.slice(0,-5), createdAt: data.createdAt, lastUpdated: data.lastUpdated, messageCount: data.conversationHistory?.length || 0, screenAnalysisCount: data.screenAnalysisHistory?.length || 0, profile: data.profile || null, customPrompt: data.customPrompt || null } : null; }).filter(Boolean); } catch (error) { console.error('Error reading sessions:', error.message); return []; } }
function deleteSession(sessionId) { try { const p = getSessionPath(sessionId); if (fs.existsSync(p)) fs.unlinkSync(p); return true; } catch (error) { console.error('Error deleting session:', error.message); return false; } }
function deleteAllSessions() { try { if (fs.existsSync(getHistoryDir())) for (const f of fs.readdirSync(getHistoryDir()).filter(f => f.endsWith('.json'))) fs.unlinkSync(path.join(getHistoryDir(), f)); return true; } catch (error) { console.error('Error deleting all sessions:', error.message); return false; } }
function clearAllData() { try { fs.rmSync(getConfigDir(), { recursive: true, force: true }); initializeStorage(); return true; } catch (error) { console.error('Error clearing data:', error.message); return false; } }
module.exports = { initializeStorage, getConfigDir, getConfig, setConfig, updateConfig, getCredentials, setCredentials, getApiKey, setApiKey, getGroqApiKey, setGroqApiKey, getPreferences, setPreferences, updatePreference, getKeybinds, setKeybinds, getLimits, setLimits, getTodayLimits, incrementLimitCount, incrementCharUsage, getAvailableModel, getModelForToday, saveSession, getSession, getAllSessions, deleteSession, deleteAllSessions, clearAllData };
