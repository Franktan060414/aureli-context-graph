import assert from 'node:assert/strict';
import { sampleGraph } from './fixtures/sample-workspace.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(8000);
const errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
const maps = [{ mapId: 'original', name: '我的图谱', zoom: 1 }];
const template = { ...sampleGraph(), labels: [{ id: 1, name: '入门导览', colorHex: '#DBEAFE' }] };
template.tiles[0].labelId = 1;
template.tiles.push({ id: 'guide', title: '操作指南', message: '操作指南', content: '原始便签', answer: '原始便签', tileType: 'NOTE', weight: 1, status: 'ready', relatedTileIds: [] });
const graphs = new Map([['original', structuredClone(template)]]);
let fail = true, releaseCreate, createCalls = 0;
await page.route('**/customer-service/**', async route => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname;
  const reply = data => route.fulfill({ json: { success: true, data } });
  if (path.endsWith('/maps/example')) {
    createCalls++;
    if (fail) return route.fulfill({ status: 503, json: { success: false, message: '数据库暂时不可用' } });
    await new Promise(resolve => { releaseCreate = resolve; });
    const map = { mapId: `example-${createCalls}`, name: '示例图谱 · 功能导览', zoom: 0.65 };
    const graph = structuredClone(template), ids = new Map(graph.tiles.map(t => [t.id, `${map.mapId}-${t.id}`]));
    for (const tile of graph.tiles) { tile.id = ids.get(tile.id); tile.relatedTileIds = tile.relatedTileIds.map(id => ids.get(id)); }
    for (const edge of graph.edges) { edge.id = `${map.mapId}-${edge.id}`; edge.sourceTileId = ids.get(edge.sourceTileId); edge.targetTileId = ids.get(edge.targetTileId); }
    graphs.set(map.mapId, graph); maps.push(map); return reply(map);
  }
  if (path.endsWith('/maps')) return reply(maps);
  if (path.endsWith('/tile/workspace')) return reply(graphs.get(url.searchParams.get('mapId')));
  if (request.method() === 'POST') {
    const body = request.postDataJSON(); requests.push({ path, body });
    const graph = graphs.get(body.mapId);
    if (path.endsWith('/tile/weight')) { graph.tiles.find(tile => tile.id === body.tileId).weight = body.weight; return reply(); }
    if (path.endsWith('/tile/note/update')) {
      const tile = graph.tiles.find(tile => tile.id === body.tileId);
      Object.assign(tile, { title: body.title, message: body.title, content: body.content, answer: body.content, relatedTileIds: body.relatedTileIds });
      return reply(tile);
    }
  }
  if (path.endsWith('/md/list')) return route.fulfill({ json: { success: true, data: [], total: 0 } });
  return route.fulfill({ status: 404 });
});
await page.addInitScript(() => localStorage.setItem('aureli-mode', 'demo'));
const dialog = page.locator('dialog[aria-labelledby="workspace-modal-title"]');
const show = surface => surface.getByRole('button', { name: '显示示例', exact: true });
async function completeCreate() {
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('正在创建')));
  assert.equal(await page.getByRole('button', { name: '正在创建…', exact: true }).isDisabled(), true);
  for (let attempt = 0; !releaseCreate && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(typeof releaseCreate, 'function'); releaseCreate(); releaseCreate = null;
  await page.getByRole('status').filter({ hasText: '示例图谱已创建并保存' }).waitFor();
}
try {
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await page.locator('.graph-node').last().waitFor();
  assert.equal(createCalls, 0, 'loading never creates an example');
  assert.equal(await page.evaluate(() => localStorage.getItem('aureli-mode')), null);
  await page.getByRole('button', { name: '了解 Tile 工作流', exact: true }).click();
  await show(dialog).click();
  await page.getByRole('status').filter({ hasText: '示例图谱创建失败' }).waitFor();
  assert.equal(maps.length, 1); assert.equal(new URL(page.url()).searchParams.get('map'), 'original');
  assert.equal(await dialog.isVisible(), true);
  fail = false;
  await show(dialog).evaluate(button => { button.click(); button.click(); });
  await completeCreate();
  assert.equal(createCalls, 2, 'the repeated click while pending is ignored');
  assert.equal(await dialog.isVisible(), false);
  assert.equal(new URL(page.url()).searchParams.get('map'), 'example-2');
  await page.locator('.graph-node[data-tile-id="example-2-tile-001"] .node-main').click();
  await page.getByRole('combobox', { name: '调整当前 Tile 重要程度' }).selectOption('3');
  await page.getByRole('status').filter({ hasText: 'Tile 权重已设为非常重要' }).waitFor();
  assert.equal(requests.at(-1).body.mapId, 'example-2');
  await page.locator('.graph-node[data-tile-id="example-2-guide"] .node-main').focus();
  await page.locator('.graph-node[data-tile-id="example-2-guide"] .node-main').click();
  await page.getByRole('button', { name: '编辑便签', exact: true }).click();
  await dialog.getByLabel('便签正文').fill('已经保存到服务端的修改');
  await dialog.getByRole('button', { name: '保存便签', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.reload(); await page.locator('.graph-node').last().waitFor();
  assert.equal(createCalls, 2, 'refresh does not create another map');
  assert.equal(graphs.get('example-2').tiles[0].weight, 3);
  assert.equal(graphs.get('example-2').tiles.at(-1).content, '已经保存到服务端的修改');
  await page.getByRole('link', { name: '服务设置', exact: true }).click();
  await page.getByRole('button', { name: '知识库配置', exact: true }).click();
  await show(page).click(); await completeCreate();
  assert.equal(maps.length, 3); assert.equal(new URL(page.url()).searchParams.get('map'), 'example-3');
  assert.equal(graphs.get('example-3').tiles.at(-1).content, '原始便签');
  assert.equal(graphs.get('example-2').tiles.at(-1).content, '已经保存到服务端的修改');
  assert.equal(await page.locator('.mode-banner, .preview-tag').count(), 0);
  await page.setViewportSize({ width: 375, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('PASS: show-example buttons create independent database maps, failure retry, pending-click protection, automatic navigation, scoped edits, reload persistence and legacy mode cleanup');
} finally { releaseCreate?.(); await browser.close(); }
