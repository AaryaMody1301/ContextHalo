const { setTimeout: sleep } = require('node:timers/promises');
const { classifyGeminiFailure } = require('./geminiFailure');
const LIMIT_FAILURES = new Set(['quota-exhausted', 'rate-or-quota', 'throttled']);
const coreEligible = failure => failure.stage === 'setup' && (failure.category === 'invalid-configuration'
    || failure.category === 'transient' && failure.socketCode === 1011);

// One controlled Search-off setup, same account/model and reliability fields.
// Success demonstrates a usable no-Search path, NOT the exact exhausted quota.
// Never probe authentication, permissions, or an explicitly named model quota.
async function recoverGeminiSetup(connect, { model, searchEnabled, coreConfig = false, signal,
    onSearchFallback = () => {}, onCoreFallback = () => {}, wait = sleep }) {
    const classify = (error, attached) => classifyGeminiFailure(error, 'live', model, Date.now(), { searchAttached: attached });
    const attempt = async (search, core) => {
        signal?.throwIfAborted();
        const session = await connect({ searchEnabled: search, coreConfig: core });
        if (signal?.aborted) { session.close(); signal.throwIfAborted(); }
        return session;
    };
    let original;
    try { return await attempt(searchEnabled, coreConfig); } catch (error) { original = error; }
    signal?.throwIfAborted();
    const failure = classify(original, searchEnabled);
    const probe = searchEnabled && failure.stage === 'setup' && (failure.category === 'unsupported-tool'
        || coreEligible(failure) || LIMIT_FAILURES.has(failure.category) && failure.quotaScope !== 'model');
    if (probe) {
        // The enclosing request owns the abortable wall-clock budget. Respect a
        // server delay even for a diagnostic attempt, rather than bypassing it.
        if (failure.retryAfterMs > 0) await wait(failure.retryAfterMs, undefined, { signal });
        let session;
        try { session = await attempt(false, coreConfig); }
        catch (error) {
            signal?.throwIfAborted();
            const controlFailure = classify(error, false);
            if (LIMIT_FAILURES.has(failure.category)) {
                controlFailure.searchControl = 'failed';
                controlFailure.message += ' A single same-model setup without Search also failed; no Search-specific cause was established.';
                throw Object.assign(new Error(controlFailure.message), { failure: controlFailure, noRetryAfterSearchControl: true });
            }
            if (coreConfig || !coreEligible(controlFailure)) throw error;
            onCoreFallback();
            session = await attempt(false, true);
        }
        onSearchFallback(failure);
        return session;
    }
    if (!coreConfig && coreEligible(failure)) {
        onCoreFallback();
        return attempt(searchEnabled, true);
    }
    throw original;
}
module.exports = { recoverGeminiSetup };
