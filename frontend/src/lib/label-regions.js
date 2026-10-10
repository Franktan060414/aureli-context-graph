import { tileDimensions } from './graph-layout.js';

const JOIN_DISTANCE = 160;
const LEAVE_DISTANCE = 224;

// Label ownership never depends on position. Only the optional background
// regions are derived from proximity, with separate join/leave thresholds.
export function labelRegions(tiles, labels = [], previous = []) {
  const known = new Map(labels.map(label => [String(label.id), label]));
  const former = new Map(previous.flatMap(region => region.tileIds.map(id => [id, region.key])));
  const byLabel = new Map();
  for (const tile of tiles) {
    const labelId = tile.labelId == null ? null : String(tile.labelId);
    if (!known.has(labelId)) continue;
    if (!byLabel.has(labelId)) byLabel.set(labelId, []);
    byLabel.get(labelId).push({ ...tile, ...tileDimensions(tile) });
  }
  const regions = [];
  for (const [labelId, members] of byLabel) {
    members.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const remaining = new Set(members);
    while (remaining.size) {
      const component = [remaining.values().next().value];
      remaining.delete(component[0]);
      for (let cursor = 0; cursor < component.length; cursor++) {
        const a = component[cursor];
        for (const b of remaining) {
          const dx = Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width);
          const dy = Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height);
          const stayedTogether = former.has(a.id) && former.get(a.id) === former.get(b.id);
          if (Math.hypot(dx, dy) <= (stayedTogether ? LEAVE_DISTANCE : JOIN_DISTANCE)) {
            component.push(b);
            remaining.delete(b);
          }
        }
      }
      if (component.length < 2) continue;
      const tileIds = component.map(tile => tile.id).sort();
      const left = Math.min(...component.map(tile => tile.x));
      const top = Math.min(...component.map(tile => tile.y));
      const right = Math.max(...component.map(tile => tile.x + tile.width));
      const bottom = Math.max(...component.map(tile => tile.y + tile.height));
      const x = Math.max(12, left - 20), y = Math.max(12, top - 44);
      const captionBelow = top - y < 36;
      regions.push({ key: JSON.stringify([labelId, tileIds]), label: known.get(labelId), tileIds,
        total: members.length, x, y, width: right + 20 - x,
        height: bottom + (captionBelow ? 40 : 20) - y, captionBelow });
    }
  }
  return regions;
}
