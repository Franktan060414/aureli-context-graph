import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], saved = [];
page.on('pageerror', error => errors.push(error.message));
let settings = { enabled: false, mcpUrl: 'https://mcp.tavily.com/mcp/', keyConfigured: false };
let testFailure = false, testGate = null, releaseTest;
await page.route('**/customer-service/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  let data = [];
  if (path.endsWith('/tavily-settings/test')) {
    if (testGate) await testGate;
    if (testFailure) {
      await route.fulfill({ status: 502, json: { success: false, message: 'Tavily MCP 连接失败，请检查配置。' } });
      return;
    }
    data = 'Tavily MCP 连接成功，搜索工具可用。';
  }
  else if (path.endsWith('/tavily-settings')) {
    if (request.method() === 'POST') {
      const value = request.postDataJSON(); saved.push(value);
      settings = { enabled: value.enabled, mcpUrl: value.mcpUrl, keyConfigured: settings.keyConfigured || Boolean(value.apiKey) };
    }
    data = settings;
  } else if (path.endsWith('/model-settings')) data = {
    chat: { provider: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', model: 'fixture', keyConfigured: true },
    embedding: { provider: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', model: 'fixture', keyConfigured: true }, dimensions: 1536,
  };
  await route.fulfill({ json: { success: true, data, total: 0 } });
});
try {
  await page.addInitScript(() => localStorage.setItem('aureli-mode', 'live'));
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5174');
  await page.getByRole('link', { name: '服务设置', exact: true }).click();
  const section = page.getByRole('region', { name: '联网搜索 · Tavily MCP', exact: true });
  const toggle = page.getByRole('switch', { name: /启用联网搜索/ });
  const testButton = section.getByRole('button', { name: /^测试联网连接/ });
  await page.locator('#tavily-enabled:enabled').waitFor();
  assert.ok(await section.locator('.tavily-logo').evaluate(img => img.complete && img.naturalWidth > 0), 'official logo loads locally');
  assert.equal(await toggle.isChecked(), false);
  const serviceAddress = page.locator('#project-service-url');
  const originalAddress = await serviceAddress.inputValue();
  await serviceAddress.fill('http://127.0.0.1:9999');
  assert.equal(await toggle.isDisabled(), true, 'unsaved service address cannot send credentials to the old backend');
  await serviceAddress.fill(originalAddress);
  assert.equal(await toggle.isEnabled(), true);
  assert.equal(await page.getByRole('button', { name: '测试联网连接', exact: true }).isDisabled(), true);
  await toggle.focus(); await page.keyboard.press('Space');
  assert.equal(await toggle.isChecked(), true, 'switch works from the keyboard');
  assert.equal(await section.locator('.label-choice-box svg').evaluate(el => getComputedStyle(el).opacity), '1', 'custom checkbox shows its check for keyboard input');
  assert.equal(await section.locator('.label-choice-box').evaluate(el => getComputedStyle(el).outlineStyle), 'solid', 'keyboard focus remains visible');
  await page.getByRole('button', { name: '保存联网配置', exact: true }).click();
  await section.getByRole('alert').waitFor();
  assert.match(await section.getByRole('alert').textContent(), /API Key/);
  assert.equal(saved.length, 0, 'missing key must not save an enabled tool');
  await page.locator('#tavily-api-key').fill('fixture-secret');
  await page.getByRole('button', { name: '保存联网配置', exact: true }).click();
  await section.getByRole('status').waitFor();
  assert.equal(saved[0].enabled, true);
  assert.equal(saved[0].apiKey, 'fixture-secret');
  assert.equal(await page.locator('#tavily-api-key').inputValue(), '', 'secret clears after saving');
  assert.equal(await page.locator('#tavily-api-key').getAttribute('type'), 'password');
  await page.getByRole('button', { name: '测试联网连接', exact: true }).click();
  await section.getByRole('status').filter({ hasText: '连接成功' }).waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.tavily-settings .test-connection')).backgroundColor === 'rgb(21, 122, 59)');
  assert.match(await testButton.getAttribute('aria-label'), /测试成功/);
  testFailure = true;
  await testButton.click();
  await section.getByRole('alert').filter({ hasText: '连接失败' }).waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.tavily-settings .test-connection')).backgroundColor === 'rgb(180, 35, 47)');
  assert.match(await testButton.getAttribute('aria-label'), /测试失败/);
  testFailure = false;
  testGate = new Promise(resolve => { releaseTest = resolve; });
  await testButton.click();
  assert.equal(await testButton.isDisabled(), true, 'retry is disabled while pending');
  assert.equal(await testButton.locator('.spinning').count(), 1, 'pending retry shows spinner');
  assert.equal(await testButton.getAttribute('class'), 'test-connection', 'retry clears stale result');
  releaseTest(); testGate = null;
  await section.getByRole('status').filter({ hasText: '连接成功' }).waitFor();
  await toggle.uncheck();
  await page.getByRole('button', { name: '保存联网配置', exact: true }).click();
  await section.getByRole('status').filter({ hasText: '已关闭' }).waitFor();
  assert.equal(saved[1].enabled, false);
  assert.equal(saved[1].apiKey, '', 'blank key tells backend to retain the stored key');
  await page.getByRole('button', { name: '读取联网配置', exact: true }).click();
  await page.locator('#tavily-enabled:enabled').waitFor();
  assert.equal(await toggle.isChecked(), false);
  await page.locator('#tavily-mcp-url').fill('https://example.com/mcp?apiKey=secret');
  await page.getByRole('button', { name: '保存联网配置', exact: true }).click();
  assert.equal(saved.length, 2, 'credentials in URL are rejected');
  await page.getByRole('button', { name: '读取联网配置', exact: true }).click();
  await page.locator('#tavily-enabled:enabled').waitFor();
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/aureli-tavily-settings-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  const closeNavigation = page.getByRole('button', { name: '关闭导航', exact: true });
  if (await page.locator('.sidebar.open').count()) await closeNavigation.click();
  await section.scrollIntoViewIfNeeded();
  assert.ok(await section.evaluate(el => el.scrollWidth <= el.clientWidth + 2), 'tool form fits small screens');
  await page.screenshot({ path: '/tmp/aureli-tavily-settings-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: Tavily logo, accessible checkbox, validation, save/reload, masked key, success/failure/retry colors and narrow layout');
} catch (error) {
  console.error('Tavily form:', await page.locator('.tavily-settings').innerText(), 'Saves:', saved.length, 'Page errors:', errors);
  await page.screenshot({ path: '/tmp/aureli-tavily-settings-failure.png', fullPage: true });
  throw error;
} finally { releaseTest?.(); await browser.close(); }
