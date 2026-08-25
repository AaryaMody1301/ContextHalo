const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src', 'utils', 'gemini.js');
let source = fs.readFileSync(file, 'utf8');
let changes = 0;

function replaceOnce(from, to, label) {
    if (source.includes(to)) return;
    if (!source.includes(from)) throw new Error(`Expected source pattern not found: ${label}`);
    source = source.replace(from, to);
    changes += 1;
}

replaceOnce(
    'const GROQ_MAX_COMPLETION_TOKENS = 768;',
    'const GROQ_MAX_COMPLETION_TOKENS = 2048;',
    'Groq completion-token limit'
);

replaceOnce(
    "let groqTranscriptionInFlight = false;\nconst GROQ_EMPTY_RESPONSE_MESSAGE =",
    "let groqTranscriptionInFlight = false;\nlet groqRateLimitState = null;\nlet geminiSessionResumptionHandle = null;\nconst GROQ_EMPTY_RESPONSE_MESSAGE =",
    'provider reliability state'
);

replaceOnce(
    "function formatGroqError(status, body, headers) {",
    `function captureGroqRateLimitHeaders(headers) {
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

function formatGroqError(status, body, headers) {`,
    'Groq rate-limit telemetry helper'
);

replaceOnce(
    "        const body = await response.text();\n        if (!response.ok) {",
    "        captureGroqRateLimitHeaders(response.headers);\n        const body = await response.text();\n        if (!response.ok) {",
    'Groq response header capture'
);

// Replace both fragile streaming loops. A persistent buffer is required because
// fetch stream chunks are not guaranteed to align with SSE event boundaries.
const textPattern = `        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let isFirst = true;
        let finishReason = null;`;
const textReplacement = `        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let fullText = '';
        let isFirst = true;
        let finishReason = null;`;
replaceOnce(textPattern, textReplacement, 'text SSE buffer');
replaceOnce(textPattern, textReplacement, 'image SSE buffer');

const oldTextChunk = `            const chunk = decoder.decode(value, { stream: true });
            logTransportEvent('groq.text.stream_chunk', { chunk });
            const lines = chunk.split('\\n').filter(line => line.trim() !== '');

            for (const line of lines) {`;
const newTextChunk = `            const chunk = decoder.decode(value, { stream: true });
            logTransportEvent('groq.text.stream_chunk', { chunkLength: chunk.length });
            sseBuffer += chunk;
            const events = sseBuffer.split(/\\r?\\n\\r?\\n/);
            sseBuffer = events.pop() || '';

            for (const event of events) {
                const lines = event.split(/\\r?\\n/).filter(line => line.trim() !== '');
                for (const line of lines) {`;
const oldTextClose = `                }
            }
        }

        if (fullText.trim()) {`;
const newTextClose = `                }
            }
            }
        }

        if (sseBuffer.trim()) {
            const trailing = sseBuffer.split(/\\r?\\n/).filter(line => line.startsWith('data: '));
            for (const line of trailing) {
                const data = line.slice(6).trim();
                if (data && data !== '[DONE]') {
                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed?.choices?.[0]?.delta?.content;
                        if (delta) fullText += delta;
                    } catch { /* incomplete trailing event is intentionally ignored */ }
                }
            }
        }

        if (fullText.trim()) {`;
replaceOnce(oldTextChunk, newTextChunk, 'text SSE chunk parsing');
replaceOnce(oldTextClose, newTextClose, 'text SSE trailing parsing');

const oldImageChunk = `            const chunk = decoder.decode(value, { stream: true });
            logTransportEvent('groq.image.stream_chunk', { chunk });
            const lines = chunk.split('\\n').filter(line => line.trim() !== '');

            for (const line of lines) {`;
const newImageChunk = `            const chunk = decoder.decode(value, { stream: true });
            logTransportEvent('groq.image.stream_chunk', { chunkLength: chunk.length });
            sseBuffer += chunk;
            const events = sseBuffer.split(/\\r?\\n\\r?\\n/);
            sseBuffer = events.pop() || '';

            for (const event of events) {
                const lines = event.split(/\\r?\\n/).filter(line => line.trim() !== '');
                for (const line of lines) {`;
replaceOnce(oldImageChunk, newImageChunk, 'image SSE chunk parsing');

// The image loop has the same structural close before its fullText check.
replaceOnce(oldTextClose, newTextClose, 'image SSE trailing parsing');

// Avoid retaining stale provider-specific state when a session is explicitly closed.
replaceOnce(
    "    groqConversationHistory = [];\n    currentTranscription = '';\n    groqRequestStartedForTurn = false;",
    "    groqConversationHistory = [];\n    currentTranscription = '';\n    groqRequestStartedForTurn = false;\n    groqRateLimitState = null;\n    geminiSessionResumptionHandle = null;",
    'provider state cleanup'
);

// Multi-part Live events: keep the existing transcript handling, but also emit
// text parts from modelTurn so newer Live responses are not silently ignored.
const liveAnchor = "        if (message.serverContent?.outputTranscription) {";
if (!source.includes("modelTurn?.parts")) {
    if (!source.includes(liveAnchor)) throw new Error('Expected Live event anchor not found');
    source = source.replace(liveAnchor, `        const modelParts = message.serverContent?.modelTurn?.parts || [];
        for (const part of modelParts) {
            if (part?.text) {
                sendToRenderer('update-response', { text: part.text });
            }
        }

        if (message.serverContent?.sessionResumptionUpdate?.newHandle) {
            geminiSessionResumptionHandle = message.serverContent.sessionResumptionUpdate.newHandle;
        }

${liveAnchor}`);
    changes += 1;
}

// Request Live session resumption where supported. The handle is only sent when
// one has been issued; a normal fresh connection remains the fallback.
if (!source.includes('sessionResumption: geminiSessionResumptionHandle')) {
    const configAnchor = '        generationConfig: {';
    if (source.includes(configAnchor)) {
        source = source.replace(configAnchor, `        sessionResumption: geminiSessionResumptionHandle
            ? { handle: geminiSessionResumptionHandle }
            : {},
${configAnchor}`);
        changes += 1;
    }
}

fs.writeFileSync(file, source);
console.log(`Provider reliability fixes applied: ${changes}`);
