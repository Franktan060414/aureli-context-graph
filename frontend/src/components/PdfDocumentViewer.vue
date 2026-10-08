<script setup>
import { ref, watch } from "vue";
import { AlertCircle, LoaderCircle } from "@lucide/vue";

const props = defineProps({ tile: { type: Object, required: true }, loadFile: { type: Function, required: true } });
const emit = defineEmits(["close"]);
const frame = ref(null), viewerSrc = ref(""), loading = ref(true), error = ref(""), retry = ref(0);
const assetBase = new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI).href;
let detachViewer = () => {};

watch(() => [props.tile.id, retry.value], async (_, __, onCleanup) => {
  let active = true, objectUrl;
  loading.value = true;
  error.value = "";
  viewerSrc.value = "";
  onCleanup(() => {
    active = false;
    detachViewer();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });
  try {
    const blob = await props.loadFile(props.tile);
    // A closed viewer or a different file must not receive this request's result.
    if (!active) return;
    if (!blob?.size) throw new Error("文件内容为空，请重新添加 PDF。");
    objectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
    // Fetch through the app client first, so custom backend addresses and demo
    // files work with PDF.js's same-origin viewer validation.
    viewerSrc.value = `${assetBase}pdfjs-6.4.299-dist/web/viewer.html?file=${encodeURIComponent(`${objectUrl}#${props.tile.fileName}`)}#zoom=page-width`;
  } catch (reason) {
    if (active) {
      error.value = reason.message || "PDF 加载失败，请重试。";
      loading.value = false;
    }
  }
}, { immediate: true });

async function onViewerLoad() {
  detachViewer();
  const source = viewerSrc.value;
  if (!source) return;
  let active = true, eventBus;
  const markReady = () => {
    if (!active) return;
    loading.value = false;
    clearTimeout(timeout);
  };
  const markFailed = () => {
    if (!active) return;
    error.value = "PDF 预览失败，请重试或下载原文件查看。";
    markReady();
  };
  const onKeydown = event => {
    if (event.key === "Escape") {
      const document = frame.value?.contentDocument;
      // Inner native dialogs/fullscreen own their Escape behavior.
      if (document?.querySelector('dialog[open]') || document?.fullscreenElement) return;
      // Suppress the browser's outer-dialog cancel while PDF.js handles its UI.
      event.preventDefault();
      // Let Escape dismiss PDF.js's search/menu/dialog before closing the page.
      const overlays = document?.querySelectorAll('#findbar, #secondaryToolbar, .menuContainer:not(.sidebar)') || [];
      if ([...overlays].some(element => element.getClientRects().length > 0)) return;
      emit("close");
    }
  };
  const timeout = setTimeout(markFailed, 30000);
  const document = frame.value?.contentDocument;
  // Inspect overlays before PDF.js's own bubbling handler dismisses them.
  document?.addEventListener("keydown", onKeydown, true);
  detachViewer = () => {
    active = false;
    clearTimeout(timeout);
    document?.removeEventListener("keydown", onKeydown, true);
    eventBus?.off("pagesinit", markReady);
    eventBus?.off("documenterror", markFailed);
  };
  try {
    const application = frame.value?.contentWindow?.PDFViewerApplication;
    if (!application) throw new Error("PDF 阅读器资源加载失败");
    const theme = document.createElement("link");
    theme.rel = "stylesheet";
    theme.href = `${assetBase}aureli-viewer.css`;
    document.head.append(theme);
    await application.initializedPromise;
    if (!active || source !== viewerSrc.value) return;
    eventBus = application.eventBus;
    eventBus.on("pagesinit", markReady);
    eventBus.on("documenterror", markFailed);
    if (application.pdfViewer.pagesCount > 0) markReady();
  } catch {
    markFailed();
  }
}
</script>

<template>
  <div class="pdf-document-viewer" :aria-busy="loading">
    <iframe v-if="viewerSrc && !error" ref="frame" :key="viewerSrc" :src="viewerSrc"
      :title="`PDF 文档：${tile.fileName}`" @load="onViewerLoad" />
    <div v-if="loading" class="pdf-preview-state" role="status" aria-live="polite">
      <LoaderCircle class="spinning" :size="24" aria-hidden="true" />
      <p>正在加载 PDF…</p>
    </div>
    <div v-else-if="error" class="pdf-preview-state" role="alert">
      <AlertCircle :size="24" aria-hidden="true" />
      <p>{{ error }}</p>
      <button class="secondary" @click="retry++">重新加载</button>
    </div>
  </div>
</template>

<style scoped>
.pdf-document-viewer { flex: 1; min-height: 0; position: relative; background: var(--canvas); }
iframe { display: block; width: 100%; height: 100%; border: 0; }
.pdf-preview-state { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px; text-align: center; background: var(--canvas); color: var(--text); }
</style>
