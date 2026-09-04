const crypto = require('node:crypto');
const { normalizeText, tokenize, topKeywords } = require('./knowledgeCore');

function informativeSentences(text) {
    const clean = normalizeText(text, 120_000);
    const sentences = clean
        .split(/(?<=[.!?])\s+|\n+/)
        .map(sentence => sentence.replace(/^[-*#>\d.\s]+/, '').trim())
        .filter(sentence => sentence.length >= 45 && sentence.length <= 360)
        .filter(sentence => tokenize(sentence).length >= 5);
    return [...new Set(sentences)];
}

function questionId(seed) {
    return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

function chooseBlank(sentence) {
    const keywords = topKeywords(sentence, 12)
        .map(item => item.token)
        .filter(token => token.length >= 5)
        .sort((a, b) => b.length - a.length);
    const blank = keywords[0];
    if (!blank) return null;
    const pattern = new RegExp(`\\b${blank.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (!pattern.test(sentence)) return null;
    return { blank, prompt: sentence.replace(pattern, '_____') };
}

function buildQuestion(source, sentence, index) {
    const expectedTokens = [...new Set(tokenize(sentence))].slice(0, 32);
    const cloze = index % 2 === 0 ? chooseBlank(sentence) : null;
    if (cloze) {
        return {
            id: questionId(`${source.id}:${sentence}:cloze`),
            type: 'cloze',
            prompt: `Fill in the blank:\n\n${cloze.prompt}`,
            sourceId: source.id,
            sourceTitle: source.title,
            expectedTokens: [...new Set([cloze.blank, ...expectedTokens])],
            reference: sentence,
        };
    }

    const topicWords = topKeywords(sentence, 4).map(item => item.token);
    const topic = topicWords.length ? topicWords.join(', ') : source.title;
    return {
        id: questionId(`${source.id}:${sentence}:recall`),
        type: 'recall',
        prompt: `Explain the key point about ${topic} in your own words.`,
        sourceId: source.id,
        sourceTitle: source.title,
        expectedTokens,
        reference: sentence,
    };
}

function generatePracticeQuestions(sources, count = 6) {
    const requested = Math.max(1, Math.min(20, Number(count) || 6));
    const pool = [];
    for (const source of Array.isArray(sources) ? sources : []) {
        if (!source || !source.id || !source.title) continue;
        const text = source.content || source.text || '';
        for (const sentence of informativeSentences(text).slice(0, 80)) {
            pool.push({ source, sentence });
        }
    }
    if (!pool.length) return [];

    const questions = [];
    const stride = Math.max(1, Math.floor(pool.length / requested));
    for (let cursor = 0; cursor < pool.length && questions.length < requested; cursor += stride) {
        const item = pool[cursor];
        questions.push(buildQuestion(item.source, item.sentence, questions.length));
    }
    return questions;
}

function gradeAnswer(question, answer) {
    const cleanAnswer = normalizeText(answer, 5000);
    const answerTokens = new Set(tokenize(cleanAnswer));
    const expected = [...new Set(Array.isArray(question?.expectedTokens) ? question.expectedTokens : [])].filter(Boolean);
    if (!cleanAnswer) {
        return { score: 0, level: 'retry', feedback: 'Add an answer before checking it.', matched: [], missing: expected.slice(0, 8) };
    }
    if (!expected.length) {
        return { score: 0.5, level: 'partial', feedback: 'Compare your answer with the reference.', matched: [], missing: [] };
    }

    const matched = expected.filter(token => answerTokens.has(token));
    const score = Math.max(0, Math.min(1, matched.length / Math.max(3, Math.min(expected.length, 12))));
    const level = score >= 0.72 ? 'strong' : score >= 0.38 ? 'partial' : 'retry';
    const feedback = level === 'strong'
        ? 'Strong recall. Your answer covers most of the important concepts.'
        : level === 'partial'
            ? 'Partially correct. Add the missing concepts and make the relationship between them explicit.'
            : 'Review the reference and try again using the important terms in your own explanation.';
    return {
        score: Number(score.toFixed(2)),
        level,
        feedback,
        matched: matched.slice(0, 12),
        missing: expected.filter(token => !answerTokens.has(token)).slice(0, 10),
    };
}

function flattenSessionText(session) {
    const sections = [];
    const transcript = Array.isArray(session?.liveTranscript) ? session.liveTranscript : [];
    for (const item of transcript) {
        if (item?.final === false || typeof item?.text !== 'string') continue;
        sections.push(item.text);
    }
    const history = Array.isArray(session?.conversationHistory) ? session.conversationHistory : [];
    for (const turn of history) {
        if (typeof turn?.transcription === 'string') sections.push(turn.transcription);
        if (typeof turn?.response === 'string') sections.push(turn.response);
        if (typeof turn?.content === 'string') sections.push(turn.content);
    }
    return normalizeText(sections.join('\n'), 160_000);
}

function buildSessionReview(session) {
    const markers = Array.isArray(session?.markers) ? session.markers : [];
    const text = flattenSessionText(session);
    const topics = topKeywords(text, 10).map(item => item.token);
    const byType = type => markers
        .filter(marker => marker?.type === type)
        .map(marker => normalizeText(marker.transcript || '', 1200))
        .filter(Boolean)
        .slice(-12);
    const createdAt = Number(session?.createdAt) || Number(session?.sessionId) || 0;
    const lastUpdated = Number(session?.lastUpdated) || createdAt;
    const durationMinutes = createdAt && lastUpdated >= createdAt ? Math.max(0, Math.round((lastUpdated - createdAt) / 60000)) : null;

    return {
        sessionId: String(session?.sessionId || ''),
        title: session?.sessionPack?.title || session?.profile || 'Session review',
        goal: session?.sessionPack?.goal || '',
        createdAt,
        lastUpdated,
        durationMinutes,
        topics,
        decisions: byType('decision'),
        actions: byType('action'),
        questions: byType('question'),
        important: byType('important'),
        messageCount: Array.isArray(session?.conversationHistory) ? session.conversationHistory.length : 0,
        transcriptItems: Array.isArray(session?.liveTranscript) ? session.liveTranscript.filter(item => item?.final !== false).length : 0,
        practiceReady: informativeSentences(text).length >= 2,
        text,
    };
}

function sessionAsPracticeSource(session) {
    const review = buildSessionReview(session);
    return {
        id: `session-${review.sessionId}`,
        title: review.title,
        content: review.text,
    };
}

module.exports = {
    informativeSentences,
    generatePracticeQuestions,
    gradeAnswer,
    flattenSessionText,
    buildSessionReview,
    sessionAsPracticeSource,
};
