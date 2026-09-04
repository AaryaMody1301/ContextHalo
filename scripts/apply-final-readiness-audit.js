const fs = require('node:fs');

function replaceOnce(filePath, before, after, label) {
    const source = fs.readFileSync(filePath, 'utf8');
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

const regressionTest = `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\nconst path = require('node:path');\n\nfunction source() {\n    return fs.readFileSync(path.join(process.cwd(), 'src/utils/gemini.js'), 'utf8');\n}\n\ntest('Gemini Live typed prompts are preserved as session-history user turns', () => {\n    const gemini = source();\n    assert.match(gemini, /let pendingTypedPrompt = '';/);\n    assert.match(gemini, /pendingTypedPrompt = cleanText;/);\n    assert.match(gemini, /const turnInput = pendingTypedPrompt\\.trim\\(\\) \\|\\| currentTranscription\\.trim\\(\\);/);\n    assert.match(gemini, /saveConversationTurn\\(turnInput, messageBuffer\\);/);\n    assert.match(gemini, /if \\(pendingTypedPrompt === cleanText\\) pendingTypedPrompt = '';/);\n});\n`;
fs.writeFileSync('tests/typed-gemini-history.test.js', regressionTest, 'utf8');

const readmePath = 'README.md';
const readme = fs.readFileSync(readmePath, 'utf8');
const featuresStart = readme.indexOf('## Features');
const requirementsStart = readme.indexOf('## Requirements');
if (featuresStart < 0 || requirementsStart <= featuresStart) throw new Error('README feature section could not be located');
const features = `## Features\n\n- Gemini Live, Groq, and optional fully local AI with dynamic provider model discovery\n- Low-latency Windows system-audio loopback and microphone capture\n- Protected Windows Live HUD with always-on-top, click-through, taskbar hiding, and capture protection\n- Mica/Acrylic Windows presentation with solid fallbacks where system materials are unavailable\n- Live transcript context across Gemini, Groq Whisper, and local whisper.cpp paths\n- Instant, Balanced, and Detailed response modes plus Important/Decision/Action/Question markers\n- Multi-monitor/window capture selection, protected region analysis, and explicit copied-text context\n- Session Packs for goals, notes, and reusable session context\n- Local Knowledge Library with dependency-free retrieval for text, code, logs, CSV/JSON, SQL, YAML, and related text formats\n- Practice Lab generated and graded locally from knowledge sources or previous sessions\n- Session Review for topics, decisions, actions, questions, markers, and follow-up practice\n- Conversation and screen-analysis history stored locally\n- Windows DPAPI-backed API-key protection through Electron safeStorage\n\n`;
fs.writeFileSync(readmePath, readme.slice(0, featuresStart) + features + readme.slice(requirementsStart), 'utf8');

console.log('Final readiness source, regression test, and README patches applied.');
