const crypto = require('node:crypto');
const { dialog } = require('electron');
const { confirmDeletion } = require('./dataDeletionMain');
const storage = require('../storage');
const {
    SUPPORTED_EXTENSIONS,
    initializeKnowledgeStore,
    getKnowledgeLibrary,
    loadDocument,
    loadDocuments,
    getEnabledDocuments,
    importFiles,
    addText,
    setDocumentEnabled,
    deleteDocument,
    searchKnowledge,
    recordPracticeAttempt,
    getPracticeHistory,
} = require('./knowledgeStore');
const {
    generatePracticeQuestions,
    gradeAnswer,
    buildSessionReview,
    sessionAsPracticeSource,
} = require('./practiceCore');
const { normalizeText } = require('./knowledgeCore');

const practiceSets = new Map();
const MAX_ACTIVE_PRACTICE_SETS = 20;

function sanitizeString(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function sanitizeId(value, maxLength = 100) {
    return sanitizeString(value, maxLength).replace(/[^a-zA-Z0-9_-]/g, '');
}

function publicQuestion(question) {
    return {
        id: question.id,
        type: question.type,
        prompt: question.prompt,
        sourceId: question.sourceId,
        sourceTitle: question.sourceTitle,
    };
}

function putPracticeSet(questions, sourceType, sourceId = null) {
    const setId = crypto.randomBytes(12).toString('hex');
    practiceSets.set(setId, {
        setId,
        createdAt: Date.now(),
        sourceType,
        sourceId,
        questions,
    });
    while (practiceSets.size > MAX_ACTIVE_PRACTICE_SETS) {
        const oldest = practiceSets.keys().next().value;
        practiceSets.delete(oldest);
    }
    return setId;
}

function createPracticeSet(options = {}) {
    const sourceType = options?.sourceType === 'session' ? 'session' : 'knowledge';
    const count = Math.max(1, Math.min(20, Number(options?.count) || 6));
    let sources = [];
    let sourceId = null;

    if (sourceType === 'session') {
        const sessionId = sanitizeString(options?.sessionId, 40);
        if (!/^\d+$/.test(sessionId)) throw new Error('Invalid session ID.');
        const session = storage.getSession(sessionId);
        if (!session) throw new Error('Session not found.');
        const source = sessionAsPracticeSource(session);
        if (!source.content) throw new Error('This session does not contain enough transcript or conversation text for practice.');
        sources = [source];
        sourceId = sessionId;
    } else {
        const documentIds = Array.isArray(options?.documentIds)
            ? options.documentIds.map(id => sanitizeId(id, 64)).filter(Boolean).slice(0, 30)
            : [];
        sources = documentIds.length ? loadDocuments(documentIds) : getEnabledDocuments();
        sources = sources.filter(document => document.enabled !== false);
        if (!sources.length) throw new Error('Enable or import a knowledge source first.');
    }

    const questions = generatePracticeQuestions(sources, count);
    if (!questions.length) throw new Error('The selected source does not contain enough explanatory text to create practice questions.');
    const setId = putPracticeSet(questions, sourceType, sourceId);
    return {
        setId,
        sourceType,
        sourceId,
        questions: questions.map(publicQuestion),
    };
}

function gradePractice(setId, questionId, answer) {
    const practiceSet = practiceSets.get(sanitizeId(setId, 64));
    if (!practiceSet) throw new Error('Practice set expired. Generate a new set.');
    const question = practiceSet.questions.find(item => item.id === sanitizeId(questionId, 64));
    if (!question) throw new Error('Practice question not found.');
    const cleanAnswer = normalizeText(answer, 5000);
    const result = gradeAnswer(question, cleanAnswer);
    recordPracticeAttempt({
        setId: practiceSet.setId,
        sourceType: practiceSet.sourceType,
        sourceId: practiceSet.sourceId,
        questionId: question.id,
        sourceTitle: question.sourceTitle,
        type: question.type,
        score: result.score,
        level: result.level,
        timestamp: Date.now(),
    });
    return {
        ...result,
        reference: question.reference,
        sourceTitle: question.sourceTitle,
    };
}

function setupPhase4Main(mainWindow, ipcMain, isErasing = () => false) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    initializeKnowledgeStore();

    let confirmingDelete = false;
    const isTrusted = event => Boolean(event?.sender && !mainWindow.isDestroyed() && event.sender.id === mainWindow.webContents.id && event.senderFrame === mainWindow.webContents.mainFrame);
    const installHandler = (channel, handler) => {
        try { ipcMain.removeHandler(channel); } catch {}
        ipcMain.handle(channel, async (event, ...args) => {
            if (!isTrusted(event)) return { success: false, error: 'Untrusted renderer' };
            if (isErasing()) return { success: false, error: 'Local data deletion is in progress.' };
            try { return await handler(...args); }
            catch (error) { return { success: false, error: error?.message || String(error) }; }
        });
    };

    installHandler('knowledge:list', () => {
        const { documents, status } = getKnowledgeLibrary();
        return { success: true, data: documents, status };
    });
    installHandler('knowledge:import', async () => {
        const extensions = [...SUPPORTED_EXTENSIONS].map(extension => extension.slice(1));
        const selection = await dialog.showOpenDialog(mainWindow, {
            title: 'Import local knowledge',
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: 'Text and code files', extensions },
                { name: 'All files', extensions: ['*'] },
            ],
        });
        if (selection.canceled || !selection.filePaths.length) return { success: true, cancelled: true, data: { imported: [], failed: [] } };
        if (isErasing()) return { success: true, cancelled: true };
        return { success: true, data: importFiles(selection.filePaths) };
    });
    installHandler('knowledge:add-text', (title, content) => {
        const cleanTitle = sanitizeString(title, 180) || 'Pasted knowledge';
        return { success: true, data: addText(cleanTitle, content) };
    });
    installHandler('knowledge:set-enabled', (id, enabled) => ({
        success: true,
        data: setDocumentEnabled(sanitizeId(id, 64), enabled === true),
    }));
    ipcMain.removeHandler?.('knowledge:delete');
    ipcMain.handle('knowledge:delete', async (event, id) => {
        if (!isTrusted(event)) return { success: false, error: 'Untrusted renderer' };
        if (isErasing() || confirmingDelete) return { success: true, cancelled: true };
        const cleanId = sanitizeId(id, 64);
        if (!cleanId || id !== cleanId) return { success: false, error: 'Invalid knowledge source.' };
        confirmingDelete = true;
        try {
            const target = loadDocument(cleanId);
            if (!target) return { success: false, error: 'Knowledge source not found. Refresh the library and retry.' };
            const accepted = await confirmDeletion(mainWindow, {
                action: 'Delete knowledge source',
                detail: `Remove “${sanitizeString(target.title, 180) || 'Untitled source'}” and its indexed excerpts from ContextHalo. Imported files in their original location are kept.`,
            });
            if (!accepted || !isTrusted(event) || isErasing()) return { success: true, cancelled: true };
            return { success: deleteDocument(cleanId) };
        } catch (error) {
            return { success: false, error: error?.message || 'Could not delete the knowledge source. Retry.' };
        } finally {
            confirmingDelete = false;
        }
    });
    installHandler('knowledge:search', (query, options = {}) => ({
        success: true,
        data: searchKnowledge(sanitizeString(query, 12_000), {
            limit: Math.max(1, Math.min(12, Number(options?.limit) || 5)),
            maxChars: Math.max(1000, Math.min(20_000, Number(options?.maxChars) || 7500)),
            documentIds: Array.isArray(options?.documentIds) ? options.documentIds.map(id => sanitizeId(id, 64)).filter(Boolean) : null,
        }),
    }));

    installHandler('practice:generate', options => ({ success: true, data: createPracticeSet(options) }));
    installHandler('practice:grade', (setId, questionId, answer) => ({
        success: true,
        data: gradePractice(setId, questionId, answer),
    }));
    installHandler('practice:history', () => ({ success: true, data: getPracticeHistory() }));

    installHandler('review:list', () => ({ success: true, data: storage.getAllSessions().slice(0, 100) }));
    installHandler('review:get', sessionId => {
        const cleanSessionId = sanitizeString(sessionId, 40);
        if (!/^\d+$/.test(cleanSessionId)) throw new Error('Invalid session ID.');
        const session = storage.getSession(cleanSessionId);
        if (!session) throw new Error('Session not found.');
        const review = buildSessionReview(session);
        delete review.text;
        return { success: true, data: review };
    });
}

module.exports = {
    setupPhase4Main,
    createPracticeSet,
    gradePractice,
};
