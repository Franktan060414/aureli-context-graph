import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContext } from '../server/context.js';

const node = (id, content = `body:${id}`, weight = 1) => ({ id, title: id, content, weight, kind: 'NOTE' });
const edge = (source, target, direction = 'DIRECTED') => ({ source, target, direction });
const graph = { conversation_id: 'chat-a', nodes: ['root','a','b','leaf','alone'].map(id => node(id)),
  edges: [edge('root','a'),edge('root','b'),edge('a','leaf')] };
const ids = result => result.packet.nodes.map(node => node.id).sort();

test('directed recall includes ancestors, never siblings or descendants', () => {
  const result = buildContext(graph, { sourceIds: ['a'], scope: 'ancestors' });
  assert.deepEqual(ids(result), ['a','root']);
  assert.ok(!result.contextText.includes('body:b'));
  assert.ok(!result.contextText.includes('body:leaf'));
  assert.equal(result.audit.find(node => node.id === 'root').distance, 1);
});
test('selected scope and empty selection do not implicitly read history', () => {
  assert.deepEqual(ids(buildContext(graph, { sourceIds: ['leaf'], scope: 'selected' })), ['leaf']);
  assert.deepEqual(ids(buildContext(graph, { sourceIds: [] })), []);
});
test('excluding a node blocks traversal through that node', () => {
  const result = buildContext(graph, { sourceIds: ['leaf'], excludedIds: ['a'] });
  assert.deepEqual(ids(result), ['leaf']);
  assert.equal(result.audit.find(node => node.id === 'a').state, 'excluded');
});
test('bidirectional cycles deduplicate and keep shortest readable distance', () => {
  const cycle = { ...graph, edges: [...graph.edges, edge('a','b','UNDIRECTED'), edge('leaf','root')] };
  const result = buildContext(cycle, { sourceIds: ['a','a'] });
  assert.equal(new Set(ids(result)).size, result.packet.nodes.length);
  assert.equal(result.audit.find(node => node.id === 'b').distance, 1);
  assert.ok(!ids(result).includes('alone'));
});
test('exact JSON budget preserves every direct source with labeled excerpts', () => {
  const long = { ...graph, nodes: graph.nodes.map(n => ({ ...n, content: '中文🙂"\n'.repeat(2000) })) };
  const result = buildContext(long, { sourceIds: ['a','b'], maxChars: 1000 });
  assert.ok(result.contextText.length <= 1000);
  for (const id of ['a','b']) {
    const item = result.packet.nodes.find(n => n.id === id);
    assert.ok(item && item.content.length > 0 && item.truncated);
    assert.ok(!/[\uD800-\uDBFF]$/.test(item.content));
  }
  assert.deepEqual(JSON.parse(result.contextText), result.packet);
});
test('missing roots and roots simultaneously excluded fail explicitly', () => {
  assert.throws(() => buildContext(graph, { sourceIds: ['missing'] }));
  assert.throws(() => buildContext(graph, { sourceIds: ['a'], excludedIds: ['a'] }));
});
