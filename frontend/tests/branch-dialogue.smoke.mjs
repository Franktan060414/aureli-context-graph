import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { selectView } from './helpers/view-select.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], plans = [], completions = [], notes = [], uploads = [];
page.on('pageerror', e => errors.push(e.message));
const qa = (id, message, relatedTileIds = [], answer = '这是完整回答，可以作为后续问题的上下文。') => ({ id, message, relatedTileIds, answer, status: 'ready', weight: 1, tileType: 'QA' });
let tiles = [qa('c', '分支 C', ['a']), qa('root', '起始问题'), qa('a', '分支 A', ['root']), qa('b', '分支 B', ['root']), qa('d', '分支 D', ['a'], '分析较长的分支，依次解释约束、假设、算法与结果。'.repeat(12)), qa('e', '分支 E', ['b']), qa('merged', '综合结论', ['c', 'e'], '**综合回答**\n\n' + '逐层比较两条分支，并总结它们共同的结论。\n\n'.repeat(20))];
let mode = 'simple', holdCompletion = false, failCompletion = false, releaseCompletion;
await page.addInitScript(() => localStorage.setItem('aureli-mode', 'live'));
await page.route('**/customer-service/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/maps')) return route.fulfill({ json: { success: true, data: [{ mapId: 'map-branch', name: '分支视图测试', canvasZoom: 0.72 }] } });
  if (path.endsWith('/tile/workspace')) return route.fulfill({ json: { success: true, data: { tiles, edges: [] } } });
  if (path.endsWith('/question/plan')) {
    plans.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true, data: { planId: 'branch-plan', suggested: mode === 'suggested', reason: '可以独立比较。', questions: mode === 'suggested' ? ['子问题一', '子问题二'] : [] } } });
  }
  if (path.endsWith('/question/decision')) {
    const decision = route.request().postDataJSON();
    if (decision.action !== 'EXECUTE') return route.fulfill({ json: { success: true, data: null } });
    const body = plans.at(-1);
    const children = [qa(`${body.tileId}-child-1`, '子问题一', [body.tileId]), qa(`${body.tileId}-child-2`, '子问题二', [body.tileId])];
    return route.fulfill({ json: { success: true, data: {
      tiles: [qa(body.tileId, body.message, body.relatedTileIds), ...children],
      edges: children.map(child => ({ id: `edge-${child.id}`, sourceTileId: body.tileId, targetTileId: child.id, direction: 'DIRECTED', relationType: 'DIVIDES' })),
    } } });
  }
  if (path.endsWith('/completion')) {
    const body = route.request().postDataJSON(); completions.push(body);
    if (holdCompletion) await new Promise(resolve => { releaseCompletion = resolve; });
    if (failCompletion) return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"error":"模拟生成失败"}\n\n' });
    return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"v":"分支回答"}\n\ndata: {"v":"，生成完成。"}\n\ndata: {"done":true}\n\n' });
  }
  if (path.endsWith('/tile/note')) {
    const body = route.request().postDataJSON(); notes.push(body);
    return route.fulfill({ json: { success: true, data: { id: body.tileId, ...body, message: body.title, answer: body.content, status: 'ready', tileType: 'NOTE' } } });
  }
  if (path.endsWith('/tile/file')) {
    uploads.push(route.request().postData());
    return route.fulfill({ json: { success: true, data: { id: 'file-branch', title: '附件.txt', message: '附件.txt', fileName: '附件.txt', content: '用于对比的文件正文。', tileType: 'FILE', status: 'ready', relatedTileIds: ['a', 'b'], weight: 1 } } });
  }
  return route.fulfill({ json: { success: true, data: [] } });
});
const tile = id => page.locator(`.branch-tile[data-tile-id="${id}"]`);
const composer = page.locator('.branch-composer');
const input = composer.getByRole('textbox', { name: '提问内容' });
const modal = page.locator('dialog[aria-labelledby="workspace-modal-title"]');
const output = new URL('../../output/branch-dialogue-preview/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
try {
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173');
  await page.locator('.graph-node').first().waitFor();
  const mapZoom = new URL(page.url()).searchParams.get('zoom');
  await selectView(page, '分支对话');
  await tile('root').waitFor();
  await page.locator('.inspector').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.graph-header, .graph-footer').count(), 0);
  assert.equal(await page.locator('.branch-tile button').count(), 0);
  assert.deepEqual(await page.locator('.branch-row').evaluateAll(rows => rows.map(row => row.children.length)), [1, 2, 3, 1]);
  const geometry = await page.locator('.branch-row').evaluateAll(rows => rows.map(row => ({
    box: row.getBoundingClientRect().toJSON(), gap: getComputedStyle(row).gap,
    tiles: [...row.children].map(t => ({ box: t.getBoundingClientRect().toJSON(), radius: getComputedStyle(t).borderRadius, align: getComputedStyle(t).textAlign })),
  })));
  for (const [index, row] of geometry.entries()) {
    assert.equal(row.gap, '0px');
    assert.ok(Math.abs(row.box.width - geometry[0].box.width) < 1);
    if (index) assert.ok(Math.abs(row.box.top - geometry[index - 1].box.bottom) < 1);
    for (const [i, t] of row.tiles.entries()) {
      assert.equal(t.align, 'center'); assert.ok(parseFloat(t.radius) > 0);
      assert.ok(t.box.width > 0 && t.box.width <= row.box.width);
      if (i) assert.ok(Math.abs(t.box.left - row.tiles[i - 1].box.right) < 1);
    }
  }
  assert.ok(await tile('d').evaluate(el => el.clientWidth > el.closest('.branch-row').querySelector('[data-tile-id="c"]').clientWidth * 1.5));
  const metaTops = await page.locator('.branch-row[data-depth="2"] .branch-tile-meta').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().top));
  assert.ok(Math.max(...metaTops) - Math.min(...metaTops) < 1, 'short answers begin at the top of their row');
  await input.fill('保留这个草稿并比较两条分支。');
  await tile('a').click(); await tile('b').focus(); await page.keyboard.press('Space');
  assert.equal(await tile('a').getAttribute('aria-pressed'), 'true');
  assert.equal(await tile('b').getAttribute('aria-pressed'), 'true');
  assert.equal(await composer.locator('.branch-context, .branch-context-chip').count(), 0);
  assert.equal(await tile('a').getAttribute('aria-pressed'), 'true');
  assert.equal(await tile('b').getAttribute('aria-pressed'), 'true');
  assert.equal(await input.inputValue(), '保留这个草稿并比较两条分支。');
  await tile('a').click(); assert.equal(await tile('a').getAttribute('aria-pressed'), 'false');
  await tile('a').click();
  await selectView(page, 'Tile 列表');
  assert.equal(await page.locator('.tile-list article').count(), 7);
  await selectView(page, '图谱视图');
  assert.equal(new URL(page.url()).searchParams.get('zoom'), mapZoom);
  await selectView(page, '分支对话');
  await page.locator('.inspector').waitFor({ state: 'hidden' });
  assert.equal(await input.inputValue(), '保留这个草稿并比较两条分支。');
  assert.equal(await composer.locator('.branch-context, .branch-context-chip').count(), 0);
  assert.equal(await tile('a').getAttribute('aria-pressed'), 'true');
  assert.equal(await tile('b').getAttribute('aria-pressed'), 'true');

  // Both artifact entry points reuse their real workflows and inherit selected context.
  await composer.getByRole('button', { name: '添加便签', exact: true }).click();
  await modal.locator('#note-title').fill('比较要点'); await modal.locator('#note-content').fill('明确两条分支的共同约束。');
  await modal.getByRole('button', { name: '保存便签', exact: true }).click();
  await page.getByRole('button', { name: /比较要点，选择关联/ }).waitFor();
  assert.deepEqual([...notes[0].relatedTileIds].sort(), ['a', 'b']);
  assert.equal(notes[0].mapId, 'map-branch');
  assert.equal(await input.inputValue(), '保留这个草稿并比较两条分支。');
  await composer.getByRole('button', { name: '添加文件', exact: true }).click();
  await modal.locator('#node-file').setInputFiles({ name: '附件.txt', mimeType: 'text/plain', buffer: Buffer.from('文件正文') });
  await modal.getByRole('button', { name: '添加到画布', exact: true }).click();
  await tile('file-branch').waitFor();
  assert.match(uploads[0], /map-branch/); assert.match(uploads[0], /name="relatedTileIds"\r\n\r\na/); assert.match(uploads[0], /name="relatedTileIds"\r\n\r\nb/);

  // Cancelling a planning suggestion restores focus, draft, and selected context.
  mode = 'suggested';
  await composer.getByRole('button', { name: '发送并生成 Tile' }).click();
  await modal.getByRole('heading', { name: 'AI 建议拆分问题' }).waitFor();
  await modal.getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('dialog[aria-labelledby="workspace-modal-title"]').open);
  assert.equal(await input.inputValue(), '保留这个草稿并比较两条分支。');
  assert.equal(await input.evaluate(el => el === document.activeElement), true);
  assert.equal(await composer.locator('.branch-context, .branch-context-chip').count(), 0);
  assert.equal(await tile('a').getAttribute('aria-pressed'), 'true');
  assert.equal(await tile('b').getAttribute('aria-pressed'), 'true');
  mode = 'simple'; holdCompletion = true;
  await input.press('Control+Enter');
  await page.waitForFunction(() => document.querySelector('.branch-tile[aria-disabled="true"] .markdown-answer[aria-busy="true"]'));
  assert.equal(await input.isDisabled(), true);
  assert.deepEqual([...completions[0].relatedTileIds].sort(), ['a', 'b']);
  assert.equal(completions[0].mapId, 'map-branch');
  assert.equal(plans.at(-1).message, '保留这个草稿并比较两条分支。');
  assert.equal(await tile('a').getAttribute('aria-disabled'), 'true');
  const pendingQuestion = await tile(completions[0].tileId).locator('.branch-question').boundingBox();
  const scrollBox = await page.locator('.branch-scroll').boundingBox();
  assert.ok(pendingQuestion.y >= scrollBox.y && pendingQuestion.y + pendingQuestion.height <= scrollBox.y + scrollBox.height);
  await page.locator('.branch-scroll').evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  releaseCompletion(); holdCompletion = false;
  await input.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#branch-message').disabled);
  assert.equal(await input.inputValue(), '');
  assert.equal(await composer.locator('.branch-context-chip').count(), 0);
  const newTile = tile(completions[0].tileId);
  assert.match(await newTile.innerText(), /分支回答，生成完成/);
  assert.equal(await newTile.getAttribute('aria-pressed'), 'true');
  assert.equal(await tile('a').getAttribute('aria-pressed'), 'false');
  assert.equal(await tile('b').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.branch-scroll').evaluate(el => el.scrollTop), 0, 'streaming must not pull the user away from earlier content');

  // A failed answer keeps the draft and is retryable from the composer, without Tile buttons.
  await input.fill('失败后保留草稿'); failCompletion = true;
  await composer.getByRole('button', { name: '发送并生成 Tile' }).click();
  await composer.getByRole('button', { name: '重试回答', exact: true }).waitFor();
  assert.deepEqual(completions.at(-1).relatedTileIds, [completions[0].tileId], 'the next question automatically continues from the last answer');
  assert.equal(await newTile.getAttribute('aria-pressed'), 'true', 'failure preserves the previous context');
  assert.equal(await tile(completions.at(-1).tileId).getAttribute('aria-pressed'), 'false');
  assert.equal(await input.inputValue(), '失败后保留草稿');
  assert.equal(await page.locator('.branch-tile.is-error button').count(), 0);
  failCompletion = false;
  const failedId = completions.at(-1).tileId;
  await composer.getByRole('button', { name: '重试回答', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#branch-message').disabled);
  assert.equal(completions.at(-1).tileId, failedId);
  assert.equal(await tile(failedId).getAttribute('aria-pressed'), 'true');
  assert.equal(await tile(failedId).evaluate(el => el.classList.contains('is-error')), false);
  assert.equal(await newTile.getAttribute('aria-pressed'), 'false');
  assert.equal(await input.inputValue(), '');

  // The automatic default remains a normal, manually deselectable context.
  await tile(failedId).click();
  await input.fill('取消默认关联后，开始一个新问题');
  await composer.getByRole('button', { name: '发送并生成 Tile' }).click();
  await page.waitForFunction(() => !document.querySelector('#branch-message').disabled);
  assert.deepEqual(completions.at(-1).relatedTileIds, []);
  const freshId = completions.at(-1).tileId;
  assert.equal(await tile(freshId).getAttribute('aria-pressed'), 'true');

  // Splitting continues from the original question, without arbitrarily selecting a child.
  mode = 'suggested';
  await input.fill('继续研究并拆分问题');
  await composer.getByRole('button', { name: '发送并生成 Tile' }).click();
  await modal.getByRole('heading', { name: 'AI 建议拆分问题' }).waitFor();
  const splitId = plans.at(-1).tileId;
  assert.deepEqual(plans.at(-1).relatedTileIds, [freshId]);
  await modal.getByRole('button', { name: '执行拆分', exact: true }).click();
  await tile(splitId).waitFor();
  assert.equal(await tile(splitId).getAttribute('aria-pressed'), 'true');
  assert.equal(await tile(`${splitId}-child-1`).getAttribute('aria-pressed'), 'false');
  assert.equal(await tile(`${splitId}-child-2`).getAttribute('aria-pressed'), 'false');
  assert.equal(await tile(freshId).getAttribute('aria-pressed'), 'false');
  mode = 'simple';

  await page.screenshot({ path: `${output}implemented-desktop.png` });
  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 812 });
    await page.waitForFunction(() => !document.querySelector('.sidebar') || innerWidth >= 768 || document.querySelector('.sidebar').getBoundingClientRect().right <= 1);
    await page.locator('.branch-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    const composerBox = await composer.boundingBox(), lastBox = await page.locator('.branch-row').last().boundingBox();
    const canvasBox = await page.locator('.branch-dialogue').boundingBox(), scrollBox = await page.locator('.branch-scroll').boundingBox();
    assert.ok(Math.abs(scrollBox.height - canvasBox.height) < 1, 'canvas extends behind the floating composer');
    assert.ok(composerBox.x > canvasBox.x && composerBox.x + composerBox.width < canvasBox.x + canvasBox.width, 'floating composer has side clearance');
    assert.ok(Math.abs(composerBox.y + composerBox.height - (812 - (width < 768 ? 12 : 20))) < 1);
    assert.ok(lastBox.y + lastBox.height <= composerBox.y + 1, 'last row cannot be hidden under the composer');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const inputBox = await input.boundingBox();
    const controls = await composer.locator('button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().toJSON()));
    assert.ok(composerBox.height <= 64, `idle composer stays a single compact row at ${width}px: ${composerBox.height}px`);
    assert.ok(inputBox.width >= 32, 'narrow screens retain an editable input');
    for (const control of controls) {
      assert.ok(Math.abs(control.y + control.height / 2 - inputBox.y - inputBox.height / 2) < 1, 'input and controls share one row');
      assert.ok(control.width >= 44 && control.height >= 44, 'compact controls retain touch targets');
    }
    // A growing draft must still allow every last-row control above the panel.
    await input.fill('多行草稿：比较不同算法的约束与结果。\n'.repeat(16));
    await page.waitForFunction(() => {
      const panel = document.querySelector('.branch-composer'), scroll = document.querySelector('.branch-scroll');
      return parseFloat(getComputedStyle(scroll).paddingBottom) >= panel.offsetHeight + 16;
    });
    await page.locator('.branch-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    const grownBox = await composer.boundingBox(), footerBox = await page.locator('.branch-row').last().locator('.branch-tile-footer').first().boundingBox();
    assert.ok(grownBox.height > composerBox.height);
    assert.ok(footerBox.y + footerBox.height < grownBox.y, 'last-row controls clear a grown composer');
    await input.fill('');
    await page.waitForFunction(() => document.querySelector('.branch-composer').offsetHeight < 240);
    await page.locator('.branch-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await composer.getByRole('combobox', { name: /切换视图/ }).click();
    const menu = page.getByRole('listbox', { name: '视图选择' });
    if (width === 375) {
      await page.waitForFunction(() => document.querySelector('.view-select-drawer')?.getAnimations().length > 0);
      const frame = await menu.evaluate(el => {
        const drawer = el.querySelector('.view-select-drawer'), animation = drawer.getAnimations()[0];
        animation.pause(); animation.currentTime = 110;
        const matrix = new DOMMatrixReadOnly(getComputedStyle(drawer).transform);
        const frame = { y: matrix.m42, height: drawer.offsetHeight, scale: matrix.m11, opacity: getComputedStyle(drawer).opacity };
        animation.play(); return frame;
      });
      assert.ok(frame.y > 0 && frame.y < frame.height); assert.equal(frame.scale, 1); assert.equal(frame.opacity, '1');
    }
    await page.locator('.view-select-enter-active').waitFor({ state: 'detached' });
    assert.equal(await menu.getAttribute('data-side'), 'top');
    const box = await menu.boundingBox(), triggerBox = await composer.locator('.view-select-trigger').boundingBox();
    assert.ok(box.y + box.height <= triggerBox.y);
    assert.ok(box.x >= 0 && box.x + box.width <= width);
    await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
    if (width === 375) {
      await page.screenshot({ path: `${output}implemented-mobile.png` });
      await composer.getByRole('button', { name: '展开导航', exact: true }).click();
      await page.getByRole('button', { name: '关闭导航' }).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await composer.getByRole('button', { name: '展开导航' }).evaluate(el => el === document.activeElement), true);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // A branch request completed after switching to graph must not select fresh context.
  holdCompletion = true; releaseCompletion = undefined;
  await input.fill('生成期间切换到图谱视图');
  await composer.getByRole('button', { name: '发送并生成 Tile' }).click();
  await page.waitForFunction(() => document.querySelector('.markdown-answer[aria-busy="true"]'));
  await selectView(page, '图谱视图');
  while (!releaseCompletion) await new Promise(resolve => setTimeout(resolve, 10));
  releaseCompletion(); holdCompletion = false;
  await page.locator('.status-text', { hasText: '回答已完成' }).waitFor();
  assert.equal(await page.locator('.node-bottom button[aria-pressed="true"]').count(), 0);

  // Creating in graph mode also keeps automatic continuation disabled.
  await page.getByRole('button', { name: '打开添加Tile弹窗', exact: true }).click();
  await modal.getByLabel('提问内容').fill('图谱模式保持手动选择关联');
  await modal.getByRole('button', { name: '发送并生成 Tile', exact: true }).click();
  await page.locator('.status-text', { hasText: '回答已完成' }).waitFor();
  assert.equal(await page.locator('.node-bottom button[aria-pressed="true"]').count(), 0);
  await selectView(page, '分支对话');
  assert.equal(await tile(completions.at(-1).tileId).getAttribute('aria-pressed'), 'false');

  // Graph-initiated requests do not gain the branch default by switching mid-stream.
  await selectView(page, '图谱视图');
  holdCompletion = true; releaseCompletion = undefined;
  await page.getByRole('button', { name: '打开添加Tile弹窗', exact: true }).click();
  await modal.getByLabel('提问内容').fill('图谱提交后切换到分支');
  await modal.getByRole('button', { name: '发送并生成 Tile', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('dialog[aria-labelledby="workspace-modal-title"]').open);
  await selectView(page, '分支对话');
  while (!releaseCompletion) await new Promise(resolve => setTimeout(resolve, 10));
  releaseCompletion(); holdCompletion = false;
  await page.waitForFunction(() => !document.querySelector('#branch-message').disabled);
  assert.equal(await tile(completions.at(-1).tileId).getAttribute('aria-pressed'), 'false');
  await selectView(page, '图谱视图');
  await page.locator('.graph-node').first().waitFor();
  assert.equal(await page.locator('.graph-header').isVisible(), true);
  assert.deepEqual(errors, []);
  console.log('PASS branch view: content-weighted rows, hidden selection banner, auto continuation, manual override, split main context, failure/retry, graph isolation including mid-stream switches, draft/zoom, note/file context, responsive floating composer with draft growth clearance');
} finally { await browser.close(); }
