const REQUEST_TIMEOUT_MS = 27000;
const FALLBACK_MODEL = 'gemini-3.7-flash';
const MAX_OUTPUT_TOKENS = 4096;

const RETRYABLE_ANALYZE_PATTERNS = [
    /\b404\b/i,
    /not found/i,
    /not available/i,
    /\b409\b/i,
    /aborted/i,
    /conflict/i,
    /\b429\b/i,
    /resource[_ -]?exhausted/i,
    /\b500\b/i,
    /\b502\b/i,
    /\b503\b/i,
    /\b504\b/i,
    /internal/i,
    /unavailable/i,
    /timed?\s*out/i,
    /timeout/i,
    /deadline/i,
    /empty analyze screen response/i,
];

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getErrorText(error) {
    if (!error) return '';
    return String(error.message || error.error || error);
}

function isRetryableAnalyzeError(error) {
    const text = getErrorText(error);
    return RETRYABLE_ANALYZE_PATTERNS.some(pattern => pattern.test(text));
}

function replaceGoogleGenAiExport(genai, HardenedGoogleGenAI) {
    try {
        genai.GoogleGenAI = HardenedGoogleGenAI;
    } catch {}

    if (require('@google/genai').GoogleGenAI === HardenedGoogleGenAI) return true;

    try {
        const modulePath = require.resolve('@google/genai');
        const cachedModule = require.cache[modulePath];
        if (!cachedModule) return false;
        cachedModule.exports = { ...genai, GoogleGenAI: HardenedGoogleGenAI };
        return require('@google/genai').GoogleGenAI === HardenedGoogleGenAI;
    } catch {
        return false;
    }
}

function toSingleChunkStream(response) {
    return (async function* () {
        yield response;
    })();
}

function installAnalyzeProviderFallback() {
    // Resolve the SDK only when installing. runtimeHardeningMain wraps the SDK
    // immediately before this function, so capturing it at module-load time can
    // leave us patching a stale exports object instead of the class gemini.js uses.
    const genai = require('@google/genai');
    const OriginalGoogleGenAI = genai.GoogleGenAI;
    if (!OriginalGoogleGenAI || OriginalGoogleGenAI.__analyzeFallbackInstalled) return;

    class AnalyzeFallbackGoogleGenAI extends OriginalGoogleGenAI {
        constructor(options) {
            super(options);

            const models = this.models;
            const originalGenerateContent = models?.generateContent?.bind(models);
            if (!originalGenerateContent) return;

            // Analyze Screen is the only current caller of generateContentStream.
            // Use a bounded non-streaming request instead, then adapt the response
            // to the existing async-iterator contract. This avoids a stream that can
            // hang while preserving the renderer's current response handling.
            models.generateContentStream = async params => {
                const requestedModel = params?.model || 'gemini-3.8-flash';
                const modelChain = [...new Set([requestedModel, FALLBACK_MODEL])];
                let lastError = null;
                global.__lastAnalyzeActualModel = null;

                for (let index = 0; index < modelChain.length; index++) {
                    const model = modelChain[index];
                    try {
                        const response = await originalGenerateContent({
                            ...params,
                            model,
                            config: {
                                ...(params?.config || {}),
                                maxOutputTokens: Math.min(
                                    Number(params?.config?.maxOutputTokens) || MAX_OUTPUT_TOKENS,
                                    MAX_OUTPUT_TOKENS
                                ),
                                httpOptions: {
                                    ...(params?.config?.httpOptions || {}),
                                    timeout: REQUEST_TIMEOUT_MS,
                                },
                            },
                        });

                        const text = response?.text?.trim();
                        if (!text) throw new Error('Empty Analyze Screen response');

                        global.__lastAnalyzeActualModel = model;
                        if (model !== requestedModel) {
                            console.warn(`Analyze Screen recovered with fallback model ${model}`);
                        }
                        return toSingleChunkStream(response);
                    } catch (error) {
                        lastError = error;
                        const retryable = isRetryableAnalyzeError(error);
                        const hasFallback = index < modelChain.length - 1;

                        if (!retryable) throw error;
                        if (!hasFallback) break;

                        console.warn(
                            `Analyze Screen model ${model} failed (${getErrorText(error).slice(0, 180)}); trying ${modelChain[index + 1]}`
                        );
                        await delay(700 + Math.floor(Math.random() * 300));
                    }
                }

                console.error('Analyze Screen provider attempts exhausted:', lastError);
                // Deliberately avoid a 409/429/5xx/timeout token here. The outer
                // IPC hardening layer would otherwise retry the entire two-model
                // sequence and outlive the renderer watchdog again.
                throw new Error('Analyze Screen provider unavailable after primary and fallback model attempts. Try again in a few seconds.');
            };
        }
    }

    Object.defineProperty(AnalyzeFallbackGoogleGenAI, '__analyzeFallbackInstalled', { value: true });
    if (!replaceGoogleGenAiExport(genai, AnalyzeFallbackGoogleGenAI)) {
        throw new Error('Could not install Analyze Screen Gemini fallback');
    }
}

module.exports = {
    installAnalyzeProviderFallback,
    isRetryableAnalyzeError,
    REQUEST_TIMEOUT_MS,
    FALLBACK_MODEL,
};
