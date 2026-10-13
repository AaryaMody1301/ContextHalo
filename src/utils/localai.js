const fs = require('fs');
const path = require('path');
const { randomBytes } = require('node:crypto');
const { readSseJson } = require('./sse');
const { assertChatCompletionOutcome } = require('./chatCompletionOutcome');
const { runSessionRequest, assertCurrentRequest, requestIsCurrent, getRequestSignal, markFirstResponse, recordRequestUsage } = require('./sessionRequests');
const { getSystemPrompt } = require('./prompts');
const { sendToRenderer, initializeNewSession, saveConversationTurn } = require('./gemini');
const {
    ensureNativeBinary,
    ensureLlamaModel,
    ensureWhisperModel,
    getAvailablePort,
    getModelsDirectory,
    startNativeServer,
    stopNativeServer,
    waitForServer,
} = require('./native-ai-runtime');

let llamaProcess = null;
let llamaBaseUrl = null;
let llamaApiKey = null;
let llamaModel = null;
let whisperProcess = null;
let whisperBaseUrl = null;
let localConversationHistory = [];
let currentSystemPrompt = null;
let currentLanguage = 'en';
let isLocalActive = false;
let initializationController = null;
let initializationFailure = null;

let isSpeaking = false;
let speechBuffers = [];
let silenceFrameCount = 0;
let speechFrameCount = 0;
let speechBytes = 0;

const LOCAL_MAX_HISTORY_MESSAGES = 8;
const LOCAL_MAX_HISTORY_CHARS = 9000;
const LOCAL_MAX_OUTPUT_TOKENS = 768;
const LOCAL_CONTEXT_TOKENS = 8192;
const LOCAL_FAST_CONTEXT_TOKENS = 4096;

const VAD_MODES = {
    NORMAL: { energyThreshold: 0.01, speechFramesRequired: 3, silenceFramesRequired: 30 },
    LOW_BITRATE: { energyThreshold: 0.008, speechFramesRequired: 4, silenceFramesRequired: 35 },
    AGGRESSIVE: { energyThreshold: 0.015, speechFramesRequired: 2, silenceFramesRequired: 20 },
    VERY_AGGRESSIVE: { energyThreshold: 0.02, speechFramesRequired: 2, silenceFramesRequired: 10 },
};

let vadConfig = VAD_MODES.VERY_AGGRESSIVE;
let resampleRemainder = Buffer.alloc(0);

function resample24kTo16k(inputBuffer) {
    const combined = Buffer.concat([resampleRemainder, inputBuffer]);
    const inputSamples = Math.floor(combined.length / 2);
    const outputSamples = Math.floor((inputSamples * 2) / 3);
    const outputBuffer = Buffer.alloc(outputSamples * 2);

    for (let i = 0; i < outputSamples; i++) {
        const sourcePosition = (i * 3) / 2;
        const sourceIndex = Math.floor(sourcePosition);
        const fraction = sourcePosition - sourceIndex;
        const firstSample = combined.readInt16LE(sourceIndex * 2);
        const secondSample = sourceIndex + 1 < inputSamples ? combined.readInt16LE((sourceIndex + 1) * 2) : firstSample;
        const interpolated = Math.round(firstSample + fraction * (secondSample - firstSample));
        outputBuffer.writeInt16LE(Math.max(-32768, Math.min(32767, interpolated)), i * 2);
    }

    const consumedInputSamples = Math.ceil((outputSamples * 3) / 2);
    const remainderStart = consumedInputSamples * 2;
    resampleRemainder = remainderStart < combined.length ? combined.slice(remainderStart) : Buffer.alloc(0);

    return outputBuffer;
}

function calculateRms(pcm16Buffer) {
    const samples = pcm16Buffer.length / 2;
    if (samples === 0) return 0;

    let sumSquares = 0;
    for (let i = 0; i < samples; i++) {
        const sample = pcm16Buffer.readInt16LE(i * 2) / 32768;
        sumSquares += sample * sample;
    }

    return Math.sqrt(sumSquares / samples);
}

