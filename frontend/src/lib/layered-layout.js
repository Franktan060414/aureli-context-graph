import { tileDimensions } from './graph-layout.js';
import ELK from 'elkjs/lib/elk-api.js';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';

export function layoutSignature(tiles, edges, labels) {
  return JSON.stringify([
    tiles.map(tile => [tile.id, tile.labelId ?? null, tile.weight ?? 1,
      [...tile.relatedTileIds || []].sort()]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    edges.map(edge => [edge.id, edge.sourceTileId, edge.targetTileId]).sort(),
    labels.map(label => String(label.id)).sort(),
  ]);
}

async function runLayout(graph, signal) {
  if (signal?.aborted) throw new DOMException('已取消整理', 'AbortError');
  // Node tests use the same engine; browser work runs off the UI thread.
  if (typeof Worker === 'undefined') {
    const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
    return new ELK().layout(graph);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl);
    const elk = new ELK({ workerFactory: () => worker, algorithms: ['layered'] });
    const finish = (error, result) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(new DOMException('已取消整理', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('整理耗时较长，请减少节点后重试或选择树状排列。')), 30000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => { event.preventDefault(); finish(new Error('无法加载 Layered 排列，请重试。')); };
    elk.layout(graph).then(result => finish(null, result), error => finish(
      new Error('Layered 计算未完成，请重试或选择树状排列。', { cause: error })));
  });
}

export async function arrangeLayeredTiles(tiles, edges = [], labels = [],
  { signal, dimensions = tileDimensions, spacingScale = 1 } = {}) {
  if (!tiles.length) return { positions: [], routes: {} };
  const tileById = new Map(tiles.map(tile => [String(tile.id), tile]));
  const labelsById = new Set(labels.map(label => String(label.id)));
  const groups = new Map(), children = [];
  const spacing = value => String(value * spacingScale);
  for (const tile of [...tiles].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const node = { id: `tile:${tile.id}`, ...dimensions(tile) };
    const labelId = tile.labelId == null ? null : String(tile.labelId);
    if (!labelsById.has(labelId)) children.push(node);
    else {
      if (!groups.has(labelId)) groups.set(labelId, []);
      groups.get(labelId).push(node);
    }
  }
  for (const [labelId, nodes] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    children.push({ id: `label:${labelId}`, children: nodes,
      layoutOptions: { 'elk.padding': '[top=64,left=32,bottom=32,right=32]',
        'elk.spacing.nodeNode': spacing(64), 'elk.layered.spacing.nodeNodeBetweenLayers': spacing(96),
        'elk.spacing.edgeNode': spacing(24), 'elk.spacing.edgeEdge': spacing(18) } });
  }
  const valid = edge => tileById.has(String(edge.sourceTileId)) && tileById.has(String(edge.targetTileId));
  const actual = edges.filter(valid);
  const pairs = new Set(actual.map(edge => JSON.stringify([String(edge.sourceTileId), String(edge.targetTileId)])));
  const inputs = actual.map((edge, index) => ({ id: `edge:${index}`,
    sources: [`tile:${edge.sourceTileId}`], targets: [`tile:${edge.targetTileId}`] }));
  for (const tile of tileById.values()) for (const source of tile.relatedTileIds || []) {
    const pair = JSON.stringify([String(source), String(tile.id)]);
    if (!tileById.has(String(source)) || pairs.has(pair) || String(source) === String(tile.id)) continue;
    pairs.add(pair);
    inputs.push({ id: `implicit:${inputs.length}`, sources: [`tile:${source}`], targets: [`tile:${tile.id}`] });
  }
  const result = await runLayout({ id: 'root', children, edges: inputs, layoutOptions: {
    'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.randomSeed': '7',
    'elk.padding': '[top=64,left=32,bottom=32,right=32]',
    'elk.spacing.nodeNode': spacing(64), 'elk.spacing.componentComponent': spacing(80),
    'elk.layered.spacing.nodeNodeBetweenLayers': spacing(104), 'elk.spacing.edgeNode': spacing(24),
    'elk.spacing.edgeEdge': spacing(18), 'elk.layered.mergeHierarchyEdges': 'false',
  } }, signal);
  if (signal?.aborted) throw new DOMException('已取消整理', 'AbortError');
  const points = new Map(), offsets = new Map([['root', { x: 0, y: 0 }]]), routed = [];
  function visit(parent, x = 0, y = 0) {
    for (const child of parent.children || []) {
      const point = { x: x + child.x, y: y + child.y };
      offsets.set(child.id, point);
      if (child.children) visit(child, point.x, point.y);
      else points.set(child.id, { ...point, width: child.width, height: child.height });
    }
    for (const edge of parent.edges || []) routed.push({ edge, offset: { x, y } });
  }
  visit(result);
  const routes = {};
  for (const { edge, offset } of routed) {
    const index = /^edge:(\d+)$/.exec(edge.id)?.[1];
    if (index == null || !edge.sections?.length) continue;
    const original = actual[Number(index)], origin = offsets.get(edge.container) || offset;
    routes[original.id] = {
      sourceId: original.sourceTileId, targetId: original.targetTileId,
      source: points.get(`tile:${original.sourceTileId}`), target: points.get(`tile:${original.targetTileId}`),
      sections: edge.sections.map(section => [section.startPoint, ...section.bendPoints || [], section.endPoint]
        .map(point => ({ x: point.x + origin.x, y: point.y + origin.y }))),
    };
  }
  const positions = tiles.map(tile => ({ ...tile, ...points.get(`tile:${tile.id}`) }));
  if (positions.some(tile => !Number.isFinite(tile.x) || !Number.isFinite(tile.y))) {
    throw new Error('排列结果不完整，请重试。');
  }
  return { positions, routes };
}

export function readArrangements() {
  try {
    const saved = JSON.parse(localStorage.getItem('aureli-canvas-arrangements') || '{}');
    return Object.fromEntries(Object.entries(saved || {}).filter(([, value]) =>
      value && ['tree', 'layered'].includes(value.mode)).map(([key, value]) => [key, {
      mode: value.mode, routes: value.routes && typeof value.routes === 'object' ? value.routes : {},
    }]));
  } catch { return {}; }
}
