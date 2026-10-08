export async function checkedResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!response.ok || data?.success === false)
    throw new Error(
      data?.message ||
        `请求失败（${response.status}），请检查接口地址或稍后重试。`,
    );
  if (!data) throw new Error("服务返回了非 JSON 内容，请检查接口地址。");
  if (typeof data !== 'object' || Array.isArray(data) || typeof data.success !== 'boolean')
    throw new Error("服务响应格式不正确，请检查项目服务地址。");
  return data;
}
export function endpoint(base, path) {
  return `${base.trim().replace(/\/+$/, "")}${path}`;
}
function connectionError(error) {
  if (error.name === 'TimeoutError') return new Error('请求超时，请检查服务连接或稍后重试。');
  if (error.name === 'AbortError') return new Error('请求已中断，请稍后重试。');
  if (error instanceof TypeError) return new Error('无法连接服务，请确认后端已启动及服务地址正确。');
  return error;
}
async function request(url, options) {
  try { return await fetch(url, options); }
  catch (error) { throw connectionError(error); }
}
export async function postJson(base, path, body) {
  return checkedResponse(
    await request(endpoint(base, path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    }),
  );
}
export async function postWithoutBody(base, path, timeout = 30000) {
  return checkedResponse(
    await request(endpoint(base, path), {
      method: "POST",
      signal: AbortSignal.timeout(timeout),
    }),
  );
}
// Buffer complete SSE events, including UTF-8 characters and JSON split across network chunks.
export async function readSse(response, onText, { requireDone = false } = {}) {
  if (!response.ok) {
    await checkedResponse(response);
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const result = await checkedResponse(response);
    throw new Error(result.message || "接口未返回流式回答，请检查服务配置。");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    answer = "",
    completed = false;
  function event(frame) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return;
    if (data === "[DONE]") { completed = true; return; }
    let value;
    try {
      value = JSON.parse(data);
    } catch {
      value = data;
    }
    if (value?.success === false || value?.error)
      throw new Error(value.message || (typeof value.error === "string" ? value.error : "回答生成失败，请重试。"));
    if (value?.done === true) { completed = true; return; }
    const text =
      typeof value === "string" ? value : (value.v ?? value.content ?? "");
    if (typeof text === "string") {
      answer += text;
      onText(answer);
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        event(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
      }
      if (done) {
        if (buffer.trim()) event(buffer);
        break;
      }
    }
    if (requireDone && !completed) throw new Error("回答连接已中断，尚未确认保存，请重试或同步图谱。");
    if (!answer.trim()) throw new Error("服务未返回回答内容，请重试。");
    return answer;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createApiClient(getBase = () => "") {
  const base = () => typeof getBase === "function" ? getBase() : getBase;
  const get = async (path) => checkedResponse(await request(endpoint(base(), path), { signal: AbortSignal.timeout(30000), cache: "no-store" }));
  const post = (path, data) => postJson(base(), path, data);
  return {
    workspace: () => get("/customer-service/tile/workspace"),
    createNote: (data) => post("/customer-service/tile/note", data),
    updateNote: (data) => post("/customer-service/tile/note/update", data),
    async uploadTileFile(file, relatedTileIds = []) {
      const data = new FormData();
      data.append("file", file);
      for (const id of relatedTileIds) data.append("relatedTileIds", id);
      return checkedResponse(await request(endpoint(base(), "/customer-service/tile/file"), {
        method: "POST", body: data, signal: AbortSignal.timeout(60000),
      }));
    },
    async downloadTileFile(tileId) {
      const response = await request(endpoint(base(), `/customer-service/tile/${encodeURIComponent(tileId)}/file`), {
        signal: AbortSignal.timeout(60000), cache: "no-store",
      });
      if (!response.ok || response.headers.get("content-type")?.includes("application/json")) {
        if (response.status === 404) throw new Error("文件不存在，请同步图谱后重试。");
        await checkedResponse(response);
        throw new Error("文件下载失败，请重试。");
      }
      return response.blob();
    },
    modelSettings: () => get("/customer-service/model-settings"),
    saveModelSettings: (data) => post("/customer-service/model-settings", data),
    testModelSettings: () => postWithoutBody(base(), "/customer-service/model-settings/test", 60000),
    listMarkdown: (data) => post("/customer-service/md/list", data),
    updateMarkdown: (data) => post("/customer-service/md/update", data),
    deleteMarkdown: (id) => post("/customer-service/md/delete", { id }),
    deleteTile: (tileId) => post("/customer-service/tile/delete", { tileId }),
    updateTileWeight: (tileId, weight) => post("/customer-service/tile/weight", { tileId, weight }),
    async fuseTiles(data) {
      return checkedResponse(await request(endpoint(base(), "/customer-service/tile/fusion"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data), signal: AbortSignal.timeout(180000),
      }));
    },
    resetWorkspace: () => post("/customer-service/tile/reset", {}),
    async uploadMarkdown(file) {
      const data = new FormData();
      data.append("file", file);
      return checkedResponse(await request(endpoint(base(), "/customer-service/md/upload"), {
        method: "POST", body: data, signal: AbortSignal.timeout(60000),
      }));
    },
    async completeTile(data, onText) {
      try {
        return await readSse(await request(endpoint(base(), "/customer-service/chat/tile/completion"), {
          method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(data), signal: AbortSignal.timeout(180000),
        }), onText, { requireDone: true });
      } catch (error) { throw connectionError(error); }
    },
  };
}
