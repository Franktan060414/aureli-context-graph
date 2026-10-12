import assert from 'node:assert/strict';
import { selectView } from './helpers/view-select.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(8000);
const errors = [], writes = [];
page.on('pageerror', e => errors.push(e.message));
const tiles = ['a', 'b'].map((id, i) => ({ id, message: `无限画布 ${id}`, answer: '节点可以自由放置在任意方向。',
  relatedTileIds: i ? ['a'] : [], labelId: 1, weight: 1, tileType: 'QA', kind: 'root', status: 'ready' }));
await page.addInitScript(() => {
  localStorage.setItem('aureli-mode', 'live');
  if (!localStorage.getItem('aureli-tile-layouts')) localStorage.setItem('aureli-tile-layouts', JSON.stringify({
    [`live:${location.origin}:default`]: { a: { x: -320, y: -220 }, b: { x: 80, y: -220 } },
  }));
});
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.route('**/customer-service/**', route => {
  const req = route.request(), path = new URL(req.url()).pathname;
  if (req.method() !== 'GET' && !path.endsWith('/zoom')) writes.push(path);
  const data = path.endsWith('/maps') ? [{ mapId: 'default', name: '无限画布测试', zoom: 1 }]
    : path.endsWith('/tile/workspace') ? { tiles, edges: [{ id: 'ab', sourceTileId: 'a', targetTileId: 'b', direction: 'DIRECTED', relationType: 'EXTENDS' }],
      labels: [{ id: 1, name: '跨越原点', colorHex: '#E8F2FF' }] } : {};
  return route.fulfill({ json: { success: true, data } });
});
let graph = page.locator('.graph-workbench .graph-wrap');
const card = id => graph.locator(`.graph-node[data-tile-id="${id}"]`);
const position = id => card(id).evaluate(e => ({ x: parseFloat(e.style.left), y: parseFloat(e.style.top) }));
const camera = () => graph.locator('.graph-space').getAttribute('style');
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function fit() { await graph.getByRole('button', { name: '适应画布', exact: true }).click(); await settle(); }
async function framed() {
  const view = await graph.locator('.graph-viewport').boundingBox();
  for (const rect of await graph.locator('.graph-node').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; }))) {
    assert.ok(rect.x >= view.x && rect.y >= view.y && rect.right <= view.x + view.width && rect.bottom <= view.y + view.height - 74, JSON.stringify({ view, rect }));
  }
}
async function dimensions() {
  return graph.locator('.graph-world').evaluate(world => ({ width: world.offsetWidth, height: world.offsetHeight }));
}
async function returnToCenter() {
  const layoutBefore = await page.evaluate(() => localStorage.getItem('aureli-tile-layouts'));
  const selectedBefore = await graph.locator('.graph-node.selected').getAttribute('data-tile-id');
  const zoomBefore = await graph.locator('.graph-world').evaluate(e => e.style.transform);
  await graph.locator('.graph-viewport').evaluate(viewport => viewport.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true, cancelable: true, deltaX: 1000000, deltaY: 1000000,
  })));
  await settle();
  await graph.locator('.graph-viewport').click({ button: 'right', position: { x: 100, y: 100 } });
  const menu = page.getByRole('menu', { name: '画布快捷操作' });
  await menu.getByRole('menuitem', { name: '回到中心', exact: true }).click();
  await menu.waitFor({ state: 'hidden' }); await settle();
  const centered = await graph.locator('.graph-viewport').evaluate(viewport => {
    const view = viewport.getBoundingClientRect();
    const boxes = [...viewport.querySelectorAll('.graph-node, .graph-label-region')].map(e => e.getBoundingClientRect());
    return {
      x: (Math.min(...boxes.map(b => b.left)) + Math.max(...boxes.map(b => b.right))) / 2 - (view.left + viewport.clientWidth / 2),
      y: (Math.min(...boxes.map(b => b.top)) + Math.max(...boxes.map(b => b.bottom))) / 2 - (view.top + (viewport.clientHeight - 80) / 2),
    };
  });
  assert.ok(Math.abs(centered.x) < 1 && Math.abs(centered.y) < 1, JSON.stringify(centered));
  assert.equal(await graph.locator('.graph-world').evaluate(e => e.style.transform), zoomBefore, 'returning to center preserves zoom');
  assert.equal(await page.evaluate(() => localStorage.getItem('aureli-tile-layouts')), layoutBefore);
  assert.equal(await graph.locator('.graph-node.selected').getAttribute('data-tile-id'), selectedBefore);
}
async function start(id) {
  const box = await card(id).locator('.node-main').boundingBox();
  const point = { x: box.x + 70, y: box.y + 70 };
  await page.mouse.move(point.x, point.y); await page.mouse.down(); return point;
}
try {
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173'); await card('b').waitFor();
  await page.getByRole('button', { name: '最小化节点配置', exact: true }).click();
  await fit(); await framed();
  assert.deepEqual(await position('a'), { x: -320, y: -220 });
  assert.equal(await graph.locator('.graph-world').evaluate(e => getComputedStyle(e, '::before').content), 'none');
  assert.equal(await graph.locator('.edges').evaluate(e => getComputedStyle(e).overflow), 'visible');
  const region = await graph.locator('.graph-label-region').evaluate(e => ({ x: parseFloat(e.style.left), y: parseFloat(e.style.top), width: parseFloat(e.style.width), height: parseFloat(e.style.height) }));
  assert.ok(region.x < -320 && region.y < -220 && region.width > 660 && region.height > 200);
  await graph.screenshot({ path: new URL('../artifacts/canvas-infinite-negative.png', import.meta.url).pathname });
  const beforeSize = await dimensions(), initialCamera = await camera();
  const layout = await page.evaluate(() => localStorage.getItem('aureli-tile-layouts'));
  // Large gestures in both directions never hit a scroll limit or enlarge a DOM surface.
  for (const [x, y] of [[100000, 120000], [-200000, -240000], [100000, 120000]]) {
    await graph.locator('.graph-viewport').evaluate((viewport, { x, y }) => viewport.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaX: x, deltaY: y, clientX: 500, clientY: 400,
    })), { x, y }); await settle();
    assert.deepEqual(await dimensions(), beforeSize);
    assert.deepEqual(await graph.locator('.graph-viewport').evaluate(e => ({ x: e.scrollLeft, y: e.scrollTop })), { x: 0, y: 0 });
  }
  assert.equal(await camera(), initialCamera);
  assert.equal(await page.evaluate(() => localStorage.getItem('aureli-tile-layouts')), layout);
  await returnToCenter(); await framed(); await fit();
  // Drag across the x/y origin, then continue with keyboard adjustments.
  let point = await start('b');
  await page.mouse.move(point.x - 200, point.y + 300, { steps: 10 }); await page.mouse.up();
  let moved = await position('b');
  assert.ok(Math.abs(moved.x + 120) < 1 && Math.abs(moved.y - 80) < 1, JSON.stringify(moved));
  await card('b').locator('.node-main').press('Alt+Shift+ArrowLeft');
  await card('b').locator('.node-main').press('Alt+Shift+ArrowDown');
  moved = await position('b'); assert.ok(Math.abs(moved.x + 160) < 1 && Math.abs(moved.y - 120) < 1);
  await page.reload(); await card('b').waitFor(); assert.deepEqual(await position('b'), moved);
  await page.getByRole('button', { name: '最小化节点配置', exact: true }).click(); await fit(); await framed();
  // Edge dragging can continue left/up, and Escape restores both Tile and camera.
  const view = await graph.locator('.graph-viewport').boundingBox(), savedCamera = await camera();
  point = await start('b'); await page.mouse.move(view.x + 4, view.y + 4, { steps: 10 });
  await page.waitForFunction(initial => document.querySelector('.graph-space').getAttribute('style') !== initial, savedCamera);
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.deepEqual(await position('b'), moved); assert.equal(await camera(), savedCamera);
  // Continue right/down without a finite surface or scrollbars.
  point = await start('b'); await page.mouse.move(view.x + view.width - 4, view.y + view.height - 80, { steps: 10 });
  await page.waitForFunction(before => {
    const node = document.querySelector('.graph-node[data-tile-id="b"]');
    return parseFloat(node.style.left) > before.x + 300 && parseFloat(node.style.top) > before.y + 300;
  }, moved);
  await page.mouse.up(); assert.deepEqual(await dimensions(), beforeSize);
  await fit();
  await framed();
  // Native fullscreen and switching views preserve unrestricted stored coordinates.
  const normal = await position('b'); await selectView(page, 'Tile 列表'); await selectView(page, '图谱视图');
  assert.deepEqual(await position('b'), normal);
  await page.getByRole('button', { name: '全页面查看图谱', exact: true }).click();
  graph = page.locator('.fullscreen-viewer .graph-wrap'); await card('b').waitFor(); await fit(); await framed();
  assert.deepEqual(await position('a'), { x: -320, y: -220 });
  const fullSize = await dimensions();
  await graph.locator('.graph-viewport').evaluate(viewport => viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -1000000, deltaY: -1000000 })));
  await settle(); assert.deepEqual(await dimensions(), fullSize);
  await graph.locator('.graph-viewport').focus(); await page.keyboard.press('Tab'); await settle();
  const focused = await card('a').boundingBox(), viewport = await graph.locator('.graph-viewport').boundingBox();
  assert.ok(focused.x >= viewport.x && focused.y >= viewport.y && focused.x + focused.width <= viewport.x + viewport.width, 'keyboard focus reveals an offscreen Tile');
  await fit(); await framed();
  await returnToCenter(); await framed();
  assert.equal(await page.locator('.fullscreen-viewer').count(), 1, 'centering keeps fullscreen open');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  console.log('PASS: infinite camera travel, return to center in normal/fullscreen views with zoom/layout/selection preserved, origin-crossing drag/keyboard, persistence, labels, connections, edge auto-pan/cancel, fit and view switching');
} finally { await browser.close(); }
