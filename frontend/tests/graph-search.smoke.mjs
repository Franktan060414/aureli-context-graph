import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const tiles = [
  { id: 'search-qa', tileType: 'QA', message: '图谱问题', answer: '问答内容', relatedTileIds: [] },
  { id: 'search-note', tileType: 'NOTE', message: '便签标题', answer: '查找这段正文', relatedTileIds: ['search-qa'] },
  { id: 'search-file', tileType: 'FILE', message: '附件文档', answer: '附件.docx', relatedTileIds: [] },
].map(tile => ({ ...tile, status: 'ready', weight: 1 }));
await page.addInitScript(() => localStorage.setItem('aureli-mode', 'live'));
await page.route('**/customer-service/tile/workspace', route => route.fulfill({ json: { success: true, data: { tiles, edges: [] } } }));
const trigger = page.getByRole('button', { name: '搜索与筛选', exact: true });
const dialog = page.getByRole('dialog', { name: '搜索与筛选', exact: true });
const query = page.getByRole('textbox', { name: '搜索 Tile', exact: true });
const filter = page.getByRole('combobox', { name: '按节点类型筛选', exact: true });
const matchingIds = () => page.locator('.graph-node:not(.dimmed) .node-main').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label').match(/^查看 (.+?)：/)[1]));
async function open() {
  await trigger.click();
  await dialog.waitFor();
  assert.equal(await query.evaluate(element => element === document.activeElement), true);
}
async function apply() {
  await dialog.getByRole('button', { name: '应用筛选', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
}

try {
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await page.locator('.graph-node').first().waitFor();
  assert.equal(await page.locator('.graph-filters').count(), 0);
  const resting = await trigger.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color };
  });
  assert.deepEqual(resting, { background: 'rgb(255, 255, 255)', color: 'rgb(21, 122, 59)' });
  await trigger.screenshot({ path: new URL('../artifacts/graph-search-button.png', import.meta.url).pathname });
  const before = await trigger.boundingBox();
  await trigger.hover();
  await page.waitForFunction(() => {
    const element = document.querySelector('.graph-search-action');
    return getComputedStyle(element).color === 'rgb(255, 255, 255)' && new DOMMatrix(getComputedStyle(element, '::after').transform).m41 === 0;
  });
  assert.equal(await trigger.evaluate(element => getComputedStyle(element, '::after').backgroundColor), 'rgb(21, 122, 59)');
  assert.deepEqual(await trigger.boundingBox(), before);
  await trigger.screenshot({ path: new URL('../artifacts/graph-search-button-hover.png', import.meta.url).pathname });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open();
  await query.fill('查找这段正文');
  await filter.selectOption('NOTE');
  assert.deepEqual(await matchingIds(), tiles.map(tile => tile.id), 'draft does not change results');
  await dialog.screenshot({ path: new URL('../artifacts/graph-search-dialog.png', import.meta.url).pathname });
  await apply();
  assert.deepEqual(await matchingIds(), ['search-note']);
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
  assert.equal(await trigger.evaluate(element => element.classList.contains('is-filtered')), true);
  await open();
  assert.equal(await query.inputValue(), '查找这段正文');
  assert.equal(await filter.inputValue(), 'NOTE');
  await query.fill('不存在');
  await page.keyboard.press('Escape');
  assert.deepEqual(await matchingIds(), ['search-note']);
  await open();
  assert.equal(await query.inputValue(), '查找这段正文');
  await dialog.getByRole('button', { name: '清除搜索和筛选', exact: true }).click();
  await apply();
  assert.deepEqual(await matchingIds(), tiles.map(tile => tile.id));
  assert.equal(await trigger.evaluate(element => element.classList.contains('is-filtered')), false);

  for (const [value, expected] of [['QA', ['search-qa']], ['FILE', ['search-file']], ['root', ['search-qa', 'search-file']], ['related', ['search-note']]]) {
    await open();
    await filter.selectOption(value);
    await apply();
    assert.deepEqual(await matchingIds(), expected);
  }
  await open();
  await filter.selectOption('all');
  await query.fill('search-file');
  await query.press('Enter');
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(await matchingIds(), ['search-file']);
  await page.getByRole('button', { name: 'Tile 列表', exact: true }).click();
  assert.equal(await page.locator('.tile-list article').count(), 1);
  await open();
  await dialog.getByRole('button', { name: '清除搜索', exact: true }).click();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.locator('.tile-list article').count(), 1);

  for (const [width, height] of [[320, 800], [375, 900], [844, 390], [1440, 1000]]) {
    await page.setViewportSize({ width, height });
    await open();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: green hover animation, dialog search/filter, drafts, apply/reset/cancel, all filters, list, keyboard, focus and responsive layout');
} finally { await browser.close(); }
