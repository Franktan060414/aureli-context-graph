import { selectView } from './helpers/view-select.js';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const output = new URL('../artifacts/tile-replacement/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const tile = id => ({ id, tileType: 'QA', weight: 2, message: `问题 ${id}`, answer: `完整回答 ${id}`,
  relatedTileIds: [], status: 'ready', kind: 'root' });
const link = (sourceTileId, targetTileId, relationType, direction = 'DIRECTED', weight = 0.7) => ({
  id: `edge-${sourceTileId}-${targetTileId}`, sourceTileId, targetTileId, relationType, direction, weight, description: `${sourceTileId} 与 ${targetTileId}`,
});
const syncParents = graph => {
  graph.tiles.forEach(tile => {
    tile.relatedTileIds = [...new Set(graph.edges.filter(edge => edge.targetTileId === tile.id).map(edge => edge.sourceTileId))];
    if (tile.tileType === 'QA') tile.kind = tile.relatedTileIds.length ? 'memory' : 'root';
  });
  return graph;
};
async function exported(page) {
  await page.getByRole('button', { name: '导出图谱', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出图谱', exact: true });
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '导出', exact: true }).click();
  return JSON.parse(await readFile(await (await downloading).path(), 'utf8'));
}

try {
  for (const operation of ['split', 'fusion']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    const graph = syncParents({ tiles: ['one', 'two', 'parent', 'child', 'note', 'file'].map(id => ({ ...tile(id),
      tileType: id === 'note' ? 'NOTE' : id === 'file' ? 'FILE' : 'QA' })), edges: [
      link('parent', 'one', 'EXTENDS'), link('one', 'child', 'DIVIDES', 'DIRECTED', 0.4),
      link('one', 'note', 'RELATES', 'UNDIRECTED', 0.3), link('one', 'two', 'FUSES'),
      link('two', 'file', 'RELATES', 'UNDIRECTED', 0.5), link('parent', 'file', 'EXTENDS'),
    ], labels: [] });
    let fail = true, release;
    let ordinaryRequests = 0;
    await page.addInitScript(() => { localStorage.setItem('aureli-mode', 'live'); localStorage.removeItem('aureli-api-base'); });
    await page.route('**/customer-service/maps', route => route.fulfill({ json: { success: true, data: [{ mapId: 'replacement', name: '覆盖测试' }] } }));
    await page.route('**/customer-service/tile/workspace?*', route => route.fulfill({ json: { success: true, data: graph } }));
    await page.route('**/customer-service/tile/fusion', route => {
      ordinaryRequests++;
      return route.fulfill({ status: 500, json: { success: false, message: '覆盖操作不能调用普通融合接口' } });
    });
    await page.route(`**/customer-service/tile/${operation === 'fusion' ? 'fusion/overwrite' : operation}`, async route => {
      const body = route.request().postDataJSON();
      writes.push(body);
      assert.equal(body.overwrite, true);
      if (fail === 'unsupported') return route.fulfill({ status: 404, json: { status: 404 } });
      if (fail === 'unconfirmed') return route.fulfill({ json: { success: true,
        data: { tiles: [tile(body.tileId)], edges: [link('one', body.tileId, 'FUSES')] } } });
      if (fail) return route.fulfill({ status: 500, json: { success: false, message: '生成失败，原 Tile 保留，请重试。' } });
      await new Promise(resolve => { release = resolve; });
      const ids = operation === 'split' ? [body.sourceTileId] : body.sourceTileIds;
      const replacements = operation === 'split' ? ['replacement-child-0', 'replacement-child-1'] : [body.tileId];
      const added = replacements.map(tile);
      const links = graph.edges.flatMap(edge => {
        const incoming = ids.includes(edge.targetTileId), outgoing = ids.includes(edge.sourceTileId);
        return incoming === outgoing ? [] : replacements.map((id, index) => ({ ...edge,
          id: `inherited-${edge.id}-${index}`, sourceTileId: outgoing ? id : edge.sourceTileId, targetTileId: incoming ? id : edge.targetTileId,
        }));
      });
      graph.tiles = [...graph.tiles.filter(tile => !ids.includes(tile.id)), ...added];
      graph.edges = [...graph.edges.filter(edge => !ids.includes(edge.sourceTileId) && !ids.includes(edge.targetTileId)), ...links];
      syncParents(graph);
      await route.fulfill({ json: { success: true, data: { tiles: added, edges: links, deletedTileIds: ids } } });
    });
    const card = id => page.locator('.tile-list article').filter({ has: page.locator('.mono', { hasText: new RegExp(`^${id}$`) }) });
    await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
    await selectView(page, 'Tile 列表');
    await card('one').getByRole('button', { name: '选择关联', exact: true }).click();
    if (operation === 'fusion') {
      await card('two').getByRole('button', { name: '选择关联', exact: true }).click();
      await card('note').getByRole('button', { name: '选择关联', exact: true }).click();
    }
    const toolbar = page.getByRole('button', { name: operation === 'split' ? '拆分选中的 AI 问答 Tile' : '融合选中的 AI 问答 Tile', exact: true });
    const dialog = page.locator('dialog.modal');
    const overwriteName = operation === 'split' ? '拆分并覆盖' : '融合并覆盖';
    const originalName = operation === 'split' ? '生成拆分' : '确认融合';
    await toolbar.click();
    await dialog.getByRole('button', { name: originalName, exact: true }).waitFor();
    if (operation === 'split') {
      assert.equal(await dialog.getByRole('button', { name: overwriteName, exact: true }).count(), 0);
      assert.doesNotMatch(await dialog.innerText(), /拆分并覆盖/);
      assert.equal(writes.length, 0);
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await page.close();
      continue;
    }
    assert.match(await dialog.innerText(), /覆盖后无法撤销/);
    assert.equal(writes.length, 0);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await card('one').count(), 1);
    await toolbar.click();
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, `dialog fits ${width}px`);
      const bounds = await dialog.getByRole('button', { name: overwriteName, exact: true }).boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await dialog.screenshot({ path: output + `${operation}-dialog.png` });
    for (const [failure, message] of [['unsupported', /更新并重启后端/], ['unconfirmed', /未确认原 Tile 已删除/]]) {
      fail = failure;
      await dialog.getByRole('button', { name: overwriteName, exact: true }).click();
      await dialog.getByRole('alert').waitFor();
      assert.match(await dialog.getByRole('alert').textContent(), message);
      assert.equal(await page.locator('.tile-list article').count(), 6, 'unconfirmed deletion never removes sources from the canvas');
    }
    fail = true;
    if (operation === 'split') await dialog.getByLabel(/拆分.*（可选）/).fill('按实施步骤展开');
    await dialog.getByRole('button', { name: overwriteName, exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(await card('one').count(), 1, 'failed overwrite retains the source');
    assert.equal(await page.locator('.tile-list article').count(), 6);
    fail = false;
    await dialog.getByRole('button', { name: overwriteName, exact: true }).click();
    await dialog.getByRole('button', { name: `正在${overwriteName}…`, exact: true }).waitFor();
    for (const button of [originalName, '取消']) assert.equal(await dialog.getByRole('button', { name: button, exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.evaluate(el => el.open), true);
    for (let attempt = 0; !release && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(release);
    release();
    await page.waitForFunction(() => !document.querySelector('dialog.modal').open);
    assert.deepEqual(writes.at(-1), writes.at(-2), 'retry retains operation IDs and requirements');
    assert.equal(ordinaryRequests, 0, 'overwrite never falls back to ordinary fusion');
    assert.equal(await card('one').count(), 0);
    assert.equal(await card('two').count(), operation === 'fusion' ? 0 : 1);
    assert.equal(await card('note').count(), 1, 'excluded artifacts remain');
    assert.equal(await toolbar.isDisabled(), true);
    const snapshot = await exported(page);
    assert.deepEqual(snapshot.edges, graph.edges);
    assert.deepEqual(snapshot.tiles, graph.tiles, 'all neighbours immediately reference the new Tile IDs');
    assert.ok(!snapshot.layout.one && (operation === 'split' || !snapshot.layout.two));
    const replacements = graph.tiles.filter(tile => operation === 'split' ? tile.id.startsWith('replacement-child-') : tile.id === writes[0].tileId);
    assert.ok(replacements.every(tile => snapshot.layout[tile.id]));
    await page.reload();
    await card(replacements[0].id).waitFor();
    const restored = await exported(page);
    assert.deepEqual(restored.tiles, snapshot.tiles);
    assert.deepEqual(restored.edges, snapshot.edges);
    assert.deepEqual(restored.layout, snapshot.layout);
    assert.deepEqual(errors, []);
    await page.close();
  }

  console.log('PASS: split overwrite option removed in API, normal split retains source, fusion overwrite, descriptions/cancel, failure retry, busy protection, preserved edge metadata, neighbour references, artifact exclusion, layouts, reload, 320–1440px');
} finally {
  await browser.close();
}
