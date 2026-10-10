import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const output = new URL('../artifacts/graph-export/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const errors = [], writes = [];
page.on('pageerror', error => errors.push(error.message));
const longAnswer = '**完整回答**\n\n' + Array.from({ length: 100 }, (_, i) => `第 ${i + 1} 条：这段中文内容需要完整导出，不能省略或截断。`).join('\n')
  + '\n\n```js\nconst longValue = "' + 'x'.repeat(200) + '";\n```\n\n| 甲 | 乙 | 丙 | 丁 | 戊 | 己 |\n|---|---|---|---|---|---|\n| 完整内容 | 完整内容 | 完整内容 | 完整内容 | 完整内容 | 完整内容 |\n\n回答结束标记';
const tile = (id, extra = {}) => ({ id, message: '这是用于验收的完整问题。', answer: '简短回答。', weight: 1,
  status: 'ready', tileType: 'QA', kind: 'root', relatedTileIds: [], labelId: 1, ...extra });
const graph = { tiles: [tile('private-id-root', { message: '如何保留所有问题内容？'.repeat(12), weight: 3 }),
  tile('private-id-long', { answer: longAnswer, labelId: 2, relatedTileIds: ['private-id-root'] }),
  tile('private-id-note', { tileType: 'NOTE', message: '便签标题', content: '**便签保持原文**', weight: 2,
    labelId: null, relatedTileIds: ['private-id-root'] })],
  edges: [{ id: 'edge-long', sourceTileId: 'private-id-root', targetTileId: 'private-id-long', direction: 'DIRECTED', relationType: 'EXTENDS' },
    { id: 'edge-note', sourceTileId: 'private-id-root', targetTileId: 'private-id-note', direction: 'UNDIRECTED', relationType: 'RELATES' }],
  labels: [{ id: 1, name: '中文研究标签', colorHex: '#E8F2FF' },
    { id: 2, name: '深色标签', colorHex: '#1D1E4E' }] };
await page.addInitScript(() => {
  localStorage.setItem('aureli-mode', 'live');
  localStorage.setItem('aureli-active-map:' + location.origin, 'export-map');
  localStorage.setItem('aureli-tile-layouts', JSON.stringify({ ['live:' + location.origin + ':export-map']:
    { 'private-id-root': { x: 1200, y: 900 } } }));
});
await page.route('**/customer-service/**', route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (request.method() !== 'GET') writes.push(path);
  const data = path.endsWith('/maps') ? [{ mapId: 'export-map', name: '导出验收' }, { mapId: 'empty-map', name: '空图谱' }]
    : path.endsWith('/workspace') ? new URL(request.url()).searchParams.get('mapId') === 'empty-map'
      ? { tiles: [], edges: [], labels: [] } : graph : [];
  return route.fulfill({ json: { success: true, data } });
});
const exportButton = () => page.getByRole('button', { name: '导出图谱', exact: true });
const dialog = () => page.getByRole('dialog', { name: '导出图谱', exact: true });
const canvasSnapshot = () => page.evaluate(() => ({
  layout: localStorage.getItem('aureli-tile-layouts'),
  arrangement: localStorage.getItem('aureli-canvas-arrangements'),
  zoom: document.querySelector('.graph-world')?.style.transform,
  nodes: [...document.querySelectorAll('.graph-node')].map(node => node.getAttribute('style')),
}));

