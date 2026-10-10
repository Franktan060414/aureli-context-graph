<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { Check, FileText, GitBranch, LoaderCircle, Menu, PanelLeftClose, PanelLeftOpen, Send, StickyNote, Upload, X } from "@lucide/vue";
import MarkdownAnswer from "./MarkdownAnswer.vue";
import ViewSelect from "./ViewSelect.vue";
import { branchRowPresentation, branchRows } from "../lib/branch-layout.js";

const props = defineProps({
  tiles: { type: Array, default: () => [] },
  edges: { type: Array, default: () => [] },
  related: { type: Array, default: () => [] },
  activeTileId: { type: String, default: null },
  busy: Boolean,
  loading: Boolean,
  generating: Boolean,
  planning: Boolean,
  error: { type: String, default: "" },
  retryTile: { type: Object, default: null },
  motionEnabled: { type: Boolean, default: true },
  mobile: Boolean,
  navigationOpen: Boolean,
});
const message = defineModel("message", { type: String, default: "" });
const view = defineModel("view", { type: String, default: "branch" });
const collapsed = defineModel("collapsed", { type: Array, default: () => [] });
const emit = defineEmits(["toggle", "submit", "retry", "file", "note", "navigation", "cancel"]);
const viewportWidth = ref(0);
const compactComposer = computed(() => viewportWidth.value < 720);
const rows = computed(() => branchRows(props.tiles, props.edges).map(row => ({
  ...row,
  ...branchRowPresentation(row.tiles, collapsed.value, viewportWidth.value),
})));
const tileById = computed(() => new Map(props.tiles.map(tile => [tile.id, tile])));
const scroll = ref(null), input = ref(null), composer = ref(null);
const composerHeight = ref(62);
const reflowing = ref(false);
let resizeObserver;
const layoutAnimations = new Set();
let layoutRevision = 0;
let followBottom = false, followTileId = null;
let lastScrollTop = 0, followedScrollTop = null;
const type = tile => tile.tileType || "QA";
const title = tile => tile.title || tile.message || tile.fileName || tile.id;
const selectable = tile => !props.busy && tile.status === "ready";
const ancestryById = computed(() => {
  const parents = new Map(props.tiles.map(tile => [tile.id, new Set(tile.relatedTileIds || [])]));
  props.edges.forEach(edge => {
    if (edge.direction !== "UNDIRECTED" && edge.relationType !== "RELATES")
      parents.get(edge.targetTileId)?.add(edge.sourceTileId);
  });
  return new Map([...parents].map(([id, sourceIds]) => [id,
    [...sourceIds].map(source => tileById.value.get(source)).filter(Boolean).map(title).join(" · "),
  ]));
});
function toggle(tile, event) {
  if (!selectable(tile) || event.target.closest("a, button, input, textarea, select")) return;
  // Selecting/copying an answer should not also change its context selection.
  if (event.type === "click" && window.getSelection()?.toString()) return;
  emit("toggle", tile.id);
}
function keyToggle(tile, event) {
  if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  toggle(tile, event);
}
function finishLayoutMotion() {
  layoutAnimations.forEach(animation => animation.cancel());
  layoutAnimations.clear();
  reflowing.value = false;
}
async function toggleCollapsed(tile, row, event) {
  const wasCollapsed = row.collapsedIds.includes(tile.id);
  if (!wasCollapsed && row.expandedCount <= 1) return;
  const button = event.currentTarget;
  const rowElement = button.closest(".branch-row");
  const rowBottom = rowElement.getBoundingClientRect().bottom;
  // Read the current visual rectangles before cancelling an interrupted motion.
  const before = new Map([...scroll.value.querySelectorAll(".branch-tile-cell")]
    .map(el => [el.dataset.layoutId, el.getBoundingClientRect()]));
  finishLayoutMotion();
  reflowing.value = true;
  const revision = ++layoutRevision;
  const valid = new Set(rows.value.flatMap(item => item.collapsedIds));
  wasCollapsed ? valid.delete(tile.id) : valid.add(tile.id);
  collapsed.value = [...valid];
  followBottom = false;
  await nextTick();
  if (revision !== layoutRevision || !scroll.value) return;
  // Width changes also change line wrapping and row height. Anchor this row's
  // footer, rather than leaving the reader at the old absolute scroll offset.
  setFollowScroll(Math.round(scroll.value.scrollTop + rowElement.getBoundingClientRect().bottom - rowBottom));
  // Reordering keyed Tiles keeps their button focus; don't move the reader's scroll.
  button.focus({ preventScroll: true });
  if (!props.motionEnabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    reflowing.value = false;
    return;
  }
  const easing = getComputedStyle(rowElement).getPropertyValue("--ease-panel").trim();
  const running = [];
  const play = (el, keyframes, options = {}) => {
    const animation = el.animate(keyframes, { duration: 400, easing, ...options });
    layoutAnimations.add(animation);
    running.push(animation.finished.catch(() => {}));
    animation.finished.catch(() => {}).finally(() => layoutAnimations.delete(animation));
  };
  for (const el of scroll.value.querySelectorAll(".branch-tile-cell")) {
    const from = before.get(el.dataset.layoutId), to = el.getBoundingClientRect();
    if (!from || !to.width || !to.height) continue;
    const x = from.left - to.left, y = from.top - to.top;
    const sx = from.width / to.width, sy = from.height / to.height;
    if (Math.abs(x) + Math.abs(y) + Math.abs(sx - 1) + Math.abs(sy - 1) < 0.01) continue;
    play(el, [{ transform: `translate3d(${x}px,${y}px,0) scale(${sx},${sy})` }, { transform: "none" }]);
    // Counter-scale the contents so the frame changes size without stretching text.
    const counterScale = Array.from({ length: 17 }, (_, index) => {
      const progress = index / 16;
      return { offset: progress, transform: `scale(${1 / (sx + (1 - sx) * progress)},${1 / (sy + (1 - sy) * progress)})` };
    });
    for (const content of el.querySelectorAll(".branch-tile-content, .branch-collapsed-summary"))
      play(content, counterScale);
    const footer = el.querySelector(".branch-tile-footer");
    const inset = parseFloat(getComputedStyle(footer).bottom);
    // Keep the footer's bottom inset constant while its parent changes height.
    play(footer, counterScale.map(frame => {
      const scaleY = sy + (1 - sy) * frame.offset;
      return { ...frame, transform: `translate3d(0,${inset * (1 - 1 / scaleY)}px,0) ${frame.transform}` };
    }));
  }
  const content = rowElement.querySelector(`[data-tile-id="${CSS.escape(tile.id)}"] > ${wasCollapsed ? '.branch-tile-content' : '.branch-collapsed-summary'}`);
  if (content) play(content, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
  Promise.all(running).then(() => { if (revision === layoutRevision) reflowing.value = false; });
}
function trackScroll() {
  const el = scroll.value;
  if (!el) return;
  const automatic = followedScrollTop !== null && Math.abs(el.scrollTop - followedScrollTop) < 1;
  const scrollingUp = el.scrollTop < lastScrollTop - 1;
  lastScrollTop = el.scrollTop;
  followedScrollTop = null;
  if (automatic) return;
  if (scrollingUp) { followBottom = false; return; }
  const content = followedContent();
  if (el && content) {
    const end = content.end.getBoundingClientRect().bottom;
    const box = readingBounds();
    followBottom = end >= box.top && end - box.bottom < 80;
  } else followBottom = !!el && el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}
function setFollowScroll(top) {
  scroll.value.scrollTop = top;
  lastScrollTop = scroll.value.scrollTop;
  followedScrollTop = lastScrollTop;
}
function followedContent() {
  const tile = followTileId && scroll.value?.querySelector(`[data-tile-id="${CSS.escape(followTileId)}"]`);
  if (!tile) return null;
  if (tile.classList.contains("is-collapsed")) return { start: tile, end: tile };
  return { start: tile.querySelector(".branch-question") || tile,
    end: tile.querySelector(".markdown-answer, .branch-tile-error, .branch-artifact") || tile };
}
function readingBounds() {
  const box = scroll.value.getBoundingClientRect();
  const bottom = Math.min(box.bottom, (composer.value?.getBoundingClientRect().top ?? box.bottom) - 16);
  return { top: box.top, bottom, height: Math.max(0, bottom - box.top) };
}
async function followAnswer() {
  if (props.tiles.some(tile => tile.id === props.activeTileId && tile.status === "loading"))
    followTileId = props.activeTileId;
  await nextTick();
  if (!followBottom || !scroll.value) return;
  const content = followedContent(), el = scroll.value;
  if (!content) { setFollowScroll(el.scrollHeight); return; }
  const box = readingBounds(), top = content.start.getBoundingClientRect().top;
  const bottom = content.end.getBoundingClientRect().bottom;
  if (bottom > box.bottom || bottom - top > box.height)
    setFollowScroll(Math.ceil(el.scrollTop + bottom - box.bottom));
  else if (top < box.top) setFollowScroll(Math.floor(el.scrollTop + top - box.top));
}
function submit() {
  if (props.busy || !message.value.trim()) return;
  followBottom = true;
  followTileId = null;
  emit("submit");
}
function shortcut(event) {
  if (event.isComposing || event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
  event.preventDefault();
  submit();
}
watch(() => props.tiles.map(tile => [tile.id, tile.answer, tile.content, tile.status]), followAnswer);
watch(() => props.motionEnabled, enabled => { if (!enabled) finishLayoutMotion(); });
watch(viewportWidth, finishLayoutMotion);
watch(composerHeight, followAnswer);
onMounted(() => {
  viewportWidth.value = scroll.value?.clientWidth || 0;
  composerHeight.value = composer.value?.offsetHeight || 62;
  resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      if (entry.target === scroll.value) viewportWidth.value = entry.contentRect.width;
      if (entry.target === composer.value) composerHeight.value = entry.borderBoxSize?.[0]?.blockSize || composer.value.offsetHeight;
    }
  });
  if (scroll.value) resizeObserver.observe(scroll.value);
  if (composer.value) resizeObserver.observe(composer.value);
  trackScroll();
});
onUnmounted(() => { resizeObserver?.disconnect(); finishLayoutMotion(); });
defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <section class="branch-dialogue" aria-label="分支对话" :style="{ '--branch-composer-height': `${composerHeight}px` }">
    <div ref="scroll" class="branch-scroll" :class="{ 'is-reflowing': reflowing }" tabindex="0" aria-label="分支对话内容" @scroll.passive="trackScroll">
      <div v-if="loading && !tiles.length" class="branch-empty" role="status">
        <LoaderCircle :size="28" class="spinning" aria-hidden="true" />正在加载对话…
      </div>
      <div v-else-if="!tiles.length" class="branch-empty">
        <GitBranch :size="32" aria-hidden="true" />
        <h2>从一个问题开始</h2>
        <p>回答从上至下排列，分支并排呈现。点击 Tile，可组合上下文继续提问。</p>
      </div>
      <div v-else class="branch-rows">
        <div v-for="row in rows" :key="row.depth" class="branch-row" :class="{ 'has-comparison': row.tiles.length > 1 }" :data-depth="row.depth"
          :style="{ gridTemplateColumns: row.columns, minWidth: `${row.minWidth}px` }">
          <div v-for="tile in row.tiles" :key="tile.id" class="branch-tile-cell" :data-layout-id="tile.id"
            :class="{ 'is-collapsed': row.collapsedIds.includes(tile.id) }">
            <article class="branch-tile"
              :class="{ 'is-related': related.includes(tile.id), 'is-error': tile.status === 'error', 'is-collapsed': row.collapsedIds.includes(tile.id) }"
              :data-tile-id="tile.id" role="button" tabindex="0"
              :aria-label="`${title(tile)}，${related.includes(tile.id) ? '已选择关联' : '选择关联'}`"
              :aria-pressed="related.includes(tile.id)" :aria-disabled="!selectable(tile)"
              @click="toggle(tile, $event)" @keydown="keyToggle(tile, $event)" @dragstart.prevent>
              <span class="branch-tile-frame" aria-hidden="true"><span class="branch-tile-frame-fill"></span></span>
              <div v-show="!row.collapsedIds.includes(tile.id)" :id="`branch-content-${tile.id}`" class="branch-tile-content">
                <div class="branch-tile-meta">
                  <component :is="type(tile) === 'NOTE' ? StickyNote : type(tile) === 'FILE' ? FileText : GitBranch" :size="14" aria-hidden="true" />
                  <span>{{ type(tile) === 'NOTE' ? '便签' : type(tile) === 'FILE' ? '文件' : row.depth === 0 ? '起始对话' : `第 ${row.depth} 层分支` }}</span>
                  <Check v-if="related.includes(tile.id)" :size="14" aria-hidden="true" />
                  <span v-if="related.includes(tile.id)">已关联</span>
                </div>
                <p v-if="ancestryById.get(tile.id)" class="branch-ancestry" :title="ancestryById.get(tile.id)">承接：{{ ancestryById.get(tile.id) }}</p>
                <div v-if="type(tile) === 'QA'" class="branch-messages">
                  <div class="branch-message branch-message-user">
                    <span class="branch-message-role">你</span>
                    <h3 class="branch-question">{{ title(tile) }}</h3>
                  </div>
                  <div class="branch-answer" :class="{ 'is-error': tile.status === 'error' }">
                    <span class="branch-message-role">AI</span>
                    <p v-if="tile.status === 'error'" class="branch-tile-error">{{ tile.error || '回答生成失败，请在输入区重试。' }}</p>
                    <MarkdownAnswer v-else :content="tile.answer || ''" :loading="tile.status === 'loading'" />
                  </div>
                </div>
                <template v-else>
                  <h3 class="branch-question">{{ title(tile) }}</h3>
                  <p class="branch-artifact">{{ tile.content || tile.answer || tile.fileName || '暂无正文，可关联后继续提问。' }}</p>
                  <p v-if="tile.status === 'error'" class="branch-tile-error">{{ tile.error || '保存失败，请重试。' }}</p>
                </template>
              </div>
              <div v-if="row.collapsedIds.includes(tile.id)" class="branch-collapsed-summary" :title="title(tile)">
                <Check v-if="related.includes(tile.id)" :size="18" aria-label="已关联" />
                <LoaderCircle v-else-if="tile.status === 'loading'" :size="18" class="spinning" aria-label="生成中" />
                <component v-else :is="type(tile) === 'NOTE' ? StickyNote : type(tile) === 'FILE' ? FileText : GitBranch" :size="18" aria-hidden="true" />
                <h3>{{ title(tile) }}</h3>
                <span class="branch-collapsed-label">已折叠</span>
              </div>
            </article>
            <div class="branch-tile-footer">
              <button type="button" class="secondary branch-collapse-button"
                :disabled="!row.collapsedIds.includes(tile.id) && row.expandedCount <= 1"
                :aria-expanded="!row.collapsedIds.includes(tile.id)" :aria-controls="`branch-content-${tile.id}`"
                :aria-label="`${row.collapsedIds.includes(tile.id) ? '展开' : '折叠'}：${title(tile)}`"
                :title="row.collapsedIds.includes(tile.id) ? '展开对话' : row.expandedCount <= 1 ? '本层至少保留一个展开的 Tile' : '折叠对话，将空间留给其他 Tile'"
                @click.stop="toggleCollapsed(tile, row, $event)">
                <component :is="row.collapsedIds.includes(tile.id) ? PanelLeftOpen : PanelLeftClose" :size="18" aria-hidden="true" />
                <span v-if="!row.collapsedIds.includes(tile.id)">折叠</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <form ref="composer" class="branch-composer" :class="{ 'is-compact': compactComposer }" aria-label="分支对话输入区" @submit.prevent="submit">
      <label for="branch-message" class="branch-input-label">提问内容</label>
      <div class="branch-input-box">
        <div class="branch-composer-controls">
          <button v-if="mobile" type="button" class="branch-navigation icon-button" aria-label="展开导航" :aria-expanded="navigationOpen" @click="emit('navigation')"><Menu :size="20" aria-hidden="true" /></button>
          <ViewSelect v-model="view" side="top" :motion-enabled="motionEnabled" :compact="compactComposer" />
          <div class="branch-attachments" role="group" aria-label="添加内容">
            <button type="button" class="icon-button" aria-label="添加文件" title="添加文件" :disabled="busy" @click="emit('file')"><Upload :size="18" aria-hidden="true" /></button>
            <button type="button" class="icon-button" aria-label="添加便签" title="添加便签" :disabled="busy" @click="emit('note')"><StickyNote :size="18" aria-hidden="true" /></button>
          </div>
        </div>
        <textarea id="branch-message" ref="input" v-model="message" rows="1" :disabled="busy"
          aria-label="提问内容" :aria-invalid="!!error" :aria-describedby="error ? 'branch-form-error' : 'branch-input-help'"
          :placeholder="compactComposer ? '提问' : '输入问题，或选择 Tile 关联上下文…'" @keydown="shortcut" />
        <button v-if="planning" class="secondary branch-send" type="button" aria-label="取消" title="取消规划，保留草稿" @click="emit('cancel')">
          <X :size="18" aria-hidden="true" /><span v-if="!compactComposer">取消</span>
        </button>
        <button v-else class="primary branch-send" type="submit" :disabled="busy || !message.trim()" aria-label="发送并生成 Tile" :title="generating ? '正在生成回答' : '发送问题'">
          <LoaderCircle v-if="generating" class="spinning" :size="18" aria-hidden="true" /><Send v-else :size="18" aria-hidden="true" />
          <span v-if="!compactComposer">{{ planning ? '规划中' : generating ? '生成中' : '发送' }}</span>
        </button>
      </div>
      <p v-if="error" id="branch-form-error" class="branch-form-error" role="alert">{{ error }}</p>
      <div v-if="retryTile" class="branch-retry" role="status">
        <span>{{ retryTile.error || '回答生成失败' }}</span>
        <button type="button" class="text-button" :disabled="busy" @click="followBottom = true; emit('retry', retryTile)">重试回答</button>
      </div>
      <p id="branch-input-help" class="branch-input-label" aria-live="polite">{{ planning ? '正在分析问题，可取消并保留草稿。' : generating ? '正在生成回答…' : '点击 Tile 选择关联 · Ctrl / ⌘ + Enter 发送' }}</p>
    </form>
  </section>
