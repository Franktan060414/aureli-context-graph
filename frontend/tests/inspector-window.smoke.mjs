import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('aureli-mode', 'demo'));
await page.emulateMedia({ reducedMotion: 'reduce' });
const inspector = page.locator('.inspector');
const header = page.locator('.inspector-header');
const box = () => inspector.boundingBox();
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 2, `${message}: ${actual} vs ${expected}`);
const same = (actual, expected, message) => ['x', 'y', 'width', 'height'].forEach(key => close(actual[key], expected[key], `${message} ${key}`));
async function drag(locator, dx, dy, cancel = false) {
  const bounds = await locator.boundingBox();
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + dx, point.y + dy, { steps: 5 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
  await settle();
}
async function reset() {
  const bounds = await header.boundingBox();
  await page.mouse.dblclick(bounds.x + bounds.width - 65, bounds.y + bounds.height / 2);
  await settle();
}
async function inBounds(message) {
  const rect = await box(), area = await page.locator('.workspace-grid').boundingBox();
  assert.ok(rect.x >= area.x + 11 && rect.y >= area.y + 11, `${message}: top/left`);
  assert.ok(rect.x + rect.width <= area.x + area.width - 11, `${message}: right`);
  assert.ok(rect.y + rect.height <= area.y + area.height - 11, `${message}: bottom`);
}
try {
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await page.locator('.graph-node').first().waitFor();
  assert.equal(await page.locator('.inspector-drag-handle').count(), 0);
  assert.equal(await page.locator('.inspector-resize-edge').count(), 8);
  const initial = await box();
  const graphTransform = await page.locator('.graph-world').getAttribute('style');
  await drag(header, -200, -60);
  const moved = await box();
  close(moved.x, initial.x - 200, 'header horizontal movement');
  close(moved.y, initial.y - 60, 'header vertical movement');
  const add = page.getByRole('button', { name: '添加Tile', exact: true });
  await drag(add, -30, 20);
  assert.equal(await page.locator('.inspector-tabs button.active').innerText(), '节点详情', 'dragging a header button does not click it');
  await add.click();
  await page.getByLabel('提问内容', { exact: false }).fill('保留草稿内容');
  const beforeTab = await box();
  await page.getByRole('button', { name: '节点详情', exact: true }).click();
  same(await box(), beforeTab, 'ordinary tab click does not move panel');
  await header.focus();
  await page.keyboard.press('Alt+ArrowLeft');
  close((await box()).x, beforeTab.x - 16, 'keyboard movement');
  await drag(header, 40, 20, true);
  close((await box()).x, beforeTab.x - 16, 'Escape cancels moving');

  await drag(page.locator('[data-edge="s"]'), 0, -200);
  for (const [edge, dx, dy, cursor] of [
    ['n', 0, -20, 'ns-resize'], ['e', 20, 0, 'ew-resize'],
    ['s', 0, 20, 'ns-resize'], ['w', -20, 0, 'ew-resize'],
    ['nw', -20, -20, 'nwse-resize'], ['ne', 20, -20, 'nesw-resize'],
    ['sw', -20, 20, 'nesw-resize'], ['se', 20, 20, 'nwse-resize'],
  ]) {
    const target = page.locator(`[data-edge="${edge}"]`), before = await box();
    assert.equal(await target.evaluate(element => getComputedStyle(element).cursor), cursor);
    await drag(target, dx, dy);
    const after = await box();
    close(after.width, before.width + Math.abs(dx), `${edge} width`);
    close(after.height, before.height + Math.abs(dy), `${edge} height`);
    close(after.x, before.x + (edge.includes('w') ? dx : 0), `${edge} stationary opposite horizontal edge`);
    close(after.y, before.y + (edge.includes('n') ? dy : 0), `${edge} stationary opposite vertical edge`);
    await inBounds(edge);
  }
  const custom = await box();
  await drag(page.locator('[data-edge="nw"]'), -30, -30, true);
  same(await box(), custom, 'Escape cancels resizing');
  await page.locator('[data-edge="e"]').focus();
  await page.keyboard.press('ArrowRight');
  close((await box()).width, custom.width + 16, 'keyboard resizing');

  const sized = await box();
  await page.getByRole('button', { name: '最小化节点配置', exact: true }).click();
  assert.equal(await page.locator('.inspector-resize-edge').count(), 0);
  const collapsed = await box();
  await drag(header, -25, 15);
  close((await box()).x, collapsed.x - 25, 'collapsed panel can move');
  await page.getByRole('button', { name: '展开节点配置', exact: true }).click();
  const restored = await box();
  close(restored.width, sized.width, 'custom width survives minimize');
  close(restored.height, sized.height, 'custom height survives minimize');
  close(restored.x, sized.x - 25, 'expanded panel preserves movement');
  close(restored.y, sized.y + 15, 'expanded panel preserves vertical movement');
  await add.click();
  assert.equal(await page.getByLabel('提问内容', { exact: false }).inputValue(), '保留草稿内容');
  same(await box(), restored, 'custom dimensions survive tab switching');
  await page.getByRole('button', { name: '节点详情', exact: true }).click();
  await drag(page.locator('[data-edge="se"]'), -1000, -1000);
  close((await box()).width, 320, 'minimum width');
  close((await box()).height, 220, 'minimum height');
  assert.ok(await page.locator('.inspector-body').evaluate(element => element.scrollHeight > element.clientHeight), 'small panel body remains scrollable');
  await drag(page.locator('[data-edge="se"]'), 2000, 2000);
  await inBounds('maximum size');
  await drag(header, -2000, -2000);
  await inBounds('move to boundary');
  assert.equal(await page.locator('.graph-world').getAttribute('style'), graphTransform, 'panel interactions do not pan or zoom the graph');
  await reset();
  same(await box(), initial, 'double click resets position and dimensions');
  await drag(page.locator('[data-edge="w"]'), -200, 0);
  await page.setViewportSize({ width: 1024, height: 600 });
  await settle();
  await inBounds('smaller desktop viewport');
  await page.setViewportSize({ width: 375, height: 900 });
  await settle();
  await inBounds('phone viewport');
  await drag(page.locator('[data-edge="n"]'), 0, -40);
  await inBounds('phone resize');
  await page.setViewportSize({ width: 900, height: 375 });
  await settle();
  await inBounds('landscape viewport');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await settle();
  await reset();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await drag(header, -200, -60);
  await drag(page.locator('[data-edge="se"]'), 1000, 1000);
  const animatedSize = await box();
  await page.getByRole('button', { name: '最小化节点配置', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.inspector').length === 1 && !document.querySelector('.inspector-motion-enter-active, .inspector-motion-leave-active') && !document.getAnimations().some(animation => animation.playState === 'running'));
  await page.getByRole('button', { name: '展开节点配置', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.inspector').length === 1 && !document.querySelector('.inspector-motion-enter-active, .inspector-motion-leave-active') && !document.getAnimations().some(animation => animation.playState === 'running'));
  same(await box(), animatedSize, 'animated minimize/expand retains custom geometry at the boundary');
  await reset();
  await drag(header, -120, -20);
  await drag(page.locator('[data-edge="w"]'), -160, 0);
  await page.screenshot({ path: 'artifacts/inspector-window-desktop.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: full header dragging, button clicks, eight resize directions, anchored edges, keyboard, Escape, minimum/maximum sizes, minimized size restore, scroll, graph isolation and responsive bounds');
} finally { await browser.close(); }
