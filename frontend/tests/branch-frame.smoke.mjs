import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { selectView } from './helpers/view-select.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const url = process.env.UI_TEST_URL || 'http://127.0.0.1:5173';
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('aureli-mode', 'live'));
const root = { id: 'root', message: '如何比较三种调度算法？', answer: '分别考虑实现成本、解的质量和实验方法，再综合比较。', relatedTileIds: [], tileType: 'QA', status: 'ready' };
const siblings = [
  { id: 'short', message: '贪心算法适合哪些情况？', answer: '当需要快速得到一个可行方案时，可先使用贪心算法建立基线。\n\n它的实现简单、计算成本低，但局部选择未必能带来全局最优结果。先用统一的约束和评价指标运行基线，再比较其他方法。' },
  { id: 'middle', message: '如何设计遗传算法？', answer: '遗传算法维护一个候选解种群，通过选择、交叉和变异持续探索。\n\n先确定排列编码与适应度函数，再设计能够保持可行性的交叉算子。变异用于增加搜索多样性，需要与种群规模、迭代次数一起调节。\n\n可以用贪心方案初始化部分个体，并保留若干最优解。比较效果时，应控制运行时间，多次独立运行，记录平均结果与波动范围。' },
  { id: 'long', message: '模拟退火应该如何建模与验证？', answer: '模拟退火从一个当前解开始，通过邻域扰动探索新方案。它在早期允许接受较差的结果，帮助搜索跳出局部最优，随后逐步降低这种接受概率。\n\n### 建立问题映射\n\n首先把调度方案编码为工件的排列，并定义统一的目标函数。每次生成一个候选排列后，都要按实际约束计算完成时间，确保不同算法比较的是同一个问题。\n\n| 算法概念 | 调度中的对应含义 |\n| --- | --- |\n| 状态 | 工件排列与可行调度方案 |\n| 目标函数 | 完工时间及约束惩罚 |\n| 邻域 | 交换、插入或反转部分工件 |\n| 温度 | 接受较差解的概率控制 |\n\n### 设计搜索过程\n\n- 用贪心算法或随机排列生成初始解。\n- 通过交换两个工件、移动一个工件或反转一个片段产生邻域方案。\n- 更好的方案直接接受；较差的方案按当前温度决定是否接受。\n- 每个温度下执行一定数量的搜索步骤，再逐步降温。\n\n初始温度应覆盖问题中常见的目标差值。如果温度过低，算法很快退化为局部搜索；如果过高，早期的大量搜索可能接近随机游走。可以通过试运行观察接受率，再决定起始温度与降温速度。\n\n### 统一实验条件\n\n为每种算法提供相同的时间预算，使用同一批实例，并记录最优值、平均值和标准差。除了最终结果，也要绘制收敛过程，比较算法在短时间与长时间预算下的表现。\n\n结合遗传算法时，可以对优秀个体进行少量退火优化。应先分别建立两种算法的基线，再通过消融实验判断组合方案是否带来稳定提升，避免把额外计算时间的效果误认为策略本身的效果。' },
].map(tile => ({ ...tile, relatedTileIds: ['root'], tileType: 'QA', status: 'ready' }));
await page.route('**/customer-service/**', route => {
  const path = new URL(route.request().url()).pathname;
  return route.fulfill({ json: { success: true, data: path.endsWith('/maps')
    ? [{ mapId: 'frame-map', name: '算法对比示例' }]
    : path.endsWith('/tile/workspace') ? { tiles: [root, ...siblings], edges: [] } : [] } });
});
const target = page.locator('[data-tile-id="middle"]');
const frame = target.locator('.branch-tile-frame-fill');
const state = () => target.evaluate(el => ({
  background: getComputedStyle(el).backgroundColor,
  box: el.getBoundingClientRect().toJSON(),
  mask: getComputedStyle(el.querySelector('.branch-tile-frame')).maskComposite,
  transform: new DOMMatrixReadOnly(getComputedStyle(el.querySelector('.branch-tile-frame-fill')).transform).m41,
  duration: getComputedStyle(el.querySelector('.branch-tile-frame-fill')).transitionDuration,
}));
const output = new URL('../../output/branch-dialogue-preview/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
try {
  await page.goto(url); await page.locator('.graph-node').first().waitFor();
  await selectView(page, '分支对话'); await page.locator('.inspector').waitFor({ state: 'hidden' });
  await page.locator('.branch-scroll').evaluate(el => { const row = el.querySelector('[data-depth="1"]'); el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top; });
  const widths = await page.locator('.branch-row[data-depth="1"] .branch-tile').evaluateAll(tiles => tiles.map(tile => tile.clientWidth));
  assert.ok(widths[2] > widths[1] && widths[1] > widths[0]);
  const resting = await state();
  await target.hover({ position: { x: 12, y: 12 } });
  await page.waitForFunction(() => document.querySelector('[data-tile-id="middle"] .branch-tile-frame-fill').getAnimations().length > 0);
  const half = await frame.evaluate(el => {
    const animation = el.getAnimations()[0]; animation.pause(); animation.currentTime = 80;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: matrix.m41, scale: matrix.m11, width: el.offsetWidth, duration: animation.effect.getTiming().duration };
  });
  assert.ok(half.x < 0 && half.x > -half.width); assert.equal(half.scale, 1); assert.equal(half.duration, 160);
  const during = await state(); assert.equal(during.background, resting.background); assert.ok(during.mask.split(',').every(value => value.trim() === 'exclude'));  assert.deepEqual(during.box, resting.box);
  await page.screenshot({ path: `${output}frame-halfway.png` });
  await frame.evaluate(el => el.getAnimations().forEach(animation => animation.play()));
  await page.waitForFunction(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-tile-id="middle"] .branch-tile-frame-fill')).transform).m41 === 0);
  await page.screenshot({ path: `${output}weighted-desktop.png` });
  await page.mouse.move(1425, 990);
  await page.waitForFunction(() => document.querySelector('[data-tile-id="middle"] .branch-tile-frame-fill').getAnimations().length > 0);
  const exit = await frame.evaluate(el => { const animation = el.getAnimations()[0]; animation.pause(); animation.currentTime = 80; return new DOMMatrixReadOnly(getComputedStyle(el).transform).m41; });
  assert.ok(exit < 0 && exit > -half.width);
  // A rapid re-entry retargets the current fill rather than starting outside again.
  await target.hover({ position: { x: 12, y: 12 } });
  await page.waitForFunction(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-tile-id="middle"] .branch-tile-frame-fill')).transform).m41 === 0);
  await target.click({ position: { x: 12, y: 12 } });
  await page.mouse.move(1425, 990);
  assert.equal((await state()).transform, 0);
  assert.equal(await page.locator('.branch-context, .branch-context-chip').count(), 0);
  await target.click({ position: { x: 12, y: 12 } });
  await page.mouse.move(1425, 990);
  await frame.evaluate(el => el.getAnimations().forEach(animation => animation.finish()));
  await target.focus(); await page.keyboard.press('Space');
  assert.equal((await state()).duration, '0s'); assert.equal((await state()).transform, 0);
  await page.keyboard.press('Space');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await target.hover({ position: { x: 12, y: 12 } });
  assert.equal((await state()).duration, '0s'); assert.equal((await state()).transform, 0);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1);
  await page.locator('.branch-scroll').evaluate(el => { const row = el.querySelector('[data-depth="1"]'); el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top; });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${output}weighted-mobile.png` });
  const touch = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await touch.addInitScript(() => localStorage.setItem('aureli-mode', 'demo'));
  await touch.goto(url); await selectView(touch, '分支对话');
  const touchTile = touch.locator('.branch-tile').first();
  await touchTile.tap({ position: { x: 12, y: 12 } }); await touchTile.tap({ position: { x: 12, y: 12 } });
  assert.equal(await touchTile.getAttribute('aria-pressed'), 'false');
  assert.ok(await touchTile.locator('.branch-tile-frame-fill').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41 < 0), 'touch must not retain a hover frame');
  await touch.close();
  assert.deepEqual(errors, []);
  console.log('PASS branch frame: masked border-only sweep, stationary content, reversible hover, selected frame, keyboard/reduced-motion, touch, weighted desktop/mobile rows');
} finally { await browser.close(); }
