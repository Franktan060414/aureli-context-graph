import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const settings = {
  chat: { provider: 'local', baseUrl: 'http://127.0.0.1:11434/v1', model: 'saved-chat', keyConfigured: true },
  embedding: { provider: 'local', baseUrl: 'http://127.0.0.1:11434/v1', model: 'saved-embedding', keyConfigured: true },
  dimensions: 1536,
};
let releaseLoad, releaseSave, releaseTest, savedPayload;
await page.route('**/customer-service/maps', route => route.fulfill({ json: { success: true, data: [] } }));
await page.route('**/customer-service/md/list', route => route.fulfill({ json: { success: true, data: [], total: 0 } }));
await page.route('**/customer-service/model-settings', async route => {
  if (route.request().method() === 'POST') {
    savedPayload = route.request().postDataJSON();
    await new Promise(resolve => { releaseSave = resolve; });
    Object.assign(settings.chat, { model: savedPayload.chat.model });
  } else if (!releaseLoad) {
    await new Promise(resolve => { releaseLoad = resolve; });
  }
  await route.fulfill({ json: { success: true, data: settings } });
});
await page.route('**/customer-service/model-settings/test', async route => {
  await new Promise(resolve => { releaseTest = resolve; });
  await route.fulfill({ json: { success: true, data: { model: settings.chat.model, reply: '测试成功' } } });
});
try {
  await page.addInitScript(() => localStorage.setItem('aureli-mode', 'live'));
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await page.getByRole('heading', { name: '创建你的第一张图谱' }).waitFor();
  await page.getByRole('link', { name: '服务设置', exact: true }).click();
  await page.getByRole('button', { name: '读取中…', exact: true }).waitFor();
  assert.equal(await page.locator('#chat-model').isDisabled(), true, 'configuration load locks fields temporarily');
  await new Promise(resolve => setImmediate(resolve));
  releaseLoad();
  await page.waitForFunction(() => document.querySelector('#chat-model')?.value === 'saved-chat');
  assert.equal(await page.locator('#chat-model').isEnabled(), true, 'no map must not lock service settings');
  assert.equal(await page.getByRole('button', { name: '保存并应用', exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole('button', { name: '测试链接', exact: true }).isEnabled(), true);
  await page.locator('#chat-model').fill('changed-chat');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.getByRole('button', { name: '保存中…', exact: true }).waitFor();
  assert.equal(await page.locator('#chat-model').isDisabled(), true);
  assert.equal(savedPayload.chat.model, 'changed-chat');
  releaseSave();
  await page.waitForFunction(() => !document.querySelector('#chat-model')?.disabled && !document.querySelector('fieldset')?.disabled);
  await page.getByRole('button', { name: '测试链接', exact: true }).click();
  await page.locator('.test-connection').filter({ hasText: '测试中…' }).waitFor();
  assert.equal(await page.locator('#chat-model').isDisabled(), true);
  releaseTest();
  await page.locator('.config-test-result').waitFor();
  assert.equal(await page.locator('#chat-model').isEnabled(), true);
  await page.screenshot({ path: process.env.UI_TEST_SCREENSHOT || '/tmp/aureli-empty-workspace-settings.png', fullPage: true });

  assert.equal(await page.getByRole('link', { name: '知识库管理', exact: true }).count(), 0);
  await page.getByRole('button', { name: '知识库配置', exact: true }).click();
  await page.getByRole('heading', { name: '知识库配置', exact: true }).waitFor();
  await page.getByRole('heading', { name: '知识库还没有文档', exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, '#settings/knowledge');
  assert.equal(await page.getByRole('link', { name: '服务设置', exact: true }).getAttribute('aria-current'), 'page');
  assert.equal(await page.getByRole('button', { name: '知识库配置', exact: true }).getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('.mode-banner').count(), 0);
  await page.reload();
  await page.getByRole('heading', { name: '知识库还没有文档', exact: true }).waitFor();
  await page.goto(new URL('#knowledge', page.url()).href);
  await page.waitForURL(/#settings\/knowledge$/);
  await page.getByRole('heading', { name: '知识库配置', exact: true }).waitFor();
  await page.getByRole('button', { name: '工作台设置', exact: true }).click();
  await page.getByRole('button', { name: '知识库配置', exact: true }).click();
  await page.getByRole('heading', { name: '知识库还没有文档', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: empty workspace permits settings save/test; nested knowledge configuration loads, refreshes, and supports legacy links');
} finally { await browser.close(); }
