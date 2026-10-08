<script setup>
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from "vue";
import {
  ArrowDownLeft,
  Network,
  Search,
  X,
  GitBranch,
  Database,
  Link2,
  ArrowUpRight,
  Trash2,
  Download,
  Pencil,
  FileText,
  Image as ImageIcon,
} from "@lucide/vue";
import { relationTypeForEdge } from "../lib/tile-relations.js";
import GraphCanvas from "./GraphCanvas.vue";
import MarkdownAnswer from "./MarkdownAnswer.vue";
import PdfDocumentViewer from "./PdfDocumentViewer.vue";
import DocxDocumentViewer from "./DocxDocumentViewer.vue";
import ImageFileViewer from "./ImageFileViewer.vue";
import { isImageTile } from "../lib/image-preview.js";
import { useMotion } from "../composables/useMotion.js";
const { animateSurface } = useMotion();
const zoom = defineModel("zoom", { type: Number, default: 1 });
const props = defineProps({
  mode: String,
  tile: Object,
  tiles: Array,
  layout: Object,
  edges: Array,
  selected: String,
  related: Array,
  busy: Boolean,
  demo: Boolean,
  loadFile: Function,
});
const emit = defineEmits([
  "close",
  "select",
  "toggle",
  "expand",
  "delete",
  "extend",
  "new",
  "move",
  "move-end",
  "arrange",
  "file",
  "download",
  "edit-note",
]);
const nodeType = tile => tile?.tileType || "QA";
const isPdf = computed(() => props.mode !== "graph" && nodeType(props.tile) === "FILE" && /\.pdf$/i.test(props.tile?.fileName || ""));
const isDocx = computed(() => props.mode !== "graph" && nodeType(props.tile) === "FILE" && /\.docx$/i.test(props.tile?.fileName || ""));
const isDocument = computed(() => isPdf.value || isDocx.value);
const isImage = computed(() => props.mode !== "graph" && isImageTile(props.tile));
const isPreview = computed(() => isDocument.value || isImage.value);
const dialog = ref(null),
  query = ref(""),
  filter = ref("all");
