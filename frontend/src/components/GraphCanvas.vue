<script setup>
import { computed, ref, shallowRef, onMounted, onUnmounted, nextTick, watch } from "vue";
import {
  Plus,
  Minus,
  Maximize,
  LocateFixed,
  Expand,
  Network,
  Link2,
  Check,
  Trash2,
  Tag,
  MessageSquarePlus,
  ListTree,
  LoaderCircle,
  X,
} from "@lucide/vue";
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuPortal,
  ContextMenuContent,
  ContextMenuItem,
} from "reka-ui";
import { arrangeTiles, connectionGeometry, positionTiles, TILE_HEIGHT } from "../lib/graph-layout.js";
import { useMotion } from "../composables/useMotion.js";
import { relationTypeForEdge } from "../lib/tile-relations.js";
import { labelForTile, labelStyle } from "../lib/labels.js";
import { labelRegions } from "../lib/label-regions.js";
import { arrangeLayeredTiles, layoutSignature } from "../lib/layered-layout.js";
import { routeIsCurrent, polylineGeometry, rerouteConnection } from "../lib/graph-routing.js";
import ImageThumbnail from "./ImageThumbnail.vue";
import { isImageTile } from "../lib/image-preview.js";
import { createCanvasWheelClassifier } from "../lib/canvas-input.js";
const { animateSurface } = useMotion();
const zoom = defineModel("zoom", { type: Number, default: 1 });
const props = defineProps({
  tiles: Array,
  labels: { type: Array, default: () => [] },
  layout: { type: Object, default: () => ({}) },
  arrangement: { type: Object, default: () => ({ mode: 'tree', routes: {} }) },
  workspaceId: String,
  edges: Array,
  selected: String,
  related: Array,
  query: String,
  filter: String,
  busy: Boolean,
  loadFile: Function,
  markerId: { type: String, default: "arrow" },
});
const emit = defineEmits(["select", "toggle", "delete", "label", "extend-question", "create-question", "new", "expand", "move", "move-end", "arrange", "file"]);
const nodeType = tile => tile.tileType || "QA";
const relationTypes = ["RELATES", "EXTENDS", "FUSES", "DIVIDES"];
const viewport = ref(null),
  dragging = ref(null),
  panning = ref(false),
  wheelZooming = ref(false),
  pan = ref({ x: 0, y: 0 });
