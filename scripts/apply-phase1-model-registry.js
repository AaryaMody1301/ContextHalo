const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function write(rel, content) {
    fs.writeFileSync(path.join(ROOT, rel), content, 'utf8');
}

function replaceOnce(rel, from, to) {
    const current = read(rel);
    if (current.includes(from)) {
        write(rel, current.replace(from, to));
        return;
    }

    const fromCrLf = from.replaceAll('\n', '\r\n');
    const toCrLf = to.replaceAll('\n', '\r\n');
    if (current.includes(fromCrLf)) {
        write(rel, current.replace(fromCrLf, toCrLf));
        return;
    }

    throw new Error(`Expected pattern not found in ${rel}: ${from.slice(0, 120)}`);
}

for (const required of [
    'src/utils/providerModelRegistry.js',
    'src/utils/dynamicModelRegistryRenderer.js',
    'tests/provider-model-registry.test.js',
]) {
    if (!fs.existsSync(path.join(ROOT, required))) throw new Error(`Missing staged Phase 1 file: ${required}`);
}

replaceOnce('src/storage.js', 'const CONFIG_VERSION = 4;', 'const CONFIG_VERSION = 5;');
replaceOnce(
    'src/storage.js',
    "    groqImageModel: 'qwen/qwen3.6-27b',\n    disableGroqThinking: true,",
    "    groqImageModel: 'qwen/qwen3.6-27b',\n    groqTranscriptionModel: 'whisper-large-v3-turbo',\n    disableGroqThinking: true,"
);
replaceOnce(
    'src/storage.js',
    "    if (previousVersion < CONFIG_VERSION && source.groqModel === 'qwen/qwen3.6-27b') {",
    "    if (previousVersion < 4 && source.groqModel === 'qwen/qwen3.6-27b') {"
);
replaceOnce(
    'src/storage.js',
    "    if (!config.groqImageModel) config.groqImageModel = DEFAULT_CONFIG.groqImageModel;\n\n    return config;",
    "    if (!config.groqImageModel) config.groqImageModel = DEFAULT_CONFIG.groqImageModel;\n    if (!config.groqTranscriptionModel) config.groqTranscriptionModel = DEFAULT_CONFIG.groqTranscriptionModel;\n\n    return config;"
);

replaceOnce(
    'preload.js',
    "        'storage:clear-all',\n        'get-app-version',",
    "        'storage:clear-all',\n        'provider-models:list',\n        'get-app-version',"
);

replaceOnce(
    'src/index.js',
    "const storage = require('./storage');",
    "const storage = require('./storage');\nconst { listProviderModels } = require('./utils/providerModelRegistry');"
);
replaceOnce(
    'src/index.js',
    "function setupGeneralIpcHandlers() {\n    ipcMain.handle('get-app-version', event => {",
    "function setupGeneralIpcHandlers() {\n    ipcMain.handle('provider-models:list', async (event, provider, forceRefresh = false) => {\n        if (!isTrustedEvent(event) || !['gemini', 'groq'].includes(provider)) {\n            return { success: false, error: 'Invalid provider model request' };\n        }\n        try {\n            const apiKey = provider === 'gemini' ? storage.getApiKey() : storage.getGroqApiKey();\n            const data = await listProviderModels(provider, apiKey, { forceRefresh: forceRefresh === true });\n            return { success: true, data };\n        } catch (error) {\n            return { success: false, error: error?.message || String(error) };\n        }\n    });\n\n    ipcMain.handle('get-app-version', event => {"
);

replaceOnce(
    'src/index.html',
    '        <script type="module" src="utils/runtimeProviderFixes.js"></script>\n        <script type="module" src="utils/runtimeHardeningRenderer.js"></script>',
    '        <script type="module" src="utils/runtimeProviderFixes.js"></script>\n        <script type="module" src="utils/dynamicModelRegistryRenderer.js"></script>\n        <script type="module" src="utils/runtimeHardeningRenderer.js"></script>'
);

replaceOnce(
    'src/utils/gemini.js',
    "        form.append('model', 'whisper-large-v3-turbo');",
    "        form.append('model', getConfig().groqTranscriptionModel || 'whisper-large-v3-turbo');"
);
replaceOnce(
    'src/utils/runtimeHardeningMain.js',
    "        form.append('model', 'whisper-large-v3-turbo');",
    "        form.append('model', storage.getConfig().groqTranscriptionModel || 'whisper-large-v3-turbo');"
);

replaceOnce('tests/storage.test.js', 'assert.equal(config.configVersion, 4);', 'assert.equal(config.configVersion, 5);');
replaceOnce(
    'tests/storage.test.js',
    "    assert.equal(config.groqImageModel, 'qwen/qwen3.6-27b');\n    assert.equal(config.onboarded, true);",
    "    assert.equal(config.groqImageModel, 'qwen/qwen3.6-27b');\n    assert.equal(config.groqTranscriptionModel, 'whisper-large-v3-turbo');\n    assert.equal(config.onboarded, true);"
);
replaceOnce(
    'tests/storage.test.js',
    "    assert.match(gemini, /form\\.append\\('model', 'whisper-large-v3-turbo'\\)/);",
    "    assert.match(gemini, /groqTranscriptionModel/);\n    assert.match(gemini, /whisper-large-v3-turbo/);"
);

console.log('Phase 1 dynamic model registry changes applied successfully.');
