<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { connectionGeometry } from '../../frontend/src/lib/graph-layout.js';
const props = defineProps({ nodes: Array, edges: Array, selected: String, roots: Array, audit: Array, busy: Boolean });
const emit = defineEmits(['select', 'toggle', 'move']);
const viewport = ref(null), zoom = ref(1), pan = ref({ x: 30, y: 30 }), draft = ref({});
let gesture, observer;
const positioned = computed(() => props.nodes.map(node => ({ ...node, width: 260, height: 180, ...draft.value[node.id] })));
const byId = computed(() => new Map(positioned.value.map(node => [node.id, node])));
const status = computed(() => new Map((props.audit ?? []).map(node => [node.id, node])));
const lines = computed(() => props.edges.flatMap(edge => {
  const source = byId.value.get(edge.source), target = byId.value.get(edge.target);
  return source && target ? [{ ...edge, path: connectionGeometry(source, target).path }] : [];
}));
function fit() {
  if (!positioned.value.length || !viewport.value) return;
  const nodes = positioned.value;
  const left = Math.min(...nodes.map(n => n.x)), top = Math.min(...nodes.map(n => n.y));
  const width = Math.max(...nodes.map(n => n.x + 260)) - left;
  const height = Math.max(...nodes.map(n => n.y + 180)) - top;
  zoom.value = Math.min(1, Math.max(.25, Math.min((viewport.value.clientWidth - 70) / width, (viewport.value.clientHeight - 70) / height)));
  pan.value = { x: (viewport.value.clientWidth - width * zoom.value) / 2 - left * zoom.value,
    y: (viewport.value.clientHeight - height * zoom.value) / 2 - top * zoom.value };
}
function setZoom(value, x = viewport.value.clientWidth / 2, y = viewport.value.clientHeight / 2) {
  const next = Math.max(.25, Math.min(1.75, value)), ratio = next / zoom.value;
  pan.value = { x: x - (x - pan.value.x) * ratio, y: y - (y - pan.value.y) * ratio }; zoom.value = next;
}
function wheel(event) {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    const rect = viewport.value.getBoundingClientRect();
    setZoom(zoom.value * Math.exp(-event.deltaY * .008), event.clientX - rect.left, event.clientY - rect.top);
  } else pan.value = { x: pan.value.x - event.deltaX, y: pan.value.y - event.deltaY };
}
function down(event, node) {
  if (props.busy || event.button !== 0 || event.target.closest('button,input,textarea')) return;
  if (!node && event.target.closest('.node')) return;
  event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
  gesture = { id: node?.id, startX: event.clientX, startY: event.clientY, x: node?.x ?? pan.value.x,
    y: node?.y ?? pan.value.y, moved: false };
}
function move(event) {
  if (!gesture) return;
  const dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY;
  if (Math.hypot(dx, dy) < 4 && !gesture.moved) return;
  gesture.moved = true;
  if (gesture.id) draft.value = { ...draft.value, [gesture.id]: { x: gesture.x + dx / zoom.value, y: gesture.y + dy / zoom.value } };
  else pan.value = { x: gesture.x + dx, y: gesture.y + dy };
}
function up(event) {
  if (!gesture) return;
  if (gesture.id) {
    if (gesture.moved) emit('move', { id: gesture.id, ...draft.value[gesture.id] });
    else emit('select', gesture.id);
  }
  gesture = null;
}
function keyMove(event, node) {
  const directions = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] };
  if (!event.altKey || !directions[event.key] || props.busy) return;
  event.preventDefault(); const [dx, dy] = directions[event.key];
  emit('move', { id: node.id, x: node.x + dx, y: node.y + dy });
}
function clearDraft() { draft.value = {}; }
onMounted(() => { observer = new ResizeObserver(() => { if (zoom.value === 1 && pan.value.x === 30) fit(); }); observer.observe(viewport.value); });
onUnmounted(() => observer?.disconnect());
defineExpose({ fit, clearDraft });
</script>
<template>
  <section class="canvas-shell" aria-label="图谱画布">
    <div ref="viewport" class="canvas-viewport" @wheel="wheel" @pointerdown="down($event)" @pointermove="move" @pointerup="up" @pointercancel="gesture = null">
      <div class="canvas-world" :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }">
        <svg class="connections" aria-hidden="true"><defs><marker id="aureli-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
          <path v-for="edge in lines" :key="edge.id" :d="edge.path" :marker-end="edge.direction === 'DIRECTED' ? 'url(#aureli-arrow)' : undefined" :class="{ bilateral: edge.direction === 'UNDIRECTED' }" />
        </svg>
        <article v-for="node in positioned" :key="node.id" :data-node-id="node.id" class="node"
          :class="[status.get(node.id)?.state, { selected: selected === node.id, direct: roots.includes(node.id) }]"
          :style="{ left: `${node.x}px`, top: `${node.y}px` }"
          @pointerdown.stop="down($event, node)" @pointermove.stop="move" @pointerup.stop="up" @keydown="keyMove($event, node)">
          <div class="node-top"><span>{{ node.kind === 'QA' ? '推演' : '便签' }}</span><span>{{ roots.includes(node.id) ? '直接来源' : status.get(node.id)?.state === 'included' ? '追溯来源' : status.get(node.id)?.state === 'excluded' ? '已排除' : status.get(node.id)?.state === 'budget' ? '超出预算' : '未选入' }}</span></div>
          <button class="node-read" :aria-label="`查看 ${node.title}`" @click="emit('select', node.id)"><strong>{{ node.title }}</strong><span>{{ node.content }}</span></button>
          <div class="node-bottom"><span>{{ node.weight === 3 ? '非常重要' : node.weight === 2 ? '重要' : '普通' }}</span>
            <button class="source-toggle" :disabled="busy" :aria-pressed="roots.includes(node.id)" :aria-label="`${roots.includes(node.id) ? '取消来源' : '选择来源'} ${node.title}`" @click="emit('toggle', node.id)">{{ roots.includes(node.id) ? '✓ 已选来源' : '＋ 作为来源' }}</button></div>
        </article>
      </div>
      <div v-if="!nodes.length" class="empty-canvas"><span class="empty-symbol" aria-hidden="true">＋</span><h2>从一个想法开始</h2><p>在当前对话中推演，或加载一组实验节点。<br>选择来源后，右侧会展示真正送出的上下文。</p></div>
    </div>
    <div class="canvas-footer">
      <div class="zoom-tools"><button aria-label="缩小画布" @click="setZoom(zoom / 1.15)">−</button><span>{{ Math.round(zoom * 100) }}%</span><button aria-label="放大画布" @click="setZoom(zoom * 1.15)">＋</button><button aria-label="适应画布" @click="fit">适应</button></div></div>
  </section>
</template>
