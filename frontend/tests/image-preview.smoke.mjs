import { selectView } from "./helpers/view-select.js";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const fixtures = await page.evaluate(() => {
  const canvas = document.createElement("canvas");
  canvas.width = 1200; canvas.height = 800;
  const context = canvas.getContext("2d");
  context.fillStyle = "#0066cc"; context.fillRect(0, 0, 1200, 800);
  context.fillStyle = "#ffbe00"; context.fillRect(100, 100, 400, 600);
  context.fillStyle = "white"; context.font = "bold 60px Arial"; context.fillText("Image preview", 550, 420);
  return Object.fromEntries(["png", "jpeg", "webp"].map(type => [type, canvas.toDataURL(`image/${type}`).split(",")[1]]));
});
const png = Buffer.from(fixtures.png, "base64");
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="600"><script>window.svgExecuted=true</script><rect width="300" height="600" fill="#ffbe00"/><circle cx="150" cy="300" r="100" fill="#0066cc"/></svg>');
const fileTile = (id, name, type = "application/octet-stream") => ({ id, tileType: "FILE", kind: "file", title: name, message: name, answer: name, fileName: name, fileContentType: type, fileSize: png.length, relatedTileIds: [], status: "ready", weight: 1 });
const tiles = [fileTile("image-a", "图片.PNG"), fileTile("image-mime", "没有扩展名", "image/png"), fileTile("image-broken", "损坏.png"), fileTile("image-missing", "丢失.png"), fileTile("image-svg", "纵向.svg"), fileTile("file-text", "原有附件.txt")];
let broken = true, missing = true, delay = false, releaseFile, serial = 0;
const counts = {}, errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem("aureli-mode", "live");
  localStorage.setItem("aureli-api-base", "http://backend.test");
  localStorage.setItem("aureli-tile-layouts", JSON.stringify({ "live:http://backend.test": {
    "image-a": { x: 24, y: 24 }, "image-mime": { x: 340, y: 24 },
    "image-broken": { x: 24, y: 256 }, "image-missing": { x: 340, y: 256 },
    "image-svg": { x: 24, y: 488 }, "file-text": { x: 340, y: 488 },
  } }));
  window.previewUrls = { created: [], revoked: [] };
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = blob => { const url = create(blob); previewUrls.created.push(url); return url; };
  URL.revokeObjectURL = url => { previewUrls.revoked.push(url); revoke(url); };
});
await page.route("http://backend.test/customer-service/**", async route => {
  if (new URL(route.request().url()).pathname.endsWith('/maps')) return route.fulfill({ json: { success: true, data: [{ mapId: 'default', name: '默认图谱' }] } });
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith("/workspace")) return route.fulfill({ json: { success: true, data: { tiles, edges: [] } } });
  if (path === "/customer-service/tile/file") {
    const tile = fileTile(`uploaded-${++serial}`, "上传图片.png", "image/png");
    tiles.push(tile);
    return route.fulfill({ json: { success: true, data: tile } });
  }
  const id = path.match(/\/tile\/([^/]+)\/file$/)?.[1];
  if (id) {
    counts[id] = (counts[id] || 0) + 1;
    if (id === "image-a" && delay) await new Promise(resolve => { releaseFile = resolve; });
    if (id === "image-missing" && missing) return route.fulfill({ status: 404, json: { success: false, message: "文件不存在" } });
    return route.fulfill({ contentType: "application/octet-stream", headers: { "Content-Disposition": 'attachment; filename="image.png"' }, body: id === "image-broken" && broken ? Buffer.from("broken image") : id === "image-svg" ? svg : png });
  }
  return route.fulfill({ json: { success: true, data: [] } });
});
const node = id => page.locator(".graph-node").filter({ has: page.getByRole("button", { name: `全页面查看 ${id}`, exact: true }) });
const open = id => page.getByRole("button", { name: `全页面查看 ${id}`, exact: true }).click();
const rendered = async () => {
  await page.locator('.image-file-viewer[aria-busy="false"] img').waitFor();
  assert.equal(await page.locator(".image-file-viewer img").evaluate(el => el.complete && el.naturalWidth > 0), true);
  await page.locator(".fullscreen-viewer").evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
};
const close = async () => {
  await page.getByRole("button", { name: /退出全页面/ }).click();
  await page.locator(".fullscreen-viewer").waitFor({ state: "detached" });
};
try {
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:4173");
  await node("image-a").locator("img").waitFor();
  assert.equal(await node("image-a").locator("img").evaluate(el => el.naturalWidth), 1200);
  await node("image-mime").locator("img").waitFor();
  await node("image-svg").locator("img").waitFor();
  assert.equal(await node("image-svg").locator("img").evaluate(el => el.naturalHeight), 600);
  assert.equal(await node("file-text").locator(".image-thumbnail").count(), 0);
  const thumbUrl = await node("image-a").locator("img").getAttribute("src");
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/image-preview-canvas.png" });
  await open("image-a");
  await rendered();
  assert.equal(counts["image-a"], 1, "thumbnail and full-page share one request");
  assert.equal(await page.locator(".image-file-viewer img").getAttribute("src"), thumbUrl);
  assert.equal(await page.getByRole("heading", { name: "图片.PNG" }).isVisible(), true);
  await page.getByLabel("图片显示比例").selectOption("2");
  assert.equal(await page.locator(".image-file-viewer img").evaluate(el => el.getBoundingClientRect().width), 2400);
  assert.equal(await page.locator(".image-preview-scroll").evaluate(el => el.scrollWidth > el.clientWidth), true);
  await page.getByLabel("图片显示比例").selectOption("fit");
  await page.screenshot({ path: "artifacts/image-preview.png" });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "下载原文件", exact: true }).click()]);
  assert.equal(download.suggestedFilename(), "图片.PNG");
  await page.getByLabel("图片显示比例").press("Escape");
  await page.locator(".fullscreen-viewer").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(url => previewUrls.revoked.includes(url), thumbUrl), false, "closing preserves a visible thumbnail");
  await open("image-mime"); await rendered(); await close();
  await open("image-broken");
  await page.getByRole("alert").filter({ hasText: "图片无法预览" }).waitFor();
  broken = false;
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await rendered(); await close();
  await node("image-broken").locator("img").waitFor();
  await open("image-missing");
  await page.getByRole("alert").filter({ hasText: "文件不存在" }).waitFor();
  missing = false;
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await rendered(); await close();
  await node("image-missing").locator("img").waitFor();
  await open("image-svg"); await rendered();
  assert.equal(await page.evaluate(() => !!window.svgExecuted), false, "SVG is displayed as an image");
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.locator(".fullscreen-viewer").evaluate(el => el.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator(".image-preview-scroll").evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight), true, "fit keeps the entire portrait image in the viewport");
  await page.screenshot({ path: "artifacts/image-preview-mobile.png" });
  await close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "全页面查看图谱", exact: true }).click();
  await page.locator(".fullscreen-viewer .image-thumbnail img").first().waitFor();
  await page.locator(".fullscreen-viewer").getByRole("button", { name: "全页面查看 image-a", exact: true }).click();
  await rendered(); await close();
  await selectView(page, "Tile 列表");
  await page.waitForFunction(() => previewUrls.created.every(url => previewUrls.revoked.includes(url)));
  // Opening from the list and closing during download must not create a late URL.
  delay = true;
  const before = await page.evaluate(() => previewUrls.created.length);
  const request = page.waitForRequest(req => req.url().endsWith("/tile/image-a/file"));
  await open("image-a"); await request;
  await close();
  const finished = page.waitForResponse(response => response.url().endsWith("/tile/image-a/file"));
  releaseFile();
  await finished;
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
  assert.equal(await page.evaluate(() => previewUrls.created.length), before);
  delay = false;
  await selectView(page, "图谱视图");
  await page.getByRole("button", { name: "添加文件", exact: true }).click();
  await page.locator("#node-file").setInputFiles({ name: "上传图片.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "添加到画布", exact: true }).click();
  await page.locator(".modal").waitFor({ state: "hidden" });
  await node("uploaded-1").scrollIntoViewIfNeeded();
  await node("uploaded-1").locator("img").waitFor();
  await page.reload();
  await node("uploaded-1").scrollIntoViewIfNeeded();
  await node("uploaded-1").locator("img").waitFor();
  // Demo uploads stay local for PNG, JPEG, WebP, GIF and SVG.
  const beforeDemo = JSON.stringify(counts);
  await page.addInitScript(() => localStorage.setItem("aureli-mode", "demo"));
  await page.reload();
  const demoFixtures = [["png", "image/png", png], ["jpg", "image/jpeg", Buffer.from(fixtures.jpeg, "base64")], ["webp", "image/webp", Buffer.from(fixtures.webp, "base64")], ["gif", "image/gif", Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")], ["svg", "image/svg+xml", svg]];
  for (const [extension, mimeType, buffer] of demoFixtures) {
    const name = `本地图片.${extension}`;
    await page.getByRole("button", { name: "添加文件", exact: true }).click();
    await page.locator("#node-file").setInputFiles({ name, mimeType, buffer });
    await page.getByRole("button", { name: "添加到画布", exact: true }).click();
    await page.locator(".modal").waitFor({ state: "hidden" });
    const tile = page.locator(".graph-node", { hasText: name });
    await tile.scrollIntoViewIfNeeded(); await tile.locator("img").waitFor();
    await tile.locator('button[aria-label^="全页面查看"]').click();
    await rendered(); await close();
  }
  assert.equal(JSON.stringify(counts), beforeDemo, "demo previews do not download from the backend");
  assert.deepEqual(errors, []);
  console.log("PASS: image upload/reload, canvas/full-page rendering, MIME/extension detection, shared requests, zoom, downloads, Escape, failure/retry, mobile portrait, full-page graph, URL cleanup, late requests, SVG isolation and local PNG/JPEG/WebP/GIF/SVG previews");
} catch (error) {
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/image-preview-failure.png" });
  console.error("Browser errors:", errors);
  throw error;
} finally { releaseFile?.(); await browser.close(); }
