const state = {
  tiles: [],
  edges: [],
  selectedTileId: null,
  selectedRelatedTileIds: new Set(),
  tileCounter: 1,
  edgeCounter: 1,
  canvasWidth: 1200,
  canvasHeight: 760,
};

const TILE_WIDTH = 300;
const TILE_HEIGHT = 260;
const TILE_GAP_X = 64;
const TILE_GAP_Y = 96;
const CANVAS_PADDING_X = 48;
const CANVAS_PADDING_Y = 46;
const DEFAULT_MEMORY_DEPTH = 3;
const DEFAULT_EDGE_WEIGHT = 1;

const canvas = document.querySelector("#canvas");
const output = document.querySelector("#output");
const selectedTile = document.querySelector("#selectedTile");
const tileIdInput = document.querySelector("#tileId");

function apiBase() {
  return document.querySelector("#baseUrl").value.trim().replace(/\/$/, "");
}

function endpoint(path) {
  return `${apiBase()}${path}`;
}

function nextTileId() {
  return `tile-${String(state.tileCounter++).padStart(3, "0")}`;
}

function nextEdgeId() {
  return `edge-${String(state.edgeCounter++).padStart(3, "0")}`;
}

function writeOutput(title, data) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  output.textContent = `[${new Date().toLocaleTimeString()}] ${title}\n${text}\n\n${output.textContent}`;
}

function parseSseChunk(frame) {
  const data = frame.split("\n").filter(line => line.startsWith("data:"))
    .map(line => line.slice(5).replace(/^ /, "")).join("\n");
  if (!data) return { text: "", done: false };
  if (data === "[DONE]") return { text: "", done: true };
  let parsed;
  try { parsed = JSON.parse(data); } catch { return { text: data, done: false }; }
  if (parsed.error || parsed.success === false) throw new Error(parsed.error || parsed.message || "回答生成失败");
  return { text: parsed.v ?? parsed.content ?? "", done: parsed.done === true };
}

