import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], plans = [], decisions = [], completions = [];
page.on('pageerror', error => errors.push(error.message));
const questions = ['置换**流水车间调度**应如何建模并评价方案？', '已有`遗传算法`时，如何选择改进方向并验证效果？'];
let tiles = [{ id: 'source', message: '已有调度代码的约束', answer: '保留接口，先做基线测试。', relatedTileIds: [], status: 'ready', weight: 1 }], edges = [];
let mode = 'suggested', failExecution = false, delayedPlan, delayedExecution;
const storedPlans = new Map();
await page.route('**/customer-service/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/maps')) return route.fulfill({ json: { success: true, data: [{ mapId: 'map-a', name: '测试图谱' }] } });
  if (path.endsWith('/tile/workspace')) return route.fulfill({ json: { success: true, data: { tiles, edges } } });
  if (path.endsWith('/question/plan')) {
    const body = route.request().postDataJSON(); plans.push(body);
    if (mode === 'error') return route.fulfill({ status: 503, json: { success: false, errorCode: 'QUESTION_PLANNING_UNAVAILABLE', message: '暂时无法规划' } });
    if (mode === 'conflict') return route.fulfill({ status: 409, json: { success: false, errorCode: 'QUESTION_TILE_EXISTS', message: 'Tile ID 已存在' } });
    const planId = `plan-${plans.length}`;
    storedPlans.set(planId, body);
    const proposal = { suggested: mode !== 'simple', reason: '**建模和算法改进**可以独立研究。\n\n- 研究目标不同。\n- 合起来覆盖原问题。', questions: mode === 'simple' ? [] : questions, planId };
    if (mode === 'delayed') await new Promise(resolve => { delayedPlan = resolve; });
    return route.fulfill({ json: { success: true, data: proposal } }).catch(() => {});
  }
  if (path.endsWith('/question/decision')) {
    const decision = route.request().postDataJSON(); decisions.push(decision);
    if (decision.action !== 'EXECUTE') return route.fulfill({ json: { success: true, data: null } });
    if (failExecution) return route.fulfill({ status: 500, json: { success: false, message: '整组生成失败，请按原方案重试。' } });
    if (mode === 'delayed-execution') await new Promise(resolve => { delayedExecution = resolve; });
    const body = storedPlans.get(decision.planId);
    const resultTiles = [body.message, ...questions].map((message, index) => ({
      id: index === 0 ? body.tileId : `tile-divides-${decision.planId}-${index - 1}`,
      message, answer: `完整回答 ${index}`, relatedTileIds: index === 0 ? body.relatedTileIds : [body.tileId], status: 'ready', weight: 1, tileType: 'QA',
    }));
    const resultEdges = [...body.relatedTileIds.map(id => ({ id: `edge-${id}-${body.tileId}`, sourceTileId: id, targetTileId: body.tileId,
      direction: body.edgeDirection, relationType: body.relationType, weight: 1, description: body.edgeDescription })),
      ...questions.map((_, index) => ({ id: `edge-${decision.planId}-${index}`, sourceTileId: body.tileId,
        targetTileId: resultTiles[index + 1].id, direction: 'DIRECTED', relationType: 'DIVIDES', weight: 1 }))];
    tiles.push(...resultTiles); edges.push(...resultEdges);
    return route.fulfill({ json: { success: true, data: { tiles: resultTiles, edges: resultEdges } } });
  }
  if (path.endsWith('/completion')) {
    const body = route.request().postDataJSON(); completions.push(body);
    tiles.push({ id: body.tileId, message: body.message, answer: '原问题完整回答', relatedTileIds: body.relatedTileIds, status: 'ready', weight: 1 });
    return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"v":"原问题完整回答"}\n\ndata: {"done":true}\n\n' });
  }
  return route.fulfill({ json: { success: true } });
});
const dialog = page.locator('dialog[aria-labelledby="workspace-modal-title"]');
let sequence = 0;
async function draft() {
  if (!await dialog.isVisible()) await page.getByRole('button', { name: '打开添加Tile弹窗', exact: true }).click();
  await dialog.getByLabel('提问内容').fill('**加工调度问题**如何建模？\n\n1. 比较常见方法。\n2. 优先改进`遗传算法`。\n\n<script>window.planExecuted = true</script>');
  const id = `question-${++sequence}`;
  await dialog.getByLabel('当前 Tile ID').fill(id);
  await dialog.locator('#dialog-question-form-direction').selectOption('UNDIRECTED');
  await dialog.getByLabel('关系备注', { exact: false }).fill('保留已有接口');
  await dialog.locator('summary', { hasText: '选择已有节点' }).click();
  const source = dialog.getByRole('checkbox', { name: /已有调度代码的约束/ });
  if (!await source.isChecked()) await source.check();
  return id;
}
async function submit() {
  await dialog.getByRole('button', { name: '发送并生成 Tile', exact: true }).click();
  await dialog.getByRole('heading', { name: 'AI 建议拆分问题' }).waitFor();
}
async function closed() { await page.waitForFunction(() => !document.querySelector('dialog[aria-labelledby="workspace-modal-title"]').open); }
try {
  await page.addInitScript(() => localStorage.setItem('aureli-mode', 'live'));
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await page.locator('.graph-node').first().waitFor();
  for (const cancel of ['取消', '关闭对话框', 'Escape']) {
    const id = await draft(); await submit();
    assert.deepEqual((await dialog.locator('.question-plan-list > li').allTextContents()).map(text => text.trim()),
      questions.map(question => question.replaceAll('**', '').replaceAll('`', '')));
    assert.equal(await dialog.locator('.question-plan-original strong').innerText(), '加工调度问题');
    assert.equal(await dialog.locator('.question-plan-original ol li').count(), 2);
    assert.equal(await dialog.locator('.question-plan-reason strong').innerText(), '建模和算法改进');
    assert.equal(await dialog.locator('.question-plan-reason ul li').count(), 2);
    assert.equal(await dialog.locator('.question-plan-list strong').innerText(), '流水车间调度');
    assert.equal(await dialog.locator('.question-plan-list code').innerText(), '遗传算法');
    assert.equal(await dialog.locator('.question-plan-original script').count(), 0);
    assert.equal(await page.evaluate(() => !!window.planExecuted), false);
    assert.equal(await dialog.getByRole('heading', { name: '拆分理由', exact: true }).count(), 1);
    assert.notEqual(await dialog.locator('.question-plan-original').evaluate(el => getComputedStyle(el).backgroundColor),
      await dialog.locator('.question-plan-reason').evaluate(el => getComputedStyle(el).backgroundColor));
    assert.match(await dialog.innerText(), /1 个原始问答 Tile 和 2 个子问答 Tile/);
    assert.equal(await page.locator('.graph-node').count(), 1, 'planning creates no placeholder Tile');
    assert.equal(completions.length, 0);
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: cancel, exact: true }).click();
    await dialog.getByRole('heading', { name: '添加Tile', exact: true }).waitFor();
    assert.equal(await dialog.getByLabel('当前 Tile ID').inputValue(), id);
    assert.equal(await dialog.getByLabel('提问内容').inputValue(), plans.at(-1).message);
    assert.equal(await dialog.locator('#dialog-question-form-direction').inputValue(), 'UNDIRECTED');
    assert.equal(await dialog.getByLabel('关系备注', { exact: false }).inputValue(), '保留已有接口');
    assert.equal(await dialog.getByRole('button', { name: '移除关联 source' }).count(), 1);
    assert.equal(await page.locator('.graph-node').count(), 1);
  }
  assert.equal(decisions.filter(value => value.action === 'EXECUTE').length, 0);

  // Cancelling an in-flight plan must never resume the old submission.
  mode = 'delayed'; await draft();
  const beforeCompletion = completions.length;
  await dialog.getByRole('button', { name: '发送并生成 Tile', exact: true }).click();
  await closed();
  assert.equal(await page.getByRole('heading', { name: '正在分析问题' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '正在提交…', exact: true }).isDisabled(), true);
  while (!delayedPlan) await new Promise(resolve => setTimeout(resolve, 10));
  await page.getByRole('button', { name: '取消提问', exact: true }).click();
  await dialog.getByRole('heading', { name: '添加Tile', exact: true }).waitFor();
  delayedPlan();
  mode = 'suggested';
  await page.waitForTimeout(100);
  assert.equal(await dialog.getByRole('heading', { name: '添加Tile', exact: true }).count(), 1);
  assert.equal(await page.locator('.graph-node').count(), 1);
  assert.equal(completions.length, beforeCompletion);

  const declineId = await draft(); await submit();
  const planCount = plans.length;
  await dialog.getByRole('button', { name: '不执行拆分', exact: true }).click();
  await closed();
  await page.locator('.status-text', { hasText: '回答已完成' }).waitFor();
  assert.equal(completions.at(-1).tileId, declineId);
  assert.equal(plans.length, planCount, 'declining does not suggest again');
  assert.equal(await page.locator('.graph-node').count(), 2);

  mode = 'simple'; const simpleId = await draft();
  await dialog.getByRole('button', { name: '发送并生成 Tile', exact: true }).click();
  await closed(); await page.locator('.status-text', { hasText: '回答已完成' }).waitFor();
  assert.equal(completions.at(-1).tileId, simpleId);
  assert.equal(await page.locator('.graph-node').count(), 3);

  mode = 'error'; const fallbackId = await draft();
  await dialog.getByRole('button', { name: '发送并生成 Tile', exact: true }).click();
  await closed(); await page.locator('.status-text', { hasText: '回答已完成' }).waitFor();
  assert.equal(completions.at(-1).tileId, fallbackId);
  assert.equal(await page.locator('.graph-node').count(), 4);

  mode = 'conflict'; await draft(); const completionCount = completions.length;
  await dialog.getByRole('button', { name: '发送并生成 Tile', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert.match(await dialog.getByRole('alert').innerText(), /Tile ID 已存在/);
  assert.equal(completions.length, completionCount, 'validation conflicts must not fall back to generation');
  assert.equal(await page.locator('.graph-node').count(), 4);

  mode = 'suggested'; const approvedId = await draft(); await submit();
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await dialog.getByRole('button', { name: '执行拆分', exact: true }).isVisible(), true);
  }
  await dialog.screenshot({ path: new URL('../artifacts/question-plan-preview.png', import.meta.url).pathname });
  failExecution = true;
  await dialog.getByRole('button', { name: '执行拆分', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(await page.locator('.graph-node').count(), 4, 'failed execution adds no partial group');
  const failedPlan = decisions.at(-1).planId;
  failExecution = false; mode = 'delayed-execution';
  await dialog.getByRole('button', { name: '执行拆分', exact: true }).click();
  await dialog.getByRole('status').waitFor();
  assert.equal(await dialog.getByRole('button', { name: '取消', exact: true }).isDisabled(), true);
  assert.equal(await dialog.getByRole('button', { name: '不执行拆分', exact: true }).isDisabled(), true);
  assert.equal(await dialog.getByRole('button', { name: '执行拆分', exact: true }).isDisabled(), true);
  while (!delayedExecution) await new Promise(resolve => setTimeout(resolve, 10));
  delayedExecution();
  await closed();
  assert.equal(decisions.at(-1).planId, failedPlan, 'retry uses the reviewed plan');
  assert.equal(plans.length, planCount + 4, 'execution and retry do not replan');
  assert.equal(await page.locator('.graph-node').count(), 7);
  assert.deepEqual(tiles.filter(tile => tile.relatedTileIds.includes(approvedId)).map(tile => tile.message), questions);
  assert.deepEqual((await page.locator('.graph-wrap svg.edges text').allTextContents()).filter(text => text.trim() === 'DIVIDES'), ['DIVIDES', 'DIVIDES']);
  await page.reload(); await page.locator('.graph-node').first().waitFor();
  assert.equal(await page.locator('.graph-node').count(), 7);
  assert.equal(await page.getByRole('button', { name: '拆分选中的 AI 问答 Tile', exact: true }).isDisabled(), true);
  mode = 'suggested';
  await page.getByRole('button', { name: '添加Tile', exact: true }).click();
  await page.locator('#inspector-question-form-message').fill('侧栏提出的复合问题');
  await page.locator('#inspector-question-form-tile-id').fill('sidebar-cancel');
  await page.locator('#inspector-question-form').getByRole('button', { name: '发送并生成 Tile', exact: true }).click();
  await dialog.getByRole('heading', { name: 'AI 建议拆分问题' }).waitFor();
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); await closed();
  assert.equal(await page.locator('#inspector-question-form-message').inputValue(), '侧栏提出的复合问题');
  assert.equal(await page.locator('#inspector-question-form-tile-id').inputValue(), 'sidebar-cancel');
  assert.equal(await page.locator('.graph-node').count(), 7);
  // A fresh local example creates the same structure without contacting the service.
  const demoPage = await browser.newPage({ viewport: { width: 375, height: 900 } });
  const demoCalls = [];
  await demoPage.addInitScript(() => localStorage.setItem('aureli-mode', 'demo'));
  await demoPage.route('**/customer-service/**', route => { demoCalls.push(route.request().url()); return route.abort(); });
  await demoPage.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await demoPage.locator('.graph-node').first().waitFor();
  const demoCount = await demoPage.locator('.graph-node').count();
  await demoPage.getByRole('button', { name: '打开添加Tile弹窗', exact: true }).click();
  const demoDialog = demoPage.locator('dialog[aria-labelledby="workspace-modal-title"]');
  await demoDialog.getByLabel('提问内容').fill('研究目标用户的需求；制定可实施的方案');
  await demoDialog.getByRole('button', { name: '生成示例 Tile', exact: true }).click();
  await demoDialog.getByRole('heading', { name: 'AI 建议拆分问题' }).waitFor();
  await demoDialog.getByRole('button', { name: '执行拆分', exact: true }).click();
  await demoPage.waitForFunction(() => !document.querySelector('dialog[aria-labelledby="workspace-modal-title"]').open);
  assert.equal(await demoPage.locator('.graph-node').count(), demoCount + 3);
  assert.deepEqual(demoCalls, []);
  await demoPage.close();
  assert.deepEqual(errors, []);
  console.log('PASS: no planning modal, Markdown and distinct sections, cancel/close/Escape preserve drafts and zero Tiles, late inline cancellation, decline one Tile, simple/fallback, conflict rejection, exact plan execution, atomic failure/retry, busy protection, DIVIDES, refresh, responsive dialog and local demo');
} finally { await browser.close(); }
