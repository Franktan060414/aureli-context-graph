import { onMounted, onUnmounted, ref, watch } from "vue";

export function useCanvasZoom() {
  function readZoom() {
    const value = new URL(window.location.href).searchParams.get("zoom");
    const number = value?.trim() ? Number(value) : 1;
    return Number.isFinite(number) ? Math.min(1.5, Math.max(0.35, number)) : 1;
  }

  const zoom = ref(readZoom());
  // Replace the current entry so zoom controls do not add browser back steps.
  watch(zoom, value => {
    const url = new URL(window.location.href);
    url.searchParams.set("zoom", String(value));
    if (url.href !== window.location.href) {
      window.history.replaceState(window.history.state, "", url);
    }
  }, { immediate: true, flush: "sync" });

  function restoreZoom() { zoom.value = readZoom(); }
  onMounted(() => window.addEventListener("popstate", restoreZoom));
  onUnmounted(() => window.removeEventListener("popstate", restoreZoom));
  return zoom;
}