const viewportSize = ref({ width: 620, height: 380 });
const arrangeDialog = ref(null);
const canvas = ref(null), contextOpen = ref(false), contextTileId = ref(null);
const contextTile = computed(() => props.tiles.find(tile => tile.id === contextTileId.value));
let contextOrigin, skipContextFocus = false, contextOpenedAt = 0;
watch(contextOpen, open => { if (open) contextOpenedAt = performance.now(); }, { flush: 'sync' });
function closeContextOnScroll(event) {
  // Focus can queue a scroll event before the keyboard opens the menu.
  if (event.timeStamp >= contextOpenedAt) contextOpen.value = false;
}
function rememberContextTarget(event) {
  contextTileId.value = event.target.closest('.graph-node')?.dataset.tileId || null;
  contextOrigin = event.target.closest('.node-main, .node-expand, .node-relate') || viewport.value;
  skipContextFocus = false;
}
function prepareContextMenu(event) {
  rememberContextTarget(event);
  contextOpenedAt = performance.now();
  if (drag) finishDrag(null, true);
  suppressClick = false;
}
function keyboardContextMenu(event) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  event.preventDefault();
  event.stopPropagation();
  const bounds = event.target.getBoundingClientRect();
  event.target.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true,
    clientX: Math.max(12, Math.min(bounds.left + 24, innerWidth - 12)),
    clientY: Math.max(12, Math.min(bounds.top + 24, innerHeight - 12)),
  }));
}
function contextAction(action) {
  if (action === 'arrange') {
    if (props.busy || arranging.value || !props.tiles.length) return;
    skipContextFocus = true;
    contextOpen.value = false;
    requestArrange(contextOrigin);
    return;
  }
  if (action === 'center') {
    if (!props.tiles.length || arranging.value) return;
    contextOpen.value = false;
    centerCanvas();
    return;
  }
  const tile = contextTile.value;
  if (props.busy || arranging.value) return;
  if (action !== 'create-question' && !tile) return;
  if (['toggle', 'extend-question'].includes(action) && tile.status !== 'ready') return;
  skipContextFocus = action !== 'toggle';
  contextOpen.value = false;
  if (action === 'toggle') emit('toggle', tile.id);
  else if (action === 'delete') emit('delete', tile);
  else if (action === 'label') emit('label', tile);
  else if (action === 'extend-question') emit('extend-question', tile);
  else emit('create-question');
}
function restoreContextFocus(event) {
  event.preventDefault();
  if (!skipContextFocus && contextOrigin?.isConnected) contextOrigin.focus({ preventScroll: true });
}
function dismissContextWithEscape(event) {
  event.preventDefault();
  event.stopPropagation();
  contextOpen.value = false;
}
function preventSecondarySelection(event) {
  // Releasing a right-button drag over an item must not invoke its action.
  if (event.button !== 0) event.preventDefault();
}
watch(contextTile, tile => { if (contextTileId.value && !tile) contextOpen.value = false; });
const arrangeMode = ref('tree'), arranging = ref(false), arrangeError = ref('');
const focusedLabel = ref(null), regions = shallowRef([]);
let arrangementRequest = 0, arrangementController, arrangeOrigin;
const positions = computed(() => positionTiles(props.tiles, props.layout));
watch([positions, () => props.labels], () => {
  regions.value = labelRegions(positions.value, props.labels, regions.value);
  if (!props.labels.some(label => String(label.id) === focusedLabel.value)) focusedLabel.value = null;
}, { immediate: true, deep: true, flush: 'sync' });
const usedLabels = computed(() => props.labels.filter(label =>
  props.tiles.some(tile => tile.labelId != null && String(tile.labelId) === String(label.id))));
