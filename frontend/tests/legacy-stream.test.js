import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../../src/main/resources/static/app.js', import.meta.url), 'utf8');
const scope = vm.createContext({ TextDecoder, Error });
vm.runInContext(source.slice(source.indexOf('function parseSseChunk'), source.indexOf('async function postJson')) + source.slice(source.indexOf('async function readStream'), source.indexOf('async function postStream')), scope);
function response(text) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }));
}
test('legacy page reads fragmented UTF-8 and hides completion metadata', async () => {
  assert.equal(await scope.readStream(response('data: {"v":"知识图谱"}\r\n\r\ndata: {"v":null,"done":true,"error":null}\r\n\r\n'), () => {}), '知识图谱');
});
test('legacy page rejects partial answers and persistence failures', async () => {
  await assert.rejects(scope.readStream(response('data: {"v":"部分回答"}\n\n'), () => {}), /尚未确认保存/);
  await assert.rejects(scope.readStream(response('data: {"v":"部分回答"}\n\ndata: {"error":"保存失败"}\n\n'), () => {}), /保存失败/);
});
