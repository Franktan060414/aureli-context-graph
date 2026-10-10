import assert from 'node:assert/strict';
import { selectView } from './helpers/view-select.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const qa = (id, relatedTileIds = [], answer = '完整回答。') => ({ id, relatedTileIds, message: `问题 ${id}`, answer, tileType: 'QA', status: 'ready' });
const paragraph = '先确定问题约束，再比较可行方案，并解释算法选择对结果的影响。';
const tiles = [qa('root'), qa('short', ['root']), qa('long', ['root'], `${paragraph}\n\n`.repeat(45)),
  qa('medium', ['root'], `${paragraph}\n\n`.repeat(20)), qa('tail', ['long'], `${paragraph}\n\n`.repeat(35))];
await page.addInitScript(() => localStorage.setItem('aureli-mode', 'live'));
await page.route('**/customer-service/**', route => {
  const path = new URL(route.request().url()).pathname;
  return route.fulfill({ json: { success: true, data: path.endsWith('/maps')
    ? [{ mapId: 'scroll-map', name: '滚动稳定性测试' }]
    : path.endsWith('/tile/workspace') ? { tiles, edges: [] } : [] } });
});
const button = id => page.locator(`[data-layout-id="${id}"] .branch-collapse-button`);
async function traceClick(id, keyboard = false) {
  const target = button(id);
  await target.scrollIntoViewIfNeeded();
  if (keyboard) await target.evaluate(el => el.focus({ preventScroll: true }));
  await page.evaluate(({ id, keyboard }) => {
    const button = document.querySelector(`[data-layout-id="${id}"] .branch-collapse-button`);
    const scroll = document.querySelector('.branch-scroll'), row = button.closest('.branch-row');
    const sample = () => ({ scroll: scroll.scrollTop, button: button.getBoundingClientRect().bottom,
      row: row.getBoundingClientRect().bottom, height: row.offsetHeight });
    const samples = [sample()];
    window.collapseTrace = samples;
    window.collapseTraceDone = false;
    button.addEventListener(keyboard ? 'keydown' : 'pointerdown', () => {
      const until = performance.now() + 650;
      function record() {
        samples.push(sample());
        if (performance.now() < until) requestAnimationFrame(record);
        else window.collapseTraceDone = true;
      }
      requestAnimationFrame(record);
    }, { once: true });
  }, { id, keyboard });
  if (keyboard) await target.press('Enter');
  else await target.click();
  await page.waitForFunction(() => window.collapseTraceDone);
  assert.equal(await page.locator('.branch-scroll.is-reflowing').count(), 0);
  return page.evaluate(() => window.collapseTrace);
}
async function assertStable(id, keyboard = false) {
  const trace = await traceClick(id, keyboard);
  const baseline = trace[0].button;
  const drift = Math.max(...trace.map(sample => Math.abs(sample.button - baseline)));
  assert.ok(drift < 3, `fold/unfold must hold the footer's vertical position; drift ${drift}px: ${JSON.stringify([trace[0], trace.at(-1)])}`);
}
try {
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await page.locator('.graph-node').first().waitFor(); await selectView(page, '分支对话');
  await page.locator('.inspector').waitFor({ state: 'hidden' });
  for (const id of ['long', 'long', 'medium', 'medium']) await assertStable(id);
  // The final row also remains stable when shrinking would clamp scrollTop.
  tiles.pop();
  await page.reload(); await selectView(page, '分支对话');
  await page.locator('.inspector').waitFor({ state: 'hidden' });
  await page.locator('.branch-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await assertStable('long'); await assertStable('long');
  await assertStable('long', true); await assertStable('long', true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await assertStable('long'); await assertStable('long');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1);
  await page.locator('.branch-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await assertStable('long'); await assertStable('long');
  // The operation compensates once; it must not override later user scrolling.
  await button('long').click();
  const manualTop = await page.locator('.branch-scroll').evaluate(el => {
    el.scrollTop = Math.max(0, el.scrollTop - 100); el.dispatchEvent(new Event('scroll')); return el.scrollTop;
  });
  await page.waitForFunction(() => !document.querySelector('.branch-scroll').classList.contains('is-reflowing'));
  assert.equal(await page.locator('.branch-scroll').evaluate(el => el.scrollTop), manualTop);
  assert.deepEqual(errors, []);
  console.log('PASS branch collapse scrolling: stable footer through height changes, middle/last rows, desktop/mobile, keyboard/reduced motion, and manual scrolling');
} finally { await browser.close(); }
