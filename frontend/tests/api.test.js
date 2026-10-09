import { test } from "node:test";
import assert from "node:assert/strict";
import { checkedResponse, readSse, endpoint, createApiClient } from "../src/lib/api.js";
function stream(text, chunkSize = 1) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunkSize)
          controller.enqueue(bytes.slice(i, i + chunkSize));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
test("SSE preserves fragmented JSON, Chinese UTF-8, whitespace and CRLF events", async () => {
  const result = await readSse(
    stream(
      ': keepalive\r\n\r\ndata: {"v":"你好 "}\r\n\r\ndata: {"v":"知识\\n图谱"}\r\n\r\ndata: [DONE]\r\n\r\n',
    ),
    () => {},
  );
  assert.equal(result, "你好 知识\n图谱");
});
test("SSE flushes final event and ignores metadata", async () => {
  assert.equal(
    await readSse(
      stream('event: message\ndata: {"content":"answer"}'),
      () => {},
    ),
    "answer",
  );
});
test("business errors reject even with HTTP 200", async () => {
  await assert.rejects(
    checkedResponse(
      new Response(JSON.stringify({ success: false, message: "文件正在处理" })),
    ),
    /文件正在处理/,
  );
  await assert.rejects(
    readSse(
      stream('data: {"success":false,"message":"生成失败"}\n\n'),
      () => {},
    ),
    /生成失败/,
  );
});

test("manual split sends scoped source and optional requirements and preserves AI rejection reason", async (context) => {
  const calls = [];
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json({ success: true, data: { tiles: [], edges: [] } });
  });
  const api = createApiClient('http://localhost:8080', () => 'map-split');
  await api.splitTile({ sourceTileId: 'source', requirements: '面向初学者' });
  assert.equal(calls[0].url, 'http://localhost:8080/customer-service/tile/split');
  assert.deepEqual(JSON.parse(calls[0].options.body), { sourceTileId: 'source', requirements: '面向初学者', mapId: 'map-split' });
  assert.equal(calls[0].options.method, 'POST');
  globalThis.fetch = async () => Response.json({ success: false, errorCode: 'TILE_NOT_SPLITTABLE', message: '拆分失败：内容只是一个简单定义。' }, { status: 422 });
  await assert.rejects(api.splitTile({ sourceTileId: 'source' }), /拆分失败：内容只是一个简单定义/);
});
test("empty streams and incorrect endpoints do not become successful answers", async () => {
  await assert.rejects(
    readSse(stream("data: [DONE]\n\n"), () => {}),
    /未返回回答/,
  );
  await assert.rejects(
    readSse(
      new Response("<html>index</html>", {
        headers: { "content-type": "text/html" },
      }),
      () => {},
    ),
    /非 JSON/,
  );
});
test("base URL normalization", () => {
  assert.equal(
    endpoint(" http://localhost:8080/// ", "/customer-service/md/list"),
    "http://localhost:8080/customer-service/md/list",
  );
});

