import assert from 'node:assert/strict';
import { demoGraph } from '../src/lib/demo.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
const maps = [{ mapId: 'default', name: 'A', zoom: 0.6 }, { mapId: 'map-b', name: 'B', zoom: 1.2 }];
let holdA = true, releaseA, fail = false;
await page.addInitScript(() => localStorage.setItem('aureli-mode', 'live'));
await page.route('**/customer-service/maps', route => route.fulfill({ json: { success: true, data: maps } }));
await page.route('**/customer-service/tile/workspace?*', route => route.fulfill({ json: { success: true, data: demoGraph() } }));
await page.route('**/customer-service/maps/*/zoom', async route => {
  const mapId = new URL(route.request().url()).pathname.split('/').at(-2), zoom = route.request().postDataJSON().zoom;
  writes.push({ mapId, zoom });
  if (holdA && mapId === 'default') { holdA = false; await new Promise(resolve => { releaseA = resolve; }); }
  if (fail) return route.fulfill({ json: { success: false, message: '数据库暂不可用' } });
  maps.find(map => map.mapId === mapId).zoom = zoom;
  await route.fulfill({ json: { success: true } });
});
const mapButton = name => page.locator('.map-list').getByRole('button', { name, exact: true });
async function zoom(expected) {
  await page.waitForFunction(expected => {
    const worlds = [...document.querySelectorAll('.graph-world')];
    return worlds.length && worlds.every(world => Math.abs(Number(world.style.transform.match(/^scale\((.+)\)$/)?.[1]) - expected) < 1e-6);
  }, expected);
  assert.equal(Number(new URL(page.url()).searchParams.get('zoom')), expected);
}
async function saved(mapId, expected) {
  for (let i = 0; i < 300; i++) { if (Math.abs(maps.find(map => map.mapId === mapId).zoom - expected) < 1e-6) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error(`Zoom was not saved for ${mapId}`);
}
try {
  await page.goto((process.env.UI_TEST_URL || 'http://127.0.0.1:5173') + '/?zoom=1.5');
  await zoom(0.6); // The saved live-map setting overrides an old URL zoom.
  assert.equal(writes.length, 0, 'restoring a saved value must not POST it back');
  await page.getByRole('button', { name: '放大图谱', exact: true }).click();
  await zoom(0.7);
  await page.getByRole('button', { name: '放大图谱', exact: true }).click();
  await zoom(0.8);
  await mapButton('B').click(); await zoom(1.2);
  assert.equal(writes.length, 1, 'A changes are queued; restoring B does not save A zoom into B');
  await page.getByRole('button', { name: '缩小图谱', exact: true }).click();
  await zoom(1.1); await saved('map-b', 1.1);
  assert.ok(releaseA); releaseA();
  await saved('default', 0.8);
  await zoom(1.1); // The late A response cannot reset B's view.
  await mapButton('A').click(); await zoom(0.8);
  await page.reload(); await zoom(0.8);
  assert.deepEqual(writes.slice(0, 3), [{ mapId: 'default', zoom: 0.7 }, { mapId: 'map-b', zoom: 1.1 }, { mapId: 'default', zoom: 0.8 }]);
  await page.getByRole('button', { name: '全页面查看图谱', exact: true }).click();
  await page.locator('.fullscreen-viewer').getByRole('button', { name: '放大图谱', exact: true }).click();
  await zoom(0.9); await saved('default', 0.9);
  await page.locator('.fullscreen-header .secondary').click();
  await page.reload(); await zoom(0.9);
  fail = true;
  await page.getByRole('button', { name: '放大图谱', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '缩放比例保存失败' }).waitFor();
  await zoom(1);
  assert.equal(maps[0].zoom, 0.9);
  fail = false;
  const retrySaved = page.waitForResponse(response => response.url().includes('/maps/default/zoom'));
  await page.getByRole('button', { name: '缩小图谱', exact: true }).click();
  await retrySaved;
  await zoom(0.9); await saved('default', 0.9);
  const beforeRestore = writes.length;
  await mapButton('B').click(); await zoom(1.1);
  await mapButton('A').click(); await zoom(0.9);
  assert.equal(writes.length, beforeRestore);
  // Demo maps retain their own ratio without database writes.
  const demoPage = await browser.newPage();
  await demoPage.addInitScript(() => localStorage.setItem('aureli-mode', 'demo'));
  await demoPage.goto((process.env.UI_TEST_URL || 'http://127.0.0.1:5173') + '/?zoom=0.7');
  await demoPage.getByRole('button', { name: '新建图谱', exact: true }).click();
  await demoPage.getByLabel('图谱名称').fill('示例 B');
  await demoPage.locator('.map-create-form').getByRole('button', { name: '创建', exact: true }).click();
  assert.equal(Number(new URL(demoPage.url()).searchParams.get('zoom')), 1);
  await demoPage.locator('.map-list').getByRole('button', { name: '示例图谱', exact: true }).click();
  assert.equal(Number(new URL(demoPage.url()).searchParams.get('zoom')), 0.7);
  await demoPage.close();
  assert.deepEqual(errors, []);
  console.log('PASS: per-map saved zoom, initial restore, switching during queued saves, late responses, refresh, fullscreen, failure/retry, no restore writes and demo isolation');
} finally { await browser.close(); }
