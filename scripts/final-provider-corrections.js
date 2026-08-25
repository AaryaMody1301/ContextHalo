const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src', 'utils', 'gemini.js');
let source = fs.readFileSync(file, 'utf8');
let changes = 0;

function addOnce(anchor, insertion) {
    if (source.includes(insertion.trim())) return;
    if (!source.includes(anchor)) throw new Error(`Missing expected anchor: ${anchor.slice(0, 80)}`);
    source = source.replace(anchor, insertion);
    changes += 1;
}

source = source.replace(
    /        \}\);\n\n        if \(!response\.ok\) \{/g,
    (match, offset, whole) => {
        const before = whole.slice(Math.max(0, offset - 1500), offset);
        if (!before.includes("https://api.groq.com/openai/v1/chat/completions")) return match;
        if (before.includes('captureGroqRateLimitHeaders(response.headers);')) return match;
        changes += 1;
        return '        });\n\n        captureGroqRateLimitHeaders(response.headers);\n        if (!response.ok) {';
    }
);

addOnce(
    "                    if (currentProviderMode !== 'groq' && message.serverContent?.outputTranscription?.text) {",
    `                    const modelParts = message.serverContent?.modelTurn?.parts || [];
                    for (const part of modelParts) {
                        if (part?.text && currentProviderMode !== 'groq') {
                            const isFirstChunk = messageBuffer === '';
                            messageBuffer += part.text;
                            sendToRenderer(isFirstChunk ? 'new-response' : 'update-response', messageBuffer);
                        }
                    }

                    const resumeHandle = message.sessionResumptionUpdate?.newHandle
                        || message.serverContent?.sessionResumptionUpdate?.newHandle;
                    if (resumeHandle) geminiSessionResumptionHandle = resumeHandle;

                    if (currentProviderMode !== 'groq' && message.serverContent?.outputTranscription?.text) {`
);

addOnce(
    "                outputAudioTranscription: {},\n                tools: enabledTools,",
    `                outputAudioTranscription: {},
                sessionResumption: geminiSessionResumptionHandle
                    ? { handle: geminiSessionResumptionHandle }
                    : {},
                tools: enabledTools,`
);

addOnce(
    "    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {\n        return attemptReconnect();\n    }",
    `    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        return attemptReconnect();
    }

    if (geminiSessionResumptionHandle) {
        console.warn('Discarding stale Gemini session resumption handle after repeated failures');
        geminiSessionResumptionHandle = null;
    }`
);

if (changes === 0) {
    console.log('Final provider corrections already present.');
} else {
    fs.writeFileSync(file, source);
    console.log(`Final provider corrections applied: ${changes}`);
}

// Full-build validation trigger for the final patched source.