test("strict Tile stream confirms completion and rejects truncated/persistence failure", async () => {
  assert.equal(await readSse(stream('data: {"v":"已保存"}\n\ndata: {"done":true}\n\n'), () => {}, { requireDone: true }), "已保存");
  await assert.rejects(readSse(stream('data: {"v":"仅部分回答"}\n\n'), () => {}, { requireDone: true }), /尚未确认保存/);
  await assert.rejects(readSse(stream('data: {"v":"部分回答"}\n\ndata: {"error":"保存失败"}\n\n'), () => {}, { requireDone: true }), /保存失败/);
});
test("client follows changed service address and sends JSON/multipart/SSE contracts", async (context) => {
  const calls = [];
  context.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url, options });
    return url.endsWith('/completion') ? stream('data: {"v":"回答"}\n\ndata: {"done":true}\n\n') : Response.json({ success: true, data: {} });
  });
  let base = 'http://localhost:8080';
  const api = createApiClient(() => base);
  await api.workspace();
  await api.deleteTile('tile-to-delete');
  base = 'http://localhost:8090';
  await api.listMarkdown({ current: 2, size: 10 });
  const file = new File(['# doc'], 'contract.md', { type: 'text/markdown' });
  await api.uploadMarkdown(file);
  assert.equal(await api.completeTile({ tileId: 'id', message: '问题', relatedTileIds: ['parent'] }, () => {}), '回答');
  assert.match(calls[0].url, /8080/);
  assert.match(calls[1].url, /8080\/customer-service\/tile\/delete/);
  assert.deepEqual(JSON.parse(calls[1].options.body), { tileId: 'tile-to-delete' });
  assert.match(calls[2].url, /8090/);
  assert.deepEqual(JSON.parse(calls[2].options.body), { current: 2, size: 10 });
  assert.equal(calls[3].options.body.get('file').name, 'contract.md');
  assert.equal(calls[3].options.headers, undefined);
  assert.equal(calls[4].options.headers.Accept, 'text/event-stream');
  assert.deepEqual(JSON.parse(calls[4].options.body).relatedTileIds, ['parent']);
});

test("model connection test sends no form values to the saved-settings endpoint", async (context) => {
  const calls = [];
  context.mock.method(globalThis, "fetch", async (url, options = {}) => {
    calls.push({ url, options });
    return Response.json({
      success: true,
      data: { model: "fixture-model", reply: "连接成功" },
    });
  });
  const result = await createApiClient("http://localhost:8080").testModelSettings();
  assert.equal(result.data.reply, "连接成功");
  assert.equal(calls[0].url, "http://localhost:8080/customer-service/model-settings/test");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.body, undefined);
});

test("invalid JSON envelopes and offline service produce actionable errors", async (context) => {
  await assert.rejects(checkedResponse(Response.json({ data: [] })), /项目服务地址/);
  context.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(createApiClient().workspace(), /后端已启动/);
});


test("attachment downloads retain binary bytes and reject JSON error envelopes", async (context) => {
  const bytes = new Uint8Array([80, 75, 3, 4, 0, 255]);
  context.mock.method(globalThis, "fetch", async () => new Response(bytes, { headers: { "content-type": "application/octet-stream" } }));
  const api = createApiClient();
  assert.deepEqual(new Uint8Array(await (await api.downloadTileFile("file-1")).arrayBuffer()), bytes);
  globalThis.fetch = async () => Response.json({ success: false, message: "文件读取失败" });
  await assert.rejects(api.downloadTileFile("file-1"), /文件读取失败/);
  globalThis.fetch = async () => new Response(null, { status: 404 });
  await assert.rejects(api.downloadTileFile("file-1"), /文件不存在/);
});

test("note and file creation send selected context IDs and note updates can clear them", async (context) => {
  const calls = [];
  context.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return Response.json({ success: true, data: {} });
  });
  const api = createApiClient();
  await api.createNote({ tileId: "note", title: "标题", content: "正文", relatedTileIds: ["qa", "note-parent"] });
  await api.updateNote({ tileId: "note", title: "标题", content: "正文", relatedTileIds: [] });
  await api.uploadTileFile(new File(["doc"], "测试.docx"), ["qa", "note-parent"]);
  assert.deepEqual(JSON.parse(calls[0].options.body).relatedTileIds, ["qa", "note-parent"]);
  assert.deepEqual(JSON.parse(calls[1].options.body).relatedTileIds, []);
  assert.deepEqual(calls[2].options.body.getAll("relatedTileIds"), ["qa", "note-parent"]);
  assert.equal(calls[2].options.body.get("file").name, "测试.docx");
});

