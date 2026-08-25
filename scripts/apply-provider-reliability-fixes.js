const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src', 'utils', 'gemini.js');
let source = fs.readFileSync(file, 'utf8');
let changes = 0;

function replaceOptional(from, to) {
    if (source.includes(to)) return false;
    if (!source.includes(from)) return false;
    source = source.replace(from, to);
    changes += 1;
    return true;
}

replaceOptional('const GROQ_MAX_COMPLETION_TOKENS = 768;', 'const GROQ_MAX_COMPLETION_TOKENS = 2048;');
replaceOptional(
    "let groqTranscriptionInFlight = false;\nconst GROQ_EMPTY_RESPONSE_MESSAGE =",
    "let groqTranscriptionInFlight = false;\nlet groqRateLimitState = null;\nlet geminiSessionResumptionHandle = null;\nconst GROQ_EMPTY_RESPONSE_MESSAGE ="
);

if (!source.includes('function captureGroqRateLimitHeaders(')) {
    const marker = 'function formatGroqError(status, body, headers) {';
    if (source.includes(marker)) {
        source = source.replace(marker, `function captureGroqRateLimitHeaders(headers) {
    if (!headers || typeof headers.get !== 'function') return;
    const read = name => headers.get(name) || null;
    groqRateLimitState = {
        limitRequests: read('x-ratelimit-limit-requests'),
        remainingRequests: read('x-ratelimit-remaining-requests'),
        resetRequests: read('x-ratelimit-reset-requests'),
        limitTokens: read('x-ratelimit-limit-tokens'),
        remainingTokens: read('x-ratelimit-remaining-tokens'),
        resetTokens: read('x-ratelimit-reset-tokens'),
        retryAfter: read('retry-after'),
        updatedAt: Date.now(),
    };
    sendToRenderer('groq-rate-limit', groqRateLimitState);
}

${marker}`);
        changes += 1;
    }
}

// Capture provider quota telemetry from every Groq HTTP response without using
// local hard-coded quotas as a source of truth.
source = source.replace(
    /(const response = await fetch\('https:\/\/api\.groq\.com\/[^;]+;\n\s*)(const body = await response\.text\(\);)/g,
    (match, prefix, body) => {
        if (match.includes('captureGroqRateLimitHeaders')) return match;
        changes += 1;
        return `${prefix}captureGroqRateLimitHeaders(response.headers);\n        ${body}`;
    }
);

// Persistent line buffering: HTTP chunks may split a Server-Sent Event in the
// middle of a JSON line. Keep the unfinished line for the next read.
source = source.replace(
    /(const reader = response\.body\.getReader\(\);\n\s*const decoder = new TextDecoder\(\);\n)(\s*let fullText = '')/g,
    (match, prefix, full) => {
        if (match.includes('let sseBuffer')) return match;
        changes += 1;
        return `${prefix}        let sseBuffer = '';\n${full}`;
    }
);

source = source.replace(
    /const chunk = decoder\.decode\(value, \{ stream: true \}\);\n(\s*logTransportEvent\('groq\.(?:text|image)\.stream_chunk', \{) chunk( \}\);)\n\s*const lines = chunk\.split\('\\n'\)\.filter\(line => line\.trim\(\) !== ''\);/g,
    (match, before, after) => {
        if (match.includes('sseBuffer += chunk')) return match;
        changes += 1;
        return `const chunk = decoder.decode(value, { stream: true });\n${before} chunkLength: chunk.length${after}\n            sseBuffer += chunk;\n            const lines = sseBuffer.split(/\\r?\\n/);\n            sseBuffer = lines.pop() || '';\n            const completeLines = lines.filter(line => line.trim() !== '');`;
    }
);

// The existing for-loops should consume completeLines after buffering.
source = source.replace(/for \(const line of lines\) \{/g, (match, offset, whole) => {
    const prefix = whole.slice(Math.max(0, offset - 800), offset);
    if (prefix.includes('const completeLines = lines.filter')) {
        changes += 1;
        return 'for (const line of completeLines) {';
    }
    return match;
});

// Multi-part Live events and session-resumption handles.
if (!source.includes('message.serverContent?.modelTurn?.parts')) {
    const anchor = '        if (message.serverContent?.outputTranscription) {';
    if (source.includes(anchor)) {
        source = source.replace(anchor, `        const modelParts = message.serverContent?.modelTurn?.parts || [];
        for (const part of modelParts) {
            if (part?.text) sendToRenderer('update-response', { text: part.text });
        }
        if (message.serverContent?.sessionResumptionUpdate?.newHandle) {
            geminiSessionResumptionHandle = message.serverContent.sessionResumptionUpdate.newHandle;
        }

${anchor}`);
        changes += 1;
    }
}

if (!source.includes('sessionResumption: geminiSessionResumptionHandle')) {
    const anchor = '        generationConfig: {';
    if (source.includes(anchor)) {
        source = source.replace(anchor, `        sessionResumption: geminiSessionResumptionHandle
            ? { handle: geminiSessionResumptionHandle }
            : {},
${anchor}`);
        changes += 1;
    }
}

replaceOptional(
    "    groqConversationHistory = [];\n    currentTranscription = '';\n    groqRequestStartedForTurn = false;",
    "    groqConversationHistory = [];\n    currentTranscription = '';\n    groqRequestStartedForTurn = false;\n    groqRateLimitState = null;\n    geminiSessionResumptionHandle = null;"
);

if (changes === 0) {
    console.log('Provider reliability fixes already present.');
} else {
    fs.writeFileSync(file, source);
    console.log(`Provider reliability fixes applied: ${changes}`);
}
