import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.js';
import { executeTool, definitions } from '../server/tools.js';
const conversation_id = 'chat-a';
const callTool = (store, name, args = {}) => executeTool(store, name, { conversation_id, ...args });

test('prepared context is frozen, commit uses stored sources and is idempotent', () => {
  const store = new Store(':memory:');
  try {
    const a = store.createNode({ conversation_id,  title: '来源', content: 'original', x: 0, y: 0 });
    const task = store.prepare({ conversation_id,  sourceIds: [a], question: '问题', maxChars: 2000 });
    store.updateNode({ conversation_id,  id: a, title: '修改后的来源', content: 'changed', weight: 2 });
    assert.equal(store.task(conversation_id, task.id).contextText, task.contextText);
    assert.ok(store.task(conversation_id, task.id).contextText.includes('original'));
    const result = store.commit({ conversation_id,  taskId: task.id, answer: '完整结果' });
    assert.equal(store.commit({ conversation_id,  taskId: task.id, answer: '完整结果' }).duplicate, true);
    assert.throws(() => store.commit({ conversation_id,  taskId: task.id, answer: '另一个结果' }));
    assert.equal(store.workspace(conversation_id).nodes.length, 2);
    assert.deepEqual(store.workspace(conversation_id).edges.map(e => [e.source,e.target]), [[a,result.nodeId]]);
    assert.equal(store.task(conversation_id, task.id).status, 'SAVED');
  } finally { store.close(); }
});
test('cancelled tasks cannot be committed, and writes are atomic', () => {
  const store = new Store(':memory:');
  try {
    const task = store.prepare({ conversation_id,  sourceIds: [], question: '独立问题' });
    store.cancel(conversation_id, task.id);
    assert.throws(() => store.commit({ conversation_id,  taskId: task.id, answer: '不应保存' }));
    assert.equal(store.workspace(conversation_id).nodes.length, 0);
    const a = store.createNode({ conversation_id,  title:'a',content:'a' });
    assert.throws(() => store.moveNodes({ conversation_id,  positions: [{ id:a,x:999,y:999 }, { id:'missing',x:1,y:1 }] }));
    assert.equal(store.workspace(conversation_id).nodes[0].x, 80);
  } finally { store.close(); }
});
test('SQLite survives reopening with tasks and node coordinates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aureli-store-')), file = join(dir,'aureli.sqlite');
  let store = new Store(file);
  try {
    const id = store.createNode({ conversation_id, title:'持久化',content:'内容',x:-200,y:300});
    const task = store.prepare({ conversation_id, sourceIds:[id],question:'继续'});
    store.close(); store = new Store(file);
    assert.equal(store.workspace(conversation_id).nodes[0].x,-200);
    assert.deepEqual(JSON.parse(store.task(conversation_id, task.id).contextText).sourceIds,[id]);
  } finally { store.close(); rmSync(dir,{recursive:true,force:true}); }
});
test('workspace and preview bodies are UI-only; only a prepared packet reaches model content', async () => {
  const store = new Store(':memory:');
  try {
    const a = store.createNode({ conversation_id, title:'允许',content:'allowed-body'});
    store.createNode({ conversation_id, title:'隐藏',content:'UNSELECTED-SECRET-MARKER'});
    const opened = await callTool(store,'aureli_open');
    assert.ok(!JSON.stringify(opened.content).includes('UNSELECTED-SECRET-MARKER'));
    assert.ok(!opened.structuredContent);
    assert.ok(JSON.stringify(opened._meta).includes('UNSELECTED-SECRET-MARKER'));
    const preview = await callTool(store,'aureli_preview',{sourceIds:[a]});
    assert.ok(!JSON.stringify(preview.content).includes('allowed-body'));
    const prepared = await callTool(store,'aureli_prepare',{sourceIds:[a],question:'分析'});
    const read = await callTool(store,'aureli_get_context',{taskId:prepared.structuredContent.taskId});
    assert.ok(JSON.stringify(read.structuredContent).includes('allowed-body'));
    assert.ok(!JSON.stringify(read.structuredContent).includes('UNSELECTED-SECRET-MARKER'));
    assert.deepEqual(definitions(store).aureli_workspace.visibility,['app']);
    const invalid = await callTool(store,'aureli_prepare',{sourceIds:[a],question:'分析',answer:'smuggled'});
    assert.equal(invalid.isError,true);
  } finally { store.close(); }
});
