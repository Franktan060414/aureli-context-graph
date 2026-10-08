import assert from 'node:assert/strict';
import { demoGraph } from '../src/lib/demo.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const baseUrl = process.env.UI_TEST_URL || 'http://127.0.0.1:5173';
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(8000);
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.addInitScript(() => localStorage.setItem('aureli-mode', 'demo'));

async function assertZoom(expected) {
  await page.waitForFunction(value => {
    const worlds = [...document.querySelectorAll('.graph-world')];
    return worlds.length && worlds.every(element => {
      const scale = Number(element.style.transform.match(/^scale\((.+)\)$/)?.[1]);
      return Math.abs(scale - value) < 0.000001;
    });
  }, expected);
  assert.equal(Number(new URL(page.url()).searchParams.get('zoom')), expected);
  for (const label of await page.locator('.canvas-controls > .mono').allTextContents()) {
    assert.equal(label, `${Math.round(expected * 100)}%`);
  }
}

try {
  await page.goto(`${baseUrl}/?source=zoom-test&zoom=0.8#graph`);
  await assertZoom(0.8);
  const historyLength = await page.evaluate(() => history.length);
  await page.getByRole('button', { name: '放大图谱', exact: true }).click();
  await assertZoom(0.9);
  await page.getByRole('button', { name: '缩小图谱', exact: true }).click();
  await assertZoom(0.8);
  assert.equal(await page.evaluate(() => history.length), historyLength);
  assert.equal(new URL(page.url()).searchParams.get('source'), 'zoom-test');
  assert.equal(new URL(page.url()).hash, '#graph');
  await page.reload();
  await assertZoom(0.8);
  await page.setViewportSize({ width: 1100, height: 800 });
  await assertZoom(0.8);
  await page.getByRole('button', { name: 'Tile 列表', exact: true }).click();
  await page.getByRole('button', { name: '图谱视图', exact: true }).click();
  await assertZoom(0.8);
  await page.getByRole('link', { name: '知识库管理', exact: true }).click();
  await page.getByRole('link', { name: /图谱工作台/ }).click();
  await assertZoom(0.8);

  await page.getByRole('button', { name: '全页面查看图谱', exact: true }).click();
  await assertZoom(0.8);
  const fullscreen = page.locator('.fullscreen-viewer');
  await fullscreen.getByRole('button', { name: '放大图谱', exact: true }).click();
  await assertZoom(0.9);
  await fullscreen.getByRole('button', { name: '适应画布', exact: true }).click();
  const fittedZoom = Number(new URL(page.url()).searchParams.get('zoom'));
  assert.ok(fittedZoom >= 0.35 && fittedZoom <= 1);
  await assertZoom(fittedZoom);
  await fullscreen.locator('.fullscreen-header .secondary').click();
  await fullscreen.waitFor({ state: 'detached' });
  await assertZoom(fittedZoom);
  await page.reload();
  await assertZoom(fittedZoom);

  // Browser navigation restores the zoom saved on that history entry.
  await page.evaluate(() => history.pushState({ test: true }, '', '?source=zoom-test&zoom=0.6#graph'));
  await page.evaluate(() => dispatchEvent(new PopStateEvent('popstate')));
  await assertZoom(0.6);
  await page.getByRole('button', { name: '放大图谱', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => history.state), { test: true });
  await page.goBack();
  await assertZoom(fittedZoom);
  await page.goForward();
  await assertZoom(0.7);

  for (const [query, expected] of [
    ['', 1], ['zoom=', 1], ['zoom=invalid', 1], ['zoom=NaN', 1],
    ['zoom=Infinity', 1], ['zoom=-1', 0.35], ['zoom=0', 0.35], ['zoom=99', 1.5],
  ]) {
    await page.goto(`${baseUrl}/?${query}#graph`);
    await assertZoom(expected);
  }
  await page.getByRole('button', { name: '放大图谱', exact: true }).click();
  await assertZoom(1.5);
  await page.goto(`${baseUrl}/?zoom=0.35#graph`);
  await page.getByRole('button', { name: '缩小图谱', exact: true }).click();
  await assertZoom(0.35);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.reload();
  await assertZoom(0.35);

  // Loading and refreshing real workspace data must retain restored zoom.
  const live = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  live.on('pageerror', error => errors.push(error.message));
  await live.addInitScript(() => localStorage.setItem('aureli-mode', 'live'));
  let releaseWorkspace;
  const workspaceReady = new Promise(resolve => { releaseWorkspace = resolve; });
  let workspace = demoGraph();
  await live.route('**/customer-service/tile/workspace', async route => {
    await workspaceReady;
    await route.fulfill({ json: { success: true, data: workspace } });
  });
  await live.goto(`${baseUrl}/?zoom=0.65#graph`);
  assert.equal(await live.locator('.canvas-controls > .mono').textContent(), '65%');
  releaseWorkspace();
  await live.locator('.graph-node').first().waitFor();
  assert.equal(await live.locator('.graph-world').evaluate(element => element.style.transform), 'scale(0.65)');
  workspace = { tiles: workspace.tiles.slice(0, 2), edges: [] };
  await live.getByRole('button', { name: '同步图谱', exact: true }).click();
  await live.waitForFunction(() => document.querySelectorAll('.graph-node').length === 2);
  assert.equal(await live.locator('.graph-world').evaluate(element => element.style.transform), 'scale(0.65)');
  await live.reload();
  await live.locator('.graph-node').first().waitFor();
  assert.equal(await live.locator('.graph-world').evaluate(element => element.style.transform), 'scale(0.65)');
  await live.close();
  assert.deepEqual(errors, []);
  console.log('PASS: URL zoom, refresh, resize, shared views, fit, navigation, limits, invalid values, mobile and delayed workspace loading');
} finally {
  await browser.close();
}