const connections = computed(() =>
  props.edges.filter(
    (e) =>
      e.sourceTileId === props.tile?.id || e.targetTileId === props.tile?.id,
  ),
);
let previousOverflow, previousScroll, previousFocus;
onMounted(() => {
  previousFocus = document.activeElement;
  previousOverflow = document.body.style.overflow;
  previousScroll = { left: window.scrollX, top: window.scrollY };
  document.body.style.overflow = "hidden";
  dialog.value.showModal();
  animateSurface(dialog.value, { axis: "y", distance: 10 });
});
onUnmounted(() => {
  document.body.style.overflow = previousOverflow;
  window.scrollTo({ ...previousScroll, behavior: "instant" });
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
});
watch(
  () => [props.mode, props.tile?.id],
  async () => {
    await nextTick();
    dialog.value?.querySelector("h2")?.focus();
  },
);
function close() {
  emit("close");
}
function extend(id) {
  close();
  emit("extend", id);
}
</script>
<template>
  <dialog
    ref="dialog"
    class="fullscreen-viewer"
    :class="{ 'fullscreen-document-viewer': isPreview }"
    :aria-label="
      mode === 'graph' ? '全页面图谱视图' : `全页面 Tile ${tile?.id}`
    "
    @cancel.prevent="close"
  >
    <header class="fullscreen-header">
      <div>
        <span class="fullscreen-symbol"><ImageIcon v-if="isImage" :size="22" /><FileText v-else-if="isDocument" :size="22" /><Network v-else :size="22" /></span>
        <div>
          <h2 tabindex="-1">{{ mode === "graph" ? "图谱视图" : isPreview ? tile.fileName : tile?.id }}</h2>
          <p>
            {{
              mode === "graph"
                ? `${tiles.length} 个节点 · ${edges.length} 条关系`
                : isImage ? "图片 · 完整预览" : isPdf ? "PDF · 完整文档" : isDocx ? "DOCX · 完整文档" : nodeType(tile) === "NOTE" ? "便签 · 完整正文" : nodeType(tile) === "FILE" ? "文件附件" : "Tile · 完整问题与回答"
            }}<span v-if="demo"> · 示例模式</span>
          </p>
        </div>
      </div>
      <button class="secondary" @click="close">
        <ArrowDownLeft :size="16" />退出全页面<span class="keyboard-hint"
          >Esc</span
        >
      </button>
    </header>
    <template v-if="mode === 'graph'">
      <div class="fullscreen-filters">
        <label class="search-field"
          ><Search :size="16" /><input
            v-model="query"
            aria-label="全页面搜索 Tile"
            placeholder="搜索问题、回答或 Tile ID…" /><button
            v-if="query"
            @click="query = ''"
            class="icon-button"
            aria-label="清除全页面搜索"
          >
            <X :size="14" /></button></label
        ><select v-model="filter" aria-label="全页面节点筛选">
          <option value="all">全部节点</option>
          <option value="QA">问答</option>
          <option value="NOTE">便签</option>
          <option value="FILE">文件</option>
          <option value="root">独立节点</option>
          <option value="related">关联节点</option>
        </select>
      </div>
      <GraphCanvas
        v-model:zoom="zoom"
        :tiles="tiles"
        :layout="layout"
        :edges="edges"
        :selected="selected"
        :related="related"
        :query="query"
        :filter="filter"
        :busy="busy"
        :load-file="loadFile"
        marker-id="fullscreen-arrow"
        @select="emit('select', $event)"
        @move="emit('move', $event)"
        @move-end="emit('move-end')"
        @arrange="emit('arrange', $event)"
        @toggle="emit('toggle', $event)"
        @expand="emit('expand', $event)"
        @delete="emit('delete', $event)"
        @extend="extend"
        @file="emit('file', $event)"
        @download="emit('download', $event)"
        @edit-note="emit('edit-note', $event)"
        @new="
          close();
          emit('new');
        "
      />
      <footer class="fullscreen-legend legend">
        <span><i class="legend-dot root"></i>独立节点</span
        ><span><i class="legend-dot rag"></i>检索主题</span
        ><span><i class="legend-dot memory"></i>关联记忆</span>
      </footer>
    </template>
    <template v-else-if="isPreview">
      <div class="document-actions">
        <span class="mono">{{ tile.id }}</span>
        <button class="secondary" @click="emit('download', tile)" :disabled="busy"><Download :size="16" />下载原文件</button>
        <button class="icon-button danger-icon" @click="emit('delete', tile)" :disabled="busy" :aria-label="`删除 ${tile.id}`" title="删除 Tile"><Trash2 :size="17" /></button>
      </div>
      <ImageFileViewer v-if="isImage" :key="`${demo}:${tile.id}`" :tile="tile" :load-file="loadFile" />
      <PdfDocumentViewer v-else-if="isPdf" :key="`${demo}:${tile.id}`" :tile="tile" :load-file="loadFile" @close="close" />
      <DocxDocumentViewer v-else :key="`${demo}:${tile.id}`" :tile="tile" :load-file="loadFile" @close="close" />
    </template>
    <div v-else-if="tile" class="fullscreen-tile-body">
      <div class="tile-reading">
        <div class="reading-heading">
          <span class="small-tag">{{
            tile.status === "loading"
              ? "生成中"
              : tile.status === "error"
                ? "生成失败"
                : nodeType(tile) === "QA" ? "已完成" : "已保存"
          }}</span
          ><span class="mono">{{ tile.id }}</span
          ><button
            class="icon-button danger-icon"
            @click="emit('delete', tile)"
            :disabled="busy"
            :aria-label="`删除 ${tile.id}`"
            title="删除 Tile"
          >
            <Trash2 :size="17" />
          </button>
        </div>
        <section>
          <h3>{{ nodeType(tile) === "QA" ? "用户问题" : "标题" }}</h3>
          <p class="reading-question">{{ tile.message }}</p>
        </section>
        <section>
          <h3>{{ nodeType(tile) === "QA" ? "AI 回答" : nodeType(tile) === "NOTE" ? "便签正文" : "文件名称" }}</h3>
          <MarkdownAnswer
            v-if="nodeType(tile) === 'QA'"
            class="reading-answer"
            :content="tile.answer"
            :loading="tile.status === 'loading'"
          />
          <p v-else class="reading-answer">
            {{
              tile.answer ||
              (tile.status === "loading" ? "正在思考并生成回答…" : "暂无回答")
            }}
          </p>
          <p v-if="tile.error" class="inline-error">{{ tile.error }}</p>
        </section>
        <button
          v-if="nodeType(tile) === 'FILE'" class="primary" @click="emit('download', tile)" :disabled="busy"
        ><Download :size="16" />下载文件</button>
        <button v-else-if="nodeType(tile) === 'NOTE'" class="secondary" @click="emit('edit-note', tile)" :disabled="busy"><Pencil :size="16" />编辑便签</button>
        <button
          v-if="nodeType(tile) !== 'FILE'" class="primary"
          @click="extend(tile.id)"
          :disabled="busy || tile.status !== 'ready'"
        >
          <GitBranch :size="16" />从此节点延伸<ArrowUpRight :size="16" />
        </button>
      </div>
      <aside v-if="nodeType(tile) === 'QA'" class="reading-context">
        <h3>上下文来源</h3>
        <div class="source-item">
          <span class="source-icon teal"><Database :size="16" /></span
          ><span>共享 RAG 知识库</span>
        </div>
        <div class="source-item" v-for="id in tile.relatedTileIds" :key="id">
          <Link2 :size="16" /><button
            class="text-button mono"
            @click="emit('expand', id)"
          >
            {{ id }}
          </button>
        </div>
        <p v-if="!tile.relatedTileIds.length" class="muted">
          独立节点，未关联其他 Tile。
        </p>
        <h3>关系连接 · {{ connections.length }}</h3>
        <div class="reading-edge" v-for="edge in connections" :key="edge.id">
          <button
            class="text-button mono"
            @click="emit('expand', edge.sourceTileId)"
          >
            {{ edge.sourceTileId }}</button
          ><span
            >{{ edge.direction === "UNDIRECTED" ? "↔" : "→" }}
            {{ relationTypeForEdge(edge) }}</span
          ><button
            class="text-button mono"
            @click="emit('expand', edge.targetTileId)"
          >
            {{ edge.targetTileId }}
          </button>
        </div>
      </aside>
    </div>
  </dialog>
</template>

<style scoped>
.fullscreen-document-viewer { overflow: hidden; }
.fullscreen-document-viewer .fullscreen-header h2 { font-size: 22px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.fullscreen-document-viewer .fullscreen-header > button { flex-shrink: 0; }
.document-actions { display: flex; flex-shrink: 0; align-items: center; gap: 12px; padding: 8px 24px; border-bottom: 1px solid var(--line); }
.document-actions .mono { margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 600px) {
  .fullscreen-document-viewer .fullscreen-header h2 { font-size: 18px; }
  .document-actions { padding: 8px 16px; }
  .document-actions .mono { display: none; }
  .document-actions > .secondary { margin-right: auto; }
}
</style>
