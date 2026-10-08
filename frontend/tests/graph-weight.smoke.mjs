import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.emulateMedia({ reducedMotion: 'reduce' });
const tiles = [1, 2, 3].map(weight => ({
  id: `weight-${weight}`, weight,
  message: '这是用于验证权重卡片显示更多问题内容的长问题。'.repeat(8),
  answer: '较大的 Tile 应显示更多回答，同时保持原有文字字号、按钮和操作方式。'.repeat(40),
  relatedTileIds: weight === 1 ? [] : [`weight-${weight - 1}`],
  status: 'ready', kind: weight === 1 ? 'root' : 'memory',
}));
const edges = [2, 3].map(weight => ({
  id: `edge-${weight}`, sourceTileId: `weight-${weight - 1}`, targetTileId: `weight-${weight}`,
  direction: 'DIRECTED', relationType: 'EXTENDS', weight: 1,
}));
await page.route('**/customer-service/**', route => route.fulfill({ json: { success: true, data: new URL(route.request().url()).pathname.endsWith('/maps') ? [{ mapId: 'default', name: '默认图谱' }] : { tiles, edges } } }));
const node = (graph, weight) => graph.locator('.graph-node').filter({ has: page.locator(`.node-main[aria-label^="查看 weight-${weight}："]`) });
async function measurements(graph) {
  return graph.locator('.graph-node').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    const main = element.querySelector('.node-main'), question = main.querySelector('strong'), answer = main.querySelector('.node-answer');
    const bottom = element.querySelector('.node-bottom').getBoundingClientRect();
    return {
      width: rect.width, height: rect.height,
      x: parseFloat(element.style.left), y: parseFloat(element.style.top),
      questionHeight: question.getBoundingClientRect().height,
      answerHeight: answer.getBoundingClientRect().height,
      questionFont: getComputedStyle(question).fontSize, answerFont: getComputedStyle(answer).fontSize,
      buttonHeight: element.querySelector('.node-bottom button').getBoundingClientRect().height,
      bottom: bottom.bottom, cardBottom: rect.bottom,
    };
  }));
}
function assertDimensions(measured, scale = 1) {
  for (const [index, multiplier] of [1, 1.5, 2.5].entries()) {
    assert.ok(Math.abs(measured[index].width - 260 * multiplier * scale) < 0.1);
    assert.ok(Math.abs(measured[index].height - 200 * multiplier * scale) < 0.1);
    assert.equal(measured[index].questionFont, '17px');
    assert.equal(measured[index].answerFont, '14px');
    assert.ok(measured[index].bottom <= measured[index].cardBottom);
  }
}
try {
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await page.locator('.graph-node').first().waitFor();
  let measured = await measurements(page);
  assertDimensions(measured);
  assert.ok(measured[1].questionHeight > measured[0].questionHeight);
  assert.ok(measured[2].questionHeight > measured[1].questionHeight);
  assert.ok(measured[1].answerHeight > measured[0].answerHeight);
  assert.ok(measured[2].answerHeight > measured[1].answerHeight);
  assert.equal(measured[0].buttonHeight, measured[1].buttonHeight);
  assert.equal(measured[0].buttonHeight, measured[2].buttonHeight);
  for (let i = 1; i < measured.length; i++)
    assert.equal(measured[i].x - measured[i - 1].x - measured[i - 1].width, 56);

  await page.getByRole('button', { name: '全页面查看图谱', exact: true }).click();
  const graph = page.locator('.fullscreen-viewer');
  await graph.waitFor();
  assertDimensions(await measurements(graph));
  const large = node(graph, 3);
  const before = (await measurements(graph))[2];
  const pathBefore = await graph.locator('.edges g > path').last().getAttribute('d');
  await large.locator('.node-main').press('Alt+ArrowRight');
  assert.equal((await measurements(graph))[2].x, before.x + 10);
  assert.notEqual(await graph.locator('.edges g > path').last().getAttribute('d'), pathBefore);
  assertDimensions(await measurements(graph));
  await graph.getByRole('button', { name: '缩小图谱', exact: true }).click();
  assertDimensions(await measurements(graph), 0.9);
  await graph.getByRole('button', { name: '放大图谱', exact: true }).click();
  await graph.locator('.graph-wrap').screenshot({ path: new URL('../artifacts/graph-weight.png', import.meta.url).pathname });
  await page.keyboard.press('Escape');
  assert.equal((await measurements(page))[2].x, before.x + 10);
  await page.reload();
  await page.locator('.graph-node').first().waitFor();
  assertDimensions(await measurements(page));
  assert.equal((await measurements(page))[2].x, before.x + 10);
  tiles[2].weight = 2;
  await page.getByRole('button', { name: '同步图谱', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.graph-node')[2]?.style.width === '390px');
  measured = await measurements(page);
  assert.equal(measured[2].width, 390);
  assert.equal(measured[2].height, 300);
  assert.equal(measured[2].x, before.x + 10);
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: 1/1.5/2.5 size ratios, more visible content, unchanged typography/actions, layout spacing, fullscreen, keyboard movement, live connections, zoom, saved coordinates, sync and mobile containment');
} finally { await browser.close(); }
