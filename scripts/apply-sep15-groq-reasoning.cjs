'use strict';

const fs = require('node:fs');

function replaceOnce(filePath, before, after) {
    const source = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
    const first = source.indexOf(before);
    const second = first < 0 ? -1 : source.indexOf(before, first + before.length);
    if (first < 0 || second >= 0) throw new Error(`Expected exactly one match in ${filePath}`);
    fs.writeFileSync(filePath, source.slice(0, first) + after + source.slice(first + before.length), 'utf8');
}

replaceOnce(
    'src/utils/gemini.js',
    "const { buildGroqMessages } = require('./groqRequestPolicy');",
    "const { buildGroqMessages, getGroqReasoningOptions } = require('./groqRequestPolicy');"
);

replaceOnce(
    'src/utils/gemini.js',
    `function getGroqReasoningOptions(model, disableThinking) {
    if (/^qwen\\/qwen3\\.(?:6|8)-27b$/.test(model)) {
        const options = {
            reasoning_format: 'hidden',
        };

        if (disableThinking) {
            options.reasoning_effort = 'none';
        }

        return options;
    }

    if (/^openai\\/gpt-oss-(?:20b|120b)$/.test(model)) {
        return {
            include_reasoning: false, reasoning_effort: 'low',
        };
    }

    return {};
}

`,
    ''
);

fs.rmSync(__filename, { force: true });
console.log('Applied Sep 15 explicit Groq reasoning repair.');
