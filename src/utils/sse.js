// Shared SSE reader for Groq and llama.cpp. Handles split UTF-8, CRLF, data
// without a space, multiline events, and the final event without a newline.
async function* readSseJson(body, signal) {
    if (!body) throw new Error('Provider returned no response body');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let data = [];
    const parse = () => {
        const value = data.join('\n');
        data = [];
        if (!value || value === '[DONE]') return null;
        const event = JSON.parse(value);
        if (event.error) throw new Error(event.error.message || 'Provider stream failed');
        return event;
    };
    const line = value => {
        if (value === '') return parse();
        if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
        return null;
    };
    const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
        while (true) {
            signal?.throwIfAborted();
            const { value, done } = await reader.read();
            pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
            if (pending.length > 2 * 1024 * 1024) throw new Error('Provider SSE event is too large');
            let index;
            while ((index = pending.indexOf('\n')) >= 0) {
                const event = line(pending.slice(0, index).replace(/\r$/, ''));
                pending = pending.slice(index + 1);
                if (event) yield event;
            }
            if (done) {
                if (pending) { const event = line(pending.replace(/\r$/, '')); if (event) yield event; }
                const event = parse();
                if (event) yield event;
                break;
            }
        }
        signal?.throwIfAborted();
    } finally {
        signal?.removeEventListener('abort', cancel);
        try { await reader.cancel(); } catch {}
        reader.releaseLock();
    }
}
module.exports = { readSseJson };
