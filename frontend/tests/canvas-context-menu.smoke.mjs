import assert from 'node:assert/strict';
import { selectView } from './helpers/view-select.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(8000);
const errors = [], deletes = [], completions = [];
page.on('pageerror', error => errors.push(error.message));
const makeTile = (id, status = 'ready', tileType = 'QA') => ({ id, status, tileType, weight: 1,
  kind: tileType === 'QA' ? 'root' : tileType.toLowerCase(), message: `测试 ${id}`, answer: '节点正文', relatedTileIds: [] });
const graphs = { a: { tiles: [makeTile('a'), makeTile('b'), makeTile('note', 'ready', 'NOTE'), makeTile('error', 'error'), makeTile('loading', 'loading')], edges: [] }, empty: { tiles: [], edges: [] } };
let failDelete = false, releaseCompletion;
await page.addInitScript(() => localStorage.setItem('aureli-mode', 'live'));
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.route('**/customer-service/**', async route => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname;
  if (path.endsWith('/maps')) return route.fulfill({ json: { success: true, data: [{ mapId: 'a', name: '测试图谱' }, { mapId: 'empty', name: '空白图谱' }] } });
  if (path.endsWith('/tile/workspace')) return route.fulfill({ json: { success: true, data: graphs[url.searchParams.get('mapId')] } });
  if (path.endsWith('/tile/delete')) {
    const body = request.postDataJSON(); deletes.push(body);
    if (failDelete) return route.fulfill({ json: { success: false, message: '删除失败，请重试' } });
    graphs[body.mapId].tiles = graphs[body.mapId].tiles.filter(tile => tile.id !== body.tileId);
    return route.fulfill({ json: { success: true } });
  }
  if (path.endsWith('/question/plan')) return route.fulfill({ json: { success: true, data: { suggested: false, questions: [], planId: null } } });
  if (path.endsWith('/completion')) {
    const body = request.postDataJSON(); completions.push(body);
    await new Promise(resolve => { releaseCompletion = resolve; });
    return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"v":"右键创建的回答"}\n\ndata: {"done":true}\n\n' });
  }
  return route.fulfill({ json: { success: true } });
});
const graph = () => page.locator('.graph-workbench .graph-wrap');
const card = (id, canvas = graph()) => canvas.locator(`.graph-node[data-tile-id="${id}"]`);
const menu = () => page.getByRole('menu');
const item = name => menu().getByRole('menuitem', { name, exact: true });
const dialog = () => page.locator('dialog[aria-labelledby="workspace-modal-title"]');
async function nodeMenu(id, canvas = graph()) {
  const main = card(id, canvas).locator('.node-main');
  const visible = await main.evaluate(e => {
    const b = e.getBoundingClientRect();
    return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('.graph-node') === e.closest('.graph-node');
  });
  if (!visible) {
    // An infinite camera has no native scroll-to-element; keyboard focus reveals it.
    await canvas.locator('.graph-viewport').press('Tab');
    await main.focus();
  }
  await main.click({ button: 'right' });
  await page.getByRole('menu', { name: '节点快捷操作' }).waitFor();
}
async function blankMenu(canvas = graph(), atEdge = false) {
  const point = await canvas.locator('.graph-viewport').evaluate((viewport, atEdge) => {
    const b = viewport.getBoundingClientRect();
    const right = Math.min(innerWidth, b.right) - 16, bottom = Math.min(innerHeight, b.bottom) - 16;
    for (let y = atEdge ? bottom : b.top + 20; atEdge ? y > b.top + 20 : y < bottom; y += atEdge ? -20 : 20) {
      for (let x = right; x > b.left + 20; x -= 20) {
        const target = document.elementFromPoint(x, y);
        if (target?.closest('.graph-viewport') === viewport && !target.closest('.graph-node, button, input, select')) return { x, y };
      }
    }
    throw new Error('No visible blank canvas');
  }, atEdge);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.getByRole('menu', { name: '画布快捷操作' }).waitFor();
}
async function escapeMenu() {
  await page.keyboard.press('Escape');
  await menu().waitFor({ state: 'hidden' });
}
try {
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await card('a').waitFor();
  await card('a').locator('.node-main').click();
  const position = await card('b').getAttribute('style');
  const relate = card('a').locator('.node-relate');
  const relateBox = await relate.boundingBox(), expandBox = await card('a').locator('.node-expand').boundingBox();
  for (const box of [relateBox, expandBox]) {
    assert.equal(box.width, 32); assert.equal(box.height, 32);
  }
  assert.equal(relateBox.y, expandBox.y);
  assert.equal(expandBox.x - (relateBox.x + relateBox.width), 6, 'compact actions sit side by side');
  await relate.click();
  assert.equal(await relate.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.detail-relate').getAttribute('aria-pressed'), 'true');
  await nodeMenu('a'); assert.equal(await item('取消关联').count(), 1); await escapeMenu();
  await page.locator('.detail-relate').click();
  assert.equal(await relate.getAttribute('aria-pressed'), 'false');
  await card('b').locator('.node-relate').click();
  assert.equal(await card('b').locator('.node-relate').getAttribute('aria-pressed'), 'true');
  assert.equal(await card('a').locator('.node-main').getAttribute('aria-pressed'), 'true', 'association leaves the inspected Tile selected');
  assert.equal(await card('b').getAttribute('style'), position, 'association never moves a Tile');
  await card('b').locator('.node-relate').click();
  await graph().screenshot({ path: new URL('../artifacts/canvas-compact-actions.png', import.meta.url).pathname });
  await card('a').locator('.node-expand').click();
  await page.locator('.tile-reading').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.fullscreen-viewer').waitFor({ state: 'detached' });
  await nodeMenu('b');
  const menuWidth = (await menu().boundingBox()).width;
  assert.equal(await menu().getByRole('menuitem').count(), 5);
  assert.equal(await item('整理画布').count(), 0, 'arrangement is offered on blank canvas');
  assert.equal(await item('标签').count(), 1);
  assert.equal(await item('从此处延伸问答Tile').locator('svg').innerHTML(), await item('添加问答 Tile').locator('svg').innerHTML(), 'question actions share the same icon');
  assert.equal(await card('a').locator('.node-main').getAttribute('aria-pressed'), 'true');
  await graph().screenshot({ path: new URL('../artifacts/canvas-context-menu-node.png', import.meta.url).pathname });
  await item('关联节点').click();
  assert.equal(await card('b').evaluate(e => e.classList.contains('associated')), true);
  assert.equal(await card('a').evaluate(e => e.classList.contains('associated')), false);
  assert.equal(await card('b').getAttribute('style'), position, 'right click never moves a Tile');
  await nodeMenu('a'); await item('关联节点').click();
  assert.equal(await page.locator('.detail-relate').getAttribute('aria-pressed'), 'true');
  await nodeMenu('a'); await item('取消关联').click();
  assert.equal(await page.locator('.detail-relate').getAttribute('aria-pressed'), 'false');
  await nodeMenu('b'); await nodeMenu('a'); await item('关联节点').click();
  assert.equal(await page.locator('.detail-relate').getAttribute('aria-pressed'), 'true');
  await nodeMenu('a'); await item('取消关联').click();
  await nodeMenu('note'); await item('关联节点').click();
  assert.equal(await graph().locator('.graph-node.associated').count(), 2);
  for (const id of ['error', 'loading']) {
    assert.equal(await card(id).locator('.node-relate').isDisabled(), true);
    await nodeMenu(id);
    assert.equal(await item('关联节点').getAttribute('aria-disabled'), 'true');
    assert.equal(await item('从此处延伸问答Tile').getAttribute('aria-disabled'), 'true');
    assert.notEqual(await item('删除节点').getAttribute('aria-disabled'), 'true');
    await escapeMenu();
  }
  await card('b').locator('.node-main').focus();
  await page.keyboard.press('Shift+F10'); await menu().waitFor();
  await page.keyboard.press('Home');
  assert.equal(await menu().getByRole('menuitem').first().evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await item('删除节点').evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter'); await menu().waitFor({ state: 'hidden' });
  assert.equal(await card('b').evaluate(e => e.classList.contains('associated')), false);
  await nodeMenu('b'); await escapeMenu();
  assert.equal(await card('b').locator('.node-main').evaluate(e => e === document.activeElement), true);
  await graph().getByRole('button', { name: '缩小图谱', exact: true }).click();
  await nodeMenu('a');
  assert.ok(Math.abs((await menu().boundingBox()).width - menuWidth) < 1, 'menu stays at normal size when canvas is zoomed');
  await escapeMenu();
  await graph().getByRole('button', { name: '放大图谱', exact: true }).click();
  await nodeMenu('b'); await page.getByRole('button', { name: '最小化节点配置', exact: true }).click();
  await menu().waitFor({ state: 'hidden' });
  await nodeMenu('b'); await item('删除节点').click();
  await dialog().waitFor(); assert.match(await dialog().textContent(), /「b」/);
  assert.equal(deletes.length, 0);
  await dialog().getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await card('b').count(), 1);
  await nodeMenu('b'); await item('删除节点').click();
  failDelete = true;
  await dialog().getByRole('button', { name: '删除 Tile', exact: true }).click();
  await dialog().getByRole('alert').waitFor(); assert.equal(await card('b').count(), 1);
  failDelete = false;
  await dialog().getByRole('button', { name: '删除 Tile', exact: true }).click();
  await card('b').waitFor({ state: 'detached' });
  assert.deepEqual(deletes, [{ mapId: 'a', tileId: 'b' }, { mapId: 'a', tileId: 'b' }]);
  await blankMenu(graph(), true);
  assert.equal(await menu().getByRole('menuitem').count(), 3);
  assert.equal(await item('标签').count(), 0, 'labels are offered only on a Tile');
  assert.equal(await item('从此处延伸问答Tile').count(), 0, 'extending requires a Tile');
  assert.notEqual(await item('回到中心').getAttribute('aria-disabled'), 'true');
  const bounds = await menu().boundingBox();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 1440 && bounds.y + bounds.height <= 1000);
  await graph().screenshot({ path: new URL('../artifacts/canvas-context-menu-blank.png', import.meta.url).pathname });
  const savedLayout = await page.evaluate(() => localStorage.getItem('aureli-tile-layouts'));
  const savedCamera = await graph().locator('.graph-space').getAttribute('style');
  await item('整理画布').click();
  const arrangeDialog = graph().getByRole('dialog', { name: '整理画布', exact: true });
  await arrangeDialog.waitFor(); await menu().waitFor({ state: 'hidden' });
  assert.equal(await arrangeDialog.getByRole('radio', { name: '树状排列', exact: true }).isChecked(), true);
  await arrangeDialog.getByRole('radio', { name: 'Layered 排列', exact: true }).check();
  await page.keyboard.press('Escape'); await arrangeDialog.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => localStorage.getItem('aureli-tile-layouts')), savedLayout);
  assert.equal(await graph().locator('.graph-space').getAttribute('style'), savedCamera);
  assert.equal(await graph().locator('.graph-viewport').evaluate(e => e === document.activeElement), true, 'arrangement restores canvas focus');
  await blankMenu(graph(), true);
  await item('添加问答 Tile').click(); await dialog().waitFor();
  assert.equal(await dialog().getByLabel('提问内容').evaluate(e => e === document.activeElement), true);
  await dialog().getByLabel('提问内容').fill('由画布右键添加');
  await dialog().getByRole('button', { name: '发送并生成 Tile', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.status-text')?.textContent.includes('正在生成回答'));
  assert.equal(await card('a').locator('.node-relate').isDisabled(), true);
  assert.deepEqual(completions[0].relatedTileIds, ['note']);
  await nodeMenu('a');
  for (const element of await menu().getByRole('menuitem').all()) assert.equal(await element.getAttribute('aria-disabled'), 'true');
  await escapeMenu();
  await blankMenu();
  assert.equal(await item('整理画布').getAttribute('aria-disabled'), 'true', 'cannot arrange while generating');
  assert.notEqual(await item('回到中心').getAttribute('aria-disabled'), 'true', 'navigation remains available while generating');
  await item('回到中心').click();
  await menu().waitFor({ state: 'hidden' });
  releaseCompletion();
  await page.waitForFunction(() => document.querySelector('.status-text')?.textContent.includes('回答已完成'));
  // Extending replaces a multi-selection with the right-clicked Tile, irrespective of the inspected Tile.
  await nodeMenu('note'); await item('关联节点').click();
  await nodeMenu('a'); await item('关联节点').click();
  await card('note').locator('.node-main').click();
  await nodeMenu('a'); await item('从此处延伸问答Tile').click();
  await dialog().waitFor();
  assert.equal(await dialog().locator('.context-picker .chips button').count(), 1);
  assert.equal(await dialog().getByRole('button', { name: '移除关联 a', exact: true }).count(), 1);
  assert.equal(await card('note').locator('.node-main').getAttribute('aria-pressed'), 'true');
  assert.equal(await dialog().getByLabel('提问内容').evaluate(e => e === document.activeElement), true);
  await dialog().getByLabel('提问内容').fill('从 a 延伸的新问题');
  await dialog().getByRole('button', { name: '发送并生成 Tile', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.status-text')?.textContent.includes('正在生成回答'));
  assert.equal(completions.length, 2);
  assert.deepEqual(completions[1].relatedTileIds, ['a']);
  assert.equal(completions[1].message, '从 a 延伸的新问题');
  releaseCompletion();
  await page.waitForFunction(() => document.querySelector('.status-text')?.textContent.includes('回答已完成'));
  await page.getByRole('button', { name: '全页面查看图谱', exact: true }).click();
  const fullscreen = page.locator('.fullscreen-viewer .graph-wrap');
  await nodeMenu('a', fullscreen); await escapeMenu();
  assert.equal(await page.locator('.fullscreen-viewer').count(), 1, 'Escape closes only the context menu');
  await nodeMenu('a', fullscreen); await item('关联节点').click();
  assert.equal(await card('a', fullscreen).evaluate(e => e.classList.contains('associated')), true);
  assert.equal(await card('a', fullscreen).locator('.node-relate').getAttribute('aria-pressed'), 'true');
  await card('a', fullscreen).locator('.node-relate').click();
  assert.equal(await card('a', fullscreen).evaluate(e => e.classList.contains('associated')), false);
  await nodeMenu('a', fullscreen); await item('删除节点').click();
  await dialog().waitFor(); await dialog().getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await card('a', fullscreen).count(), 1);
  await nodeMenu('a', fullscreen); await item('关联节点').click();
  await nodeMenu('note', fullscreen); await item('关联节点').click();
  await nodeMenu('note', fullscreen); await item('从此处延伸问答Tile').click();
  await dialog().waitFor();
  assert.equal(await dialog().locator('.context-picker .chips button').count(), 1);
  assert.equal(await dialog().getByRole('button', { name: '移除关联 note', exact: true }).count(), 1);
  await dialog().getByLabel('提问内容').fill('从全屏便签延伸问答');
  await dialog().getByRole('button', { name: '发送并生成 Tile', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.status-text')?.textContent.includes('正在生成回答'));
  assert.deepEqual(completions[2].relatedTileIds, ['note']);
  releaseCompletion();
  await page.waitForFunction(() => document.querySelector('.status-text')?.textContent.includes('回答已完成'));
  assert.equal(await page.locator('.fullscreen-viewer').count(), 1, 'extending keeps fullscreen open');
  await blankMenu(fullscreen); await item('整理画布').click();
  const fullArrange = fullscreen.getByRole('dialog', { name: '整理画布', exact: true });
  await fullArrange.waitFor();
  await fullArrange.getByRole('radio', { name: 'Layered 排列', exact: true }).check();
  await fullArrange.getByRole('button', { name: '开始整理', exact: true }).click();
  await fullArrange.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.fullscreen-viewer').count(), 1, 'arrangement keeps fullscreen open');
  const arrangement = await page.evaluate(() => JSON.parse(localStorage.getItem('aureli-canvas-arrangements')));
  assert.equal(Object.values(arrangement)[0].mode, 'layered');
  await blankMenu(fullscreen); await item('添加问答 Tile').click();
  await dialog().waitFor(); await dialog().getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.locator('.fullscreen-viewer').count(), 1);
  await page.keyboard.press('Escape');
  await page.locator('.fullscreen-viewer').waitFor({ state: 'detached' });
  await nodeMenu('a');
  await page.locator('.map-list').getByRole('button', { name: '空白图谱', exact: true }).click();
  await menu().waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: '从一个问题，开始连接知识' }).waitFor();
  await blankMenu();
  assert.equal(await item('回到中心').getAttribute('aria-disabled'), 'true');
  assert.equal(await item('整理画布').getAttribute('aria-disabled'), 'true', 'nothing to arrange in an empty graph');
  await item('添加问答 Tile').click();
  await dialog().waitFor(); await dialog().getByRole('button', { name: '取消', exact: true }).click();
  await selectView(page, 'Tile 列表');
  assert.equal(await page.locator('.graph-wrap').count(), 0);
  assert.equal(await menu().count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: node/blank context menus, correct target, multi-select/deselect, keyboard/focus/Escape/outside dismissal, guarded states, confirmed delete/cancel/failure/retry, question context and busy state, screen-edge bounds, fullscreen layering, map switching, empty graph and graph-only scope');
} finally { releaseCompletion?.(); await browser.close(); }
