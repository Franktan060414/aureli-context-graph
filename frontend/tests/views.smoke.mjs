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
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
let modelSettings = {
  chat: {
    provider: "local",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "llama3:latest",
    keyConfigured: true,
  },
  embedding: {
    provider: "local",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3-embedding:4b",
    keyConfigured: true,
  },
  dimensions: 1536,
};
const errors = [],
  writes = [],
  connectionTests = [];
let testShouldFail = false;
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/customer-service/model-settings**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith("/test")) {
    connectionTests.push(path);
    if (testShouldFail)
      return route.fulfill({
        json: { success: false, message: "模拟连接失败" },
      });
    return route.fulfill({
      json: {
        success: true,
        data: { model: modelSettings.chat.model, reply: "连接成功" },
      },
    });
  }
  if (route.request().method() === "POST") {
    const payload = JSON.parse(route.request().postData());
    writes.push(payload);
    modelSettings = {
      dimensions: payload.dimensions,
      chat: { ...payload.chat, keyConfigured: true },
      embedding: { ...payload.embedding, keyConfigured: true },
    };
    delete modelSettings.chat.apiKey;
    delete modelSettings.embedding.apiKey;
  }
  return route.fulfill({ json: { success: true, data: modelSettings } });
});
const click = async (name) =>
  page.getByRole("button", { name, exact: true }).click();
await page.addInitScript(() => { if (!localStorage.getItem('aureli-mode')) localStorage.setItem('aureli-mode', 'demo'); });
try {
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:4173");
  await page.waitForSelector(".graph-node");
  assert.equal(
    await page.getByRole("link", { name: "操作记录", exact: true }).count(),
    0,
  );
  await click("全页面查看图谱");
  const fullscreen = page.getByRole("dialog", { name: "全页面图谱视图" });
  assert.equal(await fullscreen.isVisible(), true);
  assert.equal(
    await fullscreen.evaluate(
      (d) => d.clientWidth === innerWidth && d.clientHeight === innerHeight,
    ),
    true,
  );
  await page.screenshot({
    path: "artifacts/fullscreen-graph.png",
    fullPage: false,
  });
  await fullscreen
    .getByRole("button", { name: "全页面查看 tile-003", exact: true })
    .click();
  assert.match(await page.locator(".reading-answer").innerText(), /RAG/);
  await page.screenshot({
    path: "artifacts/fullscreen-tile.png",
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await page.locator(".fullscreen-viewer").waitFor({ state: "detached" });
  assert.equal(await page.locator(".fullscreen-viewer").count(), 0);
  await click("全页面查看 tile-002");
  assert.match(await page.locator(".reading-question").innerText(), /文档/);
  await page.locator(".fullscreen-header .secondary").click();
  await page.locator(".fullscreen-viewer").waitFor({ state: "detached" });
  assert.equal(await page.locator(".fullscreen-viewer").count(), 0);
  await page.getByRole("link", { name: "服务设置", exact: true }).click();
  await page.waitForSelector("#chat-model:not(:disabled)");
  assert.equal(await page.getByText("工作区说明", { exact: true }).count(), 0);
  await page.locator("[name=chat-provider]").nth(1).check();
  await page.locator("[name=embedding-provider]").nth(1).check();
  assert.equal(await page.locator("#chat-model").inputValue(), "gpt-4.1-mini");
  assert.equal(
    await page.locator("#embedding-model").inputValue(),
    "text-embedding-3-small",
  );
  await click("保存并应用");
  assert.equal(writes.length, 0);
  await page.locator("#chat-api-key").fill("fixture-chat-secret");
  await page.locator("#embedding-api-key").fill("fixture-embedding-secret");
  await click("保存并应用");
  await page.waitForSelector("text=配置已保存，后续请求使用新模型。");
  assert.equal(writes[0].chat.provider, "openai");
  assert.equal(writes[0].embedding.model, "text-embedding-3-small");
  assert.equal(await page.locator("#chat-api-key").inputValue(), "");
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify(localStorage).includes("fixture-chat-secret"),
    ),
    false,
  );
  if (await page.locator(".toast").count()) await click("关闭提示");
  await click("测试链接");
  await page.waitForSelector("text=gpt-4.1-mini 返回：连接成功");
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector(".test-connection")).backgroundColor === "rgb(21, 122, 59)",
  );
  assert.equal(
    await page.locator(".test-connection").evaluate((element) =>
      getComputedStyle(element).backgroundColor,
    ),
    "rgb(21, 122, 59)",
  );
  assert.equal(connectionTests.length, 1);
  assert.equal(writes.length, 1, "测试连接不得再次保存或提交页面配置");
  if (await page.locator(".toast").count()) await click("关闭提示");
  testShouldFail = true;
  await page.locator(".test-connection").click();
  await page.getByText("模拟连接失败", { exact: true }).waitFor();
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector(".test-connection")).backgroundColor === "rgb(180, 35, 47)",
  );
  assert.equal(
    await page.locator(".test-connection").evaluate((element) =>
      getComputedStyle(element).backgroundColor,
    ),
    "rgb(180, 35, 47)",
  );
  await page.reload();
  await page.waitForSelector("#chat-model:not(:disabled)");
  assert.equal(
    await page.locator(".test-connection").evaluate((element) =>
      getComputedStyle(element).backgroundColor,
    ),
    "rgb(255, 190, 0)",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "artifacts/api-settings.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "settings mobile overflow",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/mobile-api-settings.png",
    fullPage: true,
  });
  await click("展开导航");
  await page.getByRole("link", { name: /^图谱工作台/ }).click();
  await click("全页面查看 tile-001");
  assert.equal(
    await page
      .locator(".fullscreen-viewer")
      .evaluate((d) => d.clientWidth === innerWidth),
    true,
  );
  await page.locator(".fullscreen-header .secondary").click();
  await page.locator(".fullscreen-viewer").waitFor({ state: "detached" });
  await click("全页面查看图谱");
  await page.keyboard.press("Escape");
  await page.locator(".fullscreen-viewer").waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: removed activity, full-page graph, full-page Tile, Escape and exit, responsive settings, provider switching, required keys, save/apply, no browser credential persistence.",
  );
} finally {
  await browser.close();
}
