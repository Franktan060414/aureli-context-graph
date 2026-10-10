import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], deletes = [];
page.on('pageerror', error => errors.push(error.message));
let maps = [
  { mapId: 'map-a', name: '图谱 A', zoom: 1 },
  { mapId: 'map-b', name: '图谱 B', zoom: 0.75 },
  { mapId: 'map-c', name: '图谱 C', zoom: 1.2 },
];
const graphs = Object.fromEntries(maps.map(map => [map.mapId, { tiles: [{ id: `${map.mapId}-note`, message: `${map.name} 便签`, title: `${map.name} 便签`, answer: '正文', content: '正文', tileType: 'NOTE', kind: 'note', weight: 1, status: 'ready', relatedTileIds: [] }], edges: [] }]));
let failDelete = false, releaseDelete;
await page.route('**/customer-service/maps', route => route.fulfill({ json: { success: true, data: maps } }));
await page.route('**/customer-service/maps/*', async route => {
  assert.equal(route.request().method(), 'DELETE');
  const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1));
  deletes.push(id);
  if (failDelete) return route.fulfill({ json: { success: false, message: '删除失败，请重试' } });
  if (id === 'map-a') await new Promise(resolve => { releaseDelete = resolve; });
  maps = maps.filter(map => map.mapId !== id);
  delete graphs[id];
  await route.fulfill({ json: { success: true } });
});
await page.route('**/customer-service/tile/workspace?*', async route => {
  const id = new URL(route.request().url()).searchParams.get('mapId');
  assert.ok(graphs[id], `workspace belongs to existing map ${id}`);
  await route.fulfill({ json: { success: true, data: graphs[id] } });
});
const selected = () => page.locator('.map-item.selected');
const remove = name => page.getByRole('button', { name: `删除图谱 ${name}`, exact: true });
const dialog = page.locator('dialog[aria-labelledby="workspace-modal-title"]');
const confirm = () => dialog.getByRole('button', { name: '删除图谱', exact: true });
try {
  await page.addInitScript(() => {
    localStorage.setItem('aureli-mode', 'live');
    localStorage.setItem('aureli-tile-layouts', JSON.stringify({ [`live:${location.origin}:map-a`]: { 'map-a-note': { x: 25, y: 40 } } }));
  });
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await page.locator('.graph-node').first().waitFor();
  assert.equal(await selected().textContent(), '图谱 A');
  assert.equal(await page.locator('.map-item button').count(), 0, 'delete and selection are separate buttons');
  const mapB = page.locator('.map-item').filter({ hasText: '图谱 B' });
  assert.equal(await remove('图谱 A').evaluate(el => getComputedStyle(el).opacity), '0');
  assert.equal(await remove('图谱 B').evaluate(el => getComputedStyle(el).opacity), '0');
  const boundsB = await mapB.boundingBox();
  await mapB.hover();
  const labelStyle = await mapB.evaluate(el => ({ color: getComputedStyle(el).color,
    fill: getComputedStyle(el, '::after').backgroundColor,
    duration: getComputedStyle(el, '::after').transitionDuration,
    easing: getComputedStyle(el, '::after').transitionTimingFunction,
  }));
  assert.equal(labelStyle.fill, 'rgba(102, 170, 255, 0.12)');
  assert.equal(await page.locator('.view-tabs button').first().evaluate(el => getComputedStyle(el, '::after').backgroundColor), 'rgb(0, 102, 204)', 'primary buttons keep their solid blue fill');
  assert.equal(labelStyle.duration, '0.32s');
  assert.equal(labelStyle.easing, 'linear');
  await mapB.evaluate(el => {
    const motion = document.getAnimations().find(a => a.effect.target === el && a.transitionProperty === 'transform');
    if (!motion) throw new Error('Map fill animation missing');
    motion.pause(); motion.currentTime = 80;
  });
  const midX = await mapB.evaluate(el => new DOMMatrix(getComputedStyle(el, '::after').transform).m41);
  assert.ok(midX < 0 && midX > -boundsB.width, 'same moving fill at partial hover');
  await mapB.evaluate(el => document.getAnimations().filter(a => a.effect.target === el).forEach(a => a.play()));
  await page.waitForTimeout(400);
  assert.equal(await mapB.evaluate(el => getComputedStyle(el).color), 'rgb(0, 64, 128)');
  assert.equal(await remove('图谱 B').evaluate(el => getComputedStyle(el).opacity), '1');
  assert.equal(await remove('图谱 A').evaluate(el => getComputedStyle(el).opacity), '0');
  assert.deepEqual(await mapB.boundingBox(), boundsB, 'hover does not move map labels');
  await page.locator('.map-navigation').screenshot({ path: new URL('../artifacts/map-label-hover.png', import.meta.url).pathname });
  await page.mouse.move(700, 70);
  assert.equal(await remove('图谱 B').evaluate(el => getComputedStyle(el).opacity), '0');

  const mapStyle = await remove('图谱 A').evaluate(el => ({
    size: el.getBoundingClientRect().width,
    icon: el.querySelector("svg").getBoundingClientRect().width,
    fillTime: getComputedStyle(el, '::after').transitionDuration,
    fillColor: getComputedStyle(el, '::after').backgroundColor,
  }));
  const tileStyle = await page.locator('.node-delete-action').first().evaluate(el => ({
    size: el.getBoundingClientRect().width,
    icon: el.querySelector("svg").getBoundingClientRect().width,
    fillTime: getComputedStyle(el, '::after').transitionDuration,
    fillColor: getComputedStyle(el, '::after').backgroundColor,
  }));
  assert.ok(mapStyle.size < tileStyle.size);
  assert.ok(mapStyle.icon < tileStyle.icon);
  assert.ok(Math.abs(mapStyle.icon / tileStyle.icon - mapStyle.size / tileStyle.size) < 0.03);
  assert.equal(mapStyle.fillTime, tileStyle.fillTime);
  assert.equal(mapStyle.fillColor, tileStyle.fillColor);
  await page.locator('.map-item').filter({ hasText: '图谱 A' }).hover();
  await remove('图谱 A').hover();
  await page.waitForTimeout(400);
  assert.equal(await remove('图谱 A').evaluate(el => getComputedStyle(el, '::after').transform), 'matrix(1, 0, 0, 1, 0, 0)');
  await page.locator('.sidebar').screenshot({ path: new URL('../artifacts/map-delete-dock.png', import.meta.url).pathname });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await remove('图谱 A').evaluate(el => getComputedStyle(el, '::after').transitionDuration), '0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.keyboard.press('Tab');
  await remove('图谱 A').focus();
  assert.equal(await remove('图谱 A').evaluate(el => getComputedStyle(el, '::after').transitionDuration), '0s');
  // Deleting another map does not select it; cancelling sends no mutation.
  await page.locator('.map-item').filter({ hasText: '图谱 C' }).hover();
  await remove('图谱 C').click();
  await dialog.getByRole('heading', { name: '删除这个图谱？' }).waitFor();
  assert.match(await dialog.textContent(), /图谱 C.*全部 Tile/);
  assert.equal(await selected().textContent(), '图谱 A');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual(deletes, []);
  await page.locator('.map-item').filter({ hasText: '图谱 C' }).hover();
  await remove('图谱 C').click(); await confirm().click();
  await page.waitForFunction(() => !document.querySelector('dialog[aria-labelledby="workspace-modal-title"]').open);
  assert.equal(await selected().textContent(), '图谱 A');
  assert.equal(await remove('图谱 C').count(), 0);
  // Failed deletion preserves map, selected content and confirmation for retry.
  failDelete = true;
  await page.locator('.map-item').filter({ hasText: '图谱 A' }).hover();
  await remove('图谱 A').click(); await confirm().click();
  await dialog.getByRole('alert').filter({ hasText: '删除失败，请重试' }).waitFor();
  assert.equal(await selected().textContent(), '图谱 A');
  assert.equal(await remove('图谱 A').count(), 1);
  failDelete = false;
  await confirm().click();
  await page.waitForFunction(() => document.querySelector('dialog[aria-labelledby="workspace-modal-title"] .modal-actions button.danger')?.disabled);
  assert.equal(await confirm().count(), 0, 'busy confirmation cannot be submitted again');
  assert.equal(deletes.filter(id => id === 'map-a').length, 2);
  releaseDelete();
  await page.waitForFunction(() => new URL(location.href).searchParams.get('map') === 'map-b');
  await page.waitForFunction(() => !document.querySelector('dialog[aria-labelledby="workspace-modal-title"]').open);
  await page.getByText('图谱 B 便签', { exact: true }).first().waitFor();
  assert.equal(await selected().textContent(), '图谱 B');
  const layouts = await page.evaluate(() => JSON.parse(localStorage.getItem('aureli-tile-layouts')));
  assert.equal(layouts[`live:${new URL(page.url()).origin}:map-a`], undefined);
  // Deleting the last map clears URL/saved selection and provides the new map entry.
  await page.locator('.map-item').filter({ hasText: '图谱 B' }).hover();
  await remove('图谱 B').click(); await confirm().click();
  await page.getByRole('heading', { name: '创建你的第一张图谱' }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('map'), null);
  assert.equal(await page.evaluate(() => localStorage.getItem(`aureli-active-map:${location.origin}`)), null);
  assert.equal(await page.locator('.map-list button').count(), 0);
  assert.equal(await page.locator('.map-add').evaluate(el => el === document.activeElement), true);
  await page.reload(); await page.getByRole('heading', { name: '创建你的第一张图谱' }).waitFor();
  assert.deepEqual(deletes, ['map-c', 'map-a', 'map-a', 'map-b']);
  // Demo deletion stays local and remains usable with the final map removed.
  const demoPage = await browser.newPage({ viewport: { width: 375, height: 900 }, isMobile: true, hasTouch: true });
  demoPage.on('pageerror', error => errors.push(error.message));
  await demoPage.addInitScript(() => localStorage.setItem('aureli-mode', 'demo'));
  await demoPage.route('**/customer-service/**', () => { throw new Error('demo must not write to API'); });
  await demoPage.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await demoPage.getByRole('button', { name: '展开导航', exact: true }).click();
  await demoPage.getByRole('button', { name: '删除图谱 示例图谱', exact: true }).click();
  const demoDialog = demoPage.locator('dialog[aria-labelledby="workspace-modal-title"]');
  await demoDialog.getByRole('button', { name: '删除图谱', exact: true }).click();
  await demoPage.getByRole('heading', { name: '创建你的第一张图谱' }).waitFor();
  await demoPage.locator('.map-add').click();
  await demoPage.getByLabel('图谱名称').fill('新的示例图谱');
  await demoPage.locator('.map-create-form').getByRole('button', { name: '创建', exact: true }).click();
  await demoPage.locator('.map-item.selected').filter({ hasText: '新的示例图谱' }).waitFor({ state: 'attached' });
  await demoPage.close();
  assert.deepEqual(errors, []);
  console.log('PASS: shared scaled Tile delete style/animation, cancellation, inactive/active/last map deletion, failure/retry, single busy request, adjacent selection, cache cleanup, reload and mobile/demo isolation');
} finally { await browser.close(); }