async function inspectPdf(path, renderName) {
  const bytes = [...await readFile(path)];
  const result = await page.evaluate(async ({ bytes }) => {
    const pdfjs = await import('/pdfjs/pdfjs-6.4.299-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdfjs-6.4.299-dist/build/pdf.worker.mjs';
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const pdf = await task.promise;
    const first = await pdf.getPage(1), full = first.getViewport({ scale: 1 });
    const viewport = first.getViewport({ scale: Math.min(1, 1800 / Math.max(full.width, full.height)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await first.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0, brandBlue = 0, brandGold = 0, headerWhite = 0;
    const colors = { light: [232, 242, 255], dark: [29, 30, 78], unlabelled: [255, 255, 255] };
    const colorCounts = { light: 0, dark: 0, unlabelled: 0 };
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] < 220 || pixels[i + 1] < 220 || pixels[i + 2] < 220) ink++;
      for (const [name, rgb] of Object.entries(colors))
        if (rgb.every((value, channel) => Math.abs(pixels[i + channel] - value) <= 1)) colorCounts[name]++;
      if (i / 4 < canvas.width * Math.floor(90 * viewport.scale)) {
        const [r, g, b] = pixels.slice(i, i + 3);
        if (b > 100 && b > r * 1.5 && b > g * 1.3) brandBlue++;
        if (r > 150 && g > 70 && b < 60) brandGold++;
        if (r > 246 && g > 248 && b > 251) headerWhite++;
      }
    }
    const result = { pages: pdf.numPages, width: full.width, height: full.height, ink, colorCounts,
      brandBlue, brandGold, headerWhite,
      corner: [...pixels.slice(0, 3)],
      png: canvas.toDataURL('image/png').split(',')[1] };
    await task.destroy();
    return result;
  }, { bytes });
  assert.equal(result.pages, 1, 'PDF must contain exactly one page');
  assert.ok(result.ink > 20000, 'PDF must contain rendered content, not a blank snapshot');
  assert.deepEqual(result.corner, [243, 245, 248], 'PDF canvas must have a light gray background');
  assert.ok(result.brandBlue > 5 && result.brandGold > 5, 'the top-left header must render the blue and gold Aureli logo');
  assert.equal(result.headerWhite, 0, 'the logo must blend into the gray canvas without a white background rectangle');
  for (const [name, count] of Object.entries(result.colorCounts))
    assert.ok(count > 1000, `PDF must preserve the ${name} card background`);
  await writeFile(output + renderName + '.png', Buffer.from(result.png, 'base64'));
  return result;
}

try {
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await page.locator('.graph-node').last().waitFor();
  const original = await canvasSnapshot();
  for (const action of ['取消', '关闭导出选择', 'Escape']) {
    await exportButton().click();
    assert.equal(await dialog().getByRole('radio', { name: 'JSON 格式' }).isChecked(), true);
    if (action === '取消') await dialog().screenshot({ path: output + 'format-dialog.png' });
    if (action === 'Escape') await page.keyboard.press('Escape');
    else await dialog().getByRole('button', { name: action, exact: true }).click();
    await dialog().waitFor({ state: 'hidden' });
    assert.ok(await exportButton().evaluate(button => button === document.activeElement));
    assert.deepEqual(await canvasSnapshot(), original);
  }
  await exportButton().click();
  const jsonDownload = page.waitForEvent('download');
  await dialog().getByRole('button', { name: '导出', exact: true }).click();
  const json = await jsonDownload;
  assert.equal(json.suggestedFilename(), 'aureli-graph.json');
  const saved = JSON.parse(await readFile(await json.path(), 'utf8'));
  assert.deepEqual(saved.tiles, graph.tiles); assert.deepEqual(saved.labels, graph.labels);
  assert.deepEqual(saved.layout['private-id-root'], { x: 1200, y: 900 });
  await dialog().waitFor({ state: 'hidden' });

  for (const mode of ['tree', 'layered']) {
    if (mode === 'layered') {
      graph.edges[0].relationType = 'FUSES';
      graph.edges[1].relationType = 'DIVIDES';
      await page.evaluate(() => localStorage.setItem('aureli-canvas-arrangements', JSON.stringify({
        ['live:' + location.origin + ':export-map']: { mode: 'layered', routes: {} },
      })));
      await page.reload(); await page.locator('.graph-node').last().waitFor();
    }
    const before = await canvasSnapshot();
    await exportButton().click(); await dialog().getByRole('radio', { name: 'PDF 格式' }).check();
    if (mode === 'tree') await dialog().screenshot({ path: output + 'pdf-dialog.png' });
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    downloadPromise.catch(() => {});
    await dialog().getByRole('button', { name: '导出', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-export-card]')?.dataset.exportX);
    const brand = await page.locator('[data-export-brand]').evaluate(node => ({
      x: Number(node.dataset.exportX), y: Number(node.dataset.exportY),
      bottom: Number(node.dataset.exportY) + node.getBoundingClientRect().height,
      width: node.getBoundingClientRect().width,
      ready: node.querySelector('img').complete && node.querySelector('img').naturalWidth > 0,
      firstCardTop: Math.min(...[...document.querySelectorAll('[data-export-card]')].map(card => Number(card.dataset.exportY))),
    }));
    assert.ok(brand.ready && brand.x === 32 && brand.y === 32 && brand.width === 260);
    assert.ok(brand.firstCardTop >= brand.bottom + 32, 'the brand header must stay clear of graph cards');
    const cards = await page.locator('[data-export-card]').evaluateAll(nodes => nodes.map(node => ({
      width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, text: node.textContent,
      verticalOverflow: node.scrollHeight > node.clientHeight + 2,
      overflow: [...node.querySelectorAll('*')].filter(el => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2)
        .map(el => `${el.tagName}.${el.className}: ${el.scrollWidth}/${el.clientWidth}`),
      controls: node.querySelectorAll('button, .node-status, .mono').length,
      background: getComputedStyle(node).backgroundColor,
      foreground: getComputedStyle(node).color,
      heading: getComputedStyle(node.querySelector('h3')).color,
      code: node.querySelector('pre') ? getComputedStyle(node.querySelector('pre')).color : null,
    })));
    assert.ok(cards.every(card => Math.abs(card.width / card.height - 260 / 200) < .001),
      'every export card must retain the original canvas aspect ratio');
    assert.ok(cards[1].width > cards[0].width && cards[1].height > cards[0].height,
      'long content must grow both dimensions instead of using a fixed width');
    assert.ok(cards[1].height > 2048 && cards[1].width > 2048, 'long answer must exercise capture slices in both directions');
    assert.ok(cards.every(card => !card.verticalOverflow), 'the preserved ratio must not clip full answers');
    assert.ok(cards[1].text.includes('回答结束标记'));
    assert.ok(cards.every(card => !card.text.includes('private-id-') && !card.text.includes('已完成') && !card.controls));
    assert.deepEqual(cards.flatMap(card => card.overflow), [], 'Markdown tables and long code must wrap fully');
    assert.ok(cards[0].text.includes('中文研究标签') && cards[1].text.includes('深色标签'));
    assert.deepEqual(cards.map(card => card.background), ['rgb(232, 242, 255)', 'rgb(29, 30, 78)', 'rgb(255, 255, 255)']);
    assert.equal(cards[1].foreground, 'rgb(255, 255, 255)');
    assert.equal(cards[1].heading, 'rgb(255, 255, 255)');
    assert.equal(cards[1].code, 'rgb(255, 255, 255)');
    const relations = await page.locator('[data-export-relation]').evaluateAll(nodes => nodes.map(node => {
      const type = node.dataset.relationType;
      return { type, color: getComputedStyle(node).color,
        canvasColor: getComputedStyle(document.querySelector(`.edges g[data-relation-type="${type}"]`)).color };
    }));
    assert.ok(relations.every(relation => relation.color === relation.canvasColor),
      'PDF relation colors must match canvas colors for all four relationship types');
    assert.ok(cards[2].text.includes('**便签保持原文**'));
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), '导出验收.pdf');
    const path = output + mode + '.pdf'; await download.saveAs(path);
    await dialog().waitFor({ state: 'hidden' });
    assert.deepEqual(await canvasSnapshot(), before, 'export must preserve the editor layout and zoom');
    const pdf = await inspectPdf(path, mode);
    assert.ok(pdf.height > 2000, 'single page must grow with the full answer');
    assert.ok(Math.max(pdf.height / pdf.width, pdf.width / pdf.height) < 2,
      'long answers must not turn this exported graph into an extreme strip');
  }

  // Ordinary long prose should reflow into the increased width, rather than
  // reserving the narrow-column height from the original measurement.
  graph.tiles[1].answer = Array.from({ length: 8 }, (_, i) => `## 第 ${i + 1} 部分\n\n`
    + '知识图谱通过实体与关系组织信息，结合上下文检索形成完整回答。导出时需要保留全部正文，并让问题与回答保持清晰的阅读顺序。'.repeat(14))
    .join('\n\n') + '\n\n连续正文结束标记';
  await page.reload(); await page.locator('.graph-node').last().waitFor();
  await exportButton().click(); await dialog().getByRole('radio', { name: 'PDF 格式' }).check();
  const proseDownload = page.waitForEvent('download', { timeout: 60000 });
  proseDownload.catch(() => {});
  await dialog().getByRole('button', { name: '导出', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-export-card]')?.dataset.exportX);
  const proseCard = await page.locator('[data-export-card]').nth(1).evaluate(card => ({
    width: card.getBoundingClientRect().width, height: card.getBoundingClientRect().height,
    text: card.textContent, font: getComputedStyle(card.querySelector('.markdown-answer')).fontSize,
    overflow: card.scrollHeight > card.clientHeight + 2,
  }));
  assert.ok(proseCard.width > 480 && Math.abs(proseCard.width / proseCard.height - 1.3) < .001);
  assert.equal(proseCard.font, '16px');
  assert.ok(!proseCard.overflow && proseCard.text.includes('连续正文结束标记'));
  const prose = await proseDownload;
  await prose.saveAs(output + 'layered-prose.pdf');
  await dialog().waitFor({ state: 'hidden' });
  const prosePdf = await inspectPdf(output + 'layered-prose.pdf', 'layered-prose');
  assert.ok(Math.max(prosePdf.height / prosePdf.width, prosePdf.width / prosePdf.height) < 2);

  // A worker load error stays in the chooser, retains the canvas, and allows retry.
  await page.route('**/*elk-worker.min*', route => route.abort());
  await exportButton().click(); await dialog().getByRole('radio', { name: 'PDF 格式' }).check();
  const beforeFailure = await canvasSnapshot();
  await dialog().getByRole('button', { name: '导出', exact: true }).click();
  await dialog().getByRole('alert').waitFor();
  assert.deepEqual(await canvasSnapshot(), beforeFailure);
  await page.unroute('**/*elk-worker.min*');
  const retryDownload = page.waitForEvent('download', { timeout: 60000 });
  await dialog().getByRole('button', { name: '导出', exact: true }).click();
  await retryDownload; await dialog().waitFor({ state: 'hidden' });

  // Cancellation while measuring/laying out must not download a partial file.
  let releaseWorker;
  await page.route('**/*elk-worker.min*', async route => {
    await new Promise(resolve => { releaseWorker = resolve; });
    await route.continue().catch(() => {});
  });
  const cancelledDownloads = [];
  const onDownload = item => cancelledDownloads.push(item);
  page.on('download', onDownload);
  await exportButton().click(); await dialog().getByRole('radio', { name: 'PDF 格式' }).check();
  await dialog().getByRole('button', { name: '导出', exact: true }).click();
  await page.locator('.graph-export-stage').waitFor({ state: 'attached' });
  await dialog().getByRole('button', { name: '取消', exact: true }).click();
  releaseWorker?.();
  await page.unroute('**/*elk-worker.min*');
  await dialog().waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.graph-export-stage, .graph-export-capture').count(), 0);
  assert.equal(cancelledDownloads.length, 0);
  page.off('download', onDownload);

  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await exportButton().click();
    await dialog().waitFor();
    await page.setViewportSize({ width, height: 900 });
    const bounds = await dialog().boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (width === 375) await dialog().screenshot({ path: output + 'mobile-dialog.png' });
    await page.keyboard.press('Escape');
  }
  await page.locator('.map-list').getByRole('button', { name: '空图谱', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.graph-node'));
  await exportButton().click();
  assert.ok(await dialog().getByRole('radio', { name: 'PDF 格式' }).isDisabled());
  assert.ok(await dialog().getByRole('button', { name: '导出', exact: true }).isEnabled());
  assert.deepEqual(writes, [], 'export must not write to the backend');
  assert.deepEqual(errors, []);
  console.log('Graph export passed: JSON, single-page PDF, full text, both layouts, labels, cancellation, retry, keyboard, responsive UI, and editor isolation.');
} catch (error) {
  console.error(error);
  console.error('Export UI:', await page.locator('.export-modal').count() ? await page.locator('.export-modal').textContent() : 'closed', errors);
  await page.screenshot({ path: output + 'failure.png' });
  throw error;
} finally { await browser.close(); }
