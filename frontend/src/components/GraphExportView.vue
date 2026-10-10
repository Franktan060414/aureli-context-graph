<script setup>
import { computed, nextTick, ref } from 'vue';
import MarkdownAnswer from './MarkdownAnswer.vue';
import { arrangeTiles, connectionGeometry } from '../lib/graph-layout.js';
import { arrangeLayeredTiles } from '../lib/layered-layout.js';
import { polylineGeometry } from '../lib/graph-routing.js';
import { labelForTile, labelStyle } from '../lib/labels.js';
import { relationTypeForEdge } from '../lib/tile-relations.js';
import { checkExportCancelled, EXPORT_CARD_WIDTH, exportEdges, fitExportCard } from '../lib/graph-export.js';
import '../graph-export.css';

const props = defineProps({ snapshot: { type: Object, required: true } });
const stage = ref(null), positions = ref([]), links = ref([]);
const sizes = ref(new Map());
const boxes = computed(() => new Map(positions.value.map(tile => [tile.id, tile])));
const kind = tile => tile.tileType || 'QA';
const body = tile => kind(tile) === 'QA' ? tile.answer || '暂无回答'
  : tile.content || (kind(tile) === 'FILE' ? tile.fileName || tile.answer || '' : tile.answer || '');
const cardStyle = tile => {
  const box = boxes.value.get(tile.id) || sizes.value.get(tile.id);
  return { ...labelStyle(labelForTile(tile, props.snapshot.labels)),
    width: `${box?.width || EXPORT_CARD_WIDTH}px`, height: box ? `${box.height}px` : 'auto',
    left: `${box?.x || 0}px`, top: `${box?.y || 0}px` };
};
const dimensions = tile => ({ width: tile.width, height: tile.height });
const HEADER_HEIGHT = 120;

async function prepare({ signal, onProgress }) {
  await nextTick();
  await document.fonts.ready;
  checkExportCancelled(signal);
  await Promise.all([...stage.value.querySelectorAll('img')].map(image => image.decode()));
  checkExportCancelled(signal);
  const cards = [...stage.value.querySelectorAll('[data-export-card]')];
  const measured = [];
  onProgress('正在按原有长宽比调整卡片尺寸…');
  for (const [i, tile] of props.snapshot.tiles.entries()) {
    const card = cards[i];
    const size = fitExportCard(width => {
      card.style.width = `${width}px`;
      card.style.height = 'auto';
      return card.getBoundingClientRect().height;
    }, { signal });
    measured.push({ ...tile, ...size });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  checkExportCancelled(signal);
  sizes.value = new Map(measured.map(tile => [tile.id, tile]));
  await nextTick();
  const edges = exportEdges(measured, props.snapshot.edges);
  const layered = props.snapshot.arrangementMode === 'layered';
  onProgress(layered ? '正在按 Layered 方式排列完整内容…' : '正在按树状排列完整内容…');
  const result = layered
    ? await arrangeLayeredTiles(measured, edges, props.snapshot.labels, { signal, dimensions, spacingScale: 2 })
    : { positions: arrangeTiles(measured, edges, { dimensions, spacingScale: 2 }), routes: {} };
  checkExportCancelled(signal);
  // Reserve a header outside the graph, independent of the editor viewport.
  positions.value = result.positions.map(tile => ({ ...tile, y: tile.y + HEADER_HEIGHT }));
  const byId = new Map(positions.value.map(tile => [tile.id, tile]));
  links.value = edges.map(edge => {
    const sections = result.routes[edge.id]?.sections.map(points =>
      points.map(point => ({ ...point, y: point.y + HEADER_HEIGHT })));
    return { ...edge, relationType: relationTypeForEdge(edge), sections,
      ...(sections ? polylineGeometry(sections)
        : connectionGeometry(byId.get(edge.sourceTileId), byId.get(edge.targetTileId), { dimensions })) };
  });
  await nextTick();
  checkExportCancelled(signal);
  const rect = stage.value.getBoundingClientRect();
  let width = Math.max(...positions.value.map(tile => tile.x + tile.width)) + 48;
  let height = Math.max(...positions.value.map(tile => tile.y + tile.height)) + 48;
  for (const link of links.value) for (const point of link.sections?.flat() || []) {
    width = Math.max(width, point.x + 48);
    height = Math.max(height, point.y + 48);
  }
  for (const element of stage.value.querySelectorAll('[data-export-brand], [data-export-card], [data-export-relation]')) {
    const bounds = element.getBoundingClientRect();
    element.dataset.exportX = String(bounds.left - rect.left);
    element.dataset.exportY = String(bounds.top - rect.top);
    width = Math.max(width, bounds.right - rect.left + 48);
    height = Math.max(height, bounds.bottom - rect.top + 48);
  }
  // Read the shared canvas relation styles so PDF paths, arrows and captions
  // keep the same colors, including future palette changes.
  const captions = [...stage.value.querySelectorAll('[data-export-relation]')];
  const coloredLinks = links.value.map((link, index) => ({ ...link,
    color: getComputedStyle(captions[index]).color.match(/[\d.]+/g).slice(0, 3).map(Number) }));
  return { element: stage.value, positions: positions.value, links: coloredLinks,
    width: Math.ceil(width), height: Math.ceil(height) };
}
defineExpose({ prepare });
</script>

<template>
  <div ref="stage" class="graph-export-document graph-export-stage" aria-hidden="true" inert>
    <div data-export-brand class="graph-export-brand">
      <img src="/branding/aureli-logo.png" alt="Aureli" width="1194" height="260" />
    </div>
    <article v-for="tile in snapshot.tiles" :key="tile.id" data-export-card
      class="graph-export-card" :style="cardStyle(tile)">
      <span v-if="labelForTile(tile, snapshot.labels)" class="graph-export-label">{{ labelForTile(tile, snapshot.labels).name }}</span>
      <section>
        <h3>{{ kind(tile) === 'QA' ? '问题' : kind(tile) === 'NOTE' ? '便签' : '文件' }}</h3>
        <p class="graph-export-question">{{ tile.message || tile.title || tile.fileName }}</p>
      </section>
      <section>
        <h3>{{ kind(tile) === 'QA' ? '回答' : '正文' }}</h3>
        <MarkdownAnswer v-if="kind(tile) === 'QA'" :content="body(tile)" />
        <p v-else class="graph-export-plain">{{ body(tile) }}</p>
      </section>
    </article>
    <span v-for="link in links" :key="link.id" data-export-relation class="graph-export-relation"
      :data-relation-type="link.relationType"
      :style="{ left: `${link.x}px`, top: `${link.y}px` }">{{ link.relationType }}</span>
  </div>
</template>
