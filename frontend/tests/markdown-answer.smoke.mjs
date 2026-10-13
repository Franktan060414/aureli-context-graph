import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE_PATH
    ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));

const answer = [
  "# 阅读示例",
  "",
  "包含 **加粗**、*斜体*、`行内代码` 和 https://example.com。",
  "第一行\n第二行",
  "",
  "## 列表",
  "- 第一项\n- 第二项",
  "",
  "1. 步骤一\n2. 步骤二",
  "",
  "> 引用内容",
  "",
  "```js",
  "const example = '<b>代码不能作为 HTML 执行</b>';",
  "const longLine = '" + "x".repeat(180) + "';",
  "```",
  "",
  "| 列一 | 列二 | 列三 | 列四 | 列五 | 列六 |",
  "| --- | --- | --- | --- | --- | --- |",
  "| 内容 | 内容 | 内容 | 内容 | 内容 | 内容 |",
  "",
  '<script>window.markdownExecuted = true</script>',
  '<img src=x onerror="window.markdownExecuted = true">',
  "[危险链接](javascript:alert(1))",
].join("\n");
const tile = (id, content, tileType = "QA") => ({
  id, tileType, message: id, answer: content, status: "ready",
  relatedTileIds: [], weight: 1,
});
const tiles = [tile("markdown-example", answer), tile("plain-note", "**便签保持原文**", "NOTE")];

await page.addInitScript(() => {
  localStorage.setItem("aureli-mode", "live");
  localStorage.setItem("aureli-api-base", "http://backend.test");
  // Let the test release SSE events individually, asserting before completion.
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    if (String(input).endsWith("/chat/tile/completion")) {
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          window.sendMarkdownEvent = value =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
          window.finishMarkdownStream = () => {
            window.sendMarkdownEvent({ done: true });
            controller.close();
          };
        },
      }), { headers: { "Content-Type": "text/event-stream" } }));
    }
    return originalFetch(input, options);
  };
});
await page.route("http://backend.test/customer-service/**", route => {
  if (new URL(route.request().url()).pathname.endsWith('/maps')) return route.fulfill({ json: { success: true, data: [{ mapId: 'default', name: '默认图谱' }] } });
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/question/plan')) return route.fulfill({ json: { success: true, data: { suggested: false, reason: '单一问题', questions: [], planId: null } } });
  return route.fulfill({ json: { success: true, data: path.endsWith("/workspace") ? { tiles, edges: [] } : [] } });
});

async function checkAnswer(selector, { preview = false } = {}) {
  const content = page.locator(selector);
  await content.locator("h1").waitFor();
  assert.equal(await content.locator("h1").innerText(), "阅读示例");
  assert.equal(await content.locator("strong").innerText(), "加粗");
  assert.equal(await content.locator("ul li").count(), 2);
  assert.equal(await content.locator("ol li").count(), 2);
  assert.equal(await content.locator("table tbody tr").count(), 1);
  assert.equal(await content.locator("blockquote").innerText(), "引用内容");
  assert.equal(await content.locator(preview ? '.markdown-link' : 'a[href="https://example.com"]').count(), 1);
  assert.equal(await content.locator("script, img, a[href^='javascript:']").count(), 0);
  assert.equal(await page.evaluate(() => !!window.markdownExecuted), false);
  assert.equal(await content.evaluate(el => getComputedStyle(el).whiteSpace), "normal");
  assert.equal(await content.locator("pre").evaluate(el => getComputedStyle(el).whiteSpace), preview ? "pre-wrap" : "pre");
  assert.equal(await content.locator("h1").evaluate(el => parseFloat(getComputedStyle(el).fontSize) < 32), true);
  assert.equal(await content.locator("pre").evaluate(el => el.scrollWidth > el.clientWidth), !preview);
  if (preview) {
    assert.equal(await content.locator('a, [tabindex]').count(), 0, 'canvas preview has no nested interactive controls');
    assert.equal(await content.locator('strong').evaluate(el => getComputedStyle(el).display), 'inline', 'inline bold does not inherit the Tile title layout');
    assert.equal(await content.evaluate(el => getComputedStyle(el).overflow), 'hidden');
    assert.equal(await content.locator('table').evaluate(el => el.scrollWidth <= el.closest('.markdown-table').clientWidth), true, 'all table columns fit the compact preview');
    assert.equal(await content.evaluate(el => el.scrollHeight > el.clientHeight), true, 'long Markdown is clipped to the available Tile height');
  }
}

