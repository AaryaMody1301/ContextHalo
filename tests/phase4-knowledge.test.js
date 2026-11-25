const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMain } = require('./helpers/native-boundary');

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

test('request retrieval loads enabled documents once and reuses them for ranking', () => {
    let reads = 0;
    const rag = loadMain('src/utils/knowledgeRagMain.js', {
        '../storage': { getPreferences: () => ({}) },
        './knowledgeStore': { getEnabledDocuments: () => { reads++; return [{ id: 'db', title: 'Database', enabled: true,
            chunks: [{ id: 'c', text: 'Database indexes reduce query scan cost.' }] }]; } },
    });
    assert.match(rag.retrieveContext('database query indexes'), /indexes reduce query/);
    assert.equal(reads, 1);
});

test('Gemini knowledge retrieval uses the current question after a long unrelated history', () => {
    const rag = loadMain('src/utils/knowledgeRagMain.js', {
        '../storage': { getPreferences: () => ({}) },
        './knowledgeStore': { getEnabledDocuments: () => [
            { id: 'old', title: 'Gardening', enabled: true, chunks: [{ id: 'a', text: 'Orchids need careful watering.' }] },
            { id: 'new', title: 'Database', enabled: true, chunks: [{ id: 'b', text: 'PostgreSQL MVCC provides transaction isolation.' }] },
        ] },
    });
    const question = { role: 'user', parts: [{ text: 'Explain PostgreSQL MVCC transaction isolation.' }] };
    const params = { contents: [
        { role: 'user', parts: [{ text: 'orchids watering '.repeat(1000) }] },
        { role: 'model', parts: [{ text: 'orchids watering '.repeat(1000) }] },
        question,
    ], config: { systemInstruction: 'Answer the question.' } };
    const augmented = rag.augmentGenerateParams(params);
    assert.match(augmented.config.systemInstruction, /PostgreSQL MVCC/);
    assert.doesNotMatch(augmented.config.systemInstruction, /Orchids need/);
    assert.equal(augmented.contents, params.contents);
    assert.equal(params.config.systemInstruction, 'Answer the question.');
    const screenshot = rag.augmentGenerateParams({ contents: [{ inlineData: { data: 'image' } }, ...question.parts] });
    assert.match(screenshot.config.systemInstruction.parts[0].text, /PostgreSQL MVCC/);
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

test('failed knowledge writes preserve valid documents, indexes and practice history', t => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'context-halo-atomic-'));
    t.after(() => fs.rmSync(tempHome, { recursive: true, force: true }));
    let failure = '';
    const boundaryFs = { ...fs,
        writeFileSync(file, ...args) {
            if (failure === 'write') { fs.writeFileSync(file, '{'); throw new Error('Disk full'); }
            return fs.writeFileSync(file, ...args);
        },
        renameSync(...args) {
            if (failure === 'rename') throw new Error('File locked');
            return fs.renameSync(...args);
        },
    };
    const mocks = { fs: boundaryFs, 'node:fs': boundaryFs, os: { ...os, homedir: () => tempHome } };
    const globals = { console: { warn() {}, error() {} } };
    const storage = loadMain('src/storage.js', mocks, globals);
    const knowledge = loadMain('src/utils/knowledgeStore.js', { ...mocks, '../storage': storage }, globals);
    const source = knowledge.addText('Atomic notes', 'Atomic writes preserve the original document when a disk or rename operation fails.');
    knowledge.recordPracticeAttempt({ question: 'Original question', score: 1 });
    // Resolve the store's configured directory rather than assuming a platform path.
    const files = [];
    function collect(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) collect(file); else files.push(file);
        }
    }
    collect(tempHome);
    const originals = files.map(file => [file, fs.readFileSync(file, 'utf8')]);
    for (failure of ['write', 'rename']) {
        assert.throws(() => knowledge.setDocumentEnabled(source.id, false), /Could not save knowledge data/);
        assert.equal(storage.writeJsonFile(path.join(storage.getConfigDir(), 'knowledge', 'index.json'), { documents: [] }), false);
        assert.throws(() => knowledge.recordPracticeAttempt({ question: 'Lost question' }), /Could not save knowledge data/);
        for (const [file, original] of originals) assert.equal(fs.readFileSync(file, 'utf8'), original);
        for (const [file] of originals) assert.equal(fs.readdirSync(path.dirname(file)).some(name => name.endsWith('.tmp')), false);
    }
});

