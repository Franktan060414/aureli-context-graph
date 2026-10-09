import { selectView } from "./helpers/view-select.js";
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE_PATH || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE_PATH
    ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [],
  requests = [];
page.on("pageerror", (e) => errors.push(e.message));
let failure = false,
  documents = [
    {
      id: 9,
      originalFileName: "test.md",
      fileSize: "2 KB",
      status: 2,
      remark: "test",
      createTime: "2026-10-04T10:00:00",
    },
  ];
await page.route("**/customer-service/**", async (route) => {
  if (new URL(route.request().url()).pathname.endsWith('/maps')) return route.fulfill({ json: { success: true, data: [{ mapId: 'default', name: '默认图谱' }] } });
  const request = route.request(),
    path = new URL(request.url()).pathname;
  requests.push({ path, body: request.postData() });
  if (path.endsWith('/question/plan')) return route.fulfill({ json: { success: true, data: { suggested: false, reason: '单一问题', questions: [], planId: null } } });
  if (path.endsWith("/tile/workspace"))
    return route.fulfill({ json: { success: true, data: { tiles: [], edges: [] } } });
  if (path.endsWith("/completion"))
    return route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"v":"接口"}\n\ndata: {"v":"模拟回答"}\n\ndata: {"done":true}\n\n',
    });
  if (path.endsWith("/list"))
    return route.fulfill({
      json: failure
        ? { success: false, message: "数据库不可用，请重试" }
        : {
            success: true,
            data: documents,
            total: documents.length,
            current: 1,
            pages: 1,
          },
    });
  if (path.endsWith("/delete")) documents = [];
  if (path.endsWith("/update"))
    documents[0].remark = JSON.parse(request.postData()).remark;
  return route.fulfill({ json: { success: true } });
});
const click = async (name) =>
  page.getByRole("button", { name, exact: true }).click();
const fill = async (name, value) =>
  page.getByRole("textbox", { name, exact: true }).fill(value);
await page.addInitScript(() => { if (!localStorage.getItem('aureli-mode')) localStorage.setItem('aureli-mode', 'demo'); });
try {
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:4173");
  await page.waitForSelector(".graph-node");
  assert.equal(await page.locator(".graph-node").count(), 6);
  await page.screenshot({ path: "artifacts/desktop.png", fullPage: true });
  await page
    .getByRole("button", { name: "删除 tile-001", exact: true })
    .first()
    .click();
  assert.equal(await page.locator(".graph-node").count(), 6);
  await click("删除 Tile");
  await page.waitForFunction(() => document.querySelectorAll(".graph-node").length === 5);
  assert.equal(requests.length, 0, "示例 Tile 删除不得请求后端");
  await page
    .getByRole("button", { name: "选择关联", exact: true })
    .nth(0)
    .click();
  await page
    .getByRole("button", { name: "选择关联", exact: true })
    .nth(0)
    .click();
  await click("添加Tile");
  await fill("提问内容 *", "多来源上下文示例");
  await click("生成示例 Tile");
  assert.equal(await page.locator(".graph-node").count(), 6);
  assert.equal(requests.length, 0);
  await click("重置画布");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator('dialog[aria-labelledby="workspace-modal-title"]').evaluate((d) => d.open), false);
  assert.equal(await page.locator(".graph-node").count(), 6);
  await page.getByRole("link", { name: "知识库管理", exact: true }).click();
  assert.equal(await page.locator("tbody tr").count(), 3);
  await click("编辑 知识图谱入门指南.md 备注");
  await fill("备注", "测试更新备注");
  await click("保存备注");
  assert.match(await page.locator("tbody").innerText(), /测试更新备注/);
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "upload.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# test"),
    });
  await click("上传到知识库");
  assert.equal(await page.locator("tbody tr").count(), 4);
  assert.equal(requests.length, 0);
  await click("进入工作区");
  await page.waitForSelector("text=test.md");
  await click("编辑 test.md 备注");
  await fill("备注", "接口备注测试");
  await click("保存备注");
  await page.waitForSelector("text=接口备注测试");
  await click("删除 test.md");
  assert.equal(requests.filter((r) => r.path.endsWith("/delete")).length, 0);
  await click("确认删除");
  await page.waitForSelector("text=知识库还没有文档");
  failure = true;
  await click("刷新");
  await page.waitForSelector("text=知识库加载失败");
  failure = false;
  await page.getByRole("link", { name: /^图谱工作台/ }).click();
  assert.equal(await page.locator(".graph-node").count(), 0);
  await click("添加Tile");
  await fill("提问内容 *", "验证接口请求");
  await click("发送并生成 Tile");
  await page.waitForSelector('.answer-text:has-text("接口模拟回答")');
  const sent = JSON.parse(
    requests.find((r) => r.path.endsWith("/completion")).body,
  );
  assert.deepEqual(sent.relatedTileIds, []);
  assert.equal(sent.memoryDepth, 3);
  assert.equal(sent.edgeWeight, 1);
  await click("重置画布");
  await click("确认重置");
  await page.waitForSelector("text=从一个问题，开始连接知识");
  await click("使用指南");
  await page.getByRole("dialog").getByRole("button", { name: "查看示例", exact: true }).click();
  await click("搜索与筛选");
  await fill("搜索 Tile", "不存在的查询");
  await click("应用筛选");
  await selectView(page, "Tile 列表");
  await page.waitForSelector("text=暂无匹配的 Tile");
  await selectView(page, "图谱视图");
  await click("搜索与筛选");
  await click("清除搜索和筛选");
  await click("应用筛选");
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `overflow at ${width}`,
    );
    if (width === 375) {
      if (await page.locator(".toast").count()) await click("关闭提示");
      await page.screenshot({ path: "artifacts/mobile.png", fullPage: true });
      await click("展开导航");
      await page.getByRole("link", { name: "知识库管理", exact: true }).click();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        "knowledge mobile overflow",
      );
      await page.waitForTimeout(200);
      await page.screenshot({
        path: "artifacts/mobile-knowledge.png",
        fullPage: true,
      });
      await click("展开导航");
      await page.getByRole("link", { name: /^图谱工作台/ }).click();
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await click("使用指南");
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() =>
      document.querySelector('dialog[aria-labelledby="workspace-modal-title"]').contains(document.activeElement),
    ),
    true,
  );
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: demo isolation, multiple contexts, SSE, CRUD, errors, reset, search, 4 responsive widths, modal keyboard, reduced motion; no browser errors",
  );
} finally {
  await browser.close();
}
