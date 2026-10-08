import assert from "node:assert/strict";
const playwright = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const engine = process.env.BROWSER_ENGINE || "chromium";
const browser = await playwright[engine].launch({ headless: true,
  ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], uploads = [];
page.on("pageerror", error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem("aureli-mode", "demo"));
await page.route("**/customer-service/**", route => {
  uploads.push(route.request().url());
  return route.fulfill({ json: { success: true, data: [] } });
});
const dialog = page.locator(".modal");
const open = async () => {
  await page.getByRole("button", { name: "添加文件", exact: true }).click();
  await page.getByRole("heading", { name: "添加文件", exact: true }).waitFor();
};
const assertClosed = async () => {
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await dialog.evaluate(el => el.open || el.matches(":modal")), false, "the native modal and its blocking backdrop are closed");
  // A real click verifies that the remaining canvas is no longer inert.
  await page.getByRole("button", { name: "Tile 列表", exact: true }).click();
  await page.getByRole("button", { name: "图谱视图", exact: true }).click();
};
const cancelPicker = async () => {
  // HTML specifies a bubbling, non-cancelable cancel event on the file input
  // when its native picker is dismissed (or the same file is selected again).
  await page.locator("#node-file").evaluate(input => input.dispatchEvent(new Event("cancel", { bubbles: true })));
  assert.equal(await dialog.evaluate(el => el.open && el.matches(":modal")), true, "canceling the file picker preserves the containing form");
  assert.equal(await page.getByRole("heading", { name: "添加文件", exact: true }).isVisible(), true, "picker cancellation must not empty the open dialog");
  assert.equal(await page.getByRole("button", { name: "取消", exact: true }).isVisible(), true);
};
try {
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:4173");
  await page.locator(".graph-node").first().waitFor();
  const tileCount = await page.locator(".graph-node").count();
  for (let attempt = 0; attempt < 12; attempt++) {
    await open();
    await cancelPicker();
    if (attempt % 3 === 0) await page.getByRole("button", { name: "取消", exact: true }).click();
    else if (attempt % 3 === 1) await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    else await page.keyboard.press("Escape");
    await assertClosed();
  }
  await open();
  await page.locator("#node-file").setInputFiles({ name: "保留选择.txt", mimeType: "text/plain", buffer: Buffer.from("selected file") });
  await cancelPicker();
  assert.equal(await page.locator("#node-file").evaluate(input => input.files[0]?.name), "保留选择.txt");
  await page.getByRole("button", { name: "添加到画布", exact: true }).click();
  await assertClosed();
  assert.equal(await page.locator(".graph-node", { hasText: "保留选择.txt" }).count(), 1, "the previous attachment remains usable after picker cancellation");
  assert.equal(await page.locator(".graph-node").count(), tileCount + 1, "canceling must not create attachments");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(); await cancelPicker();
  await page.keyboard.press("Escape"); await assertClosed();
  await page.setViewportSize({ width: 375, height: 812 });
  await open(); await cancelPicker();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await assertClosed();
  assert.deepEqual(errors, []);
  assert.deepEqual(uploads, [], "demo cancellation and upload stay local");
  console.log(`PASS (${engine}): bubbling picker cancellation, repeated open/cancel, footer/close/Escape, native backdrop cleanup, retained selection and upload, reduced motion and mobile layout`);
} finally { await browser.close(); }
