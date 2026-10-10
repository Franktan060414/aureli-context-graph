import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangeLayeredTiles, layoutSignature } from '../src/lib/layered-layout.js';
import { labelRegions } from '../src/lib/label-regions.js';
import { polylineGeometry, routeIsCurrent, rerouteConnection } from '../src/lib/graph-routing.js';

const labels = [{ id: 1, name: '研究', colorHex: '#E8F2FF' }, { id: 2, name: '方案', colorHex: '#DCFCE7' }];
const tile = (id, labelId = 1, extra = {}) => ({ id, labelId, relatedTileIds: [], weight: 1, ...extra });
const edge = (id, sourceTileId, targetTileId) => ({ id, sourceTileId, targetTileId });
function nonoverlapping(tiles) {
  for (const a of tiles) for (const b of tiles) if (a.id !== b.id) assert.ok(
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y,
    `${a.id} overlaps ${b.id}`);
}

test('ELK groups labels, preserves card sizes, and routes nested and cross-label edges in world coordinates', async () => {
  const tiles = [tile('a'), tile('b', '1', { relatedTileIds: ['a'], weight: 3 }),
    tile('c', 2, { weight: 2 }), tile('d', 2, { relatedTileIds: ['c'] }), tile('unlabelled', null)];
  const edges = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('cd', 'c', 'd'), edge('uc', 'unlabelled', 'c')];
  const before = JSON.stringify({ tiles, edges, labels });
  const { positions, routes } = await arrangeLayeredTiles(tiles, edges, labels);
  assert.equal(JSON.stringify({ tiles, edges, labels }), before);
  assert.deepEqual(positions.map(t => [t.id, t.width, t.height]), [
    ['a', 260, 200], ['b', 650, 500], ['c', 390, 300], ['d', 260, 200], ['unlabelled', 260, 200],
  ]);
  nonoverlapping(positions);
  for (const e of edges) {
    const source = positions.find(t => t.id === e.sourceTileId), target = positions.find(t => t.id === e.targetTileId);
    const route = routes[e.id];
    assert.ok(routeIsCurrent(route, source, target, positions), `valid route: ${e.id}`);
    const onBoundary = (p, tile) => (Math.abs(p.x - tile.x) < .01 || Math.abs(p.x - tile.x - tile.width) < .01)
      && p.y >= tile.y - .01 && p.y <= tile.y + tile.height + .01
      || (Math.abs(p.y - tile.y) < .01 || Math.abs(p.y - tile.y - tile.height) < .01)
      && p.x >= tile.x - .01 && p.x <= tile.x + tile.width + .01;
    assert.ok(onBoundary(route.sections[0][0], source));
    assert.ok(onBoundary(route.sections.at(-1).at(-1), target));
    assert.ok(!/NaN|Infinity/.test(polylineGeometry(route.sections).path));
  }
  assert.equal(labelRegions(positions, labels).length, 2);
  const repeated = await arrangeLayeredTiles([...tiles].reverse(), edges, labels);
  assert.deepEqual(Object.fromEntries(repeated.positions.map(t => [t.id, [t.x, t.y]])),
    Object.fromEntries(positions.map(t => [t.id, [t.x, t.y]])));
});

