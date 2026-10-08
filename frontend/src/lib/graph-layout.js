export const TILE_WIDTH = 260;
export const TILE_HEIGHT = 200;
export const ARRANGE_HORIZONTAL_GAP = 96;
export const ARRANGE_VERTICAL_GAP = 64;

export function tileDimensions(tile) {
  const scale = Number(tile.weight) === 3 ? 2.5 : Number(tile.weight) === 2 ? 1.5 : 1;
  return { width: TILE_WIDTH * scale, height: TILE_HEIGHT * scale };
}

export function positionTiles(tiles, layout = {}) {
  const depths = new Map();
  // New Tiles only reference existing Tiles, so creation order is topological.
  tiles.forEach(tile => depths.set(tile.id,
    Math.max(-1, ...tile.relatedTileIds.map(id => depths.get(id) ?? -1)) + 1));
  const groups = new Map();
  tiles.forEach(tile => {
    const depth = depths.get(tile.id);
    if (!groups.has(depth)) groups.set(depth, []);
    groups.get(depth).push({ ...tile, ...tileDimensions(tile) });
  });
  const columns = [...groups.entries()].sort(([a], [b]) => a - b).map(([depth, group]) => ({
    depth, group,
    width: Math.max(...group.map(tile => tile.width)),
    height: group.reduce((sum, tile) => sum + tile.height, 0) + (group.length - 1) * 32,
  }));
  const maxHeight = Math.max(0, ...columns.map(column => column.height));
  const positions = new Map();
  let x = 24;
  columns.forEach(column => {
    let y = 24 + (maxHeight - column.height) / 2;
    column.group.forEach(tile => {
      positions.set(tile.id, { ...tile, x, y, ...layout[tile.id] });
      y += tile.height + 32;
    });
    x += column.width + 56;
  });
  return tiles.map(tile => positions.get(tile.id));
}

// Arrange a graph as a left-to-right forest. Shared descendants keep every
// connection, but occupy one branch beneath their deepest parent.
export function arrangeTiles(tiles, edges = []) {
  const nodes = new Map(tiles.map(tile => [tile.id, {
    tile: { ...tile, ...tileDimensions(tile) },
    parents: new Set(), targets: new Set(), children: [], depth: 0,
  }]));
  const connect = (sourceId, targetId) => {
    if (sourceId === targetId || !nodes.has(sourceId) || !nodes.has(targetId)) return;
    nodes.get(sourceId).targets.add(targetId);
    nodes.get(targetId).parents.add(sourceId);
  };
  tiles.forEach(tile => (tile.relatedTileIds || []).forEach(id => connect(id, tile.id)));
  edges.forEach(edge => connect(edge.sourceTileId, edge.targetTileId));

  // Topological depth is independent of the API's Tile ordering. Break only
  // cyclic dependencies when no root remains, so malformed graphs still fit.
  const pending = new Map([...nodes].map(([id, node]) => [id, node.parents.size]));
  const queue = [...nodes.keys()].filter(id => pending.get(id) === 0);
  const visited = new Set(), ordered = [];
  let cursor = 0;
  while (ordered.length < nodes.size) {
    if (cursor === queue.length) queue.push([...nodes.keys()].find(id => !visited.has(id)));
    const id = queue[cursor++];
    if (visited.has(id)) continue;
    const node = nodes.get(id);
    for (const parentId of node.parents) {
      if (visited.has(parentId)) node.depth = Math.max(node.depth, nodes.get(parentId).depth + 1);
    }
    visited.add(id);
    ordered.push(id);
    for (const targetId of node.targets) {
      pending.set(targetId, pending.get(targetId) - 1);
      if (pending.get(targetId) === 0 && !visited.has(targetId)) queue.push(targetId);
    }
  }

  const orderIndex = new Map(ordered.map((id, index) => [id, index]));
  const roots = [], columnWidths = [];
  for (const [id, node] of nodes) {
    columnWidths[node.depth] = Math.max(columnWidths[node.depth] || 0, node.tile.width);
    let parent;
    for (const parentId of node.parents) {
      const candidate = nodes.get(parentId);
      if (orderIndex.get(parentId) < orderIndex.get(id) && candidate.depth < node.depth
          && (!parent || candidate.depth > parent.depth)) parent = candidate;
    }
    if (parent) parent.children.push(id);
    else roots.push(id);
  }
  // Reserve the whole branch height before placing its parent. This keeps
  // independent trees and different-sized Tiles from overlapping.
  for (let i = ordered.length - 1; i >= 0; i--) {
    const node = nodes.get(ordered[i]);
    node.childrenHeight = node.children.reduce((sum, id) => sum + nodes.get(id).branchHeight, 0)
      + Math.max(0, node.children.length - 1) * ARRANGE_VERTICAL_GAP;
    node.branchHeight = Math.max(node.tile.height, node.childrenHeight);
  }
  const columnX = [];
  let x = 24;
  columnWidths.forEach((width, depth) => {
    columnX[depth] = x;
    x += width + ARRANGE_HORIZONTAL_GAP;
  });
  const positions = new Map(), stack = [];
  let top = 24;
  roots.forEach(id => {
    stack.push({ id, top });
    top += nodes.get(id).branchHeight + ARRANGE_VERTICAL_GAP;
  });
  while (stack.length) {
    const { id, top } = stack.pop(), node = nodes.get(id);
    positions.set(id, { ...node.tile, x: columnX[node.depth],
      y: top + (node.branchHeight - node.tile.height) / 2 });
    let childTop = top + (node.branchHeight - node.childrenHeight) / 2;
    node.children.forEach(childId => {
      stack.push({ id: childId, top: childTop });
      childTop += nodes.get(childId).branchHeight + ARRANGE_VERTICAL_GAP;
    });
  }
  return tiles.map(tile => positions.get(tile.id));
}

