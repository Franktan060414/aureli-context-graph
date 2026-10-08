<script setup>
import { computed, ref } from "vue";
import { AlertCircle, LoaderCircle } from "@lucide/vue";
import { useImagePreview } from "../composables/useImagePreview.js";

const props = defineProps({ tile: { type: Object, required: true }, loadFile: { type: Function, required: true } });
const { image, loading, error, reload } = useImagePreview(props);
const zoom = ref("fit");
const imageStyle = computed(() => zoom.value === "fit" || !image.value ? {} : {
  width: `${image.value.width * Number(zoom.value)}px`,
  height: `${image.value.height * Number(zoom.value)}px`,
});
</script>

<template>
  <div class="image-file-viewer" :aria-busy="loading">
    <div class="image-viewer-toolbar">
      <label>显示比例
        <select v-model="zoom" aria-label="图片显示比例" :disabled="loading || !!error">
          <option value="fit">适应窗口</option>
          <option value="0.5">50%</option><option value="1">100% · 原始大小</option>
          <option value="1.5">150%</option><option value="2">200%</option>
        </select>
      </label>
      <span v-if="image" class="image-preview-info">{{ image.width }} × {{ image.height }} 像素</span>
    </div>
    <div class="image-preview-body">
      <div v-if="loading" class="image-preview-state" role="status" aria-live="polite">
        <LoaderCircle class="spinning" :size="24" aria-hidden="true" /><p>正在加载图片…</p>
      </div>
      <div v-else-if="error" class="image-preview-state" role="alert">
        <AlertCircle :size="24" aria-hidden="true" /><p>{{ error }}</p>
        <button class="secondary" @click="reload">重新加载</button>
      </div>
      <div v-else-if="image" class="image-preview-scroll" :class="{ 'fit-image': zoom === 'fit' }" tabindex="0" aria-label="图片浏览区域">
        <div class="image-preview-stage">
          <img :src="image.src" :alt="tile.fileName" :style="imageStyle" draggable="false" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-file-viewer { display:flex; flex-direction:column; flex:1; min-height:0; background:var(--canvas); }
.image-viewer-toolbar { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; padding:8px 24px; background:var(--surface); border-bottom:2px solid var(--primary); }
.image-viewer-toolbar label { display:flex; align-items:center; gap:12px; font-size:14px; }
.image-preview-info { color:var(--muted); font-size:13px; }
.image-preview-body { position:relative; flex:1; min-height:0; }
.image-preview-scroll { width:100%; height:100%; overflow:auto; }
.image-preview-stage { display:flex; align-items:center; justify-content:center; padding:24px; min-width:100%; min-height:100%; width:max-content; }
.image-preview-stage img { display:block; flex-shrink:0; max-width:none; }
.fit-image .image-preview-stage { width:100%; height:100%; }
.fit-image img { width:100%; height:100%; object-fit:contain; }
.image-preview-state { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; padding:24px; text-align:center; color:var(--text); }
@media (max-width:600px) { .image-viewer-toolbar { padding:8px 16px; } .image-preview-stage { padding:16px; } }
</style>
