import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { readSse } from '../src/lib/api.js';
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:5173';
const prefix = `studio-check-${Date.now()}`;
const ids = [`${prefix}-root`, `${prefix}-memory`, `${prefix}-rag`];
const created = { prefix, tileIds: ids, fileId: null, fileIds: [] };
const cleanupFile = '/tmp/aureli-studio-integration.json';
await writeFile(cleanupFile, JSON.stringify(created));
async function json(path, data) {
  const response = await fetch(base + '/customer-service' + path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const value = await response.json();
  assert.equal(value.success, true, value.message || path);
  return value;
}
async function completion(tileId, message, relatedTileIds = []) {
  const response = await fetch(base + '/customer-service/chat/tile/completion', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ tileId, message, relatedTileIds, memoryDepth: 3, edgeDirection: 'DIRECTED', relationType: 'EXTENDS', edgeWeight: 1 }), signal: AbortSignal.timeout(180000),
  });
  let answer = '', chunks = 0;
  await readSse(response, value => { answer = value; chunks++; }, { requireDone: true });
  assert.ok(answer.length, 'must receive real model answer');
  console.log(JSON.stringify({ stage: tileId.split('-').at(-1), chunks, answer }));
  return answer;
}
const settings = (await json('/model-settings')).data;
await json('/model-settings', { chat: { ...settings.chat, apiKey: '' }, embedding: { ...settings.embedding, apiKey: '' }, dimensions: settings.dimensions });
console.log('PASS: live configuration read/save (keys redacted), proxy connected');
await completion(ids[0], '本次联调的项目代号是苍蓝2048。请记住，只回复这个项目代号。');
const remembered = await completion(ids[1], '上一个相关 Tile 里的项目代号是什么？仅回复代号。', [ids[0]]);
assert.match(remembered, /苍蓝\s*2048/);
const upload = new FormData();
upload.append('file', new Blob([`# Aureli Studio 联调观察站\n\n## 联调观察站的通行暗号是什么？\n\nAureli Studio 联调观察站的通行暗号是“银翼松果731”。此资料仅用于本次接口联调 ${prefix}。\n`], { type: 'text/markdown' }), `${prefix}.md`);
const uploaded = await (await fetch(base + '/customer-service/md/upload', { method: 'POST', body: upload })).json();
assert.equal(uploaded.success, true);
for (let attempt = 0; attempt < 45; attempt++) {
  const listed = await json('/md/list', { current: 1, size: 100 });
  const file = listed.data.find(file => file.originalFileName === `${prefix}.md`);
  if (file) { created.fileId = file.id; if (!created.fileIds.includes(file.id)) created.fileIds.push(file.id); await writeFile(cleanupFile, JSON.stringify(created)); }
  if (file?.status === 3) throw new Error('Live document vectorization failed');
  if (file?.status === 2) break;
  if (attempt === 44) throw new Error('Live document vectorization timeout');
  await new Promise(resolve => setTimeout(resolve, 1000));
}
await json('/md/update', { id: created.fileId, remark: 'Aureli Studio live integration: verified' });
console.log('PASS: live upload/vectorization/remark update');
// Equal content in separate files must keep separate vector ownership.
const originalId = created.fileId;
const copy = new FormData();
copy.append('file', upload.get('file'), `${prefix}-copy.md`);
assert.equal((await (await fetch(base + '/customer-service/md/upload', { method: 'POST', body: copy })).json()).success, true);
let duplicate;
for (let attempt = 0; attempt < 45; attempt++) {
  duplicate = (await json('/md/list', { current: 1, size: 100 })).data.find(file => file.originalFileName === `${prefix}-copy.md`);
  if (duplicate) { created.fileId = duplicate.id; if (!created.fileIds.includes(duplicate.id)) created.fileIds.push(duplicate.id); await writeFile(cleanupFile, JSON.stringify(created)); }
  if (duplicate?.status === 3) throw new Error('Duplicate document vectorization failed');
  if (duplicate?.status === 2) break;
  if (attempt === 44) throw new Error('Duplicate document vectorization timed out');
  await new Promise(resolve => setTimeout(resolve, 1000));
}
await json('/md/delete', { id: originalId });
assert.ok((await json('/md/list', { current: 1, size: 100 })).data.some(file => file.id === duplicate.id));
console.log('PASS: identical document deletion keeps the other file for RAG');

const rag = await completion(ids[2], 'Aureli Studio 联调观察站的通行暗号是什么？请按资料回答，只回复暗号。');
assert.match(rag, /银翼松果\s*731/);
const snapshot = (await json('/tile/workspace')).data;
for (const id of ids) assert.ok(snapshot.tiles.find(tile => tile.id === id)?.answer);
assert.ok(snapshot.edges.some(edge => edge.sourceTileId === ids[0] && edge.targetTileId === ids[1]));
console.log('PASS: persisted full answers, memory relation, live RAG retrieval');
await json('/md/delete', { id: created.fileId });
assert.ok(!(await json('/md/list', { current: 1, size: 100 })).data.some(file => file.id === created.fileId));
created.fileId = null; await writeFile(cleanupFile, JSON.stringify(created));
console.log('PASS: temporary document removed');
