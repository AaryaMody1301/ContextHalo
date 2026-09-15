'use strict';

const fs = require('node:fs');

function replaceOnce(filePath, before, after) {
    const source = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
    const first = source.indexOf(before);
    const second = first < 0 ? -1 : source.indexOf(before, first + before.length);
    if (first < 0 || second >= 0) {
        throw new Error(`Expected exactly one match in ${filePath}`);
    }
    fs.writeFileSync(filePath, source.slice(0, first) + after + source.slice(first + before.length), 'utf8');
}

replaceOnce('src/utils/gemini.js', "const resumedLiveSessions = new WeakSet();\n", '');

replaceOnce(
    'src/utils/gemini.js',
    `                session = await runGeminiRequest((remaining, _attempt, operationSignal) => {
                    setupMessages = [];
                    return connectGeminiLiveWithGuard(client, {
                    model: liveModel, callbacks,
                    config: { responseModalities: [Modality.AUDIO], inputAudioTranscription: {}, outputAudioTranscription: {},
                        ...reliabilityConfig, systemInstruction: instruction, ...(tools.length ? { tools } : {}) },
                }, Math.min(15000, remaining), operationSignal); }, { operation: 'live', model: liveModel, apiKey, signal, budgetMs: 35000 });
                if (reliabilityConfig.sessionResumption?.handle) resumedLiveSessions.add(session);`,
    `                const contextMessage = isReconnect && !reliabilityConfig.sessionResumption?.handle ? buildContextMessage() : null;
                session = await runGeminiRequest(async (remaining, _attempt, operationSignal) => {
                    setupMessages = [];
                    const connected = await connectGeminiLiveWithGuard(client, {
                        model: liveModel, callbacks,
                        config: { responseModalities: [Modality.AUDIO], inputAudioTranscription: {}, outputAudioTranscription: {},
                            ...reliabilityConfig,
                            ...(contextMessage ? { historyConfig: { initialHistoryInClientContent: true } } : {}),
                            systemInstruction: instruction, ...(tools.length ? { tools } : {}) },
                    }, Math.min(15000, remaining), operationSignal);
                    if (contextMessage) {
                        try {
                            connected.sendClientContent({
                                turns: [{ role: 'user', parts: [{ text: augmentLiveTextPayload({ text: contextMessage }).text }] }],
                                turnComplete: true,
                            });
                        } catch (error) {
                            try { connected.close(); } catch {}
                            throw error;
                        }
                    }
                    return connected;
                }, { operation: 'live', model: liveModel, apiKey, signal, budgetMs: 35000 });`
);

replaceOnce(
    'src/utils/gemini.js',
    `    const contextMessage = resumedLiveSessions.has(session) ? null : buildContextMessage();
    if (contextMessage) {
        try { session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: augmentLiveTextPayload({ text: contextMessage }).text }] }], turnComplete: false }); }
        catch { sendToRenderer('update-status', 'Connected, but restoring Live context failed. Typed answers still retain session history.'); }
    }
    return true;`,
    `    return true;`
);

replaceOnce(
    'tests/gemini-live-production-wiring.test.js',
    `    assert.deepEqual(fixture.connections[1].config.sessionResumption, { handle: 'safe-handle' });
    assert.equal(fixture.realtime.some(item => String(item?.text || '').includes('Session reconnected.')), false);`,
    `    assert.deepEqual(fixture.connections[1].config.sessionResumption, { handle: 'safe-handle' });
    assert.equal(fixture.connections[1].config.historyConfig, undefined);
    assert.equal(fixture.clientContent.some(item => JSON.stringify(item.turns).includes('Session reconnected.')), false);`
);

replaceOnce(
    'tests/gemini-live-production-wiring.test.js',
    `    assert.deepEqual(fixture.connections[1].config.sessionResumption, {});
    assert.equal(fixture.clientContent.some(item => item.turnComplete === false && JSON.stringify(item.turns).includes('Session reconnected.')), true);`,
    `    assert.deepEqual(fixture.connections[1].config.sessionResumption, {});
    assert.deepEqual(fixture.connections[1].config.historyConfig, { initialHistoryInClientContent: true });
    assert.equal(fixture.clientContent.some(item => item.turnComplete === true && JSON.stringify(item.turns).includes('Session reconnected.')), true);`
);

replaceOnce(
    'tests/gemini-recovery.test.js',
    `    assert.ok(f.clientContent.some(item => item.turnComplete === false && JSON.stringify(item.turns).includes('Before reconnect')));`,
    `    assert.deepEqual(f.connections[1].config.historyConfig, { initialHistoryInClientContent: true });
    assert.ok(f.clientContent.some(item => item.turnComplete === true && JSON.stringify(item.turns).includes('Before reconnect')));`
);

replaceOnce(
    'tests/final-contracts.test.js',
    `    assert.deepEqual(f.connections[2].config.sessionResumption, {});
    assert.equal(restored[0].turnComplete, false); assert.match(JSON.stringify(restored), /SQL answer/);`,
    `    assert.deepEqual(f.connections[2].config.sessionResumption, {});
    assert.deepEqual(f.connections[2].config.historyConfig, { initialHistoryInClientContent: true });
    assert.equal(restored[0].turnComplete, true); assert.match(JSON.stringify(restored), /SQL answer/);`
);

replaceOnce(
    'docs/API_COMPATIBILITY_AUDIT.md',
    '# API compatibility and release gates - 2026-09-13',
    '# API compatibility and release gates - 2026-09-15'
);

replaceOnce(
    'docs/API_COMPATIBILITY_AUDIT.md',
    '| Live context restore | `sendClientContent({turns, turnComplete:false})` only on a fresh connection; never duplicate history after server resumption | https://googleapis.github.io/js-genai/release_docs/classes/live.Session.html |',
    '| Live context restore | Gemini 3.1 seeds local history only on a fresh reconnect with `historyConfig.initialHistoryInClientContent: true` and `sendClientContent({turns, turnComplete:true})`; server-resumed sessions never duplicate local history | https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-live-preview |'
);

replaceOnce(
    'docs/API_COMPATIBILITY_AUDIT.md',
    '## Important corrections from the earlier audit\n\n',
    '## Important corrections from the earlier audit\n\nThe September 15 re-audit corrected Gemini 3.1 Live history restore. Fresh reconnects now opt into initial-history mode and complete the seed message; successful server resumption never receives a duplicate local replay.\n\n'
);

fs.rmSync('.github/repair-data/apply.cjs', { force: true });

const gemini = fs.readFileSync('src/utils/gemini.js', 'utf8');
if (gemini.includes('resumedLiveSessions')) throw new Error('Legacy reconnect marker remains');
if (!gemini.includes('historyConfig: { initialHistoryInClientContent: true }')) throw new Error('History configuration was not applied');

fs.rmSync(__filename, { force: true });
console.log('Applied Sep 15 Gemini Live API audit repair.');
