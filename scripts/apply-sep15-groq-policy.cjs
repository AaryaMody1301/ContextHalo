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
    "const { readSseJson } = require('./sse');\n",
    "const { readSseJson } = require('./sse');\nconst { buildGroqMessages } = require('./groqRequestPolicy');\n"
);

replaceOnce(
    'src/utils/gemini.js',
    "                messages: [{ role: 'system', content: (currentSystemPrompt || 'You are a helpful assistant.').slice(0, GROQ_MAX_SYSTEM_PROMPT_CHARS) }, ...requestHistory],",
    "                messages: buildGroqMessages(modelToUse, currentSystemPrompt, requestHistory, GROQ_MAX_SYSTEM_PROMPT_CHARS),"
);

replaceOnce(
    'src/utils/gemini.js',
    `                messages: [
                    { role: 'system', content: currentSystemPrompt || 'You are a helpful assistant.' },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: \`data:image/jpeg;base64,\${base64Data}\`,
                                },
                            },
                        ],
                    },
                ],`,
    `                messages: buildGroqMessages(model, currentSystemPrompt, [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: \`data:image/jpeg;base64,\${base64Data}\`,
                                },
                            },
                        ],
                    },
                ], GROQ_MAX_SYSTEM_PROMPT_CHARS),`
);

replaceOnce(
    'docs/API_COMPATIBILITY_AUDIT.md',
    '| Groq reasoning | Only documented model families get reasoning parameters. Qwen `none`/`hidden` and GPT-OSS `low`/`include_reasoning:false` remain separate; Qwen vision is labeled Preview | https://console.groq.com/docs/reasoning |',
    '| Groq reasoning | Only documented model families get reasoning parameters. Qwen `none`/`hidden` remains separate from GPT-OSS `low`/`include_reasoning:false`; Qwen instructions stay in the user message per current guidance while GPT-OSS keeps its documented role hierarchy; Qwen vision is labeled Preview | https://console.groq.com/docs/reasoning |'
);

fs.rmSync(__filename, { force: true });
console.log('Applied Sep 15 Groq prompt-role policy repair.');
