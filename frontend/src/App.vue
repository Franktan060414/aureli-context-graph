<script setup>
import {
  computed,
  ref,
  reactive,
  watch,
  nextTick,
  onMounted,
  onUnmounted,
} from "vue";
import {
  Tag,
  Network,
  BookOpen,
  Settings2,
  ChevronRight,
  ChevronDown,
  Plus,
  Search,
  ArrowUpRight,
  ArrowRight,
  GitBranch,
  Merge,
  Split,
  Check,
  CircleHelp,
  Menu,
  Download,
  RotateCcw,
  X,
  FileText,
  StickyNote,
  Upload,
  Pencil,
  Trash2,
  Copy,
  Send,
  Link2,
  Database,
  CircleDot,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  FlaskConical,
  LoaderCircle,
  Expand,
  GripVertical,
  PanelRightClose,
  PanelRightOpen,
} from "@lucide/vue";
import LabelPanel from "./components/LabelPanel.vue";
import { labelForTile, labelStyle } from "./lib/labels.js";
import GraphCanvas from "./components/GraphCanvas.vue";
import ViewSelect from "./components/ViewSelect.vue";
import GraphExportDialog from "./components/GraphExportDialog.vue";
import QuestionForm from "./components/QuestionForm.vue";
import ContextPicker from "./components/ContextPicker.vue";
import FullscreenViewer from "./components/FullscreenViewer.vue";
import MarkdownAnswer from "./components/MarkdownAnswer.vue";
import ApiSettings from "./components/ApiSettings.vue";
import { useMotion } from "./composables/useMotion.js";
import { useCanvasZoom } from "./composables/useCanvasZoom.js";
const { animateSurface, motionEnabled } = useMotion();
const canvasZoom = useCanvasZoom();
import { createApiClient } from "./lib/api.js";
import { relationTypeForDirection, relationTypeForEdge } from "./lib/tile-relations.js";
import { createMapZoomSaver } from "./lib/map-zoom.js";
import { readLayouts, positionTiles, tileDimensions } from "./lib/graph-layout.js";
import { readArrangements } from "./lib/layered-layout.js";
import { demoGraph, demoFiles } from "./lib/demo.js";
const nav = [
  { id: "graph", label: "图谱工作台", icon: Network },
  { id: "knowledge", label: "知识库管理", icon: BookOpen },
  { id: "settings", label: "服务设置", icon: Settings2 },
];
const titles = {
  graph: "图谱工作台",
  knowledge: "知识库管理",
  settings: "服务设置",
};
const subtitles = {
  graph: "让每一次提问，成为知识网络的新连接。",
  knowledge: "管理共享知识，为每一个 Tile 提供可靠的回答依据。",
  settings: "统一配置 API，让对话与检索使用合适的模型。",
};
const section = ref(
  ["graph", "knowledge", "settings"].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : "graph",
);
const isMobile = ref(window.matchMedia("(max-width: 767px)").matches);
const mobileMedia = window.matchMedia("(max-width: 767px)");
const demo = ref(localStorage.getItem("aureli-mode") === "demo"),
  mobileNav = ref(false),
  tab = ref("graph"),
  panel = ref("detail"),
  inspectorMinimized = ref(false),
  query = ref(""),
  filter = ref("all");
const apiBase = ref(localStorage.getItem("aureli-api-base") || "");
const serverKey = computed(() => apiBase.value.trim().replace(/\/+$/, "") || location.origin);
const maps = ref([]), demoMaps = ref([{ mapId: "demo", name: "示例图谱", zoom: canvasZoom.value }]);
const liveMapId = ref(new URL(location.href).searchParams.get("map") || localStorage.getItem(`aureli-active-map:${serverKey.value}`) || null);
const demoMapId = ref("demo");
const currentMapId = computed(() => demo.value ? demoMapId.value : liveMapId.value);
const visibleMaps = computed(() => demo.value ? demoMaps.value : maps.value);
const currentMap = computed(() => visibleMaps.value.find(map => map.mapId === currentMapId.value));
const mapStates = reactive({});
function mapState(key, graph = { tiles: [], edges: [] }) {
  return mapStates[key] ||= { labels: [], ...graph, generating: false, loading: false, error: "", ui: null };
}
mapState("demo:demo", demoGraph());
const workspaceKey = computed(() => demo.value ? `demo:${demoMapId.value}` : `live:${serverKey.value}:${liveMapId.value}`);
const workspace = computed(() => mapState(workspaceKey.value));
const live = computed(() => mapState(`live:${serverKey.value}:${liveMapId.value}`));
const mapListLoading = ref(false), mapListError = ref(""), mapCreating = ref(false), showMapForm = ref(false), mapName = ref(""), mapNameInput = ref(null);
const mapSwitchDisabled = computed(() => weightBusy.value || nodeBusy.value || modalBusy.value || mapCreating.value);
let mapListRequest = 0;
const related = ref([]),
  selected = ref(demo.value ? "tile-003" : null);
const selectedTile = computed(() =>
  workspace.value.tiles.find((t) => t.id === selected.value),
);
const selectedTileLabel = computed(() => labelForTile(selectedTile.value, workspace.value.labels));
const selectedTileWeightLabel = computed(() => {
  const weight = selectedTile.value?.weight;
  if (weight == null) return "未设置";
  return { 1: "普通", 2: "重要", 3: "非常重要" }[weight] || "未知";
});
const weightBusy = ref(false);
const weightOptions = [
  { value: 1, label: "普通" },
  { value: 2, label: "重要" },
  { value: 3, label: "非常重要" },
];
async function changeTileWeight(event) {
  const tile = selectedTile.value;
  const weight = Number(event.target.value);
  // Keep the saved value visible until the request succeeds, including on failure.
  event.target.value = String(tile?.weight ?? 1);
  if (!tile || weightBusy.value || !weightOptions.some(option => option.value === weight) || tile.weight === weight) return;
  const isDemo = demo.value;
  weightBusy.value = true;
  try {
    if (!isDemo) await api.updateTileWeight(tile.id, weight);
    tile.weight = weight;
    notify(`${isDemo ? "示例 " : ""}Tile 权重已设为${weightOptions.find(option => option.value === weight).label}`);
  } catch (error) {
    notify(`权重保存失败：${error.message}`, true);
  } finally {
    weightBusy.value = false;
  }
}
const selectedEdges = computed(() =>
  workspace.value.edges.filter(
    (e) =>
      e.sourceTileId === selected.value || e.targetTileId === selected.value,
  ),
);
const filteredTiles = computed(() =>
  workspace.value.tiles.filter(
    (t) =>
      (!query.value ||
        `${t.id} ${t.message} ${t.answer}`
          .toLowerCase()
          .includes(query.value.toLowerCase())) &&
      (filter.value === "all" ||
        (filter.value === "root"
          ? !t.relatedTileIds.length
          : filter.value === "related" ? t.relatedTileIds.length : nodeType(t) === filter.value)),
  ),
);
const page = ref(1),
  size = ref(10),
  files = ref([]),
  total = ref(0),
  fileLoading = ref(false),
  fileError = ref(""),
  uploadBusy = ref(false),
  fileInput = ref(null),
  chosenFile = ref(null),
  fileSearch = ref("");
const exampleFiles = ref(demoFiles());
const displayedFiles = computed(() =>
  (demo.value
    ? exampleFiles.value.slice(
        (page.value - 1) * size.value,
        page.value * size.value,
      )
    : files.value
  ).filter((f) =>
    `${f.originalFileName} ${f.remark || ""}`
      .toLowerCase()
      .includes(fileSearch.value.toLowerCase()),
  ),
);
const fileTotal = computed(() =>
  demo.value ? exampleFiles.value.length : total.value,
);
const pages = computed(() =>
  Math.max(1, Math.ceil(fileTotal.value / size.value)),
);
const statuses = [
  { label: "待处理", class: "pending" },
  { label: "向量化中", class: "processing" },
  { label: "已完成", class: "success" },
  { label: "处理失败", class: "error" },
];
const toast = ref(null),
  generating = computed(() => workspace.value.generating),
  formError = ref(""),
  connection = ref("unknown");
const api = createApiClient(() => apiBase.value, () => liveMapId.value);
const questionFlow = ref(null);
let restoringMapZoom = false;
const zoomSaves = createMapZoomSaver(error => notify(`缩放比例保存失败：${error.message}。调整比例后可重试。`, true));
function restoreMapZoom() {
  const value = Number(currentMap.value?.zoom ?? 1);
  restoringMapZoom = true;
  try { canvasZoom.value = Number.isFinite(value) ? Math.min(1.5, Math.max(0.35, value)) : 1; }
  finally { restoringMapZoom = false; }
}
watch(canvasZoom, zoom => {
  const map = currentMap.value;
  if (restoringMapZoom || !map) return;
  map.zoom = zoom;
  if (demo.value) return;
  const mapId = map.mapId, client = createApiClient(apiBase.value);
  zoomSaves.save(workspaceKey.value, zoom, value => client.updateMapZoom(mapId, value));
}, { flush: "sync" });
const layouts = reactive(readLayouts());
const arrangements = reactive(readArrangements());
const layoutKey = computed(() => workspaceKey.value);
// Carry existing demo positions into its map once.
if (layouts.demo && !layouts["demo:demo"]) layouts["demo:demo"] = { ...layouts.demo };
const tileLayout = computed(() => layouts[layoutKey.value] || {});
const tileArrangement = computed(() => arrangements[layoutKey.value] || { mode: 'tree', routes: {} });
function moveTile({ id, x, y, reset }) {
  const layout = layouts[layoutKey.value] ||= {};
  if (reset) delete layout[id];
  else layout[id] = { x, y };
}
function saveLayout() {
  try { localStorage.setItem('aureli-tile-layouts', JSON.stringify(layouts)); }
  catch { /* Moving still works when browser storage is unavailable. */ }
  try { localStorage.setItem('aureli-canvas-arrangements', JSON.stringify(arrangements)); }
  catch { /* The current arrangement remains available in memory. */ }
}
function arrangeCanvas({ positions, mode, routes }) {
  layouts[layoutKey.value] = Object.fromEntries(positions.map(({ id, x, y }) => [id, { x, y }]));
  arrangements[layoutKey.value] = { mode, routes };
  saveLayout();
  notify(mode === 'layered' ? '画布已按标签与关联分层整理' : '画布已按关联顺序树状整理');
}
function changeApiBase(base) {
  if (base === apiBase.value) { connection.value = 'connected'; return; }
  stashMapUi();
  apiBase.value = base;
  connection.value = 'unknown';
  maps.value = [];
  liveMapId.value = localStorage.getItem(`aureli-active-map:${serverKey.value}`) || null;
  resetMapUi();
  if (!demo.value) loadMaps();
}
const expanded = ref(null);
let fullscreenOrigin;
watch(expanded, (value, previous) => {
  if (value && !previous && !document.activeElement?.closest('.fullscreen-viewer')) fullscreenOrigin = document.activeElement;
});
function restoreFullscreenFocus() {
  if (!expanded.value && fullscreenOrigin?.isConnected) fullscreenOrigin.focus({ preventScroll: true });
}
const graphLoading = computed(() => workspace.value.loading || !currentMap.value || (!demo.value && mapListLoading.value));
const graphError = computed(() => workspace.value.error);
async function loadWorkspace() {
  if (!liveMapId.value) return;
  const state = live.value, key = workspaceKey.value;
  if (state.loading || state.generating || weightBusy.value || nodeBusy.value || modalBusy.value) return;
  state.loading = true;
  state.error = "";
  try {
    const result = await api.workspace();
    state.tiles = result.data.tiles;
    state.edges = result.data.edges;
    state.labels = result.data.labels || [];
    if (key === workspaceKey.value) {
      if (!state.tiles.some(t => t.id === selected.value)) selected.value = state.tiles[0]?.id || null;
      related.value = related.value.filter(id => state.tiles.some(t => t.id === id));
      connection.value = "connected";
    }
  } catch (error) {
    state.error = error.message;
    if (key === workspaceKey.value) connection.value = "error";
  } finally { state.loading = false; }
}
async function loadMaps() {
  const requestId = ++mapListRequest;
  mapListLoading.value = true;
  mapListError.value = "";
  try {
    const result = await api.listMaps();
    if (requestId !== mapListRequest) return;
    maps.value = result.data.map(map => ({ ...map,
      zoom: zoomSaves.pending(`live:${serverKey.value}:${map.mapId}`) ?? map.zoom ?? canvasZoom.value,
    }));
    if (!maps.value.some(map => map.mapId === liveMapId.value)) {
      liveMapId.value = maps.value[0]?.mapId || null;
      resetMapUi();
    }
    rememberMap();
    if (!demo.value) restoreMapZoom();
    mapListLoading.value = false;
    if (!demo.value) await loadWorkspace();
  } catch (error) {
    if (requestId === mapListRequest) { mapListError.value = error.message; connection.value = "error"; }
  } finally { if (requestId === mapListRequest) mapListLoading.value = false; }
}
function rememberMap() {
  if (demo.value) return;
  const key = `aureli-active-map:${serverKey.value}`;
  if (liveMapId.value) localStorage.setItem(key, liveMapId.value);
  else localStorage.removeItem(key);
  const url = new URL(location.href);
  if (liveMapId.value) url.searchParams.set("map", liveMapId.value);
  else url.searchParams.delete("map");
  history.replaceState(null, "", url);
}
function stashMapUi() {
  workspace.value.ui = { selected: selected.value, related: [...related.value], form: { ...form },
    query: query.value, filter: filter.value, panel: panel.value };
}
function resetMapUi() {
  const ui = workspace.value.ui;
  selected.value = ui?.selected || workspace.value.tiles[0]?.id || null;
  related.value = [...(ui?.related || [])];
  Object.assign(form, ui?.form || { message: "", tileId: newId(), edgeDirection: "DIRECTED", edgeDescription: "" });
  query.value = ui?.query || "";
  filter.value = ui?.filter || "all";
  panel.value = ui?.panel || "detail";
  formError.value = "";
  expanded.value = null;
  resetInspectorPosition();
  restoreMapZoom();
}
async function switchMap(mapId) {
  if (mapSwitchDisabled.value || !visibleMaps.value.some(map => map.mapId === mapId)) return;
  if (mapId !== currentMapId.value) {
    stashMapUi();
    if (demo.value) demoMapId.value = mapId;
    else liveMapId.value = mapId;
    resetMapUi();
    rememberMap();
    if (!demo.value && !workspace.value.generating) loadWorkspace();
  }
  await navigate("graph");
}
function setMapNameInput(element) { mapNameInput.value = element; }
async function openMapForm() {
  if (mapSwitchDisabled.value) return;
  showMapForm.value = true;
  mapListError.value = "";
  await nextTick();
  mapNameInput.value?.focus();
}
async function createMap() {
  if (mapSwitchDisabled.value || !mapName.value.trim()) return;
  mapCreating.value = true;
  mapListError.value = "";
  try {
    const map = demo.value ? { mapId: `demo-${uniqueId()}`, name: mapName.value.trim(), zoom: 1 }
      : (await api.createMap(mapName.value.trim())).data;
    (demo.value ? demoMaps.value : maps.value).push(map);
    mapName.value = "";
    showMapForm.value = false;
    mapCreating.value = false;
    await switchMap(map.mapId);
    notify(demo.value ? "示例图谱已创建" : "图谱已创建");
  } catch (error) { mapListError.value = error.message; }
  finally { mapCreating.value = false; }
}
function mapDeleteDisabled(map) {
  const key = demo.value ? `demo:${map.mapId}` : `live:${serverKey.value}:${map.mapId}`;
  return mapSwitchDisabled.value || mapListLoading.value || !!mapStates[key]?.generating;
}
async function requestMapDelete(map) {
  if (mapDeleteDisabled(map)) return;
  await openModal("deleteMap", map);
}
async function deleteMap(map) {
  if (!demo.value) await api.deleteMap(map.mapId);
  // Invalidate any map list already in flight so it cannot restore the deleted row.
  ++mapListRequest;
  mapListLoading.value = false;
  const index = visibleMaps.value.findIndex(item => item.mapId === map.mapId);
  const remaining = visibleMaps.value.filter(item => item.mapId !== map.mapId);
  const key = demo.value ? `demo:${map.mapId}` : `live:${serverKey.value}:${map.mapId}`;
  zoomSaves.discard(key);
  delete layouts[key];
  delete arrangements[key];
  if (demo.value && map.mapId === "demo") delete layouts.demo;
  saveLayout();
  delete mapStates[key];
  if (demo.value) demoMaps.value = remaining;
  else maps.value = remaining;
  if (currentMapId.value === map.mapId) {
    const nextId = (remaining[index] || remaining[index - 1])?.mapId || null;
    if (demo.value) demoMapId.value = nextId;
    else liveMapId.value = nextId;
    resetMapUi();
    rememberMap();
  }
}
const expandedTile = computed(() =>
  workspace.value.tiles.find((t) => t.id === expanded.value?.tileId),
);
function expandTile(id) {
  selected.value = id;
  expanded.value = { mode: "tile", tileId: id };
}
watch(panel, async (value, previous) => {
  if (value === previous) return;
  await nextTick();
  keepInspectorInBounds();
  animateSurface(document.querySelector('.inspector-body, .empty-inspector'), { axis: 'x', distance: 8, duration: 180 });
});
const questionDialogInput = ref(null),
  questionInput = ref(null),
  heading = ref(null),
  inspectorRoot = ref(null),
  inspectorToggle = ref(null),
  inspectorDragging = ref(false),
  dialog = ref(null),
  modal = ref(null),
  modalBusy = ref(false),
  modalError = ref(""),
  remark = ref("");
