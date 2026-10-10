import { selectView } from "./helpers/view-select.js";
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
const tile = (id, type) => ({ id, tileType: type, kind: type === 'QA' ? 'root' : type.toLowerCase(), message: `内容 ${id}`, answer: '节点正文', relatedTileIds: [], weight: 1, status: 'ready', labelId: null });
const graphs = { a: { tiles: [tile('qa', 'QA'), tile('note', 'NOTE'), tile('file', 'FILE')], labels: [], edges: [] }, b: { tiles: [tile('other', 'QA')], labels: [{ id: 99, name: 'B 标签', colorHex: '#FFFFFF' }], edges: [] } };
let nextId = 1, failAssign = false, failSave = false;
await page.route('**/customer-service/maps', route => route.fulfill({ json: { success: true, data: [{ mapId: 'a', name: '图谱 A' }, { mapId: 'b', name: '图谱 B' }] } }));
await page.route('**/customer-service/tile/workspace?*', route => route.fulfill({ json: { success: true, data: graphs[new URL(route.request().url()).searchParams.get('mapId')] } }));
await page.route('**/customer-service/labels**', async route => {
  const request = route.request(), url = new URL(request.url());
  const body = request.method() === 'DELETE' ? null : request.postDataJSON();
  writes.push({ path: url.pathname, method: request.method(), body });
  const mapId = body?.mapId || url.searchParams.get('mapId'); const graph = graphs[mapId];
  const id = Number(url.pathname.split('/').at(-1));
  if (request.method() === 'DELETE') {
    graph.labels = graph.labels.filter(label => label.id !== id);
    graph.tiles.filter(t => t.labelId === id).forEach(t => { t.labelId = null; });
    return route.fulfill({ json: { success: true } });
  }
  if (failSave) return route.fulfill({ status: 409, json: { success: false, message: '保存失败，请重试' } });
  const label = { id: Number.isFinite(id) ? id : nextId++, ...body };
  const index = graph.labels.findIndex(l => l.id === label.id);
  if (index < 0) graph.labels.push(label); else graph.labels[index] = label;
  return route.fulfill({ json: { success: true, data: label } });
});
await page.route('**/customer-service/tile/label', async route => {
  const body = route.request().postDataJSON(); writes.push({ path: 'assign', body });
  if (failAssign) return route.fulfill({ status: 400, json: { success: false, message: '部分 Tile 不存在，请同步后重试' } });
  graphs[body.mapId].tiles.filter(t => body.tileIds.includes(t.id)).forEach(t => { t.labelId = body.labelId; });
  return route.fulfill({ json: { success: true } });
});
const dialog = page.locator('dialog[aria-labelledby="workspace-modal-title"]'), panel = page.locator('.label-panel');
const card = id => page.locator('.graph-node').filter({ has: page.locator('.mono', { hasText: new RegExp(`^${id}$`) }) });
async function open() { await page.getByRole('button', { name: '标签', exact: true }).click(); await panel.waitFor(); }
async function close() { await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('dialog[aria-labelledby="workspace-modal-title"]').open); }
async function create(name, color) {
  await panel.getByRole('button', { name: '新建标签', exact: true }).click();
  await panel.getByLabel('标签名称', { exact: true }).fill(name);
  await panel.getByLabel('颜色 HEX', { exact: true }).fill(color);
  await panel.getByRole('button', { name: '保存标签', exact: true }).click();
  await panel.getByRole('radio', { name, exact: true }).waitFor();
}
async function color(id) { return card(id).evaluate(el => getComputedStyle(el).backgroundColor); }
try {
  await page.addInitScript(() => { localStorage.setItem('aureli-mode', 'live'); localStorage.removeItem('aureli-api-base'); });
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173'); await card('qa').waitFor();
  await open(); assert.equal(await panel.getByRole('button', { name: /清除 0/ }).isDisabled(), true);
  await create('研究', '#E8F2FF');
  assert.ok(await dialog.evaluate(el => el.getBoundingClientRect().width <= 440), 'label dialog stays compact');
  assert.equal(await panel.locator('fieldset').getByRole('button', { name: '新建标签', exact: true }).count(), 1);
  const row = panel.locator('.label-option-row').first();
  const alignment = await row.evaluate(el => {
    const centers = ['.label-choice-box', '.label-swatch', '.label-option-name', '.label-row-actions'].map(selector => {
      const bounds = el.querySelector(selector).getBoundingClientRect(); return bounds.y + bounds.height / 2;
    });
    return Math.max(...centers) - Math.min(...centers);
  });
  assert.ok(alignment < 1, 'selector, color, name and row actions share a vertical center');
  const research = panel.getByRole('radio', { name: '研究', exact: true });
  await research.click(); assert.equal(await research.isChecked(), false, 'clicking the selected label cancels it');
  assert.equal(await panel.getByRole('radio', { name: '清除标签', exact: true }).isChecked(), true);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.label-option-row .label-choice-box svg')).opacity === '0', null, { timeout: 5000 });
  async function toggleMotion() {
    return research.evaluate(async input => {
      input.click(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const box = input.nextElementSibling;
      return { checked: input.checked, animations: box.querySelector('svg').getAnimations().length,
        background: getComputedStyle(box, '::before').backgroundColor, radius: getComputedStyle(box).borderRadius,
        opacity: getComputedStyle(box.querySelector('svg')).opacity, duration: getComputedStyle(box.querySelector('svg')).transitionDuration, mode: document.documentElement.dataset.input };
    });
  }
  const enter = await toggleMotion(); assert.equal(enter.checked, true); assert.ok(enter.animations > 0, JSON.stringify(enter));
  assert.equal(enter.background, 'rgb(0, 102, 204)'); assert.equal(enter.radius, '5px');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.label-option-row .label-choice-box svg')).opacity === '1', null, { timeout: 5000 });
  const exit = await toggleMotion(); assert.equal(exit.checked, false); assert.ok(exit.animations > 0, JSON.stringify(exit));
  await research.evaluate(async input => { input.click(); input.click(); await Promise.resolve(); });
  assert.equal(await research.isChecked(), false, 'rapid repeated clicks settle on the latest state');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await research.click();
  assert.equal(await row.locator('.label-choice-box svg').evaluate(el => getComputedStyle(el).transform), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await dialog.screenshot({ path: '/tmp/aureli-label-compact-panel.png' });
  await close();
  for (const id of ['qa', 'note', 'file']) await card(id).getByRole('button', { name: '选择关联', exact: true }).click();
  await open(); await panel.getByRole('radio', { name: '研究', exact: true }).check();
  await panel.getByRole('button', { name: '应用到 3 个 Tile', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已设置 3 个' }).waitFor(); await close();
  await page.waitForFunction(() => [...document.querySelectorAll('.graph-node .node-main')].every(el => getComputedStyle(el).backgroundColor === 'rgb(232, 242, 255)'), null, { timeout: 5000 });
  for (const id of ['qa', 'note', 'file']) {
    assert.equal(await color(id), 'rgb(232, 242, 255)');
    assert.equal(await card(id).locator('.node-main').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(232, 242, 255)');
  }
  await page.locator('.graph-wrap').screenshot({ path: '/tmp/aureli-label-graph.png' });
  let exported;
  await page.evaluate(() => { window.labelExport = null; const create = URL.createObjectURL; URL.createObjectURL = blob => { if (blob.type === 'application/json') window.labelExport = blob; return create(blob); }; });
  await page.getByRole('button', { name: '导出图谱', exact: true }).click();
  exported = await page.evaluate(async () => JSON.parse(await window.labelExport.text()));
  assert.equal(exported.labels[0].name, '研究'); assert.ok(exported.tiles.every(tile => tile.labelId === 1));
  await open(); await panel.getByRole('button', { name: '编辑标签 研究', exact: true }).click();
  await panel.getByLabel('标签名称', { exact: true }).fill('重点'); await panel.getByLabel('颜色 HEX', { exact: true }).fill('#000000');
  failSave = true; await panel.getByRole('button', { name: '保存标签', exact: true }).click(); await panel.getByRole('alert').waitFor();
  assert.equal(await panel.getByLabel('标签名称', { exact: true }).inputValue(), '重点');
  failSave = false; await panel.getByRole('button', { name: '保存标签', exact: true }).click(); await panel.getByRole('radio', { name: '重点', exact: true }).waitFor(); await close();
  assert.equal(await color('qa'), 'rgb(0, 0, 0)');
  assert.equal(await card('qa').locator('.node-main strong').evaluate(el => getComputedStyle(el).color), 'rgb(255, 255, 255)');
  await selectView(page, "Tile 列表");
  assert.equal(await page.locator('.tile-list article.tile-label-surface').count(), 3);
  assert.equal(await page.locator('.tile-list article.chosen').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
  await selectView(page, "图谱视图");
  await page.getByRole('button', { name: '全页面查看图谱', exact: true }).click();
  assert.equal(await page.locator('.fullscreen-viewer .graph-node.tile-label-surface').count(), 3);
  await page.locator('.fullscreen-viewer').getByRole('button', { name: /退出全页面/ }).first().click();
  await open(); await panel.getByRole('radio', { name: '清除标签', exact: true }).check();
  failAssign = true; await panel.getByRole('button', { name: '清除 3 个 Tile 的标签', exact: true }).click(); await panel.getByRole('alert').waitFor();
  assert.equal(await color('qa'), 'rgb(0, 0, 0)'); failAssign = false;
  await panel.getByRole('button', { name: '清除 3 个 Tile 的标签', exact: true }).click(); await page.getByRole('status').filter({ hasText: '已清除 3' }).waitFor(); await close();
  assert.notEqual(await color('qa'), 'rgb(0, 0, 0)');
  // Mixed original labels and refresh persistence.
  graphs.a.tiles[0].labelId = 1; await page.reload(); await card('qa').waitFor(); assert.equal(await color('qa'), 'rgb(0, 0, 0)');
  for (const id of ['qa', 'note']) await card(id).getByRole('button', { name: '选择关联', exact: true }).click();
  await open(); assert.equal(await panel.getByRole('radio', { name: /多个标签/ }).isChecked(), true);
  await panel.getByRole('button', { name: '删除标签 重点', exact: true }).click();
  await panel.getByRole('button', { name: '保留标签', exact: true }).click(); assert.equal(graphs.a.labels.length, 1);
  await panel.getByRole('button', { name: '删除标签 重点', exact: true }).click();
  await panel.getByRole('button', { name: '确认删除标签', exact: true }).click(); await panel.getByText('当前图谱还没有标签，先创建一个。').waitFor(); await close();
  assert.equal(await page.locator('.graph-node').count(), 3); assert.equal(await page.locator('.graph-node.tile-label-surface').count(), 0);
  await page.locator('.map-list').getByRole('button', { name: '图谱 B', exact: true }).click(); await card('other').waitFor(); await open();
  assert.equal(await panel.getByRole('radio', { name: 'B 标签', exact: true }).count(), 1); assert.equal(await panel.getByRole('radio', { name: '重点', exact: true }).count(), 0);
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await create(`标签${width}`, '#DCFCE7');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false);
  }
  await dialog.screenshot({ path: '/tmp/aureli-label-panel.png' }); await close();
  assert.ok(writes.filter(w => w.path === 'assign').every(w => w.body.mapId === 'a'));
  const demoPage = await browser.newPage(); let demoWrites = 0;
  await demoPage.route('**/customer-service/**', async route => { demoWrites++; await route.abort(); });
  await demoPage.addInitScript(() => localStorage.setItem('aureli-mode', 'demo'));
  await demoPage.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await demoPage.getByRole('button', { name: '标签', exact: true }).click();
  const demoPanel = demoPage.locator('.label-panel');
  await demoPanel.getByRole('button', { name: '新建标签', exact: true }).click();
  await demoPanel.getByLabel('标签名称', { exact: true }).fill('示例标签');
  await demoPanel.getByRole('button', { name: '保存标签', exact: true }).click();
  await demoPanel.getByRole('radio', { name: '示例标签', exact: true }).waitFor();
  assert.equal(demoWrites, 0); await demoPage.close();
  assert.deepEqual(errors, []);
  console.log('PASS: label CRUD, bulk apply/clear, failures, mixed selection, QA/NOTE/FILE colors, list/fullscreen, persistence, map ownership, responsive layout');
} catch (failure) { console.log(await page.locator('.graph-node .node-main').evaluateAll(nodes => nodes.map(el => ({ color: getComputedStyle(el).backgroundColor, style: el.parentElement.getAttribute('style'), classes: el.parentElement.className })))); await page.screenshot({ path: '/tmp/aureli-label-failure.png', fullPage: true }); throw failure; } finally { await browser.close(); }
