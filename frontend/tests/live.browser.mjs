import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const stateFile = '/tmp/aureli-studio-integration.json';
const state = JSON.parse(await readFile(stateFile, 'utf8'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  assert.equal(await page.getByRole('button', { name: '进入工作区', exact: true }).count(), 0, 'default mode connects to the real backend');
  await page.locator(`.graph-node button[aria-label^="查看 ${state.tileIds[1]}："]`).waitFor();
  await page.locator(`.graph-node button[aria-label^="查看 ${state.tileIds[1]}："]`).click();
  assert.match(await page.locator('.answer-text').innerText(), /苍蓝2048/);
  const uiId = `${state.prefix}-ui`;
  if (await page.locator(`.graph-node button[aria-label^="查看 ${uiId}："]`).count() === 0) {
    for (const id of state.tileIds.slice(0,2)) {
      await page.locator(`.graph-node:has(button[aria-label^="查看 ${id}："])`).getByRole('button', { name: '选择关联', exact: true }).click();
    }
    await page.getByRole('button', { name: '添加Tile', exact: true }).click();
    if (!state.tileIds.includes(uiId)) state.tileIds.push(uiId);
    await writeFile(stateFile, JSON.stringify(state));
    await page.getByLabel('提问内容').fill('本次关联 Tile 中的项目代号是什么？只回复代号。');
    await page.getByLabel('当前 Tile ID').fill(uiId);
    await page.getByRole('button', { name: '发送并生成 Tile', exact: true }).click();
    await page.locator('.status-text', { hasText: '回答已完成' }).waitFor({ timeout: 180000 });
    assert.match(await page.locator('.answer-text').innerText(), /苍蓝\s*2048/);
  }
  await page.reload();
  await page.locator(`.graph-node button[aria-label^="查看 ${uiId}："]`).waitFor();
  await page.locator(`.graph-node button[aria-label^="查看 ${uiId}："]`).click();
  assert.match(await page.locator('.answer-text').innerText(), /苍蓝\s*2048/);
  const snapshot = await (await page.request.get(new URL('/customer-service/tile/workspace', page.url()).href)).json();
  assert.equal(snapshot.data.edges.filter(edge => edge.targetTileId === uiId).length, 2, 'both UI-selected sources persisted');
  await page.getByRole('link', { name: '服务设置', exact: true }).click();
  await page.waitForSelector('#chat-model:not(:disabled)');
  assert.equal(await page.locator('#chat-model').inputValue(), 'llama3:latest');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.getByText('配置已保存，后续请求使用新模型。', { exact: true }).waitFor();
  await page.getByRole('link', { name: '知识库管理', exact: true }).click();
  const baseline = await page.request.post(new URL('/customer-service/md/list', page.url()).href, { data: { current: 1, size: 10 } });
  const listed = await baseline.json();
  assert.equal(listed.success, true);
  if (listed.data.length) await page.locator('.file-name strong', { hasText: listed.data[0].originalFileName }).waitFor();
  else await page.getByRole('heading', { name: '知识库还没有文档' }).waitFor();

  const uploadName = `${state.prefix}-browser.md`;
  await page.locator('input[type=file]').setInputFiles({ name: uploadName, mimeType: 'text/markdown', buffer: Buffer.from(`# Browser integration ${state.prefix}\n\nThis document belongs only to the current integration test.`) });
  await page.getByRole('button', { name: '上传到知识库', exact: true }).click();
  const row = page.locator('tbody tr', { hasText: uploadName });
  await row.waitFor();
  const ownId = Number((await row.locator('.file-name small').innerText()).replace('ID ', ''));
  state.fileId = ownId; state.fileIds ??= []; state.fileIds.push(ownId); await writeFile(stateFile, JSON.stringify(state));
  // Processing status updates in the page automatically, with no manual refresh.
  await row.getByText('已完成', { exact: true }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: `编辑 ${uploadName} 备注`, exact: true }).click();
  await page.getByLabel('备注', { exact: true }).fill('浏览器真实接口联调备注');
  await page.getByRole('button', { name: '保存备注', exact: true }).click();
  await row.getByText('浏览器真实接口联调备注', { exact: true }).waitFor();
  await page.getByRole('button', { name: `删除 ${uploadName}`, exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await row.waitFor({ state: 'detached' });
  state.fileId = null; await writeFile(stateFile, JSON.stringify(state));
  assert.equal(await page.locator('.inline-error').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: real UI/proxy streaming, persisted answers after reload, actual settings read/save, actual knowledge upload/status/update/delete');
} finally { await browser.close(); }
