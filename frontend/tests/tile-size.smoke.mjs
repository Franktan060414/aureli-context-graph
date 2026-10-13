import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const url = process.env.UI_TEST_URL || 'http://127.0.0.1:5173';
const errors = [], writes = [];
let fail = false, hold, zoom = 0.75;
const tiles = [1, 2, 3].map(weight => ({ id: `tile-${weight}`, weight, tileType: weight === 2 ? 'NOTE' : weight === 3 ? 'FILE' : 'QA',
  message: '尺寸与重要程度独立', answer: '内容预览。'.repeat(80), relatedTileIds: weight === 2 ? ['tile-1'] : [], status: 'ready', kind: 'root' }));
const edges = [{ id: 'edge', sourceTileId: 'tile-1', targetTileId: 'tile-2', direction: 'DIRECTED', relationType: 'EXTENDS' }];
page.on('pageerror', error => errors.push(error.message));
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.addInitScript(() => {
  localStorage.setItem('aureli-mode', 'live');
  const key = `live:${location.origin}:size-test`;
  if (!localStorage.getItem('aureli-tile-layouts')) localStorage.setItem('aureli-tile-layouts', JSON.stringify({ [key]: {
    'tile-1': { x: 160, y: 160 }, 'tile-2': { x: 650, y: 160 }, 'tile-3': { x: 160, y: 650 },
  } }));
});
await page.route('**/customer-service/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/maps')) return route.fulfill({ json: { success: true, data: [{ mapId: 'size-test', name: '尺寸测试', zoom }] } });
  if (path.endsWith('/workspace')) return route.fulfill({ json: { success: true, data: { tiles, edges, labels: [] } } });
  if (path.endsWith('/size')) {
    const body = route.request().postDataJSON(); writes.push(body);
    if (hold === true) await new Promise(resolve => { hold = resolve; });
    if (fail) return route.fulfill({ json: { success: false, message: '测试保存失败' } });
    Object.assign(tiles.find(tile => tile.id === body.tileId), { width: body.width, height: body.height });
  }
  if (path.endsWith('/weight')) {
    const body = route.request().postDataJSON();
    tiles.find(tile => tile.id === body.tileId).weight = body.weight;
  }
  return route.fulfill({ json: { success: true, data: {} } });
});
const card = () => page.locator('[data-tile-id="tile-1"]');
const dimensions = () => card().evaluate(e => ({ width: parseFloat(e.style.width), height: parseFloat(e.style.height), x: parseFloat(e.style.left), y: parseFloat(e.style.top) }));
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function saved() { await page.waitForFunction(() => !document.querySelector('[data-tile-id="tile-1"] .node-resize-se').disabled); await settle(); }
async function resize(edge, dx, dy, cancel = false) {
  const handle = card().locator(`[data-resize-edge="${edge}"]`);
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 6 });
  await settle();
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
  if (!hold) await saved();
}
try {
  await page.goto(url); await card().waitFor();
  assert.deepEqual(await page.locator('.graph-node').evaluateAll(nodes => nodes.map(e => [parseFloat(e.style.width), parseFloat(e.style.height)])), [[260, 200], [260, 200], [260, 200]]);
  const path = await page.locator('.edges g > path').getAttribute('d');
  await resize('se', 75, 60);
  assert.deepEqual(await dimensions(), { width: 360, height: 280, x: 160, y: 160 });
  assert.equal(tiles[0].weight, 1);
  assert.notEqual(await page.locator('.edges g > path').getAttribute('d'), path);
  assert.deepEqual(writes[0], { mapId: 'size-test', tileId: 'tile-1', width: 360, height: 280 });
  assert.equal(await page.locator('.tile-size-dialog').count(), 0, 'numeric size dialog is removed');
  await page.reload(); await card().waitFor(); await saved();
  assert.equal((await dimensions()).width, 360);
  const select = page.getByRole('combobox', { name: '调整当前 Tile 重要程度' });
  await select.selectOption('3');
  await page.waitForFunction(() => document.querySelector('.tile-weight-control')?.dataset.weight === '3');
  assert.equal((await dimensions()).width, 360);
  const beforeCancel = await dimensions(), beforeCount = writes.length;
  await resize('nw', -30, -30, true);
  assert.deepEqual(await dimensions(), beforeCancel); assert.equal(writes.length, beforeCount);
  for (const [edge, dx, dy, dw, dh] of [
    ['n', 0, -15, 0, 20], ['e', 15, 0, 20, 0], ['s', 0, 15, 0, 20], ['w', -15, 0, 20, 0],
    ['ne', 15, -15, 20, 20], ['sw', -15, 15, 20, 20], ['nw', -15, -15, 20, 20],
  ]) {
    const before = await dimensions(); await resize(edge, dx, dy);
    const after = await dimensions();
    assert.equal(after.width, before.width + dw, edge); assert.equal(after.height, before.height + dh, edge);
    if (edge.includes('w')) assert.equal(after.x + after.width, before.x + before.width);
    if (edge.includes('n')) assert.equal(after.y + after.height, before.y + before.height);
  }
  const beforeFailure = await dimensions(); fail = true;
  await resize('se', 30, 30);
  await page.locator('.toast').filter({ hasText: '尺寸保存失败' }).waitFor();
  assert.deepEqual(await dimensions(), beforeFailure); fail = false;
  const beforeClick = await dimensions(), beforeClickWrites = writes.length;
  await card().locator('.node-resize-se').click(); await settle();
  assert.equal(await page.getByRole('dialog', { name: '调整 Tile 尺寸' }).count(), 0);
  assert.deepEqual(await dimensions(), beforeClick, 'clicking an edge does not change dimensions');
  assert.equal(writes.length, beforeClickWrites, 'clicking an edge does not save dimensions');
  await card().locator('.node-resize-se').focus(); await page.keyboard.press('ArrowRight'); await saved();
  const keyboardWidth = beforeClick.width + 10;
  assert.equal((await dimensions()).width, keyboardWidth);
  const previousWrites = writes.length;
  await page.getByRole('button', { name: '导出图谱', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('dialog', { name: '导出图谱', exact: true }).getByRole('button', { name: '导出', exact: true }).click();
  const exported = JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8'));
  assert.equal(exported.tiles.find(t => t.id === 'tile-1').width, keyboardWidth);
  assert.equal(writes.length, previousWrites);
  await page.getByRole('button', { name: '全页面查看图谱', exact: true }).click();
  const fullscreen = page.locator('.fullscreen-viewer');
  const fullHandle = fullscreen.locator('[data-tile-id="tile-1"] .node-resize-se');
  await fullHandle.focus(); await page.keyboard.press('ArrowRight'); await saved();
  assert.equal(tiles[0].width, keyboardWidth + 10, 'fullscreen forwards resize persistence');
  await fullHandle.click();
  assert.equal(await fullscreen.getByRole('dialog', { name: '调整 Tile 尺寸' }).count(), 0);
  assert.equal(await fullscreen.isVisible(), true, 'clicking an edge keeps fullscreen open');
  await fullscreen.locator('.fullscreen-header .secondary').click();
  await fullscreen.waitFor({ state: 'detached' });
  assert.equal((await dimensions()).width, keyboardWidth + 10, 'both canvas views share the saved dimensions');
  hold = true;
  await resize('se', 30, 30);
  await page.waitForFunction(() => document.querySelector('[data-tile-id="tile-1"] .node-resize-se').disabled);
  assert.equal(typeof hold, 'function');
  assert.equal(await card().locator('.node-resize-se').isDisabled(), true);
  hold(); await saved(); hold = null;
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await page.locator('.graph-wrap').screenshot({ path: new URL('../artifacts/tile-size.png', import.meta.url).pathname });
  assert.deepEqual(errors, []);
  console.log('PASS: equal defaults, all resize edges, zoom-aware geometry, anchors, cancellation, persistence, weight independence, failed-save rollback, no numeric-size entry points, keyboard controls, JSON export, fullscreen sharing, pending-save protection and responsive canvas');
} finally { await browser.close(); }
