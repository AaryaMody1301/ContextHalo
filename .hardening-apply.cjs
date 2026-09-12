const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
const entries = Array.from({ length: 7 }, (_, index) => JSON.parse(fs.readFileSync(`.hardening-part-${index + 1}.json`, 'utf8'))).flat();
const seen = new Set();
const pending = [];
for (const entry of entries) {
    const name = entry.path;
    if (typeof name !== 'string' || name.includes('..') || name.includes('\\') || path.isAbsolute(name)
        || !/^(?:src\/|tests\/|scripts\/|docs\/|AGENTS\.md$|README\.md$|package\.json$|preload\.js$)/.test(name)
        || seen.has(name)) throw new Error(`Unsafe or duplicate patch target: ${name}`);
    seen.add(name);
    const exists = fs.existsSync(name);
    const original = exists ? fs.readFileSync(name, 'utf8').replace(/\r\n/g, '\n') : null;
    if (entry.before === null ? exists : original === null || digest(original) !== entry.before) {
        throw new Error(`Source changed before patch: ${name}; actual ${original === null ? 'absent' : digest(original)}`);
    }
    if (entry.delete) { pending.push({ name, deleted: true }); continue; }
    let content;
    if (entry.before === null) content = entry.content;
    else {
        const lines = original.match(/[^\n]*\n|[^\n]+$/g) || [];
        let boundary = lines.length;
        for (const [start, end, replacement] of [...entry.edits].reverse()) {
            if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > boundary || typeof replacement !== 'string') {
                throw new Error(`Invalid or overlapping patch: ${name}`);
            }
            lines.splice(start, end - start, replacement);
            boundary = start;
        }
        content = lines.join('');
    }
    if (typeof content !== 'string' || digest(content) !== entry.after) throw new Error(`Patch hash mismatch: ${name}; actual ${digest(content || '')}`);
    pending.push({ name, content });
}
// Validate the entire change set before modifying any source file.
for (const file of pending) {
    if (file.deleted) fs.unlinkSync(file.name);
    else { fs.mkdirSync(path.dirname(file.name), { recursive: true }); fs.writeFileSync(file.name, file.content, 'utf8'); }
    console.log(`${file.deleted ? 'Removed' : 'Verified and applied'} ${file.name}`);
}
console.log(`Applied ${pending.length} hash-verified changes.`);
