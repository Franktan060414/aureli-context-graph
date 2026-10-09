import { selectView } from "./helpers/view-select.js";
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('aureli-mode', 'demo'));
const point = node => node.evaluate(element => ({ x: parseFloat(element.style.left), y: parseFloat(element.style.top) }));
const assertPoint = (actual, expected) => {
  assert.ok(Math.abs(actual.x - expected.x) < 1, `x: ${JSON.stringify({ actual, expected })}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1, `y: ${JSON.stringify({ actual, expected })}`);
};
async function dragStart(node) {
  const box = await node.locator('.node-main').boundingBox();
  const start = { x: box.x + 90, y: box.y + 20 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  return start;
}
try {
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await page.locator('.graph-node').first().waitFor();
  await page.getByRole('button', { name: '全页面查看图谱', exact: true }).click();
  const graph = page.locator('.fullscreen-viewer');
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.effect.target.classList.contains('fullscreen-viewer') && animation.playState === 'running'));
  const node = graph.locator('.graph-node').nth(1);
  const selectedBefore = await graph.locator('.graph-node.selected .mono').textContent();
  let before = await point(node);
  let start = await dragStart(node);
  const edgeBefore = await graph.locator('.edges g > path').first().getAttribute('d');
  await page.mouse.move(start.x + 80, start.y + 120, { steps: 12 });
  await page.waitForFunction(() => document.querySelector('.fullscreen-viewer .graph-node.dragging')?.style.left !== '340px');
  assert.notEqual(await graph.locator('.edges g > path').first().getAttribute('d'), edgeBefore, 'arrows update while holding the Tile');
  await page.mouse.up();
  assertPoint(await point(node), { x: before.x + 80, y: before.y + 120 });
  assert.equal(await graph.locator('.graph-node.selected .mono').textContent(), selectedBefore, 'drag does not select');

  // Small motion remains a normal click.
  before = await point(node);
  start = await dragStart(node);
  await page.mouse.move(start.x + 2, start.y + 1);
  await page.mouse.up();
  assertPoint(await point(node), before);
  assert.equal(await node.locator('.node-main').getAttribute('aria-pressed'), 'true');

  await graph.getByRole('button', { name: '缩小图谱', exact: true }).click();
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.effect.target.classList.contains('graph-world') && animation.playState === 'running'));
  before = await point(node);
  start = await dragStart(node);
  await page.mouse.move(start.x + 45, start.y + 54, { steps: 8 });
  await page.mouse.up();
  assertPoint(await point(node), { x: before.x + 50, y: before.y + 60 });

  before = await point(node);
  start = await dragStart(node);
  await page.mouse.move(start.x + 40, start.y + 40, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assertPoint(await point(node), before);
  assert.equal(await graph.count(), 1, 'Escape cancels drag before closing the full-page view');

  await node.locator('.node-main').focus();
  await page.keyboard.press('Alt+ArrowRight');
  before.x += 10;
  assertPoint(await point(node), before);
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Alt+ArrowDown');
  before.y += 20;
  assertPoint(await point(node), before);
  await node.locator('.node-bottom button').first().click();
  assert.match(await node.locator('.node-bottom button').first().textContent(), /已关联/);
  assertPoint(await point(node), before);

  await graph.locator('.fullscreen-header .secondary').click();
  await graph.waitFor({ state: 'detached' });
  const normalNode = page.locator('.graph-node').nth(1);
  assertPoint(await point(normalNode), before);
  await selectView(page, "Tile 列表");
  await selectView(page, "图谱视图");
  assertPoint(await point(normalNode), before);
  await page.reload();
  await normalNode.waitFor();
  assertPoint(await point(normalNode), before);
  await page.getByRole('button', { name: '全页面查看图谱', exact: true }).click();
  assertPoint(await point(node), before);
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.effect.target.classList.contains('fullscreen-viewer') && animation.playState === 'running'));
  await page.screenshot({ path: new URL('../artifacts/graph-drag.png', import.meta.url).pathname });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const outer = graph.locator('.graph-viewport');
  const farNode = graph.locator('.graph-node').last();
  const widthBefore = await graph.locator('.graph-world').evaluate(element => element.offsetWidth);
  const bounds = await outer.boundingBox();
  start = await dragStart(farNode);
  await page.mouse.move(bounds.x + bounds.width - 10, start.y, { steps: 12 });
  await page.waitForFunction(width => document.querySelector('.fullscreen-viewer .graph-world').offsetWidth > width && document.querySelector('.fullscreen-viewer .graph-viewport').scrollLeft > 0, widthBefore);
  await page.mouse.up();
  assert.equal(await graph.locator('.dragging').count(), 0);

  const touch = await browser.newPage({ viewport: { width: 375, height: 900 }, hasTouch: true, isMobile: true });
  touch.on('pageerror', error => errors.push(error.message));
  await touch.addInitScript(() => localStorage.setItem('aureli-mode', 'demo'));
  await touch.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  // The floating details panel otherwise covers the touch drag's starting point.
  await touch.getByRole('button', { name: '最小化节点配置', exact: true }).click();
  await touch.locator('.inspector-body').waitFor({ state: 'detached' });
  const touchNode = touch.locator('.graph-node.selected');
  await touchNode.waitFor();
  const touchBefore = await point(touchNode);
  const touchBounds = await touchNode.locator('.node-main').boundingBox();
  const touchSession = await touch.context().newCDPSession(touch);
  const touchPoint = { x: touchBounds.x + 90, y: touchBounds.y + 20 };
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint] });
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchPoint.x + 20, y: touchPoint.y + 30 }] });
  await touch.waitForSelector('.graph-node.dragging');
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.notDeepEqual(await point(touchNode), touchBefore, 'touch drag moves the Tile');
  assert.equal(await touch.locator('.dragging').count(), 0);
  assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await touch.close();
  assert.deepEqual(errors, []);
  console.log('PASS: live arrows, click threshold, zoom coordinates, drag cancellation, keyboard/buttons, action buttons, shared views, refresh persistence, canvas expansion, edge scroll, reduced motion and touch');
} finally { await browser.close(); }
