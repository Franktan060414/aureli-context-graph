import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
const tiles = [
  ...[1, 2, 3].map(weight => ({ id: `qa-${weight}`, weight, tileType: 'QA', message: `问题 ${weight}`, answer: `回答 ${weight}`, relatedTileIds: [], status: 'ready', kind: 'root' })),
  ...['NOTE', 'FILE'].map(tileType => ({ id: tileType.toLowerCase(), weight: 3, tileType, message: `${tileType} 标题`, answer: `${tileType} 正文`, relatedTileIds: [], status: 'ready', kind: tileType.toLowerCase() })),
  { id: 'failed', weight: 3, message: '失败问答', answer: '', relatedTileIds: [], status: 'error', kind: 'root' },
];
const edges = [];
let fail = false, held = false, release;
await page.route('**/customer-service/maps', route => route.fulfill({ json: { success: true, data: [{ mapId: 'default', name: '默认图谱' }] } }));
await page.route('**/customer-service/tile/workspace?*', route => route.fulfill({ json: { success: true, data: { tiles, edges } } }));
await page.route('**/customer-service/tile/fusion', async route => {
  const body = route.request().postDataJSON();
  writes.push(body);
  if (held) await new Promise(resolve => { release = resolve; });
  if (fail) return route.fulfill({ status: 500, json: { success: false, message: '融合生成失败，请重试' } });
  const sources = body.sourceTileIds.map(id => tiles.find(tile => tile.id === id));
  const tile = { id: body.tileId, weight: Math.max(...sources.map(tile => tile.weight)), tileType: 'QA', message: '模型融合后的用户问题', answer: '模型融合后的完整回答', relatedTileIds: body.sourceTileIds, status: 'ready', kind: 'memory' };
  const links = body.sourceTileIds.map((sourceTileId, i) => ({ id: `${body.tileId}-edge-${i}`, sourceTileId, targetTileId: body.tileId, direction: 'DIRECTED', relationType: 'FUSES', weight: 1 }));
  tiles.push(tile); edges.push(...links);
  await route.fulfill({ json: { success: true, data: { tiles: [tile], edges: links } } });
});
const fusion = page.getByRole('button', { name: '融合选中的 AI 问答 Tile', exact: true });
const dialog = page.locator('dialog.modal');
const card = id => page.locator('.tile-list article').filter({ has: page.locator('.mono', { hasText: new RegExp(`^${id}$`) }) });
async function toggle(id) { await card(id).getByRole('button', { name: /选择关联|已关联/ }).click(); }
async function assertClosed() { await page.waitForFunction(() => !document.querySelector('dialog.modal').open); }
try {
  await page.addInitScript(() => { localStorage.setItem('aureli-mode', 'live'); localStorage.removeItem('aureli-api-base'); });
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await fusion.waitFor();
  await page.getByRole('button', { name: 'Tile 列表', exact: true }).click();
  assert.equal(await fusion.isDisabled(), true);
  await toggle('qa-1'); await toggle('note'); await toggle('file');
  assert.equal(await fusion.isDisabled(), true, 'notes and files cannot supply the second QA');
  await toggle('qa-2');
  assert.equal(await fusion.isEnabled(), true);
  assert.equal(await card('failed').getByRole('button', { name: '选择关联' }).isDisabled(), true);
  for (const cancel of ['取消', '关闭对话框', 'Escape']) {
    await fusion.click();
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await dialog.locator('.fusion-source-list li').count(), 2);
    assert.match(await dialog.innerText(), /已排除 2 个选中节点/);
    assert.doesNotMatch(await dialog.innerText(), /新 Tile 的重要程度/);
    assert.match(await dialog.innerText(), /原 Tile 将保留/);
    assert.equal(writes.length, 0, 'confirmation is required before calling AI');
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: cancel, exact: true }).click();
    await assertClosed();
    assert.equal(await page.locator('.tile-list article').count(), 6);
    assert.equal(await card('qa-1').getByRole('button', { name: '已关联', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await fusion.evaluate(e => document.activeElement === e), true);
  }
  fail = true;
  await fusion.click(); await dialog.getByRole('button', { name: '确认融合', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert.match(await dialog.getByRole('alert').textContent(), /融合生成失败/);
  assert.equal(await page.locator('.tile-list article').count(), 6);
  assert.deepEqual(writes[0].sourceTileIds, ['qa-1', 'qa-2']);
  fail = false; held = true;
  await dialog.getByRole('button', { name: '确认融合', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('dialog.modal .modal-actions .primary')?.textContent.includes('正在融合'));
  assert.equal(await dialog.getByRole('button', { name: '取消', exact: true }).isDisabled(), true);
  await page.keyboard.press('Escape');
  assert.equal(await dialog.evaluate(e => e.open), true, 'busy generation cannot be dismissed');
  while (!release) await new Promise(resolve => setTimeout(resolve, 10));
  release(); held = false;
  await assertClosed();
  assert.deepEqual(writes[1], writes[0], 'retry retains target ID');
  assert.equal(await page.locator('.tile-list article').count(), 7);
  assert.equal(tiles.at(-1).weight, 2, 'ignored high-weight files do not influence QA weight');
  assert.equal(await page.locator('.question-text').textContent(), '模型融合后的用户问题');
  assert.equal((await page.locator('.answer-text').first().textContent()).trim(), '模型融合后的完整回答');
  assert.equal(await fusion.isDisabled(), true, 'selection is cleared after success');
  await page.reload();
  await page.getByRole('button', { name: 'Tile 列表', exact: true }).click();
  await card(writes[0].tileId).waitFor();
  await card(writes[0].tileId).locator('button').first().click();
  assert.equal(await page.locator('.tile-weight-control').getAttribute('data-weight'), '2');
  assert.equal((await page.locator('.answer-text').first().textContent()).trim(), '模型融合后的完整回答');
  await toggle('qa-1'); await toggle('qa-2'); await toggle('qa-3');
  await fusion.click();
  assert.equal(await dialog.locator('.fusion-source-list li').count(), 3);
  assert.doesNotMatch(await dialog.innerText(), /新 Tile 的重要程度/);
  await dialog.screenshot({ path: new URL('../artifacts/tile-fusion-confirm.png', import.meta.url).pathname });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
  }
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.graph-header').screenshot({ path: new URL('../artifacts/tile-fusion-toolbar.png', import.meta.url).pathname });
  const beforeDemo = writes.length;
  await page.evaluate(() => localStorage.setItem('aureli-mode', 'demo'));
  // The init script intentionally sets live mode; replace it with a fresh demo page.
  const demoPage = await browser.newPage();
  await demoPage.addInitScript(() => localStorage.setItem('aureli-mode', 'demo'));
  await demoPage.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await demoPage.getByRole('button', { name: 'Tile 列表', exact: true }).click();
  await demoPage.locator('.tile-list article').nth(0).getByRole('button', { name: '选择关联', exact: true }).click();
  await demoPage.locator('.tile-list article').nth(1).getByRole('button', { name: '选择关联', exact: true }).click();
  await demoPage.getByRole('button', { name: '融合选中的 AI 问答 Tile', exact: true }).click();
  await demoPage.getByRole('button', { name: '确认融合', exact: true }).click();
  await demoPage.getByRole('status').filter({ hasText: '示例融合 Tile 已创建' }).waitFor();
  assert.equal(writes.length, beforeDemo, 'demo fusion does not call the backend');
  assert.deepEqual(errors, []);
  console.log('PASS: QA filtering, highest eligible weight, 2+ selections, confirmation/cancel/close/Escape/focus, no premature request, error retry, busy protection, original retention, new question/answer, refresh persistence, responsive dialog and demo isolation');
} finally { await browser.close(); }
