import assert from 'node:assert/strict';
import { selectView } from './helpers/view-select.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const errors = [];
const maps = [{ mapId: 'view-map', name: '视图示例', zoom: 0.72 }, { mapId: 'other-map', name: '另一个图谱', zoom: 1.1 }];
const tiles = [{ id: 'view-tile', message: '当前模式可以通过链接恢复吗？', answer: '可以，链接保留当前视图模式。', tileType: 'QA', status: 'ready', relatedTileIds: [] }];
async function makePage() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('aureli-mode', 'live'));
  await page.route('**/customer-service/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: { success: true, data: path.endsWith('/maps') ? maps
      : path.endsWith('/tile/workspace') ? { tiles, edges: [] } : [] } });
  });
  return page;
}
const modes = { graph: ['图谱视图', '.graph-node'], list: ['Tile 列表', '.tile-list article'], branch: ['分支对话', '.branch-tile'] };
async function assertMode(page, mode) {
  const [label, selector] = modes[mode];
  await page.locator(selector).first().waitFor();
  assert.match(await page.locator('.view-select-trigger').innerText(), new RegExp(label));
  assert.equal(new URL(page.url()).searchParams.get('view'), mode);
}
const initial = new URL(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
initial.searchParams.set('map', 'view-map');
initial.searchParams.set('zoom', '0.72');
initial.searchParams.set('extra', '保留参数');
initial.hash = 'graph';
const page = await makePage();
try {
  await page.goto(initial.href); await assertMode(page, 'graph');
  for (const mode of ['branch', 'list', 'graph']) {
    await page.evaluate(() => history.replaceState({ viewTest: 'kept' }, ''));
    const length = await page.evaluate(() => history.length);
    await selectView(page, modes[mode][0]); await assertMode(page, mode);
    const url = new URL(page.url());
    assert.equal(url.searchParams.get('map'), 'view-map');
    assert.equal(url.searchParams.get('zoom'), '0.72');
    assert.equal(url.searchParams.get('extra'), '保留参数');
    assert.equal(url.hash, '#graph');
    assert.equal(await page.evaluate(() => history.state.viewTest), 'kept');
    assert.equal(await page.evaluate(() => history.length), length, 'view switching does not add browser back steps');
    const link = page.url();
    await page.reload(); await assertMode(page, mode);
    const fresh = await makePage(); await fresh.goto(link); await assertMode(fresh, mode); await fresh.close();
  }
  await selectView(page, '分支对话');
  await page.locator('.map-list').getByRole('button', { name: '另一个图谱', exact: true }).click();
  await assertMode(page, 'branch');
  assert.equal(new URL(page.url()).searchParams.get('map'), 'other-map');
  assert.equal(new URL(page.url()).searchParams.get('zoom'), '1.1');
  await page.reload(); await assertMode(page, 'branch');
  // Same-document back/forward navigation restores the view without a reload.
  await page.evaluate(() => {
    for (const mode of ['graph', 'list']) {
      const url = new URL(location.href); url.searchParams.set('view', mode); history.pushState({}, '', url);
    }
    history.back();
  });
  await assertMode(page, 'graph');
  await page.goForward(); await assertMode(page, 'list');
  const invalid = new URL(initial); invalid.searchParams.set('view', 'unknown');
  await page.goto(invalid.href); await assertMode(page, 'graph');
  assert.deepEqual(errors, []);
  console.log('PASS view URL: all modes survive reload and fresh links, preserve map/zoom/query/hash/history state, remain on map switch, restore on back/forward, and handle invalid values');
} finally { await browser.close(); }
