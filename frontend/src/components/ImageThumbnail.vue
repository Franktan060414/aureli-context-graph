<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useImagePreview } from "../composables/useImagePreview.js";

const props = defineProps({ tile: { type: Object, required: true }, loadFile: { type: Function, required: true } });
const container = ref(null), visible = ref(false);
const { image, loading, error } = useImagePreview(props, visible);
let observer;
onMounted(() => {
  observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      visible.value = true;
      observer.disconnect();
    }
  }, { rootMargin: "160px" });
  observer.observe(container.value);
});
onUnmounted(() => observer?.disconnect());
</script>

<template>
  <span ref="container" class="image-thumbnail" :aria-busy="loading">
    <img v-if="image" :src="image.src" :alt="tile.fileName" draggable="false" />
    <span v-else-if="error" class="thumbnail-state" :title="error">图片加载失败 · 展开后重试</span>
    <span v-else class="thumbnail-state">{{ loading ? '正在加载图片…' : '图片预览' }}</span>
  </span>
</template>

<style scoped>
.image-thumbnail { display:flex; align-items:center; justify-content:center; flex:1; min-height:0; overflow:hidden; background:var(--surface); border:1px solid var(--line); border-radius:4px; }
.image-thumbnail img { display:block; width:100%; height:100%; object-fit:contain; }
.thumbnail-state { padding:4px; font-size:12px; color:var(--muted); text-align:center; }
</style>
