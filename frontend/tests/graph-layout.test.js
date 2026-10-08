import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangeTiles, ARRANGE_HORIZONTAL_GAP, ARRANGE_VERTICAL_GAP, connectionGeometry, positionTiles } from '../src/lib/graph-layout.js';

test('connections use facing boundaries when a Tile crosses horizontal or vertical sides', () => {
  const source = { x: 400, y: 400 };
  const cases = [
    [{ x: 800, y: 400 }, [660, 500], [800, 500]],
    [{ x: 0, y: 400 }, [400, 500], [260, 500]],
    [{ x: 400, y: 800 }, [530, 600], [530, 800]],
    [{ x: 400, y: 0 }, [530, 400], [530, 200]],
  ];
  for (const [target, start, end] of cases) {
    const geometry = connectionGeometry(source, target);
    const numbers = geometry.path.match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.deepEqual(numbers.slice(0, 2), start);
    assert.deepEqual(numbers.slice(-2), end);
    assert.equal(geometry.x, (start[0] + end[0]) / 2);
    assert.equal(geometry.y, (start[1] + end[1]) / 2 - 9);
  }
});

test('nearby and overlapping Tiles keep finite curve and label coordinates', () => {
  for (const target of [{ x: 400, y: 400 }, { x: 405, y: 405 }, { x: 480, y: 420 }]) {
    const geometry = connectionGeometry({ x: 400, y: 400 }, target);
    assert.ok(Number.isFinite(geometry.x) && Number.isFinite(geometry.y));
    assert.ok(!/NaN|Infinity/.test(geometry.path));
  }
});

test('ordinary Tiles retain their original layout and manually saved coordinates', () => {
  const tiles = [
    { id: 'root', relatedTileIds: [], weight: 1 },
    { id: 'child-a', relatedTileIds: ['root'], weight: 1 },
    { id: 'child-b', relatedTileIds: ['root'], weight: 1 },
  ];
  const points = positionTiles(tiles);
  assert.deepEqual(points.map(({ x, y, width, height }) => ({ x, y, width, height })), [
    { x: 24, y: 140, width: 260, height: 200 },
    { x: 340, y: 24, width: 260, height: 200 },
    { x: 340, y: 256, width: 260, height: 200 },
  ]);
  const moved = positionTiles(tiles, { 'child-a': { x: 780, y: 920 } });
  assert.equal(moved[1].x, 780);
  assert.equal(moved[1].y, 920);
});

test('mixed weights reserve enough space in rows and columns without moving saved Tiles', () => {
  const tiles = [
    { id: 'ordinary', relatedTileIds: [], weight: 1 },
    { id: 'important', relatedTileIds: [], weight: 2 },
    { id: 'highest', relatedTileIds: [], weight: 3 },
    { id: 'child', relatedTileIds: ['highest'], weight: 2 },
  ];
  const points = positionTiles(tiles);
  assert.deepEqual(points.map(({ width, height }) => [width, height]), [[260, 200], [390, 300], [650, 500], [390, 300]]);
  assert.equal(points[1].y - points[0].y - points[0].height, 32);
  assert.equal(points[2].y - points[1].y - points[1].height, 32);
  assert.equal(points[3].x - points[2].x - points[2].width, 56);
  const moved = positionTiles(tiles, { highest: { x: 1200, y: 600 } });
  assert.equal(moved[2].x, 1200);
  assert.equal(moved[2].y, 600);
  assert.equal(moved[2].width, 650);
});

test('connections meet the actual boundaries of different-sized Tiles in all directions', () => {
  const source = { x: 800, y: 800, weight: 3 };
  const cases = [
    [{ x: 1800, y: 950, weight: 1 }, [1450, 1050], [1800, 1050]],
    [{ x: 0, y: 950, weight: 1 }, [800, 1050], [260, 1050]],
    [{ x: 930, y: 1800, weight: 2 }, [1125, 1300], [1125, 1800]],
    [{ x: 930, y: 0, weight: 2 }, [1125, 800], [1125, 300]],
  ];
  for (const [target, start, end] of cases) {
    const numbers = connectionGeometry(source, target).path.match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.deepEqual(numbers.slice(0, 2), start);
    assert.deepEqual(numbers.slice(-2), end);
  }
});