// Content bounds are only used to frame the graph; they never limit the camera.
const contentBounds = computed(() => {
  const items = [...positions.value, ...regions.value];
  if (!items.length) return { x: 0, y: 0, width: 620, height: 380 };
  const x = Math.min(...items.map(item => item.x - 24));
  const y = Math.min(...items.map(item => item.y - 24));
  return { x, y,
    width: Math.max(620, ...items.map(item => item.x + item.width + 24 - x)),
    height: Math.max(380, ...items.map(item => item.y + item.height + 24 - y)),
  };
});
const routeCache = new Map();
const links = computed(() => {
  const byId = new Map(positions.value.map(tile => [tile.id, tile]));
  const fingerprint = JSON.stringify(positions.value.map(({ id, x, y, width, height }) => [id, x, y, width, height]));
  const liveIds = new Set(props.edges.map(edge => edge.id));
  for (const id of routeCache.keys()) if (!liveIds.has(id)) routeCache.delete(id);
  return props.edges.map(edge => {
    const source = byId.get(edge.sourceTileId), target = byId.get(edge.targetTileId);
    if (!source || !target) return null;
    let geometry;
    if (props.arrangement.mode === 'layered') {
      const route = props.arrangement.routes?.[edge.id];
      if (routeIsCurrent(route, source, target, positions.value)) geometry = polylineGeometry(route.sections);
      else if (dragging.value) geometry = connectionGeometry(source, target);
      else {
        const key = JSON.stringify([fingerprint, source.id, target.id]);
        if (routeCache.get(edge.id)?.key !== key) routeCache.set(edge.id, {
          key, geometry: rerouteConnection(source, target, positions.value),
        });
        geometry = routeCache.get(edge.id).geometry;
      }
    } else geometry = connectionGeometry(source, target);
    return { ...edge, ...geometry, relationType: relationTypeForEdge(edge), dimmed: focusedLabel.value != null
      && String(source.labelId) !== focusedLabel.value && String(target.labelId) !== focusedLabel.value };
  }).filter(Boolean);
});
let drag, dragFrame, suppressClick = false;
function startDrag(event, tile) {
  if (event.button !== 0 || !event.isPrimary || drag || arranging.value) return;
  suppressClick = false;
  if (event.target.closest('.node-expand, .node-relate')) return;
  stopWheelGesture();
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
    previous: props.layout[tile.id], camera: { ...pan.value }, active: false,
  };
  listenForDrag();
}
function startPan(event) {
  if (event.button !== 0 || !event.isPrimary || drag || !props.tiles.length) return;
  if (event.target.closest('.graph-node, button, input, textarea, select, a')) return;
  stopWheelGesture();
  suppressClick = false;
  drag = {
    kind: 'canvas', pointerId: event.pointerId, element: viewport.value,
    startX: event.clientX, startY: event.clientY,
    clientX: event.clientX, clientY: event.clientY,
    previous: { ...pan.value },
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
    // The camera translates freely in screen pixels in every direction.
    pan.value = {
      x: drag.previous.x + drag.clientX - drag.startX,
      y: drag.previous.y + drag.clientY - drag.startY,
    };
    return;
  }
  const world = viewport.value?.querySelector('.graph-world');
  if (!drag || !world) return;
  const bounds = viewport.value.getBoundingClientRect();
  const scale = world.getBoundingClientRect().width / world.offsetWidth;
  emit('move', { id: drag.id,
    x: (drag.clientX - bounds.left - pan.value.x) / scale - drag.offsetX,
    y: (drag.clientY - bounds.top - pan.value.y) / scale - drag.offsetY,
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
  // Move the camera near any edge; Tile coordinates can cross the origin.
  const speed = (value, min, max) => value < min + 36
    ? -Math.min(14, (min + 36 - value) / 3)
    : value > max - 36 ? Math.min(14, (value - max + 36) / 3) : 0;
  pan.value = {
    x: pan.value.x - speed(drag.clientX, bounds.left, bounds.right),
    y: pan.value.y - speed(drag.clientY, bounds.top, bounds.bottom - 74),
  };
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
      }
    } else {
      if (cancel) {
        pan.value = finished.camera;
        emit('move', { id: finished.id, ...finished.previous, reset: !finished.previous });
      }
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
  emit('move', { id, x: tile.x + dx, y: tile.y + dy });
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
    stopWheelGesture();
    if (drag) finishDrag();
    const bounds = contentBounds.value;
    const fittedZoom = Math.min(
      1,
      Math.max(
        0.35,
        Math.min(
          (viewport.value.clientWidth - 16) / bounds.width,
          (viewport.value.clientHeight - 80) / bounds.height,
        ),
      ),
    );
    zoom.value = fittedZoom;
    pan.value = { x: -bounds.x * fittedZoom, y: -bounds.y * fittedZoom };
  }
}
function centerCanvas() {
  if (!viewport.value || !positions.value.length) return;
  stopWheelGesture();
  if (drag) finishDrag();
  const items = [...positions.value, ...regions.value];
  const centerX = (Math.min(...items.map(item => item.x)) + Math.max(...items.map(item => item.x + item.width))) / 2;
  const centerY = (Math.min(...items.map(item => item.y)) + Math.max(...items.map(item => item.y + item.height))) / 2;
  pan.value = {
    x: viewport.value.clientWidth / 2 - centerX * zoom.value,
    y: (viewport.value.clientHeight - 80) / 2 - centerY * zoom.value,
  };
}
function requestArrange(origin = document.activeElement) {
  if (props.busy || !props.tiles.length) return;
  arrangeOrigin = origin;
  arrangeMode.value = props.arrangement.mode === 'layered' ? 'layered' : 'tree';
  arrangeError.value = '';
  if (!arrangeDialog.value.open) arrangeDialog.value.showModal();
}
function closeArrange() {
  ++arrangementRequest;
  arrangementController?.abort();
  arrangementController = null;
  arranging.value = false;
  arrangeDialog.value?.close();
  nextTick(() => {
    if (!arrangeDialog.value?.open && arrangeOrigin?.isConnected) arrangeOrigin.focus({ preventScroll: true });
  });
}
async function arrange() {
  if (!arrangeDialog.value?.open || props.busy || arranging.value || !props.tiles.length) return;
  if (drag) finishDrag();
  const request = ++arrangementRequest, workspace = props.workspaceId;
  const signature = layoutSignature(props.tiles, props.edges, props.labels), mode = arrangeMode.value;
  const controller = new AbortController();
  arrangementController = controller;
  arranging.value = true;
  arrangeError.value = '';
  try {
    const result = mode === 'layered'
      ? await arrangeLayeredTiles(props.tiles, props.edges, props.labels, { signal: controller.signal })
      : { positions: arrangeTiles(props.tiles, props.edges), routes: {} };
    if (request !== arrangementRequest || workspace !== props.workspaceId || !arrangeDialog.value?.open) return;
    if (props.busy || signature !== layoutSignature(props.tiles, props.edges, props.labels)) {
      arrangeError.value = '图谱已发生变化，请重新整理。';
      return;
    }
    emit('arrange', { ...result, mode });
    closeArrange();
    await nextTick();
    fit();
  } catch (error) {
    if (request === arrangementRequest && error.name !== 'AbortError') {
      arrangeError.value = '整理失败，当前布局已保留。' + (error.message || '请重试。');
    }
  } finally {
    if (request === arrangementRequest) { arranging.value = false; arrangementController = null; }
  }
}
watch(() => props.workspaceId, () => {
  stopWheelGesture();
  contextOpen.value = false;
  contextTileId.value = null;
  closeArrange(); focusedLabel.value = null; routeCache.clear();
});
function toggleLabel(id) {
  const key = String(id);
  focusedLabel.value = focusedLabel.value === key ? null : key;
}
function revealSelected() { revealTile(props.selected); }
function revealFocusedTile(event) {
  const id = event.target.closest('.graph-node')?.dataset.tileId;
  if (id && !drag && event.target.matches(':focus-visible')) nextTick(() => revealTile(id));
}
function revealTile(id) {
  const tile = positions.value.find(tile => tile.id === id);
  const element = viewport.value;
  if (!tile || !element) return;
  const world = element.querySelector('.graph-world');
  if (!world) return;
  const bounds = world.getBoundingClientRect(), viewportBounds = element.getBoundingClientRect();
  const scale = bounds.width / world.offsetWidth;
  const x = bounds.left - viewportBounds.left + tile.x * scale;
  const y = bounds.top - viewportBounds.top + tile.y * scale;
  const cardWidth = tile.width * scale, cardHeight = tile.height * scale;
  // Keep the selected card readable and clear of the fixed canvas controls.
  const visibleHeight = element.clientHeight - 80;
  if (x < 12 || x + cardWidth > element.clientWidth - 12 || y < 12 || y + cardHeight > visibleHeight - 12) {
    pan.value = {
      x: pan.value.x + (element.clientWidth - cardWidth) / 2 - x,
      y: pan.value.y + (visibleHeight - cardHeight) / 2 - y,
    };
  }
}
watch(() => props.selected, () => nextTick(revealSelected));
function changeZoom(delta) {
  stopWheelGesture();
  if (drag) finishDrag();
  zoom.value = clampZoom(zoom.value + delta);
}
const clampZoom = value => Number(Math.min(1.5, Math.max(0.35, value)).toFixed(6));
const wheelClassifier = createCanvasWheelClassifier();
let wheelFrame, wheelTimer, wheelDelta = 0, wheelPoint, wheelRevision = 0;
let wheelPan = { x: 0, y: 0 };
function stopWheelGesture() {
  cancelAnimationFrame(wheelFrame);
  clearTimeout(wheelTimer);
  wheelFrame = null;
  wheelDelta = 0;
  wheelPan = { x: 0, y: 0 };
  wheelClassifier.reset();
  wheelRevision++;
  wheelZooming.value = false;
}
function wheelGesture(event) {
  if (!props.tiles.length || !Number.isFinite(event.deltaX) || !Number.isFinite(event.deltaY)
      || (!event.deltaX && !event.deltaY)) return;
  event.preventDefault();
  if (drag) return;
  contextOpen.value = false;
  if (wheelClassifier.classify(event) === 'pan') {
    wheelPan.x -= event.deltaX;
    wheelPan.y -= event.deltaY;
  } else {
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.value.clientHeight : 1;
    const sensitivity = event.ctrlKey ? 0.01 : 0.0015;
    wheelDelta += Math.max(-120, Math.min(120, event.deltaY * unit)) * sensitivity;
  }
  wheelPoint = { x: event.clientX, y: event.clientY };
  wheelZooming.value = true;
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => { wheelZooming.value = false; }, 180);
  if (!wheelFrame) wheelFrame = requestAnimationFrame(applyWheelGesture);
}
async function applyWheelGesture() {
  wheelFrame = null;
  const delta = wheelDelta, point = wheelPoint, revision = wheelRevision;
  wheelDelta = 0;
  const movement = wheelPan;
  wheelPan = { x: 0, y: 0 };
  if (movement.x || movement.y) {
    pan.value = { x: pan.value.x + movement.x, y: pan.value.y + movement.y };
    if (!delta) return;
    await nextTick();
    if (revision !== wheelRevision) return;
  }
  const world = viewport.value?.querySelector('.graph-world');
  if (!world) return;
  const nextZoom = clampZoom(zoom.value * Math.exp(-delta));
  if (nextZoom === zoom.value) return;
  const bounds = world.getBoundingClientRect(), scale = bounds.width / world.offsetWidth;
  const anchor = { x: (point.x - bounds.left) / scale, y: (point.y - bounds.top) / scale };
  zoom.value = nextZoom;
  await nextTick();
  if (revision !== wheelRevision || !world.isConnected) return;
  const current = world.getBoundingClientRect();
  pan.value = {
    x: pan.value.x + point.x - (current.left + anchor.x * nextZoom),
    y: pan.value.y + point.y - (current.top + anchor.y * nextZoom),
  };
}
let observer;
function resizeViewport() {
  const element = viewport.value;
  viewportSize.value = { width: element.clientWidth, height: element.clientHeight };
  nextTick(revealSelected);
}
onMounted(() => {
  observer = new ResizeObserver(resizeViewport);
  observer.observe(viewport.value);
  resizeViewport();
});
onUnmounted(() => {
  stopWheelGesture();
  closeArrange();
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
  <div ref="canvas" class="graph-wrap" @dragover.prevent @drop.prevent="!busy && $event.dataTransfer.files[0] && emit('file', $event.dataTransfer.files[0])">
    <ContextMenuRoot v-model:open="contextOpen" :modal="false">
    <ContextMenuTrigger as-child>
    <div
      ref="viewport"
      class="graph-viewport"
      :class="{ panning, 'wheel-zooming': wheelZooming }"
      tabindex="0"
      aria-label="图谱画布，触控板双指滑动平移、捏合缩放；鼠标滚轮缩放；拖动空白处或用方向键平移；右键或 Shift+F10 打开快捷菜单"
      title="触控板：双指滑动平移、捏合缩放；鼠标：滚轮缩放、拖动空白处平移"
      @wheel="wheelGesture"
      @pointerdown="startPan"
      @lostpointercapture="finishDrag"
      @click.capture="captureClick"
      @keydown="keyboardPan"
      @focusin="revealFocusedTile"
      @keydown.capture="keyboardContextMenu"
      @pointerdown.capture="rememberContextTarget"
      @contextmenu.capture="prepareContextMenu"
      @scroll="closeContextOnScroll"
    >
      <div
        v-if="tiles.length"
        class="graph-space"
        :style="{ transform: `translate(${pan.x}px, ${pan.y}px)` }"
      >
        <div
          class="graph-world"
          :style="{
            width: viewportSize.width + 'px',
            height: viewportSize.height + 'px',
            transform: `scale(${zoom})`,
          }"
        >
          <div v-for="region in regions" :key="region.key" class="graph-label-region"
            :style="{ ...labelStyle(region.label), left: region.x + 'px', top: region.y + 'px', width: region.width + 'px', height: region.height + 'px' }"
            :class="{ 'label-region-dimmed': focusedLabel != null && String(region.label.id) !== focusedLabel }"
            aria-hidden="true">
            <span class="graph-label-region-caption" :class="{ 'caption-below': region.captionBelow }">
              {{ region.label.name }} · {{ region.tileIds.length }} 张<span v-if="region.total > region.tileIds.length"> / 共 {{ region.total }} 张</span>
            </span>
          </div>
          <svg class="edges" width="100%" height="100%" aria-hidden="true">
            <defs>
              <marker
                v-for="relationType in relationTypes"
                :key="relationType"
                :id="`${markerId}-${relationType}`"
                :data-relation-type="relationType"
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
            <g v-for="e in links" :key="e.id" :data-relation-type="e.relationType" :class="{ 'label-link-dimmed': e.dimmed }">
              <path
                :d="e.path"
                fill="none"
                :marker-end="`url(#${markerId}-${e.relationType})`"
                :marker-start="
                  e.direction === 'UNDIRECTED' ? `url(#${markerId}-${e.relationType})` : undefined
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
            :data-tile-id="tile.id"
            :class="[
              tile.kind,
              {
                'tile-label-surface': !!labelForTile(tile, labels),
                selected: selected === tile.id,
                dragging: dragging === tile.id,
                associated: related.includes(tile.id),
                dimmed: !matches(tile),
                'label-dimmed': focusedLabel != null && String(tile.labelId) !== focusedLabel,
                'label-focused': focusedLabel != null && String(tile.labelId) === focusedLabel,
                'weight-expanded': tile.height > TILE_HEIGHT,
                'has-image': isImageTile(tile),
              },
            ]"
            :style="{
              ...labelStyle(labelForTile(tile, labels)),
              left: tile.x + 'px', top: tile.y + 'px',
              width: tile.width + 'px', height: tile.height + 'px',
              '--tile-question-lines': Number(tile.weight) === 3 ? 3 : Number(tile.weight) === 2 ? 2 : 1,
              '--tile-answer-lines': (Number(tile.weight) === 3 ? 15 : Number(tile.weight) === 2 ? 7 : 4)
                - (labelForTile(tile, labels) ? 1 : 0),
            }"
            @pointerdown="startDrag($event, tile)"
            @lostpointercapture="finishDrag"
          >
            <button
              class="node-relate"
              :disabled="busy || arranging || tile.status !== 'ready'"
              :aria-pressed="related.includes(tile.id)"
              :aria-label="`${related.includes(tile.id) ? '取消关联' : '关联节点'} ${tile.id}`"
              :title="related.includes(tile.id) ? '取消关联' : '关联节点'"
              @click="emit('toggle', tile.id)"
            >
              <Check v-if="related.includes(tile.id)" :size="15" />
              <Link2 v-else :size="15" />
            </button>
            <button
              class="node-expand"
              @click="emit('expand', tile.id)"
              :aria-label="`全页面查看 ${tile.id}`"
              title="全页面查看"
            >
              <Expand :size="15" />
            </button>
            <button
              class="node-main"
              title="拖动以移动 Tile；触控板双指平移、捏合缩放；鼠标滚轮缩放；右键打开快捷菜单；Alt + 方向键微调位置"
              @keydown="keyboardMove($event, tile.id)"
              @dragstart.prevent
              @click="emit('select', tile.id)"
              :aria-label="`查看 ${tile.id}：${tile.message}`"
              :aria-pressed="selected === tile.id"
            >
              <span class="node-top">
                <span class="node-status" :class="tile.status">{{
                  tile.status === "loading"
                    ? "生成中"
                    : tile.status === "error"
                      ? "失败"
                      : nodeType(tile) === "NOTE" ? "便签" : nodeType(tile) === "FILE" ? "文件" : "已完成"
                }}</span>
              </span>
              <small v-if="labelForTile(tile, labels)" class="tile-label-badge" :title="labelForTile(tile, labels).name">{{ labelForTile(tile, labels).name }}</small>
              <strong>{{ tile.message }}</strong
              >
              <ImageThumbnail v-if="isImageTile(tile) && loadFile" :tile="tile" :load-file="loadFile" />
              <span v-else class="node-answer">{{
                tile.answer || (nodeType(tile) === "QA" ? "正在生成回答…" : "已保存")
              }}</span>
            </button>
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
    </ContextMenuTrigger>
    <ContextMenuPortal :to="canvas">
      <ContextMenuContent
        class="graph-context-menu"
        :aria-label="contextTile ? '节点快捷操作' : '画布快捷操作'"
        :collision-padding="12"
        loop
        @close-auto-focus="restoreContextFocus"
        @interact-outside="skipContextFocus = true"
        @escape-key-down="dismissContextWithEscape"
        @pointerup.capture="preventSecondarySelection"
        @contextmenu.prevent
      >
        <template v-if="contextTile">
          <ContextMenuItem class="graph-context-item" :disabled="busy || arranging || contextTile.status !== 'ready'" @select="contextAction('toggle')">
            <Check v-if="related.includes(contextTile.id)" :size="16" aria-hidden="true" />
            <Link2 v-else :size="16" aria-hidden="true" />
            {{ related.includes(contextTile.id) ? '取消关联' : '关联节点' }}
          </ContextMenuItem>
          <ContextMenuItem class="graph-context-item is-destructive" :disabled="busy || arranging" @select="contextAction('delete')">
            <Trash2 :size="16" aria-hidden="true" />删除节点
          </ContextMenuItem>
          <ContextMenuItem class="graph-context-item" :disabled="busy || arranging" @select="contextAction('label')">
            <Tag :size="16" aria-hidden="true" />标签
          </ContextMenuItem>
          <ContextMenuItem class="graph-context-item" :disabled="busy || arranging || contextTile.status !== 'ready'" @select="contextAction('extend-question')">
            <MessageSquarePlus :size="16" aria-hidden="true" />从此处延伸问答Tile
          </ContextMenuItem>
        </template>
        <template v-else>
          <ContextMenuItem class="graph-context-item" :disabled="!tiles.length || arranging" @select="contextAction('center')">
            <LocateFixed :size="16" aria-hidden="true" />回到中心
          </ContextMenuItem>
          <ContextMenuItem class="graph-context-item" :disabled="busy || arranging || !tiles.length" @select="contextAction('arrange')">
            <ListTree :size="16" aria-hidden="true" />整理画布
          </ContextMenuItem>
        </template>
        <ContextMenuItem class="graph-context-item" :disabled="busy || arranging" @select="contextAction('create-question')">
          <MessageSquarePlus :size="16" aria-hidden="true" />添加问答 Tile
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuPortal>
    </ContextMenuRoot>
    <div v-if="usedLabels.length" class="canvas-label-focus" role="group" aria-label="聚焦标签">
      <button v-for="label in usedLabels" :key="label.id" type="button" :style="labelStyle(label)"
        :aria-pressed="focusedLabel === String(label.id)" :title="`高亮所有「${label.name}」Tile，再次点击取消`"
        @click="toggleLabel(label.id)"><span aria-hidden="true"></span>{{ label.name }}</button>
      <button v-if="focusedLabel != null" type="button" class="clear-label-focus" @click="focusedLabel = null" aria-label="清除标签聚焦"><X :size="14" /></button>
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
      <button @click="requestArrange()" :disabled="busy || arranging || !tiles.length" aria-label="一键整理画布" title="整理画布：选择树状或 Layered 排列">
        <ListTree :size="16" aria-hidden="true" />
      </button>
    </div>
    <dialog
      ref="arrangeDialog"
      class="modal arrange-modal"
      :aria-labelledby="`${markerId}-arrange-title`"
      :aria-describedby="`${markerId}-arrange-description`"
      @cancel.stop.prevent="closeArrange"
    >
      <div class="modal-header">
        <h2 :id="`${markerId}-arrange-title`">整理画布</h2>
        <button class="icon-button" @click="closeArrange" aria-label="关闭排列选择">
          <X :size="19" aria-hidden="true" />
        </button>
      </div>
      <div class="modal-body">
        <p :id="`${markerId}-arrange-description`" class="arrange-description">选择一种排列方式，整理后仍可自由拖动 Tile。</p>
        <fieldset class="arrange-options" :disabled="arranging || busy">
          <legend class="sr-only">排列方式</legend>
          <label class="arrange-option" :class="{ chosen: arrangeMode === 'tree' }">
            <input v-model="arrangeMode" type="radio" :name="`${markerId}-arrange-mode`" value="tree" aria-label="树状排列" />
            <ListTree :size="28" aria-hidden="true" />
            <span><strong>树状排列</strong><small>按关联从左向右展开分支，适合阅读推演过程。</small></span>
          </label>
          <label class="arrange-option" :class="{ chosen: arrangeMode === 'layered' }">
            <input v-model="arrangeMode" type="radio" :name="`${markerId}-arrange-mode`" value="layered" aria-label="Layered 排列" />
            <Network :size="28" aria-hidden="true" />
            <span><strong>Layered 排列<span class="arrange-badge">标签优先</span></strong><small>同标签集中分区，按关联分层排列，减少连线交叉。</small></span>
          </label>
        </fieldset>
        <p v-if="arrangeMode === 'layered' && !usedLabels.length" class="field-help">当前没有已标记的 Tile，将按关联分层排列。</p>
        <p class="arrange-layout-note">将覆盖当前手动布局。标签分区框随 Tile 位置调整；拖散后拆分或隐藏，标签保持不变。</p>
        <p v-if="arranging" class="arrange-progress" role="status"><LoaderCircle :size="16" aria-hidden="true" />正在整理，可随时取消…</p>
        <p v-if="arrangeError" class="inline-error" role="alert">{{ arrangeError }}</p>
      </div>
      <div class="modal-actions">
        <button class="secondary" @click="closeArrange" autofocus>取消</button>
        <button class="primary" @click="arrange" :disabled="busy || arranging || !tiles.length">{{ arranging ? '整理中…' : '开始整理' }}</button>
      </div>
    </dialog>
  </div>
</template>

<style>
.graph-context-menu {
  z-index: 70;
  min-width: 190px;
  max-width: calc(100vw - 24px);
  max-height: var(--reka-context-menu-content-available-height);
  overflow-y: auto;
  padding: 5px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--surface);
  box-shadow: 0 6px 20px rgb(16 16 16 / 12%);
}
.graph-context-item {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 40px;
  padding: 0 10px;
  border-radius: 5px;
  color: var(--blue-ink);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  outline: none;
  user-select: none;
}
.graph-context-item[data-highlighted] { background: var(--yellow-soft); }
.graph-context-item.is-destructive { color: var(--danger); }
.graph-context-item[data-disabled] { opacity: .45; cursor: default; }
</style>
