import { connectionGeometry, tileDimensions } from './graph-layout.js';

const box = tile => ({ ...tile, ...tileDimensions(tile) });
const sameBox = (a, b) => a && ['x', 'y', 'width', 'height'].every(key => a[key] === b[key]);

function crosses(a, b, rect, padding = 0) {
  const left = rect.x - padding, right = rect.x + rect.width + padding;
  const top = rect.y - padding, bottom = rect.y + rect.height + padding;
  if (Math.abs(a.x - b.x) < .001) return a.x > left + .001 && a.x < right - .001
    && Math.max(a.y, b.y) > top + .001 && Math.min(a.y, b.y) < bottom - .001;
  if (Math.abs(a.y - b.y) < .001) return a.y > top + .001 && a.y < bottom - .001
    && Math.max(a.x, b.x) > left + .001 && Math.min(a.x, b.x) < right - .001;
  return true;
}

export function routeIsCurrent(route, source, target, tiles) {
  if (!route || route.sourceId !== source.id || route.targetId !== target.id
      || !sameBox(route.source, box(source)) || !sameBox(route.target, box(target))
      || !Array.isArray(route.sections) || !route.sections.length) return false;
  for (const points of route.sections) {
    if (!Array.isArray(points) || points.length < 2
        || points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
    for (let i = 1; i < points.length; i++) for (const tile of tiles) {
      if (tile.id !== source.id && tile.id !== target.id && crosses(points[i - 1], points[i], box(tile), 4)) return false;
    }
  }
  return true;
}

export function polylineGeometry(sections) {
  let label, path = '';
  for (const points of sections) {
    if (points.length < 2) continue;
    path += `M${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
      if (!label || length > label.length) label = { length, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 9 };
      if (i < points.length - 1) {
        const c = points[i + 1], next = Math.hypot(c.x - b.x, c.y - b.y);
        if (!length || !next) continue;
        const radius = Math.min(8, length / 2, next / 2);
        path += ` L${b.x + (a.x - b.x) * radius / length},${b.y + (a.y - b.y) * radius / length}`
          + ` Q${b.x},${b.y} ${b.x + (c.x - b.x) * radius / next},${b.y + (c.y - b.y) * radius / next}`;
      } else path += ` L${b.x},${b.y}`;
    }
    path += ' ';
  }
  return { path: path.trim(), x: label?.x ?? 0, y: label?.y ?? 0 };
}

// Reroute moved/obstructed connections without moving any Tile. The search
// uses card boundaries as orthogonal corridors and penalizes extra bends.
export function rerouteConnection(source, target, tiles) {
  const fallback = connectionGeometry(source, target);
  const s = box(source), t = box(target);
  const dx = t.x + t.width / 2 - s.x - s.width / 2;
  const dy = t.y + t.height / 2 - s.y - s.height / 2;
  const horizontal = Math.abs(dx) / (s.width + t.width) >= Math.abs(dy) / (s.height + t.height);
  const sign = (horizontal ? dx : dy) >= 0 ? 1 : -1;
  const start = horizontal ? { x: s.x + (sign > 0 ? s.width : 0), y: s.y + s.height / 2 }
    : { x: s.x + s.width / 2, y: s.y + (sign > 0 ? s.height : 0) };
  const end = horizontal ? { x: t.x + (sign > 0 ? 0 : t.width), y: t.y + t.height / 2 }
    : { x: t.x + t.width / 2, y: t.y + (sign > 0 ? 0 : t.height) };
  const outside = (p, direction) => ({ x: Math.max(2, p.x + (horizontal ? direction * 16 : 0)),
    y: Math.max(2, p.y + (horizontal ? 0 : direction * 16)) });
  const from = outside(start, sign), to = outside(end, -sign);
  const all = tiles.map(box);
  // Bound work on very large, freely edited maps. Initial ELK routes remain
  // available; intersecting/overlapping cards can always use a live curve.
  if (all.length > 100) return fallback;
  const xs = [...new Set([2, from.x, to.x, ...all.flatMap(n => [Math.max(2, n.x - 16), n.x + n.width + 16])])].sort((a, b) => a - b);
  const ys = [...new Set([2, from.y, to.y, ...all.flatMap(n => [Math.max(2, n.y - 16), n.y + n.height + 16])])].sort((a, b) => a - b);
  const clear = (a, b) => !all.some(n => crosses(a, b, n, 12));
  if (!clear(from, from) || !clear(to, to)) return fallback;
  const count = xs.length, startIndex = ys.indexOf(from.y) * count + xs.indexOf(from.x);
  const endIndex = ys.indexOf(to.y) * count + xs.indexOf(to.x);
  const point = index => ({ x: xs[index % count], y: ys[Math.floor(index / count)] });
  const distance = p => Math.abs(p.x - to.x) + Math.abs(p.y - to.y);
  const queue = [], best = new Map(), parents = new Map(), segments = new Map();
  function push(item) {
    queue.push(item);
    let i = queue.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (queue[p].score <= item.score) break;
      queue[i] = queue[p]; i = p; }
    queue[i] = item;
  }
  function pop() {
    const first = queue[0], last = queue.pop();
    if (queue.length) {
      let i = 0;
      while (i * 2 + 1 < queue.length) {
        let child = i * 2 + 1;
        if (child + 1 < queue.length && queue[child + 1].score < queue[child].score) child++;
        if (queue[child].score >= last.score) break;
        queue[i] = queue[child]; i = child;
      }
      queue[i] = last;
    }
    return first;
  }
  const initial = startIndex * 2 + Number(!horizontal);
  best.set(initial, 0);
  push({ key: initial, index: startIndex, axis: Number(!horizontal), cost: 0, score: distance(from) });
  let finish, visits = 0;
  while (queue.length && visits++ < 20000) {
    const current = pop();
    if (current.cost !== best.get(current.key)) continue;
    if (current.index === endIndex) { finish = current.key; break; }
    const x = current.index % count, y = Math.floor(current.index / count), a = point(current.index);
    for (const [nx, ny, axis] of [[x - 1, y, 0], [x + 1, y, 0], [x, y - 1, 1], [x, y + 1, 1]]) {
      if (nx < 0 || nx >= count || ny < 0 || ny >= ys.length) continue;
      const index = ny * count + nx, b = point(index), segment = [Math.min(index, current.index), Math.max(index, current.index)].join(':');
      if (!segments.has(segment)) segments.set(segment, clear(a, b));
      if (!segments.get(segment)) continue;
      const key = index * 2 + axis, cost = current.cost + Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
        + (axis === current.axis ? 0 : 24);
      if (cost >= (best.get(key) ?? Infinity)) continue;
      best.set(key, cost); parents.set(key, current.key);
      push({ key, index, axis, cost, score: cost + distance(b) });
    }
  }
  if (finish == null) return fallback;
  const points = [];
  for (let key = finish; key != null; key = parents.get(key)) points.push(point(Math.floor(key / 2)));
  points.reverse(); points.unshift(start); points.push(end);
  const simplified = points.filter((p, i) => {
    if (!i || i === points.length - 1) return true;
    const a = points[i - 1], b = points[i + 1];
    return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
  });
  return { ...polylineGeometry([simplified]), points: simplified };
}
