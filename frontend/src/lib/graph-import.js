const invalid = message => { throw new Error(`JSON 格式错误：${message}`); };
const object = (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${path} 必须是对象。`);
  return value;
};
const array = (value, path) => {
  if (!Array.isArray(value)) invalid(`${path} 必须是数组。`);
  return value;
};
const text = (value, path, { required = false, max = Infinity } = {}) => {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max)
    invalid(`${path} 必须是${required ? '非空' : ''}文本${max < Infinity ? `，且不超过 ${max} 个字符` : ''}。`);
  return value;
};

// Read only exported content. Runtime state, saved UI and embedded objects are never restored.
export function parseGraphImport(source) {
  let data;
  try { data = JSON.parse(source.replace(/^\uFEFF/, '')); }
  catch { invalid('文件不是有效的 JSON，请选择本应用导出的 JSON 文件。'); }
  object(data, '根节点');
  if (data.tiles?.length > 10000 || data.edges?.length > 50000) invalid('节点或关联数量过多。');
  const labelIds = new Set(), labelNames = new Set(), ids = new Set(), edgeIds = new Set();
  const labels = array(data.labels ?? [], 'labels').map((value, index) => {
    const path = `labels[${index}]`, label = object(value, path);
    if (!Number.isSafeInteger(label.id) || label.id <= 0 || labelIds.has(label.id)) invalid(`${path}.id 无效或重复。`);
    labelIds.add(label.id);
    const name = text(label.name, `${path}.name`, { required: true, max: 100 }).trim();
    if (labelNames.has(name)) invalid(`${path}.name 重复。`);
    labelNames.add(name);
    if (!/^#[0-9a-f]{6}$/i.test(label.colorHex)) invalid(`${path}.colorHex 必须是六位十六进制颜色。`);
    return { id: label.id, name, colorHex: label.colorHex };
  });
  const tiles = array(data.tiles, 'tiles').map((value, index) => {
    const path = `tiles[${index}]`, tile = object(value, path);
    const id = text(tile.id, `${path}.id`, { required: true, max: 128 });
    if (ids.has(id)) invalid(`${path}.id 重复。`);
    ids.add(id);
    const tileType = tile.tileType ?? 'QA';
    if (!['QA', 'NOTE', 'FILE'].includes(tileType)) invalid(`${path}.tileType 无效。`);
    const message = text(tile.message, `${path}.message`, { required: true });
    const answer = text(tile.answer, `${path}.answer`);
    const weight = tile.weight ?? 1;
    if (![1, 2, 3].includes(weight)) invalid(`${path}.weight 必须是 1、2 或 3。`);
    const labelId = tile.labelId ?? null;
    if (labelId !== null && !labelIds.has(labelId)) invalid(`${path}.labelId 引用了不存在的标签。`);
    const relatedTileIds = array(tile.relatedTileIds ?? [], `${path}.relatedTileIds`)
      .map(parent => text(parent, `${path}.relatedTileIds`, { required: true, max: 128 }));
    const title = text(tile.title ?? (tileType === 'QA' ? '' : message), `${path}.title`, { max: 255 });
    const content = text(tile.content ?? (tileType === 'NOTE' ? answer : ''), `${path}.content`);
    const fileName = text(tile.fileName ?? (tileType === 'FILE' ? message : ''), `${path}.fileName`, { max: 512 });
    const fileContentType = text(tile.fileContentType, `${path}.fileContentType`, { max: 128 });
    const fileSize = tile.fileSize ?? null;
    if (fileSize !== null && (!Number.isSafeInteger(fileSize) || fileSize < 0)) invalid(`${path}.fileSize 无效。`);
    return { id, message, answer, relatedTileIds: [...new Set(relatedTileIds)], weight, labelId,
      tileType, title, content, fileName, fileContentType, fileSize, status: 'ready' };
  });
  for (const tile of tiles) for (const id of tile.relatedTileIds)
    if (id === tile.id || !ids.has(id)) invalid(`节点 ${tile.id} 引用了无效的关联节点 ${id}。`);
  const edges = array(data.edges, 'edges').map((value, index) => {
    const path = `edges[${index}]`, edge = object(value, path);
    const id = text(edge.id, `${path}.id`, { required: true, max: 128 });
    if (edgeIds.has(id)) invalid(`${path}.id 重复。`);
    edgeIds.add(id);
    if (!ids.has(edge.sourceTileId) || !ids.has(edge.targetTileId) || edge.sourceTileId === edge.targetTileId)
      invalid(`${path} 的起点或终点无效。`);
    const direction = edge.direction ?? 'DIRECTED', weight = edge.weight ?? 1;
    if (!['DIRECTED', 'UNDIRECTED'].includes(direction)) invalid(`${path}.direction 无效。`);
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1) invalid(`${path}.weight 必须介于 0 和 1 之间。`);
    return { id, sourceTileId: edge.sourceTileId, targetTileId: edge.targetTileId, direction, weight,
      relationType: text(edge.relationType, `${path}.relationType`, { max: 64 }),
      description: text(edge.description, `${path}.description`) };
  });
  const layout = Object.fromEntries(Object.entries(object(data.layout ?? {}, 'layout')).map(([id, point]) => {
    object(point, `layout.${id}`);
    if (!ids.has(id) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) invalid(`layout.${id} 的节点或坐标无效。`);
    return [id, { x: point.x, y: point.y }];
  }));
  return { tiles, edges, labels, layout };
}
