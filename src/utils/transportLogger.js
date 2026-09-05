const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('../storage');
let logStream = null;
let bytes = 0;
const ALLOWED = new Set(['sessionId', 'model', 'status', 'code', 'chunkLength', 'provider', 'durationMs']);
function startTransportLog(sessionId) {
    closeTransportLog();
    if (process.env.CONTEXTHALO_DIAGNOSTICS !== '1') return;
    if (!/^\d{1,30}$/.test(String(sessionId))) return;
    const directory = path.join(getConfigDir(), 'logs');
    fs.mkdirSync(directory, { recursive: true });
    const old = fs.readdirSync(directory).filter(name => /^\d+\.jsonl$/.test(name)).sort();
    for (const name of old.slice(0, Math.max(0, old.length - 9))) fs.unlinkSync(path.join(directory, name));
    bytes = 0;
    logStream = fs.createWriteStream(path.join(directory, `${sessionId}.jsonl`), { mode: 0o600 });
    logStream.on('error', () => { logStream = null; });
    logTransportEvent('session.started', { sessionId });
}
function logTransportEvent(type, data) {
    if (!logStream || bytes >= 1024 * 1024) return;
    const safe = Object.fromEntries(Object.entries(data || {}).filter(([key, value]) => ALLOWED.has(key)
        && ['string', 'number', 'boolean'].includes(typeof value)).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 160) : value]));
    const line = JSON.stringify({ timestamp: Date.now(), type: String(type).slice(0, 100), data: safe }) + '\n';
    bytes += Buffer.byteLength(line);
    logStream.write(line);
}
function closeTransportLog() {
    if (logStream) { logStream.end(); logStream = null; }
}
module.exports = { startTransportLog, logTransportEvent, closeTransportLog };
