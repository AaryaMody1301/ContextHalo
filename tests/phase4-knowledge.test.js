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
    sessionAsPracticeSource,
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

test('knowledge retrieval clips an oversized first match within the text budget', () => {
    const text = 'Database isolation protects each concurrent transaction. '.repeat(40).trim();
    const docs = [{ id: 'db', title: 'Database guide', sourceType: 'file',
        chunks: chunkText(text, { maxChars: 2000 }) }];
    const [unclipped] = retrieveChunks(docs, 'database isolation', { maxChars: 5000 });
    const results = retrieveChunks(docs, 'database isolation', { maxChars: 1000 });
    assert.ok(unclipped.text.length > 1000);
    assert.deepEqual(results, [{ ...unclipped, text: unclipped.text.slice(0, 1000) }]);
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
        '../storage': { getPreferences: () => ({ cloudKnowledgeEnabled: true }) },
        './knowledgeStore': { getEnabledDocuments: () => { reads++; return [{ id: 'db', title: 'Database', enabled: true,
            chunks: [{ id: 'c', text: 'Database indexes reduce query scan cost.' }] }]; } },
    });
    assert.match(rag.retrieveContext('database query indexes'), /indexes reduce query/);
    assert.equal(reads, 1);
    assert.match(rag.retrieveContext('database indexes', { maxChars: 12 }), /Source 1: Database\nDatabase ind$/);
});