async function postJson(path, body) {
  const response = await fetch(endpoint(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function readStream(response, onText) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let full = "", buffer = "", completed = false;
  function consume(frame) {
    const event = parseSseChunk(frame);
    completed ||= event.done;
    if (event.text) { full += event.text; onText(event.text, full); }
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        consume(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
      }
      if (done) { if (buffer.trim()) consume(buffer); break; }
    }
    if (!completed) throw new Error("回答连接已中断，尚未确认保存，请重试。");
    return full;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function postStream(path, body, onText) {
  const response = await fetch(endpoint(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return readStream(response, onText);
}

function seedWorkspace() {
  state.tiles = [];
  state.edges = [];
  state.selectedRelatedTileIds = new Set();
  state.tileCounter = 1;
  state.edgeCounter = 1;
  state.selectedTileId = null;
  tileIdInput.value = nextTileId();
  render();
}

async function resetWorkspace() {
  try {
    const result = await postJson("/customer-service/tile/reset", {});
    seedWorkspace();
    writeOutput("重置画布", result);
  } catch (error) {
    writeOutput("重置画布失败", error.message);
  }
}

function render() {
  autoLayoutTiles();
  canvas.innerHTML = "";
  renderEdges();
  state.tiles.forEach(renderTile);
  renderSelectedTile();
}

function renderEdges() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("edge-layer");
  svg.setAttribute("viewBox", `0 0 ${state.canvasWidth} ${state.canvasHeight}`);
  svg.style.width = `${state.canvasWidth}px`;
  svg.style.height = `${state.canvasHeight}px`;

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `
    <marker id="arrow-end" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#c47a1d"></path>
    </marker>
  `;
  svg.appendChild(defs);

  state.edges.forEach((edge) => {
    const source = state.tiles.find((tile) => tile.id === edge.sourceTileId);
    const target = state.tiles.find((tile) => tile.id === edge.targetTileId);
    if (!source || !target) return;

    const x1 = source.x + TILE_WIDTH / 2;
    const y1 = source.y + TILE_HEIGHT;
    const x2 = target.x + TILE_WIDTH / 2;
    const y2 = target.y;
    const midY = y1 + (y2 - y1) / 2;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#c47a1d");
    path.setAttribute("stroke-width", "2.4");
    path.setAttribute("stroke-dasharray", "8 6");
    path.setAttribute("marker-end", "url(#arrow-end)");
    if (edge.direction === "UNDIRECTED") {
      path.setAttribute("marker-start", "url(#arrow-end)");
    }
    svg.appendChild(path);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.classList.add("edge-label");
    label.setAttribute("x", String((x1 + x2) / 2));
    label.setAttribute("y", String(midY - 8));
    label.setAttribute("text-anchor", "middle");
    label.textContent = edge.relationType || "RELATED";
    svg.appendChild(label);
  });

  canvas.appendChild(svg);
}

function renderTile(tile) {
  const el = document.createElement("article");
  const isSelected = tile.id === state.selectedTileId;
  const isRelated = state.selectedRelatedTileIds.has(tile.id);
  el.className = `tile ${isSelected ? "selected" : ""} ${isRelated ? "related-selected" : ""}`;
  el.style.left = `${tile.x}px`;
  el.style.top = `${tile.y}px`;
  el.dataset.id = tile.id;

  el.innerHTML = `
    <div class="tile-head">
      <span class="tile-id">${escapeHtml(tile.id)}</span>
      <span class="tile-mode">${tile.relatedTileIds?.length ? `关联 ${tile.relatedTileIds.length} 个 Tile` : "空白处提问"}</span>
    </div>
    <div class="tile-body">
      <div class="tile-block">
        <span class="tile-label">USER</span>
        <div class="tile-text">${escapeHtml(tile.message)}</div>
      </div>
      <div class="tile-block">
        <span class="tile-label">AI</span>
        <div class="tile-text">${escapeHtml(tile.answer || "等待响应...")}</div>
      </div>
    </div>
    <div class="tile-actions">
      <button class="tile-select ${isRelated ? "primary-soft" : "secondary"}" data-action="toggle-related" type="button">
        <span class="tile-check" aria-hidden="true">${isRelated ? "✓" : ""}</span>
        ${isRelated ? "已选择" : "选择关联"}
      </button>
      <button class="secondary" data-action="extend" type="button">从此延伸</button>
      <button class="secondary" data-action="copy" type="button">复制 ID</button>
    </div>
  `;

  el.addEventListener("click", () => {
    state.selectedTileId = tile.id;
    render();
  });

  el.querySelector('[data-action="toggle-related"]').addEventListener("click", (event) => {
    event.stopPropagation();
    toggleRelatedTile(tile.id);
  });

  el.querySelector('[data-action="extend"]').addEventListener("click", (event) => {
    event.stopPropagation();
    state.selectedTileId = tile.id;
    setSelectedRelatedTileIds([tile.id]);
    tileIdInput.value = nextTileId();
    document.querySelector("#tileMessage").focus();
    render();
  });

  el.querySelector('[data-action="copy"]').addEventListener("click", async (event) => {
    event.stopPropagation();
    await navigator.clipboard.writeText(tile.id);
    writeOutput("已复制 Tile ID", tile.id);
  });

  canvas.appendChild(el);
}

function selectedRelatedTileIds() {
  return Array.from(state.selectedRelatedTileIds);
}

function setSelectedRelatedTileIds(tileIds) {
  state.selectedRelatedTileIds = new Set(tileIds.filter(Boolean));
}

function toggleRelatedTile(tileId) {
  if (state.selectedRelatedTileIds.has(tileId)) {
    state.selectedRelatedTileIds.delete(tileId);
  } else {
    state.selectedRelatedTileIds.add(tileId);
  }
  render();
}

function renderSelectedTile() {
  const tile = state.tiles.find((item) => item.id === state.selectedTileId);
  if (!tile) {
    selectedTile.innerHTML = '<p class="muted">选择一个 Tile 查看它的来源链和回答内容。</p>';
    return;
  }

  const relatedText = tile.relatedTileIds?.length ? tile.relatedTileIds.join(", ") : "未关联";
  const edgeText = state.edges
    .filter((edge) => edge.sourceTileId === tile.id || edge.targetTileId === tile.id)
    .map((edge) => escapeHtml(`${edge.sourceTileId} ${edge.direction === "UNDIRECTED" ? "<->" : "->"} ${edge.targetTileId} · ${edge.relationType}`))
    .join("<br>") || "暂无";

  selectedTile.innerHTML = `
    <h3>${escapeHtml(tile.id)}</h3>
    <div class="context-list">
      <div class="context-item">RAG 知识库：所有 Tile 共享</div>
      <div class="context-item">相关 Tile：${escapeHtml(relatedText)}</div>
      <div class="context-item">关系边：${edgeText}</div>
      <div class="context-item">状态：${tile.status === "loading" ? "生成中" : "已完成"}</div>
    </div>
    <div class="context-list">
      <div class="context-item"><strong>用户问题</strong><br>${escapeHtml(tile.message)}</div>
      <div class="context-item"><strong>AI 回答</strong><br>${escapeHtml(tile.answer || "暂无")}</div>
    </div>
  `;
}

function autoLayoutTiles() {
  if (!state.tiles.length) {
    state.canvasWidth = 1200;
    state.canvasHeight = 760;
    return;
  }

  const tileById = new Map(state.tiles.map((tile) => [tile.id, tile]));
  const childrenByParent = new Map();
  const primaryParentByChild = new Map();

  state.edges.forEach((edge) => {
    if (!tileById.has(edge.sourceTileId) || !tileById.has(edge.targetTileId)) return;
    if (primaryParentByChild.has(edge.targetTileId)) return;
    primaryParentByChild.set(edge.targetTileId, edge.sourceTileId);
    const children = childrenByParent.get(edge.sourceTileId) || [];
    children.push(tileById.get(edge.targetTileId));
    childrenByParent.set(edge.sourceTileId, children);
  });

  const roots = state.tiles.filter((tile) => !primaryParentByChild.has(tile.id));
  let cursorX = CANVAS_PADDING_X;
  let maxDepth = 0;
  const visited = new Set();

  const layoutSubtree = (tile, depth) => {
    if (visited.has(tile.id)) {
      tile.x = cursorX;
      tile.y = CANVAS_PADDING_Y + depth * (TILE_HEIGHT + TILE_GAP_Y);
      cursorX += TILE_WIDTH + TILE_GAP_X;
      return tile.x + TILE_WIDTH / 2;
    }

    visited.add(tile.id);
    maxDepth = Math.max(maxDepth, depth);

    const children = childrenByParent.get(tile.id) || [];
    if (!children.length) {
      tile.x = cursorX;
      cursorX += TILE_WIDTH + TILE_GAP_X;
    } else {
      const childCenters = children.map((child) => layoutSubtree(child, depth + 1));
      tile.x = (childCenters[0] + childCenters[childCenters.length - 1]) / 2 - TILE_WIDTH / 2;
    }

    tile.y = CANVAS_PADDING_Y + depth * (TILE_HEIGHT + TILE_GAP_Y);
    return tile.x + TILE_WIDTH / 2;
  };

  roots.forEach((root, index) => {
    if (index > 0) cursorX += TILE_GAP_X;
    layoutSubtree(root, 0);
  });

  state.tiles.forEach((tile) => {
    if (visited.has(tile.id)) return;
    tile.x = cursorX;
    tile.y = CANVAS_PADDING_Y;
    cursorX += TILE_WIDTH + TILE_GAP_X;
  });

  const rightEdge = Math.max(...state.tiles.map((tile) => tile.x + TILE_WIDTH), 0);
  state.canvasWidth = Math.max(1200, rightEdge + CANVAS_PADDING_X);
  state.canvasHeight = Math.max(760, CANVAS_PADDING_Y * 2 + (maxDepth + 1) * TILE_HEIGHT + maxDepth * TILE_GAP_Y);
}

function createTile({ id, relatedTileIds, message, edgeDirection, relationType, edgeWeight, edgeDescription }) {
  const tile = {
    id,
    relatedTileIds,
    message,
    answer: "",
    x: CANVAS_PADDING_X,
    y: CANVAS_PADDING_Y,
    status: "loading",
  };
  state.tiles.push(tile);
  relatedTileIds.forEach((relatedTileId) => {
    state.edges.push({
      id: nextEdgeId(),
      sourceTileId: relatedTileId,
      targetTileId: id,
      direction: edgeDirection,
      relationType,
      weight: edgeWeight,
      description: edgeDescription,
    });
  });
  state.selectedTileId = id;
  render();
  return tile;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".tab-page").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      document.querySelector(`#tab-${button.dataset.tab}`).classList.add("active");
    });
  });
}

