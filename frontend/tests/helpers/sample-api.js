import { sampleGraph } from '../fixtures/sample-workspace.js';

// Normal API fixtures for UI tests; demonstration data never ships in the app.
export async function mockSampleWorkspace(page, options = {}) {
  const mapId = options.mapId || 'sample';
  const graph = options.graph || { ...sampleGraph(), labels: [] };
  const maps = [{ mapId, name: '测试图谱', zoom: options.zoom ?? 1 }];
  const writes = [];
  const files = new Map();
  await page.route('**/customer-service/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const body = request.method() === 'POST' && request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() : null;
    const reply = data => route.fulfill({ json: { success: true, data } });
    if (request.method() !== 'GET') writes.push({ path, body });
    if (path.endsWith('/maps') && request.method() === 'GET') return reply(maps);
    if (path.endsWith('/zoom')) { maps[0].zoom = body.zoom; return reply(); }
    if (path.endsWith('/tile/workspace')) return reply(graph);
    if (path.endsWith('/question/plan')) return reply({ suggested: false, questions: [], planId: null });
    if (path.endsWith('/completion')) {
      const tile = { id: body.tileId, message: body.message, answer: '接口模拟回答', relatedTileIds: body.relatedTileIds, status: 'ready', tileType: 'QA', weight: 1 };
      graph.tiles.push(tile);
      return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"v":"接口模拟回答"}\n\ndata: {"done":true}\n\n' });
    }
    if (path.endsWith('/tile/weight')) { graph.tiles.find(tile => tile.id === body.tileId).weight = body.weight; return reply(); }
    if (path.endsWith('/tile/size')) { Object.assign(graph.tiles.find(tile => tile.id === body.tileId), { width: body.width, height: body.height }); return reply(); }
    if (path.endsWith('/tile/delete')) {
      graph.tiles = graph.tiles.filter(tile => tile.id !== body.tileId);
      graph.edges = graph.edges.filter(edge => edge.sourceTileId !== body.tileId && edge.targetTileId !== body.tileId);
      for (const tile of graph.tiles) tile.relatedTileIds = tile.relatedTileIds.filter(id => id !== body.tileId);
      return reply();
    }
    if (path.endsWith('/tile/reset')) { graph.tiles = []; graph.edges = []; return reply(); }
    if (path.endsWith('/tile/note') || path.endsWith('/tile/note/update')) {
      const tile = { id: body.tileId, title: body.title, message: body.title, content: body.content, answer: body.content,
        tileType: 'NOTE', kind: 'note', relatedTileIds: body.relatedTileIds, weight: 1, status: 'ready' };
      const index = graph.tiles.findIndex(item => item.id === tile.id);
      if (index < 0) graph.tiles.push(tile); else graph.tiles.splice(index, 1, tile);
      return reply(tile);
    }
    if (path.endsWith('/tile/file')) {
      const form = await new Request('http://fixture.test', { method: 'POST', headers: { 'content-type': request.headers()['content-type'] }, body: request.postDataBuffer() }).formData();
      const file = form.get('file'), id = `file-${files.size}`;
      const bytes = Buffer.from(await file.arrayBuffer()); files.set(id, bytes);
      const tile = { id, title: file.name, message: file.name, answer: file.name, fileName: file.name, fileSize: bytes.length,
        fileContentType: file.type, tileType: 'FILE', kind: 'file', weight: 1, status: 'ready', relatedTileIds: form.getAll('relatedTileIds') };
      graph.tiles.push(tile); return reply(tile);
    }
    if (/\/tile\/[^/]+\/file$/.test(path)) return route.fulfill({ body: files.get(path.split('/').at(-2)), contentType: 'application/octet-stream' });
    if (path.endsWith('/md/list')) return reply([]);
    return route.fulfill({ status: 404, json: { success: false, message: `No fixture for ${path}` } });
  });
  return { graph, maps, writes, mapId };
}
