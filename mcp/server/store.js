import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { buildContext } from './context.js';

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 3) { this.db.close(); throw new Error('数据库来自更高版本，请更新 Aureli MCP。'); }
    try {
      if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='maps'").get()) this.migrateMaps();
      this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS conversations(conversation_id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS nodes(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
        title TEXT NOT NULL, content TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('NOTE','QA')),
        weight INTEGER NOT NULL DEFAULT 1 CHECK(weight BETWEEN 1 AND 3), x REAL NOT NULL, y REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(conversation_id,id));
      CREATE TABLE IF NOT EXISTS edges(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
        source TEXT NOT NULL, target TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('DIRECTED','UNDIRECTED')),
        FOREIGN KEY(conversation_id,source) REFERENCES nodes(conversation_id,id),
        FOREIGN KEY(conversation_id,target) REFERENCES nodes(conversation_id,id), CHECK(source<>target),
        UNIQUE(conversation_id,source,target));
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
        context_json TEXT NOT NULL, audit_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK(status IN ('PENDING','SAVED','CANCELLED')), node_id TEXT REFERENCES nodes(id),
        answer TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS edges_target ON edges(conversation_id,target);
      CREATE INDEX IF NOT EXISTS edges_source ON edges(conversation_id,source);
      `);
      if (version < 3) this.migrateFiles();
    } catch (error) { this.db.close(); throw error; }
  }
  migrateFiles() {
    // Rebuild the parent table without renaming it first: existing edge/task
    // foreign keys must continue to reference nodes, not a temporary table.
    this.db.exec('PRAGMA foreign_keys=OFF');
    try {
      this.transaction(() => {
        this.db.exec(`CREATE TABLE nodes_v3(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
          title TEXT NOT NULL, content TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('NOTE','QA','FILE')),
          weight INTEGER NOT NULL DEFAULT 1 CHECK(weight BETWEEN 1 AND 3), x REAL NOT NULL, y REAL NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(conversation_id,id));
          INSERT INTO nodes_v3 SELECT id,conversation_id,title,content,kind,weight,x,y,created_at FROM nodes;
          DROP TABLE nodes;
          ALTER TABLE nodes_v3 RENAME TO nodes;
          CREATE TABLE host_files(conversation_id TEXT NOT NULL, node_id TEXT NOT NULL, file_id TEXT NOT NULL,
            file_name TEXT NOT NULL, mime_type TEXT NOT NULL,
            PRIMARY KEY(conversation_id,node_id), UNIQUE(conversation_id,file_id),
            FOREIGN KEY(conversation_id,node_id) REFERENCES nodes(conversation_id,id));`);
        if (this.db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('附件迁移失败：关联数据不完整。');
        this.db.exec('PRAGMA user_version=3');
      });
    } finally { this.db.exec('PRAGMA foreign_keys=ON'); }
  }
  migrateMaps() {
    // Rename in-place so IDs, foreign keys, node bodies and pending tasks survive.
    this.transaction(() => {
      this.db.exec(`ALTER TABLE maps RENAME TO conversations;
        ALTER TABLE conversations RENAME COLUMN id TO conversation_id;
        ALTER TABLE conversations DROP COLUMN name;
        ALTER TABLE nodes RENAME COLUMN map_id TO conversation_id;
        ALTER TABLE edges RENAME COLUMN map_id TO conversation_id;
        ALTER TABLE tasks RENAME COLUMN map_id TO conversation_id;`);
      for (const task of this.db.prepare('SELECT id,conversation_id,context_json,audit_json FROM tasks').all()) {
        const packet = JSON.parse(task.context_json), audit = JSON.parse(task.audit_json);
        delete packet.mapId; packet.conversation_id = task.conversation_id;
        const contextText = JSON.stringify(packet);
        // Preserve old frozen payloads; the longer scope key may exceed the old budget.
        Object.assign(audit, { packet, contextText, chars: contextText.length,
          maxChars: Math.max(audit.maxChars ?? 0, contextText.length) });
        this.db.prepare('UPDATE tasks SET context_json=?,audit_json=? WHERE id=?')
          .run(contextText, JSON.stringify(audit), task.id);
      }
    });
  }
  ensureConversation(conversation_id) {
    if (typeof conversation_id !== 'string' || !conversation_id.trim() || conversation_id.length > 512)
      throw new Error('缺少有效 conversation_id，不能使用共享的默认对话。');
    this.db.prepare('INSERT OR IGNORE INTO conversations(conversation_id) VALUES (?)').run(conversation_id);
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  workspace(conversation_id) {
    this.ensureConversation(conversation_id);
    const files = new Map(this.db.prepare('SELECT node_id,file_id AS fileId,file_name AS fileName,mime_type AS mimeType FROM host_files WHERE conversation_id=?')
      .all(conversation_id).map(({ node_id, ...file }) => [node_id, file]));
    return { conversation_id, nodes: this.db.prepare('SELECT id,title,content,kind,weight,x,y FROM nodes WHERE conversation_id=? ORDER BY rowid').all(conversation_id)
      .map(node => files.has(node.id) ? { ...node, file: files.get(node.id) } : node),
      edges: this.db.prepare('SELECT id,source,target,direction FROM edges WHERE conversation_id=? ORDER BY rowid').all(conversation_id),
      tasks: this.db.prepare('SELECT id,status,node_id AS nodeId,created_at AS createdAt FROM tasks WHERE conversation_id=? ORDER BY rowid DESC LIMIT 20').all(conversation_id) };
  }
  requireNode(conversation_id, id) {
    const node = this.db.prepare('SELECT * FROM nodes WHERE conversation_id=? AND id=?').get(conversation_id, id);
    if (!node) throw new Error('节点不存在或不属于当前对话。');
    return node;
  }
  createNode({ conversation_id, title, content, x = 80, y = 80, weight = 1 }) {
    this.ensureConversation(conversation_id);
    const id = randomUUID();
    this.db.prepare('INSERT INTO nodes(id,conversation_id,title,content,kind,weight,x,y) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, conversation_id, title, content, 'NOTE', weight, x, y);
    return id;
  }
  addFiles({ conversation_id, files }) {
    return this.transaction(() => {
      this.ensureConversation(conversation_id);
      return files.map(({ fileId, fileName, mimeType = '' }, index) => {
        const existing = this.db.prepare('SELECT node_id FROM host_files WHERE conversation_id=? AND file_id=?').get(conversation_id, fileId);
        if (existing) return existing.node_id;
        const id = randomUUID();
        this.db.prepare('INSERT INTO nodes(id,conversation_id,title,content,kind,weight,x,y) VALUES (?,?,?,?,?,?,?,?)')
          .run(id, conversation_id, fileName.slice(0, 120), '原文件由宿主管理，尚未分析。选择为来源后，可在右侧提出问题或分析文件。', 'FILE', 1, 80 + index * 290, 80);
        this.db.prepare('INSERT INTO host_files(conversation_id,node_id,file_id,file_name,mime_type) VALUES (?,?,?,?,?)')
          .run(conversation_id, id, fileId, fileName, mimeType);
        return id;
      });
    });
  }
  updateNode({ conversation_id, id, title, content, weight }) {
    this.requireNode(conversation_id, id);
    this.db.prepare('UPDATE nodes SET title=?,content=?,weight=? WHERE conversation_id=? AND id=?').run(title, content, weight, conversation_id, id);
  }
  moveNodes({ conversation_id, positions }) {
    this.transaction(() => { for (const { id, x, y } of positions) {
      this.requireNode(conversation_id, id);
      this.db.prepare('UPDATE nodes SET x=?,y=? WHERE conversation_id=? AND id=?').run(x, y, conversation_id, id);
    } });
  }
  linkNodes({ conversation_id, source, target, direction }) {
    this.requireNode(conversation_id, source); this.requireNode(conversation_id, target);
    if (source === target) throw new Error('不能关联节点自身。');
    this.db.prepare(`INSERT INTO edges(id,conversation_id,source,target,direction) VALUES (?,?,?,?,?)
      ON CONFLICT(conversation_id,source,target) DO UPDATE SET direction=excluded.direction`).run(randomUUID(), conversation_id, source, target, direction);
  }
  unlink({ conversation_id, id }) {
    const removed = this.db.prepare('DELETE FROM edges WHERE conversation_id=? AND id=?').run(conversation_id, id);
    if (!removed.changes) throw new Error('关系不存在或不属于当前对话。');
  }
  preview({ conversation_id, ...options }) { return buildContext(this.workspace(conversation_id), options); }
  prepare(input) {
    return this.transaction(() => {
      const preview = this.preview(input), id = randomUUID();
      this.db.prepare('INSERT INTO tasks(id,conversation_id,context_json,audit_json) VALUES (?,?,?,?)')
        .run(id, input.conversation_id, preview.contextText, JSON.stringify(preview));
      return { id, status: 'PENDING', ...preview };
    });
  }
  task(conversation_id, id) {
    const task = this.db.prepare('SELECT * FROM tasks WHERE conversation_id=? AND id=?').get(conversation_id, id);
    if (!task) throw new Error('任务不存在或不属于当前对话。');
    return { id: task.id, conversation_id, status: task.status, nodeId: task.node_id,
      contextText: task.context_json, preview: JSON.parse(task.audit_json) };
  }
  cancel(conversation_id, id) {
    const task = this.task(conversation_id, id);
    if (task.status === 'SAVED') throw new Error('结果已保存，不能取消。');
    this.db.prepare("UPDATE tasks SET status='CANCELLED' WHERE conversation_id=? AND id=? AND status='PENDING'").run(conversation_id, id);
  }
  commit({ conversation_id, taskId, answer, title }) {
    return this.transaction(() => {
      const task = this.db.prepare('SELECT * FROM tasks WHERE conversation_id=? AND id=?').get(conversation_id, taskId);
      if (!task) throw new Error('任务不存在或不属于当前对话。');
      if (task.status === 'CANCELLED') throw new Error('任务已取消，不能写入。');
      if (task.status === 'SAVED') {
        if (task.answer !== answer) throw new Error('同一任务已经保存了不同内容，请创建新任务。');
        return { conversation_id, taskId, nodeId: task.node_id, saved: true, duplicate: true };
      }
      const packet = JSON.parse(task.context_json), id = randomUUID();
      const sources = packet.sourceIds.map(sourceId => this.requireNode(task.conversation_id, sourceId));
      const x = sources.length ? Math.max(...sources.map(node => node.x)) + 330 : 100;
      const y = sources.length ? sources.reduce((sum, node) => sum + node.y, 0) / sources.length + 60 : 100;
      this.db.prepare('INSERT INTO nodes(id,conversation_id,title,content,kind,weight,x,y) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, task.conversation_id, title ?? packet.question.slice(0, 100), `问题：${packet.question}\n\n${answer}`, 'QA', 1, x, y);
      // Keep a direct provenance link to every file actually included, even
      // when it entered through an ancestor rather than a direct selection.
      const provenance = new Set([...sources.map(source => source.id), ...packet.nodes.filter(node => node.file).map(node => node.id)]);
      for (const source of provenance) this.linkNodes({ conversation_id: task.conversation_id, source, target: id, direction: 'DIRECTED' });
      this.db.prepare("UPDATE tasks SET status='SAVED',node_id=?,answer=? WHERE id=?").run(id, answer, taskId);
      return { conversation_id, taskId, nodeId: id, saved: true, duplicate: false };
    });
  }
  seedDemo(conversation_id) {
    return this.transaction(() => {
      if (this.workspace(conversation_id).nodes.length) throw new Error('示例只能加载到空画布，现有节点会保留。');
      const add = (title, content, x, y, weight = 1) => this.createNode({ conversation_id, title, content, x, y, weight });
      const goal = add('项目约束', '这是本科生独立维护的项目。优先本地运行，不维护云服务器。先验证画布交互和可控上下文，不追求功能齐全。', 70, 220, 3);
      const mcp = add('方案 A · 宿主协作', '保留 Vue 画布与 SQLite。宿主负责生成、联网和读文件，Aureli 负责节点、关系和上下文筛选。', 400, 100, 2);
      const desktop = add('方案 B · 独立桌面', '保留独立聊天和模型配置。需要自己处理模型接口、桌面打包及运行环境。这个分支不应自动进入方案 A 的上下文。', 400, 360);
      const interaction = add('画布交互实验', '点击节点查看；选择多个直接来源；沿箭头反向追溯来源，观察另一条分支是否被排除。', 730, 100);
      add('独立资料 · 尚未关联', '独立节点只能显式选择后进入上下文。没有连线不代表它对问题不重要，但插件不会擅自读取。', 730, 410);
      this.linkNodes({ conversation_id, source: goal, target: mcp, direction: 'DIRECTED' });
      this.linkNodes({ conversation_id, source: goal, target: desktop, direction: 'DIRECTED' });
      this.linkNodes({ conversation_id, source: mcp, target: interaction, direction: 'DIRECTED' });
    });
  }
}
