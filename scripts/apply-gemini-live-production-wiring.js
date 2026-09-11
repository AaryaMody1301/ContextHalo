const fs = require('node:fs');
const path = require('node:path');

const file = path.resolve('src/utils/gemini.js');
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(oldText, newText, label) {
    const index = source.indexOf(oldText);
    if (index < 0) throw new Error(`Patch anchor not found: ${label}`);
    if (source.indexOf(oldText, index + oldText.length) >= 0) throw new Error(`Patch anchor is not unique: ${label}`);
    source = source.slice(0, index) + newText + source.slice(index + oldText.length);
}

replaceOnce(
    "    assertCurrentRequest, getRequestMetadata, getRequestSignal } = require('./sessionRequests');\nlet liveGeneration = 0;\nlet reconnectPromise = null;",
    "    assertCurrentRequest, getRequestMetadata, getRequestSignal } = require('./sessionRequests');\nconst { createGeminiLiveRuntime } = require('./geminiLiveRuntime');\nlet liveGeneration = 0;\nlet manualReconnectPromise = null;",
    'runtime import and manual reconnect promise'
);

replaceOnce(
    "let groqRateLimitState = null;\nlet geminiSessionResumptionHandle = null;\nlet lastGeminiInitializationError = '';",
    "let groqRateLimitState = null;\nlet geminiLiveRuntime = null;\nlet lastGeminiInitializationError = '';",
    'runtime state'
);

replaceOnce(
    "// Reconnection variables\nlet isUserClosing = false;\nlet sessionParams = null;\nlet reconnectAttempts = 0;\nconst MAX_RECONNECT_ATTEMPTS = 2;",
    "// Reconnection variables\nlet isUserClosing = false;\nlet sessionParams = null;",
    'remove lifetime reconnect ceiling'
);

replaceOnce(
    "const httpStatus = number || Number(text.match(/\\b(400|401|403|404|408|429|500|502|503|504)\\b/)?.[1]) || null;",
    "const httpStatus = number || Number(text.match(/\\b(400|401|403|404|408|409|429|500|502|503|504)\\b/)?.[1]) || null;",
    'parse HTTP 409'
);

replaceOnce(
    "    } else if (httpStatus === 404 || /model_not_found|model.+not found/.test(text)) category = 'model-unavailable';\n    else if ((httpStatus === 400 || socketCode === 1007 || socketCode === 1008) && /tool|google.?search|grounding/.test(text)) category = 'unsupported-tool';",
    "    } else if (httpStatus === 404 || /model_not_found|model.+not found/.test(text)) category = 'model-unavailable';\n    else if (httpStatus === 409 && /\\baborted\\b/.test(text) && !/already[_ -]?exists/.test(text)) category = 'aborted-conflict';\n    else if ((httpStatus === 400 || socketCode === 1007 || socketCode === 1008) && /tool|google.?search|grounding/.test(text)) category = 'unsupported-tool';",
    'classify ABORTED conflict'
);

replaceOnce(
    "        'model-unavailable': 'The configured Gemini model is unavailable to this project. Select a supported model in Home; your saved model has not been changed.',\n        'unsupported-tool':",
    "        'model-unavailable': 'The configured Gemini model is unavailable to this project. Select a supported model in Home; your saved model has not been changed.',\n        'aborted-conflict': 'Gemini interrupted the Live connection because of a transient session conflict. ContextHalo will reconnect without ending the interview.',\n        'unsupported-tool':",
    'ABORTED message'
);

replaceOnce(
    "    const retryable = ['throttled', 'transient'].includes(category);",
    "    const retryable = ['throttled', 'transient', 'aborted-conflict'].includes(category);",
    'ABORTED retryability'
);

replaceOnce(
    "    if (!isReconnect) {\n        geminiSessionResumptionHandle = null;\n        sessionParams = { apiKey, customPrompt, profile, language, provider: 'byok' };\n        reconnectAttempts = 0;\n    }",
    "    if (!isReconnect) {\n        geminiLiveRuntime?.stop();\n        geminiLiveRuntime = null;\n        sessionParams = { apiKey, customPrompt, profile, language, provider: 'byok' };\n    }",
    'reset runtime for new session'
);

replaceOnce(
    "    const liveModel = String(getConfig().geminiLiveModel || 'gemini-3.1-flash-live-preview').replace(/^models\\//, '').trim();\n    const current = () => generation === liveGeneration && !signal.aborted;",
    "    const liveModel = String(getConfig().geminiLiveModel || 'gemini-3.1-flash-live-preview').replace(/^models\\//, '').trim();\n    if (!geminiLiveRuntime) {\n        geminiLiveRuntime = createGeminiLiveRuntime({\n            reconnect: async details => {\n                const success = await attemptReconnect(details);\n                if (!success) throw failureError(lastGeminiFailure || classifyGeminiFailure(new Error('Gemini reconnect failed'), 'live', liveModel));\n            },\n            normalizeFailure: error => classifyGeminiFailure(error, 'live', liveModel),\n            publishState(state, detail) {\n                if (state === 'reconnecting') {\n                    publishProviderState('reconnecting');\n                    sendToRenderer('update-status', 'Gemini connection interrupted; reconnecting…');\n                } else if (state === 'failed') {\n                    lastGeminiFailure = detail || lastGeminiFailure;\n                    publishProviderState('failed', lastGeminiFailure);\n                    if (lastGeminiFailure?.message) sendToRenderer('update-status', lastGeminiFailure.message);\n                }\n            },\n        });\n    }\n    const current = () => generation === liveGeneration && !signal.aborted;",
    'create Live runtime'
);