function bindForms() {
  document.querySelector("#tileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = tileIdInput.value.trim() || nextTileId();
    const relatedTileIds = selectedRelatedTileIds();
    const memoryDepth = DEFAULT_MEMORY_DEPTH;
    const edgeDirection = document.querySelector("#edgeDirection").value;
    const relationType = document.querySelector("#relationType").value.trim() || "EXTENDS";
    const edgeWeight = DEFAULT_EDGE_WEIGHT;
    const edgeDescription = document.querySelector("#edgeDescription").value.trim();
    const message = document.querySelector("#tileMessage").value.trim();
    if (!message) return;

    const tile = createTile({ id, relatedTileIds, message, edgeDirection, relationType, edgeWeight, edgeDescription });
    const payload = {
      message,
      tileId: id,
      relatedTileIds,
      parentTileId: relatedTileIds[0] || undefined,
      memoryDepth,
      edgeDirection,
      relationType,
      edgeWeight,
      edgeDescription: edgeDescription || undefined,
    };
    writeOutput("Tile 请求", payload);

    try {
      const answer = await postStream("/customer-service/chat/tile/completion", payload, (text) => {
        tile.answer += text;
        render();
      });
      tile.answer = answer;
      tile.status = "ready";
      writeOutput("Tile 响应完成", answer);
    } catch (error) {
      tile.status = "ready";
      tile.answer = `请求失败：${error.message}`;
      writeOutput("Tile 请求失败", error.message);
    }

    tileIdInput.value = nextTileId();
    document.querySelector("#tileMessage").value = "";
    setSelectedRelatedTileIds([]);
    render();
  });

  document.querySelector("#blankTile").addEventListener("click", () => {
    setSelectedRelatedTileIds([]);
    tileIdInput.value = nextTileId();
    document.querySelector("#tileMessage").focus();
  });

  document.querySelector("#mdUploadForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = document.querySelector("#mdFile").files[0];
    if (!file) return writeOutput("上传失败", "请选择 Markdown 文件");
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(endpoint("/customer-service/md/upload"), { method: "POST", body: formData });
    writeOutput("上传 Markdown", await safeResponse(response));
  });

  document.querySelector("#mdListForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    writeOutput("Markdown 文件列表", await postJson("/customer-service/md/list", {
      current: Number(document.querySelector("#mdCurrent").value),
      size: Number(document.querySelector("#mdSize").value),
    }));
  });

  document.querySelector("#mdUpdateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    writeOutput("更新 Markdown 备注", await postJson("/customer-service/md/update", {
      id: Number(document.querySelector("#mdUpdateId").value),
      remark: document.querySelector("#mdRemark").value.trim(),
    }));
  });

  document.querySelector("#mdDeleteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    writeOutput("删除 Markdown 文件", await postJson("/customer-service/md/delete", {
      id: Number(document.querySelector("#mdDeleteId").value),
    }));
  });

}

async function safeResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

document.querySelector("#clearOutput").addEventListener("click", () => {
  output.textContent = "";
});

document.querySelector("#resetWorkspace").addEventListener("click", resetWorkspace);

bindTabs();
bindForms();
seedWorkspace();
