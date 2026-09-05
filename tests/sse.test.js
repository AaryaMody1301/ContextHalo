const test = require('node:test');
const assert = require('node:assert/strict');
const { readSseJson } = require('../src/utils/sse');
async function collect(chunks) {
    const body = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
    const result = [];
    for await (const event of readSseJson(body)) result.push(event);
    return result;
}
test('SSE preserves split Unicode, CRLF, no-space data and an unterminated final event', async () => {
    const input = Buffer.from('data:{"value":"\u20ac"}\r\n\r\ndata: {"value":2}');
    const result = await collect([...input].map(byte => Uint8Array.of(byte)));
    assert.deepEqual(result, [{value:'\u20ac'}, {value:2}]);
});
test('SSE handles comments, DONE, and reports provider stream errors', async () => {
    assert.deepEqual(await collect([Buffer.from(':keepalive\n\ndata: [DONE]\n\n')]), []);
    await assert.rejects(collect([Buffer.from('data: {"error":{"message":"quota exhausted"}}\n\n')]), /quota exhausted/);
    await assert.rejects(collect([Buffer.from('data: invalid\n\n')]), SyntaxError);
});