test("map-scoped client captures ownership on every Tile request and leaves shared knowledge global", async (context) => {
  const calls = [];
  context.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/completion')) return stream('data: {"v":"回答"}\n\ndata: {"done":true}\n\n');
    if (url.includes('/file?')) return new Response('attachment');
    return Response.json({ success: true, data: {} });
  });
  let mapId = 'map A';
  const api = createApiClient('', () => mapId);
  await api.listMaps();
  await api.createMap('第二张图谱');
  await api.workspace();
  await api.createNote({ tileId: 'note', title: '标题', content: '正文' });
  await api.updateNote({ tileId: 'note', title: '标题', content: '正文' });
  await api.uploadTileFile(new File(['text'], 'private.docx'));
  await api.downloadTileFile('attachment');
  await api.fuseTiles({ tileId: 'merged', sourceTileIds: ['a', 'b'] });
  const generation = api.completeTile({ tileId: 'question', message: '问题' }, () => {});
  mapId = 'map B';
  await generation;
  await api.deleteTile('note');
  await api.updateTileWeight('note', 3);
  await api.resetWorkspace();
  await api.listMarkdown({ current: 1, size: 10 });
  assert.equal(calls[0].url, '/customer-service/maps');
  assert.deepEqual(JSON.parse(calls[1].options.body), { name: '第二张图谱' });
  assert.equal(new URL(calls[2].url, 'http://test').searchParams.get('mapId'), 'map A');
  for (const index of [3, 4, 7, 8]) assert.equal(JSON.parse(calls[index].options.body).mapId, 'map A');
  assert.equal(calls[5].options.body.get('mapId'), 'map A');
  assert.equal(new URL(calls[6].url, 'http://test').searchParams.get('mapId'), 'map A');
  for (const index of [9, 10, 11]) assert.equal(JSON.parse(calls[index].options.body).mapId, 'map B');
  assert.equal(JSON.parse(calls[12].options.body).mapId, undefined);
});

test('map zoom updates use an explicit captured map ID and retain the request on navigation', async context => {
  const calls = [];
  context.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return Response.json({ success: true }); });
  await createApiClient('http://backend.test', () => 'map-b').updateMapZoom('map/a', 0.75);
  assert.equal(calls[0].url, 'http://backend.test/customer-service/maps/map%2Fa/zoom');
  assert.deepEqual(JSON.parse(calls[0].options.body), { zoom: 0.75 });
  assert.equal(calls[0].options.keepalive, true);
});

test('question plans capture map ownership, support cancellation and preserve conflict codes', async context => {
  const calls = [];
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (JSON.parse(options.body).planId === 'stale')
      return Response.json({ success: false, errorCode: 'QUESTION_CONTEXT_CHANGED', message: '关联内容已发生变化' }, { status: 409 });
    return Response.json({ success: true, data: { suggested: true, planId: 'plan', questions: ['问题一', '问题二'] } });
  });
  let active = 'map-a';
  const api = createApiClient('', () => active);
  const controller = new AbortController();
  await api.planQuestion({ tileId: 'new', message: '问题' }, controller.signal);
  active = 'map-b';
  await api.decideQuestion({ mapId: 'map-a', planId: 'plan', action: 'CANCEL' });
  assert.equal(JSON.parse(calls[0].options.body).mapId, 'map-a');
  assert.equal(JSON.parse(calls[1].options.body).mapId, 'map-a');
  assert.equal(calls[0].options.signal.aborted, false);
  controller.abort();
  assert.equal(calls[0].options.signal.aborted, true);
  await assert.rejects(api.decideQuestion({ planId: 'stale', action: 'EXECUTE' }),
    error => error.status === 409 && error.code === 'QUESTION_CONTEXT_CHANGED');
});

test('map deletion explicitly addresses its own encoded ID, independent of active map', async context => {
  const calls = [];
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json({ success: true });
  });
  const api = createApiClient('http://localhost:8080', () => 'active-map');
  await api.deleteMap('other/map');
  assert.equal(calls[0].url, 'http://localhost:8080/customer-service/maps/other%2Fmap');
  assert.equal(calls[0].options.method, 'DELETE');
  globalThis.fetch = async () => Response.json({ success: false, message: '删除失败' });
  await assert.rejects(api.deleteMap('other-map'), /删除失败/);
});
