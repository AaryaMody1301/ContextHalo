const fs = require('node:fs');

function readNormalized(filePath) {
    return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function replaceOnce(filePath, before, after, label) {
    const source = readNormalized(filePath);
    const first = source.indexOf(before);
    if (first < 0) throw new Error(`Could not find ${label} in ${filePath}`);
    if (source.indexOf(before, first + before.length) >= 0) {
        throw new Error(`Expected exactly one ${label} in ${filePath}`);
    }
    fs.writeFileSync(filePath, source.slice(0, first) + after + source.slice(first + before.length), 'utf8');
}

const geminiPath = 'src/utils/gemini.js';

replaceOnce(
    geminiPath,
    "let currentTranscription = '';\nlet conversationHistory = [];",
    "let currentTranscription = '';\nlet pendingTypedPrompt = '';\nlet conversationHistory = [];",
    'pending typed prompt state declaration'
);

replaceOnce(
    geminiPath,
    "    currentTranscription = '';\n    groqRequestStartedForTurn = false;",
    "    currentTranscription = '';\n    pendingTypedPrompt = '';\n    groqRequestStartedForTurn = false;",
    'new-session typed prompt reset'
);

replaceOnce(
    geminiPath,
    `                    if (message.serverContent?.generationComplete) {\n                        if (currentTranscription.trim() !== '') {\n                            if (currentProviderMode !== 'groq' && messageBuffer.trim() !== '') {\n                                saveConversationTurn(currentTranscription, messageBuffer);\n                            }\n                            currentTranscription = '';\n                        }\n                        messageBuffer = '';\n                    }`,
    `                    if (message.serverContent?.generationComplete) {\n                        const turnInput = pendingTypedPrompt.trim() || currentTranscription.trim();\n                        if (turnInput && currentProviderMode !== 'groq' && messageBuffer.trim() !== '') {\n                            saveConversationTurn(turnInput, messageBuffer);\n                        }\n                        currentTranscription = '';\n                        pendingTypedPrompt = '';\n                        messageBuffer = '';\n                    }`,
    'Gemini generationComplete persistence block'
);

replaceOnce(
    geminiPath,
    `        try {\n            console.log('Sending text message:', text);\n\n            await geminiSessionRef.current.sendRealtimeInput({ text: text.trim() });\n            return { success: true };\n        } catch (error) {\n            console.error('Error sending text:', error);\n            return { success: false, error: error.message };\n        }`,
    `        const cleanText = text.trim();\n        pendingTypedPrompt = cleanText;\n        try {\n            console.log('Sending text message:', cleanText);\n\n            await geminiSessionRef.current.sendRealtimeInput({ text: cleanText });\n            return { success: true };\n        } catch (error) {\n            if (pendingTypedPrompt === cleanText) pendingTypedPrompt = '';\n            console.error('Error sending text:', error);\n            return { success: false, error: error.message };\n        }`,
    'Gemini typed-message send block'
);

replaceOnce(
    geminiPath,
    "    messageBuffer = '';\n    currentTranscription = '';\n    // Don't reset groqConversationHistory to preserve context across reconnects",
    "    messageBuffer = '';\n    currentTranscription = '';\n    pendingTypedPrompt = '';\n    // Don't reset groqConversationHistory to preserve context across reconnects",
    'reconnect typed prompt reset'
);

replaceOnce(
    'src/index.js',
    "if (require('electron-squirrel-startup')) {\n    process.exit(0);\n}\n\n",
    '',
    'obsolete Squirrel startup hook'
);

const regressionTest = `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\nconst path = require('node:path');\n\nfunction source() {\n    return fs.readFileSync(path.join(process.cwd(), 'src/utils/gemini.js'), 'utf8');\n}\n\ntest('Gemini Live typed prompts are preserved as session-history user turns', () => {\n    const gemini = source();\n    assert.match(gemini, /let pendingTypedPrompt = '';/);\n    assert.match(gemini, /pendingTypedPrompt = cleanText;/);\n    assert.match(gemini, /const turnInput = pendingTypedPrompt\\.trim\\(\\) \\|\\| currentTranscription\\.trim\\(\\);/);\n    assert.match(gemini, /saveConversationTurn\\(turnInput, messageBuffer\\);/);\n    assert.match(gemini, /if \\(pendingTypedPrompt === cleanText\\) pendingTypedPrompt = '';/);\n});\n`;
fs.writeFileSync('tests/typed-gemini-history.test.js', regressionTest, 'utf8');

replaceOnce(
    'tests/storage.test.js',
    `    assert.equal(packageJson.devDependencies.electron, '^43.4.1');\n    assert.equal(lockfile.packages[''].devDependencies.electron, '^43.4.1');\n    assert.equal(lockfile.packages['node_modules/electron'].version, '43.4.1');`,
    `    assert.equal(packageJson.devDependencies.electron, '^43.6.0');\n    assert.equal(lockfile.packages[''].devDependencies.electron, '^43.6.0');\n    assert.equal(lockfile.packages['node_modules/electron'].version, '43.6.0');`,
    'supported Electron runtime regression target'
);

const packagePath = 'package.json';
const packageJson = JSON.parse(readNormalized(packagePath));
packageJson.scripts.start = 'electron .';
packageJson.scripts.package = 'electron-builder --dir --win --x64 --publish never';
packageJson.scripts.make = 'npm run build:portable';
delete packageJson.scripts.publish;
packageJson.dependencies['@google/genai'] = '^2.21.0';
delete packageJson.dependencies['electron-squirrel-startup'];
for (const dependency of [
    '@electron-forge/cli',
    '@electron-forge/maker-deb',
    '@electron-forge/maker-dmg',
    '@electron-forge/maker-rpm',
    '@electron-forge/maker-squirrel',
    '@electron-forge/maker-zip',
    '@electron-forge/plugin-auto-unpack-natives',
    '@electron-forge/plugin-fuses',
    '@electron/fuses',
    '@reforged/maker-appimage',
]) {
    delete packageJson.devDependencies[dependency];
}
packageJson.devDependencies.electron = '^43.6.0';
packageJson.build = {
    ...(packageJson.build || {}),
    electronFuses: {
        runAsNode: false,
        enableCookieEncryption: true,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: false,
        enableEmbeddedAsarIntegrityValidation: true,
        onlyLoadAppFromAsar: true,
    },
};
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 4) + '\n', 'utf8');

