import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { executeTool } from '../server/tools.js';

test('two conversations isolate snapshots, edits, links, contexts and tasks', () => {
  const store = new Store(':memory:');
  try {
    const a = store.createNode({ conversation_id: 'a', title: 'A private', content: 'A-only' });
    const b = store.createNode({ conversation_id: 'b', title: 'B private', content: 'B-only' });
    const a2 = store.createNode({ conversation_id: 'a', title: 'A child', content: 'A-child' });
    store.linkNodes({ conversation_id: 'a', source: a, target: a2, direction: 'DIRECTED' });
    assert.equal(store.workspace('a').nodes.length, 2);
    assert.deepEqual(store.workspace('b').nodes.map(n => n.id), [b]);
    assert.equal(store.workspace('b').edges.length, 0);
    assert.throws(() => store.updateNode({ conversation_id: 'b', id: a, title: 'bad', content: 'bad', weight: 1 }));
    assert.throws(() => store.moveNodes({ conversation_id: 'b', positions: [{ id: a, x: 999, y: 999 }] }));
    assert.throws(() => store.linkNodes({ conversation_id: 'a', source: a, target: b, direction: 'DIRECTED' }));
    const edge = store.workspace('a').edges[0];
    assert.throws(() => store.unlink({ conversation_id: 'b', id: edge.id }));
    assert.equal(store.workspace('a').edges.length, 1);
    assert.throws(() => store.preview({ conversation_id: 'b', sourceIds: [a] }));
    assert.throws(() => store.preview({ conversation_id: 'b', sourceIds: [b], excludedIds: [a] }));
    const task = store.prepare({ conversation_id: 'a', sourceIds: [a2], question: 'continue A' });
    assert.equal(task.packet.conversation_id, 'a');
    assert.equal(store.workspace('b').tasks.length, 0);
    assert.throws(() => store.task('b', task.id));
    assert.throws(() => store.cancel('b', task.id));
    assert.throws(() => store.commit({ conversation_id: 'b', taskId: task.id, answer: 'bad' }));
    assert.equal(store.task('a', task.id).status, 'PENDING');
    store.commit({ conversation_id: 'a', taskId: task.id, answer: 'A answer' });
    assert.throws(() => store.commit({ conversation_id: 'b', taskId: task.id, answer: 'A answer' }));
    assert.deepEqual(store.workspace('b').nodes.map(n => n.id), [b]);
  } finally { store.close(); }
});

test('host conversation metadata binds every operation and rejects a conflicting supplied ID', async () => {
  const store = new Store(':memory:');
  const host = id => ({ _meta: { 'openai/session': id } });
  try {
    const opened = await executeTool(store, 'aureli_open', {}, host('host-a'));
    assert.equal(opened._meta.workspace.conversation_id, 'host-a');
    await executeTool(store, 'aureli_demo', {}, host('host-a'));
    const other = await executeTool(store, 'aureli_open', {}, host('host-b'));
    assert.equal(other._meta.workspace.nodes.length, 0);
    const mismatch = await executeTool(store, 'aureli_open', { conversation_id: 'host-a' }, host('host-b'));
    assert.equal(mismatch.isError, true);
    const task = await executeTool(store, 'aureli_prepare', { sourceIds: [], question: 'a?' }, host('host-a'));
    for (const name of ['aureli_get_context', 'aureli_task_status', 'aureli_cancel', 'aureli_commit']) {
      const args = { taskId: task.structuredContent.taskId, ...(name === 'aureli_commit' ? { answer: 'bad' } : {}) };
      const result = await executeTool(store, name, args, host('host-b'));
      assert.equal(result.isError, true, `${name} must reject the other conversation's task`);
    }
    assert.equal(store.task('host-a', task.structuredContent.taskId).status, 'PENDING');
  } finally { store.close(); }
});

