const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const storage = require('../storage');
const { chunkText, normalizeText, retrieveChunks } = require('./knowledgeCore');

const KNOWLEDGE_VERSION = 1;
const DOCUMENT_ID = /^[a-f0-9]{1,64}$/i;
const MAX_DOCUMENTS = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_FILES = 20;
const MAX_TEXT_CHARS = 1_500_000;
const SUPPORTED_EXTENSIONS = new Set([
    '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log', '.html', '.htm',
    '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cc', '.cpp', '.h', '.hpp',
    '.sql', '.yaml', '.yml', '.toml', '.ini', '.properties', '.xml', '.css', '.scss', '.sh', '.ps1',
]);

// Limit retained documents by their combined serialized size. Large stores still
// search files beyond this budget without clearing already cached documents.
const MAX_CACHED_DOCUMENT_BYTES = 24 * 1024 * 1024;
const documentEntries = new Map();
let cachedDocumentBytes = 0;
let entriesDirectory;

function forgetDocument(id) {
    cachedDocumentBytes -= documentEntries.get(id)?.bytes || 0;
    documentEntries.delete(id);
}

function clearDocumentEntries() {
    documentEntries.clear();
    cachedDocumentBytes = 0;
}

function getKnowledgeDir() {
    return path.join(storage.getConfigDir(), 'knowledge');
}

function getDocumentsDir() {
    return path.join(getKnowledgeDir(), 'documents');
}

function getIndexPath() {
    return path.join(getKnowledgeDir(), 'index.json');
}

function getPracticeDir() {
    return path.join(storage.getConfigDir(), 'practice');
}

function getPracticeHistoryPath() {
    return path.join(getPracticeDir(), 'attempts.json');
}

function safeReadJson(filePath, fallback) {
    try {
        return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback;
    } catch (error) {
        console.warn(`Could not read ${filePath}:`, error.message);
        return fallback;
    }
}

function safeWriteJson(filePath, data) {
    if (!storage.writeJsonFile(filePath, data)) throw new Error('Could not save knowledge data. Check available disk space and file permissions.');
}

function initializeKnowledgeStore() {
    fs.mkdirSync(getDocumentsDir(), { recursive: true });
    fs.mkdirSync(getPracticeDir(), { recursive: true });
    if (!fs.existsSync(getPracticeHistoryPath())) {
        safeWriteJson(getPracticeHistoryPath(), { version: 1, attempts: [] });
    }
}

function sanitizeTitle(value, fallback = 'Untitled source') {
    const title = typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 180) : '';
    return title || fallback;
}

function readStoredIndex() {
    let content;
    try {
        content = fs.readFileSync(getIndexPath(), 'utf8');
    } catch (error) {
        return { blocked: error.code !== 'ENOENT' };
    }
    try {
        const data = JSON.parse(content);
        if (data?.version === KNOWLEDGE_VERSION && Array.isArray(data.documents)) {
            const ids = data.documents.map(item => item?.id);
            if (ids.every(id => typeof id === 'string' && DOCUMENT_ID.test(id)) && new Set(ids).size === ids.length) {
                return { data };
            }
        }
    } catch {}
    return { damaged: true };
}

function documentIds(index) {
    const directory = getDocumentsDir();
    if (entriesDirectory !== directory) {
        clearDocumentEntries();
        entriesDirectory = directory;
    }
    const present = new Set();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const id = entry.name.slice(0, -5);
        if (DOCUMENT_ID.test(id)) present.add(id);
    }
    for (const id of documentEntries.keys()) {
        if (!present.has(id)) forgetDocument(id);
    }
    const indexed = (index?.documents ?? []).map(item => item.id).filter(id => present.delete(id));
    return [...indexed, ...[...present].sort()];
}

function documentPath(id) {
    if (typeof id !== 'string' || !DOCUMENT_ID.test(id)) throw new Error('Invalid knowledge document ID');
    return path.join(getDocumentsDir(), `${id}.json`);
}

