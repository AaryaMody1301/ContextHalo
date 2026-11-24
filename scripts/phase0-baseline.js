// Opt-in Phase 0 probe. Run separately from the normal regression suite.
// Uses only synthetic data and the existing dependency-free application modules.
const assert = require('node:assert/strict');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { generatePracticeQuestions, gradeAnswer, buildSessionReview } = require('../src/utils/practiceCore');
const { chunkText, retrieveChunks } = require('../src/utils/knowledgeCore');

const findings = [];
function probe(id, run) {
    try {
        run();
        findings.push({ id, status: 'pass' });
    } catch (error) {
        findings.push({ id, status: 'fail', message: error.message, actual: error.actual, expected: error.expected });
    }
}

probe('BUG-01', () => {
    const [question] = generatePracticeQuestions([{ id: 'synthetic', title: 'Database notes',
        content: 'Database transactions preserve consistency when concurrent clients modify shared records.' }], 1);
    assert.equal(question.type, 'cloze');
    const correctWord = 'transactions';
    assert.match(question.reference, new RegExp('\\b' + correctWord + '\\b'));
    assert.equal(question.prompt.includes(correctWord), false);
    const grade = gradeAnswer(question, correctWord);
    assert.deepEqual({ score: grade.score, level: grade.level }, { score: 1, level: 'strong' });
});

probe('BUG-02', () => {
    const answer = 'PostgreSQL uses multiversion concurrency control.';
    const review = buildSessionReview({ sessionId: '123', conversationHistory: [{ transcription: 'How does it work?', ai_response: answer }] });
    assert.ok(review.text.includes(answer), 'Review must include the persisted ai_response field.');
});

const samples = [];
const percentile = (sorted, fraction) => Number(sorted[Math.ceil(sorted.length * fraction) - 1].toFixed(2));
const query = 'database transaction isolation consistency locks';
for (const count of [10, 100, 500]) {
    const documents = Array.from({ length: count }, (_, i) => ({ id: 'doc-' + i, title: 'Synthetic database guide ' + i,
        enabled: true, chunks: chunkText(('Document ' + i + ': database transaction isolation consistency locks and recovery.\n\n').repeat(100)) }));
    for (let i = 0; i < 5; i++) retrieveChunks(documents, query);
    const durations = [];
    for (let i = 0; i < 30; i++) {
        const start = performance.now();
        const result = retrieveChunks(documents, query);
        durations.push(performance.now() - start);
        assert.ok(result.length > 0);
    }
    durations.sort((a, b) => a - b);
    samples.push({ documents: count, chunks: documents.reduce((sum, doc) => sum + doc.chunks.length, 0),
        iterations: durations.length, p50Ms: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95) });
}
console.log(JSON.stringify({ environment: { node: process.version, platform: process.platform, arch: process.arch,
    cpu: os.cpus()[0]?.model }, findings, retrievalInMemory: samples,
    limitations: 'Synthetic in-memory retrieval only; excludes filesystem, Electron, Windows hardware and cloud inference.' }, null, 2));
if (findings.some(item => item.status !== 'pass')) process.exitCode = 1;
