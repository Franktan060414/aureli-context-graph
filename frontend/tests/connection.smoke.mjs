import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
let unavailable = true, listCalls = 0;
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/customer-service/**', async route => {
  if (new URL(route.request().url()).pathname.endsWith('/maps')) return route.fulfill({ json: { success: true, data: [{ mapId: 'default', name: '默认图谱' }] } });
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/tile/workspace')) {
    if (unavailable) return route.abort('connectionrefused');
    return route.fulfill({ json: { success: true, data: { tiles: [{ id: 'stored-tile', message: '数据库中的问题', answer: '数据库中的完整回答', relatedTileIds: [], status: 'ready', kind: 'root' }], edges: [] } } });
  }
  if (path.endsWith('/md/list')) {
    listCalls++;
    return route.fulfill({ json: { success: true, data: [{ id: 1, originalFileName: 'pending.md', status: listCalls === 1 ? 1 : 2, fileSize: '1 KB' }], total: 1 } });
  }
  if (path.endsWith('/completion')) return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"v":"未保存的部分回答"}\n\ndata: {"error":"模型连接不可用"}\n\n' });
  return route.fulfill({ json: { success: true } });
});
try {
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await page.locator('.inline-error', { hasText: '无法连接服务，请确认后端已启动及服务地址正确。' }).waitFor();
  assert.equal(await page.locator('.graph-node').count(), 0, 'offline mode must not inject demonstration nodes');
  assert.equal(await page.getByRole('button', { name: '进入工作区', exact: true }).count(), 0);
  unavailable = false;
  await page.getByRole('button', { name: '重新同步', exact: true }).click();
  await page.getByRole('button', { name: '查看 stored-tile：数据库中的问题', exact: true }).click();
  assert.equal(await page.locator('.answer-text').innerText(), '数据库中的完整回答');
  await page.getByRole('link', { name: '知识库管理', exact: true }).click();
  await page.locator('.status-pill', { hasText: '向量化中' }).waitFor();
  await page.locator('.status-pill', { hasText: '已完成' }).waitFor({ timeout: 7000 });
  assert.equal(listCalls, 2, 'processing status refreshes without a manual click');
  await page.getByRole('link', { name: /^图谱工作台/ }).click();
  await page.waitForTimeout(2200);
  assert.equal(listCalls, 2, 'completed/background lists must stop polling');
  await page.getByRole('button', { name: '添加Tile', exact: true }).click();
  await page.getByLabel('提问内容').fill('验证失败流');
  await page.getByRole('button', { name: '发送并生成 Tile', exact: true }).click();
  await page.locator('.status-text', { hasText: '生成失败' }).waitFor();
  assert.equal(await page.locator('.inline-error', { hasText: '模型连接不可用' }).count(), 1);
  assert.equal(await page.locator('.status-text', { hasText: '回答已完成' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: live default, offline recovery, no fake data fallback, persisted answers, automatic vectorization status, stopped polling, failed stream remains failed');
} finally { await browser.close(); }