</template>

<style scoped>
.branch-dialogue { --branch-composer-gap: max(20px, env(safe-area-inset-bottom)); position: relative; flex: 1; display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; background: var(--surface); }
.branch-scroll { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding-bottom: calc(var(--branch-composer-height) + var(--branch-composer-gap) + 16px); scroll-padding-bottom: calc(var(--branch-composer-height) + var(--branch-composer-gap) + 16px); }
.branch-scroll.is-reflowing { overflow-anchor: none; }
.branch-rows { width: 100%; }
.branch-row { display: grid; gap: 0; width: 100%; align-items: stretch; }
.branch-tile-cell { position: relative; display: flex; min-width: 0; overflow: hidden; border-radius: var(--radius); text-align: center; transform-origin: top left; }
.branch-tile { position: relative; flex: 1; display: flex; flex-direction: column; justify-content: flex-start; align-items: center; min-width: 0; min-height: 200px; padding: clamp(8px, 2vw, 24px); padding-bottom: 76px; margin: 0; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); text-align: center; overflow-wrap: anywhere; cursor: pointer; touch-action: manipulation; }
.branch-tile-content { width: 100%; min-width: 0; transform-origin: top left; }
.branch-tile-footer { position: absolute; bottom: 12px; left: 0; width: 100%; min-width: 0; display: flex; justify-content: center; transform-origin: bottom left; }
.branch-collapse-button { min-height: 44px; max-width: 100%; gap: 6px; padding: 8px 14px; border: 1px solid var(--line); border-radius: var(--radius); color: var(--blue-ink); font-size: 13px; }
.branch-collapse-button:disabled { border-color: var(--line); background: var(--canvas); color: var(--muted); }
.branch-tile.is-collapsed { padding: 16px 0 76px; background: var(--primary); border-color: var(--primary); color: var(--surface); }
.branch-collapsed-summary { position: absolute; top: 16px; bottom: 76px; left: 0; display: flex; flex-direction: column; align-items: center; gap: 14px; width: 100%; min-width: 0; overflow: hidden; transform-origin: top left; }
.branch-collapsed-summary h3 { min-height: 0; margin: 0; color: var(--surface); writing-mode: vertical-rl; text-orientation: mixed; white-space: nowrap; max-height: 240px; overflow: hidden; text-overflow: ellipsis; font-size: 14px; line-height: 1.6; }
.branch-collapsed-label { flex-shrink: 0; font-size: 11px; writing-mode: vertical-rl; opacity: 0.8; }
.branch-tile-cell.is-collapsed .branch-tile-footer .branch-collapse-button { width: 44px; padding: 8px 0; --button-rest-fill: var(--primary); --button-rest-text: var(--surface); border-color: var(--surface); background: var(--primary); color: var(--surface); }
.is-collapsed.is-related { box-shadow: inset 0 0 0 3px var(--yellow); }
.is-collapsed .branch-tile-frame { display: none; }
.branch-tile.is-related { border-color: var(--primary); }
.branch-tile-frame { position: absolute; inset: 0; z-index: 1; padding: 3px; border-radius: inherit; overflow: hidden; pointer-events: none; mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); mask-composite: exclude; }
.branch-tile-frame-fill { position: absolute; inset: 0; border-radius: inherit; background: var(--primary); transform: translate3d(-101%,0,0); transition: transform calc(var(--motion-button-fill, 320ms) / 2) linear; }
.branch-tile.is-related .branch-tile-frame-fill,
.branch-tile[aria-disabled="false"]:focus-visible .branch-tile-frame-fill { transform: translate3d(0,0,0); transition: none; }
.branch-tile:focus-visible { outline: 3px solid var(--yellow); outline-offset: -4px; z-index: 1; }
.branch-tile[aria-disabled="true"] { cursor: default; }
.branch-tile-meta { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 5px; color: var(--blue-ink); font-size: 12px; font-weight: 700; }
.branch-tile-meta :deep(svg) { width: 14px; height: 14px; flex-shrink: 0; }
.branch-ancestry { width: 100%; margin: 8px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 12px; }
.branch-question { margin: 12px 0; font-size: 17px; line-height: 1.5; white-space: pre-wrap; }
.branch-messages { display: flex; flex-direction: column; gap: 12px; width: 100%; min-width: 0; margin-top: 12px; }
.branch-message { width: fit-content; min-width: 0; max-width: min(90%, 72ch); padding: 12px 16px; border: 1px solid var(--line); border-radius: var(--radius); text-align: left; }
.has-comparison .branch-message { max-width: calc(100% - 12px); }
.branch-message-role { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 800; line-height: 1.4; }
.branch-message-user { align-self: flex-end; border-color: var(--primary); border-bottom-right-radius: 4px; background: var(--primary); color: var(--surface); }
.branch-message-user .branch-message-role { text-align: right; }
.branch-message-user .branch-question { margin: 0; color: inherit; font-size: 16px; font-weight: 700; }
.branch-answer { align-self: flex-start; width: 100%; min-width: 0; text-align: left; }
.branch-answer .branch-message-role { color: var(--blue-ink); }
.branch-answer.is-error .branch-message-role { color: var(--danger); }
.branch-answer .branch-tile-error { margin: 0; }
.branch-tile :deep(.markdown-answer) { width: 100%; max-width: 100%; font-size: 15px; line-height: 1.8; }
.branch-tile :deep(.markdown-answer p:last-child) { margin-bottom: 0; }
.branch-tile :deep(.markdown-answer pre), .branch-tile :deep(.markdown-answer table) { text-align: left; }
.branch-tile :deep(.markdown-answer ul), .branch-tile :deep(.markdown-answer ol) { max-width: 100%; text-align: left; }
.branch-artifact { margin: 0; max-width: 72ch; font-size: 15px; line-height: 1.8; white-space: pre-wrap; }
.branch-tile-error, .branch-form-error, .branch-retry { color: var(--danger); font-size: 14px; }
.branch-empty { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 32px; text-align: center; color: var(--muted); }
.branch-empty h2, .branch-empty p { margin: 0; }
.branch-composer { position: absolute; z-index: 5; left: 50%; bottom: var(--branch-composer-gap); transform: translateX(-50%); width: calc(100% - 48px); max-width: 880px; max-height: calc(100% - 40px); overflow-y: auto; padding: 8px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); box-shadow: 0 8px 28px rgb(0 64 128 / 12%), 0 2px 6px rgb(0 64 128 / 6%); }
.branch-composer:focus-within { border-color: var(--primary); }
.branch-input-label { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.branch-input-box { display: flex; align-items: center; gap: 8px; min-width: 0; }
.branch-input-box textarea { display: block; flex: 1; width: 0; min-width: 0; min-height: 44px; max-height: 128px; field-sizing: content; padding: 10px 4px; border: 0; border-radius: 4px; box-shadow: none; resize: none; font-size: 16px; line-height: 1.5; }
.branch-input-box textarea:focus { outline: none; }
.branch-composer:has(textarea:focus-visible) { outline: 3px solid var(--yellow); outline-offset: 2px; }
.branch-composer-controls { display: flex; flex-shrink: 0; align-items: center; gap: 8px; }
.branch-attachments { display: flex; gap: 8px; }
.branch-attachments .icon-button { color: var(--blue-ink); }
.branch-send { flex-shrink: 0; margin-left: 0; min-height: 44px; height: 44px; padding: 8px 16px; }
.branch-composer.is-compact .branch-input-box, .branch-composer.is-compact .branch-composer-controls, .branch-composer.is-compact .branch-attachments { gap: 2px; }
.branch-composer.is-compact .branch-send { width: 44px; min-width: 44px; padding: 8px; }
.branch-form-error { margin: 8px 0 0; }
.branch-retry { display: flex; align-items: center; justify-content: space-between; gap: 8px; max-height: 88px; overflow-y: auto; }
@media (hover: hover) and (pointer: fine) {
  .branch-tile[aria-disabled="false"]:hover .branch-tile-frame-fill { transform: translate3d(0,0,0); }
}
@media (prefers-reduced-motion: reduce) { .branch-tile-frame-fill { transition: none; } }
@media (hover: none), (pointer: coarse) { .branch-tile-frame-fill { transition: none; } }
:global(html[data-input="keyboard"]) .branch-tile-frame-fill { transition: none; }
@media (max-width: 767px) {
  .branch-dialogue { --branch-composer-gap: max(12px, env(safe-area-inset-bottom)); }
  .branch-composer { width: calc(100% - 24px); max-height: calc(100% - 24px); }
  .branch-question { font-size: 15px; }
  .branch-message { padding: 10px 8px; }
  .branch-message-user .branch-question { font-size: 15px; }
  .branch-tile :deep(.markdown-answer), .branch-artifact { font-size: 14px; }
}
</style>
