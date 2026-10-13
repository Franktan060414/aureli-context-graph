import assert from 'node:assert/strict';
import { sampleGraph } from './fixtures/sample-workspace.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(8000);
const errors = [], writes = [], savedZooms = [];
const maps = [{ mapId: 'default', name: '测试图谱', zoom: 1 }, { mapId: 'empty', name: '空图谱', zoom: 1 }];
await page.addInitScript(() => localStorage.setItem('aureli-mode', 'live'));
page.on('pageerror', error => errors.push(error.message));
await page.route('**/customer-service/**', route => {
  const request = route.request(), url = new URL(request.url());
  if (url.pathname.endsWith('/maps')) return route.fulfill({ json: { success: true, data: maps } });
  if (url.pathname.endsWith('/tile/workspace')) return route.fulfill({ json: { success: true, data: url.searchParams.get('mapId') === 'empty' ? { tiles: [], edges: [] } : sampleGraph() } });
  if (url.pathname.endsWith('/zoom')) {
    const { zoom } = request.postDataJSON(); maps[0].zoom = zoom; savedZooms.push(zoom);
  } else if (request.method() !== 'GET') writes.push(url.pathname);
  return route.fulfill({ json: { success: true, data: {} } });
});
let graph = page.locator('.graph-workbench .graph-wrap');
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const scale = () => graph.locator('.graph-world').evaluate(world => Number(world.style.transform.match(/[\d.]+/)[0]));
async function pointInCanvas() {
  const bounds = await graph.locator('.graph-viewport').boundingBox();
  return { x: bounds.x + Math.min(320, bounds.width / 2), y: bounds.y + Math.min(220, bounds.height / 2) };
}
async function anchorAt(point) {
  return graph.locator('.graph-world').evaluate((world, point) => {
    const bounds = world.getBoundingClientRect(), scale = bounds.width / world.offsetWidth;
    return { x: (point.x - bounds.left) / scale, y: (point.y - bounds.top) / scale };
  }, point);
}
async function unchangedData() {
  return graph.evaluate(canvas => ({
    selected: canvas.querySelector('.graph-node.selected')?.dataset.tileId,
    positions: [...canvas.querySelectorAll('.graph-node')].map(node => node.getAttribute('style')),
    edges: [...canvas.querySelectorAll('.edges g > path')].map(edge => edge.getAttribute('d')),
    layout: localStorage.getItem('aureli-tile-layouts'),
  }));
}
async function wheel(point, delta, mode, pinch = false) {
  const before = await scale(), anchor = await anchorAt(point), data = await unchangedData();
  const unit = mode === 1 ? 16 : mode === 2 ? await graph.locator('.graph-viewport').evaluate(e => e.clientHeight) : 1;
  const expected = Number(Math.min(1.5, Math.max(0.35, before * Math.exp(-Math.max(-120, Math.min(120, delta * unit)) * (pinch ? 0.01 : 0.0015)))).toFixed(6));
  if (mode === undefined) {
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, delta);
  } else {
    const prevented = await graph.locator('.graph-viewport').evaluate((viewport, { point, delta, mode }) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, deltaY: delta, deltaMode: mode, wheelDeltaY: -Math.sign(delta) * 120 });
      viewport.dispatchEvent(event); return event.defaultPrevented;
    }, { point, delta, mode });
    assert.equal(prevented, true);
  }
  await page.waitForFunction(({ fullscreen, expected }) => {
    const world = document.querySelector(`${fullscreen ? '.fullscreen-viewer' : '.graph-workbench'} .graph-world`);
    return world && Math.abs(Number(world.style.transform.match(/[\d.]+/)[0]) - expected) < 0.00001;
  }, { fullscreen: await page.locator('.fullscreen-viewer').count() > 0, expected });
  await settle();
  const after = await anchorAt(point);
  assert.ok(Math.abs(after.x - anchor.x) < 0.1 && Math.abs(after.y - anchor.y) < 0.1, `cursor anchor stays still: ${JSON.stringify({ anchor, after, expected })}`);
  assert.deepEqual(await unchangedData(), data, 'zoom changes no Tile position, selection or connection');
  assert.equal(await graph.locator('.canvas-controls .mono').textContent(), `${Math.round(expected * 100)}%`);
  return expected;
}
try {
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await graph.locator('.graph-node').last().waitFor();
  await page.getByRole('button', { name: '最小化节点配置', exact: true }).click();
  let point = await pointInCanvas();
  const scrollY = await page.evaluate(() => window.scrollY);
  await wheel(point, -100); await wheel(point, 100);
  assert.equal(await page.evaluate(() => window.scrollY), scrollY, 'canvas wheel never scrolls the page');
  // Normal motion is enabled: a wheel gesture must bypass the button zoom transition.
  assert.equal(await graph.locator('.graph-world').evaluate(e => getComputedStyle(e).transitionDuration), '0s');
  for (const mode of [0, 1, 2]) { await wheel(point, -1, mode); await wheel(point, 1, mode); }
  await page.keyboard.down('Control'); await wheel(point, -40, undefined, true); await page.keyboard.up('Control');
  assert.equal(await page.evaluate(() => window.visualViewport.scale), 1, 'Ctrl+wheel zooms the graph instead of the page');
  // Zoom still anchors correctly after panning; native scrolling stays disabled.
  await graph.locator('.graph-viewport').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
  await graph.locator('.graph-viewport').evaluate(e => { e.scrollLeft = e.scrollWidth; e.scrollTop = e.scrollHeight; });
  assert.deepEqual(await graph.locator('.graph-viewport').evaluate(e => [e.scrollLeft, e.scrollTop]), [0, 0]);
  await wheel(point, 120); await wheel(point, -120);
  // Wheel over a Tile uses the same zoom gesture without selecting or dragging it.
  await graph.getByRole('button', { name: '适应画布', exact: true }).click();
  await page.waitForFunction(() => !document.getAnimations().some(a => a.effect.target.classList.contains('graph-world') && a.playState === 'running'));
  const node = graph.locator('.graph-node').first(), bounds = await node.locator('.node-main').boundingBox();
  point = { x: bounds.x + 30, y: bounds.y + 40 };
  await wheel(point, -60);
  // Ignore wheel while holding a drag so its world coordinates cannot jump.
  const box = await node.locator('.node-main').boundingBox();
  await page.mouse.move(box.x + 50, box.y + 70); await page.mouse.down();
  await page.mouse.move(box.x + 65, box.y + 80, { steps: 4 });
  await graph.locator('.dragging').waitFor();
  const dragScale = await scale(); await page.mouse.wheel(0, -100); await settle();
  assert.equal(await scale(), dragScale); await page.keyboard.press('Escape'); await page.mouse.up();
  point = await pointInCanvas();
  while (await scale() < 1.5) await wheel(point, -120);
  await wheel(point, -120);
  while (await scale() > 0.35) await wheel(point, 120);
  await wheel(point, 120);
  // Fullscreen uses the same range and shares its scale with the main canvas.
  await page.getByRole('button', { name: '全页面查看图谱', exact: true }).click();
  graph = page.locator('.fullscreen-viewer .graph-wrap');
  await page.waitForFunction(() => !document.getAnimations().some(a => a.effect.target.classList.contains('fullscreen-viewer') && a.playState === 'running'));
  point = await pointInCanvas(); await wheel(point, -100);
  const fullScale = await scale(); await page.keyboard.press('Escape');
  await page.locator('.fullscreen-viewer').waitFor({ state: 'detached' });
  graph = page.locator('.graph-workbench .graph-wrap');
  assert.equal(await scale(), fullScale);
  await page.waitForFunction(zoom => window.visualViewport.scale === 1 && document.querySelector('.graph-world')?.style.transform === `scale(${zoom})`, fullScale);
  assert.ok(savedZooms.some(zoom => Math.abs(zoom - fullScale) < 0.00001));
  await page.reload(); await graph.locator('.graph-node').last().waitFor(); assert.equal(await scale(), fullScale);
  // A wheel outside the canvas must leave graph zoom alone.
  const outside = await page.locator('.sidebar').boundingBox();
  await page.mouse.move(outside.x + 30, outside.y + 100); await page.mouse.wheel(0, -100); await settle();
  assert.equal(await scale(), fullScale);
  await page.locator('.map-list').getByRole('button', { name: '空图谱', exact: true }).click();
  await graph.locator('.empty-graph').waitFor();
  const emptyPoint = await pointInCanvas();
  const prevented = await graph.locator('.graph-viewport').evaluate((e, point) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, deltaY: -100 });
    e.dispatchEvent(event); return event.defaultPrevented;
  }, emptyPoint);
  assert.equal(prevented, false, 'an empty canvas does not trap scrolling');
  assert.equal(await graph.locator('.canvas-controls .mono').textContent(), '100%');
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  console.log('PASS: mouse/canvas/Tile wheel zoom, infinite camera anchor, pixel/line/page deltas, Ctrl+wheel, normal motion, drag guard, zoom limits, fullscreen sync, saved scale, outside and empty canvas');
} finally { await browser.close(); }
