import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { selectView } from './helpers/view-select.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const url = process.env.UI_TEST_URL || 'http://127.0.0.1:5173';
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const qa = (id, message, answer, relatedTileIds = []) => ({ id, message, answer, relatedTileIds, tileType: 'QA', status: 'ready' });
const tiles = [
  qa('root', '如何比较三种调度算法？', '从实现成本、搜索方式和解的质量三个角度比较。'),
  qa('greedy', '贪心算法适合哪些情况？', '当需要快速得到一个可行方案时，可以先用贪心算法建立基线。\n\n它的实现简单、计算成本低，但局部选择未必带来全局最优结果。', ['root']),
  qa('genetic', '如何设计遗传算法？', '遗传算法维护一个候选解种群，通过选择、交叉和变异持续探索。\n\n先确定排列编码与适应度函数，再设计能够保持可行性的交叉算子。\n\n变异用于增加搜索多样性，需要与种群规模、迭代次数一起调节。', ['root']),
  qa('annealing', '模拟退火应该如何建模与验证？', '模拟退火从一个当前解开始，通过邻域扰动探索新方案。它在早期允许接受较差的结果，帮助搜索跳出局部最优，随后逐步降低这种接受概率。\n\n### 建立问题映射\n\n把调度方案编码为工件排列，定义统一的目标函数，每次生成候选排列后按实际约束计算完成时间。\n\n| 算法概念 | 调度中的对应含义 |\n| --- | --- |\n| 状态 | 工件排列与可行调度方案 |\n| 目标函数 | 完工时间及约束惩罚 |\n| 邻域 | 交换、插入或反转部分工件 |\n| 温度 | 接受较差解的概率控制 |\n\n### 设计搜索过程\n\n- 用贪心算法或随机排列生成初始解。\n- 交换两个工件、移动一个工件或反转一个片段。\n- 更好的方案直接接受；较差方案按温度决定是否接受。\n- 每个温度下执行一定数量的搜索步骤，再逐步降温。\n\n### 统一实验条件\n\n为每种算法提供相同时间预算，使用同一批实例，记录最优值、平均值和标准差。除了最终结果，也要绘制收敛过程。', ['root']),
];
await page.addInitScript(() => localStorage.setItem('aureli-mode', 'live'));
await page.route('**/customer-service/**', route => {
  const path = new URL(route.request().url()).pathname;
  return route.fulfill({ json: { success: true, data: path.endsWith('/maps')
    ? [{ mapId: 'collapse-map', name: '算法对比示例' }]
    : path.endsWith('/tile/workspace') ? { tiles, edges: [] } : [] } });
});
const cell = id => page.locator(`.branch-tile-cell[data-layout-id="${id}"]`);
const tile = id => cell(id).locator('.branch-tile');
const button = id => cell(id).locator('.branch-collapse-button');
const row = page.locator('.branch-row[data-depth="1"]');
const order = () => row.locator('.branch-tile-cell').evaluateAll(els => els.map(el => el.dataset.layoutId));
const settle = () => page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
const output = new URL('../../output/branch-dialogue-preview/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
try {
  await page.goto(url); await page.locator('.graph-node').first().waitFor();
  await selectView(page, '分支对话'); await page.locator('.inspector').waitFor({ state: 'hidden' });
  assert.equal(await button('root').isDisabled(), true);
  const initialWidth = (await tile('annealing').boundingBox()).width;
  // The button is outside the Tile's selection button in the accessibility tree.
  assert.equal(await page.locator('.branch-tile button').count(), 0);
  await button('genetic').click();
  assert.deepEqual(await order(), ['genetic', 'greedy', 'annealing']);
  assert.equal(await tile('genetic').getAttribute('aria-pressed'), 'false', 'collapse never changes associated context');
  assert.equal(await button('genetic').getAttribute('aria-expanded'), 'false');
  await page.waitForFunction(() => document.querySelector('.branch-tile-cell').getAnimations().length > 0);
  const midpoint = await page.evaluate(() => {
    const animations = document.getAnimations().filter(animation => animation.effect?.target?.closest('.branch-rows'));
    animations.forEach(animation => { animation.pause(); animation.currentTime = 200; });
    const el = document.querySelector('[data-layout-id="genetic"]');
    const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { scale: matrix.m11, x: matrix.m41, duration: el.getAnimations()[0].effect.getTiming().duration };
  });
  assert.equal(midpoint.duration, 400); assert.ok(midpoint.scale > 1); assert.ok(midpoint.x > 0);
  await page.screenshot({ path: `${output}collapse-midway.png` });
  await settle();
  assert.ok((await tile('annealing').boundingBox()).width > initialWidth);
  assert.equal(await cell('genetic').locator('.branch-tile-content').isVisible(), false);
  assert.equal(await tile('genetic').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 102, 204)');
  // Collapsed Tiles remain selectable independently of the expand button.
  await tile('genetic').click({ position: { x: 20, y: 20 } });
  assert.equal(await tile('genetic').getAttribute('aria-pressed'), 'true');
  await button('greedy').click(); await settle();
  assert.deepEqual(await order(), ['greedy', 'genetic', 'annealing']);
  assert.equal(await button('annealing').isDisabled(), true);
  assert.ok((await tile('annealing').boundingBox()).width > initialWidth * 1.2);
  await page.locator('.branch-scroll').evaluate(el => {
    const row = el.querySelector('[data-depth="1"]'); el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top;
  });
  await page.mouse.move(1430, 990); await settle();
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.locator('.branch-scroll').evaluate(el => {
    const row = el.querySelector('[data-depth="1"]'); el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top;
  });
  await page.screenshot({ path: `${output}collapsed-desktop.png` });
  assert.equal(await cell('genetic').locator('.branch-collapsed-summary h3').evaluate(el => getComputedStyle(el).color), 'rgb(255, 255, 255)');
  assert.equal(await button('genetic').evaluate(el => getComputedStyle(el).color), 'rgb(255, 255, 255)');
  // View changes retain local folding state and all original graph Tiles.
  await selectView(page, '图谱视图'); assert.equal(await page.locator('.graph-node').count(), 4);
  await selectView(page, '分支对话'); await page.locator('.inspector').waitFor({ state: 'hidden' });
  assert.deepEqual(await order(), ['greedy', 'genetic', 'annealing']);
  assert.equal(await button('annealing').isDisabled(), true);
  assert.equal(await tile('genetic').getAttribute('aria-pressed'), 'true');
  // Keyboard expansion is immediate, keeps focus, and restores source order.
  await button('genetic').focus(); await page.keyboard.press('Enter');
  assert.deepEqual(await order(), ['greedy', 'genetic', 'annealing']);
  assert.equal(await button('genetic').getAttribute('aria-expanded'), 'true');
  assert.equal(await button('genetic').evaluate(el => el === document.activeElement), true);
  assert.equal(await cell('genetic').evaluate(el => el.getAnimations().length), 0);
  assert.equal(await button('annealing').isDisabled(), false);
  await button('greedy').focus(); await page.keyboard.press('Space');
  assert.deepEqual(await order(), ['greedy', 'genetic', 'annealing']);
  assert.equal(await button('greedy').getAttribute('aria-expanded'), 'true');
  // Rapid reversal starts from the current visual position rather than jumping.
  await button('genetic').click();
  const beforeReverse = await cell('genetic').boundingBox();
  await button('genetic').evaluate(el => el.click());
  const afterReverse = await cell('genetic').boundingBox();
  assert.ok(Math.abs(beforeReverse.x - afterReverse.x) < 40);
  await settle();
  assert.equal(await button('genetic').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(await order(), ['greedy', 'genetic', 'annealing']);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await button('greedy').click(); await button('genetic').click();
  assert.equal(await cell('genetic').evaluate(el => el.getAnimations().length), 0);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const rail = await button('greedy').boundingBox(); assert.ok(rail.width >= 44 && rail.height >= 44);
  assert.ok((await tile('annealing').boundingBox()).width > 240);
  await page.locator('.branch-scroll').evaluate(el => {
    const row = el.querySelector('[data-depth="1"]'); el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top;
  });
  await page.screenshot({ path: `${output}collapsed-mobile.png` });
  await page.locator('.branch-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.screenshot({ path: `${output}collapsed-mobile-controls.png` });
  await button('greedy').click(); assert.equal(await button('annealing').isDisabled(), false);
  const touch = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await touch.addInitScript(() => localStorage.setItem('aureli-mode', 'live'));
  await touch.route('**/customer-service/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: { success: true, data: path.endsWith('/maps')
      ? [{ mapId: 'collapse-map', name: '触屏测试' }]
      : path.endsWith('/tile/workspace') ? { tiles, edges: [] } : [] } });
  });
  await touch.goto(url); await selectView(touch, '分支对话');
  for (const id of ['greedy', 'genetic']) await touch.locator(`[data-layout-id="${id}"] .branch-collapse-button`).tap();
  assert.equal(await touch.locator('[data-layout-id="annealing"] .branch-collapse-button').isDisabled(), true);
  await touch.locator('[data-layout-id="genetic"] .branch-collapse-button').tap();
  assert.equal(await touch.locator('[data-layout-id="genetic"] .branch-collapse-button').getAttribute('aria-expanded'), 'true');
  assert.equal(await touch.locator('[data-tile-id="genetic"]').getAttribute('aria-pressed'), 'false');
  await touch.close();
  assert.deepEqual(errors, []);
  console.log('PASS branch collapse: left rails, space redistribution, one expanded minimum, independent association, graph/view preservation, reversible motion, keyboard/reduced motion, responsive touch targets');
} finally { await browser.close(); }