test('Gemini knowledge retrieval uses the current question after a long unrelated history', () => {
    const rag = loadMain('src/utils/knowledgeRagMain.js', {
        '../storage': { getPreferences: () => ({ cloudKnowledgeEnabled: true }) },
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

test('provider retrieval skips empty queries, stop words and an earlier turn on image-only requests', async () => {
    const preferences = { cloudKnowledgeEnabled: true };
    let reads = 0;
    const mocks = {
        '../storage': { getPreferences: () => preferences },
        './knowledgeStore': { getEnabledDocuments: () => {
            reads++;
            return [{ id: 'fixture', title: 'Data guide', chunks: chunkText('Database indexes reduce scan cost.') }];
        } },
    };
    const rag = loadMain('src/utils/knowledgeRagMain.js', mocks);
    const text = 'Explain database indexes.';
    const imageOnly = { contents: [{ role: 'user', parts: [{ inlineData: { data: 'fixture' } }] }] };
    assert.equal(rag.retrieveContext(''), '', 'Gemini Live setup has no query before the user speaks');
    assert.equal(rag.retrieveContext('What is it?'), '');
    assert.equal(rag.retrieveContext('', { scope: 'local' }), '');
    assert.equal(rag.augmentGenerateParams(imageOnly), imageOnly);

    const wire = [];
    const { createProviderFetch } = loadMain('src/utils/providerRequestMain.js', mocks);
    const fetch = createProviderFetch(async (_url, init) => { wire.push(JSON.parse(init.body)); });
    for (const host of ['https://api.groq.com/openai/v1', 'https://api.mistral.ai/v1', 'http://127.0.0.1:8080/v1']) {
        const messages = [
            { role: 'user', content: text },
            { role: 'assistant', content: 'Answered.' },
            { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,fixture' } }] },
        ];
        await fetch(host + '/chat/completions', { body: JSON.stringify({ messages }) });
        assert.doesNotMatch(JSON.stringify(wire.at(-1)), /ContextHalo knowledge|reduce scan cost/);
    }
    assert.equal(reads, 0, 'queryless requests must not open the knowledge inventory');
    preferences.sessionPack = { goal: 'database indexes' };
    assert.match(rag.retrieveContext(''), /reduce scan cost/, 'explicit session terms still seed retrieval');
    assert.match(rag.retrieveContext('What is it?'), /reduce scan cost/);
    assert.equal(reads, 2);
});

test('outgoing provider requests require separate cloud consent for knowledge and clipboard', async () => {
    const preferences = { sessionPack: { title: 'Fixture review', clipboardText: 'private clipboard fixture' } };
    let preferenceReads = 0;
    const sent = [];
    const send = async (input, init) => { sent.push({ input, ...init }); };
    const mocks = {
        '../storage': { getPreferences: () => { preferenceReads += 1; return preferences; } },
        './knowledgeStore': { getEnabledDocuments: () => [
            { id: 'doc', title: 'Fixture document', chunks: [{ id: 'chunk', text: 'Database indexes reduce scan cost.' }] },
        ] },
    };
    const pack = loadMain('src/utils/sessionPackMain.js', mocks);
    const rag = loadMain('src/utils/knowledgeRagMain.js', mocks);
    const { createProviderFetch } = loadMain('src/utils/providerRequestMain.js', mocks);
    const fetch = createProviderFetch(send);
    const question = 'Explain database indexes.';
    const params = { contents: question, config: { systemInstruction: pack.appendSessionPack('Respond.') } };
    assert.match(params.config.systemInstruction, /Fixture review/);
    assert.doesNotMatch(params.config.systemInstruction, /private clipboard/);
    assert.equal(rag.retrieveContext(''), '');
    assert.equal(rag.augmentGenerateParams(params), params);
    assert.equal(rag.augmentLiveTextPayload({ text: question }).text, question);

    const hosts = ['https://api.groq.com/openai/v1', 'https://api.mistral.ai/v1', 'http://127.0.0.1:8080/v1'];
    for (const [knowledge, clipboard] of [[false, false], [true, false], [false, true], [true, true]]) {
        preferences.cloudKnowledgeEnabled = knowledge;
        preferences.cloudClipboardEnabled = clipboard;
        assert.equal(pack.appendSessionPack('Respond.').includes('private clipboard'), clipboard);
        assert.equal(rag.augmentLiveTextPayload({ text: question }).text.includes('reduce scan cost'), knowledge);
        assert.equal(rag.augmentGenerateParams(params).config.systemInstruction.includes('reduce scan cost'), knowledge);
        for (const host of hosts) {
            const reads = preferenceReads;
            await fetch(host + '/chat/completions', { body: JSON.stringify({ messages: [{ role: 'user', content: question }] }) });
            assert.equal(preferenceReads - reads, 1, 'each request reads preferences once');
            const { body, redirect } = sent.at(-1);
            assert.match(body, /Fixture review/);
            assert.equal(body.includes('reduce scan cost'), knowledge || host.startsWith('http:'));
            assert.equal(body.includes('private clipboard'), clipboard || host.startsWith('http:'));
            assert.equal(redirect, 'error');
        }
    }
    const request = { body: JSON.stringify({ messages: [{ role: 'user', content: question }] }) };
    const reads = preferenceReads;
    await fetch('https://api.groq.com/openai/v1/chat/completions/other', request);
    assert.deepEqual(sent.at(-1), { input: 'https://api.groq.com/openai/v1/chat/completions/other', ...request });
    assert.equal(preferenceReads, reads);
});

test('practice questions and grading work without a provider', () => {
    const source = {
        id: 'doc-1',
        title: 'SQL joins',
        content: 'An inner join returns rows when the join condition matches in both tables. A left join preserves every row from the left table and fills unmatched right-side columns with null values. Indexes can improve join performance when predicates use indexed columns.',
    };
    const questions = generatePracticeQuestions([source], 3);
    assert.ok(questions.length >= 2);
    const question = questions.find(item => item.type === 'recall');
    assert.ok(question);
    for (const answer of [question.reference, `It is false that ${question.reference}`, 'I do not remember']) {
        const result = gradeAnswer(question, answer);
        assert.equal(result.score, null);
        assert.equal(result.level, 'review');
        assert.match(result.feedback, /self-review/i);
    }
});

test('cloze grading checks the missing word on its own', () => {
    const [question] = generatePracticeQuestions([{
        id: 'transactions', title: 'Database notes',
        content: 'Database transactions preserve consistency when concurrent clients modify shared records.',
    }], 1);
    assert.equal(question.type, 'cloze');
    assert.doesNotMatch(question.prompt, /\btransactions\b/i);

    const correct = gradeAnswer(question, ' Transactions. ');
    assert.deepEqual({ score: correct.score, level: correct.level }, { score: 1, level: 'strong' });
    for (const wrong of ['database', 'not transactions', '']) {
        const grade = gradeAnswer(question, wrong);
        assert.deepEqual({ score: grade.score, level: grade.level }, { score: 0, level: 'retry' });
    }
});

test('session review and practice include each persisted reply once', () => {
    const current = 'PostgreSQL uses multiversion concurrency control to coordinate independent transactions.';
    const legacy = 'A database index reduces the number of rows scanned for matching predicates.';
    const content = 'Regular checkpoints help a database recover after an unexpected shutdown.';
    const session = {
        sessionId: '123',
        conversationHistory: [
            { transcription: 'How do transactions work?', ai_response: current },
            { transcription: 'How do transactions commit?', ai_response: current, response: current, content: current },
            { transcription: 'What do indexes do?', ai_response: ' ', response: legacy, content: legacy },
            { role: 'assistant', content },
        ],
    };
    const expectedText = [
        'How do transactions work?', current, 'How do transactions commit?', current,
        'What do indexes do?', legacy, content,
    ].join('\n');
    assert.equal(buildSessionReview(session).text, expectedText);
    assert.equal(sessionAsPracticeSource(session).content, expectedText);
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
    const documentReads = new Map();
    const boundaryFs = {
        ...fs,
        readFileSync(file, ...args) {
            if (typeof file === 'string' && path.basename(path.dirname(file)) === 'documents') {
                documentReads.set(file, (documentReads.get(file) || 0) + 1);
            }
            return fs.readFileSync(file, ...args);
        },
        statSync(file, ...args) {
            const stat = fs.statSync(file, ...args);
            if (failures.oversized === file) stat.size = 25 * 1024 * 1024;
            return stat;
        },
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
    return { home, root, knowledge, reload, storage, indexFile, documentFile, seedSources, documentReads };
}

test('file-backed retrieval reuses unchanged files and sees replacements, disable, and deletion', t => {
    const overrides = {};
    const { knowledge, storage, documentFile, documentReads } = knowledgeFixture(t, overrides);
    const first = knowledge.addText('Database', 'Database transactions use locks to preserve isolation during conflicting writes.');
    const second = knowledge.addText('Dashboard', 'A dashboard reads metrics on a regular cadence and updates its charts.');
    documentReads.clear();
    const before = knowledge.searchKnowledge('database isolation');
    assert.ok(before.some(item => item.documentId === first.id));
    const reads = new Map(documentReads);
    assert.deepEqual(knowledge.searchKnowledge('database isolation'), before);
    knowledge.listDocuments();
    assert.deepEqual(documentReads, reads, 'unchanged documents should be parsed once across search and listing');

    const file = documentFile(first.id);
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const content = 'Transaction snapshots let readers see a consistent version without blocking on updating rows.';
    assert.ok(storage.writeJsonFile(file, { ...doc, content, chunks: chunkText(content) }));
    const after = knowledge.searchKnowledge('transaction snapshots');
    assert.match(after[0].text, /consistent version/);
    assert.equal(after[0].documentId, first.id);
    assert.equal(documentReads.get(documentFile(second.id)), reads.get(documentFile(second.id)));
    knowledge.setDocumentEnabled(first.id, false);
    assert.deepEqual(knowledge.searchKnowledge('transaction snapshots'), []);
    knowledge.setDocumentEnabled(first.id, true);
    assert.equal(knowledge.searchKnowledge('transaction snapshots')[0].documentId, first.id);
    fs.unlinkSync(file);
    assert.deepEqual(knowledge.searchKnowledge('transaction snapshots'), []);

    const oversized = documentFile(second.id);
    overrides.oversized = oversized;
    const start = documentReads.get(oversized);
    for (let i = 0; i < 2; i++) assert.equal(knowledge.searchKnowledge('dashboard')[0].documentId, second.id);
    assert.equal(documentReads.get(oversized), start + 2, 'an oversized source remains searchable without being retained');
});

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

test('knowledge deletion confirms the exact source over trusted IPC and preserves it on cancel', async t => {
    const { knowledge, storage } = knowledgeFixture(t);
    const one = knowledge.addText('First synthetic source', 'The document is retained until confirmed.');
    const other = knowledge.addText('Second synthetic source', 'An unrelated source remains in the library.');
    const handlers = new Map();
    const senderFrame = {};
    const window = { isDestroyed: () => false, webContents: { id: 1, mainFrame: senderFrame } };
    const event = { sender: { id: 1 }, senderFrame };
    let reply;
    const options = [];
    const { setupPhase4Main } = loadMain('src/utils/phase4Main.js', {
        '../storage': storage,
        './knowledgeStore': knowledge,
        electron: { dialog: { showMessageBox: (owner, config) => {
            assert.equal(owner, window);
            options.push(config);
            return new Promise(resolve => { reply = response => resolve({ response }); });
        } } },
    });
    setupPhase4Main(window, { handle: (channel, handler) => handlers.set(channel, handler) });
    const remove = handlers.get('knowledge:delete');
    assert.equal((await remove({ ...event, senderFrame: {} }, one.id)).success, false);
    assert.equal(options.length, 0);
    const cancel = remove(event, one.id);
    assert.equal((await remove(event, other.id)).cancelled, true);
    assert.deepEqual(options[0].buttons, ['Cancel', 'Delete knowledge source']);
    assert.equal(options[0].defaultId, 0);
    assert.equal(options[0].cancelId, 0);
    assert.match(options[0].detail, /First synthetic source/);
    reply(0);
    assert.equal((await cancel).cancelled, true);
    assert.ok(knowledge.loadDocument(one.id));
    const confirm = remove(event, one.id);
    reply(1);
    assert.equal((await confirm).success, true);
    assert.equal(knowledge.loadDocument(one.id), null);
    assert.ok(knowledge.loadDocument(other.id));
});


test('linked search excerpts resolve the exact imported span through trusted IPC', async t => {
    const { knowledge, storage } = knowledgeFixture(t);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-excerpt-'));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const file = path.join(tmp, 'warehouse.txt');
    fs.writeFileSync(file, `Intro to the warehouse.\r\n\r\n\r\n  ${'Staging contains incoming rows. '.repeat(52)}\r\nUnique checkpoint anchor.\r\n`);
    const { imported: [imported] } = knowledge.importFiles([file]);
    fs.unlinkSync(file);
    const handlers = new Map();
    const frame = {};
    const window = { isDestroyed: () => false, webContents: { id: 1, mainFrame: frame } };
    const event = { sender: window.webContents, senderFrame: frame };
    const main = loadMain('src/utils/phase4Main.js', { '../storage': storage, './knowledgeStore': knowledge });
    main.setupPhase4Main(window, { handle: (name, cb) => handlers.set(name, cb) });
    const query = handlers.get('knowledge:search');
    const resolve = handlers.get('knowledge:excerpt');
    const { data: [hit] } = await query(event, 'unique checkpoint anchor');
    assert.equal(hit.documentId, imported.id);
    assert.equal((await resolve({ ...event, senderFrame: {} }, hit.documentId, hit.chunkId)).success, false);
    assert.equal((await resolve(event, '../warehouse.txt', hit.chunkId)).success, false);
    assert.equal((await resolve(event, hit.documentId, 'chunk-9999')).success, false);
    const document = knowledge.loadDocument(imported.id);
    assert.ok(document.chunks.every(chunk => !Object.hasOwn(chunk, 'start')), 'Existing storage needs no span migration');
    for (const chunk of document.chunks) {
        const { success, data } = await resolve(event, hit.documentId, chunk.id);
        assert.equal(success, true);
        assert.equal(data.sourceName, 'warehouse.txt');
        assert.equal(data.text, document.content.slice(data.start, data.end));
        assert.equal(data.startLine, document.content.slice(0, data.start).split('\n').length);
        assert.equal(data.endLine, document.content.slice(0, data.end).split('\n').length);
        assert.equal(data.text.replace(/\n{2,}/g, '\n\n').replace(/\n\n +/g, '\n\n'), chunk.text);
    }
    const excerpt = (await resolve(event, hit.documentId, hit.chunkId)).data;
    assert.match(excerpt.text, /Unique checkpoint anchor/);
    knowledge.setDocumentEnabled(hit.documentId, false);
    assert.equal((await resolve(event, hit.documentId, hit.chunkId)).success, false);
    knowledge.deleteDocument(hit.documentId);
    assert.equal((await resolve(event, hit.documentId, hit.chunkId)).success, false);
});

test('offline tracks score fixed choices and keep answer keys out of generated questions', t => {
    const { knowledge, storage } = knowledgeFixture(t);
    const main = loadMain('src/utils/phase4Main.js', { '../storage': storage, './knowledgeStore': knowledge });
    assert.throws(() => main.createPracticeSet({ sourceType: 'track', trackId: '__proto__' }), /choose a practice topic/i);
    for (const [trackId, correct] of [['sql', '1'], ['python', '2'], ['data-engineering', '2']]) {
        const set = main.createPracticeSet({ sourceType: 'track', trackId });
        assert.equal(set.questions.length, 3);
        const [question] = set.questions;
        assert.deepEqual(Object.keys(question).sort(), ['choices', 'id', 'prompt', 'sourceId', 'sourceTitle', 'type']);
        assert.equal(question.choices.length, 3);
        assert.throws(() => main.gradePractice(set.setId, question.id, '99'), /choose an answer/i);
        const wrong = main.gradePractice(set.setId, question.id, '0');
        assert.equal(wrong.score, 0);
        assert.match(wrong.feedback, /^Incorrect/);
        const right = main.gradePractice(set.setId, question.id, correct);
        assert.equal(right.score, 1);
        assert.equal(right.feedback, 'Correct.');
        assert.ok(right.reference.length > 20);
    }
    assert.equal(knowledge.getPracticeHistory().length, 6);
});

test('local lexical retrieval puts each labeled excerpt ahead of overlapping distractors', () => {
    const documents = [
        ['sql', 'SQL query notes', 'COUNT(column) ignores NULL values. COUNT(*) counts all rows.'],
        ['python', 'Python data structures', 'Dictionary get returns a default for a missing key without mutating the dictionary.'],
        ['checkpoint', 'Pipeline checkpoint', 'Persist the watermark only after the destination transaction commits.'],
        ['retry', 'Pipeline retries', 'Upsert using a stable event ID so a retry does not duplicate events.'],
        ['quality', 'Pipeline data quality', 'Quarantine malformed timestamps and alert operators about parsing errors.'],
        ['partition', 'Warehouse performance', 'Partition pruning avoids scanning unrelated date ranges in warehouse queries.'],
    ].map(([id, title, text]) => ({ id, title, chunks: chunkText(text) }));
    const queries = [
        ['count column null values', 'sql'],
        ['dictionary default missing key', 'python'],
        ['pipeline checkpoint watermark commits', 'checkpoint'],
        ['pipeline retry duplicate events stable ID', 'retry'],
        ['pipeline parsing malformed timestamps', 'quality'],
        ['partition pruning query scans date ranges', 'partition'],
        ['astronomy telescopes galaxies', undefined],
    ];
    for (const [query, expected] of queries) assert.equal(retrieveChunks(documents, query)[0]?.documentId, expected, query);
});
