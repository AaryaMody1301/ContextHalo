'use strict';
// One-time, content-addressed transfer of the locally tested repair. Removed after applying.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const root = process.cwd();
const dir = path.join(root, '.github/repair-data');
const parts = fs.readdirSync(dir).filter(p => /^part\d+$/.test(p)).sort();
if (parts.length !== 7) throw new Error('Incomplete repair payload');
const zipped = Buffer.from(parts.map(p => fs.readFileSync(path.join(dir, p), 'utf8')).join(''), 'base64');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
if (hash(zipped) !== 'd9b1e9a8734d0e28646207c26e910e233e8c5d9d56b68cc94e2b7d563f49f542') throw new Error('Repair payload checksum mismatch');
const payload = JSON.parse(zlib.gunzipSync(zipped));
if (payload.base !== 'e0eb9b045def301cd71668f1c5b520807622703a') throw new Error('Unexpected repair base');
for (const f of payload.files) {
    if (!/^(src\/|tests\/|docs\/|scripts\/|preload\.js$|\.github\/workflows\/build-windows\.yml$)/.test(f.p) || f.p.includes('..') || path.isAbsolute(f.p)) throw new Error('Invalid repair path');
    const dest = path.join(root, f.p);
    if (f.p !== '.github/workflows/build-windows.yml') {
        const old = fs.existsSync(dest) ? hash(fs.readFileSync(dest)) : null;
        if (old !== f.h) throw new Error('Repair base content changed: ' + f.p);
    }
}
for (const f of payload.files) {
    // Workflow changes are committed separately by the connected GitHub app.
    // The Actions token deliberately cannot mutate workflow definitions.
    if (f.p === '.github/workflows/build-windows.yml') continue;
    const dest = path.join(root, f.p);
    if (f.c === null) fs.rmSync(dest, { force: true });
    else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, f.c, 'utf8'); }
}
fs.rmSync(dir, { recursive: true });
console.log('Applied verified repair files:', payload.files.length - 1);
