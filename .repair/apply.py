from pathlib import Path
import hashlib
root = Path('.')
def edit(name, old, new):
    p = root / name
    text = p.read_text()
    assert text.count(old) == 1, (name, text.count(old), old[:100])
    p.write_text(text.replace(old, new))

edit('src/components/views/MainView.js', """        if (mode === 'local' && !this._localAiSupported()) {
            this.startError = 'Local AI is unavailable on this platform. Choose Gemini or Groq.';
            return;
        }
""", '')
edit('src/components/views/MainView.js', "        if (this._mode === 'local' && !this._localAiSupported()) { this.startError = 'Local AI is unavailable on this platform.'; return; }\n", '')
edit('src/utils/gemini.js', """                const mode = channel === 'initialize-local' ? 'local' : args[4] === 'groq' ? 'groq' : 'byok';
                require('./windowsRuntimeMain').prepareWindowsProvider(mode, args[5]?.uiEpoch);
""", """                const local = channel === 'initialize-local';
                const mode = local ? 'local' : args[3] === 'groq' ? 'groq' : 'byok';
                const options = args[local ? 5 : 4];
                require('./windowsRuntimeMain').prepareWindowsProvider(mode, options?.uiEpoch);
""")
edit('src/utils/gemini.js', """    const detail = geminiErrorObject(error);
    const text = [detail?.message, detail?.status, detail?.code, error?.message, error?.reason]
        .filter(value => typeof value === 'string').join(' ').slice(0, 32000).toLowerCase();
    const number = [error?.status, error?.statusCode, detail?.code, error?.code]
        .map(Number).find(value => value >= 400 && value <= 599);
    const httpStatus = number || Number(text.match(/\\b(400|401|403|404|408|409|429|500|502|503|504)\\b/)?.[1]) || null;
    const socketCode = Number(error?.code) >= 1000 && Number(error?.code) <= 4999 ? Number(error.code) : null;
    const details = Array.isArray(detail.details) ? detail.details : [];
""", """    // ws ErrorEvent stores the useful error under .error; fetch uses .cause.
    // Inspect a bounded chain, but never expose its arbitrary messages to the UI.
    const chain = [];
    for (let value = error; value && chain.length < 5 && !chain.includes(value); value = value.error || value.cause) chain.push(value);
    const parsed = chain.map(geminiErrorObject);
    const text = [...chain, ...parsed].flatMap(value => [value?.message, value?.reason, value?.status, value?.code])
        .filter(value => typeof value === 'string').join(' ').slice(0, 32000).toLowerCase();
    const number = [...chain, ...parsed].flatMap(value => [value?.status, value?.statusCode, value?.code])
        .map(Number).find(value => value >= 400 && value <= 599);
    const httpStatus = number || Number(text.match(/\\b(400|401|403|404|407|408|409|429|500|502|503|504)\\b/)?.[1]) || null;
    const socketCode = chain.map(value => Number(value?.code)).find(value => value >= 1000 && value <= 4999) || null;
    const networkCode = chain.map(value => value?.code).find(value => [
        'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH',
        'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    ].includes(value)) || null;
    const stage = ['catalog', 'transport', 'setup'].includes(error?.stage) ? error.stage : null;
    const details = parsed.flatMap(value => Array.isArray(value?.details) ? value.details : []);
""")
edit('src/utils/gemini.js', "    const headers = error?.headers || error?.response?.headers;", "    const headers = chain.map(value => value?.headers || value?.response?.headers).find(Boolean);")
edit('src/utils/gemini.js', "    const cancelled = error?.name === 'AbortError' && !/timed?\\s*out|timeout/i.test(text);", "    const cancelled = chain.some(value => value?.name === 'AbortError') && !/timed?\\s*out|timeout/i.test(text);")
edit('src/utils/gemini.js', """    if (cancelled) category = 'cancelled';
    else if (httpStatus === 401""", """    if (cancelled) category = 'cancelled';
    else if (networkCode && /CERT|SELF_SIGNED|ISSUER|SIGNATURE/.test(networkCode)) category = 'tls';
    else if (httpStatus === 407) category = 'proxy-authentication';
    else if (httpStatus === 401""")
