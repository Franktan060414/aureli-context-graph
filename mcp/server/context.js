// This budget limits the exact serialized tool payload (UTF-16 code units),
// not the host's token window. Never fetch siblings via a source's outgoing edge.
export function buildContext(workspace, options) {
  const { sourceIds, excludedIds = [], scope = 'ancestors', maxChars = 6000, question = '' } = options;
  const byId = new Map(workspace.nodes.map(node => [node.id, node]));
  const roots = [...new Set(sourceIds)];
  const excluded = new Set(excludedIds);
  for (const id of [...roots, ...excluded]) if (!byId.has(id)) throw new Error('所选节点已不存在，请刷新画布。');
  if (roots.some(id => excluded.has(id))) throw new Error('直接来源不能同时被排除。');
  const visits = new Map(roots.map(id => [id, { distance: 0, via: null }]));
  const queue = [...roots];
  if (scope === 'ancestors') for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const edge of workspace.edges) {
      const next = edge.target === current ? edge.source
        : edge.direction === 'UNDIRECTED' && edge.source === current ? edge.target : null;
      if (next && !excluded.has(next) && !visits.has(next)) {
        visits.set(next, { distance: visits.get(current).distance + 1, via: current });
        queue.push(next);
      }
    }
  }
  const ordered = [...visits.keys()].sort((a, b) => visits.get(a).distance - visits.get(b).distance
    || byId.get(b).weight - byId.get(a).weight || a.localeCompare(b));
  const serializeNode = id => {
    const node = byId.get(id);
    return { id, title: node.title, kind: node.kind, distance: visits.get(id).distance,
      direct: roots.includes(id), content: node.content, truncated: false,
      ...(node.file ? { file: { ...node.file, contentProvided: false } } : {}) };
  };
  const packet = { version: 1, conversation_id: workspace.conversation_id, question, scope, sourceIds: roots,
    nodes: ordered.map(serializeNode), relations: [], omittedCount: 0 };
  const relationsFor = nodes => {
    const visible = new Set(nodes.map(node => node.id));
    return workspace.edges.filter(edge => visible.has(edge.source) && visible.has(edge.target))
      .map(({ source, target, direction }) => ({ source, target, direction }));
  };
  packet.relations = relationsFor(packet.nodes);
  const text = () => JSON.stringify(packet);
  if (text().length > maxChars) {
    packet.nodes = roots.map(id => ({ ...serializeNode(id), content: '', truncated: true }));
    packet.relations = relationsFor(packet.nodes);
    packet.omittedCount = visits.size - packet.nodes.length;
    if (text().length > maxChars) throw new Error('预算不足以容纳问题和直接来源标识，请提高字符预算或减少来源。');
    const expand = (entry, original, allowance) => {
      let low = 0, high = original.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        entry.content = original.slice(0, mid); entry.truncated = mid < original.length;
        if (text().length <= allowance) low = mid; else high = mid - 1;
      }
      // Avoid ending an excerpt in the middle of a surrogate pair.
      if (low && /[\uD800-\uDBFF]/.test(original[low - 1])) low--;
      entry.content = original.slice(0, low); entry.truncated = low < original.length;
    };
    // Reserve a fair excerpt for every direct source before expanding one source.
    const available = maxChars - text().length;
    for (const entry of packet.nodes) expand(entry, byId.get(entry.id).content,
      Math.min(maxChars, text().length + Math.floor(available / Math.max(1, roots.length))));
    for (const id of ordered.filter(id => !roots.includes(id))) {
      const entry = { ...serializeNode(id), content: '', truncated: true };
      packet.nodes.push(entry); packet.relations = relationsFor(packet.nodes);
      packet.omittedCount = visits.size - packet.nodes.length;
      if (text().length > maxChars) {
        packet.nodes.pop(); packet.relations = relationsFor(packet.nodes);
        packet.omittedCount = visits.size - packet.nodes.length;
        continue;
      }
      expand(entry, byId.get(id).content, maxChars);
      if (!entry.content && byId.get(id).content) {
        packet.nodes.pop(); packet.relations = relationsFor(packet.nodes);
        packet.omittedCount = visits.size - packet.nodes.length;
      }
    }
  }
  const included = new Map(packet.nodes.map(node => [node.id, node]));
  const audit = workspace.nodes.map(node => ({ id: node.id, title: node.title,
    direct: roots.includes(node.id), ...visits.get(node.id),
    state: excluded.has(node.id) ? 'excluded' : included.has(node.id) ? 'included'
      : visits.has(node.id) ? 'budget' : 'outside',
    truncated: included.get(node.id)?.truncated ?? false }));
  return { packet, contextText: text(), chars: text().length, maxChars, audit };
}
