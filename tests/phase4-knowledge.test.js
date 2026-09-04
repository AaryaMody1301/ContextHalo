const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    chunkText,
    retrieveChunks,
    formatRetrievedContext,
} = require('../src/utils/knowledgeCore');
const {
    generatePracticeQuestions,
    gradeAnswer,
    buildSessionReview,
} = require('../src/utils/practiceCore');

function read(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('knowledge core chunks text and ranks relevant local context', () => {
    const docs = [
        {
            id: 'alpha',
            title: 'Database notes',
            enabled: true,
            chunks: chunkText('PostgreSQL uses MVCC for concurrency. Indexes can reduce scan cost. Transactions provide atomicity and isolation.'),
        },
        {
            id: 'beta',
            title: 'Frontend notes',
            enabled: true,
            chunks: chunkText('React renders components. CSS controls layout and visual presentation. Browser events drive interactive interfaces.'),
        },
    ];
    const results = retrieveChunks(docs, 'How does PostgreSQL concurrency work?', { limit: 2 });
    assert.equal(results[0].documentId, 'alpha');
    assert.match(results[0].text, /MVCC/i);
    assert.match(formatRetrievedContext(results), /ContextHalo knowledge/);
});

test('disabled knowledge sources do not participate in retrieval', () => {
    const docs = [
        { id: 'off', title: 'Secret', enabled: false, chunks: chunkText('zebra migration protocol uses violet tokens') },
        { id: 'on', title: 'Public', enabled: true, chunks: chunkText('ordinary project planning information for release sequencing') },
    ];
    const results = retrieveChunks(docs, 'zebra migration violet', { limit: 5 });
    assert.equal(results.some(result => result.documentId === 'off'), false);
});

test('practice questions and grading work without a provider', () => {
    const source = {
        id: 'doc-1',
        title: 'SQL joins',
        content: 'An inner join returns rows when the join condition matches in both tables. A left join preserves every row from the left table and fills unmatched right-side columns with null values. Indexes can improve join performance when predicates use indexed columns.',
    };
    const questions = generatePracticeQuestions([source], 3);
    assert.ok(questions.length >= 2);
    const question = questions.find(item => item.type === 'recall') || questions[0];
    const strong = gradeAnswer(question, question.reference);
    assert.equal(strong.level, 'strong');
    const weak = gradeAnswer(question, 'I do not remember');
    assert.ok(weak.score < strong.score);
});

test('session review extracts markers and reusable topics locally', () => {
    const review = buildSessionReview({
        sessionId: '123',
        createdAt: 1000,
        lastUpdated: 121000,
        profile: 'meeting',
        sessionPack: { title: 'Launch review', goal: 'Choose the rollout order' },
        liveTranscript: [
            { final: true, text: 'We should ship the database migration before the dashboard redesign because the API schema changes first.' },
            { final: false, text: 'interim words' },
        ],
        markers: [
            { type: 'decision', transcript: 'Ship the database migration first.' },
            { type: 'action', transcript: 'Aarya will prepare the migration checklist.' },
            { type: 'question', transcript: 'Do we need a rollback rehearsal?' },
        ],
        conversationHistory: [],
    });
    assert.equal(review.title, 'Launch review');
    assert.equal(review.durationMinutes, 2);
    assert.deepEqual(review.decisions, ['Ship the database migration first.']);
    assert.deepEqual(review.actions, ['Aarya will prepare the migration checklist.']);
    assert.ok(review.topics.includes('migration'));
    assert.equal(review.practiceReady, true);
});

test('knowledge store persists text sources under the ContextHalo config directory', { concurrency: false }, t => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'context-halo-knowledge-'));
    const originalHomedir = os.homedir;
    os.homedir = () => tempHome;

    const modulePaths = [
        require.resolve('../src/storage'),
        require.resolve('../src/utils/knowledgeStore'),
    ];
    for (const modulePath of modulePaths) delete require.cache[modulePath];
    const knowledge = require('../src/utils/knowledgeStore');

    t.after(() => {
        for (const modulePath of modulePaths) delete require.cache[modulePath];
        os.homedir = originalHomedir;
        fs.rmSync(tempHome, { recursive: true, force: true });
    });

    const saved = knowledge.addText(
        'Architecture notes',
        'The Windows renderer remains sandboxed and context isolated. Provider requests have bounded deadlines and session cancellation. Local retrieval should not weaken those boundaries.'
    );
    assert.equal(saved.title, 'Architecture notes');
    assert.equal(saved.enabled, true);
    assert.equal(knowledge.listDocuments().length, 1);
    assert.match(knowledge.searchKnowledge('sandboxed renderer provider deadlines')[0].text, /sandboxed/i);
    knowledge.setDocumentEnabled(saved.id, false);
    assert.equal(knowledge.searchKnowledge('sandboxed renderer provider deadlines').length, 0);
    assert.equal(knowledge.deleteDocument(saved.id), true);
    assert.equal(knowledge.listDocuments().length, 0);
});

test('Phase 4 stays additive and preserves the hardened renderer bridge', () => {
    const index = read('src/index.js');
    const preload = read('preload.js');
    const html = read('src/index.html');
    const rag = read('src/utils/knowledgeRagMain.js');
    const renderer = read('src/utils/phase4Renderer.js');
    const packageJson = JSON.parse(read('package.json'));

    assert.match(index, /installKnowledgeRagMain\(\)/);
    assert.match(index, /setupPhase4Main\(mainWindow, ipcMain\)/);
    assert.match(preload, /'knowledge:import'/);
    assert.match(preload, /'practice:generate'/);
    assert.match(preload, /'review:get'/);
    assert.match(html, /phase4Renderer\.js/);
    assert.match(rag, /ContextHalo knowledge/);
    assert.match(rag, /api\.groq\.com/);
    assert.match(rag, /127\.0\.0\.1/);
    assert.match(renderer, /Practice Lab/);
    assert.equal(packageJson.dependencies['pdf-parse'], undefined);
    assert.equal(packageJson.dependencies.mammoth, undefined);
});
