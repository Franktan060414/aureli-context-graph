import { sampleGraph } from './fixtures/sample-workspace.js';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [], imports = [], maps = [{ mapId: 'existing', name: '已有图谱', zoom: 1 }], graphs = new Map([['existing', sampleGraph()]]);
let failImport = false, releaseImport;
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => { if (!localStorage.getItem('aureli-mode')) localStorage.setItem('aureli-mode', 'live'); });
await page.route('**/customer-service/**', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.pathname.endsWith('/maps/import')) {
    const data = request.postDataJSON(); imports.push(data);
    if (failImport) return route.fulfill({ status: 400, json: { success: false, message: 'JSON 格式错误：服务端校验失败。' } });
    await new Promise(resolve => { releaseImport = resolve; });
    const map = { mapId: `import-${imports.length}`, name: data.name, zoom: 1 };
    const ids = Object.fromEntries(data.tiles.map(tile => [tile.id, `${map.mapId}-${tile.id}`]));
    const tiles = data.tiles.map(tile => ({ ...tile, id: ids[tile.id], relatedTileIds: tile.relatedTileIds.map(id => ids[id]), kind: tile.relatedTileIds.length ? 'memory' : 'root' }));
    const edges = data.edges.map(edge => ({ ...edge, id: `${map.mapId}-${edge.id}`, sourceTileId: ids[edge.sourceTileId], targetTileId: ids[edge.targetTileId] }));
    const graph = { tiles, edges, labels: data.labels };
    graphs.set(map.mapId, graph); maps.push(map);
    return route.fulfill({ json: { success: true, data: { map, ...graph,
      layout: Object.fromEntries(Object.entries(data.layout).map(([id,point]) => [ids[id],point])) } } });
  }
  const data = url.pathname.endsWith('/maps') ? maps
    : url.pathname.endsWith('/workspace') ? graphs.get(url.searchParams.get('mapId')) || { tiles: [], edges: [], labels: [] }
    : url.pathname.endsWith('/model-settings') ? { chat: { provider: 'local', baseUrl: 'http://127.0.0.1:11434/v1', model: 'fixture' },
      embedding: { provider: 'local', baseUrl: 'http://127.0.0.1:11434/v1', model: 'fixture' }, dimensions: 1536 } : [];
  return route.fulfill({ json: { success: true, data } });
});
const input = () => page.getByLabel('选择历史记录 JSON 文件', { exact: true });
const upload = (text, name = '聊天记录.json') => input().setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
async function openWorkbench() {
  if (page.viewportSize().width < 768)
    await page.getByRole('button', { name: '展开导航', exact: true }).click();
  await page.getByRole('link', { name: '服务设置', exact: true }).click();
  if (page.viewportSize().width < 768)
    await page.getByRole('button', { name: '展开导航', exact: true }).click();
  await page.getByRole('button', { name: '工作台设置', exact: true }).click();
  await page.getByRole('heading', { name: '工作台设置', exact: true }).waitFor();
}
try {
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await page.locator('.graph-node').first().waitFor();
  // Use an actual file produced by the application's export dialog.
  await page.getByRole('button', { name: '导出图谱', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('dialog', { name: '导出图谱', exact: true }).getByRole('button', { name: '导出', exact: true }).click();
  const download = await downloadPromise;
  const exported = await readFile(await download.path(), 'utf8');
  const source = JSON.parse(exported);
  console.log('Export downloaded');
  await openWorkbench();
  assert.match(page.url(), /#settings\/workbench$/);
  await page.reload();
  await page.getByRole('heading', { name: '工作台设置', exact: true }).waitFor();
  console.log('Workbench settings restored');
  await upload('{invalid');
  await page.getByRole('alert').filter({ hasText: 'JSON 格式错误' }).waitFor();
  assert.equal(imports.length, 0);
  await upload(JSON.stringify({ tiles: [{ id: 'broken', message: '问题', relatedTileIds: ['missing'] }], edges: [] }));
  await page.getByRole('alert').filter({ hasText: '无效的关联节点' }).waitFor();
  assert.equal(imports.length, 0);
  failImport = true;
  await upload(exported);
  await page.getByRole('alert').filter({ hasText: '服务端校验失败' }).waitFor();
  assert.equal(maps.length, 1);
  failImport = false;
  console.log('Validation and server failure verified');
  await upload(exported);
  await page.getByRole('button', { name: '正在导入…', exact: true }).waitFor();
  assert.equal(await input().isDisabled(), true);
  for (let i = 0; !releaseImport && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(typeof releaseImport, 'function');
  releaseImport(); releaseImport = null;
  await page.locator('.graph-node').first().waitFor();
  assert.equal(await page.locator('.graph-node').count(), source.tiles.length);
  assert.equal(await page.locator('#settings-navigation').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('aureli-mode')), null);
  assert.equal(imports.at(-1).tiles[0].answer, source.tiles[0].answer);
  assert.equal(await page.getByRole('button', { name: '聊天记录（导入）', exact: true }).count(), 1);
  await page.reload();
  console.log('Imported graph verified');
  await page.locator('.graph-node').first().waitFor();
  assert.equal(await page.locator('.graph-node').count(), source.tiles.length);
  await page.setViewportSize({ width: 375, height: 900 });
  await openWorkbench();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await upload('{');
  await page.getByRole('alert').filter({ hasText: 'JSON 格式错误' }).waitFor();
  await mkdir('artifacts/graph-import', { recursive: true });
  assert.equal(await page.locator('.sidebar').evaluate(element => element.classList.contains('open')), false);
  await page.screenshot({ path: 'artifacts/graph-import/mobile-error.png', fullPage: true, animations: 'disabled' });
  await upload(exported);
  await page.getByRole('button', { name: '正在导入…', exact: true }).waitFor();
  for (let i = 0; !releaseImport && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(typeof releaseImport, 'function');
  releaseImport();
  await page.locator('.graph-node').first().waitFor();
  assert.equal(maps.length, 3, 'repeated imports create separate maps alongside the existing map');
  assert.equal(await page.locator('.graph-node').count(), source.tiles.length);
  assert.deepEqual(errors, []);
  console.log('PASS: real exported JSON import, client/server validation, retry, pending state, reload, repeated import and mobile navigation');
} finally { await browser.close(); }
