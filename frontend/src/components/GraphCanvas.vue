<script setup>
import { computed, ref, onMounted, onUnmounted, nextTick, watch } from "vue";
import {
  Plus,
  Minus,
  Maximize,
  Expand,
  Network,
  Check,
  ArrowUpRight,
  Trash2,
  StickyNote,
  FileText,
  Download,
  Pencil,
  ListTree,
  X,
} from "@lucide/vue";
import { arrangeTiles, connectionGeometry, positionTiles, TILE_HEIGHT } from "../lib/graph-layout.js";
import { useMotion } from "../composables/useMotion.js";
import ImageThumbnail from "./ImageThumbnail.vue";
import { isImageTile } from "../lib/image-preview.js";
const { animateSurface } = useMotion();
const zoom = defineModel("zoom", { type: Number, default: 1 });
const props = defineProps({
  tiles: Array,
  layout: { type: Object, default: () => ({}) },
  edges: Array,
  selected: String,
  related: Array,
  query: String,
  filter: String,
  busy: Boolean,
  loadFile: Function,
  markerId: { type: String, default: "arrow" },
});
const emit = defineEmits(["select", "toggle", "extend", "new", "expand", "delete", "move", "move-end", "arrange", "file", "download", "edit-note"]);
const nodeType = tile => tile.tileType || "QA";
const viewport = ref(null),
  dragging = ref(null),
  panning = ref(false),
  pan = ref({ x: 0, y: 0 });
