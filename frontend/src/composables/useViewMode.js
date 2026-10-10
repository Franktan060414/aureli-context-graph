import { onMounted, onUnmounted, ref, watch } from "vue";

export function useViewMode() {
  function readView() {
    const value = new URL(window.location.href).searchParams.get("view");
    return ["graph", "list", "branch"].includes(value) ? value : "graph";
  }

  const view = ref(readView());
  // Keep one browser entry per page, while making its active view shareable.
  watch(view, value => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", value);
    if (url.href !== window.location.href)
      window.history.replaceState(window.history.state, "", url);
  }, { immediate: true, flush: "sync" });

  function restoreView() { view.value = readView(); }
  onMounted(() => window.addEventListener("popstate", restoreView));
  onUnmounted(() => window.removeEventListener("popstate", restoreView));
  return view;
}
