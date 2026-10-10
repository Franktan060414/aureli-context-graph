import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const errors = [];
try {
  for (const width of [1440, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    const maps = [], reads = [], writes = [];
    await page.addInitScript(() => {
      localStorage.setItem('aureli-mode', 'live');
      localStorage.setItem(`aureli-active-map:${location.origin}`, 'default');
    });
    await page.route('**/customer-service/maps', async route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { success: true, data: maps } });
      const body = route.request().postDataJSON(); writes.push(body);
      maps.push({ mapId: 'map-first', name: body.name, zoom: 1 });
      await route.fulfill({ json: { success: true, data: maps[0] } });
    });
    await page.route('**/customer-service/tile/workspace?*', async route => {
      reads.push(new URL(route.request().url()).searchParams.get('mapId'));
      await route.fulfill({ json: { success: true, data: { tiles: [], edges: [] } } });
    });
    const url = new URL(process.env.UI_TEST_URL || 'http://127.0.0.1:5173'); url.searchParams.set('map', 'default');
    await page.goto(url.href);
    await page.getByRole('heading', { name: '创建你的第一张图谱' }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('map'), null);
    assert.equal(await page.evaluate(() => localStorage.getItem(`aureli-active-map:${location.origin}`)), null);
    assert.deepEqual(reads, []);
    assert.deepEqual(writes, []);
    await page.locator('.no-map-state').getByRole('button', { name: '新建图谱', exact: true }).click();
    await page.getByLabel('图谱名称').fill('第一张图谱');
    const workspaceLoaded = page.waitForResponse(response => response.url().includes('/tile/workspace?'));
    await page.locator('.map-create-form').getByRole('button', { name: '创建', exact: true }).click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('map') === 'map-first');
    await workspaceLoaded;
    assert.deepEqual(reads, ['map-first']);
    assert.deepEqual(writes, [{ name: '第一张图谱' }]);
    await page.reload();
    await page.locator('.map-item.selected').filter({ hasText: '第一张图谱' }).waitFor({ state: 'attached' });
    assert.equal(new URL(page.url()).searchParams.get('map'), 'map-first');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator('.no-map-state').count(), 0);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: empty map list never creates default or reads unassigned workspace, clears stale selection, supports first map creation on desktop/mobile and reload');
} finally { await browser.close(); }