const callbacksStart = source.indexOf('        const callbacks = {\n', source.indexOf('async function initializeGeminiSession'));
const toolsAnchor = '        const tools = await getEnabledTools();\n';
const callbacksEnd = source.indexOf(toolsAnchor, callbacksStart);
if (callbacksStart < 0 || callbacksEnd < 0) throw new Error('Could not locate Gemini Live callbacks block');
const oldCallbacks = source.slice(callbacksStart, callbacksEnd);
const newCallbacks = `        const callbacks = geminiLiveRuntime.callbacks({\n            current,\n            onopen() {\n                liveSessionReady = true;\n                if (current()) sendToRenderer('update-status', 'Gemini connected; preparing the session...');\n            },\n            onmessage(message) {\n                if (!current()) return;\n                const interim = extractGeminiTranscript(message, 'interimInputTranscription');\n                const finalText = extractGeminiTranscript(message, 'inputTranscription');\n                if (interim) emitLiveTranscript({ provider: 'gemini', text: interim, final: false, timestamp: Date.now() });\n                if (finalText) {\n                    emitLiveTranscript({ provider: 'gemini', text: finalText, final: true, timestamp: Date.now() });\n                    currentTranscription += message.serverContent?.inputTranscription?.text || finalText;\n                }\n                const grounding = groundingFromResponse(message);\n                if (grounding) {\n                    liveGrounding = grounding;\n                    if (messageBuffer) sendToRenderer('update-response', messageBuffer, { requestId: liveResponseId, kind: 'voice', grounding });\n                }\n                const content = message.serverContent || {};\n                for (const part of content.modelTurn?.parts || []) {\n                    if (part?.text && !part.thought) modelTextBuffer += part.text;\n                }\n                if (content.outputTranscription?.text) audioTextBuffer += content.outputTranscription.text;\n                // Some Live models emit both text parts and an audio transcript.\n                // They are alternative views, not two strings to concatenate.\n                const visible = audioTextBuffer || modelTextBuffer;\n                if (visible && visible !== messageBuffer) {\n                    const isFirstChunk = messageBuffer === '';\n                    messageBuffer = visible;\n                    sendToRenderer(isFirstChunk ? 'new-response' : 'update-response', messageBuffer,\n                        { requestId: liveResponseId, kind: 'voice', grounding: liveGrounding });\n                }\n                // generationComplete can precede the final transcription. Save\n                // once at turnComplete (or interruption), not at generationComplete.\n                if (content.turnComplete || content.interrupted) {\n                    if (currentTranscription.trim() && messageBuffer.trim()) {\n                        saveConversationTurn(currentTranscription, messageBuffer, liveGrounding);\n                    }\n                    currentTranscription = '';\n                    messageBuffer = '';\n                    modelTextBuffer = '';\n                    audioTextBuffer = '';\n                    liveGrounding = undefined;\n                    liveResponseId = randomUUID();\n                    sendToRenderer('update-status', content.interrupted ? 'Response interrupted' : 'Gemini ready');\n                }\n            },\n            onerror(error, recovery) {\n                if (!current() || !liveSessionReady) return;\n                lastGeminiFailure = classifyGeminiFailure(error, 'live', liveModel);\n                if (lastGeminiFailure.retryAt > Date.now()) {\n                    geminiCooldowns.set(cooldownKey(apiKey, liveModel), lastGeminiFailure);\n                }\n                if (!recovery?.recoverable) {\n                    publishProviderState('failed', lastGeminiFailure);\n                    sendToRenderer('update-status', lastGeminiFailure.message);\n                }\n            },\n            onclose(event, recovery) {\n                if (!current() || !liveSessionReady || isUserClosing) return;\n                global.geminiSessionRef.current = null;\n                lastGeminiFailure = classifyGeminiFailure(event, 'live', liveModel);\n                if (lastGeminiFailure.retryAt > Date.now()) {\n                    geminiCooldowns.set(cooldownKey(apiKey, liveModel), lastGeminiFailure);\n                }\n                if (!recovery?.recoverable) {\n                    publishProviderState('failed', lastGeminiFailure);\n                    sendToRenderer('update-status', lastGeminiFailure.message);\n                }\n            },\n        });\n`;
source = source.slice(0, callbacksStart) + newCallbacks + source.slice(callbacksEnd);

replaceOnce(
    "            config: { responseModalities: [Modality.AUDIO], inputAudioTranscription: {}, outputAudioTranscription: {},\n                systemInstruction: instruction, ...(tools.length ? { tools } : {}) },",
    "            config: { responseModalities: [Modality.AUDIO], inputAudioTranscription: {}, outputAudioTranscription: {},\n                ...geminiLiveRuntime.getConnectConfig(), systemInstruction: instruction, ...(tools.length ? { tools } : {}) },",
    'activate compression and session resumption'
);