function processVad(pcm16kBuffer) {
    const rms = calculateRms(pcm16kBuffer);
    const isVoice = rms > vadConfig.energyThreshold;

    if (isVoice) {
        speechFrameCount += 1;
        silenceFrameCount = 0;

        if (!isSpeaking && speechFrameCount >= vadConfig.speechFramesRequired) {
            isSpeaking = true;
            speechBuffers = [];
            speechBytes = 0;
            console.log('[LocalAI] Speech started (RMS:', rms.toFixed(4), ')');
            sendToRenderer('update-status', 'Listening... (speech detected)');
        }
    } else {
        silenceFrameCount += 1;
        speechFrameCount = 0;

        if (isSpeaking && silenceFrameCount >= vadConfig.silenceFramesRequired) {
            isSpeaking = false;
            const audioData = Buffer.concat(speechBuffers);
            speechBuffers = [];
            speechBytes = 0;
            console.log('[LocalAI] Speech ended, accumulated', audioData.length, 'bytes');
            sendToRenderer('update-status', 'Transcribing...');
            handleSpeechEnd(audioData);
            return;
        }
    }

    if (isSpeaking) {
        speechBuffers.push(Buffer.from(pcm16kBuffer));
        speechBytes += pcm16kBuffer.length;
        if (speechBytes >= 16000 * 2 * 35) {
            const audio = Buffer.concat(speechBuffers);
            speechBuffers = [];
            speechBytes = 0;
            isSpeaking = false;
            speechFrameCount = 0;
            void handleSpeechEnd(audio);
        }
    }
}

function createWavBuffer(pcm16Buffer) {
    const header = Buffer.alloc(44);
    const byteRate = 16000 * 2;

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm16Buffer.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(16000, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm16Buffer.length, 40);

    return Buffer.concat([header, pcm16Buffer]);
}

async function transcribeAudio(pcm16kBuffer) {
    if (!whisperBaseUrl) {
        throw new Error('Whisper server is not running');
    }

    const wavBuffer = createWavBuffer(pcm16kBuffer);
    const formData = new FormData();
    formData.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'speech.wav');
    formData.append('response_format', 'json');
    formData.append('temperature', '0.0');
    formData.append('language', currentLanguage || 'en');

    const response = await fetch(`${whisperBaseUrl}/inference`, {
        method: 'POST',
        signal: getRequestSignal(),
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`Whisper server returned HTTP ${response.status}`);
    }

    const result = await response.json();
    const text = result.text?.trim() || '';
    return text;
}

function handleSpeechEnd(audioData) {
    return runSessionRequest('voice', () => handleSpeechEndNow(audioData), { timeoutMs: 180000 }).catch(error => {
        if (error.name !== 'AbortError') sendToRenderer('update-status', error.message);
    });
}

async function handleSpeechEndNow(audioData) {
    if (!isLocalActive) return;

    if (audioData.length < 16000) {
        console.log('[LocalAI] Audio too short, skipping');
        sendToRenderer('update-status', 'Listening...');
        return;
    }

    try {
        const transcription = await transcribeAudio(audioData);
        assertCurrentRequest();

        if (!transcription || transcription.length < 2) {
            console.log('[LocalAI] Empty transcription, skipping');
            sendToRenderer('update-status', 'Listening...');
            return;
        }

        sendToRenderer('update-status', 'Generating response...');
        await sendToLlama(transcription);
    } catch (error) {
        console.warn('[LocalAI] Transcription error:');
        sendToRenderer('update-status', 'Transcription error: ' + error.message);
    }
}

async function readStreamingResponse(response, onText) {
    let fullText = '';
    let finishReason;
    for await (const event of readSseJson(response.body, getRequestSignal())) {
        assertCurrentRequest();
        finishReason = event.choices?.[0]?.finish_reason || finishReason;
        recordRequestUsage({ inputTokens: event.usage?.prompt_tokens, outputTokens: event.usage?.completion_tokens, totalTokens: event.usage?.total_tokens });
        assertChatCompletionOutcome(finishReason, 'local');
        const token = event.choices?.[0]?.delta?.content || '';
        if (token) { markFirstResponse(); fullText += token; onText(fullText); }
    }
    assertCurrentRequest();
    assertChatCompletionOutcome(finishReason, 'local', true);
    if (!fullText.trim()) throw new Error('Local model returned no text. Try a shorter prompt or another model.');
    return fullText;
}