function readDocumentEntry(id, includeDocument = false) {
    try {
        const file = documentPath(id);
        const stat = fs.statSync(file);
        const version = `${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
        const cached = documentEntries.get(id);
        const unchanged = cached?.version === version;
        if (unchanged && (!includeDocument || cached.document)) return cached;

        const document = loadDocument(id);
        forgetDocument(id);
        if (!document) return null;

        const metadata = unchanged ? cached.metadata : metadataFromDocument(document);
        const retainDocument = includeDocument && cachedDocumentBytes + stat.size <= MAX_CACHED_DOCUMENT_BYTES;
        const bytes = retainDocument ? stat.size : 0;
        const entry = { version, metadata, document: retainDocument ? document : null, bytes };
        cachedDocumentBytes += bytes;
        documentEntries.set(id, entry);
        return includeDocument && !retainDocument ? { ...entry, document } : entry;
    } catch {
        forgetDocument(id);
        return null;
    }
}

function readInventory() {
    initializeKnowledgeStore();
    const stored = readStoredIndex();
    const ids = new Set(documentIds(stored.data));
    const documents = [];
    const unreadableFiles = [];
    for (const id of ids) {
        const entry = readDocumentEntry(id);
        if (entry) documents.push(entry.metadata);
        else unreadableFiles.push(`${id}.json`);
    }
    return { stored, ids, index: { version: KNOWLEDGE_VERSION, documents }, unreadableFiles };
}

function saveIndex(index, stored) {
    if (stored.blocked) throw new Error('Could not save knowledge data. Check access to the existing index.');
    let backup = null;
    if (stored.damaged) {
        backup = `index.damaged-${crypto.randomUUID()}.json`;
        try {
            fs.copyFileSync(getIndexPath(), path.join(getKnowledgeDir(), backup), fs.constants.COPYFILE_EXCL);
        } catch {
            throw new Error('Could not save knowledge data. The damaged index could not be backed up.');
        }
    }
    safeWriteJson(getIndexPath(), index);
    return backup;
}

function applyIndexChange(inventory, documents, mutateDocument) {
    const next = { version: KNOWLEDGE_VERSION, documents };
    // The document file remains authoritative until its write or removal succeeds.
    // A failed index write leaves it untouched, and reopening repairs an interrupted update.
    saveIndex(next, inventory.stored);
    try {
        mutateDocument();
    } catch (error) {
        if (storage.writeJsonFile(getIndexPath(), inventory.index)) inventory.stored = { data: inventory.index };
        throw error;
    }
    inventory.stored = { data: next };
    inventory.index = next;
}

function makeDocumentId(title, text) {
    return crypto.createHash('sha256').update(`${title}\u0000${text}`).digest('hex').slice(0, 24);
}

function metadataFromDocument(document) {
    return {
        id: document.id,
        title: sanitizeTitle(document.title),
        sourceType: document.sourceType === 'file' ? 'file' : 'text',
        sourceName: sanitizeTitle(document.sourceName, null),
        extension: typeof document.extension === 'string' ? document.extension.slice(0, 16) : null,
        enabled: document.enabled !== false,
        createdAt: Number.isFinite(document.createdAt) ? document.createdAt : 0,
        updatedAt: Number.isFinite(document.updatedAt) ? document.updatedAt : 0,
        chars: document.content.length,
        chunks: document.chunks.length,
    };
}

function saveDocument(document, inventory) {
    const metadata = metadataFromDocument(document);
    const documents = [...inventory.index.documents];
    const existing = documents.findIndex(item => item.id === document.id);
    if (existing >= 0) documents[existing] = metadata;
    else {
        if (documents.length >= MAX_DOCUMENTS) {
            throw new Error(`The Knowledge Library limit is ${MAX_DOCUMENTS} sources. Remove a source before adding another.`);
        }
        documents.unshift(metadata);
    }
    applyIndexChange(inventory, documents, () => safeWriteJson(documentPath(document.id), document));
    inventory.ids.add(document.id);
    forgetDocument(document.id);
    return metadata;
}

function createDocument({ title, content, sourceType = 'text', sourceName = null, extension = null }, inventory) {
    const cleanContent = normalizeText(content, MAX_TEXT_CHARS + 1);
    if (cleanContent.length > MAX_TEXT_CHARS) {
        throw new Error(`Text exceeds ${MAX_TEXT_CHARS.toLocaleString('en-US')} characters. Split it into smaller sources.`);
    }
    if (cleanContent.length < 20) throw new Error('Knowledge source does not contain enough text.');
    const cleanTitle = sanitizeTitle(title, sourceName || 'Untitled source');
    const now = Date.now();
    const id = makeDocumentId(cleanTitle, cleanContent);
    const existing = loadDocument(id);
    if (inventory.ids.has(id) && !existing) {
        throw new Error('A source with this ID could not be read. Its original file has been kept.');
    }
    const document = {
        id,
        version: 1,
        title: cleanTitle,
        sourceType,
        sourceName: sourceName ? sanitizeTitle(sourceName, null) : null,
        extension: extension || null,
        enabled: existing ? existing.enabled !== false : true,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        content: cleanContent,
        chunks: chunkText(cleanContent),
    };
    return saveDocument(document, inventory);
}

function stripHtml(value) {
    return String(value || '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}

function textFromFile(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
        throw new Error(`Unsupported knowledge file type: ${extension || 'unknown'}`);
    }
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) throw new Error('Knowledge source is not a file.');
    const sizeError = `File exceeds the ${MAX_FILE_BYTES / (1024 * 1024)} MiB knowledge limit.`;
    if (stats.size > MAX_FILE_BYTES) throw new Error(sizeError);

    const buffer = fs.readFileSync(filePath);
    if (buffer.length > MAX_FILE_BYTES) throw new Error(sizeError);
    if (buffer.includes(0)) throw new Error('Binary files are not supported by the local text index.');
    let text = buffer.toString('utf8');
    if (extension === '.json') {
        try { text = JSON.stringify(JSON.parse(text), null, 2); } catch {}
    }
    if (extension === '.html' || extension === '.htm') text = stripHtml(text);
    return { extension, text };
}

function importFiles(filePaths) {
    const inventory = readInventory();
    const paths = Array.isArray(filePaths) ? filePaths : [];
    const imported = [];
    const failed = [];
    for (const [index, filePath] of paths.entries()) {
        const name = typeof filePath === 'string' && filePath ? path.basename(filePath) : 'Unknown file';
        if (index >= MAX_IMPORT_FILES) {
            failed.push({ name, error: `Only ${MAX_IMPORT_FILES} files can be imported at a time. Select this file in another batch.` });
            continue;
        }
        try {
            if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid file path.');
            const { extension, text } = textFromFile(filePath);
            imported.push(createDocument({
                title: path.basename(filePath, extension),
                content: text,
                sourceType: 'file',
                sourceName: name,
                extension,
            }, inventory));
        } catch (error) {
            failed.push({ name, error: error.code ? 'Could not read this file. Check that it still exists and is readable.' : error.message });
        }
    }
    return { imported, failed };
}

function addText(title, content) {
    return createDocument({ title, content, sourceType: 'text' }, readInventory());
}

function loadDocument(id) {
    try {
        const data = JSON.parse(fs.readFileSync(documentPath(id), 'utf8'));
        if (data?.id !== id || typeof data.content !== 'string' || !Array.isArray(data.chunks)) return null;
        if (!data.chunks.every(chunk => typeof chunk?.text === 'string')) return null;
        return data;
    } catch {
        return null;
    }
}

function getKnowledgeLibrary() {
    const { stored, index, unreadableFiles } = readInventory();
    const status = {
        maxDocuments: MAX_DOCUMENTS,
        maxImportFiles: MAX_IMPORT_FILES,
        maxFileBytes: MAX_FILE_BYTES,
        maxTextChars: MAX_TEXT_CHARS,
        unreadableFiles,
        recoveredSources: 0,
        indexBackup: null,
        indexRepairPending: false,
    };
    if (JSON.stringify(stored.data) !== JSON.stringify(index)) {
        const indexedIds = new Set(stored.data?.documents.map(item => item.id));
        status.recoveredSources = index.documents.filter(item => !indexedIds.has(item.id)).length;
        try {
            status.indexBackup = saveIndex(index, stored);
        } catch {
            status.indexRepairPending = true;
        }
    }
    return { documents: index.documents, status };
}

function listDocuments() {
    return getKnowledgeLibrary().documents;
}

function loadDocuments(ids = null) {
    initializeKnowledgeStore();
    const allowed = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
    return documentIds(readStoredIndex().data)
        .filter(id => !allowed || allowed.has(id))
        .map(id => readDocumentEntry(id, true)?.document)
        .filter(Boolean);
}

function setDocumentEnabled(id, enabled) {
    const inventory = readInventory();
    const document = readDocumentEntry(String(id), true)?.document;
    if (!document) throw new Error('Knowledge source could not be read. Refresh the library to check its status.');
    return saveDocument({ ...document, enabled: enabled === true, updatedAt: Date.now() }, inventory);
}

function deleteDocument(id) {
    const file = documentPath(id);
    const inventory = readInventory();
    if (!inventory.ids.has(id)) return true;
    const documents = inventory.index.documents.filter(item => item.id !== id);
    applyIndexChange(inventory, documents, () => {
        try {
            fs.unlinkSync(file);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw new Error('Knowledge source could not be removed. Close any application using the file and retry.');
            }
        }
    });
    forgetDocument(id);
    return true;
}

function searchKnowledge(query, options = {}) {
    return retrieveChunks(loadDocuments(options.documentIds), query, options);
}

function getEnabledDocuments() {
    return loadDocuments().filter(document => document.enabled !== false);
}

function clearKnowledge() {
    fs.rmSync(getKnowledgeDir(), { recursive: true, force: true });
    clearDocumentEntries();
    initializeKnowledgeStore();
    return true;
}

function recordPracticeAttempt(attempt) {
    initializeKnowledgeStore();
    const data = safeReadJson(getPracticeHistoryPath(), { version: 1, attempts: [] });
    const attempts = Array.isArray(data.attempts) ? data.attempts : [];
    attempts.push({ ...attempt, timestamp: Number(attempt.timestamp) || Date.now() });
    safeWriteJson(getPracticeHistoryPath(), { version: 1, attempts: attempts.slice(-1000) });
}

function getPracticeHistory() {
    initializeKnowledgeStore();
    const data = safeReadJson(getPracticeHistoryPath(), { version: 1, attempts: [] });
    return Array.isArray(data.attempts) ? data.attempts.slice(-250).reverse() : [];
}

module.exports = {
    KNOWLEDGE_VERSION,
    MAX_FILE_BYTES,
    MAX_IMPORT_FILES,
    SUPPORTED_EXTENSIONS,
    initializeKnowledgeStore,
    getKnowledgeLibrary,
    listDocuments,
    loadDocument,
    loadDocuments,
    getEnabledDocuments,
    importFiles,
    addText,
    setDocumentEnabled,
    deleteDocument,
    searchKnowledge,
    clearKnowledge,
    recordPracticeAttempt,
    getPracticeHistory,
};
