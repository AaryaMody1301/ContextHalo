const { execFileSync } = require('node:child_process');
const { readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

const files = [
    ...readdirSync('src', { recursive: true })
        .filter(file => file.endsWith('.js'))
        .map(file => join('src', file)),
    'preload.js',
];

for (const file of files) {
    if (!statSync(file).isFile()) {
        throw new Error(`Expected source file is missing: ${file}`);
    }
    execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);
