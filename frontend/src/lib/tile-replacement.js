// Demo mode uses the same replacement rules as the persisted operation.
export function replacementEdges(edges, sourceIds, replacementIds, newEdgeId) {
  const removed = new Set(sourceIds);
  return edges.flatMap(edge => {
    const sourceRemoved = removed.has(edge.sourceTileId);
    const targetRemoved = removed.has(edge.targetTileId);
    if (sourceRemoved === targetRemoved) return [];
    return replacementIds.map(id => ({
      ...edge, id: newEdgeId(),
      sourceTileId: sourceRemoved ? id : edge.sourceTileId,
      targetTileId: targetRemoved ? id : edge.targetTileId,
    }));
  });
}