function knowledgeFixture(t, failures = {}) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'context-halo-library-'));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const boundaryFs = {
        ...fs,
        unlinkSync(file) {
            if (failures.remove === file) throw Object.assign(new Error('File locked'), { code: 'EBUSY' });
            return fs.unlinkSync(file);
        },
        copyFileSync(source, destination, mode) {
            if (failures.backup === source) throw Object.assign(new Error('Backup blocked'), { code: 'EACCES' });
            return fs.copyFileSync(source, destination, mode);
        },
    };
    const mocks = { fs: boundaryFs, 'node:fs': boundaryFs, os: { ...os, homedir: () => home } };
    const globals = { console: { warn() {}, error() {} } };
    const storage = loadMain('src/storage.js', mocks, globals);
    const writeJsonFile = storage.writeJsonFile;
    storage.writeJsonFile = (file, data) => failures.write !== file && writeJsonFile(file, data);
    const reload = () => loadMain('src/utils/knowledgeStore.js', { ...mocks, '../storage': storage }, globals);
    const knowledge = reload();
    knowledge.initializeKnowledgeStore();
    const root = path.join(storage.getConfigDir(), 'knowledge');
    const indexFile = path.join(root, 'index.json');
    const documentFile = id => path.join(root, 'documents', id + '.json');
    function seedSources(count) {
        const documents = Array.from({ length: count }, (_, i) => {
            const id = i.toString(16).padStart(24, '0');
            const content = 'Synthetic transaction isolation example for source ' + i + '.';
            const chunks = chunkText(content);
            const metadata = { id, title: 'Source ' + i, sourceType: 'text', sourceName: null, extension: null,
                enabled: true, createdAt: i + 1, updatedAt: i + 1, chars: content.length, chunks: chunks.length };
            fs.writeFileSync(documentFile(id), JSON.stringify({ ...metadata, version: 1, content, chunks }));
            return metadata;
        });
        fs.writeFileSync(indexFile, JSON.stringify({ version: 1, documents }));
        return documents;
    }
    return { home, root, knowledge, reload, storage, indexFile, documentFile, seedSources };
}

test('the knowledge limit rejects new sources without changing existing files or the index', t => {
    const { knowledge, indexFile, documentFile, seedSources } = knowledgeFixture(t);
    const originals = seedSources(499);
    const content = 'Keep this existing source, including its creation date and enabled flag.';
    const added = knowledge.addText('Existing source', content);
    const originalIndex = fs.readFileSync(indexFile);
    const documentDir = path.dirname(documentFile(added.id));
    const existingNames = fs.readdirSync(documentDir);
    assert.equal(knowledge.listDocuments().length, 500);

    assert.throws(() => knowledge.addText('One too many', 'A new named source that exceeds the storage limit.'), /500 sources/);
    assert.deepEqual(fs.readFileSync(indexFile), originalIndex);
    assert.deepEqual(fs.readdirSync(documentDir), existingNames);
    assert.ok(knowledge.listDocuments().some(item => item.id === originals[0].id));

    knowledge.setDocumentEnabled(added.id, false);
    const reimported = knowledge.addText('Existing source', content);
    assert.equal(reimported.id, added.id);
    assert.equal(reimported.createdAt, added.createdAt);
    assert.equal(reimported.enabled, false);
});

