// Conversation depth rows, independent of canvas coordinates and Tile weights.
export function branchRows(tiles, edges = []) {
  const nodes = new Map(tiles.map(tile => [tile.id, {
    tile, parents: new Set(), children: new Set(), depth: 0,
  }]));
  const connect = (source, target) => {
    if (source === target || !nodes.has(source) || !nodes.has(target)) return;
    nodes.get(source).children.add(target);
    nodes.get(target).parents.add(source);
  };
  tiles.forEach(tile => (tile.relatedTileIds || []).forEach(id => connect(id, tile.id)));
  edges.forEach(edge => {
    // Peer relations do not define a conversation's ancestry.
    if (edge.direction !== "UNDIRECTED" && edge.relationType !== "RELATES")
      connect(edge.sourceTileId, edge.targetTileId);
  });
  const pending = new Map([...nodes].map(([id, node]) => [id, node.parents.size]));
  const queue = [...nodes.keys()].filter(id => pending.get(id) === 0);
  const visited = new Set();
  let cursor = 0;
  while (visited.size < nodes.size) {
    // Malformed cyclic data must still render every Tile once.
    if (cursor === queue.length) queue.push([...nodes.keys()].find(id => !visited.has(id)));
    const id = queue[cursor++];
    if (visited.has(id)) continue;
    const node = nodes.get(id);
    for (const parent of node.parents) {
      if (visited.has(parent)) node.depth = Math.max(node.depth, nodes.get(parent).depth + 1);
    }
    visited.add(id);
    for (const child of node.children) {
      pending.set(child, pending.get(child) - 1);
      if (pending.get(child) === 0 && !visited.has(child)) queue.push(child);
    }
  }
  const rows = new Map();
  for (const { tile, depth } of nodes.values()) {
    if (!rows.has(depth)) rows.set(depth, []);
    rows.get(depth).push(tile);
  }
  return [...rows].sort(([a], [b]) => a - b).map(([depth, tiles]) => ({ depth, tiles }));
}

function contentSize(tile) {
  const title = tile.title || tile.message || tile.fileName || "";
  const body = tile.status === "error" ? tile.error : (tile.tileType || "QA") === "QA"
    ? tile.answer : tile.content || tile.answer || tile.fileName;
  // Approximate visible glyph widths, excluding Markdown decoration and link URLs.
  const text = `${title}\n${body || ""}`
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*```.*$/gm, "")
    .replace(/[*`~|]/g, "");
  let size = 0;
  for (const char of text) {
    size += char === "\n" ? 8 : /\s/.test(char) ? 0.5 : char.codePointAt(0) > 255 ? 2 : 1;
  }
  // Small stream chunks should not resize every sibling on every character.
  return Math.max(64, Math.ceil(size / 32) * 32);
}

export function branchColumnFractions(tiles, availableWidth = 0) {
  if (!tiles.length) return [];
  const count = tiles.length;
  // Reserve a readable width for short answers, while always fitting the row.
  const minimum = availableWidth > 0
    ? Math.min(1 / count, Math.min(180, Math.max(96, availableWidth / count / 2)) / availableWidth)
    : 1 / count / 4;
  const sizes = tiles.map(contentSize), total = sizes.reduce((sum, size) => sum + size, 0);
  const remaining = Math.max(0, 1 - minimum * count);
  return sizes.map(size => minimum + remaining * size / total);
}

// Collapse is a presentation state: preserve source order and ancestry, and
// always keep one full answer visible even after deletion or depth changes.
export function branchRowPresentation(tiles, collapsedIds = [], availableWidth = 0) {
  const collapsed = new Set(collapsedIds);
  if (tiles.length && tiles.every(tile => collapsed.has(tile.id))) collapsed.delete(tiles[0].id);
  const folded = tiles.filter(tile => collapsed.has(tile.id));
  const expanded = tiles.filter(tile => !collapsed.has(tile.id));
  const railWidth = availableWidth > 0 && folded.length
    ? Math.max(44, Math.min(64, availableWidth * 0.32 / folded.length)) : 64;
  const minWidth = folded.length ? folded.length * railWidth + 120 : 0;
  const remainingWidth = Math.max(120, availableWidth - folded.length * railWidth);
  const fractions = branchColumnFractions(expanded, availableWidth > 0 ? remainingWidth : 0);
  return {
    tiles: [...folded, ...expanded],
    collapsedIds: folded.map(tile => tile.id),
    expandedCount: expanded.length,
    minWidth,
    columns: [...folded.map(() => `${railWidth}px`), ...fractions.map(share => `minmax(0, ${share}fr)`)].join(" "),
  };
}