edit('src/utils/gemini.js', "    else if ([408, 500, 502, 503, 504].includes(httpStatus)", "    else if (networkCode || [408, 500, 502, 503, 504].includes(httpStatus)")
edit('src/utils/gemini.js', """    const messages = {
        authentication:""", """    const messages = {
        tls: 'Gemini secure connection failed certificate verification. Check the Windows clock and trusted certificates or contact your network administrator. Certificate verification remains enabled.',
        'proxy-authentication': 'The network proxy requires authentication before Gemini can connect. Review the system proxy configuration with your network administrator.',
        authentication:""")
edit('src/utils/gemini.js', """    const retryAt = retryAfterMs === null ? null : now + retryAfterMs;
    return { category, httpStatus, socketCode, operation, model: String(model).slice(0, 160), retryable,
        retryAfterMs, retryAt, canDisableSearch: category === 'unsupported-tool' || searchRelated && ['quota-exhausted', 'throttled', 'rate-or-quota'].includes(category),
        message: messages[category] + (retryAfterMs === null ? '' : ` Provider retry delay: ${Math.ceil(retryAfterMs / 1000)} seconds.`) };
""", """    const retryAt = retryAfterMs === null ? null : now + retryAfterMs;
    let message = messages[category];
    if (category === 'transient' && ['ENOTFOUND', 'EAI_AGAIN'].includes(networkCode)) {
        message = 'Gemini hostname lookup failed. Check DNS and network connectivity, then retry.';
    } else if (category === 'transient' && operation === 'live' && stage) {
        message = stage === 'transport'
            ? 'Gemini Live could not establish its secure WebSocket connection. Check network or proxy access, then retry.'
            : 'Gemini Live connected, but session setup did not complete. Retry or review the selected model and project access.';
    }
    const diagnostic = [stage, httpStatus && `HTTP ${httpStatus}`, socketCode && `WebSocket ${socketCode}`, networkCode].filter(Boolean).join(', ');
    return { category, httpStatus, socketCode, networkCode, stage, operation, model: String(model).slice(0, 160), retryable,
        retryAfterMs, retryAt, canDisableSearch: category === 'unsupported-tool' || searchRelated && ['quota-exhausted', 'throttled', 'rate-or-quota'].includes(category),
        message: message + (diagnostic ? ` (${diagnostic})` : '')
            + (retryAfterMs === null ? '' : ` Provider retry delay: ${Math.ceil(retryAfterMs / 1000)} seconds.`) };
""")
edit('src/utils/gemini.js', """async function getGeminiLivePreflightError(apiKey, liveModel) {
    try {
        const catalog = await listProviderModels('gemini', apiKey);
""", """async function getGeminiLivePreflightError(apiKey, liveModel, signal) {
    const deadline = deadlineSignal(signal, 10000);
    try {
        const catalog = await abortable(() => listProviderModels('gemini', apiKey, { signal: deadline.signal }), deadline.signal);
""")
edit('src/utils/gemini.js', """    } catch (error) {
        if ([401, 403].includes(classifyGeminiFailure(error).httpStatus)) return error;
        // Discovery is advisory. Its outage must not force a model change.
    }
    return null;
}
""", """    } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if ([401, 403].includes(classifyGeminiFailure(error).httpStatus)) return error;
        // Discovery is advisory. Its outage must not force a model change.
    } finally { deadline.close(); }
    return null;
}
""")
edit('src/utils/gemini.js', "    let setupFinished = false;\n    let abandoned = false;", "    let setupFinished = false;\n    let opened = false;\n    let abandoned = false;")
edit('src/utils/gemini.js', """    const fail = value => {
        const error = Object.assign(new Error(value?.reason || value?.message || 'Live socket closed during setup'),
            { code: value?.code, status: value?.status, headers: value?.headers });
        rejectEarly(error);
    };
""", """    const fail = value => {
        const error = Object.assign(new Error(value?.reason || value?.message || 'Live socket closed during setup'),
            { code: value?.code, status: value?.status, headers: value?.headers, cause: value?.error || value?.cause,
                stage: opened ? 'setup' : 'transport' });
        rejectEarly(error);
    };
""")
edit('src/utils/gemini.js', "        onopen(event) { if (!abandoned) callbacks.onopen?.(event); },", "        onopen(event) { opened = true; if (!abandoned) callbacks.onopen?.(event); },")
edit('src/utils/gemini.js', "        timer = setTimeout(() => reject(new Error('Gemini Live setup timed out')), timeoutMs);", "        timer = setTimeout(() => reject(Object.assign(new Error('Gemini Live setup timed out'), { name: 'TimeoutError', stage: opened ? 'setup' : 'transport' })), timeoutMs);")
edit('src/utils/gemini.js', "            const preflight = await getGeminiLivePreflightError(apiKey, liveModel);", "            startTransportLog(String(Date.now()));\n            logTransportEvent('gemini.live.start', { model: liveModel, operation: 'live' });\n            const preflight = await getGeminiLivePreflightError(apiKey, liveModel, signal);")
edit('src/utils/gemini.js', """        lastGeminiFailure = classifyGeminiFailure(error, 'live', liveModel);
        lastGeminiInitializationError = lastGeminiFailure.message;
""", """        lastGeminiFailure = classifyGeminiFailure(error, 'live', liveModel);
        const { category, httpStatus, socketCode, networkCode, stage } = lastGeminiFailure;
        const diagnostic = { model: liveModel, operation: 'live', category, status: httpStatus, code: socketCode, networkCode, stage };
        logTransportEvent('gemini.live.start.failed', diagnostic);
        console.warn('Gemini Live startup failed', diagnostic);
        lastGeminiInitializationError = lastGeminiFailure.message;
""")
edit('src/utils/providerModelRegistry.js', "        const response = await fetch(url, { ...options, signal: controller.signal });", "        const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;\n        const response = await fetch(url, { ...options, signal });")
edit('src/utils/providerModelRegistry.js', "async function fetchGeminiCatalog(apiKey) {", "async function fetchGeminiCatalog(apiKey, signal) {")
edit('src/utils/providerModelRegistry.js', "        const body = await fetchJson(url, {\n            headers:", "        const body = await fetchJson(url, {\n            signal,\n            headers:")
edit('src/utils/providerModelRegistry.js', "async function fetchGroqCatalog(apiKey) {", "async function fetchGroqCatalog(apiKey, signal) {")
edit('src/utils/providerModelRegistry.js', "    const body = await fetchJson(GROQ_MODELS_URL, {\n        headers:", "    const body = await fetchJson(GROQ_MODELS_URL, {\n        signal,\n        headers:")
edit('src/utils/providerModelRegistry.js', "async function listProviderModels(provider, apiKey, options = {}) {", "async function listProviderModels(provider, apiKey, options = {}) {\n    options.signal?.throwIfAborted();")
edit('src/utils/providerModelRegistry.js', "            ? await fetchGeminiCatalog(String(apiKey).trim())\n            : await fetchGroqCatalog(String(apiKey).trim());", "            ? await fetchGeminiCatalog(String(apiKey).trim(), options.signal)\n            : await fetchGroqCatalog(String(apiKey).trim(), options.signal);")
edit('src/utils/providerModelRegistry.js', "    } catch (error) {\n        if (existing) {", "    } catch (error) {\n        if (options.signal?.aborted) throw options.signal.reason;\n        if (existing) {")
edit('src/utils/transportLogger.js', "'retryAfterMs', 'attempt']);", "'retryAfterMs', 'attempt', 'networkCode', 'stage']);")
edit('tests/helpers/gemini-fixture.js', "if (name === '@google/genai') return {", "if (name === '@google/genai') return options.sdk || {")
edit('tests/helpers/gemini-fixture.js', "prepareWindowsProvider: mode => preparations.push(['windows', mode])", "prepareWindowsProvider: (mode, epoch) => preparations.push(['windows', mode, epoch])")
edit('scripts/renderer-behavior-smoke.js', '    const ipc=window.electronAPI;\n', """    // Exercise the real Home controls and persistence. Only the final provider
    // launch callback is controlled: smoke must not download models or use keys.
    const originalMode = (await api.storage.getPreferences()).providerMode;
    try {
        app.currentView = 'main'; await settle(app);
        let home = app.shadowRoot.querySelector('main-view');
        await waitUntil(() => home && !home._configurationLoading);
        await settle(home);
        const select = home.shadowRoot.querySelector('#provider-choice');
        select.value = 'local'; select.dispatchEvent(new Event('change', { bubbles: true }));
        await home._configurationWrites; await settle(home);
        verify(home._mode === 'local' && (await api.storage.getPreferences()).providerMode === 'local', 'Home provider dropdown selects and persists Local AI without a platform shim');
        let starts = 0;
        home.onStart = () => { starts++; };
        home.shadowRoot.querySelector('.start-button').click();
        await waitUntil(() => starts === 1);
        verify(!home._keyError, 'Local AI Start reaches session launch without a cloud API key');
        app.currentView = 'help'; await settle(app);
        app.currentView = 'main'; await settle(app);
        home = app.shadowRoot.querySelector('main-view');
        await waitUntil(() => home && !home._configurationLoading); await settle(home);
        verify(home._mode === 'local', 'Home reload retains the Local AI provider choice');
        home.onStart = () => { starts++; };
        home.shadowRoot.querySelector('.start-button').click();
        await waitUntil(() => starts === 2);
    } finally {
        await api.storage.updatePreference('providerMode', originalMode || 'byok');
        app.currentView = 'assistant'; await settle(app);
    }
    const ipc=window.electronAPI;
""")
p = root / 'tests/provider-model-registry.test.js'
p.write_text(p.read_text() + """
test('catalog cancellation aborts the fetch and never returns a cached fallback as success', async t => {
    const original = global.fetch;
    t.after(() => { global.fetch = original; });
    global.fetch = async () => new Response(JSON.stringify({ models: [] }));
    await registry.listProviderModels('gemini', 'catalog-cancel-fixture', { forceRefresh: true });
    let requestSignal;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    global.fetch = async (_url, options) => {
        requestSignal = options.signal; started();
        return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    };
    const controller = new AbortController();
    const pending = registry.listProviderModels('gemini', 'catalog-cancel-fixture', { forceRefresh: true, signal: controller.signal });
    await ready; controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(requestSignal.aborted, true);
});
""")
expected = {
    'src/components/views/MainView.js': '9307aa7ad95ac6f20ad55ebb91bc75777dff291bba5b9c7f3ef6df8f1e12ef4c',
    'src/utils/gemini.js': '7d09e39b966f3bd53e511f7652f865ace06d4220e3c479ae1f7a0b198ee419b0',
    'src/utils/providerModelRegistry.js': '56d88ce188039da804cd4c7bc7f42c29f87d4b45254b63b104fa78a0a4fce718',
    'src/utils/transportLogger.js': '68729898cff52f9daed3a8b752ea9d31158d11fa4e61018eb3514fb1d332ad4a',
    'scripts/renderer-behavior-smoke.js': '645a9ef1caa266c4f35dd4dcba599583fffe3770cb2cb387b233b9d1b42acd05',
    'tests/helpers/gemini-fixture.js': 'b585410f2f859676f22a537fe44744fa914e4a108f8bef867157e27f6e8f02c0',
    'tests/provider-model-registry.test.js': '2e26e01e953949fd294c1861d886426faaabb8d40d019b710418e719e839fb0b',
}
for name, digest in expected.items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, name
print('Published source matches the locally verified repair byte for byte.')