replaceOnce(
    "async function attemptReconnect() {\n    const params = sessionParams;\n    if (!params?.apiKey || isUserClosing) return false;\n    liveGeneration++;\n    liveController.abort();\n    liveController = new AbortController();",
    "async function attemptReconnect(details = {}) {\n    const params = sessionParams;\n    if (!params?.apiKey || isUserClosing) return false;\n    const usedResumption = details.usedResumption ?? Boolean(geminiLiveRuntime?.getConnectConfig?.().sessionResumption?.handle);\n    geminiLiveRuntime?.cancelScheduledReconnect?.();\n    liveGeneration++;\n    liveController.abort();\n    liveController = new AbortController();\n    const previousSession = global.geminiSessionRef?.current;\n    global.geminiSessionRef.current = null;\n    if (previousSession) { try { previousSession.close(); } catch {} }",
    'runtime-aware reconnect'
);

replaceOnce(
    "    const contextMessage = buildContextMessage();\n    if (contextMessage) {",
    "    const contextMessage = usedResumption ? null : buildContextMessage();\n    if (contextMessage) {",
    'avoid duplicate history after server resumption'
);

replaceOnce(
    "            sessionParams = { language, profile, customPrompt, provider: 'groq' };\n            reconnectAttempts = 0;\n            groqSystemAudioBuffer = Buffer.alloc(0);",
    "            sessionParams = { language, profile, customPrompt, provider: 'groq' };\n            groqSystemAudioBuffer = Buffer.alloc(0);",
    'remove Groq reconnect counter reset'
);

replaceOnce(
    "        sessionParams = null;\n        currentTranscription = '';\n        messageBuffer = '';",
    "        sessionParams = null;\n        geminiLiveRuntime?.stop();\n        geminiLiveRuntime = null;\n        manualReconnectPromise = null;\n        currentTranscription = '';\n        messageBuffer = '';",
    'stop runtime on session close'
);

const retryStart = source.indexOf("    register('retry-session-connection', async (_event, options = {}) => {");
const retryEndAnchor = "\n    });\n\n}\n\nmodule.exports = {";
const retryEnd = source.indexOf(retryEndAnchor, retryStart);
if (retryStart < 0 || retryEnd < 0) throw new Error('Could not locate manual reconnect handler');
const oldRetry = source.slice(retryStart, retryEnd + "\n    });".length);
const newRetry = `    register('retry-session-connection', async (_event, options = {}) => {\n        if (!options || typeof options !== 'object' || typeof options.withoutSearch !== 'boolean') return { success: false, error: 'Invalid recovery options' };\n        if (currentProviderMode !== 'byok' || !sessionParams?.apiKey || !mainSessionActive) return { success: false, error: 'No Gemini session to reconnect' };\n        if (manualReconnectPromise) return manualReconnectPromise.then(success => ({ success, failure: lastGeminiFailure, search: { ...searchState } }));\n        const model = String(getConfig().geminiLiveModel || 'gemini-3.1-flash-live-preview').replace(/^models\\//, '').trim();\n        const cooldown = geminiCooldowns.get(cooldownKey(sessionParams.apiKey, model));\n        if (cooldown?.retryAt > Date.now()) return { success: false, error: cooldown.message, failure: cooldown };\n        geminiLiveRuntime?.cancelScheduledReconnect?.();\n        if (options.withoutSearch) {\n            searchState = { ...searchState, effective: false, status: 'user-disabled' };\n            currentSystemPrompt = getSystemPrompt(currentProfile, currentCustomPrompt, false);\n            sendToRenderer('search-state', { ...searchState });\n        }\n        // Do not reset history, drafts, capture, HTTP epochs or provider identity.\n        const usedResumption = Boolean(geminiLiveRuntime?.getConnectConfig?.().sessionResumption?.handle);\n        manualReconnectPromise = attemptReconnect({ reason: 'manual', usedResumption })\n            .catch(() => false)\n            .finally(() => { manualReconnectPromise = null; });\n        const success = await manualReconnectPromise;\n        return { success, error: success ? undefined : lastGeminiFailure?.message, failure: lastGeminiFailure, search: { ...searchState } };\n    });`;
source = source.slice(0, retryStart) + newRetry + source.slice(retryEnd + "\n    });".length);

for (const forbidden of ['MAX_RECONNECT_ATTEMPTS', 'reconnectAttempts', 'geminiSessionResumptionHandle']) {
    if (source.includes(forbidden)) throw new Error(`Legacy reconnect symbol remains: ${forbidden}`);
}
if (!source.includes('geminiLiveRuntime.getConnectConfig()')) throw new Error('Live reliability config was not wired');
if (!source.includes("category = 'aborted-conflict'")) throw new Error('409 ABORTED classification was not wired');

fs.writeFileSync(file, source);
console.log('Gemini Live production wiring applied.');