if (!fs.existsSync('forge.config.js')) throw new Error('Expected obsolete forge.config.js to exist before cleanup');
fs.unlinkSync('forge.config.js');

replaceOnce(
    'tests/windows-runtime-final.test.js',
    "    assert.equal(packageJson.build.win.icon, 'src/assets/logo.ico');\n",
    `    assert.equal(packageJson.build.win.icon, 'src/assets/logo.ico');\n    assert.deepEqual(packageJson.build.electronFuses, {\n        runAsNode: false,\n        enableCookieEncryption: true,\n        enableNodeOptionsEnvironmentVariable: false,\n        enableNodeCliInspectArguments: false,\n        enableEmbeddedAsarIntegrityValidation: true,\n        onlyLoadAppFromAsar: true,\n    });\n    assert.equal(packageJson.dependencies['electron-squirrel-startup'], undefined);\n    assert.equal(Object.keys(packageJson.devDependencies).some(name => name.startsWith('@electron-forge/')), false);\n    assert.equal(packageJson.devDependencies['@reforged/maker-appimage'], undefined);\n    assert.equal(indexSource.includes('electron-squirrel-startup'), false);\n`,
    'production packaging hardening assertions'
);

const readmePath = 'README.md';
const readme = readNormalized(readmePath);
const featuresStart = readme.indexOf('## Features');
const requirementsStart = readme.indexOf('## Requirements');
if (featuresStart < 0 || requirementsStart <= featuresStart) throw new Error('README feature section could not be located');
const features = `## Features\n\n- Gemini Live, Groq, and optional fully local AI with dynamic provider model discovery\n- Low-latency Windows system-audio loopback and microphone capture\n- Protected Windows Live HUD with always-on-top, click-through, taskbar hiding, and capture protection\n- Mica/Acrylic Windows presentation with solid fallbacks where system materials are unavailable\n- Live transcript context across Gemini, Groq Whisper, and local whisper.cpp paths\n- Instant, Balanced, and Detailed response modes plus Important/Decision/Action/Question markers\n- Multi-monitor/window capture selection, protected region analysis, and explicit copied-text context\n- Session Packs for goals, notes, and reusable session context\n- Local Knowledge Library with dependency-free retrieval for text, code, logs, CSV/JSON, SQL, YAML, and related text formats\n- Practice Lab generated and graded locally from knowledge sources or previous sessions\n- Session Review for topics, decisions, actions, questions, markers, and follow-up practice\n- Conversation and screen-analysis history stored locally\n- Windows DPAPI-backed API-key protection through Electron safeStorage\n- Production portable builds use electron-builder with hardened Electron fuses and ASAR integrity validation\n\n`;
fs.writeFileSync(readmePath, readme.slice(0, featuresStart) + features + readme.slice(requirementsStart), 'utf8');

console.log('Final readiness source, dependency, packaging, regression test, and README patches applied.');