function trimLocalHistory(history) {
    let chars = 0;
    const kept = [];
    for (let index = history.length - 1; index >= 0 && kept.length < LOCAL_MAX_HISTORY_MESSAGES; index--) {
        const message = history[index];
        const content = typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content || '');
        if (kept.length && chars + content.length > LOCAL_MAX_HISTORY_CHARS) break;
        if (!kept.length && content.length > LOCAL_MAX_HISTORY_CHARS) {
            // Trim older history, never the question the user actually asked.
            kept.unshift(message);
            break;
        }
        chars += content.length;
        kept.unshift(message);
    }
    return kept;
}

async function requestLlama(messages, onText) {
    if (!llamaBaseUrl) {
        throw new Error('Llama server is not running');
    }

    const response = await fetch(`${llamaBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        signal: getRequestSignal(),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llamaApiKey}` },
        body: JSON.stringify({
            model: 'local',
            messages,
            stream: true,
            max_tokens: LOCAL_MAX_OUTPUT_TOKENS,
            cache_prompt: true,
            chat_template_kwargs: {
                enable_thinking: false,
            },
        }),
    });

    if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`Llama server returned HTTP ${response.status}. Check the local runner and retry.`);
    }

    return readStreamingResponse(response, onText);
}

async function sendToLlama(transcription) {
    let requestHistory = [...localConversationHistory];
    requestHistory.push({
        role: 'user',
        content: transcription.trim(),
    });

    requestHistory = trimLocalHistory(requestHistory);

    try {
        const messages = [{ role: 'system', content: currentSystemPrompt || 'You are a helpful assistant.' }, ...requestHistory];

        let isFirst = true;
        const fullText = await requestLlama(messages, text => {
            sendToRenderer(isFirst ? 'new-response' : 'update-response', text);
            isFirst = false;
        });

        assertCurrentRequest();
        if (fullText.trim()) {
            localConversationHistory = [...trimLocalHistory([...localConversationHistory, requestHistory.at(-1)]), { role: 'assistant', content: fullText.trim() }];
            saveConversationTurn(transcription, fullText);
        }

        sendToRenderer('update-status', 'Listening...');
        return fullText;
    } catch (error) {
        console.warn('[LocalAI] Llama error:');
        sendToRenderer('update-status', 'Local AI error: ' + error.message);
        throw error;
    }
}

function formatDownloadStatus(label, progress) {
    if (!progress.expectedBytes) {
        return `Downloading ${label}...`;
    }

    const percentage = Math.floor((progress.downloadedBytes / progress.expectedBytes) * 100);
    return `Downloading ${label}... ${percentage}%`;
}

function sendDownloadProgress(label, progress = null) {
    const percentage = progress?.expectedBytes ? Math.min(100, Math.floor((progress.downloadedBytes / progress.expectedBytes) * 100)) : null;
    sendToRenderer('local-ai-download-progress', {
        active: true,
        label,
        percentage,
    });
}

async function prepareNativeFiles(llamaModelReference, whisperModel, signal, onStage) {
    const binaryProgress = label => progress => {
        signal.throwIfAborted();
        onStage(label);
        sendToRenderer('update-status', formatDownloadStatus(label, progress));
        sendDownloadProgress(label, progress);
    };

    sendDownloadProgress('Checking Llama runner');
    onStage('Llama runner');
    const llamaBinaryPath = await ensureNativeBinary('llama', binaryProgress('Llama runner'), signal);
    signal.throwIfAborted();

    sendDownloadProgress('Checking Whisper runner');
    onStage('Whisper runner');
    const whisperBinaryPath = await ensureNativeBinary('whisper', binaryProgress('Whisper runner'), signal);
    signal.throwIfAborted();

    let whisperModelPath;
    sendToRenderer('whisper-downloading', true);
    try {
        sendDownloadProgress('Checking Whisper model');
        onStage('Whisper model');
        whisperModelPath = await ensureWhisperModel(whisperModel, binaryProgress('Whisper model'), signal);
    } finally {
        if (!signal.aborted) sendToRenderer('whisper-downloading', false);
    }
    signal.throwIfAborted();

    sendDownloadProgress('Checking language model');
    onStage('Language model');
    const llamaFiles = await ensureLlamaModel(llamaModelReference, binaryProgress('Language model'), binaryProgress('Vision model'), signal);
    return {
        llamaBinaryPath,
        whisperBinaryPath,
        whisperModelPath,
        llamaModelPath: llamaFiles.modelPath,
        projectorPath: llamaFiles.projectorPath,
    };
}