try {
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:5173");
  const canvasAnswer = '.graph-node[data-tile-id="markdown-example"] .node-answer';
  await checkAnswer(canvasAnswer, { preview: true });
  assert.equal(await page.locator('.graph-node[data-tile-id="markdown-example"]').evaluate(el => el.style.width), '260px');
  assert.equal(await page.locator('.graph-node[data-tile-id="plain-note"] .node-answer').innerText(), '**便签保持原文**');
  const previewTile = page.locator('.graph-node[data-tile-id="markdown-example"]');
  async function resizePreview(width, height) {
    const current = await previewTile.evaluate(el => ({ width: parseFloat(el.style.width), height: parseFloat(el.style.height) }));
    const scale = (await previewTile.boundingBox()).width / current.width;
    const box = await previewTile.locator('.node-resize-se').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + (width - current.width) * scale, y + (height - current.height) * scale, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('[data-tile-id="markdown-example"] .node-resize-se').disabled);
  }
  await resizePreview(520, 680);
  assert.ok(await page.locator(canvasAnswer).evaluate(el => el.clientHeight > 500), 'enlarging the Tile exposes more formatted content');
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await previewTile.screenshot({ path: new URL('../artifacts/canvas-markdown.png', import.meta.url).pathname });
  await resizePreview(260, 200);
  await page.getByRole("button", { name: /^查看 markdown-example：/ }).click();
  await checkAnswer(".answer-text");
  await page.getByRole("button", { name: "全页面查看 markdown-example", exact: true }).click();
  await checkAnswer(".reading-answer");
  await mkdir("artifacts", { recursive: true });
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState === "running"));
  await page.screenshot({ path: "artifacts/markdown-answer-desktop.png" });
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.locator(".fullscreen-viewer").evaluate(el => el.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator(".markdown-table").last().evaluate(el => el.scrollWidth > el.clientWidth), true);
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState === "running"));
  await page.screenshot({ path: "artifacts/markdown-answer-mobile.png" });
  await page.setViewportSize({ width: 812, height: 375 });
  assert.equal(await page.locator(".fullscreen-viewer").evaluate(el => el.scrollWidth <= innerWidth), true);
  await page.keyboard.press("Escape");
  await page.locator(".fullscreen-viewer").waitFor({ state: "detached" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: /^查看 plain-note：/ }).click();
  assert.equal(await page.locator(".answer-text").innerText(), "**便签保持原文**");
  assert.equal(await page.locator(".answer-text strong").count(), 0);


  await page.getByRole("button", { name: "添加Tile", exact: true }).click();
  await page.getByLabel("提问内容").fill("测试实时 Markdown");
  await page.getByLabel("当前 Tile ID").fill("markdown-stream");
  await page.getByRole("button", { name: "发送并生成 Tile", exact: true }).click();
  await page.waitForFunction(() => !!window.sendMarkdownEvent);
  assert.equal(await page.locator(".answer-text").innerText(), "正在思考并生成回答…");
  await page.evaluate(() => window.sendMarkdownEvent({ v: "## 实时回答\n\n**分" }));
  await page.locator(".answer-text h2").waitFor();
  await page.locator('.graph-node[data-tile-id="markdown-stream"] .node-answer h2').waitFor();
  assert.equal(await page.locator(".answer-text").getAttribute("aria-busy"), "true");
  assert.equal(await page.locator(".answer-text strong").count(), 0);
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  await page.getByRole("button", { name: "全页面查看 markdown-stream", exact: true }).click();
  await page.evaluate(() => window.sendMarkdownEvent({ v: "段加粗**\n\n```js\nconst value = 1;" }));
  await page.waitForFunction(() => document.querySelector(".reading-answer strong")?.textContent === "分段加粗");
  await page.waitForFunction(() => document.querySelector('.graph-node[data-tile-id="markdown-stream"] .node-answer strong')?.textContent === '分段加粗');
  await page.evaluate(() => window.sendMarkdownEvent({ v: "\n```\n\n- 已完成" }));
  await page.locator(".reading-answer li").waitFor();
  await page.evaluate(() => window.finishMarkdownStream());
  await page.waitForFunction(() => document.querySelector(".reading-answer")?.getAttribute("aria-busy") === "false");
  assert.equal(await page.locator('.graph-node[data-tile-id="markdown-stream"] .node-answer').getAttribute('aria-busy'), 'false');
  assert.equal(await page.locator(".reading-answer pre code").innerText(), "const value = 1;\n");
  await page.keyboard.press("Escape");
  await page.locator(".fullscreen-viewer").waitFor({ state: "detached" });
  assert.equal(await page.locator(".answer-text strong").innerText(), "分段加粗");
  assert.equal(await page.locator(".answer-text li").innerText(), "已完成");
  await page.getByRole('button', { name: /^查看 markdown-example：/ }).focus();
  await page.keyboard.press('Enter');
  await page.locator('.answer-text h1').waitFor();
  await page.getByRole('button', { name: /^查看 plain-note：/ }).focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('.answer-text').innerText(), '**便签保持原文**');
  assert.deepEqual(errors, []);
  console.log("PASS: Markdown in canvas and both readers, bounded compact previews, keyboard Tile selection, fragmented streaming, HTML escaping, plain notes and narrow-screen overflow");
} finally {
  await browser.close();
}
