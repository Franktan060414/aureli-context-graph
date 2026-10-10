import { TILE_WIDTH, TILE_HEIGHT } from './graph-layout.js';

export const EXPORT_CARD_WIDTH = 480;
export const EXPORT_CARD_ASPECT_RATIO = TILE_WIDTH / TILE_HEIGHT;
const CAPTURE_SLICE_SIZE = 1024;
const EXPORT_CANVAS_BACKGROUND = '#f3f5f8';

// Measure rendered content at each candidate width: text keeps its font size,
// while both card dimensions grow in the same proportion as the canvas Tile.
export function fitExportCard(measureHeight, { signal } = {}) {
  const fits = width => {
    checkExportCancelled(signal);
    const contentHeight = measureHeight(width);
    if (!Number.isFinite(contentHeight) || contentHeight < 0)
      throw new Error('无法测量卡片内容，请重试。');
    return contentHeight + 2 <= width / EXPORT_CARD_ASPECT_RATIO;
  };
  let low = EXPORT_CARD_WIDTH, high = low;
  if (!fits(high)) {
    let attempts = 0;
    do {
      low = high;
      high *= 2;
      if (++attempts > 32) throw new Error('卡片内容尺寸过大，无法完成排版。');
    } while (!fits(high));
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (fits(middle)) high = middle;
      else low = middle;
    }
  }
  return { width: high, height: high / EXPORT_CARD_ASPECT_RATIO };
}

export function checkExportCancelled(signal) {
  if (signal?.aborted) throw new DOMException('已取消导出', 'AbortError');
}

// Include source relationships even when an older snapshot omitted its edge records.
export function exportEdges(tiles, edges = []) {
  const ids = new Set(tiles.map(tile => tile.id));
  const result = edges.filter(edge => ids.has(edge.sourceTileId) && ids.has(edge.targetTileId))
    .map(edge => ({ ...edge }));
  const pairs = new Set(result.map(edge => JSON.stringify([edge.sourceTileId, edge.targetTileId])));
  for (const tile of tiles) for (const source of tile.relatedTileIds || []) {
    const pair = JSON.stringify([source, tile.id]);
    if (!ids.has(source) || source === tile.id || pairs.has(pair)) continue;
    pairs.add(pair);
    result.push({ id: `export-edge:${result.length}`, sourceTileId: source, targetTileId: tile.id,
      direction: 'DIRECTED', relationType: 'EXTENDS' });
  }
  return result;
}

// Keep the entire graph on a single PDF page, including very tall graphs.
export function exportPageSize(width, height) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0))
    throw new Error('无法确定导出尺寸，请重试。');
  const scale = Math.min(0.75, 14400 / Math.max(width, height));
  return { width: width * scale, height: height * scale, scale,
    orientation: width > height ? 'landscape' : 'portrait' };
}

export function downloadExport(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportFilename(name, extension) {
  return `${(name || 'aureli-graph').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100)}.${extension}`;
}

function drawArrow(pdf, tip, previous, scale) {
  const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x);
  const length = 9, halfWidth = 4;
  const base = { x: tip.x - Math.cos(angle) * length, y: tip.y - Math.sin(angle) * length };
  pdf.triangle(tip.x * scale, tip.y * scale,
    (base.x + Math.sin(angle) * halfWidth) * scale, (base.y - Math.cos(angle) * halfWidth) * scale,
    (base.x - Math.sin(angle) * halfWidth) * scale, (base.y + Math.cos(angle) * halfWidth) * scale, 'F');
}

