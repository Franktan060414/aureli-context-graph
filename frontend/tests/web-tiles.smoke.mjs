import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
let tiles = [], refreshCount = 0, fail = false, holdRefresh = false, releaseRefresh;
await page.route('**/customer-service/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (path.endsWith('/maps')) return route.fulfill({ json: { success: true, data: [{ mapId: 'web-map', name: '网页研究' }, { mapId: 'other-map', name: '另一图谱' }] } });
  if (path.endsWith('/tile/workspace')) return route.fulfill({ json: { success: true, data: { tiles: new URL(request.url()).searchParams.get('mapId') === 'other-map' ? [] : tiles, edges: [], labels: [] } } });
  if (path.endsWith('/tile/web')) {
    writes.push(request.postDataJSON());
    const node = { id: 'web-one', title: 'example.com', message: 'example.com', answer: '', content: '', tileType: 'WEB', kind: 'web', status: 'ready', weight: 1,
      sourceUrl: request.postDataJSON().url, fetchStatus: 'PENDING', relatedTileIds: [] };
    tiles = [node];
    return route.fulfill({ json: { success: true, data: node } });
  }
  if (path.endsWith('/web/refresh')) {
    writes.push(request.postDataJSON()); refreshCount++;
    if (holdRefresh) await new Promise(resolve => { releaseRefresh = resolve; });
    if (refreshCount === 1) await new Promise(resolve => setTimeout(resolve, 500));
    tiles = [{ ...tiles[0], title: '网页研究文章', message: '网页研究文章', answer: '# 核心观点\n这是原始网页正文。', content: '# 核心观点\n这是原始网页正文。\n\n<script>window.bad = true</script>\n[危险](javascript:alert(1))',
      resolvedUrl: 'https://example.com/article', fetchedAt: '2026-10-13T10:00:00', fetchStatus: fail ? 'FAILED' : 'READY', fetchError: fail ? '网站暂时不可访问，旧正文已保留。' : null }];
    return route.fulfill({ json: { success: true, data: tiles[0] } });
  }
  if (path.endsWith('/question/plan')) return route.fulfill({ json: { success: true, data: { suggested: false } } });
  if (path.endsWith('/completion')) {
    writes.push(request.postDataJSON());
    return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"v":"网页分析结果"}\n\ndata: {"done":true}\n\n' });
  }
  return route.fulfill({ json: { success: true, data: {} } });
});
try {
  await page.addInitScript(() => localStorage.setItem('aureli-mode', 'live'));
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5179');
  await page.getByRole('button', { name: '添加网页', exact: true }).click();
  const dialog = page.locator('dialog.modal[open]');
  await dialog.getByLabel('网页地址').fill('https://example.com/article');
  await dialog.getByRole('button', { name: '添加到画布', exact: true }).click();
  await page.getByRole('button', { name: '正在读取…', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '正在读取…', exact: true }).isDisabled(), true);
  await page.locator('.web-page-content h1').waitFor();
  assert.ok((await page.locator('.web-page-content').innerText()).includes('这是原始网页正文'));
  assert.equal(await page.locator('.web-page-content a[href^="javascript:"]').count(), 0);
  assert.equal(await page.evaluate(() => window.bad), undefined);
  assert.equal(await page.getByRole('link', { name: '打开原网页' }).getAttribute('target'), '_blank');
  assert.ok(writes.every(write => write.mapId === 'web-map'));
  fail = true;
  await page.getByRole('button', { name: '更新正文', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '旧正文已保留' }).waitFor();
  assert.ok((await page.locator('.web-page-content').innerText()).includes('这是原始网页正文'));
  await page.getByRole('button', { name: '全页面查看 web-one', exact: true }).click();
  await page.locator('.fullscreen-viewer .web-page-content').waitFor();
  fail = false;
  await page.locator('.fullscreen-viewer').getByRole('button', { name: '更新正文', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.fullscreen-viewer .web-page-content')?.textContent.includes('正文已保存'));
  await page.screenshot({ path: '/tmp/aureli-web-tile-desktop.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '从此节点延伸', exact: true }).click();
  const form = page.locator('#inspector-question-form');
  await form.getByLabel('提问内容').fill('总结关联网页');
  await form.getByRole('button', { name: '发送并生成 Tile', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.graph-wrap')?.textContent.includes('网页分析结果'));
  assert.deepEqual(writes.at(-1).relatedTileIds, ['web-one']);
  await page.reload();
  await page.locator('.graph-node[data-tile-id="web-one"] .node-main').click();
  await page.locator('.web-page-content h1').waitFor();
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: '全页面查看 web-one', exact: true }).click();
    await page.setViewportSize(viewport);
    await page.locator('.fullscreen-viewer .web-page-content').waitFor();
    assert.ok(await page.evaluate(() => document.querySelector('.fullscreen-viewer').scrollWidth <= document.querySelector('.fullscreen-viewer').clientWidth + 1));
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.graph-viewport').evaluate(element => {
    const data = new DataTransfer(); data.setData('text/plain', 'https://example.com/pasted');
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await dialog.getByLabel('网页地址').waitFor();
  assert.equal(await dialog.getByLabel('网页地址').inputValue(), 'https://example.com/pasted');
  await page.keyboard.press('Escape');
  holdRefresh = true;
  await page.getByRole('button', { name: '更新正文', exact: true }).click();
  await page.getByRole('button', { name: '正在读取…', exact: true }).waitFor();
  await page.getByRole('button', { name: '另一图谱', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.graph-node').length === 0);
  releaseRefresh(); holdRefresh = false;
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.graph-node').count(), 0, 'late extraction cannot add a Tile to another map');
  await page.getByRole('button', { name: '网页研究', exact: true }).click();
  await page.locator('.graph-node[data-tile-id="web-one"]').waitFor();
  assert.deepEqual(writes.at(-1), { mapId: 'web-map' });
  assert.deepEqual(errors, []);
  console.log('Web Tile browser checks passed: add, pending, reader, retry, old snapshot, full-page refresh, context, reload, mobile, safe Markdown, paste and late map response.');
} finally { await browser.close(); }
