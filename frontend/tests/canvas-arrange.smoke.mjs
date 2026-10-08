import assert from 'node:assert/strict';
import { arrangeTiles } from '../src/lib/graph-layout.js';
import { demoGraph } from '../src/lib/demo.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const baseUrl = process.env.UI_TEST_URL || 'http://127.0.0.1:5173';
const errors = [], writes = [];
const expected = workspace => Object.fromEntries(arrangeTiles(workspace.tiles, workspace.edges)
  .map(({ id, x, y }) => [id, { x, y }]));
async function coordinates(graph) {
  return graph.locator('.graph-node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [
    node.querySelector('.node-top .mono').textContent,
    { x: parseFloat(node.style.left), y: parseFloat(node.style.top) },
  ])));
}
async function layoutSnapshot(page, graph) {
  return {
    coordinates: await coordinates(graph),
    saved: await page.evaluate(() => localStorage.getItem('aureli-tile-layouts')),
    view: await graph.locator('.graph-viewport').evaluate(viewport => ({
      zoom: viewport.querySelector('.graph-world')?.style.transform,
      pan: viewport.querySelector('.graph-space')?.style.transform,
      left: viewport.scrollLeft, top: viewport.scrollTop,
    })),
  };
}
async function confirmArrange(page, graph) {
  // Allow resize observers to reveal the selected Tile before comparing views.
  await graph.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const before = await layoutSnapshot(page, graph);
  await graph.getByRole('button', { name: '一键整理画布', exact: true }).click();
  const dialog = graph.getByRole('dialog', { name: '整理画布？', exact: true });
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /覆盖当前手动布局/);
  assert.deepEqual(await layoutSnapshot(page, graph), before, 'opening confirmation must not change the canvas');
  await dialog.getByRole('button', { name: '确认整理', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
}
async function toolbarFits(graph) {
  const bounds = await graph.evaluate(element => {
    const graph = element.getBoundingClientRect();
    const bar = element.querySelector('.canvas-controls').getBoundingClientRect();
    return { graphLeft: graph.left, graphRight: graph.right, barLeft: bar.left, barRight: bar.right };
  });
  assert.ok(bounds.barLeft >= bounds.graphLeft && bounds.barRight <= bounds.graphRight,
    `toolbar overflows canvas: ${JSON.stringify(bounds)}`);
}
async function setup(page, mode) {
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(mode => {
    localStorage.setItem('aureli-mode', mode);
    if (!localStorage.getItem('aureli-tile-layouts')) localStorage.setItem('aureli-tile-layouts', JSON.stringify({
      demo: { 'tile-001': { x: 1100, y: 900 } },
      [`live:${location.origin}`]: { 'tile-001': { x: 1300, y: 1000 } },
    }));
  }, mode);
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await setup(page, 'demo');
  await page.goto(baseUrl);
  const graph = page.locator('.graph-wrap');
  await graph.locator('.graph-node').last().waitFor();
  const arranged = expected(demoGraph());
  const selected = await graph.locator('.graph-node.selected .node-top .mono').textContent();
  const before = await layoutSnapshot(page, graph);
  for (const dismissal of ['取消', '关闭整理确认', 'Escape']) {
    await graph.getByRole('button', { name: '一键整理画布', exact: true }).click();
    const dialog = graph.getByRole('dialog', { name: '整理画布？', exact: true });
    await dialog.waitFor();
    if (dismissal === '取消') await page.screenshot({ path: 'artifacts/canvas-arrange-confirm.png' });
    if (dismissal === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: dismissal, exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(await layoutSnapshot(page, graph), before, 'cancel, close and Escape preserve the canvas');
    assert.ok(await graph.getByRole('button', { name: '一键整理画布', exact: true }).evaluate(button => button === document.activeElement));
  }
  await confirmArrange(page, graph);
  assert.deepEqual(await coordinates(graph), arranged);
  assert.equal(await graph.locator('.graph-node.selected .node-top .mono').textContent(), selected);
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aureli-tile-layouts')));
  assert.deepEqual(saved['demo:demo'], arranged);
  assert.equal(saved[`live:${new URL(baseUrl).origin}`]['tile-001'].x, 1300, 'demo layout does not alter live layout');
  await graph.getByRole('button', { name: '一键整理画布', exact: true }).focus();
  await page.keyboard.press('Enter');
  const keyboardDialog = graph.getByRole('dialog', { name: '整理画布？', exact: true });
  await keyboardDialog.waitFor();
  assert.ok(await keyboardDialog.getByRole('button', { name: '取消', exact: true }).evaluate(button => button === document.activeElement));
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await keyboardDialog.waitFor({ state: 'hidden' });
  assert.deepEqual(await coordinates(graph), arranged);
  await page.reload();
  await graph.locator('.graph-node').last().waitFor();
  assert.deepEqual(await coordinates(graph), arranged, 'arrangement survives refresh');

  await page.getByRole('button', { name: '全页面查看图谱', exact: true }).click();
  const fullscreen = page.locator('.fullscreen-viewer');
  const fullGraph = fullscreen.locator('.graph-wrap');
  await fullGraph.locator('.graph-viewport').focus();
  await page.keyboard.press('ArrowLeft');
  const panned = await layoutSnapshot(page, fullGraph);
  await fullGraph.getByRole('button', { name: '一键整理画布', exact: true }).click();
  const fullDialog = fullGraph.getByRole('dialog', { name: '整理画布？', exact: true });
  await fullDialog.waitFor();
  await page.keyboard.press('Escape');
  await fullDialog.waitFor({ state: 'hidden' });
  assert.ok(await fullscreen.isVisible(), 'Escape closes only the confirmation, leaving fullscreen open');
  assert.deepEqual(await layoutSnapshot(page, fullGraph), panned, 'fullscreen cancel preserves pan and layout');
  await confirmArrange(page, fullGraph);
  assert.deepEqual(await coordinates(fullGraph), arranged);
  assert.equal(await fullGraph.locator('.graph-space').evaluate(node => node.style.transform), 'translate(0px, 0px)');
  await fullscreen.locator('.fullscreen-header .secondary').click();
  await fullscreen.waitFor({ state: 'detached' });
  assert.deepEqual(await coordinates(graph), arranged, 'fullscreen arrangement is shared');
  await toolbarFits(graph);
  await page.getByRole('button', { name: '最小化节点配置', exact: true }).click();
  await page.locator('.toast button').click();
  await page.screenshot({ path: 'artifacts/canvas-arrange.png' });
  await page.getByRole('button', { name: '展开节点配置', exact: true }).click();
  for (const size of [{ width: 375, height: 900 }, { width: 812, height: 375 }]) {
    await page.setViewportSize(size);
    await toolbarFits(graph);
    await confirmArrange(page, graph);
    assert.deepEqual(await coordinates(graph), arranged);
    await page.locator('.toast button').click();
  }

  const live = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await setup(live, 'live');
  const workspace = demoGraph();
  workspace.tiles[0].weight = 3;
  workspace.tiles[1].weight = 2;
  workspace.tiles.reverse();
  await live.route('**/customer-service/**', route => {
  if (new URL(route.request().url()).pathname.endsWith('/maps')) return route.fulfill({ json: { success: true, data: [{ mapId: 'default', name: '默认图谱' }] } });
    if (route.request().method() !== 'GET') writes.push(route.request().url());
    return route.fulfill({ json: { success: true,
      data: new URL(route.request().url()).pathname.endsWith('/tile/workspace') ? workspace : {} } });
  });
  await live.goto(baseUrl);
  const liveGraph = live.locator('.graph-wrap');
  await liveGraph.locator('.graph-node').last().waitFor();
  await confirmArrange(live, liveGraph);
  assert.deepEqual(await coordinates(liveGraph), expected(workspace));
  saved = await live.evaluate(() => JSON.parse(localStorage.getItem('aureli-tile-layouts')));
  assert.equal(saved.demo['tile-001'].x, 1100, 'live layout does not alter demo layout');
  await live.reload();
  await liveGraph.locator('.graph-node').last().waitFor();
  assert.deepEqual(await coordinates(liveGraph), expected(workspace));

  const empty = await browser.newPage();
  await setup(empty, 'live');
  await empty.route('**/customer-service/**', route => route.fulfill({ json: { success: true,
    data: new URL(route.request().url()).pathname.endsWith('/maps') ? [{ mapId: 'default', name: '默认图谱' }] : new URL(route.request().url()).pathname.endsWith('/tile/workspace') ? { tiles: [], edges: [] } : {} } }));
  await empty.goto(baseUrl);
  await empty.locator('.empty-graph').waitFor();
  assert.ok(await empty.getByRole('button', { name: '一键整理画布', exact: true }).isDisabled());
  assert.deepEqual(writes, [], 'arranging never changes backend workspace data');
  assert.deepEqual(errors, []);
  console.log('Canvas arrangement passed: confirmation, cancel/close/Escape preservation, focus restoration, keyboard, fullscreen, pan reset, persistence, mixed weights, mobile and empty state.');
} finally {
  await browser.close();
}
