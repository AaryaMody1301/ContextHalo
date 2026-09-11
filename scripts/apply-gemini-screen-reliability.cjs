const fs = require('node:fs');

function replaceOnce(file, from, to) {
    const input = fs.readFileSync(file, 'utf8');
    const count = input.split(from).length - 1;
    if (count !== 1) throw new Error(`${file}: expected one patch target, found ${count}`);
    fs.writeFileSync(file, input.replace(from, to));
}

replaceOnce(
    'src/utils/gemini.js',
    "const { createGeminiLiveRuntime } = require('./geminiLiveRuntime');\n",
    "const { createGeminiLiveRuntime } = require('./geminiLiveRuntime');\nconst { SCREEN_PROVIDER_BUDGET_MS, SCREEN_SESSION_TIMEOUT_MS, screenThinkingConfig } = require('./geminiScreenReliability');\n"
);

replaceOnce(
    'src/utils/gemini.js',
    `        const response = await runGeminiRequest(remaining => ai.models.generateContent(augmentGenerateParams({\n            model,\n            contents: [{ inlineData: { mimeType: 'image/jpeg', data: base64Data } }, { text: prompt }],\n            config: { systemInstruction: appendSessionPack(currentSystemPrompt || getSystemPrompt(currentProfile, currentCustomPrompt, searchState.effective)),\n                maxOutputTokens: 4096, ...(tools.length ? { tools } : {}), abortSignal: getRequestSignal(),\n                httpOptions: { timeout: Math.min(27000, remaining), retryOptions: { attempts: 1 } } },\n        })), { operation: 'screen', model, apiKey, signal: getRequestSignal() });`,
    `        const response = await runGeminiRequest(() => ai.models.generateContent(augmentGenerateParams({\n            model,\n            contents: [{ inlineData: { mimeType: 'image/jpeg', data: base64Data } }, { text: prompt }],\n            config: { systemInstruction: appendSessionPack(currentSystemPrompt || getSystemPrompt(currentProfile, currentCustomPrompt, searchState.effective)),\n                maxOutputTokens: 4096, ...screenThinkingConfig(model), ...(tools.length ? { tools } : {}), abortSignal: getRequestSignal(),\n                httpOptions: { retryOptions: { attempts: 1 } } },\n        })), { operation: 'screen', model, apiKey, signal: getRequestSignal(), budgetMs: SCREEN_PROVIDER_BUDGET_MS });`
);

replaceOnce(
    'src/utils/gemini.js',
    "        }, { ...request, timeoutMs: 58000 });\n    });",
    "        }, { ...request, timeoutMs: SCREEN_SESSION_TIMEOUT_MS });\n    });"
);

replaceOnce(
    'src/utils/renderer.js',
    "const { ipcRenderer } = require('electron');\n",
    "const { ipcRenderer } = require('electron');\nconst { SCREEN_RENDERER_TIMEOUT_MS } = require('./geminiScreenReliability');\n"
);

replaceOnce(
    'src/utils/renderer.js',
    "        const result = await waitForCapture(ipcRenderer.invoke('send-image-content', { data, prompt: MANUAL_SCREENSHOT_PROMPT, request: options.request }), signal, 60000);",
    "        const result = await waitForCapture(ipcRenderer.invoke('send-image-content', { data, prompt: MANUAL_SCREENSHOT_PROMPT, request: options.request }), signal, SCREEN_RENDERER_TIMEOUT_MS);"
);

console.log('Applied Gemini screen reliability patch.');
