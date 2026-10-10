import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
page.setDefaultTimeout(12000);
const errors = [], writes = [];
page.on('pageerror', e => errors.push(e.message));
const labels = [{ id: 1, name: '用户研究', colorHex: '#E8F2FF' }, { id: 2, name: '方案设计', colorHex: '#DCFCE7' }];
const node = (id, labelId, parents = [], weight = 1) => ({ id, labelId, relatedTileIds: parents, weight, tileType: 'QA', kind: parents.length ? 'memory' : 'root', status: 'ready', message: `${id} 的研究问题`, answer: '这里保留 Tile 的完整内容与标签，自由移动不会修改知识归属。' });
const tiles = [node('a1', 1), node('a2', 1, ['a1']), node('a3', 1, ['a1']), node('a4', 1, ['a3'], 2), node('b1', 2, ['a2']), node('b2', 2, ['b1', 'a4']), node('u1', null)];
const edges = tiles.flatMap(t => t.relatedTileIds.map(p => ({ id: `${p}-${t.id}`, sourceTileId: p, targetTileId: t.id, direction: 'DIRECTED', relationType: 'EXTENDS' })));
const graphData = { tiles, edges, labels };
const maps = [{ mapId: 'a', name: '研究图谱', zoom: 1 }, { mapId: 'b', name: '独立图谱', zoom: 1 }];
await page.addInitScript(() => { localStorage.setItem('aureli-mode', 'live'); });
await page.route('**/customer-service/**', async route => {
  const req = route.request(), url = new URL(req.url());
  if (req.method() !== 'GET' && !url.pathname.endsWith('/zoom')) writes.push(url.pathname);
  if (url.pathname.endsWith('/zoom')) { maps.find(m => m.mapId === url.pathname.split('/').at(-2)).zoom = req.postDataJSON().zoom; return route.fulfill({ json: { success: true } }); }
  const data = url.pathname.endsWith('/maps') ? maps : url.pathname.endsWith('/tile/workspace') ? graphData : {};
  return route.fulfill({ json: { success: true, data } });
});
const graph = () => page.locator('.graph-workbench .graph-wrap');
const card = (g, id) => g.locator('.graph-node').filter({ has: page.locator('.node-top .mono', { hasText: new RegExp(`^${id}$`) }) });
const coords = g => g.locator('.graph-node').evaluateAll(es => Object.fromEntries(es.map(e => [e.querySelector('.node-top .mono').textContent, { x: parseFloat(e.style.left), y: parseFloat(e.style.top) }])));
async function open(g) { await g.getByRole('button', { name: '一键整理画布', exact: true }).click(); const d = g.getByRole('dialog', { name: '整理画布', exact: true }); await d.waitFor(); return d; }
async function arrange(g, mode) { const d = await open(g); await d.getByRole('radio', { name: mode, exact: true }).check(); await d.getByRole('button', { name: '开始整理', exact: true }).click(); await d.waitFor({ state: 'hidden' }).catch(async error => { console.log('Layout dialog:', await d.textContent()); console.log('Browser errors:', errors); throw error; }); }
try {
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await graph().locator('.graph-node').last().waitFor();
  const initial = await coords(graph());
  const choose = await open(graph());
  await choose.getByRole('radio', { name: 'Layered 排列', exact: true }).check();
  await page.screenshot({ path: 'frontend/artifacts/canvas-layout-choices.png' });
  await page.keyboard.press('Escape');
  assert.deepEqual(await coords(graph()), initial, 'changing a radio and cancelling must not move nodes');
  await arrange(graph(), 'Layered 排列');
  const arranged = await coords(graph());
  assert.notDeepEqual(arranged, initial);
  assert.equal(await graph().locator('.graph-label-region').count(), 2);
  const paths = await graph().locator('.edges g > path').evaluateAll(es => es.map(e => e.getAttribute('d')));
  assert.equal(paths.length, edges.length);
  assert.ok(paths.every(path => path.startsWith('M') && !path.includes('NaN')));
  assert.ok(await graph().getByRole('button', { name: '一键整理画布', exact: true }).evaluate(e => e === document.activeElement), 'focus returns after asynchronous layout');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aureli-canvas-arrangements')));
  const mapA = Object.keys(saved).find(k => k.endsWith(':a'));
  assert.equal(saved[mapA].mode, 'layered');
  assert.equal(Object.keys(saved[mapA].routes).length, edges.length);
  await page.reload(); await graph().locator('.graph-node').last().waitFor();
  assert.deepEqual(await coords(graph()), arranged);
  const restored = await open(graph());
  assert.ok(await restored.getByRole('radio', { name: 'Layered 排列', exact: true }).isChecked());
  await restored.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.map-list').getByRole('button', { name: '独立图谱', exact: true }).click();
  await graph().locator('.graph-node').last().waitFor();
  const separate = await open(graph());
  assert.ok(await separate.getByRole('radio', { name: '树状排列', exact: true }).isChecked());
  await separate.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.map-list').getByRole('button', { name: '研究图谱', exact: true }).click();
  await graph().locator('.graph-node').last().waitFor();
  assert.deepEqual(await coords(graph()), arranged);

  await page.getByRole('button', { name: '全页面查看图谱', exact: true }).click();
  const viewer = page.locator('.fullscreen-viewer'), full = viewer.locator('.graph-wrap');
  assert.deepEqual(await coords(full), arranged);
  const fullChoices = await open(full);
  assert.ok(await fullChoices.getByRole('radio', { name: 'Layered 排列', exact: true }).isChecked());
  await page.keyboard.press('Escape');
  assert.ok(await viewer.isVisible());
  await page.keyboard.press('Escape');
  await viewer.waitFor({ state: 'hidden' });

  // Use Aureli's keyboard movement to detach a card well beyond the group.
  const main = card(graph(), 'a4').locator('.node-main');
  await main.focus();
  for (let i = 0; i < 28; i++) await page.keyboard.press('Alt+Shift+ArrowDown');
  const moved = await coords(graph());
  assert.ok(moved.a4.y >= arranged.a4.y + 1100);
  for (const id of Object.keys(arranged).filter(id => id !== 'a4')) assert.deepEqual(moved[id], arranged[id]);
  const research = graph().locator('.graph-label-region').filter({ hasText: '用户研究' });
  assert.equal(await research.count(), 1);
  assert.match(await research.textContent(), /3 张.*共 4 张/);
  assert.ok(await research.evaluate(e => parseFloat(e.style.height) < 1200), 'frame does not stretch to include outlier');
  await graph().getByRole('group', { name: '聚焦标签', exact: true }).getByRole('button', { name: '用户研究', exact: true }).click();
  assert.equal(await graph().locator('.graph-node.label-focused').count(), 4, 'outlier remains included in tag focus');
  assert.equal(await graph().locator('.graph-node.label-dimmed').count(), 3);
  await graph().getByRole('button', { name: '清除标签聚焦', exact: true }).click();
  for (let i = 0; i < 28; i++) { await main.focus(); await page.keyboard.press('Alt+Shift+ArrowUp'); }
  assert.deepEqual((await coords(graph())).a4, arranged.a4);
  assert.match(await research.textContent(), /4 张/);

  // Real pointer dragging at a known readable zoom, with no parent constraints.
  await page.getByRole('button', { name: '全页面查看图谱', exact: true }).click();
  await card(full, 'a1').locator('.node-main').click();
  const beforeDrag = await coords(full), bounds = await card(full, 'a1').locator('.node-main').boundingBox();
  await page.mouse.move(bounds.x + 24, bounds.y + 50); await page.mouse.down();
  await page.mouse.move(bounds.x + 95, bounds.y + 130, { steps: 10 }); await page.mouse.up();
  const afterDrag = await coords(full);
  assert.notDeepEqual(afterDrag.a1, beforeDrag.a1);
  for (const id of Object.keys(beforeDrag).filter(id => id !== 'a1')) assert.deepEqual(afterDrag[id], beforeDrag[id]);
  await viewer.locator('.fullscreen-header .secondary').click();
  assert.deepEqual(await coords(graph()), afterDrag);
  await page.reload(); await graph().locator('.graph-node').last().waitFor();
  assert.deepEqual(await coords(graph()), afterDrag, 'manual positions survive refresh after Layered layout');

  await arrange(graph(), '树状排列');
  assert.ok(await graph().locator('.graph-label-region').count() > 0, 'tag frames also work in tree mode');
  const beforeFailure = await coords(graph());
  await page.route('**/elk-worker.min*', route => route.abort());
  const failed = await open(graph());
  await failed.getByRole('radio', { name: 'Layered 排列', exact: true }).check();
  await failed.getByRole('button', { name: '开始整理', exact: true }).click();
  await failed.getByRole('alert').waitFor();
  assert.deepEqual(await coords(graph()), beforeFailure);
  await failed.getByRole('button', { name: '取消', exact: true }).click();
  await page.unroute('**/elk-worker.min*');

  // A cancelled worker load cannot later replace the user's positions.
  let releaseWorker;
  await page.route('**/elk-worker.min*', async route => {
    await new Promise(resolve => { releaseWorker = resolve; });
    await route.continue().catch(() => {});
  });
  const cancelled = await open(graph());
  await cancelled.getByRole('radio', { name: 'Layered 排列', exact: true }).check();
  await cancelled.getByRole('button', { name: '开始整理', exact: true }).click();
  for (let i = 0; i < 100 && !releaseWorker; i++) await page.waitForTimeout(20);
  assert.ok(releaseWorker);
  assert.ok(await cancelled.getByRole('button', { name: '整理中…', exact: true }).isDisabled());
  await cancelled.getByRole('button', { name: '取消', exact: true }).click();
  releaseWorker(); await page.unroute('**/elk-worker.min*');
  assert.deepEqual(await coords(graph()), beforeFailure);

  await page.setViewportSize({ width: 375, height: 900 });
  const mobile = await open(graph());
  const dimensions = await mobile.boundingBox(); assert.ok(dimensions.width <= 343);
  await mobile.getByRole('radio', { name: 'Layered 排列', exact: true }).check();
  await page.screenshot({ path: 'frontend/artifacts/canvas-layout-choices-mobile.png' });
  await mobile.getByRole('button', { name: '开始整理', exact: true }).click();
  await mobile.waitFor({ state: 'hidden' }).catch(async error => { console.log('Mobile dialog:', await mobile.textContent()); console.log('Browser errors:', errors); throw error; });
  assert.equal(await graph().locator('.graph-label-region').count(), 2);
  assert.equal(await graph().getByRole('group', { name: '聚焦标签', exact: true }).count(), 1);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByRole('button', { name: '全页面查看图谱', exact: true }).click();
  await full.getByRole('button', { name: '适应画布', exact: true }).click();
  await page.screenshot({ path: 'frontend/artifacts/canvas-layered-fullscreen.png' });
  assert.deepEqual(writes, [], 'layout and dragging never modify Tile, tag or relationship data');
  assert.deepEqual(errors, []);
  console.log('PASS: Layered worker, choices/cancel, saved modes/routes, per-map isolation, fullscreen, pointer/keyboard dragging, detach/rejoin, focus of scattered tags, retryable worker failure and mobile.');
} finally { await browser.close(); }
