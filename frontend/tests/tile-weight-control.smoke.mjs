import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
const tiles = [1, 2].map(weight => ({ id: `tile-${weight}`, weight, message: '验证当前 Tile 的权重', answer: '完整 AI 回答。'.repeat(60), relatedTileIds: [], status: 'ready', kind: 'root' }));
let fail = false, finishSave;
await page.route('**/customer-service/maps', route => route.fulfill({ json: { success: true, data: [{ mapId: 'default', name: '默认图谱' }] } }));
await page.route('**/customer-service/tile/workspace?*', route => route.fulfill({ json: { success: true, data: { tiles, edges: [] } } }));
await page.route('**/customer-service/tile/weight', async route => {
  const body = route.request().postDataJSON();
  writes.push(body);
  if (finishSave === 'hold') await new Promise(resolve => { finishSave = resolve; });
  if (fail) return route.fulfill({ json: { success: false, message: '保存失败，请重试' } });
  tiles.find(tile => tile.id === body.tileId).weight = body.weight;
  await route.fulfill({ json: { success: true } });
});
const control = page.locator('.tile-weight-control');
const select = page.getByRole('combobox', { name: '调整当前 Tile 重要程度' });
const url = process.env.UI_TEST_URL || 'http://127.0.0.1:5173';
async function saved(weight) {
  await page.waitForFunction(weight => document.querySelector('.tile-weight-control')?.dataset.weight === String(weight) && !document.querySelector('.tile-weight-control select').disabled, weight);
  await page.waitForFunction(() => !document.getAnimations().some(a => a.effect.target === document.querySelector('.tile-weight-control') && a.playState === 'running'));
  assert.equal(await select.inputValue(), String(weight));
}
try {
  await page.goto(url); await select.waitFor();
  assert.deepEqual(await select.locator('option').allTextContents(), ['普通', '重要', '非常重要']);
  assert.equal(await page.locator('.tile-weight-section').evaluate(e => e.previousElementSibling.querySelector('h2').textContent.includes('AI 回答') && e.nextElementSibling.querySelector('h2').textContent.includes('上下文来源')), true);
  const accents = ['rgb(21, 122, 59)', 'rgb(180, 83, 9)', 'rgb(180, 35, 47)'];
  const white = 'rgb(255, 255, 255)';
  const dimensions = [260, 390, 650];
  for (const weight of [1, 2, 3, 1]) {
    await select.selectOption(String(weight)); await saved(weight);
    await page.mouse.move(2, 2); await select.blur(); await saved(weight);
    assert.equal(await control.evaluate(e => getComputedStyle(e).backgroundColor), white);
    assert.equal(await select.evaluate(e => getComputedStyle(e).color), accents[weight - 1]);
    await control.hover(); await saved(weight);
    assert.equal(await control.evaluate(e => getComputedStyle(e, '::after').backgroundColor), accents[weight - 1]);
    assert.equal(await control.evaluate(e => new DOMMatrix(getComputedStyle(e, '::after').transform).m41), 0);
    assert.equal(await select.evaluate(e => getComputedStyle(e).color), white);
    await page.mouse.move(2, 2); await saved(weight);
    assert.equal(await select.evaluate(e => getComputedStyle(e).color), accents[weight - 1]);
    assert.equal(await page.locator('.graph-node').first().evaluate(e => parseFloat(e.style.width)), dimensions[weight - 1]);
    assert.equal(await page.locator('.tile-weight').textContent(), ['普通', '重要', '非常重要'][weight - 1]);
  }
  assert.deepEqual(writes, [{ mapId: 'default', tileId: 'tile-1', weight: 2 }, { mapId: 'default', tileId: 'tile-1', weight: 3 }, { mapId: 'default', tileId: 'tile-1', weight: 1 }]);
  await select.selectOption('3'); await saved(3);
  await page.reload(); await saved(3);
  fail = true;
  await select.selectOption('2');
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('权重保存失败'));
  await saved(3); assert.equal(tiles[0].weight, 3);
  fail = false;
  finishSave = 'hold';
  await select.selectOption('2');
  await page.waitForFunction(() => document.querySelector('.tile-weight-control select').disabled);
  assert.equal(await control.getAttribute('aria-busy'), 'true');
  // Switching selected nodes while a save is in flight must update only the original Tile.
  await page.locator('.node-main').nth(1).click();
  finishSave(); await saved(2);
  assert.equal(await page.locator('.detail-title .mono').first().textContent(), 'tile-2');
  assert.equal(tiles[0].weight, 2); assert.equal(tiles[1].weight, 2);
  await page.locator('.node-main').first().click(); await saved(2);
  await page.mouse.move(2, 2); await select.blur();
  await control.hover();
  const motion = await control.evaluate(e => { const animation = document.getAnimations().find(a => a.effect.target === e && a.transitionProperty === 'transform'); if (!animation) return null; animation.pause(); animation.currentTime = 80; const fill = getComputedStyle(e, '::after'); return { duration: animation.effect.getTiming().duration, x: new DOMMatrix(fill.transform).m41, width: e.clientWidth }; });
  assert.ok(motion, 'weight button shares the moving accent layer');
  assert.equal(motion.duration, 320); assert.ok(motion.x < 0 && motion.x > -motion.width);
  await control.evaluate(e => document.getAnimations().filter(a => a.effect.target === e).forEach(a => a.play()));
  await page.mouse.move(2, 2);
  // macOS native option popups cannot be driven by headless Chrome (also true for a plain select).
  // Check keyboard focus/Escape here; exercise native option values with selectOption above.
  await select.focus();
  await page.keyboard.press('Escape');
  assert.equal(await select.inputValue(), '2');
  assert.ok(await control.evaluate(e => parseFloat(getComputedStyle(e).outlineWidth) >= 2), 'keyboard focus remains visible in the compact inspector');
  assert.equal(await control.evaluate(e => getComputedStyle(e).backgroundColor), white);
  assert.equal(await select.evaluate(e => getComputedStyle(e).color), accents[1]);
  await select.blur(); await page.emulateMedia({ reducedMotion: 'reduce' });
  await control.hover();
  assert.equal(await control.evaluate(e => getComputedStyle(e, '::after').transitionDuration), '0s');
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await select.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const bounds = await control.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.mouse.move(2, 2); await select.blur(); await saved(2);
  await page.locator('.inspector').screenshot({ path: new URL('../artifacts/tile-weight-control.png', import.meta.url).pathname });
  await page.addInitScript(() => localStorage.setItem('aureli-mode', 'demo'));
  await page.reload(); await select.waitFor();
  const before = writes.length;
  await select.selectOption('3'); await saved(3); assert.equal(writes.length, before, 'demo is isolated');
  assert.deepEqual(errors, []);
  console.log('PASS: three options/colors, correct location, current Tile only, graph sizing, saved reload, failed save retention, busy state, keyboard focus/Escape, 320ms accent animation, reduced motion, responsive layout and demo isolation');
} finally { await browser.close(); }
