// Opt-in benchmark using synthetic files and a stubbed provider. Pass an alternate checkout for comparison.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const { setTimeout: sleep } = require('node:timers/promises');

const checkout = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const app = file => require(path.join(checkout, 'src', file));
const query = 'database transaction isolation consistency locks';
const warmups = 5;
const iterations = 30;
const round = value => Number(value.toFixed(2));

function quantiles(durations) {
    durations.sort((a, b) => a - b);
    const at = ratio => round(durations[Math.ceil(durations.length * ratio) - 1]);
    return { p50Ms: at(0.50), p95Ms: at(0.95) };
}

async function measure(run) {
    for (let i = 0; i < warmups; i++) await run();
    const durations = [];
    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await run();
        durations.push(performance.now() - start);
        await new Promise(resolve => setImmediate(resolve));
    }
    return quantiles(durations);
}

function writeJson(file, value) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

async function main() {
    const originalHomedir = os.homedir;
    const originalFetch = global.fetch;
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'context-halo-performance-'));
    try {
        let home = fixture;
        os.homedir = () => home;
        const storage = app('storage');
        const core = app('utils/knowledgeCore');
        const knowledge = app('utils/knowledgeStore');
        const rag = app('utils/knowledgeRagMain');
        let injected = false;
        global.fetch = async (_input, init) => {
            injected = init.body.includes('[ContextHalo knowledge]');
            return new Response(null, { status: 204 });
        };
        app('utils/sessionPackMain').installSessionPackMain();
        rag.installKnowledgeRagMain();
        const results = [];
        for (const count of [10, 100, 500]) {
            home = path.join(fixture, String(count));
            const config = storage.getConfigDir();
            storage.initializeStorage();
            storage.updatePreference('cloudKnowledgeEnabled', true);
            storage.updatePreference('sessionPack', { goal: 'Compare database approaches' });
            knowledge.initializeKnowledgeStore();
            const docs = Array.from({ length: count }, (_, i) => {
                const content = ('Document ' + i + ': database transaction isolation consistency locks and recovery.\n\n').repeat(100).trim();
                return { id: (i + 1).toString(16), title: 'Synthetic database guide ' + i, enabled: true,
                    sourceType: 'text', content, chunks: core.chunkText(content), createdAt: 1, updatedAt: 1 };
            });
            let corpusBytes = 0;
            for (const doc of docs) {
                const file = path.join(config, 'knowledge', 'documents', doc.id + '.json');
                writeJson(file, doc);
                corpusBytes += fs.statSync(file).size;
            }
            writeJson(path.join(config, 'knowledge', 'index.json'), { version: 1, documents: docs.map(({ id }) => ({ id })) });
            const passes = [];
            const chunks = docs.reduce((total, doc) => total + doc.chunks.length, 0);
            const expected = core.retrieveChunks(docs, query);
            assert.ok(expected.length);
            assert.deepEqual(knowledge.searchKnowledge(query), expected);
            for (let i = 0; i < 2; i++) {
                const inMemory = await measure(() => core.retrieveChunks(docs, query));
                const fileBacked = await measure(() => knowledge.searchKnowledge(query));
                passes.push({ inMemory, fileBacked });
                assert.deepEqual(knowledge.searchKnowledge(query), expected);
            }
            const rankingSha256 = createHash('sha256').update(JSON.stringify(expected)).digest('hex');
            results.push({ documents: count, chunks, corpusBytes, rankingSha256, passes });
        }
        // Request preparation uses the populated 500-source fixture. No calls leave the process.
        const loop = monitorEventLoopDelay({ resolution: 10 });
        loop.enable();
        const requestPipeline = [];
        try {
            for (let i = 0; i < 2; i++) {
                const geminiScreen = await measure(() => {
                    const params = rag.augmentGenerateParams({
                        contents: [{ role: 'user', parts: [{ text: query }, { inlineData: { data: 'fixture' } }] }],
                        config: { systemInstruction: 'Respond briefly.' },
                    });
                    assert.match(params.config.systemInstruction, /ContextHalo knowledge/);
                });
                const groqText = await measure(async () => {
                    await global.fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: query }] }),
                    });
                    assert.equal(injected, true);
                });
                requestPipeline.push({ geminiScreen, groqText });
            }
        } finally {
            loop.disable();
        }
        const history = [];
        home = path.join(fixture, 'history');
        const historyDir = path.join(storage.getConfigDir(), 'history');
        fs.mkdirSync(historyDir, { recursive: true });
        for (let i = 0; i < 500; i++) {
            const sessionId = String(1700000000000 + i);
            const conversationHistory = Array.from({ length: 20 }, () => ({
                transcription: 'How do database locks work?',
                ai_response: 'Locks coordinate transactions and protect database consistency.',
            }));
            writeJson(path.join(historyDir, sessionId + '.json'), {
                sessionId, createdAt: Number(sessionId), sessionPack: { title: 'Synthetic session ' + i }, conversationHistory,
            });
        }
        for (let i = 0; i < 2; i++) {
            // A fresh storage module has no in-process metadata cache. These passes use a warm OS file cache.
            delete require.cache[require.resolve(path.join(checkout, 'src/storage.js'))];
            const historyStore = app('storage');
            const bootStart = performance.now();
            historyStore.initializeStorage();
            const listStart = performance.now();
            const rows = historyStore.getAllSessions();
            history.push({ startupMs: round(listStart - bootStart), firstListMs: round(performance.now() - listStart), sessions: rows.length });
            assert.equal(rows.length, 500);
        }
        global.gc?.();
        const idleStart = process.cpuUsage();
        const idleElapsed = performance.now();
        await sleep(1000);
        const idleCpu = process.cpuUsage(idleStart);
        const memory = process.memoryUsage();
        console.log(JSON.stringify({
            environment: { platform: process.platform, arch: process.arch, node: process.version, cpu: os.cpus()[0]?.model, forcedGc: Boolean(global.gc) },
            warmups, iterations, results, requestPipeline, eventLoopP95Ms: round(loop.percentile(95) / 1e6), history,
            idle: { elapsedMs: round(performance.now() - idleElapsed), cpuMs: round((idleCpu.user + idleCpu.system) / 1000),
                rssMiB: round(memory.rss / 1024 ** 2), heapUsedMiB: round(memory.heapUsed / 1024 ** 2) },
        }, null, 2));
    } finally {
        os.homedir = originalHomedir;
        global.fetch = originalFetch;
        fs.rmSync(fixture, { recursive: true, force: true });
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
