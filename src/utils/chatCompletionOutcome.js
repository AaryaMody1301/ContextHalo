// Both Groq and llama.cpp use the OpenAI-compatible finish_reason contract.
// A nonempty delta is not proof that the answer completed successfully.
function assertChatCompletionOutcome(reason, provider) {
    if (!reason || reason === 'stop') return;
    const label = provider === 'groq' ? 'Groq' : 'Local AI';
    if (reason === 'length') {
        throw new Error(`${label} reached the output-token limit before completing the answer. Try a narrower question or smaller screen region. This incomplete answer was not saved.`);
    }
    if (reason === 'content_filter') {
        throw new Error(`${label} blocked the response under its content rules. Review the question and screen content. This answer was not saved.`);
    }
    throw new Error(`${label} stopped without a completed text answer. Review the question and try again. This answer was not saved.`);
}

module.exports = { assertChatCompletionOutcome };
