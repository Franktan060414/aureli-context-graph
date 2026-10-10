import { selectView } from "./helpers/view-select.js";
import assert from 'node:assert/strict';
import { demoGraph } from '../src/lib/demo.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
const maps = [{ mapId: 'default', name: '默认图谱' }, { mapId: 'map-b', name: '项目 B' }];
const graphs = {
  default: { tiles: [{ id: 'a-note', message: 'A 的便签', answer: 'A private', content: 'A private', title: 'A 的便签', tileType: 'NOTE', kind: 'note', weight: 1, status: 'ready', relatedTileIds: [] }], edges: [] },
  'map-b': { tiles: [{ id: 'b-note', message: 'B 的便签', answer: 'B private', content: 'B private', title: 'B 的便签', tileType: 'NOTE', kind: 'note', weight: 1, status: 'ready', relatedTileIds: [] }], edges: [] },
};
let releaseAnswer, releaseSnapshot, holdSnapshot = false, failCreate = false;
await page.route('**/customer-service/tile/question/plan', route => route.fulfill({
  json: { success: true, data: { suggested: false, reason: '单一问题', questions: [], planId: null } },
}));
const waitFor = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('Missing intercepted request'); };
await page.route('**/customer-service/maps', async route => {
  if (route.request().method() === 'GET') return route.fulfill({ json: { success: true, data: maps } });
  const body = route.request().postDataJSON(); writes.push({ path: 'maps', body });
  if (failCreate) return route.fulfill({ json: { success: false, message: '创建失败，请重试' } });
  const map = { mapId: 'map-new', name: body.name }; maps.push(map); graphs[map.mapId] = { tiles: [], edges: [] };
  return route.fulfill({ json: { success: true, data: map } });
});
await page.route('**/customer-service/tile/workspace?*', async route => {
  const id = new URL(route.request().url()).searchParams.get('mapId');
  if (holdSnapshot && id === 'default') { holdSnapshot = false; await new Promise(resolve => { releaseSnapshot = resolve; }); }
  await route.fulfill({ json: { success: true, data: graphs[id] } });
});
await page.route('**/customer-service/tile/note', async route => {
  const body = route.request().postDataJSON(); writes.push({ path: 'note', body });
  const tile = { id: body.tileId, message: body.title, title: body.title, answer: body.content, content: body.content, tileType: 'NOTE', kind: 'note', status: 'ready', weight: 1, relatedTileIds: body.relatedTileIds };
  graphs[body.mapId].tiles.push(tile);
  await route.fulfill({ json: { success: true, data: tile } });
});
await page.route('**/customer-service/chat/tile/completion', async route => {
  const body = route.request().postDataJSON(); writes.push({ path: 'completion', body });
  await new Promise(resolve => { releaseAnswer = resolve; });
  graphs[body.mapId].tiles.push({ id: body.tileId, message: body.message, answer: 'A 的完整回答', tileType: 'QA', kind: 'root', status: 'ready', weight: 1, relatedTileIds: [] });
  await route.fulfill({ contentType: 'text/event-stream', body: 'data: {"v":"A 的完整回答"}\n\ndata: {"done":true}\n\n' });
});
await page.route('**/customer-service/tile/reset', async route => {
  const body = route.request().postDataJSON(); writes.push({ path: 'reset', body });
  graphs[body.mapId] = { tiles: [], edges: [] };
  await route.fulfill({ json: { success: true } });
});
const mapButton = name => page.locator('.map-list').getByRole('button', { name, exact: true });
const cards = page.locator('.tile-list article');
const dialog = page.locator('dialog.modal');
try {
  await page.addInitScript(() => {
    localStorage.setItem('aureli-mode', 'live');
    localStorage.setItem('aureli-tile-layouts', JSON.stringify({ [`live:${location.origin}`]: { 'a-note': { x: 80, y: 140 } } }));
  });
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await mapButton('默认图谱').waitFor();
  await selectView(page, "Tile 列表");
  await page.getByText('A 的便签', { exact: true }).first().waitFor();
  assert.equal(await mapButton('默认图谱').getAttribute('aria-pressed'), 'true');
  await mapButton('项目 B').click();
  await page.getByText('B 的便签', { exact: true }).first().waitFor();
  assert.equal(await cards.count(), 1);
  assert.equal(await cards.filter({ hasText: 'A 的便签' }).count(), 0);
  assert.equal(new URL(page.url()).searchParams.get('map'), 'map-b');
  // Old default positions do not become B's positions.
  const layouts = await page.evaluate(() => JSON.parse(localStorage.getItem('aureli-tile-layouts')));
  assert.equal(layouts[`live:${new URL(page.url()).origin}:map-b`], undefined);
  await mapButton('默认图谱').click();
  await page.getByText('A 的便签', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '打开添加Tile弹窗', exact: true }).click();
  await dialog.locator('textarea').first().fill('在 A 中提问');
  await dialog.getByRole('button', { name: '发送并生成 Tile', exact: true }).click();
  await waitFor(() => releaseAnswer);
  assert.equal(await page.getByRole('button', { name: '删除图谱 默认图谱', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '删除图谱 项目 B', exact: true }).isEnabled(), true);
  await mapButton('项目 B').click();
  await page.getByText('B 的便签', { exact: true }).first().waitFor();
  assert.equal(await cards.count(), 1);
  await page.getByRole('button', { name: '添加便签', exact: true }).click();
  await dialog.locator('#note-title').fill('B 中的新便签');
  await dialog.locator('#note-content').fill('独立管理 B 的内容');
  await dialog.getByRole('button', { name: '保存便签', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('dialog.modal').open);
  assert.equal(writes.find(write => write.path === 'note').body.mapId, 'map-b');
  assert.equal(await cards.count(), 2);
  // Return to A during generation: keep its pending Tile, no stale reload.
  await mapButton('默认图谱').click();
  assert.equal(await cards.count(), 2);
  await mapButton('项目 B').click();
  releaseAnswer();
  await page.getByRole('status').filter({ hasText: '另一张图谱的 Tile 已生成' }).waitFor();
  assert.equal(await cards.filter({ hasText: '在 A 中提问' }).count(), 0);
  await mapButton('默认图谱').click();
  await page.getByText('在 A 中提问', { exact: true }).first().waitFor();
  assert.equal(await cards.count(), 2);
  assert.equal(writes.find(write => write.path === 'completion').body.mapId, 'default');
  // A snapshot arriving after switching does not replace B's canvas.
  holdSnapshot = true;
  await page.getByRole('button', { name: '同步图谱', exact: true }).click();
  await waitFor(() => releaseSnapshot);
  await mapButton('项目 B').click();
  releaseSnapshot();
  await page.getByText('B 中的新便签', { exact: true }).first().waitFor();
  assert.equal(await cards.count(), 2);
  await page.reload();
  await mapButton('项目 B').waitFor();
  assert.equal(await mapButton('项目 B').getAttribute('aria-pressed'), 'true');
  // Creating a new map is performed in the dock; failed creation keeps name for retry.
  await page.getByRole('button', { name: '新建图谱', exact: true }).click();
  assert.equal(await page.getByLabel('图谱名称', { exact: true }).evaluate(input => document.activeElement === input), true);
  await page.getByLabel('图谱名称', { exact: true }).fill('研究计划');
  failCreate = true;
  await page.locator('.map-create-form').getByRole('button', { name: '创建', exact: true }).click();
  await page.locator('.map-error').waitFor();
  assert.equal(await page.getByLabel('图谱名称', { exact: true }).inputValue(), '研究计划');
  failCreate = false;
  await page.locator('.map-create-form').getByRole('button', { name: '创建', exact: true }).click();
  await mapButton('研究计划').waitFor();
  await page.waitForFunction(() => document.querySelector('.map-item.selected')?.textContent.trim() === '研究计划');
  assert.equal(new URL(page.url()).searchParams.get('map'), 'map-new');
  await selectView(page, "Tile 列表");
  assert.equal(await cards.count(), 0);
  await page.mouse.move(900, 200);
  await page.locator('.sidebar').screenshot({ path: new URL('../artifacts/maps-dock.png', import.meta.url).pathname });
  // Query parameter and saved selection restore this map on refresh.
  await page.reload(); await mapButton('研究计划').waitFor();
  assert.equal(await mapButton('研究计划').getAttribute('aria-pressed'), 'true');
  // Keyboard focus and responsive dock remain usable.
  await mapButton('项目 B').focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.map-item.selected')?.textContent.trim() === '项目 B');
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No horizontal overflow at ${width}`);
  }
  // Demo maps are isolated and never write to API.
  const beforeDemo = writes.length;
  const demoPage = await browser.newPage();
  await demoPage.addInitScript(() => localStorage.setItem('aureli-mode', 'demo'));
  await demoPage.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await demoPage.getByRole('button', { name: '新建图谱', exact: true }).click();
  await demoPage.getByLabel('图谱名称').fill('示例项目');
  await demoPage.locator('.map-create-form').getByRole('button', { name: '创建', exact: true }).click();
  await demoPage.locator('.map-item.selected').filter({ hasText: '示例项目' }).waitFor();
  await demoPage.locator('.map-list').getByRole('button', { name: '示例图谱', exact: true }).click();
  assert.equal(await demoPage.locator('.nav-count').textContent(), String(demoGraph().tiles.length));
  assert.equal(writes.length, beforeDemo);
  await demoPage.close();
  assert.deepEqual(errors, []);
  console.log('PASS: dock list/create/retry, map ownership, generation during switching, late snapshots, selection persistence, keyboard, responsive layout, demo isolation');
} finally { await browser.close(); }
