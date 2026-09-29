// @google/genai 2.22.0 drops an error object inside a data: SSE event when
// converting it to GenerateContentResponse. Detect it before that conversion,
// preserving successful SSE frames and keeping retries in runGeminiRequest.
const MAX_FRAME_CHARS = 2 * 1024 * 1024;

function inspectFrame(frame, headers) {
    const data = frame.split(/\r\n|\r|\n/).filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /, '')).join('\n');
    let payload;
    try { payload = JSON.parse(data || frame); } catch { return; }
    if (!payload?.error || typeof payload.error !== 'object') return;
    const status = Number(payload.error.code);
    throw Object.assign(new Error(JSON.stringify({ error: payload.error })), {
        ...(Number.isInteger(status) && status >= 400 && status <= 599 ? { status } : {}),
        headers: { 'retry-after': headers.get('retry-after') },
    });
}

function guardGeminiStream(response) {
    if (!response.body || !/text\/event-stream/i.test(response.headers.get('content-type') || '')) return response;
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let pending = '';
    const drain = controller => {
        let boundary;
        while ((boundary = /\r\n\r\n|\n\n|\r\r/.exec(pending))) {
            const end = boundary.index + boundary[0].length;
            const frame = pending.slice(0, end);
            pending = pending.slice(end);
            if (frame.length > MAX_FRAME_CHARS) throw new Error('Gemini stream frame exceeded the supported size');
            inspectFrame(frame, response.headers);
            controller.enqueue(encoder.encode(frame));
        }
        if (pending.length > MAX_FRAME_CHARS) throw new Error('Gemini stream frame exceeded the supported size');
    };
    const body = response.body.pipeThrough(new TransformStream({
        transform(bytes, controller) {
            pending += decoder.decode(bytes, { stream: true });
            drain(controller);
        },
        flush(controller) {
            pending += decoder.decode();
            drain(controller);
            if (pending) {
                inspectFrame(pending, response.headers);
                // Preserve an incomplete frame so the SDK reports its parse
                // error instead of silently converting a cut-off stream to EOF.
                controller.enqueue(encoder.encode(pending));
            }
        },
    }));
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

module.exports = { guardGeminiStream };
