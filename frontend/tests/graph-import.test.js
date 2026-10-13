import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGraphImport } from '../src/lib/graph-import.js';
import { sampleGraph } from './fixtures/sample-workspace.js';

test('imports current exports and legacy snapshots without restoring runtime state', () => {
  const graph = sampleGraph();
  graph.labels = [{ id: 1, name: '研究', colorHex: '#AABBCC' }];
  graph.tiles[0].labelId = 1;
  graph.layout = { 'tile-001': { x: -42, y: 123 } };
  const source = JSON.stringify({ mode: 'demo', generating: true, loading: true, ui: { selected: 'missing' }, ...graph });
  const parsed = parseGraphImport('\uFEFF' + source);
  assert.equal(parsed.tiles[0].answer, graph.tiles[0].answer);
  assert.deepEqual(parsed.tiles[1].relatedTileIds, ['tile-001']);
  assert.deepEqual(parsed.layout, graph.layout);
  assert.equal(parsed.tiles[0].labelId, 1);
  assert.equal(parsed.tiles[0].tileType, 'QA');
  assert.equal(parsed.tiles[0].status, 'ready');
  assert.equal('generating' in parsed, false);
  assert.equal('ui' in parsed, false);
  assert.equal(source.includes('"tileType"'), false, 'input must not be mutated');
  assert.deepEqual(parseGraphImport('{"tiles":[],"edges":[]}'), { tiles: [], edges: [], labels: [], layout: {} });
});

test('restores notes and file metadata from exported text', () => {
  const parsed = parseGraphImport(JSON.stringify({ tiles: [
    { id: 'note', tileType: 'NOTE', message: '便签', answer: '正文', weight: 2 },
    { id: 'file', tileType: 'FILE', message: '文档.pdf', content: '文件文字', fileSize: 100 },
  ], edges: [] }));
  assert.equal(parsed.tiles[0].title, '便签');
  assert.equal(parsed.tiles[0].content, '正文');
  assert.equal(parsed.tiles[1].fileName, '文档.pdf');
  assert.equal(parsed.tiles[1].content, '文件文字');
});

test('rejects syntax, field types, duplicate IDs, dangling references and invalid coordinates', () => {
  for (const source of ['', '{', 'null', '[]', '{}', '{"tiles":{},"edges":[]}', '{"tiles":[],"edges":null}'])
    assert.throws(() => parseGraphImport(source), /JSON 格式错误/);
  const base = { tiles: [{ id: 'a', message: '问题', answer: '回答' }], edges: [] };
  const cases = [
    { ...base, tiles: [...base.tiles, ...base.tiles] },
    { ...base, tiles: [{ ...base.tiles[0], message: 123 }] },
    { ...base, tiles: [{ ...base.tiles[0], weight: '2' }] },
    { ...base, tiles: [{ ...base.tiles[0], tileType: 'OTHER' }] },
    { ...base, tiles: [{ ...base.tiles[0], labelId: 99 }] },
    { ...base, tiles: [{ ...base.tiles[0], relatedTileIds: ['missing'] }] },
    { ...base, tiles: [{ ...base.tiles[0], relatedTileIds: ['a'] }] },
    { ...base, edges: [{ id: 'x', sourceTileId: 'a', targetTileId: 'missing' }] },
    { ...base, layout: { a: { x: '0', y: 0 } } },
    { ...base, layout: { missing: { x: 0, y: 0 } } },
    { ...base, labels: [{ id: 1, name: '标签', colorHex: 'red' }] },
  ];
  for (const data of cases) assert.throws(() => parseGraphImport(JSON.stringify(data)), /JSON 格式错误/);
});


test('old exports default nullable dimensions; custom dimensions survive JSON round trips', () => {
  for (const fields of [{}, { width: null, height: null }, { width: 440, height: 320 }, { width: null, height: 320 }]) {
    const data = { tiles: [{ id: 'a', message: '问题', weight: 3, ...fields }], edges: [] };
    const parsed = parseGraphImport(JSON.stringify(data));
    assert.equal(parsed.tiles[0].width, fields.width ?? null);
    assert.equal(parsed.tiles[0].height, fields.height ?? null);
    assert.deepEqual(parseGraphImport(JSON.stringify(parsed)), parsed);
  }
  for (const fields of [{ width: '400' }, { width: 0 }, { width: 400.5 }, { width: 4001 }, { height: -1 }, { height: 159 }])
    assert.throws(() => parseGraphImport(JSON.stringify({ tiles: [{ id: 'a', message: '问题', ...fields }], edges: [] })), /JSON 格式错误/);
});
