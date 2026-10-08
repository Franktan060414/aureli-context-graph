import { computed, ref, shallowRef, watch } from "vue";
import { acquireImagePreview } from "../lib/image-preview.js";

export function useImagePreview(props, enabled = ref(true)) {
  const state = shallowRef(null);
  let preview;
  watch(() => [props.loadFile, props.tile.id, props.tile.fileName, props.tile.fileSize,
    props.tile.fileContentType, enabled.value], (_, __, onCleanup) => {
    state.value = null;
    if (!enabled.value) return;
    preview = acquireImagePreview(props.loadFile, props.tile);
    state.value = preview.state;
    const current = preview;
    onCleanup(() => { current.release(); preview = null; });
  }, { immediate: true });
  return {
    image: computed(() => state.value?.image || null),
    loading: computed(() => state.value?.loading || false),
    error: computed(() => state.value?.error || ""),
    reload: () => preview?.reload(),
  };
}