function validatePreparedNativeFiles(nativeFiles) {
    const requiredFiles = [
        ['Llama runner', nativeFiles.llamaBinaryPath],
        ['Whisper runner', nativeFiles.whisperBinaryPath],
        ['Whisper model', nativeFiles.whisperModelPath],
        ['Language model', nativeFiles.llamaModelPath],
        ['Vision model', nativeFiles.projectorPath],
    ];

    for (const [label, filePath] of requiredFiles) {
        if (!filePath || !fs.existsSync(filePath)) {
            throw new Error(`${label} path is invalid: ${filePath}`);
        }
    }
}

async function startWhisperServer(executablePath, modelPath, signal) {
    const port = await getAvailablePort();
    signal.throwIfAborted();
    // The pinned Whisper server has no authentication; keep all routes behind an unguessable session path.
    const requestPath = '/' + randomBytes(24).toString('hex');
    whisperBaseUrl = `http://127.0.0.1:${port}${requestPath}`;
    whisperProcess = startNativeServer({
        executablePath,
        arguments: ['-m', modelPath, '--host', '127.0.0.1', '--port', String(port), '--request-path', requestPath],
        name: 'Whisper',
    });

    await waitForServer(`${whisperBaseUrl}/health`, whisperProcess, 120000, signal);
}

function localContextTokens(modelReference) {
    return /Qwen3\.5-(?:0\.8B|2B)-/i.test(String(modelReference || '')) ? LOCAL_FAST_CONTEXT_TOKENS : LOCAL_CONTEXT_TOKENS;
}

async function startLlamaServer(executablePath, modelPath, projectorPath, signal) {
    if (!modelPath || !fs.existsSync(modelPath)) {
        throw new Error(`Language model path is invalid: ${modelPath}`);
    }
    if (!projectorPath || !fs.existsSync(projectorPath)) {
        throw new Error(`Vision model path is invalid: ${projectorPath}`);
    }

    const port = await getAvailablePort();
    signal.throwIfAborted();
    const argumentsList = [
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--cors-origins',
        'localhost',
        '--alias',
        'local',
        '-c',
        String(localContextTokens(llamaModel)),
        '-m',
        modelPath,
        '--mmproj',
        projectorPath,
    ];
    // Both audited b10964 Windows runners share the same llama.cpp CLI contract.
    if (/llama-b10964/i.test(executablePath)) argumentsList.push('--cache-reuse', '256');

    llamaBaseUrl = `http://127.0.0.1:${port}`;
    llamaApiKey = randomBytes(32).toString('hex');
    llamaProcess = startNativeServer({
        executablePath,
        arguments: argumentsList,
        name: 'Llama',
        environment: { LLAMA_API_KEY: llamaApiKey },
    });

    await waitForServer(`${llamaBaseUrl}/health`, llamaProcess, 30 * 60 * 1000, signal);
}

