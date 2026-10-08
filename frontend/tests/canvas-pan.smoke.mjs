import assert from 'node:assert/strict';
import { demoGraph } from '../src/lib/demo.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const baseUrl = process.env.UI_TEST_URL || 'http://127.0.0.1:5173';
const errors = [], writes = [];
const workspace = demoGraph();
Object.assign(workspace.tiles[1], { tileType: 'NOTE', kind: 'note', message: '平移测试便签', answer: '便签正文' });
Object.assign(workspace.tiles[4], { tileType: 'FILE', kind: 'file', message: '平移测试文件', answer: 'example.md' });

async function prepare(page) {
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('aureli-mode', 'live'));
  await page.route('**/customer-service/**', route => {
  if (new URL(route.request().url()).pathname.endsWith('/maps')) return route.fulfill({ json: { success: true, data: [{ mapId: 'default', name: '默认图谱' }] } });
    if (route.request().method() !== 'GET') writes.push(route.request().url());
    return route.fulfill({ json: { success: true, data: new URL(route.request().url()).pathname.endsWith('/tile/workspace') ? workspace : {} } });
  });
  await page.goto(baseUrl);
  await page.locator('.graph-node').last().waitFor();
}
async function blankPoint(graph) {
  return graph.locator('.graph-viewport').evaluate(viewport => {
    const bounds = viewport.getBoundingClientRect();
    for (let y = Math.max(0, bounds.top) + 30; y < Math.min(innerHeight, bounds.bottom) - 80; y += 30) {
      for (let x = Math.max(0, bounds.left) + 30; x < Math.min(innerWidth, bounds.right) - 30; x += 30) {
        const target = document.elementFromPoint(x, y);
        if (target?.closest('.graph-viewport') === viewport && !target.closest('.graph-node, button, input, select')) return { x, y };
      }
    }
    throw new Error('No visible blank canvas area');
  });
}
async function snapshot(graph) {
  return graph.evaluate(element => ({
    items: [...element.querySelectorAll('.graph-node, .edges g > path, .edges g > text')].map(item => {
      const bounds = item.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
        left: item.style.left, top: item.style.top, path: item.getAttribute('d') };
    }),
    selected: element.querySelector('.graph-node.selected .mono')?.textContent,
    layout: localStorage.getItem('aureli-tile-layouts'),
    zoom: element.querySelector('.graph-world').style.transform,
  }));
}
function assertMoved(before, after, dx, dy) {
  assert.equal(after.items.length, before.items.length);
  for (let i = 0; i < before.items.length; i++) {
    const old = before.items[i], current = after.items[i];
    assert.ok(Math.abs(current.x - old.x - dx) < 1.5, `item ${i} x: ${current.x - old.x}, expected ${dx}`);
    assert.ok(Math.abs(current.y - old.y - dy) < 1.5, `item ${i} y: ${current.y - old.y}, expected ${dy}`);
    for (const key of ['width', 'height']) assert.ok(Math.abs(current[key] - old[key]) < 0.01, `item ${i} ${key}`);
    for (const key of ['left', 'top', 'path']) assert.equal(current[key], old[key], `item ${i} ${key}`);
  }
  for (const key of ['selected', 'layout', 'zoom']) assert.equal(after[key], before[key], key);
}
async function pan(page, graph, dx, dy) {
  const before = await snapshot(graph), start = await blankPoint(graph);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
  await graph.locator('.graph-viewport.panning').waitFor();
  await page.mouse.up();
  assertMoved(before, await snapshot(graph), dx, dy);
  assert.equal(await graph.locator('.panning, .dragging').count(), 0);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await prepare(page);
  let graph = page.locator('.graph-wrap');
  await page.getByRole('button', { name: '最小化节点配置', exact: true }).click();
  await pan(page, graph, 85, 60);
  await pan(page, graph, -160, -95);
  assert.equal(await graph.locator('.graph-node.note').count(), 1);
  assert.equal(await graph.locator('.graph-node.file').count(), 1);

  // Movement below the threshold and secondary clicks do not pan.
  let before = await snapshot(graph), start = await blankPoint(graph);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 2, start.y + 1);
  await page.mouse.up();
  assertMoved(before, await snapshot(graph), 0, 0);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(start.x + 50, start.y + 30);
  await page.mouse.up({ button: 'right' });
  assertMoved(before, await snapshot(graph), 0, 0);

  // Escape rolls back a pan; the next drag still works.
  start = await blankPoint(graph);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 70, start.y + 55, { steps: 8 });
  await graph.locator('.panning').waitFor();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assertMoved(before, await snapshot(graph), 0, 0);
  await pan(page, graph, 75, 35);

  // Keyboard controls provide alternatives to dragging.
  before = await snapshot(graph);
  await graph.locator('.graph-viewport').focus();
  await page.keyboard.press('ArrowRight');
  assertMoved(before, await snapshot(graph), -40, 0);
  before = await snapshot(graph);
  await page.keyboard.press('ArrowUp');
  assertMoved(before, await snapshot(graph), 0, 40);

  await page.getByRole('button', { name: '全页面查看图谱', exact: true }).click();
  graph = page.locator('.fullscreen-viewer .graph-wrap');
  for (const zoom of [1, 0.9, 0.8]) {
    assert.equal(await graph.locator('.graph-world').evaluate(element => element.style.transform), `scale(${zoom})`);
    await pan(page, graph, 60, 45);
    await pan(page, graph, -80, -60);
    if (zoom > 0.8) await graph.getByRole('button', { name: '缩小图谱', exact: true }).click();
  }

  // Card dragging still uses world coordinates after moving the canvas.
  await pan(page, graph, 90, 80);
  const node = graph.locator('.graph-node').nth(1);
  const positionBefore = await node.evaluate(element => ({ x: parseFloat(element.style.left), y: parseFloat(element.style.top) }));
  const nodeBounds = await node.locator('.node-main').boundingBox();
  start = { x: nodeBounds.x + 90, y: nodeBounds.y + 20 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 32, { steps: 8 });
  await page.mouse.up();
  const positionAfter = await node.evaluate(element => ({ x: parseFloat(element.style.left), y: parseFloat(element.style.top) }));
  assert.ok(Math.abs(positionAfter.x - positionBefore.x - 50) < 1, JSON.stringify({ positionBefore, positionAfter }));
  assert.ok(Math.abs(positionAfter.y - positionBefore.y - 40) < 1, JSON.stringify({ positionBefore, positionAfter }));

  // Scroll position does not change the distance of a subsequent pan.
  await graph.locator('.graph-viewport').evaluate(element => { element.scrollLeft = 65; element.scrollTop = 50; });
  await pan(page, graph, 40, 25);

  // Releasing outside the canvas and cancellation both clean up capture.
  before = await snapshot(graph);
  start = await blankPoint(graph);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(15, 15, { steps: 10 });
  await page.mouse.up();
  assertMoved(before, await snapshot(graph), 15 - start.x, 15 - start.y);
  assert.equal(await graph.locator('.panning').count(), 0);
  before = await snapshot(graph);
  start = await blankPoint(graph);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 55, start.y + 25, { steps: 8 });
  await graph.locator('.panning').waitFor();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assertMoved(before, await snapshot(graph), 0, 0);
  assert.equal(await page.locator('.fullscreen-viewer').count(), 1);
  await graph.getByRole('button', { name: '适应画布', exact: true }).click();
  assert.equal(await graph.locator('.graph-space').evaluate(element => element.style.transform), 'translate(0px, 0px)');
  const viewport = await graph.locator('.graph-viewport').boundingBox();
  for (const item of (await snapshot(graph)).items.slice(0, workspace.tiles.length)) {
    assert.ok(item.x >= viewport.x - 1 && item.x + item.width <= viewport.x + viewport.width + 1);
    assert.ok(item.y >= viewport.y - 1 && item.y + item.height <= viewport.y + viewport.height + 1);
  }
  await page.close();

  const touch = await browser.newPage({ viewport: { width: 375, height: 900 }, hasTouch: true, isMobile: true });
  await prepare(touch);
  await touch.getByRole('button', { name: '最小化节点配置', exact: true }).click();
  await touch.locator('.inspector-body').waitFor({ state: 'detached' });
  graph = touch.locator('.graph-wrap');
  before = await snapshot(graph);
  start = await blankPoint(graph);
  const session = await touch.context().newCDPSession(touch);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 30, y: start.y + 40 }] });
  await graph.locator('.panning').waitFor();
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assertMoved(before, await snapshot(graph), 30, 40);
  assert.equal(await graph.locator('.panning').count(), 0);

  before = await snapshot(graph);
  start = await blankPoint(graph);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 30, y: start.y + 40 }] });
  await graph.locator('.panning').waitFor();
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await graph.locator('.panning').waitFor({ state: 'detached' });
  assertMoved(before, await snapshot(graph), 0, 0);
  assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await touch.close();

  assert.deepEqual(errors, []);
  assert.deepEqual(writes, [], 'panning does not write node or relationship data');
  console.log('PASS: blank-area pan moves Tiles, notes, files, arrows and labels together; zoom, scroll, threshold, controls, cancellation, capture, card drag, fit and touch');
} finally {
  await browser.close();
}