test('missing identity never creates or accesses a shared main conversation', async () => {
  const store = new Store(':memory:');
  try {
    assert.equal((await executeTool(store, 'aureli_open')).isError, true);
    assert.equal((await executeTool(store, 'aureli_open', { mapId: 'main' })).isError, true);
    assert.throws(() => store.workspace());
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n, 0);
    assert.equal((await executeTool(store, 'aureli_open', { conversation_id: 'explicit-chat' }))._meta.workspace.conversation_id, 'explicit-chat');
  } finally { store.close(); }
});

test('legacy SQLite migrates in place preserving IDs, edges, frozen tasks and foreign keys', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aureli-conversation-migration-'));
  const path = join(directory, 'legacy.sqlite');
  const old = new DatabaseSync(path);
  old.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE maps(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE nodes(id TEXT PRIMARY KEY,map_id TEXT NOT NULL REFERENCES maps(id),title TEXT NOT NULL,
      content TEXT NOT NULL,kind TEXT NOT NULL,weight INTEGER NOT NULL,x REAL NOT NULL,y REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(map_id,id));
    CREATE TABLE edges(id TEXT PRIMARY KEY,map_id TEXT NOT NULL REFERENCES maps(id),source TEXT NOT NULL,target TEXT NOT NULL,direction TEXT NOT NULL,
      FOREIGN KEY(map_id,source) REFERENCES nodes(map_id,id), FOREIGN KEY(map_id,target) REFERENCES nodes(map_id,id), UNIQUE(map_id,source,target));
    CREATE TABLE tasks(id TEXT PRIMARY KEY,map_id TEXT NOT NULL REFERENCES maps(id),context_json TEXT NOT NULL,audit_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',node_id TEXT REFERENCES nodes(id),answer TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX edges_target ON edges(map_id,target); CREATE INDEX edges_source ON edges(map_id,source);
    INSERT INTO maps VALUES('main','old map');
    INSERT INTO nodes(id,map_id,title,content,kind,weight,x,y) VALUES('root','main','root','原始资料','NOTE',2,-50,80),('leaf','main','leaf','分支资料','NOTE',1,300,80);
    INSERT INTO edges VALUES('edge','main','root','leaf','DIRECTED'); PRAGMA user_version=1;`);
  const packet = { version: 1, mapId: 'main', question: '旧任务', sourceIds: ['leaf'], nodes: [{ id: 'leaf', content: '冻结正文' }] };
  const audit = { packet, contextText: JSON.stringify(packet), chars: JSON.stringify(packet).length, maxChars: 1000, audit: [] };
  old.prepare('INSERT INTO tasks(id,map_id,context_json,audit_json) VALUES(?,?,?,?)').run('pending', 'main', JSON.stringify(packet), JSON.stringify(audit));
  old.close();
  let store;
  try {
    store = new Store(path);
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 2);
    assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE name='maps'").get(), undefined);
    for (const table of ['nodes','edges','tasks']) {
      const columns = store.db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
      assert.ok(columns.includes('conversation_id'));
      assert.ok(!columns.includes('map_id'));
    }
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(store.workspace('main').nodes[0].x, -50);
    assert.equal(store.workspace('main').edges[0].id, 'edge');
    const task = store.task('main', 'pending');
    assert.equal(JSON.parse(task.contextText).conversation_id, 'main');
    assert.ok(!('mapId' in JSON.parse(task.contextText)));
    assert.equal(task.preview.packet.nodes[0].content, '冻结正文');
    assert.equal(task.preview.contextText, task.contextText);
    assert.equal(store.workspace('new-host-chat').nodes.length, 0, 'old shared data must not be assigned to a new chat');
    store.commit({ conversation_id: 'main', taskId: 'pending', answer: '迁移后的回答' });
    store.close(); store = new Store(path);
    assert.equal(store.task('main', 'pending').status, 'SAVED');
    assert.equal(store.workspace('main').nodes.length, 3);
  } finally { store?.close(); rmSync(directory, { recursive: true, force: true }); }
});