test('old sources missing from a full index are listed and searchable after restart', t => {
    const { reload, indexFile, documentFile, seedSources } = knowledgeFixture(t);
    const documents = seedSources(501);
    const hidden = documents.at(-1);
    fs.writeFileSync(indexFile, JSON.stringify({ version: 1, documents: documents.slice(0, 500) }));
    const knowledge = reload();

    assert.equal(knowledge.listDocuments().length, 501);
    assert.ok(knowledge.searchKnowledge('transaction isolation', { documentIds: [hidden.id] }).length);
    const state = knowledge.getKnowledgeLibrary();
    assert.equal(state.status.maxDocuments, 500);
    assert.deepEqual(state.status.unreadableFiles, []);
    assert.throws(() => knowledge.addText('New source', 'This valid source still cannot fit in an overfull library.'), /500 sources/);
    assert.ok(fs.existsSync(documentFile(hidden.id)));
});

test('missing and damaged indexes recover valid sources and preserve unreadable files', t => {
    const { knowledge, reload, root, indexFile, documentFile } = knowledgeFixture(t);
    const first = knowledge.addText('Kept source', 'This valid document should remain present after index recovery.');
    const second = knowledge.addText('Unreadable source', 'This source simulates corruption in an otherwise indexed document.');
    fs.writeFileSync(documentFile(second.id), '{"broken":true}');
    const intactListing = knowledge.getKnowledgeLibrary();
    assert.deepEqual(intactListing.documents.map(item => item.id), [first.id]);
    assert.deepEqual(intactListing.status.unreadableFiles, [second.id + '.json']);
    const invalid = '{ damaged index';
    fs.writeFileSync(indexFile, invalid);
    const recovered = reload();
    assert.deepEqual(recovered.listDocuments().map(item => item.id), [first.id]);
    assert.deepEqual(recovered.getKnowledgeLibrary().status.unreadableFiles, [second.id + '.json']);
    const backups = fs.readdirSync(root).filter(name => /^index\.damaged-/.test(name));
    assert.equal(backups.length, 1);
    assert.equal(fs.readFileSync(path.join(root, backups[0]), 'utf8'), invalid);
    assert.equal(fs.readFileSync(documentFile(second.id), 'utf8'), '{"broken":true}');
    assert.equal(JSON.parse(fs.readFileSync(indexFile, 'utf8')).documents.length, 1);

    fs.unlinkSync(indexFile);
    assert.deepEqual(reload().listDocuments().map(item => item.id), [first.id]);
    assert.ok(fs.existsSync(indexFile));
});

test('index repair waits for a backup and leaves intact sources available if the backup is blocked', t => {
    const failures = {};
    const { knowledge, reload, indexFile } = knowledgeFixture(t, failures);
    const first = knowledge.addText('Kept source', 'When the index cannot be backed up this file remains recoverable.');
    const damage = '{ broken index that must be preserved';
    fs.writeFileSync(indexFile, damage);
    failures.backup = indexFile;
    const library = reload();

    assert.deepEqual(library.listDocuments().map(item => item.id), [first.id]);
    const inspected = library.getKnowledgeLibrary();
    assert.equal(inspected.status.indexRepairPending, true);
    assert.equal(fs.readFileSync(indexFile, 'utf8'), damage);
    assert.throws(() => library.addText('Blocked', 'A new source should not overwrite an index that could not be preserved.'), /Could not save knowledge data/);
    delete failures.backup;
    assert.equal(library.getKnowledgeLibrary().status.indexRepairPending, false);
});

