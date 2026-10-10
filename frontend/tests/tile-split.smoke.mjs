import { selectView } from "./helpers/view-select.js";
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
const tiles = [
  { id: 'complex', tileType: 'QA', weight: 2, message: '分析目标用户并制定实施方案', answer: '目标用户和需求。\n\n实施步骤与适用条件。', relatedTileIds: [], status: 'ready', kind: 'root' },
  { id: 'simple', tileType: 'QA', weight: 1, message: '什么是 HTTP？', answer: 'HTTP 是超文本传输协议。', relatedTileIds: [], status: 'ready', kind: 'root' },
  ...['NOTE', 'FILE'].map(tileType => ({ id: tileType.toLowerCase(), tileType, weight: 1, message: `${tileType} 标题`, answer: '正文', relatedTileIds: [], status: 'ready', kind: tileType.toLowerCase() })),
  { id: 'failed', tileType: 'QA', weight: 1, message: '失败问答', answer: '部分回答', relatedTileIds: [], status: 'error', kind: 'root' },
];
const edges = [];
let fail = false, held = false, release;
await page.route('**/customer-service/maps', route => route.fulfill({ json: { success: true, data: [{ mapId: 'split-map', name: '拆分测试图谱', zoom: 1 }] } }));
await page.route('**/customer-service/tile/workspace?*', route => route.fulfill({ json: { success: true, data: { tiles, edges } } }));
await page.route('**/customer-service/tile/split', async route => {
  const body = route.request().postDataJSON(); writes.push(body);
  if (held) await new Promise(resolve => { release = resolve; });
  if (body.sourceTileId === 'simple') return route.fulfill({ status: 422, json: {
    success: false, errorCode: 'TILE_NOT_SPLITTABLE', message: '拆分失败：当前仅包含一个简单定义，缺少可独立展开的子问题。',
  } });
  if (fail) return route.fulfill({ status: 500, json: { success: false, message: '拆分生成失败，请重试。' } });
  const children = ['目标用户是谁？', '如何实施？'].map((message, index) => ({
    id: `child-${writes.length}-${index}`, tileType: 'QA', weight: 2, message,
    answer: `${index ? '实施步骤与适用条件' : '具体用户和需求'}\n\n本次要求：${body.requirements || '未填写'}`,
    relatedTileIds: [body.sourceTileId], status: 'ready', kind: 'memory',
  }));
  const links = children.map(tile => ({ id: `edge-${tile.id}`, sourceTileId: body.sourceTileId,
    targetTileId: tile.id, direction: 'DIRECTED', relationType: 'DIVIDES', weight: 1, description: '手动拆分' }));
  tiles.push(...children); edges.push(...links);
  await route.fulfill({ json: { success: true, data: { tiles: children, edges: links } } });
});
const split = page.getByRole('button', { name: '拆分选中的 AI 问答 Tile', exact: true });
const fusion = page.getByRole('button', { name: '融合选中的 AI 问答 Tile', exact: true });
const dialog = page.locator('dialog.modal');
const card = id => page.locator('.tile-list article').filter({ has: page.locator('.mono', { hasText: new RegExp(`^${id}$`) }) });
async function select(id) { await card(id).locator('button').first().click(); }
async function toggle(id) { await card(id).getByRole('button', { name: /选择关联|已关联/ }).click(); }
async function closed() { await page.waitForFunction(() => !document.querySelector('dialog.modal').open); }
try {
  await page.addInitScript(() => { localStorage.setItem('aureli-mode', 'live'); localStorage.removeItem('aureli-api-base'); });
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await split.waitFor();
  assert.equal(await split.evaluate(e => e.previousElementSibling?.getAttribute('aria-label')), '融合选中的 AI 问答 Tile');
  await selectView(page, "Tile 列表");
  await card('complex').waitFor();
  assert.equal(await split.isDisabled(), true, 'initially selected detail Tile does not enable split without explicit association');
  for (const id of ['note', 'file', 'failed']) {
    await select(id); assert.equal(await split.isDisabled(), true, `${id} cannot be split`);
    if (id !== 'failed') {
      await toggle(id);
      assert.equal(await split.isDisabled(), true, `an explicitly associated ${id} cannot be split`);
      await toggle(id);
    }
  }
  await select('complex'); assert.equal(await split.isDisabled(), true, 'viewing a QA is not explicit association');
  await toggle('complex'); await toggle('simple');
  assert.equal(await split.isDisabled(), true, 'multiple explicit selections cannot split');
  assert.equal(await fusion.isEnabled(), true, 'fusion still supports multiple QA selections');
  await toggle('simple');
  assert.equal(await split.isEnabled(), true, 'one explicit selection can split');
  await toggle('complex');
  assert.equal(await split.isDisabled(), true, 'clearing the last association disables split despite retained detail selection');
  await toggle('simple');
  assert.equal(await split.isEnabled(), true);
  await page.reload();
  await selectView(page, "Tile 列表");
  await card('complex').waitFor();
  assert.equal(await page.getByRole('button', { name: '已关联', exact: true }).count(), 0);
  assert.equal(await split.isDisabled(), true, 'reload must not fall back to a previously associated or restored detail Tile');
  assert.equal(writes.length, 0);
  await select('simple');
  assert.equal(await split.isDisabled(), true);
  await toggle('complex');

  for (const cancel of ['取消', '关闭对话框', 'Escape']) {
    await split.click(); await dialog.waitFor({ state: 'visible' });
    assert.match(await dialog.innerText(), /分析目标用户并制定实施方案/);
    assert.equal(await dialog.getByLabel(/拆分.*（可选）/).inputValue(), '');
    assert.equal(await dialog.getByLabel(/拆分.*（可选）/).evaluate(e => document.activeElement === e), true);
    assert.equal(writes.length, 0, 'opening or cancelling does not call the model');
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: cancel, exact: true }).click();
    await closed();
    assert.equal(await split.evaluate(e => document.activeElement === e), true);
  }

  await toggle('complex'); await toggle('simple'); await select('simple'); await split.click();
  await dialog.getByRole('button', { name: '生成拆分', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert.match(await dialog.getByRole('alert').textContent(), /简单定义/);
  assert.equal(await page.locator('.tile-list article').count(), 5);
  await dialog.getByLabel(/拆分.*（可选）/).fill('从实施角度展开');
  await dialog.getByRole('button', { name: '生成拆分', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('dialog.modal [role="alert"]')?.textContent.includes('简单定义'));
  await page.waitForFunction(() => !document.querySelector('dialog.modal .modal-actions .primary')?.disabled);
  assert.equal(writes.at(-1).requirements, '从实施角度展开');
  assert.equal(await page.locator('.tile-list article').count(), 5);
  await dialog.screenshot({ path: new URL('../artifacts/tile-split-rejected.png', import.meta.url).pathname });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();

  await toggle('simple'); await toggle('complex'); await select('complex'); await split.click();
  await dialog.getByLabel(/拆分.*（可选）/).fill('面向初学者，按实施步骤细分');
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 900);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog.screenshot({ path: new URL('../artifacts/tile-split-dialog.png', import.meta.url).pathname });
  fail = true;
  await dialog.getByRole('button', { name: '生成拆分', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert.match(await dialog.getByRole('alert').textContent(), /拆分生成失败/);
  assert.equal(await dialog.getByLabel(/拆分.*（可选）/).inputValue(), '面向初学者，按实施步骤细分');
  assert.equal(await page.locator('.tile-list article').count(), 5);
  fail = false; held = true;
  await dialog.getByRole('button', { name: '生成拆分', exact: true }).click();
  await dialog.getByRole('button', { name: '正在判断并拆分…', exact: true }).waitFor();
  assert.equal(await dialog.getByLabel(/拆分.*（可选）/).isDisabled(), true);
  assert.equal(await dialog.getByRole('button', { name: '取消', exact: true }).isDisabled(), true);
  assert.equal(await split.isDisabled(), true);
  await page.keyboard.press('Escape');
  assert.equal(await dialog.evaluate(e => e.open), true);
  for (let attempt = 0; !release && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(release);
  release(); held = false;
  await closed();
  assert.equal(await page.locator('.tile-list article').count(), 7);
  assert.equal(await split.isDisabled(), true, 'successful split clears explicit associations and disables further splitting');
  assert.equal(writes.at(-1).splitId, writes.at(-2).splitId, 'retry keeps the same split ID');
  assert.equal(await card('complex').count(), 1);
  assert.equal(await card('simple').count(), 1);
  assert.equal(writes.at(-1).mapId, 'split-map');
  assert.equal(writes.at(-1).sourceTileId, 'complex');
  assert.equal(await page.locator('.question-text').textContent(), '目标用户是谁？');
  assert.equal(await page.locator('.tile-weight-control').getAttribute('data-weight'), '2');
  assert.match(await page.locator('.answer-text').first().textContent(), /面向初学者/);
  const layoutBefore = await page.evaluate(() => localStorage.getItem('aureli-tile-layouts'));
  assert.ok(Object.values(JSON.parse(layoutBefore)).some(layout => layout.complex && layout[tiles.at(-1).id]));
  await page.reload();
  await selectView(page, "Tile 列表");
  await card(tiles.at(-2).id).waitFor(); await select(tiles.at(-2).id);
  assert.equal(await split.isDisabled(), true, 'selecting a restored child for reading does not associate it for splitting');
  assert.match(await page.locator('.answer-text').first().textContent(), /具体用户和需求/);
  assert.equal(await page.evaluate(() => localStorage.getItem('aureli-tile-layouts')), layoutBefore);
  await selectView(page, "图谱视图");
  assert.deepEqual((await page.locator('.graph-wrap svg.edges text').allTextContents()).map(text => text.trim()), ['DIVIDES', 'DIVIDES']);
  await page.locator('.graph-header').screenshot({ path: new URL('../artifacts/tile-split-toolbar.png', import.meta.url).pathname });

  const beforeDemo = writes.length;
  const demoPage = await browser.newPage();
  await demoPage.addInitScript(() => localStorage.setItem('aureli-mode', 'demo'));
  await demoPage.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  const demoSplit = demoPage.getByRole('button', { name: '拆分选中的 AI 问答 Tile', exact: true });
  await demoSplit.waitFor();
  assert.equal(await demoSplit.isDisabled(), true, 'demo mode also requires explicit association');
  await selectView(demoPage, "Tile 列表");
  await demoPage.locator('.tile-list article').first().getByRole('button', { name: '选择关联', exact: true }).click();
  await demoPage.getByRole('button', { name: '拆分选中的 AI 问答 Tile', exact: true }).click();
  await demoPage.locator('dialog.modal').getByRole('button', { name: '生成拆分', exact: true }).click();
  await demoPage.getByRole('status').filter({ hasText: '示例拆分，已创建 2 个子 Tile' }).waitFor();
  assert.equal(writes.length, beforeDemo, 'demo never calls backend split');
  assert.deepEqual(errors, []);
  console.log('PASS: initial/reloaded/cleared association disables split, only one explicit QA association enables split, adjacent toolbar, artifact/multi-selection guards, optional requirements, AI rejection reason/no nodes, retry/busy protection, atomic UI update, source retention, layout/refresh, mobile and demo isolation');
} finally { await browser.close(); }
