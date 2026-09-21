const { execFileSync } = require('node:child_process');
const { readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

const sourceFiles = directory => readdirSync(directory, { recursive: true })
    .filter(file => file.endsWith('.js'))
    .map(file => join(directory, file));

const files = [
    ...sourceFiles('src'),
    ...sourceFiles('tests'),
    ...sourceFiles('scripts'),
    'preload.js',
];

for (const file of files) {
    if (!statSync(file).isFile()) {
        throw new Error(`Expected source file is missing: ${file}`);
    }
    execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);
