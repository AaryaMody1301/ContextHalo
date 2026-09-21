const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGroqMessages, getGroqReasoningOptions } = require('../src/utils/groqRequestPolicy');

test('Qwen text requests keep instructions in the latest user message', () => {
    const history = [
        { role: 'user', content: 'Earlier question' },
        { role: 'assistant', content: 'Earlier answer' },
        { role: 'user', content: 'Current question' },
    ];
    const messages = buildGroqMessages('qwen/qwen3.8-27b', 'Interview instructions', history, 6000);

    assert.equal(messages.some(message => message.role === 'system'), false);
    assert.equal(messages[0].content, 'Earlier question');
    assert.equal(messages[1].content, 'Earlier answer');
    assert.match(messages[2].content, /^Instructions for this request:\nInterview instructions\n\nRequest:\nCurrent question$/);
    assert.equal(history[2].content, 'Current question');
});

test('Qwen vision requests preserve image input and prepend instructions to text', () => {
    const image = { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } };
    const source = [{ role: 'user', content: [{ type: 'text', text: 'Analyze this screen' }, image] }];
    const messages = buildGroqMessages('qwen/qwen3.8-27b', 'Screen instructions', source, 6000);

    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'user');
    assert.match(messages[0].content[0].text, /^Instructions for this request:\nScreen instructions\n\nRequest:\nAnalyze this screen$/);
    assert.equal(messages[0].content[1], image);
    assert.equal(source[0].content[0].text, 'Analyze this screen');
});

test('GPT-OSS preserves the system-role hierarchy', () => {
    const history = [{ role: 'user', content: 'Question' }];
    const messages = buildGroqMessages('openai/gpt-oss-120b', 'Interview instructions', history, 6000);

    assert.deepEqual(messages, [
        { role: 'system', content: 'Interview instructions' },
        { role: 'user', content: 'Question' },
    ]);
});

test('provider instructions remain bounded before being inserted', () => {
    const messages = buildGroqMessages('qwen/qwen3.8-27b', 'abcdef', [{ role: 'user', content: 'Question' }], 3);
    assert.match(messages[0].content, /Instructions for this request:\nabc\n\nRequest:\nQuestion$/);
    assert.doesNotMatch(messages[0].content, /abcdef/);
});

test('Qwen 3.8 reasoning mode is explicit and never mixes reasoning output controls', () => {
    for (const disableThinking of [false, true]) {
        const options = getGroqReasoningOptions('qwen/qwen3.8-27b', disableThinking);
        assert.equal(options.reasoning_format, 'hidden');
        assert.equal(options.reasoning_effort, disableThinking ? 'none' : 'default');
        assert.equal(Object.hasOwn(options, 'include_reasoning'), false);
    }
});

test('GPT-OSS keeps its low-latency reasoning policy without unsupported reasoning_format', () => {
    const options = getGroqReasoningOptions('openai/gpt-oss-120b', false);
    assert.deepEqual(options, { include_reasoning: false, reasoning_effort: 'low' });
    assert.equal(Object.hasOwn(options, 'reasoning_format'), false);
});
