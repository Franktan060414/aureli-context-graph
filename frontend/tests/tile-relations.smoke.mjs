import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
const tiles = [1, 2, 3, 4].map(i => ({ id: `qa-${i}`, message: `问题 ${i}`, answer: `回答 ${i}`, status: 'ready', kind: 'root', relatedTileIds: [], weight: 1 }));
const edges = [
  { id: 'one', sourceTileId: 'qa-1', targetTileId: 'qa-2', direction: 'DIRECTED', relationType: 'CUSTOM', weight: 1 },
  { id: 'two', sourceTileId: 'qa-2', targetTileId: 'qa-3', direction: 'UNDIRECTED', relationType: 'EXTENDS', weight: 1 },
  { id: 'fusion', sourceTileId: 'qa-3', targetTileId: 'qa-4', direction: 'DIRECTED', relationType: 'FUSES', weight: 1 },
  { id: 'split', sourceTileId: 'qa-1', targetTileId: 'qa-4', direction: 'DIRECTED', relationType: 'DIVIDES', weight: 1 },
  { id: 'legacy-split', sourceTileId: 'qa-2', targetTileId: 'qa-4', direction: 'DIRECTED', relationType: 'DEVIDES', weight: 1 },
];
await page.route('**/customer-service/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/maps')) return route.fulfill({ json: { success: true, data: [{ mapId: 'test', name: '关系测试' }] } });
  if (path.endsWith('/tile/workspace')) return route.fulfill({ json: { success: true, data: { tiles, edges } } });
  if (path.endsWith('/question/plan')) return route.fulfill({ json: { success: true, data: { suggested: false, reason: '单一问题', questions: [], planId: null } } });
  if (path.endsWith('/completion')) {
    writes.push(route.request().postDataJSON());
    return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"v":"回答"}\n\ndata: {"done":true}\n\n' });
  }
  return route.fulfill({ json: { success: true } });
});
try {
  await page.addInitScript(() => localStorage.setItem('aureli-mode', 'live'));
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await page.locator('.graph-node').first().waitFor();
  assert.deepEqual((await page.locator('.graph-wrap svg.edges text').allTextContents()).map(s => s.trim()).sort(), ['DIVIDES', 'DIVIDES', 'EXTENDS', 'FUSES', 'RELATES']);
  await page.getByRole('button', { name: '添加Tile', exact: true }).click();
  const inspectorRelation = page.locator('#inspector-question-form-relation');
  assert.equal(await inspectorRelation.inputValue(), 'EXTENDS');
  assert.equal(await inspectorRelation.getAttribute('readonly'), '');
  await page.locator('#inspector-question-form-direction').selectOption('UNDIRECTED');
  assert.equal(await inspectorRelation.inputValue(), 'RELATES');
  await page.locator('#inspector-question-form-direction').selectOption('DIRECTED');
  await page.getByRole('button', { name: '打开添加Tile弹窗', exact: true }).click();
  const dialog = page.locator('dialog.modal[open]');
  const relation = dialog.getByLabel('关系类型', { exact: true });
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await relation.inputValue(), 'EXTENDS');
  assert.equal(await relation.getAttribute('readonly'), '');
  for (const cancel of ['取消', '关闭对话框', 'Escape']) {
    await dialog.getByLabel('提问内容').fill('修改后再提交的问题');
    await dialog.getByLabel('当前 Tile ID').fill('draft-only');
    await dialog.locator('#dialog-question-form-direction').selectOption('UNDIRECTED');
    const tileCount = await page.locator('.graph-node').count();
    const edgeCount = await page.locator('.graph-wrap svg.edges text').count();
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: cancel, exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('dialog.modal').open);
    assert.equal(writes.length, 0, 'cancel must not send an answer generation request');
    assert.equal(await page.locator('.graph-node').count(), tileCount, 'cancel must not create any Tile');
    assert.equal(await page.locator('.graph-wrap svg.edges text').count(), edgeCount, 'cancel must not create edges');
    await page.getByRole('button', { name: '打开添加Tile弹窗', exact: true }).click();
    assert.equal(await dialog.getByLabel('提问内容').inputValue(), '修改后再提交的问题');
    assert.equal(await dialog.getByLabel('当前 Tile ID').inputValue(), 'draft-only');
    assert.equal(await dialog.locator('#dialog-question-form-direction').inputValue(), 'UNDIRECTED');
  }
  await dialog.locator('#dialog-question-form-direction').selectOption('UNDIRECTED');
  assert.equal(await relation.inputValue(), 'RELATES');
  await dialog.locator('#dialog-question-form-direction').selectOption('DIRECTED');
  assert.equal(await relation.inputValue(), 'EXTENDS');
  await dialog.locator('#dialog-question-form-direction').selectOption('UNDIRECTED');
  await relation.evaluate(input => { input.value = 'CUSTOM'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await dialog.getByLabel('提问内容').fill('双向问题');
  await dialog.getByLabel('当前 Tile ID').fill('new-bidirectional');
  await dialog.getByRole('button', { name: '发送并生成 Tile', exact: true }).click();
  await page.locator('.status-text', { hasText: '回答已完成' }).waitFor();
  assert.equal(writes[0].edgeDirection, 'UNDIRECTED');
  assert.equal(writes[0].relationType, 'RELATES');
  assert.deepEqual(errors, []);
  console.log('PASS: DIVIDES and legacy split edges, fusion preserved, cancel/close/Escape create no Tiles or edges and retain drafts, readonly type follows direction, submitted type is RELATES');
} finally { await browser.close(); }
