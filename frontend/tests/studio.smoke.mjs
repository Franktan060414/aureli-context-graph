import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => { if (!localStorage.getItem('aureli-mode')) localStorage.setItem('aureli-mode', 'demo'); });
try {
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await page.locator('.graph-node').first().waitFor();
  assert.equal(await page.locator('.studio-preview, .knowledge-object').count(), 0);
  assert.equal(await page.getByRole('slider').count(), 0);
  assert.equal(await page.getByText('让知识', { exact: true }).count(), 0);
  const graph = await page.locator('.graph-panel').boundingBox();
  assert.ok(graph.y < 500 && graph.y + 300 < 1000, 'functional graph is visible in the initial desktop viewport');
  const workbench = await page.locator('.graph-workbench').boundingBox();
  assert.deepEqual(
    [graph.x, graph.y, graph.width, graph.height],
    [workbench.x, workbench.y, workbench.width, workbench.height],
    'graph fills the complete workbench area beside the dock',
  );
  assert.equal(await page.locator('.inspector').evaluate(element => getComputedStyle(element).position), 'absolute');
  const dragHandle = page.getByRole('button', { name: '拖动节点配置面板', exact: true });
  const inspectorBeforeDrag = await page.locator('.inspector').boundingBox();
  const handleBox = await dragHandle.boundingBox();
  const handleCenter = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
  await page.mouse.move(handleCenter.x, handleCenter.y);
  await page.mouse.down();
  await page.mouse.move(handleCenter.x - 104, handleCenter.y + 34, { steps: 4 });
  await page.mouse.up();
  const inspectorAfterDrag = await page.locator('.inspector').boundingBox();
  assert.ok(inspectorAfterDrag.x < inspectorBeforeDrag.x - 90, 'node configurator follows horizontal pointer drag');
  assert.ok(inspectorAfterDrag.y > inspectorBeforeDrag.y + 20, 'node configurator follows vertical pointer drag');
  await dragHandle.focus();
  await page.keyboard.press('Alt+ArrowLeft');
  const inspectorAfterKeyboard = await page.locator('.inspector').boundingBox();
  assert.ok(inspectorAfterKeyboard.x <= inspectorAfterDrag.x - 15, 'Alt + Arrow moves the node configurator');
  const preservedInspectorOffset = await page.locator('.inspector').evaluate(element => element.style.translate);
  await page.getByRole('button', { name: '最小化节点配置', exact: true }).click();
  await page.waitForFunction(() => document.getAnimations().some(animation => animation.playState === 'running' && animation.effect.target?.classList.contains('inspector')));
  await page.waitForFunction(() => document.querySelectorAll('.inspector').length === 1);
  assert.equal(await page.locator('.inspector').getAttribute('class'), 'inspector surface minimized');
  assert.equal(await page.locator('.inspector').evaluate(element => element.style.translate), preservedInspectorOffset);
  assert.equal(await dragHandle.count(), 0, 'collapsed node configurator hides the drag handle');
  const minimizedBeforeDrag = await page.locator('.inspector').boundingBox();
  await page.mouse.move(minimizedBeforeDrag.x + minimizedBeforeDrag.width / 2, minimizedBeforeDrag.y + minimizedBeforeDrag.height / 2);
  await page.mouse.down();
  await page.mouse.move(minimizedBeforeDrag.x + minimizedBeforeDrag.width / 2 - 32, minimizedBeforeDrag.y + minimizedBeforeDrag.height / 2 + 18, { steps: 4 });
  await page.mouse.up();
  const minimizedAfterDrag = await page.locator('.inspector').boundingBox();
  assert.ok(minimizedAfterDrag.x < minimizedBeforeDrag.x - 20, 'the collapsed configurator surface is draggable');
  assert.ok(minimizedAfterDrag.y > minimizedBeforeDrag.y + 10, 'collapsed configurator follows vertical pointer movement');
  assert.equal(await page.locator('.inspector').getAttribute('class'), 'inspector surface minimized');
  const minimizedDraggedOffset = await page.locator('.inspector').evaluate(element => element.style.translate);
  const minimizedInspectorBox = await page.locator('.inspector').boundingBox();
  const expandInspectorBox = await page.getByRole('button', { name: '展开节点配置', exact: true }).boundingBox();
  assert.ok(
    expandInspectorBox.x + expandInspectorBox.width <= minimizedInspectorBox.x + minimizedInspectorBox.width - 10,
    'collapsed node configurator keeps the expand button fully inside its right edge',
  );
  assert.equal(await page.locator('.inspector-body').count(), 0);
  await page.getByRole('button', { name: '展开节点配置', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.inspector').length === 1);
  assert.equal(await page.locator('.inspector').evaluate(element => element.style.translate), minimizedDraggedOffset);
  assert.equal(await dragHandle.count(), 1, 'expanded node configurator restores the drag handle');
  await dragHandle.dblclick();
  const inspectorAfterReset = await page.locator('.inspector').boundingBox();
  assert.ok(Math.abs(inspectorAfterReset.x - inspectorBeforeDrag.x) < 2, 'double click resets configurator x position');
  assert.ok(Math.abs(inspectorAfterReset.y - inspectorBeforeDrag.y) < 2, 'double click resets configurator y position');
  await page.getByRole('button', { name: '添加Tile', exact: true }).click();
  await page.getByLabel('提问内容').fill('平面图谱交互验收');
  await page.getByRole('button', { name: '生成示例 Tile', exact: true }).click();
  assert.equal(await page.locator('.graph-node').count(), 7);
  await page.getByRole('button', { name: '全页面查看图谱', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('.fullscreen-viewer').waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('button', { name: '全页面查看图谱', exact: true }).evaluate(e => e === document.activeElement), true);
  await page.getByRole('button', { name: '全页面查看 tile-003', exact: true }).click();
  await page.locator('.fullscreen-header .secondary').click();
  await page.locator('.fullscreen-viewer').waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('button', { name: '全页面查看 tile-003', exact: true }).evaluate(e => e === document.activeElement), true);
  // Keyboard switching must not leave spatial animations running.
  await page.getByRole('button', { name: '添加Tile', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.compose-form').isVisible(), true);
  assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length), 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '节点详情', exact: true }).click();
  await page.getByRole('button', { name: '添加Tile', exact: true }).click();
  assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length), 0);
  assert.equal(await page.getByRole('button', { name: '切换立体图谱', exact: true }).count(), 0);
  assert.ok(!(await page.locator('.graph-world').getAttribute('style')).includes('rotate'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '节点详情', exact: true }).click();
    await page.getByRole('button', { name: '添加Tile', exact: true }).click();
  }
  await page.getByRole('button', { name: '节点详情', exact: true }).click();
  await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running'));
  assert.ok(await page.locator('.answer-text').innerText());
  await page.getByRole('button', { name: '复制 Tile ID', exact: true }).click();
  await page.locator('.toast').waitFor();
  assert.ok(await page.locator('.toast').evaluate(e => { const box = e.getBoundingClientRect(); return Math.abs(box.x + box.width / 2 - innerWidth / 2) < 2; }));
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await page.locator('.toast').waitFor({ state: 'detached' });
  await page.evaluate(() => scrollTo(0,0));
  await page.screenshot({ path: 'artifacts/workbench-desktop.png' });
  for (const width of [375, 768, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
    if (width === 375) {
      await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 0);
      const mobileGraph = await page.locator('.graph-panel').boundingBox();
      const mobileInspector = await page.locator('.inspector').boundingBox();
      assert.deepEqual([mobileGraph.x, mobileGraph.y, mobileGraph.width, mobileGraph.height], [0, 0, width, 1000]);
      assert.ok(mobileInspector.x >= 0 && mobileInspector.x + mobileInspector.width <= width);
      await page.screenshot({ path: 'artifacts/workbench-mobile.png', fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: preview removed, graph visible, new Tile and panel transitions, flat graph, rapid interruption, fullscreen focus, keyboard/reduced motion, responsive layout');
} finally { await browser.close(); }
