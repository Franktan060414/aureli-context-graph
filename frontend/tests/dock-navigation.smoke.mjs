import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { mockSampleWorkspace } from './helpers/sample-api.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const { maps } = await mockSampleWorkspace(page);
maps.push({ mapId: 'research', name: '研究笔记' }, { mapId: 'long-name', name: '一个用于验证超长名称不会挤压图标栏和工作区的图谱名称' });
await page.route('**/customer-service/model-settings', route => route.fulfill({ json: { success: true, data: {
  chat: { provider: 'local', baseUrl: 'http://localhost:11434/v1', model: 'chat', keyConfigured: true },
  embedding: { provider: 'local', baseUrl: 'http://localhost:11434/v1', model: 'embedding', keyConfigured: true },
  dimensions: 1536,
} } }));
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const artifact = name => new URL(`../artifacts/${name}`, import.meta.url).pathname;
await mkdir(new URL('../artifacts', import.meta.url), { recursive: true });
await page.emulateMedia({ reducedMotion: 'reduce' });
const primary = name => page.getByRole('link', { name, exact: true });
const openNavigation = () => page.getByRole('button', { name: '展开导航', exact: true }).click();

try {
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await page.locator('.graph-node').first().waitFor();
  assert.equal(await page.locator('.dock-navigation a').count(), 2);
  assert.equal(await primary('知识库管理').count(), 0);
  for (const link of await page.locator('.dock-navigation a').all()) {
    const box = await link.boundingBox();
    assert.equal(box.width, box.height);
    assert.ok(box.width >= 24, 'scaled desktop controls retain usable pointer targets');
    assert.equal(await link.innerText(), '');
    assert.ok(await link.getAttribute('title'));
  }
  assert.equal(await page.locator('.secondary-count').innerText(), '3');
  const rail = await page.locator('.dock-rail').boundingBox();
  const list = await page.locator('.secondary-navigation').boundingBox();
  const main = await page.locator('.main-shell').boundingBox();
  assert.equal(rail.x, 0);
  assert.ok(Math.abs(list.x - rail.x - rail.width) < 0.5);
  assert.ok(Math.abs(main.x - list.x - list.width) < 0.5);
  assert.equal(await page.locator('#settings-navigation').count(), 0);
  await page.screenshot({ path: artifact('dock-graph.png') });

  await primary('服务设置').focus();
  await page.keyboard.press('Enter');
  await page.locator('#chat-model:enabled').waitFor();
  assert.equal(await page.locator('#graph-navigation').count(), 0);
  assert.equal(await page.locator('#settings-navigation .map-item').count(), 3);
  assert.equal(await page.locator('#settings-navigation .map-item svg').count(), 0);
  await page.getByRole('button', { name: '知识库配置', exact: true }).click();
  await page.getByRole('heading', { name: '知识库还没有文档', exact: true }).waitFor();
  assert.equal(await primary('服务设置').getAttribute('aria-current'), 'page');
  await page.screenshot({ path: artifact('dock-settings.png') });
  await page.reload();
  await page.getByRole('heading', { name: '知识库配置', exact: true }).waitFor();

  for (const width of [768, 375, 667, 1440]) {
    await page.setViewportSize({ width, height: width === 667 ? 375 : 900 });
    if (width < 768) await openNavigation();
    await primary('我的图谱').click();
    if (width < 768) assert.equal(await page.locator('.sidebar.open').count(), 1, 'primary selection keeps the list available');
    await page.getByRole('button', { name: '研究笔记', exact: true }).click();
    if (width < 768) assert.equal(await page.locator('.sidebar.open').count(), 0, 'map selection dismisses the drawer');
    if (width < 768) await openNavigation();
    await primary('服务设置').click();
    await page.getByRole('button', { name: '知识库配置', exact: true }).click();
    await page.getByRole('heading', { name: '知识库配置', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no overflow at ${width}px`);
    if (width < 768) {
      assert.equal(await page.locator('.sidebar.open').count(), 0);
      await openNavigation();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.sidebar.open').count(), 0);
      assert.equal(await page.getByRole('button', { name: '展开导航', exact: true }).evaluate(el => document.activeElement === el), true);
    }
  }

  maps.push(...Array.from({ length: 40 }, (_, i) => ({ mapId: `map-${i}`, name: `图谱 ${i}` })));
  await page.goto(new URL('#graph', page.url()).href);
  await page.reload();
  await page.getByRole('button', { name: '图谱 39', exact: true }).waitFor();
  assert.equal(await page.locator('.secondary-body').evaluate(el => el.scrollHeight > el.clientHeight), true);
  const primaryBeforeScroll = await primary('服务设置').boundingBox();
  await page.getByRole('button', { name: '图谱 39', exact: true }).scrollIntoViewIfNeeded();
  assert.deepEqual(await primary('服务设置').boundingBox(), primaryBeforeScroll, 'long lists scroll independently of the rail');
  assert.deepEqual(errors, []);
  console.log('PASS: square icon rail, contextual lists, nested knowledge links, keyboard navigation, mobile selection/dismissal, long lists, responsive layout');
} finally {
  await browser.close();
}