async function initializeLocalSession(model, whisperModel, profile, customPrompt, language = 'en-US') {
    console.log('[LocalAI] Initializing native local session:', { model, whisperModel, profile, language: currentLanguage });
    sendToRenderer('session-initializing', true);
    closeLocalSession();
    const controller = new AbortController();
    initializationController = controller;
    initializationFailure = null;
    let stage = 'Configuration';

    try {
        currentLanguage = String(language || 'en').split('-')[0] || 'en';
        if (/\.en$/.test(whisperModel) && currentLanguage !== 'en') throw new Error('The selected local Whisper model is English-only. Select English or use Gemini/Groq for this language.');
        currentSystemPrompt = getSystemPrompt(profile, customPrompt, false);
        llamaModel = model;

        const nativeFiles = await prepareNativeFiles(model, whisperModel, controller.signal, value => { stage = value; });
        controller.signal.throwIfAborted();
        validatePreparedNativeFiles(nativeFiles);

        sendToRenderer('update-status', 'Starting Whisper...');
        stage = 'Whisper startup';
        sendDownloadProgress('Starting Whisper');
        await startWhisperServer(nativeFiles.whisperBinaryPath, nativeFiles.whisperModelPath, controller.signal);
        controller.signal.throwIfAborted();

        const accelerated = /vulkan/i.test(nativeFiles.llamaBinaryPath);
        stage = accelerated ? 'Vulkan model startup' : 'CPU model startup';
        sendToRenderer('update-status', accelerated
            ? 'Loading the Vulkan-capable local runner; device use depends on your GPU and driver...'
            : 'Loading local language model on CPU. Select a smaller model in Home for faster replies.');
        sendDownloadProgress('Loading language model');
        try {
            await startLlamaServer(nativeFiles.llamaBinaryPath, nativeFiles.llamaModelPath, nativeFiles.projectorPath, controller.signal);
        } catch (error) {
            controller.signal.throwIfAborted();
            if (!accelerated) throw error;
            // Download success does not prove that the GPU backend can start.
            // Stop the failed process before trying the verified CPU runner.
            stopNativeServer(llamaProcess);
            llamaProcess = null;
            llamaBaseUrl = null;
            sendToRenderer('update-status', 'The Vulkan runner could not start. Loading the same local model with the verified CPU runner.');
            stage = 'CPU fallback';
            const cpuBinary = await ensureNativeBinary('llama', undefined, controller.signal, { cpuOnly: true });
            controller.signal.throwIfAborted();
            await startLlamaServer(cpuBinary, nativeFiles.llamaModelPath, nativeFiles.projectorPath, controller.signal);
        }
        controller.signal.throwIfAborted();

        isSpeaking = false;
        speechBuffers = [];
        speechBytes = 0;
        silenceFrameCount = 0;
        speechFrameCount = 0;
        resampleRemainder = Buffer.alloc(0);
        localConversationHistory = [];

        initializeNewSession(profile, customPrompt);
        isLocalActive = true;
        initializationController = null;
        sendToRenderer('local-ai-download-progress', { active: false });
        sendToRenderer('session-initializing', false);
        sendToRenderer('update-status', 'Local AI ready - Listening...');
        console.log('[LocalAI] Native session initialized successfully');
        return true;
    } catch (error) {
        if (initializationController !== controller) return false;
        const wasCancelled = error.name === 'AbortError' || controller.signal.aborted;
        if (wasCancelled) {
            console.log('[LocalAI] Initialization cancelled');
        } else {
            console.warn('[LocalAI] Initialization error:');
        }
        if (!wasCancelled) initializationFailure = localInitializationFailure(error, stage);
        closeLocalSession();
        // Verified downloads remain cached. Only this attempt's temporary files
        // are removed by the downloader; cancelling must not delete unrelated files.
        sendToRenderer('local-ai-download-progress', { active: false });
        sendToRenderer('session-initializing', false);
        sendToRenderer('update-status', wasCancelled ? 'Local AI download cancelled' : initializationFailure.message);
        return false;
    }
}

function localInitializationFailure(error, stage) {
    const text = String(error?.message || '');
    const httpStatus = Number(text.match(/HTTP (\d{3})/)?.[1]) || null;
    const exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : null;
    let reason = 'Setup could not finish. Retry setup; verified cached files are retained.';
    if (/English-only/.test(text)) reason = 'The selected Whisper model is English-only. Select English or a compatible transcription model.';
    else if (/out of memory|bad_alloc|not enough memory|failed to allocate/i.test(text)) reason = 'Not enough memory. Close other applications or explicitly select a smaller local model.';
    else if (exitCode !== null) reason = `The native runner exited (0x${(exitCode >>> 0).toString(16).padStart(8, '0')}). Check the verified runner bundle and available memory.`;
    else if (/checksum/i.test(text)) reason = 'A model or runner failed checksum verification. Retry setup to replace the invalid file.';
    else if (httpStatus) reason = `A setup download or metadata request failed (HTTP ${httpStatus}). Check network access and retry; verified cached files are retained.`;
    else if (/fetch failed|network|socket|timeout|timed out|deadline|stalled/i.test(text)) reason = 'A download or startup stalled or timed out. Check network access and available memory, then retry setup.';
    else if (/ENOENT|EACCES|EPERM/.test(error?.code || text)) reason = 'The native runner could not launch. Check folder permissions and the verified runner bundle.';
    else if (/projector|mmproj/i.test(text)) reason = 'The selected model needs a compatible vision projector. Retry setup to complete the matching model pair.';
    else if (/format|unsupported|unsafe|quant|GGUF|model reference/i.test(text)) reason = 'The selected local model is unsupported or invalid. Review the model selection and compatible GGUF files.';
    return { operation: 'initialization', category: 'local-setup', stage, httpStatus, exitCode, message: `Local AI — ${stage}: ${reason}` };
}