const arrangeDialog = ref(null);
const positions = computed(() => positionTiles(props.tiles, props.layout));
const width = computed(() =>
  Math.max(620, ...positions.value.map((t) => t.x + t.width + 24)),
);
const height = computed(() =>
  Math.max(380, ...positions.value.map((t) => t.y + t.height + 24)),
);
const links = computed(() => {
  const byId = new Map(positions.value.map(tile => [tile.id, tile]));
  return props.edges.map(edge => {
    const source = byId.get(edge.sourceTileId), target = byId.get(edge.targetTileId);
    return source && target ? { ...edge, ...connectionGeometry(source, target) } : null;
  }).filter(Boolean);
});
let drag, dragFrame, suppressClick = false;
function startDrag(event, tile) {
  if (event.button !== 0 || !event.isPrimary || drag) return;
  suppressClick = false;
  if (event.target.closest('.node-expand, .node-bottom')) return;
  const world = viewport.value.querySelector('.graph-world');
  const bounds = world.getBoundingClientRect();
  const scale = bounds.width / world.offsetWidth;
  drag = {
    kind: 'tile',
    id: tile.id, pointerId: event.pointerId,
    element: event.target.closest('.node-main') || event.currentTarget,
    startX: event.clientX, startY: event.clientY,
    clientX: event.clientX, clientY: event.clientY,
    offsetX: (event.clientX - bounds.left) / scale - tile.x,
    offsetY: (event.clientY - bounds.top) / scale - tile.y,
    previous: props.layout[tile.id], active: false,
  };
  listenForDrag();
}
function startPan(event) {
  if (event.button !== 0 || !event.isPrimary || drag || !props.tiles.length) return;
  if (event.target.closest('.graph-node, button, input, textarea, select, a')) return;
  suppressClick = false;
  drag = {
    kind: 'canvas', pointerId: event.pointerId, element: viewport.value,
    startX: event.clientX, startY: event.clientY,
    clientX: event.clientX, clientY: event.clientY,
    previous: { ...pan.value },
    scrollLeft: viewport.value.scrollLeft, scrollTop: viewport.value.scrollTop,
    active: false,
  };
  viewport.value.focus({ preventScroll: true });
  listenForDrag();
}
function listenForDrag() {
  window.addEventListener('pointermove', moveDrag, { passive: false });
  window.addEventListener('pointerup', finishDrag);
  window.addEventListener('pointercancel', cancelDrag);
  window.addEventListener('blur', finishDrag);
  window.addEventListener('keydown', cancelWithEscape, true);
}
function moveDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.clientX = event.clientX;
  drag.clientY = event.clientY;
  if (!drag.active) {
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
    drag.active = true;
    dragging.value = drag.kind === 'tile' ? drag.id : null;
    panning.value = drag.kind === 'canvas';
    suppressClick = true;
    drag.element.setPointerCapture(drag.pointerId);
    dragFrame = requestAnimationFrame(updateDrag);
  }
  event.preventDefault();
}
function updatePosition() {
  if (drag?.kind === 'canvas') {
    // Pan in screen pixels, independently of zoom and existing scroll position.
    pan.value = {
      x: drag.previous.x + drag.clientX - drag.startX + viewport.value.scrollLeft - drag.scrollLeft,
      y: drag.previous.y + drag.clientY - drag.startY + viewport.value.scrollTop - drag.scrollTop,
    };
    return;
  }
  const world = viewport.value?.querySelector('.graph-world');
  if (!drag || !world) return;
  const bounds = world.getBoundingClientRect();
  const scale = bounds.width / world.offsetWidth;
  emit('move', { id: drag.id,
    x: Math.max(12, (drag.clientX - bounds.left) / scale - drag.offsetX),
    y: Math.max(12, (drag.clientY - bounds.top) / scale - drag.offsetY),
  });
}
function updateDrag() {
  if (!drag?.active) return;
  if (drag.kind === 'canvas') {
    updatePosition();
    dragFrame = requestAnimationFrame(updateDrag);
    return;
  }
  const element = viewport.value;
  const bounds = element.getBoundingClientRect();
  // Scroll near canvas edges while extending its space to follow the pointer.
  const speed = (value, min, max) => value < min + 36
    ? -Math.min(14, (min + 36 - value) / 3)
    : value > max - 36 ? Math.min(14, (value - max + 36) / 3) : 0;
  element.scrollLeft += speed(drag.clientX, bounds.left, bounds.right);
  element.scrollTop += speed(drag.clientY, bounds.top, bounds.bottom - 74);
  updatePosition();
  dragFrame = requestAnimationFrame(updateDrag);
}
function finishDrag(event, cancel = false) {
  if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
  if (drag.active && !cancel) {
    if (event?.type === 'pointerup') {
      drag.clientX = event.clientX;
      drag.clientY = event.clientY;
    }
    updatePosition();
  }
  const finished = drag;
  drag = null;
  dragging.value = null;
  panning.value = false;
  cancelAnimationFrame(dragFrame);
  window.removeEventListener('pointermove', moveDrag);
  window.removeEventListener('pointerup', finishDrag);
  window.removeEventListener('pointercancel', cancelDrag);
  window.removeEventListener('blur', finishDrag);
  window.removeEventListener('keydown', cancelWithEscape, true);
  if (finished.element.hasPointerCapture(finished.pointerId)) finished.element.releasePointerCapture(finished.pointerId);
  if (finished.active) {
    if (finished.kind === 'canvas') {
      if (cancel) {
        pan.value = finished.previous;
        nextTick(() => viewport.value?.scrollTo(finished.scrollLeft, finished.scrollTop));
      }
    } else {
      if (cancel) emit('move', { id: finished.id, ...finished.previous, reset: !finished.previous });
      emit('move-end');
    }
  }
}
function cancelDrag(event) { finishDrag(event, true); }
function cancelWithEscape(event) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  finishDrag(null, true);
}
function captureClick(event) {
  if (!suppressClick) return;
  suppressClick = false;
  event.preventDefault();
  event.stopPropagation();
}
function moveTile(id, dx, dy) {
  const tile = positions.value.find(tile => tile.id === id);
  if (!tile) return;
  emit('move', { id, x: Math.max(12, tile.x + dx), y: Math.max(12, tile.y + dy) });
  emit('move-end');
  nextTick(() => revealTile(id));
}
function keyboardMove(event, id) {
  const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (!event.altKey || !directions[event.key]) return;
  event.preventDefault();
  event.stopPropagation();
  const step = event.shiftKey ? 40 : 10;
  moveTile(id, ...directions[event.key].map(value => value * step));
}
function panCanvas(dx, dy) {
  if (drag) finishDrag();
  pan.value = { x: pan.value.x + dx, y: pan.value.y + dy };
}
function keyboardPan(event) {
  if (event.target !== viewport.value || event.altKey || event.ctrlKey || event.metaKey) return;
  const directions = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  if (!directions[event.key]) return;
  event.preventDefault();
  const step = event.shiftKey ? 120 : 40;
  panCanvas(...directions[event.key].map(value => value * step));
}
function matches(t) {
  return (
    (!props.query ||
      `${t.id} ${t.message} ${t.answer}`
        .toLowerCase()
        .includes(props.query.toLowerCase())) &&
    (props.filter === "all" ||
      (props.filter === "root"
        ? !t.relatedTileIds.length
        : props.filter === "related" ? t.relatedTileIds.length : nodeType(t) === props.filter))
  );
}
function fit() {
  if (viewport.value) {
    if (drag) finishDrag();
    pan.value = { x: 0, y: 0 };
    zoom.value = Math.min(
      1,
      Math.max(
        0.35,
        Math.min(
          (viewport.value.clientWidth - 16) / width.value,
          (viewport.value.clientHeight - 64) / height.value,
        ),
      ),
    );
    viewport.value.scrollTo(0, 0);
  }
}
function requestArrange() {
  if (props.busy || !props.tiles.length) return;
  if (!arrangeDialog.value.open) arrangeDialog.value.showModal();
}
function closeArrange() {
  arrangeDialog.value?.close();
}
async function arrange() {
  if (!arrangeDialog.value?.open || props.busy || !props.tiles.length) return;
  closeArrange();
  if (drag) finishDrag();
  emit('arrange', arrangeTiles(props.tiles, props.edges));
  await nextTick();
  fit();
}
function revealSelected() { revealTile(props.selected); }
function revealTile(id) {
  const tile = positions.value.find(tile => tile.id === id);
  const element = viewport.value;
  if (!tile || !element) return;
  const world = element.querySelector('.graph-world');
  if (!world) return;
  const bounds = world.getBoundingClientRect(), viewportBounds = element.getBoundingClientRect();
  const x = bounds.left - viewportBounds.left + element.scrollLeft + tile.x * zoom.value;
  const y = bounds.top - viewportBounds.top + element.scrollTop + tile.y * zoom.value;
  const cardWidth = tile.width * zoom.value, cardHeight = tile.height * zoom.value;
  // Keep the selected card readable and clear of the fixed canvas controls.
  const visibleHeight = element.clientHeight - 80;
  if (x < element.scrollLeft + 12 || x + cardWidth > element.scrollLeft + element.clientWidth - 12
      || y < element.scrollTop + 12 || y + cardHeight > element.scrollTop + visibleHeight - 12) {
    if (pan.value.x || pan.value.y) {
      pan.value = { x: 0, y: 0 };
      nextTick(() => revealTile(id));
      return;
    }
    element.scrollTo({
      left: Math.max(0, x - (element.clientWidth - cardWidth) / 2),
      top: Math.max(0, y - (visibleHeight - cardHeight) / 2),
      behavior: "instant",
    });
  }
}
watch(() => props.selected, () => nextTick(revealSelected));
function changeZoom(delta) {
  if (drag) finishDrag();
  zoom.value = Number(Math.min(1.5, Math.max(0.35, zoom.value + delta)).toFixed(6));
}
let observer;
onMounted(() => {
  observer = new ResizeObserver(revealSelected);
  observer.observe(viewport.value);
  revealSelected();
});
onUnmounted(() => {
  finishDrag();
  observer?.disconnect();
});
watch(
  () => props.tiles.length,
  async (count, previousCount) => {
    await nextTick();
    revealSelected();
    // Only a newly created Tile rises into place; restoring a graph stays still.
    if (count === previousCount + 1) {
      const index = props.tiles.findIndex(tile => tile.payload && tile.id === props.tiles.at(-1)?.id);
      if (index >= 0) animateSurface(viewport.value?.querySelectorAll('.graph-node')[index], { distance: 7, duration: 180 });
    }
  },
);
</script>

