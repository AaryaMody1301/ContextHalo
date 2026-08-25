const { execFileSync } = require('node:child_process');
const { readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

function collectJavaScriptFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const filePath = join(directory, entry.name);
        if (entry.isDirectory()) {
            return collectJavaScriptFiles(filePath);
        }
        return entry.isFile() && entry.name.endsWith('.js') ? [filePath] : [];
    });
}

const files = [...collectJavaScriptFiles('src'), 'preload.js'];

for (const file of files) {
    if (!statSync(file).isFile()) {
        throw new Error(`Expected source file is missing: ${file}`);
    }
    execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);
