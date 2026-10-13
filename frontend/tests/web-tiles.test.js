import test from 'node:test';
import assert from 'node:assert/strict';
import { webSourceUrl } from '../src/lib/web-tiles.js';
import { parseGraphImport } from '../src/lib/graph-import.js';
import { createApiClient } from '../src/lib/api.js';

test('web snapshots survive import while interrupted fetch state is cleared', () => {
  const tile = { id: 'web-one', tileType: 'WEB', message: '网页', title: '网页', content: '# 完整正文', sourceUrl: 'https://example.com/article',
    resolvedUrl: 'https://example.com/final', fetchedAt: '2026-10-13T10:00:00', fetchStatus: 'FETCHING', fetchError: 'old error' };
  const result = parseGraphImport(JSON.stringify({ tiles: [tile], edges: [] })).tiles[0];
  assert.equal(result.sourceUrl, tile.sourceUrl); assert.equal(result.content, tile.content);
  assert.equal(result.fetchedAt, tile.fetchedAt); assert.equal(result.fetchStatus, 'READY'); assert.equal(result.fetchError, null);
  for (const sourceUrl of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:secret@example.com'])
    assert.throws(() => parseGraphImport(JSON.stringify({ tiles: [{ ...tile, sourceUrl }], edges: [] })));
  assert.throws(() => parseGraphImport(JSON.stringify({ tiles: [{ ...tile, fetchedAt: 'yesterday' }], edges: [] })));
});
test('reader links accept only HTTP(S) and never credentials', () => {
  assert.equal(webSourceUrl('javascript:alert(1)'), '');
  assert.equal(webSourceUrl('https://user:secret@example.com'), '');
  assert.equal(webSourceUrl('https://example.com/a'), 'https://example.com/a');
});
test('web create and refresh capture map ownership', async () => {
  const original = globalThis.fetch, writes = [];
  globalThis.fetch = async (url, options) => { writes.push({ url, body: JSON.parse(options.body) }); return new Response(JSON.stringify({ success: true, data: {} })); };
  try {
    const api = createApiClient('http://localhost:8080', () => 'map-one');
    await api.createWebTile({ url: 'https://example.com', relatedTileIds: ['qa-one'] });
    await api.refreshWebTile('web-one');
    assert.deepEqual(writes.map(write => write.body.mapId), ['map-one', 'map-one']);
    assert.equal(writes[0].body.url, 'https://example.com');
    assert.ok(writes[1].url.endsWith('/tile/web-one/web/refresh'));
  } finally { globalThis.fetch = original; }
});