function processLocalAudio(monoChunk24k) {
    if (!isLocalActive) return;

    const pcm16k = resample24kTo16k(monoChunk24k);
    if (pcm16k.length > 0) {
        processVad(pcm16k);
    }
}

function closeLocalSession() {
    isLocalActive = false;
    initializationController?.abort();
    initializationController = null;
    stopNativeServer(llamaProcess);
    stopNativeServer(whisperProcess);
    llamaProcess = null;
    whisperProcess = null;
    llamaBaseUrl = null;
    llamaApiKey = null;
    whisperBaseUrl = null;
    llamaModel = null;
    isSpeaking = false;
    speechBuffers = [];
    speechBytes = 0;
    silenceFrameCount = 0;
    speechFrameCount = 0;
    resampleRemainder = Buffer.alloc(0);
    localConversationHistory = [];
    currentSystemPrompt = null;
    currentLanguage = 'en';
}

async function cancelLocalInitialization() {
    if (!initializationController) {
        return false;
    }

    closeLocalSession();
    sendToRenderer('local-ai-download-progress', { active: false });
    sendToRenderer('session-initializing', false);
    sendToRenderer('update-status', 'Local AI download cancelled');
    return true;
}

function isLocalSessionActive() {
    return isLocalActive;
}

async function sendLocalText(text) {
    if (!isLocalActive || !llamaProcess) {
        return { success: false, error: 'No active local session' };
    }

    try {
        const answer = await sendToLlama(text);
        return { success: true, text: answer, model: llamaModel };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function sendLocalImage(base64Data, prompt) {
    if (!isLocalActive || !llamaProcess) {
        return { success: false, error: 'No active local session' };
    }

    const userMessage = {
        role: 'user',
        content: [
            { type: 'text', text: prompt },
            {
                type: 'image_url',
                image_url: {
                    url: `data:image/jpeg;base64,${base64Data}`,
                },
            },
        ],
    };

    let requestHistory = [...localConversationHistory];
    requestHistory.push({ role: 'user', content: prompt });
    requestHistory = trimLocalHistory(requestHistory);

    try {
        sendToRenderer('update-status', 'Analyzing image...');
        const messages = [
            { role: 'system', content: currentSystemPrompt || 'You are a helpful assistant.' },
            ...requestHistory.slice(0, -1),
            userMessage,
        ];

        let isFirst = true;
        const fullText = await requestLlama(messages, text => {
            sendToRenderer(isFirst ? 'new-response' : 'update-response', text);
            isFirst = false;
        });

        assertCurrentRequest();
        if (fullText.trim()) {
            localConversationHistory = [...trimLocalHistory([...localConversationHistory, requestHistory.at(-1)]), { role: 'assistant', content: fullText.trim() }];
            saveConversationTurn(prompt, fullText);
        }

        sendToRenderer('update-status', 'Listening...');
        return { success: true, text: fullText, model: llamaModel };
    } catch (error) {
        console.warn('[LocalAI] Image error:');
        sendToRenderer('update-status', 'Local AI image error: ' + error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    initializeLocalSession,
    getLocalInitializationFailure: () => initializationFailure,
    cancelLocalInitialization,
    processLocalAudio,
    closeLocalSession,
    isLocalSessionActive,
    sendLocalText,
    sendLocalImage,
};