<template>
  <div class="graph-wrap" @dragover.prevent @drop.prevent="!busy && $event.dataTransfer.files[0] && emit('file', $event.dataTransfer.files[0])">
    <div
      ref="viewport"
      class="graph-viewport"
      :class="{ panning }"
      tabindex="0"
      aria-label="图谱画布，拖动空白处或用方向键平移"
      @pointerdown="startPan"
      @lostpointercapture="finishDrag"
      @click.capture="captureClick"
      @keydown="keyboardPan"
    >
      <div
        v-if="tiles.length"
        class="graph-space"
        :style="{ width: width * zoom + 'px', height: height * zoom + 'px', transform: `translate(${pan.x}px, ${pan.y}px)` }"
      >
        <div
          class="graph-world"
          :style="{
            width: width + 'px',
            height: height + 'px',
            transform: `scale(${zoom})`,
          }"
        >
          <svg class="edges" :width="width" :height="height" aria-hidden="true">
            <defs>
              <marker
                :id="markerId"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10" fill="currentColor" />
              </marker>
            </defs>
            <g v-for="e in links" :key="e.id">
              <path
                :d="e.path"
                fill="none"
                :marker-end="`url(#${markerId})`"
                :marker-start="
                  e.direction === 'UNDIRECTED' ? `url(#${markerId})` : undefined
                "
              />
              <text :x="e.x" :y="e.y" text-anchor="middle">
                {{ e.relationType }}
              </text>
            </g>
          </svg>
          <article
            v-for="tile in positions"
            :key="tile.id"
            class="graph-node"
            :class="[
              tile.kind,
              {
                selected: selected === tile.id,
                dragging: dragging === tile.id,
                associated: related.includes(tile.id),
                dimmed: !matches(tile),
                'weight-expanded': tile.height > TILE_HEIGHT,
                'has-image': isImageTile(tile),
              },
            ]"
            :style="{
              left: tile.x + 'px', top: tile.y + 'px',
              width: tile.width + 'px', height: tile.height + 'px',
              '--tile-extra-height': tile.height - TILE_HEIGHT + 'px',
              '--tile-question-lines': Number(tile.weight) === 3 ? 3 : 2,
              '--tile-answer-lines': Number(tile.weight) === 3 ? 13 : 5,
            }"
            @pointerdown="startDrag($event, tile)"
            @lostpointercapture="finishDrag"
          >
            <button
              class="node-expand"
              @click="emit('expand', tile.id)"
              :aria-label="`全页面查看 ${tile.id}`"
              title="全页面查看"
            >
              <Expand :size="13" />
            </button>
            <button
              class="node-main"
              title="拖动以移动 Tile；Alt + 方向键微调位置"
              @keydown="keyboardMove($event, tile.id)"
              @dragstart.prevent
              @click="emit('select', tile.id)"
              :aria-label="`查看 ${tile.id}：${tile.message}`"
              :aria-pressed="selected === tile.id"
            >
              <span class="node-top"
                ><span class="node-symbol"><StickyNote v-if="nodeType(tile) === 'NOTE'" :size="14" /><FileText v-else-if="nodeType(tile) === 'FILE'" :size="14" /><Network v-else :size="14" /></span
                ><span class="mono">{{ tile.id }}</span
                ><span class="node-status" :class="tile.status">{{
                  tile.status === "loading"
                    ? "生成中"
                    : tile.status === "error"
                      ? "失败"
                      : nodeType(tile) === "NOTE" ? "便签" : nodeType(tile) === "FILE" ? "文件" : "已完成"
                }}</span></span
              >
              <strong>{{ tile.message }}</strong
              >
              <ImageThumbnail v-if="isImageTile(tile) && loadFile" :tile="tile" :load-file="loadFile" />
              <span v-else class="node-answer">{{
                tile.answer || (nodeType(tile) === "QA" ? "正在生成回答…" : "已保存")
              }}</span>
            </button>
            <div class="node-bottom">
              <button
                @click="emit('toggle', tile.id)"
                :aria-pressed="related.includes(tile.id)"
                :disabled="busy || tile.status !== 'ready'"
              >
                <Check :size="13" v-if="related.includes(tile.id)" /><Plus
                  :size="13"
                  v-else
                />{{
                  related.includes(tile.id) ? "已关联" : "选择关联"
                }}</button
              ><button v-if="nodeType(tile) === 'FILE'" @click="emit('download', tile)" :disabled="busy">下载<Download :size="14" /></button>
              <button v-else-if="nodeType(tile) === 'NOTE'" @click="emit('edit-note', tile)" :disabled="busy">编辑<Pencil :size="14" /></button>
              <button v-else
                @click="emit('extend', tile.id)"
                :disabled="busy || tile.status !== 'ready'"
              >
                延伸<ArrowUpRight :size="14" />
              </button
              ><button
                class="node-delete-action"
                @click="emit('delete', tile)"
                :disabled="busy"
                :aria-label="`删除 ${tile.id}`"
                title="删除 Tile"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </article>
        </div>
      </div>
      <div v-else class="empty-graph">
        <span class="empty-icon"><Network :size="38" /></span>
        <h3>从一个问题，开始连接知识</h3>
        <p>创建你的第一个 Tile，再通过关联探索更多上下文。</p>
        <button class="primary" @click="emit('new')">
          <Plus :size="16" />创建第一个 Tile
        </button>
      </div>
    </div>
    <div class="canvas-controls">
      <button @click="changeZoom(-0.1)" aria-label="缩小图谱">
        <Minus :size="16" /></button
      ><span class="mono">{{ Math.round(zoom * 100) }}%</span
      ><button @click="changeZoom(0.1)" aria-label="放大图谱">
        <Plus :size="16" /></button
      ><i></i
      ><button @click="fit()" aria-label="适应画布">
        <Maximize :size="16" />
      </button>
      <button @click="requestArrange" :disabled="busy || !tiles.length" aria-label="一键整理画布" title="一键整理画布：按关联从左向右树状排列">
        <ListTree :size="16" aria-hidden="true" />
      </button>
    </div>
    <dialog
      ref="arrangeDialog"
      class="modal"
      :aria-labelledby="`${markerId}-arrange-title`"
      :aria-describedby="`${markerId}-arrange-description`"
      @cancel.stop.prevent="closeArrange"
    >
      <div class="modal-header">
        <h2 :id="`${markerId}-arrange-title`">整理画布？</h2>
        <button class="icon-button" @click="closeArrange" aria-label="关闭整理确认">
          <X :size="19" aria-hidden="true" />
        </button>
      </div>
      <div class="modal-body">
        <p :id="`${markerId}-arrange-description`">将按照关联顺序从左向右树状排列所有 Tile，并覆盖当前手动布局。是否继续？</p>
      </div>
      <div class="modal-actions">
        <button class="secondary" @click="closeArrange" autofocus>取消</button>
        <button class="primary" @click="arrange" :disabled="busy || !tiles.length">确认整理</button>
      </div>
    </dialog>
  </div>
</template>
