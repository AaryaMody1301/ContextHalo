'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const cp = require('node:child_process');
const root = process.cwd();
if (process.env.GITHUB_REPOSITORY !== 'AaryaMody1301/ContextHalo' || process.env.GITHUB_REF !== 'refs/heads/fix/windows-workspace-search-recovery') throw new Error('Repair branch guard failed');
cp.execFileSync('git', ['merge-base', '--is-ancestor', '828e997ade1c05b898c20e422a69bc68b8758334', 'HEAD']);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const packed = Buffer.concat(Array.from({ length: 8 }, (_, i) => fs.readFileSync(`.repair-transfer/part-${i}.br`)));
if (sha(packed) !== '8a986c8aca5cd051e040759942300bdb56e5f556e4d963991d6b90d007e9bdea') throw new Error('Transfer checksum mismatch');
const entries = JSON.parse(zlib.brotliDecompressSync(packed));
const changes = entries.map(([name, beforeHash, afterHash, operations]) => {
    if (!/^(src\/|tests\/|scripts\/|docs\/|preload\.js$)/.test(name) || name.includes('..') || name.includes('\\')) throw new Error('Unsafe repair path');
    const target = path.join(root, name);
    const raw = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    const before = raw === null ? null : raw.replace(/\r\n/g, '\n');
    if ((before === null ? null : sha(before)) !== beforeHash) throw new Error(`Baseline changed: ${name}`);
    let after = null;
    if (afterHash !== null) {
        if (before === null) after = operations;
        else {
            const lines = before.match(/[^\n]*\n|[^\n]+$/g) || [];
            for (const [start, end, text] of [...operations].reverse()) lines.splice(start, end - start, text);
            after = lines.join('');
        }
        if (sha(after) !== afterHash) throw new Error(`Repair checksum mismatch: ${name}`);
    }
    return { name, target, raw, after };
});
for (const { name, target, raw, after } of changes) {
    if (after === null) fs.unlinkSync(target);
    else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, raw && raw.includes('\r\n') ? after.replace(/\n/g, '\r\n') : after);
    }
    console.log(`${after === null ? 'Removed' : 'Applied'} ${name}`);
}
console.log(`Verified and applied ${changes.length} source/test changes.`);