const noteDraft = reactive({ tileId: "", title: "", content: "" });
const searchDraft = reactive({ query: "", filter: "all" });
const artifactRelated = ref([]);
const artifactContextTiles = computed(() => workspace.value.tiles.filter(tile => tile.status === "ready" && (modal.value?.type !== "editNote" || tile.id !== noteDraft.tileId)));
function toggleArtifactRelated(id) {
  if (modalBusy.value) return;
  artifactRelated.value = artifactRelated.value.includes(id) ? artifactRelated.value.filter(value => value !== id) : [...artifactRelated.value, id];
}
const attachment = ref(null), nodeBusy = ref(false);
const nodeType = tile => tile?.tileType || "QA";
const fusionTiles = computed(() => workspace.value.tiles.filter(tile =>
  related.value.includes(tile.id) && nodeType(tile) === "QA" && tile.status === "ready"
  && tile.message?.trim() && tile.answer?.trim()));
const fusionBusy = computed(() => generating.value || graphLoading.value || nodeBusy.value || modalBusy.value || weightBusy.value);
const splitRequirements = ref("");
const splitTile = computed(() => {
  if (related.value.length !== 1) return null;
  const tile = workspace.value.tiles.find(tile => tile.id === related.value[0]);
  return tile && nodeType(tile) === "QA" && tile.status === "ready"
    && tile.message?.trim() && tile.answer?.trim() ? tile : null;
});
async function requestSplit() {
  if (fusionBusy.value || !splitTile.value) return;
  splitRequirements.value = "";
  await openModal("split", { id: splitTile.value.id, message: splitTile.value.message, splitId: uniqueId() });
  dialog.value.querySelector('#split-requirements')?.focus();
}
async function splitSelectedTile(source) {
  const requirements = splitRequirements.value.trim();
  if (requirements.length > 2000) throw new Error("拆分要求最多 2000 个字符。");
  let result;
  if (demo.value) {
    const original = workspace.value.tiles.find(tile => tile.id === source.id);
    const tiles = ["核心要点", "条件与应用"].map(topic => ({
      id: newId(), tileType: "QA", kind: "memory", status: "ready", weight: original.weight ?? 1, labelId: original.labelId ?? null,
      message: `${original.message}：${topic}`,
      answer: `这是拆分示例，用于演示子 Tile 的关联与阅读。真实工作区会先由 AI 判断拆分价值，再细分回答。${requirements ? `\n\n本次要求：${requirements}` : ""}\n\n来源问答：\n${original.answer}`,
      relatedTileIds: [source.id],
    }));
    result = { tiles, edges: tiles.map(tile => ({
      id: `edge-${uniqueId()}`, sourceTileId: source.id, targetTileId: tile.id,
      direction: "DIRECTED", relationType: "DIVIDES", weight: 1,
      description: requirements ? `手动拆分：${requirements}` : "手动拆分",
    })) };
  } else {
    result = (await api.splitTile({ sourceTileId: source.id, requirements, splitId: source.splitId })).data;
    connection.value = "connected";
  }
  // Preserve the existing graph positions and place the new branch beside its source.
  const positions = positionTiles(workspace.value.tiles, tileLayout.value);
  const origin = positions.find(tile => tile.id === source.id);
  const layout = { ...tileLayout.value, ...Object.fromEntries(positions.map(tile => [tile.id, { x: tile.x, y: tile.y }])) };
  let y = origin.y;
  for (const tile of result.tiles) {
    const point = { x: origin.x + origin.width + 96, y, ...tileDimensions(tile) };
    let overlap;
    while ((overlap = positions.find(other => point.x < other.x + other.width + 32
      && point.x + point.width + 32 > other.x && point.y < other.y + other.height + 32
      && point.y + point.height + 32 > other.y))) point.y = overlap.y + overlap.height + 32;
    layout[tile.id] = { x: point.x, y: point.y };
    positions.push({ ...tile, ...point });
    y = point.y + point.height + 32;
  }
  layouts[layoutKey.value] = layout;
  saveLayout();
  workspace.value.tiles.push(...result.tiles);
  workspace.value.edges.push(...result.edges);
  related.value = [];
  select(result.tiles[0].id);
  inspectorMinimized.value = false;
  return result.tiles.length;
}
async function requestFusion() {
  if (fusionBusy.value || fusionTiles.value.length < 2) return;
  await openModal("fusion", {
    tileId: newId(),
    sources: fusionTiles.value.map(tile => ({ id: tile.id, message: tile.message })),
    ignoredCount: related.value.length - fusionTiles.value.length,
  });
}
async function fuseTiles(selection) {
  const ids = selection.sources.map(tile => tile.id);
  let result;
  if (demo.value) {
    const sources = ids.map(id => workspace.value.tiles.find(tile => tile.id === id));
    const tile = {
      id: selection.tileId, tileType: "QA", kind: "memory", status: "ready",
      message: `综合讨论：${sources.map(tile => tile.message).join("；")}`,
      answer: `这是融合示例。真实工作区会由 AI 重组问题和回答。\n\n${sources.map(tile => tile.answer).join("\n\n")}`,
      labelId: sources.every(source => (source.labelId ?? null) === (sources[0].labelId ?? null)) ? sources[0].labelId ?? null : null,
      relatedTileIds: ids, weight: Math.max(...sources.map(tile => tile.weight ?? 1)),
    };
    result = { tiles: [tile], edges: ids.map(sourceTileId => ({
      id: `edge-${uniqueId()}`, sourceTileId, targetTileId: tile.id,
      direction: "DIRECTED", relationType: "FUSES", weight: 1, description: null,
    })) };
  } else {
    result = (await api.fuseTiles({ tileId: selection.tileId, sourceTileIds: ids })).data;
    connection.value = "connected";
  }
  workspace.value.tiles.push(...result.tiles);
  workspace.value.edges.push(...result.edges);
  related.value = [];
  select(result.tiles[0].id);
  inspectorMinimized.value = false;
}
const questionContextTiles = computed(() => workspace.value.tiles.filter(tile => tile.status === "ready"));
const nodeLabel = tile => ({ QA: "问答", NOTE: "便签", FILE: "文件" })[nodeType(tile)];
const fileSizeLabel = size => size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1048576).toFixed(1)} MB`;
const form = reactive({
  message: "",
  tileId: newId(),
  edgeDirection: "DIRECTED",
  edgeDescription: "",
});
let toastTimer, filePollTimer;
function scheduleFileRefresh() {
  clearTimeout(filePollTimer);
  if (!demo.value && section.value === 'knowledge' && document.visibilityState === 'visible' && files.value.some(file => file.status === 0 || file.status === 1)) {
    filePollTimer = setTimeout(loadFiles, 2000);
  }
}
function uniqueId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // randomUUID requires HTTPS; getRandomValues also works on an HTTP intranet.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
function newId() {
  return `tile-${Date.now().toString(36)}-${uniqueId().slice(0, 6)}`;
}
function notify(message, error = false) {
  clearTimeout(toastTimer);
  toast.value = { message, error };
  toastTimer = setTimeout(() => (toast.value = null), 4500);
}
async function navigate(id) {
  section.value = id;
  location.hash = id;
  mobileNav.value = false;
  await nextTick();
  heading.value?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  animateSurface(document.querySelector(".workspace-grid, .knowledge-panel, .api-settings-panel"), { axis: "y", distance: 5 });
}
function hashChanged() {
  const id = location.hash.slice(1);
  if (titles[id]) section.value = id;
}
function mediaChanged(event) {
  isMobile.value = event.matches;
  resetInspectorPosition();
  if (!event.matches) mobileNav.value = false;
}
function keyboardNav(event) {
  if (event.key === "Escape" && mobileNav.value) {
    mobileNav.value = false;
    nextTick(() => document.querySelector(".mobile-menu")?.focus());
  }
}
watch(mobileNav, async (open) => {
  if (open) {
    await nextTick();
    document.querySelector(".sidebar-close")?.focus();
  }
});
onMounted(() => {
  if (!demo.value) loadMaps();
  if (section.value === "knowledge") loadFiles();
  document.addEventListener("visibilitychange", scheduleFileRefresh);
  window.addEventListener("hashchange", hashChanged);
  mobileMedia.addEventListener("change", mediaChanged);
  window.addEventListener("resize", scheduleInspectorFit);
  window.addEventListener("keydown", keyboardNav);
});
onUnmounted(() => {
  questionFlow.value?.controller.abort();
  finishInspectorDrag();
  window.removeEventListener("hashchange", hashChanged);
  mobileMedia.removeEventListener("change", mediaChanged);
  window.removeEventListener("resize", scheduleInspectorFit);
  window.removeEventListener("keydown", keyboardNav);
  cancelAnimationFrame(inspectorResizeFrame);
  clearTimeout(toastTimer);
  clearTimeout(filePollTimer);
  document.removeEventListener("visibilitychange", scheduleFileRefresh);
});
watch(section, (id) => {
  clearTimeout(filePollTimer);
  query.value = "";
  if (id === "knowledge") loadFiles();
});
async function switchMode() {
  if (
    generating.value ||
    graphLoading.value ||
    uploadBusy.value ||
    modalBusy.value ||
    fileLoading.value ||
    weightBusy.value ||
    nodeBusy.value
  )
    return;
  stashMapUi();
  demo.value = !demo.value;
  resetMapUi();
  localStorage.setItem("aureli-mode", demo.value ? "demo" : "live");
  related.value = [];
  selected.value = workspace.value.tiles[0]?.id || null;
  form.tileId = newId();
  form.message = "";
  formError.value = "";
  panel.value = "detail";
  page.value = 1;
  fileError.value = "";
  if (!demo.value) await loadMaps();
  if (section.value === "knowledge") await loadFiles();
  notify(
    demo.value ? "已切换到示例模式，操作仅影响示例数据" : "已切换到真实工作区",
  );
}
function toggle(id) {
  if (generating.value || graphLoading.value) return;
  related.value = related.value.includes(id)
    ? related.value.filter((x) => x !== id)
    : [...related.value, id];
}
async function compose(id) {
  if (generating.value || graphLoading.value) return;
  if (id) related.value = [id];
  else related.value = [];
  panel.value = "new";
  inspectorMinimized.value = false;
  form.tileId = newId();
  await nextTick();
  keepInspectorInBounds();
  questionInput.value?.focus();
}
async function openQuestionDialog() {
  if (generating.value || graphLoading.value || modalBusy.value || nodeBusy.value) return;
  formError.value = "";
  await openModal("question");
  questionDialogInput.value?.focus();
}
async function toggleInspector() {
  inspectorMinimized.value = !inspectorMinimized.value;
  await nextTick();
  keepInspectorInBounds();
  inspectorToggle.value?.focus({ preventScroll: true });
}
const inspectorOffset = reactive({ x: 0, y: 0 });
let inspectorDrag, inspectorResizeFrame, inspectorSuppressClick = false;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
function inspectorBounds(element = inspectorRoot.value) {
  const area = element?.closest('.workspace-grid');
  if (!element || !area) return null;
  const rect = element.getBoundingClientRect();
  const areaRect = area.getBoundingClientRect();
  const margin = 12;
  return {
    minX: inspectorOffset.x + areaRect.left + margin - rect.left,
    maxX: inspectorOffset.x + areaRect.right - margin - rect.right,
    minY: inspectorOffset.y + areaRect.top + margin - rect.top,
    maxY: inspectorOffset.y + areaRect.bottom - margin - rect.bottom,
  };
}
function setInspectorOffset(x, y, bounds = inspectorBounds()) {
  if (!bounds) return;
  inspectorOffset.x = Math.round(clamp(x, bounds.minX, bounds.maxX));
  inspectorOffset.y = Math.round(clamp(y, bounds.minY, bounds.maxY));
}
function keepInspectorInBounds() {
  setInspectorOffset(inspectorOffset.x, inspectorOffset.y);
}
function scheduleInspectorFit() {
  cancelAnimationFrame(inspectorResizeFrame);
  inspectorResizeFrame = requestAnimationFrame(() => nextTick(keepInspectorInBounds));
}
function startInspectorDrag(event) {
  if (event.button !== 0 || !event.isPrimary || inspectorDrag) return;
  const bounds = inspectorBounds();
  if (!bounds) return;
  inspectorSuppressClick = false;
  inspectorDrag = {
    pointerId: event.pointerId,
    element: event.currentTarget,
    startX: event.clientX,
    startY: event.clientY,
    originX: inspectorOffset.x,
    originY: inspectorOffset.y,
    bounds,
    active: false,
  };
  window.addEventListener('pointermove', moveInspectorDrag, { passive: false });
  window.addEventListener('pointerup', finishInspectorDrag);
  window.addEventListener('pointercancel', cancelInspectorDrag);
  window.addEventListener('blur', finishInspectorDrag);
  window.addEventListener('keydown', cancelInspectorDragWithEscape, true);
}
function moveInspectorDrag(event) {
  if (!inspectorDrag || event.pointerId !== inspectorDrag.pointerId) return;
  const dx = event.clientX - inspectorDrag.startX;
  const dy = event.clientY - inspectorDrag.startY;
  if (!inspectorDrag.active) {
    if (Math.hypot(dx, dy) < 5) return;
    inspectorDrag.active = true;
    inspectorDragging.value = true;
    inspectorSuppressClick = true;
    inspectorDrag.element.setPointerCapture(inspectorDrag.pointerId);
  }
  event.preventDefault();
  setInspectorOffset(
    inspectorDrag.originX + dx,
    inspectorDrag.originY + dy,
    inspectorDrag.bounds,
  );
}
function finishInspectorDrag(event, cancel = false) {
  if (!inspectorDrag || (event?.pointerId != null && event.pointerId !== inspectorDrag.pointerId)) return;
  const finished = inspectorDrag;
  inspectorDrag = null;
  inspectorDragging.value = false;
  window.removeEventListener('pointermove', moveInspectorDrag);
  window.removeEventListener('pointerup', finishInspectorDrag);
  window.removeEventListener('pointercancel', cancelInspectorDrag);
  window.removeEventListener('blur', finishInspectorDrag);
  window.removeEventListener('keydown', cancelInspectorDragWithEscape, true);
  if (finished.element.hasPointerCapture(finished.pointerId)) finished.element.releasePointerCapture(finished.pointerId);
  if (cancel && finished.active) {
    inspectorOffset.x = finished.originX;
    inspectorOffset.y = finished.originY;
  }
}
function cancelInspectorDrag(event) {
  finishInspectorDrag(event, true);
}
function cancelInspectorDragWithEscape(event) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  finishInspectorDrag(null, true);
}
function captureInspectorClick(event) {
  if (!inspectorSuppressClick) return;
  inspectorSuppressClick = false;
  event.preventDefault();
  event.stopPropagation();
}
function moveInspectorWithKeyboard(event) {
  const direction = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  }[event.key];
  if (!event.altKey || !direction) return;
  event.preventDefault();
  event.stopPropagation();
  const step = event.shiftKey ? 48 : 16;
  setInspectorOffset(
    inspectorOffset.x + direction[0] * step,
    inspectorOffset.y + direction[1] * step,
  );
}
function resetInspectorPosition() {
  inspectorOffset.x = 0;
  inspectorOffset.y = 0;
}
function select(id) {
  selected.value = id;
  if (!generating.value) panel.value = "detail";
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    notify("已复制到剪贴板");
  } catch {
    notify("复制失败，请手动选择并复制内容", true);
  }
}
function questionDraftFingerprint() {
  return JSON.stringify({ form: { ...form }, related: [...related.value], workspace: workspaceKey.value });
}
function demoQuestionPlan(message) {
  const questions = message.split(/[；;\n]+/).map(value => value.trim()).filter(Boolean);
  const suggested = questions.length >= 2 && questions.length <= 4 && questions.every(value => value.length >= 4);
  return { suggested, questions: suggested ? questions : [], reason: "本地示例：这些部分可以分别展开。", planId: uniqueId() };
}
function releaseQuestionFlow(flow) {
  if (questionFlow.value !== flow) return;
  questionFlow.value = null;
  flow.origin.generating = false;
  if (modal.value?.type === "questionPlan") {
    dialog.value.close();
    modal.value = null;
  }
}
async function cancelQuestionFlow() {
  const flow = questionFlow.value;
  if (!flow || modalBusy.value) return;
  flow.cancelled = true;
  flow.controller.abort();
  // 规划阶段没有落库。清理本次请求拥有的临时节点，绝不删除已有上下文来源。
  const temporaryIds = new Set(flow.temporaryIds);
  flow.origin.tiles = flow.origin.tiles.filter(tile => !temporaryIds.has(tile.id));
  flow.origin.edges = flow.origin.edges.filter(edge => !temporaryIds.has(edge.sourceTileId) && !temporaryIds.has(edge.targetTileId));
  if (!flow.isDemo && flow.proposal?.planId)
    api.decideQuestion({ mapId: flow.payload.mapId, planId: flow.proposal.planId, action: "CANCEL" }).catch(() => {});
  releaseQuestionFlow(flow);
  if (flow.originKey === workspaceKey.value) {
    Object.assign(form, flow.draft);
    related.value = [...flow.payload.relatedTileIds];
    selected.value = flow.previousSelection;
    panel.value = "compose";
    if (flow.fromDialog) await openQuestionDialog();
    else { await nextTick(); questionInput.value?.focus(); }
  }
}
async function sendTile(retryTile) {
  if (retryTile) return generateSingleTile(retryTile);
  if (generating.value || graphLoading.value || modalBusy.value || questionFlow.value) return;
  formError.value = "";
  if (!form.message.trim() || !form.tileId.trim()) {
    formError.value = "请填写提问内容和 Tile ID。";
    (modal.value?.type === "question" ? questionDialogInput : questionInput).value?.focus();
    return;
  }
  if (workspace.value.tiles.some(tile => tile.id === form.tileId.trim())) {
    formError.value = "Tile ID 已存在，请使用一个新的 ID。";
    return;
  }
  const flow = reactive({
    origin: workspace.value, originKey: workspaceKey.value, isDemo: demo.value,
    draft: { ...form }, fingerprint: questionDraftFingerprint(), previousSelection: selected.value,
    fromDialog: modal.value?.type === "question", controller: new AbortController(),
    cancelled: false, phase: "planning", proposal: null, temporaryIds: [],
    payload: { mapId: liveMapId.value, message: form.message.trim(), tileId: form.tileId.trim(),
      relatedTileIds: [...related.value], memoryDepth: 3, edgeWeight: 1,
      edgeDirection: form.edgeDirection, relationType: relationTypeForDirection(form.edgeDirection),
      edgeDescription: form.edgeDescription.trim() || undefined },
  });
  if (flow.fromDialog) closeModal();
  questionFlow.value = flow;
  flow.origin.generating = true;
  panel.value = "compose";
  inspectorMinimized.value = false;
  try {
    const proposal = flow.isDemo ? demoQuestionPlan(flow.payload.message)
      : (await api.planQuestion(flow.payload, flow.controller.signal)).data;
    if (flow.cancelled || questionFlow.value !== flow) {
      if (!flow.isDemo && proposal?.planId)
        api.decideQuestion({ mapId: flow.payload.mapId, planId: proposal.planId, action: "CANCEL" }).catch(() => {});
      return;
    }
    flow.proposal = proposal;
    if (flow.fingerprint !== questionDraftFingerprint()) { await cancelQuestionFlow(); return; }
    if (typeof proposal?.suggested !== "boolean" || !Array.isArray(proposal.questions)
      || (proposal.suggested && (!proposal.planId || proposal.questions.length < 2 || proposal.questions.length > 4
        || proposal.questions.some(question => typeof question !== "string" || !question.trim()) || !proposal.reason)))
      throw new Error("服务未返回有效拆分建议。");
    if (!proposal.suggested) {
      releaseQuestionFlow(flow);
      return generateSingleTile(null, flow.payload);
    }
    flow.phase = "suggested";
    await openModal("questionPlan");
    dialog.value.querySelector('.question-decline')?.focus();
  } catch (error) {
    if (flow.cancelled || questionFlow.value !== flow) return;
    if (flow.fingerprint !== questionDraftFingerprint()) { await cancelQuestionFlow(); return; }
    if (error.status === 400 || error.status === 409) {
      await cancelQuestionFlow(); formError.value = error.message;
      return;
    }
    releaseQuestionFlow(flow);
    notify("暂时无法提供拆分建议，将按原问题生成问答。", true);
    return generateSingleTile(null, flow.payload);
  }
}
async function decideQuestionFlow(action) {
  const flow = questionFlow.value;
  if (!flow || flow.phase !== "suggested" || modalBusy.value) return;
  if (flow.fingerprint !== questionDraftFingerprint()) { await cancelQuestionFlow(); return; }
  modalBusy.value = true;
  modalError.value = "";
  try {
    const result = flow.isDemo ? action === "EXECUTE" ? {
      tiles: [{ id: flow.payload.tileId, message: flow.payload.message, answer: "这是原问题的完整示例回答。",
        relatedTileIds: flow.payload.relatedTileIds, tileType: "QA", weight: 1, status: "ready" },
      ...flow.proposal.questions.map((message, index) => ({ id: `tile-divides-${flow.proposal.planId}-${index}`,
        message, answer: `这是“${message}”的独立示例回答。`, relatedTileIds: [flow.payload.tileId], tileType: "QA", weight: 1, status: "ready" }))],
      edges: [...flow.payload.relatedTileIds.map(id => ({ id: `edge-${uniqueId()}`, sourceTileId: id,
        targetTileId: flow.payload.tileId, direction: flow.payload.edgeDirection, relationType: flow.payload.relationType,
        weight: 1, description: flow.payload.edgeDescription })),
      ...flow.proposal.questions.map((_, index) => ({ id: `edge-${uniqueId()}`, sourceTileId: flow.payload.tileId,
        targetTileId: `tile-divides-${flow.proposal.planId}-${index}`, direction: "DIRECTED", relationType: "DIVIDES",
        weight: 1, description: "AI 建议拆分" }))],
    } : null : (await api.decideQuestion({ mapId: flow.payload.mapId, planId: flow.proposal.planId, action })).data;
    if (action === "DECLINE") {
      modalBusy.value = false;
      if (flow.fingerprint !== questionDraftFingerprint()) { await cancelQuestionFlow(); return; }
      releaseQuestionFlow(flow);
      return generateSingleTile(null, flow.payload);
    }
    if (!Array.isArray(result?.tiles) || result.tiles.length !== flow.proposal.questions.length + 1 || !Array.isArray(result.edges))
      throw new Error("服务未返回完整的问答和拆分结果，请同步图谱确认。");
    for (const tile of result.tiles) if (!flow.origin.tiles.some(existing => existing.id === tile.id))
      flow.origin.tiles.push({ ...tile, kind: tile.relatedTileIds?.length ? "memory" : "root" });
    for (const edge of result.edges) if (!flow.origin.edges.some(existing => existing.id === edge.id)) flow.origin.edges.push(edge);
    modalBusy.value = false;
    releaseQuestionFlow(flow);
    if (flow.originKey === workspaceKey.value) {
      selected.value = flow.payload.tileId;
      panel.value = "detail";
      form.message = "";
      form.tileId = newId();
      related.value = [];
      connection.value = flow.isDemo ? connection.value : "connected";
    } else if (flow.origin.ui) {
      flow.origin.ui.form.message = ""; flow.origin.ui.form.tileId = newId(); flow.origin.ui.related = [];
    }
    notify(`已生成原问答及 ${flow.proposal.questions.length} 个子 Tile`);
  } catch (error) {
    modalError.value = error.message;
  } finally { modalBusy.value = false; }
}
async function generateSingleTile(retryTile, plannedPayload) {
  formError.value = "";
  if (generating.value || graphLoading.value) return;
  if (!retryTile && (!form.message.trim() || !form.tileId.trim())) {
    formError.value = "请填写提问内容和 Tile ID。";
    (modal.value?.type === "question" ? questionDialogInput : questionInput).value?.focus();
    return;
  }
  if (
    !retryTile &&
    workspace.value.tiles.some((t) => t.id === form.tileId.trim())
  ) {
    formError.value = "Tile ID 已存在，请使用一个新的 ID。";
    return;
  }
  const origin = workspace.value, originKey = workspaceKey.value, isDemo = demo.value;
  const payload = retryTile?.payload || plannedPayload || {
    message: form.message.trim(),
    tileId: form.tileId.trim(),
    relatedTileIds: [...related.value],
    memoryDepth: 3,
    edgeWeight: 1,
    edgeDirection: form.edgeDirection,
    relationType: relationTypeForDirection(form.edgeDirection),
    edgeDescription: form.edgeDescription.trim() || undefined,
  };
  payload.relationType = relationTypeForDirection(payload.edgeDirection);
  if (modal.value?.type === "question") {
    closeModal();
    inspectorMinimized.value = false;
  }
  const tile =
    retryTile ||
    reactive({
      id: payload.tileId,
      message: payload.message,
      answer: "",
      relatedTileIds: payload.relatedTileIds,
      status: "loading",
      kind: payload.relatedTileIds.length ? "memory" : "root",
      tileType: "QA",
      weight: 1,
      payload,
    });
  if (!retryTile) {
    workspace.value.tiles.push(tile);
    payload.relatedTileIds.forEach((id) =>
      workspace.value.edges.push({
        id: uniqueId(),
        sourceTileId: id,
        targetTileId: tile.id,
        direction: payload.edgeDirection,
        relationType: payload.relationType,
        weight: 1,
        description: payload.edgeDescription,
      }),
    );
  }
  selected.value = tile.id;
  panel.value = "detail";
  origin.generating = true;
  tile.status = "loading";
  tile.answer = "";
  tile.error = "";
  try {
    if (isDemo)
      tile.answer =
        "这是一条示例回答，用于演示 Tile 创建与上下文关联。\n\n在真实工作区中，系统会结合共享 RAG 知识库" +
        (payload.relatedTileIds.length
          ? `与 ${payload.relatedTileIds.length} 个关联 Tile 的工作记忆`
          : "") +
        "，流式生成问题的回答。";
    else {
      await api.completeTile(payload, (answer) => (tile.answer = answer));
      if (originKey === workspaceKey.value) connection.value = "connected";
    }
    tile.status = "ready";
    if (originKey === workspaceKey.value) {
      form.message = "";
      form.tileId = newId();
      related.value = [];
      notify(isDemo ? "示例 Tile 已创建" : "Tile 已生成");
    } else {
      if (origin.ui) { origin.ui.form.message = ""; origin.ui.form.tileId = newId(); origin.ui.related = []; }
      notify("另一张图谱的 Tile 已生成");
    }
  } catch (error) {
    tile.status = "error";
    tile.error = error.message;
    if (originKey === workspaceKey.value) connection.value = "error";
    notify(error.message, true);
  } finally {
    origin.generating = false;
  }
}
async function loadFiles() {
  if (fileLoading.value) return;
  fileError.value = "";
  if (demo.value) return;
  clearTimeout(filePollTimer);
  fileLoading.value = true;
  try {
    const result = await api.listMarkdown({
      current: page.value,
      size: size.value,
    });
    files.value = result.data || [];
    total.value = Number(result.total || 0);
    connection.value = "connected";
  } catch (error) {
    files.value = [];
    total.value = 0;
    fileError.value = error.message;
    connection.value = "error";
  } finally {
    fileLoading.value = false;
    if (!fileError.value) scheduleFileRefresh();
  }
}
async function changePage(delta) {
  page.value += delta;
  await loadFiles();
}
function chooseFile(event) {
  chosenFile.value = event.target.files?.[0] || null;
}
async function upload() {
  if (!chosenFile.value) return notify("请先选择 Markdown 文件", true);
  if (!/\.(md|markdown)$/i.test(chosenFile.value.name))
    return notify("仅支持 .md 或 .markdown 文件", true);
  uploadBusy.value = true;
  try {
    if (demo.value)
      exampleFiles.value.unshift({
        id: Date.now(),
        originalFileName: chosenFile.value.name,
        fileSize: `${(chosenFile.value.size / 1024).toFixed(1)} KB`,
        status: 0,
        remark: "示例上传，文件未发送到服务",
        createTime: new Date()
          .toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
          .replace(" ", "T"),
      });
    else {
      await api.uploadMarkdown(chosenFile.value);
    }
    chosenFile.value = null;
    fileInput.value.value = "";
    page.value = 1;
    await loadFiles();
    notify("上传完成，文件将异步进行向量化处理");
  } catch (error) {
    notify(error.message, true);
  } finally {
    uploadBusy.value = false;
  }
}
async function loadNodeFile(tile) {
  const blob = demo.value ? tile.demoFile : await api.downloadTileFile(tile.id);
  if (!blob) throw new Error("示例文件已失效，请重新添加。");
  return blob;
}
// A new loader identity prevents image previews crossing backend/demo boundaries.
const loadPreviewFile = computed(() => {
  const isDemo = demo.value;
  const mapId = currentMapId.value;
  const client = createApiClient(apiBase.value, () => mapId);
  return async tile => {
    const blob = isDemo ? tile.demoFile : await client.downloadTileFile(tile.id);
    if (!blob) throw new Error("示例文件已失效，请重新添加。");
    return blob;
  };
});
async function downloadNodeFile(tile) {
  if (nodeBusy.value) return;
  nodeBusy.value = true;
  try {
    const blob = await loadNodeFile(tile);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = tile.fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { notify(error.message, true); }
  finally { nodeBusy.value = false; }
}
function syncArtifactEdges(tile) {
  const parents = tile.relatedTileIds || [];
  workspace.value.edges = workspace.value.edges.filter(edge => edge.targetTileId !== tile.id || parents.includes(edge.sourceTileId));
  for (const sourceTileId of parents) {
    if (!workspace.value.edges.some(edge => edge.sourceTileId === sourceTileId && edge.targetTileId === tile.id))
      workspace.value.edges.push({ id: `edge-${crypto.randomUUID()}`, sourceTileId, targetTileId: tile.id, direction: "DIRECTED", relationType: "EXTENDS", weight: 1, description: null });
  }
}
async function addNodeFile(file, relatedTileIds = []) {
  if (!file) throw new Error("请选择文件。");
  if (!file.size) throw new Error("请选择非空文件。");
  if (file.size > 10 * 1024 * 1024) throw new Error("文件大小不能超过 10 MB。");
  const tile = demo.value ? {
    id: newId(), tileType: "FILE", kind: "file", title: file.name,
    message: file.name, answer: file.name, fileName: file.name,
    fileSize: file.size, fileContentType: file.type, demoFile: file,
    relatedTileIds: [...relatedTileIds], status: "ready", weight: 1,
  } : (await api.uploadTileFile(file, relatedTileIds)).data;
  workspace.value.tiles.push(tile);
  syncArtifactEdges(tile);
  select(tile.id);
  inspectorMinimized.value = false;
}
async function dropNodeFile(file) {
  if (nodeBusy.value || generating.value || graphLoading.value || modalBusy.value) return;
  nodeBusy.value = true;
  try { await addNodeFile(file); notify(demo.value ? "示例文件已添加" : "文件已添加到画布"); }
  catch (error) { notify(error.message, true); }
  finally { nodeBusy.value = false; }
}
async function editNodeNote(tile) {
  expanded.value = null;
  await openModal("editNote", tile);
}
async function openLabels() {
  if (fusionBusy.value) return;
  const mapId = currentMapId.value;
  await openModal("labels", { state: workspace.value, tileIds: [...related.value], isDemo: demo.value,
    client: createApiClient(apiBase.value, () => mapId) });
}
async function saveLabel(draft, id) {
  const { state, isDemo, client } = modal.value.file;
  const name = draft.name.trim(), colorHex = draft.colorHex.toUpperCase();
  if (state.labels.some(label => label.id !== id && label.name === name)) throw new Error("当前图谱已有同名标签");
  const label = isDemo ? { id: id ?? `label-${uniqueId()}`, mapId: currentMapId.value, name, colorHex }
    : (await (id == null ? client.createLabel({ name, colorHex }) : client.updateLabel(id, { name, colorHex }))).data;
  const index = state.labels.findIndex(item => item.id === id);
  if (index < 0) state.labels.push(label); else state.labels.splice(index, 1, label);
  notify(id == null ? "标签已创建" : "标签已更新");
  return label;
}
async function removeLabel(id) {
  const { state, isDemo, client } = modal.value.file;
  if (!isDemo) await client.deleteLabel(id);
  state.labels = state.labels.filter(label => label.id !== id);
  for (const tile of state.tiles) if (String(tile.labelId) === String(id)) tile.labelId = null;
  notify("标签已删除，Tile 已保留");
}
async function assignLabel(labelId) {
  const { state, tileIds, isDemo, client } = modal.value.file;
  if (!tileIds.length) throw new Error("请先通过“选择关联”选中 Tile");
  if (!tileIds.every(id => state.tiles.some(tile => tile.id === id))) throw new Error("部分 Tile 已不存在，请同步后重试");
  if (!isDemo) await client.assignLabel(tileIds, labelId);
  for (const tile of state.tiles) if (tileIds.includes(tile.id)) tile.labelId = labelId;
  notify(`已${labelId == null ? "清除" : "设置"} ${tileIds.length} 个 Tile 的标签`);
}
async function openModal(type, file) {
  modal.value = { type, file, tile: type === "deleteTile" ? file : null };
  remark.value = file?.remark || "";
  if (type === "note" || type === "editNote") {
    noteDraft.tileId = file?.id || newId();
    noteDraft.title = file?.title || "";
    noteDraft.content = file?.content || "";
  }
  if (["note", "editNote", "file"].includes(type)) {
    const candidates = new Set(artifactContextTiles.value.map(tile => tile.id));
    artifactRelated.value = [...new Set(type === "editNote" ? file?.relatedTileIds || [] : related.value)].filter(id => candidates.has(id));
  }
  if (type === "file") attachment.value = null;
  if (type === "search") Object.assign(searchDraft, { query: query.value, filter: filter.value });
  modalError.value = "";
  await nextTick();
  dialog.value.showModal();
  if (type === "search") dialog.value.querySelector('#graph-search-query')?.focus();
  animateSurface(dialog.value, { axis: "y", distance: 8 });
}
function applyGraphSearch() {
  query.value = searchDraft.query.trim();
  filter.value = searchDraft.filter;
  closeModal();
}
function closeModal() {
  if (modal.value?.type === "questionPlan") { cancelQuestionFlow(); return; }
  if (!modalBusy.value) {
    dialog.value.close();
    modal.value = null;
  }
}
function removeTileFromWorkspace(tileId) {
  const index = workspace.value.tiles.findIndex((tile) => tile.id === tileId);
  workspace.value.tiles = workspace.value.tiles
    .filter((tile) => tile.id !== tileId)
    .map((tile) => {
      const relatedTileIds = tile.relatedTileIds.filter((id) => id !== tileId);
      return {
        ...tile,
        relatedTileIds,
        kind: nodeType(tile) === "QA" ? relatedTileIds.length ? "memory" : "root" : tile.kind,
      };
    });
  workspace.value.edges = workspace.value.edges.filter(
    (edge) => edge.sourceTileId !== tileId && edge.targetTileId !== tileId,
  );
  related.value = related.value.filter((id) => id !== tileId);
  const layout = layouts[layoutKey.value];
  if (layout?.[tileId]) {
    delete layout[tileId];
    saveLayout();
  }
  if (selected.value === tileId) {
    selected.value =
      workspace.value.tiles[index]?.id ||
      workspace.value.tiles[index - 1]?.id ||
      null;
  }
  if (expanded.value?.tileId === tileId) expanded.value = null;
}
async function requestTileDelete(tile) {
  if (generating.value || graphLoading.value || modalBusy.value) return;
  if (expanded.value?.tileId === tile.id) expanded.value = null;
  await nextTick();
  openModal("deleteTile", tile);
}
async function confirmModal() {
  if (modalBusy.value) return;
  modalBusy.value = true;
  modalError.value = "";
  try {
    const { type, file } = modal.value;
    let splitCount;
    if (type === "fusion") {
      await fuseTiles(file);
    } else if (type === "split") {
      splitCount = await splitSelectedTile(file);
    } else if (type === "note" || type === "editNote") {
      if (!noteDraft.title.trim() || !noteDraft.content.trim()) throw new Error("请填写便签标题和正文。");
      const payload = { ...noteDraft, title: noteDraft.title.trim(), relatedTileIds: [...artifactRelated.value] };
      let tile;
      if (demo.value) {
        const original = type === "editNote" ? workspace.value.tiles.find(t => t.id === payload.tileId) : null;
        tile = { ...original, id: payload.tileId, title: payload.title, message: payload.title,
          content: payload.content, answer: payload.content, tileType: "NOTE", kind: "note",
          relatedTileIds: payload.relatedTileIds, status: "ready", weight: original?.weight || 1, labelId: original?.labelId ?? null };
      } else tile = (await (type === "editNote" ? api.updateNote(payload) : api.createNote(payload))).data;
      if (type === "editNote") {
        const index = workspace.value.tiles.findIndex(t => t.id === tile.id);
        if (index >= 0) workspace.value.tiles[index] = tile;
        else workspace.value.tiles.push(tile);
      } else workspace.value.tiles.push(tile);
      syncArtifactEdges(tile);
      select(tile.id);
      inspectorMinimized.value = false;
    } else if (type === "file") {
      await addNodeFile(attachment.value, artifactRelated.value);
    } else if (type === "reset") {
      if (!demo.value)
        await api.resetWorkspace();
      delete layouts[layoutKey.value];
      delete arrangements[layoutKey.value];
      if (demo.value && demoMapId.value === "demo") delete layouts.demo;
      saveLayout();
      workspace.value.tiles = [];
      workspace.value.edges = [];
      selected.value = null;
      related.value = [];
      form.tileId = newId();
    } else if (type === "delete") {
      if (demo.value)
        exampleFiles.value = exampleFiles.value.filter((f) => f.id !== file.id);
      else
        await api.deleteMarkdown(file.id);
      if (page.value > 1 && displayedFiles.value.length === 1) page.value--;
      await loadFiles();
    } else if (type === "deleteMap") {
      await deleteMap(file);
    } else if (type === "deleteTile") {
      const tile = modal.value.tile;
      if (!demo.value) await api.deleteTile(tile.id);
      removeTileFromWorkspace(tile.id);
    } else if (type === "edit") {
      if (demo.value) file.remark = remark.value.trim();
      else
        await api.updateMarkdown({
          id: file.id,
          remark: remark.value.trim(),
        });
      await loadFiles();
    }
    modalBusy.value = false;
    closeModal();
    if (type === "deleteMap") {
      if (!demo.value) await loadWorkspace();
      await nextTick();
      document.querySelector('.map-item.selected, .map-add')?.focus();
    }
    notify(type === "deleteMap" ? "图谱已删除" : type === "split" ? `${demo.value ? '示例拆分' : '拆分完成'}，已创建 ${splitCount} 个子 Tile` : type === "fusion" ? demo.value ? "示例融合 Tile 已创建" : "融合 Tile 已生成" : type === "deleteTile" ? "Tile 已删除" : "操作已完成");
  } catch (error) {
    modalError.value = error.message;
  } finally {
    modalBusy.value = false;
  }
}
const exportDialog = ref(null);
function exportGraph() {
  exportDialog.value.open(JSON.parse(JSON.stringify({
    mode: demo.value ? "demo" : "live", ...workspace.value, layout: tileLayout.value,
    name: currentMap.value?.name || "aureli-graph", arrangementMode: tileArrangement.value.mode,
  })));
}
</script>

<template>
  <a class="skip-link" href="#main">跳转到主要内容</a>
  <div class="app-shell">
    <div v-if="mobileNav" class="nav-scrim" @click="mobileNav = false"></div>
    <aside
      class="sidebar"
      :class="{ open: mobileNav }"
      aria-label="主导航"
      :inert="isMobile && !mobileNav"
    >
      <button
        v-if="isMobile"
        class="sidebar-close icon-button"
        @click="mobileNav = false"
        aria-label="关闭导航"
      >
        <X :size="18" />
      </button>
      <a
        class="brand"
        href="#graph"
        aria-label="AURELI 首页"
        @click.prevent="navigate('graph')"
      >
        <img
          class="brand-logo"
          src="/branding/aureli-logo.png"
          alt="AURELI"
        />
      </a>
      <button class="workspace-switch" @click="openModal('help')">
        <span class="workspace-avatar">A</span
        ><span><strong>知识图谱空间</strong><small>个人工作空间</small></span
        ><ChevronDown :size="15" />
      </button>
      <span class="nav-caption">WORKSPACE / 工作空间</span>
      <nav aria-label="工作空间">
        <template v-for="item in nav" :key="item.id">
          <a :href="`#${item.id}`" :class="{ active: section === item.id }"
            :aria-current="section === item.id ? 'page' : undefined" @click.prevent="navigate(item.id)">
            <component :is="item.icon" :size="19" aria-hidden="true" /><span>{{ item.label }}</span>
            <span v-if="item.id === 'graph'" class="nav-count">{{ workspace.tiles.length }}</span>
          </a>
          <div v-if="item.id === 'graph'" class="map-navigation" aria-label="图谱列表">
            <div class="map-list">
              <div v-for="map in visibleMaps" :key="map.mapId" class="map-row">
                <button class="map-item" type="button"
                  :class="{ selected: currentMapId === map.mapId }" :aria-pressed="currentMapId === map.mapId"
                  :disabled="mapSwitchDisabled" :title="map.name" @click="switchMap(map.mapId)">
                  <Network :size="15" aria-hidden="true" /><span>{{ map.name }}</span>
                  <Check v-if="currentMapId === map.mapId" :size="14" aria-hidden="true" />
                </button>
                <button type="button" class="icon-button danger-icon map-delete-action"
                  :disabled="mapDeleteDisabled(map)" :aria-label="`删除图谱 ${map.name}`" title="删除图谱"
                  @click.stop="requestMapDelete(map)">
                  <Trash2 :size="12" aria-hidden="true" />
                </button>
              </div>
            </div>
            <p v-if="mapListLoading" class="map-feedback" role="status">正在加载图谱…</p>
            <form v-if="showMapForm" class="map-create-form" @submit.prevent="createMap">
              <label for="map-name">图谱名称</label>
              <input id="map-name" :ref="setMapNameInput" v-model="mapName" required maxlength="100" autocomplete="off"
                :disabled="mapCreating" @keydown.esc.stop="!mapCreating && (showMapForm = false)" />
              <div><button type="submit" :disabled="mapCreating || !mapName.trim()">{{ mapCreating ? '创建中…' : '创建' }}</button>
                <button type="button" :disabled="mapCreating" @click="showMapForm = false">取消</button></div>
            </form>
            <button v-else type="button" class="map-add" :disabled="mapSwitchDisabled || mapListLoading" @click="openMapForm">
              <Plus :size="16" aria-hidden="true" />新建图谱
            </button>
            <div v-if="mapListError" class="map-feedback map-error" role="alert">{{ mapListError }}
              <button v-if="!showMapForm" type="button" @click="loadMaps">重新加载</button>
            </div>
          </div>
        </template>
      </nav>
      <div class="sidebar-bottom">
        <div class="context-note">
          <span class="mini-label">CONNECTED KNOWLEDGE</span
          ><GitBranch :size="24" /><strong>独立思考，自由连接。</strong>
          <p title="songyu.tan@techscience.com">songyu.tan@techscience.com</p>
          <button @click="openModal('help')">
            了解 Tile 工作流<ArrowUpRight :size="15" />
          </button>
        </div>
        <button class="help-link" @click="openModal('help')">
          <CircleHelp :size="18" />使用指南
        </button>
        <div class="profile">
          <span class="profile-avatar">A</span
          ><span><strong title="songyu.tan@techscience.com">songyu.tan@techscience.com</strong><small>本地会话</small></span
          ><span class="profile-dot"></span>
        </div>
      </div>
    </aside>
    <div
      class="main-shell"
      :class="{ 'graph-shell': section === 'graph' }"
      :inert="isMobile && mobileNav"
    >
      <header v-if="section !== 'graph'" class="topbar">
        <div class="breadcrumb">
          <button
            class="mobile-menu icon-button"
            @click="mobileNav = !mobileNav"
            aria-label="展开导航"
            :aria-expanded="mobileNav"
          >
            <Menu :size="20" /></button
          ><span>工作空间</span><ChevronRight :size="14" /><strong>{{
            titles[section]
          }}</strong><span v-if="section === 'graph' && currentMap" class="current-map-name">{{ currentMap.name }}</span>
        </div>
        <div class="topbar-actions">
          <span class="service-state"
            ><i :class="{ connected: !demo && connection === 'connected' }"></i
            >{{
              demo
                ? "示例预览"
                : connection === "connected"
                  ? "服务已连接"
                  : connection === "error"
                    ? "连接异常"
                    : "服务待连接"
            }}</span
          ><span class="top-divider"></span
          ><button
            class="icon-button"
            aria-label="查看使用指南"
            @click="openModal('help')"
          >
            <CircleHelp :size="20" /></button
          ><span class="user-avatar">A</span>
        </div>
      </header>
      <main id="main" class="main-content" :class="{ 'graph-workbench': section === 'graph' }">
        <div :class="section === 'graph' ? 'sr-only' : 'page-heading'">
          <div>
            <div class="eyebrow" v-if="section !== 'graph'">
              {{
                section === "graph"
                  ? "01 / KNOWLEDGE GRAPH"
                  : section === "knowledge"
                    ? "02 / KNOWLEDGE BASE"
                    : "03 / SERVICE SETTINGS"
              }}
            </div>
            <h1 ref="heading" tabindex="-1">
              {{ titles[section]
              }}<span class="preview-tag" v-if="demo && section === 'knowledge'"
                >示例模式</span
              >
            </h1>
            <p v-if="section !== 'graph'">{{ subtitles[section] }}</p>
          </div>
        </div>
        <div class="mode-banner" v-if="section === 'knowledge'">
          <span
            ><FlaskConical :size="16" v-if="demo" /><Database
              :size="16"
              v-else
            />{{
              demo
                ? "正在浏览示例图谱，所有操作仅用于本地演示。"
                : "真实工作区 · Tile 与关系保存在服务端，可同步恢复。"
            }}</span
          ><button
            @click="switchMode"
            :disabled="generating || workspace.loading || mapListLoading || uploadBusy || modalBusy || fileLoading"
          >
            {{ demo ? "进入工作区" : "查看示例" }}<ArrowRight :size="14" />
          </button>
        </div>

        <template v-if="section === 'graph'">
          <div v-if="graphError" class="inline-error" role="alert">{{ graphError }} <button class="text-button" @click="loadWorkspace">重新同步</button></div>
          <div v-if="!currentMap && !mapListLoading && !mapListError" class="surface empty-state no-map-state">
            <Network :size="32" aria-hidden="true" />
            <h2>创建你的第一张图谱</h2>
            <p>从左侧新建图谱，再添加问答、便签和文件。</p>
            <button class="primary" :disabled="mapCreating" @click="mobileNav = isMobile; openMapForm()"><Plus :size="18" aria-hidden="true" />新建图谱</button>
          </div>
          <div v-else
            class="workspace-grid"
            :class="{ 'inspector-is-minimized': inspectorMinimized }"
          >
            <section class="graph-panel surface" aria-label="知识图谱">
              <div class="graph-header">
                <div class="graph-header-leading">
                  <button
                    v-if="isMobile"
                    class="mobile-menu icon-button"
                    @click="mobileNav = !mobileNav"
                    aria-label="展开导航"
                    :aria-expanded="mobileNav"
                  >
                    <Menu :size="20" />
                  </button>
                  <ViewSelect v-model="tab" :motion-enabled="motionEnabled" />
                </div>
                <div class="graph-toolbar-actions">
                  <button type="button" class="icon-button graph-fusion-action" aria-label="融合选中的 AI 问答 Tile" aria-haspopup="dialog"
                    :title="fusionTiles.length < 2 ? '通过“选择关联”选中至少两个已完成的 AI 问答 Tile' : `融合 ${fusionTiles.length} 个 AI 问答 Tile`"
                    :disabled="fusionBusy || fusionTiles.length < 2" @click="requestFusion">
                    <Merge :size="17" aria-hidden="true" />
                  </button>
                  <button type="button" class="icon-button graph-split-action" aria-label="拆分选中的 AI 问答 Tile" aria-haspopup="dialog"
                    :title="splitTile ? `拆分 ${splitTile.id}` : related.length > 1 ? '拆分仅支持一个 Tile，请取消多选关联' : '通过“选择关联”选中一个已完成的 AI 问答 Tile'"
                    :disabled="fusionBusy || !splitTile" @click="requestSplit">
                    <Split :size="17" aria-hidden="true" />
                  </button>
                  <div class="graph-create-actions" role="group" aria-label="新增节点">
                    <button type="button" class="graph-create-label" disabled>新增+</button>
                    <button class="icon-button graph-create-action ai-accent-button" aria-label="打开添加Tile弹窗" title="添加问答" @click="openQuestionDialog" :disabled="generating || graphLoading || modalBusy || nodeBusy"><span class="ai-accent-fill" aria-hidden="true"><span class="ai-accent-colors"></span></span><span class="graph-create-ai" aria-hidden="true">AI</span></button>
                    <button class="icon-button graph-create-action" aria-label="添加便签" title="添加便签" @click="openModal('note')" :disabled="generating || graphLoading || modalBusy || nodeBusy"><StickyNote :size="17" /></button>
                    <button class="icon-button graph-create-action" aria-label="添加文件" title="添加文件" @click="openModal('file')" :disabled="generating || graphLoading || modalBusy || nodeBusy"><Upload :size="17" /></button>
                  </div>
                  <button class="icon-button" aria-label="标签" title="管理标签或为所选 Tile 批量设置标签" aria-haspopup="dialog"
                    :disabled="fusionBusy" @click="openLabels"><Tag :size="17" aria-hidden="true" /></button>
                  <button v-if="!demo" class="icon-button" aria-label="同步图谱" @click="loadWorkspace" :disabled="graphLoading || generating || nodeBusy || modalBusy"><RefreshCw :size="17" :class="{ spinning: graphLoading }" /></button>
                  <button
                    class="icon-button graph-secondary-action"
                    aria-label="导出图谱"
                    title="导出图谱"
                    aria-haspopup="dialog"
                    :disabled="graphLoading || generating || nodeBusy || modalBusy"
                    @click="exportGraph"
                  >
                    <Download :size="18" />
                  </button>
                  <button
                    v-if="tab === 'graph'"
                    class="icon-button"
                    aria-label="全页面查看图谱"
                    title="全页面查看图谱"
                    @click="expanded = { mode: 'graph' }"
                  >
                    <Expand :size="17" /></button
                  ><button
                    class="icon-button"
                    aria-label="重置画布"
                    title="重置画布"
                    @click="openModal('reset')"
                    :disabled="generating || graphLoading || nodeBusy || modalBusy"
                  >
                    <RotateCcw :size="16" />
                  </button>
                  <button
                    class="icon-button graph-search-action"
                    :class="{ 'is-filtered': query || filter !== 'all' }"
                    aria-label="搜索与筛选"
                    aria-haspopup="dialog"
                    :title="query || filter !== 'all' ? '搜索与筛选（已启用）' : '搜索与筛选'"
                    @click="openModal('search')"
                  ><Search :size="18" /></button>
                </div>
              </div>
              <GraphCanvas :key="workspaceKey"
                v-if="tab === 'graph'"
                v-model:zoom="canvasZoom"
                :tiles="workspace.tiles"
                :labels="workspace.labels"
                :layout="tileLayout"
                :arrangement="tileArrangement"
                :workspace-id="workspaceKey"
                :edges="workspace.edges"
                :selected="selected"
                :related="related"
                :query="query"
                :filter="filter"
                :busy="generating || graphLoading || nodeBusy || modalBusy"
                :load-file="loadPreviewFile"
                @select="select"
                @move="moveTile"
                @move-end="saveLayout"
                @arrange="arrangeCanvas"
                @expand="expandTile"
                @delete="requestTileDelete"
                @toggle="toggle"
                @extend="compose"
                @new="compose()"
                @file="dropNodeFile"
                @download="downloadNodeFile"
                @edit-note="editNodeNote"
              />
              <div class="tile-list" v-else>
                <div v-if="!filteredTiles.length" class="empty-state">
                  <Search :size="30" />
                  <h3>暂无匹配的 Tile</h3>
                  <p>调整筛选条件，或创建一个新 Tile。</p>
                </div>
                <article
                  v-for="tile in filteredTiles"
                  :key="tile.id"
                  :class="{ chosen: selected === tile.id, 'tile-label-surface': !!labelForTile(tile, workspace.labels) }"
                  :style="labelStyle(labelForTile(tile, workspace.labels))"
                >
                  <button @click="select(tile.id)">
                    <span class="mono">{{ tile.id }}</span>
                    <small v-if="labelForTile(tile, workspace.labels)" class="tile-label-badge">{{ labelForTile(tile, workspace.labels).name }}</small>
                    <strong>{{ tile.message }}</strong
                    ><span>{{
                      tile.answer || tile.error || "生成中…"
                    }}</span></button
                  ><button
                    class="icon-button"
                    @click="expandTile(tile.id)"
                    :aria-label="`全页面查看 ${tile.id}`"
                  >
                    <Expand :size="16" /></button
                  ><button
                    class="icon-button danger-icon"
                    @click="requestTileDelete(tile)"
                    :disabled="generating || graphLoading || modalBusy"
                    :aria-label="`删除 ${tile.id}`"
                    title="删除 Tile"
                  >
                    <Trash2 :size="16" /></button
                  ><button
                    class="secondary"
                    @click="toggle(tile.id)"
                    :disabled="fusionBusy || tile.status !== 'ready'"
                    :aria-pressed="related.includes(tile.id)"
                  >
                    {{ related.includes(tile.id) ? "已关联" : "选择关联" }}
                  </button>
                </article>
              </div>
              <div class="graph-footer">
                <div class="legend">
                  <span><i class="legend-dot root"></i>独立节点</span
                  ><span><i class="legend-dot rag"></i>检索主题</span
                  ><span><i class="legend-dot memory"></i>关联记忆</span>
                </div>
                <span
                  >{{
                    query || filter !== "all"
                      ? `匹配 ${filteredTiles.length} / `
                      : ""
                  }}{{ workspace.tiles.length }} 个节点 ·
                  {{ workspace.edges.length }} 条关系</span
                >
              </div>
            </section>
            <Transition name="inspector-motion" :css="motionEnabled">
              <aside
                :key="inspectorMinimized ? 'minimized' : 'expanded'"
                ref="inspectorRoot"
                class="inspector surface"
                :class="{ minimized: inspectorMinimized, dragging: inspectorDragging }"
                :style="{ translate: `${inspectorOffset.x}px ${inspectorOffset.y}px` }"
                aria-label="节点配置"
                :title="inspectorMinimized ? '拖动以移动面板；双击复位' : undefined"
                @pointerdown="inspectorMinimized && startInspectorDrag($event)"
                @click.capture="captureInspectorClick"
                @keydown="inspectorMinimized && moveInspectorWithKeyboard($event)"
                @dblclick="inspectorMinimized && resetInspectorPosition()"
              >
              <div class="inspector-header">
                <button
                  v-if="!inspectorMinimized"
                  class="inspector-drag-handle icon-button"
                  type="button"
                  aria-label="拖动节点配置面板"
                  aria-describedby="inspector-drag-help"
                  title="拖动面板；双击复位；Alt + 方向键微调"
                  @pointerdown="startInspectorDrag"
                  @keydown="moveInspectorWithKeyboard"
                  @dblclick="resetInspectorPosition"
                  @dragstart.prevent
                >
                  <GripVertical :size="18" />
                </button>
                <span id="inspector-drag-help" class="sr-only">按住并拖动；双击复位；Alt 加方向键微调，Shift 加速。</span>
                <div v-if="inspectorMinimized" class="inspector-minimized-title">
                  <Settings2 :size="18" />
                  <span>节点配置</span>
                </div>
                <div v-else class="inspector-tabs">
                  <button
                    :class="{ active: panel === 'detail' }"
                    @click="panel = 'detail'"
                    :aria-pressed="panel === 'detail'"
                  >
                    节点详情</button
                  ><button
                    class="ai-accent-button"
                    :class="{ active: panel === 'new' }"
                    @click="panel = 'new'"
                    :aria-pressed="panel === 'new'"
                  >
                    <span class="ai-accent-fill" aria-hidden="true"><span class="ai-accent-colors"></span></span>
                    添加Tile<Plus :size="14" />
                  </button>
                </div>
                <button
                  ref="inspectorToggle"
                  class="inspector-toggle icon-button"
                  :aria-label="inspectorMinimized ? '展开节点配置' : '最小化节点配置'"
                  :title="inspectorMinimized ? '展开节点配置' : '最小化节点配置'"
                  :aria-expanded="!inspectorMinimized"
                  :aria-describedby="inspectorMinimized ? 'inspector-drag-help' : undefined"
                  @click="toggleInspector"
                >
                  <PanelRightOpen v-if="inspectorMinimized" :size="18" />
                  <PanelRightClose v-else :size="18" />
                </button>
              </div>
              <div
                class="inspector-body"
                v-if="!inspectorMinimized && panel === 'detail' && selectedTile"
              >
                <div class="detail-title">
                  <span class="detail-node-icon" :class="selectedTile.kind"
                    ><Network :size="20"
                  /></span>
                  <div>
                    <strong class="mono">{{ selectedTile.id }}</strong
                    ><span class="status-text"
                      ><i></i
                      >{{
                        selectedTile.status === "loading"
                          ? "正在生成回答"
                          : selectedTile.status === "error"
                            ? "生成失败"
                            : nodeType(selectedTile) === "QA" ? "回答已完成" : `${nodeLabel(selectedTile)}已保存`
                      }}</span
                    >
                    <div class="detail-tile-metadata">
                      <span v-if="selectedTileLabel" class="detail-tile-label" :title="selectedTileLabel.name">
                        <i :style="{ backgroundColor: selectedTileLabel.colorHex }" aria-hidden="true"></i>
                        <span>{{ selectedTileLabel.name }}</span>
                      </span>
                      <small
                        class="tile-weight"
                        :class="{ 'tile-weight-high': selectedTileWeightLabel === '非常重要' }"
                      >{{ selectedTileWeightLabel }}</small>
                    </div>
                  </div>
                  <button
                    class="icon-button"
                    aria-label="复制 Tile ID"
                    @click="copy(selectedTile.id)"
                  >
                    <Copy :size="15" />
                  </button>
                  <button
                    class="icon-button danger-icon"
                    :aria-label="`删除 ${selectedTile.id}`"
                    title="删除 Tile"
                    @click="requestTileDelete(selectedTile)"
                    :disabled="generating || graphLoading || modalBusy"
                  >
                    <Trash2 :size="16" />
                  </button>
                </div>
                <div class="detail-section">
                  <h2><span class="section-icon">{{ nodeType(selectedTile) === "QA" ? "Q" : "T" }}</span>{{ nodeType(selectedTile) === "QA" ? "用户问题" : "标题" }}</h2>
                  <p class="question-text">{{ selectedTile.message }}</p>
                </div>
                <div class="detail-section">
                  <h2>
                    <span class="section-icon ai">{{ nodeType(selectedTile) === "QA" ? "AI" : nodeType(selectedTile) === "NOTE" ? "N" : "F" }}</span>{{ nodeType(selectedTile) === "QA" ? "AI 回答" : nodeType(selectedTile) === "NOTE" ? "便签正文" : "文件附件" }}<span
                      class="small-tag"
                      v-if="demo"
                      >示例</span
                    >
                  </h2>
                  <MarkdownAnswer
                    v-if="nodeType(selectedTile) === 'QA'"
                    class="answer-text"
                    :content="selectedTile.answer"
                    :loading="selectedTile.status === 'loading'"
                  />
                  <p v-else class="answer-text">
                    {{
                      selectedTile.answer ||
                      (selectedTile.status === "loading"
                        ? "正在思考并生成回答…"
                        : "暂无回答")
                    }}
                  </p>
                  <template v-if="nodeType(selectedTile) === 'FILE'">
                    <p class="field-help">{{ fileSizeLabel(selectedTile.fileSize) }} · {{ selectedTile.fileContentType || '文件' }}</p>
                    <button class="secondary" @click="downloadNodeFile(selectedTile)" :disabled="nodeBusy"><Download :size="16" />{{ nodeBusy ? '下载中…' : '下载文件' }}</button>
                    <details v-if="selectedTile.content?.trim()" class="file-content-preview">
                      <summary>文件正文</summary>
                      <p class="answer-text">{{ selectedTile.content }}</p>
                    </details>
                    <p v-else class="field-help">该附件暂无可读取的正文，关联后仅建立关系。旧 DOCX / PDF 文件可重新上传以提取文字，图片和扫描件暂不识别。</p>
                  </template>
                  <button v-if="nodeType(selectedTile) === 'NOTE'" class="secondary" @click="editNodeNote(selectedTile)" :disabled="modalBusy"><Pencil :size="16" />编辑便签</button>
                  <div
                    v-if="selectedTile.error"
                    class="inline-error"
                    role="alert"
                  >
                    {{ selectedTile.error
                    }}<button
                      class="text-button"
                      @click="sendTile(selectedTile)"
                      :disabled="generating || graphLoading"
                    >
                      重试生成
                    </button>
                  </div>
                </div>
                <div class="detail-section tile-weight-section">
                  <span class="tile-weight-caption">重要程度</span>
                  <label
                    class="tile-weight-control"
                    :data-weight="selectedTile.weight ?? 1"
                    :aria-busy="weightBusy"
                  >
                    <select
                      :key="selectedTile.id"
                      aria-label="调整当前 Tile 重要程度"
                      aria-describedby="tile-weight-help"
                      :value="selectedTile.weight ?? 1"
                      :disabled="weightBusy || generating || graphLoading || modalBusy || selectedTile.status !== 'ready'"
                      @change="changeTileWeight"
                    >
                      <option v-for="option in weightOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </select>
                    <LoaderCircle v-if="weightBusy" class="spinning" :size="16" aria-hidden="true" />
                    <ChevronDown v-else :size="16" aria-hidden="true" />
                  </label>
                  <small id="tile-weight-help" class="tile-weight-help">{{ nodeType(selectedTile) === "FILE" && !selectedTile.content?.trim() ? "调整节点在画布上的大小" : "此设定会影响 AI 的注意力判断" }}</small>
                </div>
                <div v-if="nodeType(selectedTile) === 'QA'" class="detail-section">
                  <h2><GitBranch :size="15" />上下文来源</h2>
                  <div class="source-item">
                    <span class="source-icon teal"
                      ><Database :size="15"
                    /></span>
                    <div>
                      <strong>共享 RAG 知识库</strong
                      ><small>所有 Tile 可检索</small>
                    </div>
                    <Check :size="14" />
                  </div>
                  <div
                    class="source-item"
                    v-for="id in selectedTile.relatedTileIds"
                    :key="id"
                  >
                    <span class="source-icon purple"><Link2 :size="15" /></span
                    ><button class="text-button mono" @click="select(id)">
                      {{ id }}</button
                    ><ChevronRight :size="14" />
                  </div>
                  <p class="muted" v-if="!selectedTile.relatedTileIds.length">
                    独立节点，未读取其他 Tile 的工作记忆。
                  </p>
                </div>
                <div class="detail-section relations">
                  <h2>
                    关系连接<span class="count-tag">{{
                      selectedEdges.length
                    }}</span>
                  </h2>
                  <div v-for="edge in selectedEdges" :key="edge.id">
                    <span class="mono">{{ edge.sourceTileId }}</span
                    ><span class="edge-type"
                      >{{ edge.direction === "UNDIRECTED" ? "↔" : "→" }}
                      {{ relationTypeForEdge(edge) }}</span
                    ><button
                      class="text-button mono"
                      @click="select(edge.targetTileId)"
                    >
                      {{ edge.targetTileId }}
                    </button>
                  </div>
                  <p class="muted" v-if="!selectedEdges.length">暂无关系连接</p>
                </div>
                <button
                  class="primary full-width"
                  @click="compose(selectedTile.id)"
                  :disabled="generating || selectedTile.status !== 'ready'"
                >
                  <GitBranch :size="16" />从此节点延伸<ArrowUpRight
                    :size="15"
                  />
                </button>
                <p class="inspector-footnote">{{ nodeType(selectedTile) === "FILE" && !selectedTile.content?.trim() ? "文件暂无正文，可关联后继续提问。" : "以当前节点为上下文，继续探索" }}</p>
              </div>
              <div v-else-if="!inspectorMinimized && panel === 'detail'" class="empty-inspector">
                <CircleDot :size="32" />
                <h3>探索每一个知识节点</h3>
                <p>点击图谱中的 Tile，查看回答内容和上下文来源。</p>
                <button class="secondary" @click="compose()">创建 Tile</button>
              </div>
              <QuestionForm
                v-else-if="!inspectorMinimized"
                ref="questionInput"
                class="inspector-body"
                :form="form" :related="related" :generating="generating"
                :planning="questionFlow?.phase === 'planning'"
                :loading="graphLoading" :demo="demo" :error="formError"
                @change="Object.assign(form, $event)" @toggle="toggle"
                @clear-related="related = []" @submit="sendTile()" @blank="compose()"
                @cancel="cancelQuestionFlow()"
              />
              </aside>
            </Transition>
          </div>
        </template>

        <template v-else-if="section === 'knowledge'">
          <section class="upload-panel surface">
            <span class="upload-icon"><Upload :size="24" /></span>
            <div>
              <h2>让文档成为可检索的知识</h2>
              <p>上传 Markdown 问答文件，系统将异步完成向量化处理。</p>
              <label class="file-picker"
                >选择 Markdown 文件<input
                  ref="fileInput"
                  type="file"
                  accept=".md,.markdown"
                  @change="chooseFile"
                  :disabled="uploadBusy"
                /><span v-if="chosenFile">{{ chosenFile.name }}</span></label
              >
            </div>
            <button
              class="primary"
              @click="upload"
              :disabled="uploadBusy || !chosenFile"
            >
              <LoaderCircle
                v-if="uploadBusy"
                :size="16"
                class="spinning"
              /><Upload v-else :size="16" />{{
                uploadBusy ? "上传中…" : "上传到知识库"
              }}
            </button>
          </section>
          <section class="surface knowledge-panel">
            <div class="table-heading">
              <h2>
                知识文档<span class="count-tag">{{ fileTotal }}</span>
              </h2>
              <div>
                <label class="search-field"
                  ><Search :size="16" /><input
                    v-model="fileSearch"
                    aria-label="搜索本页文件"
                    placeholder="搜索本页文件…" /></label
                ><button
                  class="secondary"
                  @click="loadFiles"
                  :disabled="fileLoading"
                >
                  <RefreshCw
                    :size="16"
                    :class="{ spinning: fileLoading }"
                  />刷新
                </button>
              </div>
            </div>
            <div v-if="fileError" class="data-error" role="alert">
              <AlertCircle :size="24" />
              <h3>知识库加载失败</h3>
              <p>{{ fileError }}</p>
              <button class="secondary" @click="loadFiles">重新加载</button>
            </div>
            <div v-else-if="fileLoading" class="empty-state" role="status">
              <LoaderCircle class="spinning" :size="26" />
              <p>正在加载知识文件…</p>
            </div>
            <div v-else-if="!displayedFiles.length" class="empty-state">
              <BookOpen :size="32" />
              <h3>
                {{ fileSearch ? "没有找到匹配文件" : "知识库还没有文档" }}
              </h3>
              <p>
                {{
                  fileSearch
                    ? "调整搜索关键词后重试。"
                    : "上传第一份 Markdown 文件，开始积累共享知识。"
                }}
              </p>
            </div>
            <div v-else class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>文件名称</th>
                    <th>处理状态</th>
                    <th>文件大小</th>
                    <th>备注</th>
                    <th>上传时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="file in displayedFiles" :key="file.id">
                    <td>
                      <span class="file-name"
                        ><FileText :size="19" /><span
                          ><strong>{{ file.originalFileName }}</strong
                          ><small class="mono">ID {{ file.id }}</small></span
                        ></span
                      >
                    </td>
                    <td>
                      <span
                        class="status-pill"
                        :class="statuses[file.status]?.class || 'pending'"
                        >{{ statuses[file.status]?.label || "未知状态" }}</span
                      >
                    </td>
                    <td class="mono">{{ file.fileSize }}</td>
                    <td>{{ file.remark || "—" }}</td>
                    <td class="mono">
                      {{
                        file.createTime?.replace("T", " ").slice(0, 16) || "—"
                      }}
                    </td>
                    <td>
                      <div class="row-actions">
                        <button
                          class="icon-button"
                          @click="openModal('edit', file)"
                          :aria-label="`编辑 ${file.originalFileName} 备注`"
                        >
                          <Pencil :size="16" /></button
                        ><button
                          class="icon-button danger-text"
                          @click="openModal('delete', file)"
                          :disabled="file.status === 0 || file.status === 1"
                          :title="
                            file.status === 0 || file.status === 1
                              ? '文件处理完成后可删除'
                              : '删除文件'
                          "
                          :aria-label="`删除 ${file.originalFileName}`"
                        >
                          <Trash2 :size="16" />
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="pagination">
              <span
                >共 {{ fileTotal }} 个文件 · 第 {{ page }} /
                {{ pages }} 页</span
              >
              <div>
                <label
                  >每页<select
                    v-model.number="size"
                    @change="
                      page = 1;
                      loadFiles();
                    "
                    :disabled="fileLoading"
                  >
                    <option :value="10">10 条</option>
                    <option :value="20">20 条</option>
                    <option :value="50">50 条</option>
                  </select></label
                ><button
                  class="secondary"
                  @click="changePage(-1)"
                  :disabled="page <= 1 || fileLoading"
                >
                  上一页</button
                ><button
                  class="secondary"
                  @click="changePage(1)"
                  :disabled="page >= pages || fileLoading"
                >
                  下一页
                </button>
              </div>
            </div>
          </section>
        </template>
        <ApiSettings
          v-else
          :api-base="apiBase"
          :busy="generating || graphLoading || uploadBusy"
          @base-change="changeApiBase"
          @notify="notify($event.message, $event.error)"
        />
        <footer class="page-footer">
          <span>AURELI <span> / </span> 请仔细鉴别由AI生成的信息</span
          ><span>Vue · Graph Workspace</span>
        </footer>
      </main>
    </div>
    <Transition name="viewer" :css="motionEnabled" @after-leave="restoreFullscreenFocus">
    <FullscreenViewer
      v-if="expanded"
      v-model:zoom="canvasZoom"
      :mode="expanded.mode"
      :tile="expandedTile"
      :tiles="workspace.tiles"
      :labels="workspace.labels"
      :layout="tileLayout"
      :arrangement="tileArrangement"
      :workspace-id="workspaceKey"
      :edges="workspace.edges"
      :selected="selected"
      :related="related"
      :busy="generating || graphLoading || nodeBusy || modalBusy"
      :demo="demo"
      :load-file="loadPreviewFile"
      @close="expanded = null"
      @expand="expandTile"
      @select="select"
      @move="moveTile"
      @move-end="saveLayout"
      @arrange="arrangeCanvas"
      @toggle="toggle"
      @delete="requestTileDelete"
      @extend="compose"
      @new="compose()"
      @file="dropNodeFile"
      @download="downloadNodeFile"
      @edit-note="editNodeNote"
    />
    </Transition>
    <GraphExportDialog ref="exportDialog" :workspace-id="workspaceKey" @notify="notify($event)" />
    <Transition name="toast-motion" :css="motionEnabled">
    <div
      v-if="toast"
      class="toast"
      :class="{ error: toast.error }"
      role="status"
      aria-live="polite"
    >
      <AlertCircle v-if="toast.error" :size="18" /><CheckCircle2
        v-else
        :size="18"
      /><span>{{ toast.message }}</span
      ><button class="icon-button" @click="toast = null" aria-label="关闭提示">
        <X :size="16" />
      </button>
    </div>
    </Transition>
    <dialog
      ref="dialog"
      class="modal"
      :class="{ 'label-modal': modal?.type === 'labels', 'question-modal': modal?.type === 'question', 'artifact-modal': ['note', 'editNote', 'file', 'split', 'questionPlan', 'labels'].includes(modal?.type) }"
      aria-labelledby="workspace-modal-title"
      @cancel.self.prevent="closeModal"
    >
      <template v-if="modal"
        ><div class="modal-header">
          <h2 id="workspace-modal-title">
            {{
              modal.type === "labels" ? "标签"
                : modal.type === "question" ? "添加Tile"
                : modal.type === "questionPlan" ? "AI 建议拆分问题"
                : modal.type === "fusion" ? "融合选中的 AI 问答 Tile？"
                : modal.type === "split" ? "拆分 AI 问答 Tile"
                : modal.type === "search" ? "搜索与筛选"
                : modal.type === "note" ? "添加便签"
                : modal.type === "editNote" ? "编辑便签"
                : modal.type === "file" ? "添加文件"
                : modal.type === "reset"
                ? "重置整个画布？"
                : modal.type === "deleteMap"
                  ? "删除这个图谱？"
                : modal.type === "deleteTile"
                  ? "删除这个 Tile？"
                : modal.type === "delete"
                  ? "删除知识文件？"
                  : modal.type === "edit"
                    ? "编辑文件备注"
                    : "认识 Tile 工作流"
            }}
          </h2>
          <button
            class="icon-button"
            @click="closeModal"
            :disabled="modalBusy"
            aria-label="关闭对话框"
          >
            <X :size="19" />
          </button>
        </div>
        <div class="modal-body">
          <LabelPanel v-if="modal.type === 'labels'" :labels="modal.file.state.labels" :tiles="modal.file.state.tiles"
            :tile-ids="modal.file.tileIds" :save-label="saveLabel" :remove-label="removeLabel" :assign-label="assignLabel"
            @busy="modalBusy = $event" />
          <QuestionForm v-else-if="modal.type === 'question'"
            ref="questionDialogInput" form-id="dialog-question-form"
            :form="form" :related="related" :context-tiles="questionContextTiles"
            :generating="generating" :loading="graphLoading" :demo="demo" :error="formError"
            :show-actions="false"
            @change="Object.assign(form, $event)" @toggle="toggle" @clear-related="related = []"
            @submit="sendTile()"
          />
          <template v-else-if="modal.type === 'questionPlan' && questionFlow">
            <section class="question-plan-original" aria-labelledby="question-plan-original-title">
              <h3 id="question-plan-original-title">原问题</h3>
              <MarkdownAnswer :content="questionFlow.payload.message" />
            </section>
            <section class="question-plan-reason" aria-labelledby="question-plan-reason-title">
              <h3 id="question-plan-reason-title">拆分理由</h3>
              <MarkdownAnswer :content="questionFlow.proposal.reason" />
            </section>
            <section class="question-plan-questions" aria-labelledby="question-plan-questions-title">
              <h3 id="question-plan-questions-title">建议的子问题</h3>
              <ol class="question-plan-list" aria-label="建议的子问题">
                <li v-for="(question, index) in questionFlow.proposal.questions" :key="index"><MarkdownAnswer :content="question" /></li>
              </ol>
            </section>
            <p>执行后将生成 <strong>1 个原始问答 Tile 和 {{ questionFlow.proposal.questions.length }} 个子问答 Tile</strong>，以 DIVIDES 连接。</p>
            <p v-if="modalBusy" role="status" class="question-plan-status">
              <LoaderCircle :size="18" class="spinning" aria-hidden="true" />正在生成问答，整组完成后保存，请稍候…
            </p>
            <p class="field-help">取消将停止本次提问并保留草稿，方便修改问题后重新提交。</p>
          </template>
          <form v-else-if="modal.type === 'search'" id="graph-search-form" class="graph-search-form" @submit.prevent="applyGraphSearch">
            <label for="graph-search-query">搜索内容</label>
            <div class="search-field">
              <Search :size="18" aria-hidden="true" />
              <input id="graph-search-query" v-model="searchDraft.query" aria-label="搜索 Tile" placeholder="搜索问题、回答或 Tile ID…" autocomplete="off" />
              <button v-if="searchDraft.query" type="button" class="icon-button" aria-label="清除搜索" @click="searchDraft.query = ''"><X :size="16" /></button>
            </div>
            <label for="graph-search-filter">节点筛选</label>
            <select id="graph-search-filter" v-model="searchDraft.filter" aria-label="按节点类型筛选">
              <option value="all">全部节点</option>
              <option value="QA">问答</option>
              <option value="NOTE">便签</option>
              <option value="FILE">文件</option>
              <option value="root">独立节点</option>
              <option value="related">关联节点</option>
            </select>
            <button type="button" class="text-button" @click="Object.assign(searchDraft, { query: '', filter: 'all' })">清除搜索和筛选</button>
          </form>
          <form v-else-if="modal.type === 'note' || modal.type === 'editNote'" id="node-form" class="node-artifact-form" @submit.prevent="confirmModal">
            <label for="note-title">便签标题 *</label>
            <input id="note-title" v-model="noteDraft.title" required maxlength="255" :disabled="modalBusy" />
            <label for="note-content">便签正文 *</label>
            <textarea id="note-content" v-model="noteDraft.content" required maxlength="100000" rows="8" :disabled="modalBusy"></textarea>
            <ContextPicker :related="artifactRelated" :context-tiles="artifactContextTiles" :disabled="modalBusy"
              @toggle="toggleArtifactRelated" @clear="artifactRelated = []" />
            <p class="field-help">保存到画布；便签可作为提问的上下文。</p>
          </form>
          <form v-else-if="modal.type === 'file'" id="node-form" class="node-artifact-form" @submit.prevent="confirmModal">
            <label for="node-file">选择文件 *</label>
            <input id="node-file" type="file" required :disabled="modalBusy" @change="attachment = $event.target.files[0] || null" />
            <p class="field-help">支持 .pdf、.docx 等文件，每个文件最多 10 MB，当前仅支持文字的识别</p>
            <ContextPicker :related="artifactRelated" :context-tiles="artifactContextTiles" :disabled="modalBusy"
              @toggle="toggleArtifactRelated" @clear="artifactRelated = []" />

          </form>
          <form v-else-if="modal.type === 'split'" id="split-form" class="node-artifact-form" @submit.prevent="confirmModal">
            <p class="split-source"><strong class="mono">{{ modal.file.id }}</strong><span>{{ modal.file.message }}</span></p>
            <p id="split-help" class="field-help">“拆分”操作会尝试生成 2～4 个可独立阅读的子问答，该操作不一定在所有情况下可用。</p>
            <label for="split-requirements">拆分应该如何进行？（可选）</label>
            <textarea id="split-requirements" v-model="splitRequirements" maxlength="2000" rows="4"
              :disabled="modalBusy" aria-describedby="split-help split-requirements-help"
              placeholder="例如：按实施步骤拆分、重点展开技术方案、面向初学者解释"></textarea>
            <p v-if="demo" class="field-help">当前为示例模式，仅演示拆分效果；真实工作区会进行 AI 价值判断。</p>
            <p v-if="modalBusy" role="status" class="field-help">请稍候…</p>
          </form>
          <template v-else-if="modal.type === 'fusion'">
            <p>“融合”操作将以下 {{ modal.file.sources.length }} 个 AI 问答 Tile 的用户问题和回答融合为一个新的 Tile。原 Tile 将保留，并关联到新 Tile。</p>
            <ul class="fusion-source-list">
              <li v-for="tile in modal.file.sources" :key="tile.id"><strong class="mono">{{ tile.id }}</strong><span>{{ tile.message }}</span></li>
            </ul>
            <p class="field-help">便签和文件不会参与融合{{ modal.file.ignoredCount ? `，本次已排除 ${modal.file.ignoredCount} 个选中节点` : '' }}。</p>
            <p v-if="demo" class="field-help">当前为示例模式，仅演示融合效果。</p>
          </template>
          <template v-else-if="modal.type === 'help'"
            ><p>把每次提问变成一个独立的知识节点。</p>
            <ol class="help-steps">
              <li>
                <strong>创建 Tile</strong>
                <p>输入问题，系统结合共享 RAG 知识库生成回答。</p>
              </li>
              <li>
                <strong>选择关联</strong>
                <p>
                  在画布中选择一个或多个已完成的 Tile 作为下次提问的上下文。
                </p>
              </li>
              <li>
                <strong>延伸探索</strong>
                <p>
                  设置单向或双向关系，新 Tile 将沿关联链读取最多 3 层工作记忆。
                </p>
              </li>
            </ol>
            <p class="field-help">
              示例数据仅用于演示。真实工作区不会携带示例节点；页面刷新后从数据库恢复真实图谱。
            </p>
            <button class="secondary" @click="switchMode(); closeModal()" :disabled="generating || workspace.loading || mapListLoading || uploadBusy || modalBusy || fileLoading">
              {{ demo ? "进入工作区" : "查看示例" }}<ArrowRight :size="16" />
            </button></template
          >
          <p v-else-if="modal.type === 'reset'">
            {{
              demo
                ? "将清空当前示例图谱。"
                : "将清空当前图谱的所有 Tile 节点、消息和关系边，保留标签，此操作不可撤销。"
            }}
            RAG 知识库将保留。
          </p>
          <p v-else-if="modal.type === 'delete'">
            将删除「{{ modal.file.originalFileName }}」{{
              demo ? "的示例记录。" : "及其关联向量数据，此操作不可撤销。"
            }}
          </p>
          <p v-else-if="modal.type === 'deleteMap'">
            将永久删除「{{ modal.file.name }}」及其全部 Tile、标签、正文、附件、消息和关系，此操作不可撤销。
          </p>
          <p v-else-if="modal.type === 'deleteTile'">
            将永久删除「{{ modal.tile.id }}」以及它的正文、附件、全部消息和关系边。其他 Tile 将不再引用此节点，此操作不可撤销。
          </p>
          <template v-else-if="modal.type === 'edit'"
            ><p>{{ modal.file.originalFileName }}</p>
            <label for="remark">备注</label
            ><textarea
              id="remark"
              v-model="remark"
              rows="4"
              maxlength="200"
              :disabled="modalBusy"
            ></textarea>
            <p class="field-help">最多 200 个字符。</p></template
          >
          <p v-if="modalError" class="inline-error" role="alert">
            {{ modalError }}
          </p>
        </div>
        <div class="modal-actions">
          <button class="secondary" @click="closeModal" :disabled="modalBusy">
            {{ modal.type === "help" ? "知道了" : modal.type === "labels" ? "关闭" : "取消" }}</button
          ><template v-if="modal.type === 'questionPlan'">
            <button v-if="questionFlow?.phase === 'suggested'" class="secondary question-decline"
              :disabled="modalBusy" @click="decideQuestionFlow('DECLINE')">不执行拆分</button>
            <button v-if="questionFlow?.phase === 'suggested'" class="primary"
              :disabled="modalBusy" @click="decideQuestionFlow('EXECUTE')">
              <LoaderCircle v-if="modalBusy" :size="16" class="spinning" aria-hidden="true" />执行拆分
            </button>
          </template><button v-else-if="modal.type === 'question'" class="primary"
            type="submit" form="dialog-question-form" :disabled="generating || graphLoading">
            <LoaderCircle v-if="generating" :size="16" class="spinning" /><Send v-else :size="16" />
            {{ generating ? "正在生成…" : demo ? "生成示例 Tile" : "发送并生成 Tile" }}
          </button><button v-else-if="modal.type === 'search'" class="primary" type="submit" form="graph-search-form">应用筛选</button><button
            v-else-if="!['help', 'labels'].includes(modal.type)"
            :class="['edit', 'note', 'editNote', 'file', 'fusion', 'split'].includes(modal.type) ? 'primary' : 'danger'"
            :type="['note', 'editNote', 'file', 'split'].includes(modal.type) ? 'submit' : 'button'"
            :form="modal.type === 'split' ? 'split-form' : ['note', 'editNote', 'file'].includes(modal.type) ? 'node-form' : undefined"
            @click="!['note', 'editNote', 'file', 'split'].includes(modal.type) && confirmModal()"
            :disabled="modalBusy"
          >
            <LoaderCircle v-if="modalBusy" :size="16" class="spinning" />{{
              modalBusy
                ? modal.type === "split" ? "正在判断并拆分…" : modal.type === "fusion" ? "正在融合…" : "处理中…"
                : modal.type === "split" ? "生成拆分"
                : modal.type === "fusion" ? "确认融合"
                : modal.type === "note" || modal.type === "editNote" ? "保存便签"
                : modal.type === "file" ? "添加到画布"
                : modal.type === "edit"
                  ? "保存备注"
                  : modal.type === "reset"
                    ? "确认重置"
                    : modal.type === "deleteMap"
                      ? "删除图谱"
                    : modal.type === "deleteTile"
                      ? "删除 Tile"
                      : "确认删除"
            }}
          </button>
        </div></template
      >
    </dialog>
  </div>
</template>
