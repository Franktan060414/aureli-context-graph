import test from 'node:test';
import assert from 'node:assert/strict';
import { exportEdges, exportFilename, exportPageSize, EXPORT_CARD_ASPECT_RATIO, fitExportCard } from '../src/lib/graph-export.js';
import { arrangeTiles, connectionGeometry } from '../src/lib/graph-layout.js';
import { arrangeLayeredTiles } from '../src/lib/layered-layout.js';

test('export restores missing source connections without dropping parallel edges or changing the snapshot', () => {
  const tiles = [{ id: 'a' }, { id: 'b', relatedTileIds: ['a', 'a', 'missing', 'b'] },
    { id: 'c', relatedTileIds: ['b'] }];
  const edges = [{ id: 'ab', sourceTileId: 'a', targetTileId: 'b' },
    { id: 'ab2', sourceTileId: 'a', targetTileId: 'b' }, { id: 'bad', sourceTileId: 'gone', targetTileId: 'a' }];
  const before = JSON.stringify({ tiles, edges });
  const result = exportEdges(tiles, edges);
  assert.deepEqual(result.map(edge => [edge.sourceTileId, edge.targetTileId]), [['a', 'b'], ['a', 'b'], ['b', 'c']]);
  assert.equal(JSON.stringify({ tiles, edges }), before);
});

test('one-page PDF dimensions preserve the graph aspect ratio within the PDF size limit', () => {
  for (const [width, height] of [[900, 600], [480, 90000], [90000, 1200]]) {
    const size = exportPageSize(width, height);
    assert.ok(Math.max(size.width, size.height) <= 14400);
    assert.ok(Math.abs(size.width / size.height - width / height) < 1e-8);
  }
  assert.throws(() => exportPageSize(NaN, 10));
  assert.equal(exportFilename('研究/问题:方案', 'pdf'), '研究_问题_方案.pdf');
});

test('content-sized cards retain the canvas aspect ratio and grow in both dimensions without enlarging text', () => {
  const measure = characters => width => 160 + Math.ceil(characters / Math.floor((width - 52) / 16)) * 27.2;
  const short = fitExportCard(measure(100)), medium = fitExportCard(measure(3000)), long = fitExportCard(measure(20000));
  for (const [size, characters] of [[short, 100], [medium, 3000], [long, 20000]]) {
    assert.equal(size.width / size.height, EXPORT_CARD_ASPECT_RATIO);
    assert.ok(measure(characters)(size.width) + 2 <= size.height, 'full content must fit at its original font size');
  }
  assert.equal(EXPORT_CARD_ASPECT_RATIO, 260 / 200);
  assert.ok(short.width < medium.width && medium.width < long.width);
  assert.ok(short.height < medium.height && medium.height < long.height);
  assert.ok(long.height < measure(20000)(480) / 2, 'wrapping into a wider card must reduce the long-column shape');
});

test('explicit line breaks still fit the preserved ratio, and measurement failures or cancellation do not produce a size', () => {
  const size = fitExportCard(() => 6000);
  assert.equal(size.width / size.height, EXPORT_CARD_ASPECT_RATIO);
  assert.ok(size.height >= 6002);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => fitExportCard(() => 100, { signal: controller.signal }), { name: 'AbortError' });
  assert.throws(() => fitExportCard(() => NaN), /无法测量/);
});

test('both export layouts use measured content dimensions, independent of weight, and keep shared descendants', async () => {
  const tiles = [{ id: 'root', width: 480, height: 320, weight: 3 },
    { id: 'long', width: 480, height: 9000, weight: 1, relatedTileIds: ['root'] },
    { id: 'short', width: 480, height: 220, weight: 3, relatedTileIds: ['root'] },
    { id: 'shared', width: 480, height: 600, weight: 2, relatedTileIds: ['long', 'short'] }];
  const before = JSON.stringify(tiles), dimensions = tile => ({ width: tile.width, height: tile.height });
  const edges = exportEdges(tiles);
  for (const positions of [arrangeTiles(tiles, edges, { dimensions }),
    (await arrangeLayeredTiles(tiles, edges, [], { dimensions })).positions]) {
    assert.deepEqual(positions.map(tile => [tile.width, tile.height]), tiles.map(tile => [tile.width, tile.height]));
    for (const a of positions) for (const b of positions) if (a.id !== b.id) assert.ok(
      a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    const [source, target] = positions;
    const numbers = connectionGeometry(source, target, { dimensions }).path.match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.equal(numbers[0], source.x + source.width);
    assert.equal(numbers.at(-2), target.x);
  }
  assert.equal(JSON.stringify(tiles), before);
});

test('export spacing increases gaps within and between label groups while preserving card sizes', async () => {
  const tiles = [{ id: 'a', labelId: 1, width: 480, height: 370 },
    { id: 'b', labelId: 1, width: 480, height: 370, relatedTileIds: ['a'] },
    { id: 'c', labelId: 2, width: 480, height: 370 },
    { id: 'd', labelId: 2, width: 480, height: 370 }];
  const edges = exportEdges(tiles), labels = [{ id: 1 }, { id: 2 }];
  const dimensions = tile => ({ width: tile.width, height: tile.height });
  for (const arrange of [options => arrangeTiles(tiles, edges, options),
    async options => (await arrangeLayeredTiles(tiles, edges, labels, options)).positions]) {
    const normal = await arrange({ dimensions }), spaced = await arrange({ dimensions, spacingScale: 2 });
    const gap = positions => positions[1].x - positions[0].x - positions[0].width;
    assert.ok(gap(spaced) >= gap(normal) * 2 - .01);
    assert.deepEqual(spaced.map(tile => [tile.width, tile.height]), normal.map(tile => [tile.width, tile.height]));
    const [c, d] = spaced.slice(2);
    assert.ok(Math.max(d.x - c.x - c.width, c.x - d.x - d.width,
      d.y - c.y - c.height, c.y - d.y - d.height) >= 128);
  }
});
