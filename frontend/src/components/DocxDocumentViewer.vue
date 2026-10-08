<script setup>
import { ref, watch } from "vue";
import { AlertCircle, LoaderCircle } from "@lucide/vue";

const props = defineProps({ tile: { type: Object, required: true }, loadFile: { type: Function, required: true } });
const emit = defineEmits(["close"]);
const frame = ref(null), frameReady = ref(false), loading = ref(true), error = ref(""), retry = ref(0);
const zoom = ref("fit"), scaleLabel = ref(""), pageCount = ref(0);
let updateScale = () => {};
// Keep document fonts/styles inside a script-free frame, separate from app CSS.
const shell = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body { margin:0; background:#f3f3f3; }
body { overflow:auto; }
#docx-content { width:100%; }
#docx-content > .docx-wrapper { background:transparent; padding:16px; width:max-content; margin:0 auto; }
#docx-content > .docx-wrapper > section.docx { box-shadow:none; border:1px solid #c5c5c5; }
a:focus-visible { outline:2px solid #0066cc; outline-offset:2px; }
</style></head><body tabindex="0"></body></html>`;

watch(() => [props.tile.id, retry.value, frameReady.value], async (_, __, onCleanup) => {
  if (!frameReady.value) return;
  let active = true, stage, observer, document;
  loading.value = true;
  error.value = "";
  pageCount.value = 0;
  scaleLabel.value = "";
  const onKeydown = event => {
    if (event.key === "Escape") { event.preventDefault(); emit("close"); }
  };
  const onLinkClick = event => {
    const link = event.target.closest?.("a[href]");
    // Preserve internal bookmarks without navigating the reader away from its Tile.
    if (link && !link.getAttribute("href").startsWith("#")) event.preventDefault();
  };
  onCleanup(() => {
    active = false;
    observer?.disconnect();
    document?.removeEventListener("keydown", onKeydown, true);
    document?.removeEventListener("click", onLinkClick);
    stage?.remove();
    updateScale = () => {};
  });
  try {
    const [blob, { renderAsync }] = await Promise.all([props.loadFile(props.tile), import("docx-preview")]);
    if (!active) return;
    if (!blob?.size) throw new Error("文件内容为空，请重新添加 DOCX。");
    document = frame.value.contentDocument;
    const styles = document.createElement("div"), content = document.createElement("div");
    content.id = "docx-content";
    stage = document.createElement("div");
    stage.append(styles, content);
    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("click", onLinkClick);
    // Each attempt renders into detached containers. A late render must not replace
    // another file or a newer retry. Embedded images/fonts use data URLs for cleanup.
    await renderAsync(blob, content, styles, {
      useBase64URL: true,
      ignoreLastRenderedPageBreak: false,
      renderHeaders: true, renderFooters: true,
      renderFootnotes: true, renderEndnotes: true,
    });
    if (!active) return;
    document.body.replaceChildren(stage);
    await Promise.all([...content.querySelectorAll("img")].map(image => image.decode().catch(() => {})));
    await document.fonts.ready;
    if (!active) return;
    const wrapper = content.querySelector(".docx-wrapper");
    const pages = [...content.querySelectorAll("section.docx")];
    if (!wrapper || !pages.length) throw new Error("没有可预览的文档正文");
    pageCount.value = pages.length;
    updateScale = () => {
      const pageWidth = Math.max(...pages.map(page => page.offsetWidth));
      const scale = zoom.value === "fit"
        ? Math.min(1, Math.max(0.1, (frame.value.clientWidth - 32) / pageWidth))
        : Number(zoom.value);
      wrapper.style.zoom = scale;
      scaleLabel.value = `${Math.round(scale * 100)}%`;
    };
    observer = new ResizeObserver(updateScale);
    observer.observe(frame.value);
    updateScale();
    loading.value = false;
  } catch (reason) {
    if (active) {
      error.value = /文件不存在|连接|超时|文件内容为空/.test(reason.message)
        ? reason.message : "DOCX 预览失败，请重试或下载原文件查看。";
      loading.value = false;
    }
  }
}, { immediate: true });
watch(zoom, () => updateScale());
</script>

<template>
  <div class="docx-document-viewer" :aria-busy="loading">
    <div class="docx-viewer-toolbar">
      <label>显示比例
        <select v-model="zoom" aria-label="DOCX 显示比例" :disabled="loading || !!error">
          <option value="fit">适应宽度</option>
          <option value="0.5">50%</option><option value="0.75">75%</option>
          <option value="1">100%</option><option value="1.25">125%</option>
          <option value="1.5">150%</option><option value="2">200%</option>
        </select>
      </label>
      <span v-if="!loading && !error" class="docx-preview-info">{{ scaleLabel }} · {{ pageCount }} 页预览</span>
    </div>
    <div class="docx-preview-body">
      <iframe ref="frame" :srcdoc="shell" sandbox="allow-same-origin" :title="`DOCX 文档：${tile.fileName}`" @load="frameReady = true" />
      <div v-if="loading" class="docx-preview-state" role="status" aria-live="polite">
        <LoaderCircle class="spinning" :size="24" aria-hidden="true" /><p>正在加载 DOCX…</p>
      </div>
      <div v-else-if="error" class="docx-preview-state" role="alert">
        <AlertCircle :size="24" aria-hidden="true" /><p>{{ error }}</p>
        <button class="secondary" @click="retry++">重新加载</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.docx-document-viewer { display:flex; flex-direction:column; flex:1; min-height:0; background:var(--canvas); }
.docx-viewer-toolbar { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; padding:8px 24px; background:var(--surface); border-bottom:2px solid var(--primary); }
.docx-viewer-toolbar label { display:flex; align-items:center; gap:12px; font-size:14px; }
.docx-viewer-toolbar select { min-height:40px; }
.docx-preview-info { color:var(--muted); font-size:13px; }
.docx-preview-body { position:relative; flex:1; min-height:0; }
iframe { display:block; width:100%; height:100%; border:0; }
.docx-preview-state { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; padding:24px; text-align:center; background:var(--canvas); color:var(--text); }
@media (max-width:600px) { .docx-viewer-toolbar { padding:8px 16px; } }
</style>