test('deletion leaves the source intact after either write or remove failure and can be retried', t => {
    const failures = {};
    const { knowledge, reload, indexFile, documentFile } = knowledgeFixture(t, failures);
    const saved = knowledge.addText('Transactions', 'A document must remain recoverable until deletion is committed.');
    const file = documentFile(saved.id);
    const originalDocument = fs.readFileSync(file);
    const originalIndex = fs.readFileSync(indexFile);
    failures.write = indexFile;
    assert.throws(() => knowledge.deleteDocument(saved.id), /Could not save knowledge data/);
    assert.ok(fs.existsSync(file));
    assert.deepEqual(fs.readFileSync(file), originalDocument);
    assert.deepEqual(fs.readFileSync(indexFile), originalIndex);
    delete failures.write;

    failures.remove = file;
    assert.throws(() => knowledge.deleteDocument(saved.id), /could not be removed/i);
    assert.deepEqual(fs.readFileSync(file), originalDocument);
    assert.deepEqual(fs.readFileSync(indexFile), originalIndex);
    delete failures.remove;

    // Simulate shutdown after the new index was written, before the file was removed.
    fs.writeFileSync(indexFile, JSON.stringify({ version: 1, documents: [] }));
    const restarted = reload();
    assert.deepEqual(restarted.listDocuments().map(item => item.id), [saved.id]);
    assert.equal(restarted.deleteDocument(saved.id), true);
    assert.equal(restarted.deleteDocument(saved.id), true);
    assert.deepEqual(reload().listDocuments(), []);
    assert.equal(fs.existsSync(file), false);
});

test('failed document writes roll back the index and preserve the enabled flag', t => {
    const failures = {};
    const { knowledge, indexFile, documentFile } = knowledgeFixture(t, failures);
    const saved = knowledge.addText('Existing source', 'This existing source keeps the same metadata after a write failure.');
    const originalIndex = fs.readFileSync(indexFile);

    failures.write = documentFile(saved.id);
    assert.throws(() => knowledge.setDocumentEnabled(saved.id, false), /Could not save knowledge data/);
    assert.deepEqual(fs.readFileSync(indexFile), originalIndex);
    assert.equal(knowledge.loadDocument(saved.id).enabled, true);
});

test('mixed imports reject overlong text and report every skipped selection by name', async t => {
    const { home, knowledge, storage } = knowledgeFixture(t);
    function input(name, content = 'A well-formed synthetic text source for the Knowledge Library.') {
        const file = path.join(home, name);
        fs.writeFileSync(file, content);
        return file;
    }
    const long = 'transaction details\n'.repeat(85_000) + 'do not drop this tail';
    assert.ok(Buffer.byteLength(long) < 2 * 1024 * 1024);
    const selected = [
        input('too-long.txt', long),
        input('unsupported.pdf'),
        ...Array.from({ length: 18 }, (_, i) => input('valid-' + i + '.txt')),
        input('beyond-cap-one.txt'),
        input('beyond-cap-two.txt'),
    ];
    const handlers = new Map();
    const senderFrame = {};
    const window = { isDestroyed: () => false, webContents: { id: 1, mainFrame: senderFrame } };
    const event = { sender: { id: 1 }, senderFrame };
    const { setupPhase4Main } = loadMain('src/utils/phase4Main.js', {
        '../storage': storage,
        './knowledgeStore': knowledge,
        electron: { dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: selected }) } },
    });
    setupPhase4Main(window, { handle: (name, handler) => handlers.set(name, handler) });
    const result = await handlers.get('knowledge:import')(event);
    assert.equal(result.success, true);
    assert.equal(result.data.imported.length, 18);
    assert.deepEqual(result.data.failed.map(item => item.name), [
        'too-long.txt', 'unsupported.pdf', 'beyond-cap-one.txt', 'beyond-cap-two.txt',
    ]);
    assert.match(result.data.failed[0].error, /1,500,000 characters/);
    assert.match(result.data.failed[1].error, /unsupported knowledge file type/i);
    for (const skipped of result.data.failed.slice(2)) assert.match(skipped.error, /20 files/);
    assert.equal(fs.readFileSync(selected[0], 'utf8'), long);
    const listed = await handlers.get('knowledge:list')(event);
    assert.equal(listed.data.length, 18);
    assert.equal(listed.status.maxDocuments, 500);
    assert.equal(listed.status.maxImportFiles, 20);
    assert.equal(listed.status.maxTextChars, 1_500_000);
    const pasted = await handlers.get('knowledge:add-text')(event, 'Overlong pasted text', long);
    assert.equal(pasted.success, false);
    assert.match(pasted.error, /1,500,000 characters/);
    assert.equal(knowledge.listDocuments().length, 18);
});