test('arranging centers parents over complete branches and groups siblings', () => {
  const tiles = [
    { id: 'root', relatedTileIds: [] },
    { id: 'a', relatedTileIds: ['root'] },
    { id: 'b', relatedTileIds: ['root'] },
    { id: 'a1', relatedTileIds: ['a'] },
    { id: 'a2', relatedTileIds: ['a'] },
    { id: 'b1', relatedTileIds: ['b'] },
  ];
  const points = arrangeTiles(tiles);
  assert.deepEqual(points.map(({ x, y }) => [x, y]), [
    [24, 288], [380, 156], [380, 552], [736, 24], [736, 288], [736, 552],
  ]);
  assert.deepEqual(tiles.map(tile => Object.keys(tile)), tiles.map(() => ['id', 'relatedTileIds']));
  assert.deepEqual(arrangeTiles(points), points, 'repeated arrangement is stable');
});

test('arranging computes dependency depth from unsorted Tiles and edge-only relationships', () => {
  const tiles = [{ id: 'leaf' }, { id: 'child' }, { id: 'root' }];
  const edges = [
    { sourceTileId: 'root', targetTileId: 'child' },
    { sourceTileId: 'child', targetTileId: 'leaf' },
    { sourceTileId: 'missing', targetTileId: 'root' },
  ];
  const points = arrangeTiles(tiles, edges);
  assert.deepEqual(points.map(({ id, x, y }) => [id, x, y]), [
    ['leaf', 736, 24], ['child', 380, 24], ['root', 24, 24],
  ]);
});

test('arranging reserves minimum gaps for mixed weights and disconnected trees', () => {
  const tiles = [
    { id: 'root', relatedTileIds: [], weight: 3 },
    { id: 'child', relatedTileIds: ['root'], weight: 2 },
    { id: 'leaf', relatedTileIds: ['child'] },
    { id: 'other', relatedTileIds: [] },
    { id: 'other-child', relatedTileIds: ['other'], weight: 3 },
    { id: 'isolated', relatedTileIds: [] },
  ];
  const points = arrangeTiles(tiles);
  assert.equal(points[1].x - points[0].x - points[0].width, ARRANGE_HORIZONTAL_GAP);
  assert.equal(points[2].x - points[4].x - points[4].width, ARRANGE_HORIZONTAL_GAP);
  for (const a of points) {
    for (const b of points) {
      if (a.id === b.id) continue;
      if (a.x === b.x && a.y < b.y) {
        assert.ok(b.y - a.y - a.height >= ARRANGE_VERTICAL_GAP);
      }
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x
        || a.y + a.height <= b.y || b.y + b.height <= a.y);
    }
  }
});

test('shared descendants appear once and follow every parent without duplicate connections changing depth', () => {
  const tiles = [
    { id: 'root', relatedTileIds: [] },
    { id: 'a', relatedTileIds: ['root'] },
    { id: 'b', relatedTileIds: ['a'] },
    { id: 'shared', relatedTileIds: ['root', 'a', 'b', 'b', 'missing'] },
  ];
  const points = arrangeTiles(tiles, [{ sourceTileId: 'b', targetTileId: 'shared' }]);
  assert.equal(new Set(points.map(tile => tile.id)).size, 4);
  assert.equal(points[3].x - points[2].x - points[2].width, ARRANGE_HORIZONTAL_GAP);
  assert.equal(points[3].y, points[2].y);
  assert.deepEqual(points[3].relatedTileIds, tiles[3].relatedTileIds);
});

test('empty, isolated, self-linked and cyclic graphs always produce finite nonoverlapping positions', () => {
  assert.deepEqual(arrangeTiles([]), []);
  for (const tiles of [
    [{ id: 'only', relatedTileIds: ['only'] }],
    [{ id: 'a', relatedTileIds: ['b'] }, { id: 'b', relatedTileIds: ['a'] },
      { id: 'child', relatedTileIds: ['a', 'b'] }, { id: 'isolated' }],
  ]) {
    const points = arrangeTiles(tiles);
    assert.equal(points.length, tiles.length);
    for (const point of points) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    for (const a of points) for (const b of points) {
      if (a.id !== b.id) assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x
        || a.y + a.height <= b.y || b.y + b.height <= a.y);
    }
  }
});