function drawConnection(pdf, link, scale) {
  pdf.setDrawColor(...link.color);
  pdf.setFillColor(...link.color);
  pdf.setLineWidth(1.5 * scale);
  let start, next, end, previous;
  if (link.sections?.length) {
    for (const points of link.sections) {
      pdf.moveTo(points[0].x * scale, points[0].y * scale);
      for (const point of points.slice(1)) pdf.lineTo(point.x * scale, point.y * scale);
      pdf.stroke();
    }
    [start, next] = link.sections[0];
    [previous, end] = link.sections.at(-1).slice(-2);
  } else {
    const values = link.path.match(/-?\d+(?:\.\d+)?/g).map(Number);
    [start, next, previous, end] = [0, 2, 4, 6].map(i => ({ x: values[i], y: values[i + 1] }));
    pdf.moveTo(start.x * scale, start.y * scale);
    pdf.curveTo(next.x * scale, next.y * scale, previous.x * scale, previous.y * scale,
      end.x * scale, end.y * scale);
    pdf.stroke();
  }
  drawArrow(pdf, end, previous, scale);
  if (link.direction === 'UNDIRECTED') drawArrow(pdf, start, next, scale);
}

export async function createGraphPdf(scene, { signal, onProgress = () => {} } = {}) {
  checkExportCancelled(signal);
  onProgress('正在生成 PDF…');
  const [{ jsPDF }, { toCanvas }] = await Promise.all([import('jspdf'), import('html-to-image')]);
  checkExportCancelled(signal);
  const size = exportPageSize(scene.width, scene.height);
  const pdf = new jsPDF({ unit: 'pt', format: [size.width, size.height], orientation: size.orientation,
    compress: true, precision: 8 });
  pdf.setFillColor(EXPORT_CANVAS_BACKGROUND);
  pdf.rect(0, 0, size.width, size.height, 'F');
  for (const link of scene.links) drawConnection(pdf, link, size.scale);
  const captures = [...scene.element.querySelectorAll('[data-export-brand], [data-export-card], [data-export-relation]')];
  // Capture cards in bounded two-dimensional slices. Content-sized cards can
  // grow in either direction; a single wide capture would exceed canvas limits.
  let finished = 0;
  for (const element of captures) {
    checkExportCancelled(signal);
    const bounds = element.getBoundingClientRect();
    const width = Math.ceil(bounds.width), height = Math.ceil(bounds.height);
    const x = Number(element.dataset.exportX), y = Number(element.dataset.exportY);
    const wrapper = document.createElement('div');
    wrapper.className = 'graph-export-document graph-export-capture';
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.inert = true;
    Object.assign(wrapper.style, { position: 'fixed', left: '-100000px', top: '0', width: `${width}px`,
      overflow: 'hidden', pointerEvents: 'none' });
    const clone = element.cloneNode(true);
    Object.assign(clone.style, { position: 'absolute', left: '0', margin: '0', transform: 'none', width: `${width}px` });
    wrapper.append(clone);
    document.body.append(wrapper);
    try {
      for (let top = 0; top < height; top += CAPTURE_SLICE_SIZE) {
        checkExportCancelled(signal);
        const sliceHeight = Math.min(CAPTURE_SLICE_SIZE, height - top);
        wrapper.style.height = `${sliceHeight}px`;
        clone.style.top = `${-top}px`;
        for (let left = 0; left < width; left += CAPTURE_SLICE_SIZE) {
          checkExportCancelled(signal);
          const sliceWidth = Math.min(CAPTURE_SLICE_SIZE, width - left);
          wrapper.style.width = `${sliceWidth}px`;
          clone.style.left = `${-left}px`;
          const canvas = await toCanvas(wrapper, { width: sliceWidth, height: sliceHeight, pixelRatio: 2,
            skipAutoScale: true, backgroundColor: EXPORT_CANVAS_BACKGROUND, fontEmbedCSS: '',
            // Chrome copies logical insets as well as left/top. Reset both so
            // the offscreen capture root does not remain outside the SVG image.
            style: { position: 'relative', inset: '0 auto auto 0',
              insetBlock: '0 auto', insetInline: '0 auto' } });
          checkExportCancelled(signal);
          pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (x + left) * size.scale, (y + top) * size.scale,
            sliceWidth * size.scale, sliceHeight * size.scale, undefined, 'FAST');
          canvas.width = canvas.height = 0;
          // Let cancellation and progress paint between captures.
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    } finally { wrapper.remove(); }
    onProgress(`正在生成 PDF（${++finished}/${captures.length}）…`);
  }
  checkExportCancelled(signal);
  return pdf.output('blob');
}
