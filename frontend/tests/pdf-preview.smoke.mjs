import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");

// Two actual PDF pages, including a red embedded image on the first page.
const first = "BT /F1 20 Tf 30 440 Td (Aureli PDF preview) Tj ET\nq 100 0 0 100 30 280 cm /Im1 Do Q";
const second = "BT /F1 20 Tf 30 440 Td (Second page) Tj ET";
const stream = (text) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R 7 0 R] /Count 2 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", stream(first),
  Buffer.concat([Buffer.from("<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 12 >>\nstream\n"), Buffer.from([255,0,0,255,0,0,255,0,0,255,0,0]), Buffer.from("\nendstream")]),
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 4 0 R >> >> /Contents 8 0 R >>", stream(second),
];
const parts = [Buffer.from("%PDF-1.4\n")], offsets = [0];
let length = parts[0].length;
objects.forEach((object, index) => {
  offsets.push(length);
  const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(object), Buffer.from("\nendobj\n")]);
  parts.push(part); length += part.length;
});
parts.push(Buffer.from(`xref\n0 9\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`));
const pdf = Buffer.concat(parts);
const fileTile = (id, name) => ({ id, tileType: "FILE", kind: "file", title: name, message: name, answer: name, fileName: name, fileSize: pdf.length, fileContentType: "application/pdf", relatedTileIds: [], status: "ready", weight: 1 });
const tiles = [fileTile("pdf-a", "文字与图片.PDF"), fileTile("pdf-b", "第二份.pdf"), fileTile("text-a", "原有附件.txt")];
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
let missing = false, delayFile = false, releaseFile, requests = 0;
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem("aureli-mode", "live");
  localStorage.setItem("aureli-api-base", "http://backend.test");
  window.previewUrls = { created: [], revoked: [] };
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = blob => { const url = create(blob); window.previewUrls.created.push(url); return url; };
  URL.revokeObjectURL = url => { window.previewUrls.revoked.push(url); revoke(url); };
});
await page.route("http://backend.test/customer-service/**", async route => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith("/workspace")) return route.fulfill({ json: { success: true, data: { tiles, edges: [] } } });
  if (path.endsWith("/file")) {
    requests++;
    if (delayFile) await new Promise(resolve => { releaseFile = resolve; });
    if (missing) return route.fulfill({ status: 404, json: { success: false, message: "文件不存在" } });
    return route.fulfill({ contentType: "application/octet-stream", headers: { "Content-Disposition": 'attachment; filename="preview.pdf"' }, body: pdf });
  }
  return route.fulfill({ json: { success: true, data: [] } });
});
const openPdf = async id => page.getByRole("button", { name: `全页面查看 ${id}`, exact: true }).click();
const pdfFrame = () => page.frames().find(frame => frame.url().includes("/pdfjs-6.4.299-dist/web/viewer.html"));
const waitRendered = async () => {
  await page.locator('.pdf-document-viewer[aria-busy="false"] iframe').waitFor();
  const frame = pdfFrame();
  await frame.waitForFunction(() => document.querySelector('.page[data-page-number="1"] canvas') && window.PDFViewerApplication.pdfDocument?.numPages === 2);
  await frame.waitForFunction(() => document.querySelector('.page[data-page-number="1"] .textLayer')?.textContent.includes("Aureli PDF preview"));
  return frame;
};
try {
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:4173");
  await openPdf("pdf-a");
  const frame = await waitRendered();
  assert.equal(await page.getByRole("heading", { name: "文字与图片.PDF" }).isVisible(), true);
  assert.equal(await frame.locator('link[href$="aureli-viewer.css"]').count(), 1);
  await frame.locator("#viewFindButton").click();
  await frame.locator("#findInput").fill("Aureli");
  await frame.locator("#findInput").press("Escape");
  await frame.waitForFunction(() => !window.PDFViewerApplication.findBar.opened);
  assert.equal(await page.locator(".fullscreen-viewer").count(), 1, "Escape closes PDF search first");
  assert.equal(await frame.evaluate(() => {
    const canvas = document.querySelector('.page[data-page-number="1"] canvas');
    const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    let red = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 240 && data[i + 1] < 20 && data[i + 2] < 20) red++;
    return red > 100;
  }), true, "embedded PDF image is painted");
  await frame.locator("#pageNumber").fill("2");
  await frame.locator("#pageNumber").press("Enter");
  await frame.waitForFunction(() => window.PDFViewerApplication.page === 2);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "下载原文件", exact: true }).click(),
  ]);
  assert.equal(download.suggestedFilename(), "文字与图片.PDF");
  await mkdir("artifacts", { recursive: true });
  await frame.locator("#pageNumber").fill("1");
  await frame.locator("#pageNumber").press("Enter");
  await page.screenshot({ path: "artifacts/pdf-preview.png" });
  // Escape while focused inside the embedded reader must exit the outer dialog.
  await frame.locator("#pageNumber").press("Escape");
  await page.locator(".fullscreen-viewer").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => previewUrls.revoked.includes(previewUrls.created[0])), true);
  await openPdf("text-a");
  assert.equal(await page.locator(".pdf-document-viewer").count(), 0);
  await page.getByRole("button", { name: /退出全页面/ }).click();
  await page.locator(".fullscreen-viewer").waitFor({ state: "detached" });
  missing = true;
  await openPdf("pdf-b");
  await page.getByRole("alert").filter({ hasText: "文件不存在" }).waitFor();
  missing = false;
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await waitRendered();
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.getByRole("button", { name: /退出全页面/ }).isVisible(), true);
  assert.equal(await page.locator(".fullscreen-viewer").evaluate(el => el.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: "artifacts/pdf-preview-mobile.png" });
  await page.getByRole("button", { name: /退出全页面/ }).click();
  await page.locator(".fullscreen-viewer").waitFor({ state: "detached" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const before = await page.evaluate(() => previewUrls.created.length);
  delayFile = true;
  const delayedRequest = page.waitForRequest(request => request.url().endsWith('/tile/pdf-a/file'));
  await openPdf("pdf-a");
  const request = await delayedRequest;
  await page.getByRole("button", { name: /退出全页面/ }).click();
  await page.locator(".fullscreen-viewer").waitFor({ state: "detached" });
  const finished = page.waitForEvent("requestfinished", { predicate: item => item === request });
  releaseFile();
  await finished;
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
  assert.equal(await page.evaluate(() => previewUrls.created.length), before, "closing during a request does not leak a Blob URL");
  delayFile = false;
  await openPdf("pdf-b");
  await waitRendered();
  assert.equal(await page.getByRole("heading", { name: "第二份.pdf" }).isVisible(), true);
  await page.getByRole("button", { name: /退出全页面/ }).click();
  await page.locator(".fullscreen-viewer").waitFor({ state: "detached" });
  // Demo uploads use the in-memory File without calling the backend download API.
  await page.evaluate(() => localStorage.setItem("aureli-mode", "demo"));
  // Init scripts restore live mode on reload, so explicitly set demo last.
  await page.addInitScript(() => localStorage.setItem("aureli-mode", "demo"));
  await page.reload();
  await page.getByRole("button", { name: "添加文件", exact: true }).click();
  await page.locator("#node-file").setInputFiles({ name: "本地示例.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "添加到画布", exact: true }).click();
  await page.locator(".modal").waitFor({ state: "hidden" });
  const demoNode = page.locator(".graph-node", { hasText: "本地示例.pdf" });
  const beforeDemo = requests;
  await demoNode.locator('button[aria-label^="全页面查看"]').click();
  await waitRendered();
  assert.equal(requests, beforeDemo, "demo PDF preview stays local");
  assert.deepEqual(errors, []);
  console.log(`PASS: PDF text/image rendering, paging, download, iframe/search Escape, failure/retry, mobile layout, late requests, demo isolation and custom backend (${requests} file requests)`);
} catch (error) {
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/pdf-preview-failure.png" });
  console.error("Browser errors:", errors);
  throw error;
} finally { releaseFile?.(); await browser.close(); }