test('ELK handles no labels, cycles, missing sources, parallel edges and empty maps', async () => {
  assert.deepEqual(await arrangeLayeredTiles([]), { positions: [], routes: {} });
  const tiles = [tile('a', null, { relatedTileIds: ['b', 'missing'] }), tile('b', null, { relatedTileIds: ['a'] }), tile('isolated', 99)];
  const edges = [edge('ab', 'a', 'b'), edge('parallel', 'a', 'b'), edge('missing', 'x', 'a')];
  const result = await arrangeLayeredTiles(tiles, edges);
  assert.equal(result.positions.length, 3); nonoverlapping(result.positions);
  assert.ok(result.routes.ab && result.routes.parallel);
  assert.equal(result.routes.missing, undefined);
  for (const p of result.positions) assert.ok(Number.isFinite(p.x) && p.x >= 12 && p.y >= 12);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(arrangeLayeredTiles(tiles, edges, [], { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(layoutSignature(tiles, edges, labels), layoutSignature([...tiles].reverse(), [...edges].reverse(), [...labels].reverse()));
});

test('label regions follow free positions, split, disappear for singletons and rejoin without changing labels', () => {
  const start = [tile('a', 1, { x: 60, y: 80 }), tile('b', '1', { x: 416, y: 80 }),
    tile('c', 1, { x: 60, y: 344 }), tile('d', 1, { x: 416, y: 344 }), tile('other', 2, { x: 1800, y: 80 })];
  const first = labelRegions(start, labels);
  assert.equal(first.length, 1); assert.equal(first[0].tileIds.length, 4);
  const moved = start.map(t => t.id === 'd' ? { ...t, x: 2200, y: 1500 } : t);
  const main = labelRegions(moved, labels, first);
  assert.equal(main.length, 1); assert.equal(main[0].tileIds.length, 3); assert.equal(main[0].total, 4);
  assert.ok(main[0].width < 1000);
  const split = start.map(t => ['c', 'd'].includes(t.id) ? { ...t, x: t.x + 2000 } : t);
  assert.deepEqual(labelRegions(split, labels, first).map(r => r.tileIds.length), [2, 2]);
  const scattered = start.map((t, i) => ({ ...t, x: i * 1500, y: 80 }));
  assert.equal(labelRegions(scattered, labels, first).length, 0);
  assert.equal(labelRegions(start, labels, main).length, 1);
  assert.deepEqual(moved.map(t => t.labelId), start.map(t => t.labelId));
  assert.equal(labelRegions(start, []).length, 0);
});

test('interleaved labels and cross-group feedback preserve every directed connection', async () => {
  const tiles = [tile('a1'), tile('b1', 2), tile('a2'), tile('b2', 2)];
  const edges = [edge('ab', 'a1', 'b1'), edge('ba', 'b1', 'a2'), edge('ab2', 'a2', 'b2'), edge('feedback', 'b2', 'a1')];
  const result = await arrangeLayeredTiles(tiles, edges, labels);
  nonoverlapping(result.positions);
  assert.deepEqual(Object.keys(result.routes).sort(), edges.map(e => e.id).sort());
  for (const e of edges) {
    assert.equal(result.routes[e.id].sourceId, e.sourceTileId);
    assert.equal(result.routes[e.id].targetId, e.targetTileId);
  }
});

test('region hysteresis prevents flicker and captions do not cover cards near the top boundary', () => {
  const pair = gap => [tile('a', 1, { x: 24, y: 24 }), tile('b', 1, { x: 284 + gap, y: 24 })];
  const initial = labelRegions(pair(150), labels);
  assert.equal(initial.length, 1); assert.equal(initial[0].captionBelow, true);
  const near = labelRegions(pair(200), labels, initial);
  assert.equal(near.length, 1);
  const detached = labelRegions(pair(230), labels, near);
  assert.equal(detached.length, 0);
  assert.equal(labelRegions(pair(200), labels, detached).length, 0);
  assert.equal(labelRegions(pair(150), labels, detached).length, 1);
});

test('manual movement invalidates old paths, including unrelated cards blocking a connection', () => {
  const source = tile('a', 1, { x: 100, y: 100 }), target = tile('b', 1, { x: 900, y: 100 });
  const route = { sourceId: 'a', targetId: 'b', source: { x: 100, y: 100, width: 260, height: 200 },
    target: { x: 900, y: 100, width: 260, height: 200 }, sections: [[{ x: 360, y: 200 }, { x: 900, y: 200 }]] };
  assert.ok(routeIsCurrent(route, source, target, [source, target]));
  assert.equal(routeIsCurrent(route, { ...source, x: 120 }, target, [source, target]), false);
  const blocker = tile('blocker', null, { x: 500, y: 100 });
  assert.equal(routeIsCurrent(route, source, target, [source, target, blocker]), false);
  const routed = rerouteConnection(source, target, [source, target, blocker]);
  assert.ok(routed.points?.length >= 4);
  assert.deepEqual(routed.points[0], { x: 360, y: 200 });
  assert.deepEqual(routed.points.at(-1), { x: 900, y: 200 });
  assert.ok(routeIsCurrent({ ...route, sections: [routed.points] }, source, target, [source, target, blocker]));
  assert.deepEqual([source.x, target.x, blocker.x], [100, 900, 500]);
  assert.ok(!/NaN|Infinity/.test(rerouteConnection(source, { ...target, x: 150 }, [source, { ...target, x: 150 }]).path));
});
