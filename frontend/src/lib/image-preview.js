import { shallowReactive } from "vue";

const imageTypes = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg",
  gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml",
  bmp: "image/bmp", ico: "image/x-icon", tif: "image/tiff", tiff: "image/tiff",
  heic: "image/heic", heif: "image/heif",
};

export function imageContentType(tile) {
  const type = (tile?.fileContentType || "").split(";")[0].trim().toLowerCase();
  if (type.startsWith("image/")) return type;
  const extension = /\.([^.]+)$/.exec(tile?.fileName || "")?.[1].toLowerCase();
  return imageTypes[extension] || "";
}

export function isImageTile(tile) {
  return tile?.tileType === "FILE" && !!imageContentType(tile);
}

// Each loader belongs to one workspace. Share a request and Blob URL between
// canvas thumbnails and the full-page viewer, retaining it only while in use.
const previews = new WeakMap();
export function acquireImagePreview(loadFile, tile) {
  let cache = previews.get(loadFile);
  if (!cache) { cache = new Map(); previews.set(loadFile, cache); }
  const key = JSON.stringify([tile.id, tile.fileName, tile.fileSize, imageContentType(tile)]);
  let entry = cache.get(key);
  if (!entry) {
    entry = { users: 0, url: "", generation: 0,
      state: shallowReactive({ image: null, loading: true, error: "" }) };
    cache.set(key, entry);
  }
  entry.users++;
  function load() {
    const current = entry, generation = ++current.generation;
    const active = () => current.users > 0 && current.generation === generation;
    current.state.image = null;
    current.state.loading = true;
    current.state.error = "";
    if (current.url) { URL.revokeObjectURL(current.url); current.url = ""; }
    current.promise = (async () => {
      try {
        const blob = await loadFile(tile);
        if (!active()) return;
        if (!blob?.size) throw new Error("文件内容为空，请重新添加图片。");
        current.url = URL.createObjectURL(new Blob([blob], { type: imageContentType(tile) }));
        const image = new Image();
        image.src = current.url;
        try { await image.decode(); }
        catch { throw new Error("图片无法预览，文件可能已损坏或浏览器不支持此格式。可下载原文件查看。"); }
        if (!active()) return;
        current.state.image = { src: current.url, width: image.naturalWidth, height: image.naturalHeight };
      } catch (error) {
        if (!active()) return;
        if (current.url) { URL.revokeObjectURL(current.url); current.url = ""; }
        current.state.error = error.message || "图片加载失败，请重试。";
      } finally {
        if (active()) current.state.loading = false;
      }
    })();
  }
  if (!entry.promise) load();
  let released = false;
  return {
    state: entry.state,
    reload: load,
    release() {
      if (released) return;
      released = true;
      if (--entry.users) return;
      entry.generation++;
      if (cache.get(key) === entry) cache.delete(key);
      if (entry.url) { URL.revokeObjectURL(entry.url); entry.url = ""; }
    },
  };
}
