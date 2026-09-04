const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const storage = require('../storage');
const { chunkText, normalizeText, retrieveChunks } = require('./knowledgeCore');

const KNOWLEDGE_VERSION = 1;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_FILES = 20;
const MAX_TEXT_CHARS = 1_500_000;
const SUPPORTED_EXTENSIONS = new Set([
    '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log', '.html', '.htm',
    '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cc', '.cpp', '.h', '.hpp',
    '.sql', '.yaml', '.yml', '.toml', '.ini', '.properties', '.xml', '.css', '.scss', '.sh', '.ps1',
]);

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
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function initializeKnowledgeStore() {
    fs.mkdirSync(getDocumentsDir(), { recursive: true });
    fs.mkdirSync(getPracticeDir(), { recursive: true });
    if (!fs.existsSync(getIndexPath())) {
        safeWriteJson(getIndexPath(), { version: KNOWLEDGE_VERSION, documents: [] });
    }
    if (!fs.existsSync(getPracticeHistoryPath())) {
        safeWriteJson(getPracticeHistoryPath(), { version: 1, attempts: [] });
    }
}

function sanitizeTitle(value, fallback = 'Untitled source') {
    const title = typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 180) : '';
    return title || fallback;
}

function getIndex() {
    initializeKnowledgeStore();
    const data = safeReadJson(getIndexPath(), { version: KNOWLEDGE_VERSION, documents: [] });
    return {
        version: KNOWLEDGE_VERSION,
        documents: Array.isArray(data.documents) ? data.documents.filter(Boolean) : [],
    };
}

function saveIndex(index) {
    const normalized = {
        version: KNOWLEDGE_VERSION,
        documents: Array.isArray(index?.documents) ? index.documents.slice(0, 500) : [],
    };
    safeWriteJson(getIndexPath(), normalized);
    return normalized;
}

function documentPath(id) {
    const safeId = String(id || '').replace(/[^a-f0-9]/gi, '').slice(0, 64);
    if (!safeId) throw new Error('Invalid knowledge document ID');
    return path.join(getDocumentsDir(), `${safeId}.json`);
}

function makeDocumentId(title, text) {
    return crypto.createHash('sha256').update(`${title}\u0000${text}`).digest('hex').slice(0, 24);
}

function metadataFromDocument(document) {
    return {
        id: document.id,
        title: document.title,
        sourceType: document.sourceType,
        sourceName: document.sourceName || null,
        extension: document.extension || null,
        enabled: document.enabled !== false,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        chars: document.content.length,
        chunks: document.chunks.length,
    };
}

function saveDocument(document) {
    initializeKnowledgeStore();
    safeWriteJson(documentPath(document.id), document);
    const index = getIndex();
    const metadata = metadataFromDocument(document);
    const existingIndex = index.documents.findIndex(item => item.id === document.id);
    if (existingIndex >= 0) index.documents[existingIndex] = metadata;
    else index.documents.unshift(metadata);
    saveIndex(index);
    return metadata;
}

function createDocument({ title, content, sourceType = 'text', sourceName = null, extension = null }) {
    const cleanContent = normalizeText(content, MAX_TEXT_CHARS);
    if (cleanContent.length < 20) throw new Error('Knowledge source does not contain enough text.');
    const cleanTitle = sanitizeTitle(title, sourceName || 'Untitled source');
    const now = Date.now();
    const id = makeDocumentId(cleanTitle, cleanContent);
    const existing = loadDocument(id);
    const document = {
        id,
        version: 1,
        title: cleanTitle,
        sourceType,
        sourceName: sourceName ? sanitizeTitle(sourceName, null) : null,
        extension: extension || null,
        enabled: existing ? existing.enabled !== false : true,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        content: cleanContent,
        chunks: chunkText(cleanContent),
    };
    return saveDocument(document);
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
    if (stats.size > MAX_FILE_BYTES) throw new Error(`File exceeds the ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)} MB knowledge limit.`);

    const buffer = fs.readFileSync(filePath);
    if (buffer.includes(0)) throw new Error('Binary files are not supported by the local text index.');
    let text = buffer.toString('utf8');
    if (extension === '.json') {
        try { text = JSON.stringify(JSON.parse(text), null, 2); } catch {}
    }
    if (extension === '.html' || extension === '.htm') text = stripHtml(text);
    return { extension, text: normalizeText(text, MAX_TEXT_CHARS) };
}

function importFiles(filePaths) {
    initializeKnowledgeStore();
    const paths = Array.isArray(filePaths) ? filePaths.slice(0, MAX_IMPORT_FILES) : [];
    const imported = [];
    const failed = [];
    for (const filePath of paths) {
        try {
            if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid file path.');
            const { extension, text } = textFromFile(filePath);
            const sourceName = path.basename(filePath);
            const metadata = createDocument({
                title: path.basename(filePath, extension),
                content: text,
                sourceType: 'file',
                sourceName,
                extension,
            });
            imported.push(metadata);
        } catch (error) {
            failed.push({ name: path.basename(String(filePath || 'file')), error: error.message });
        }
    }
    return { imported, failed };
}

function addText(title, content) {
    return createDocument({ title, content, sourceType: 'text' });
}

function loadDocument(id) {
    try {
        const data = safeReadJson(documentPath(id), null);
        if (!data || data.id !== id || typeof data.content !== 'string' || !Array.isArray(data.chunks)) return null;
        return data;
    } catch {
        return null;
    }
}

function listDocuments() {
    return getIndex().documents;
}

function loadDocuments(ids = null) {
    const allowed = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
    return listDocuments()
        .filter(item => !allowed || allowed.has(String(item.id)))
        .map(item => loadDocument(item.id))
        .filter(Boolean);
}

function setDocumentEnabled(id, enabled) {
    const document = loadDocument(String(id));
    if (!document) throw new Error('Knowledge source not found.');
    document.enabled = enabled === true;
    document.updatedAt = Date.now();
    return saveDocument(document);
}

function deleteDocument(id) {
    const safeId = String(id || '');
    const index = getIndex();
    const exists = index.documents.some(item => item.id === safeId);
    if (!exists) return false;
    try { fs.unlinkSync(documentPath(safeId)); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    index.documents = index.documents.filter(item => item.id !== safeId);
    saveIndex(index);
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