// Choose facing card edges in either axis, preserving the edge's source/target.
export function connectionGeometry(source, target) {
  const sourceSize = tileDimensions(source), targetSize = tileDimensions(target);
  const dx = target.x + targetSize.width / 2 - source.x - sourceSize.width / 2;
  const dy = target.y + targetSize.height / 2 - source.y - sourceSize.height / 2;
  const horizontal = Math.abs(dx) / (sourceSize.width + targetSize.width)
    >= Math.abs(dy) / (sourceSize.height + targetSize.height);
  const sign = (horizontal ? dx : dy) >= 0 ? 1 : -1;
  const start = horizontal
    ? { x: source.x + (sign > 0 ? sourceSize.width : 0), y: source.y + sourceSize.height / 2 }
    : { x: source.x + sourceSize.width / 2, y: source.y + (sign > 0 ? sourceSize.height : 0) };
  const end = horizontal
    ? { x: target.x + (sign > 0 ? 0 : targetSize.width), y: target.y + targetSize.height / 2 }
    : { x: target.x + targetSize.width / 2, y: target.y + (sign > 0 ? 0 : targetSize.height) };
  const bend = Math.max(40, Math.abs(horizontal ? end.x - start.x : end.y - start.y) / 2);
  const c1 = { x: start.x + (horizontal ? sign * bend : 0), y: start.y + (horizontal ? 0 : sign * bend) };
  const c2 = { x: end.x - (horizontal ? sign * bend : 0), y: end.y - (horizontal ? 0 : sign * bend) };
  return {
    path: `M${start.x},${start.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`,
    x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
    y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8 - 9,
  };
}

export function readLayouts() {
  try {
    const saved = JSON.parse(localStorage.getItem('aureli-tile-layouts') || '{}');
    const layouts = {};
    for (const [workspace, positions] of Object.entries(saved || {})) {
      if (!positions || typeof positions !== 'object') continue;
      layouts[workspace] = Object.fromEntries(Object.entries(positions).filter(([, point]) =>
        point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 12 && point.y >= 12,
      ));
    }
    return layouts;
  } catch { return {}; }
}
