import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import JSZip from "jszip";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");

// A real OOXML fixture with Chinese text, a table, a picture, two pages and headers/footers.
const crc32 = data => {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]), header = Buffer.alloc(4), checksum = Buffer.alloc(4);
  header.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([header, body, checksum]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
const picture = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0,0,102,204,255,0,102,204,255,0,0,102,204,255,0,102,204,255]))), chunk("IEND", Buffer.alloc(0))]);
const zip = new JSZip();
zip.file("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`);
zip.file("_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
zip.file("word/_rels/document.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[["Styles","styles","styles.xml"],["Header","header","header1.xml"],["Footer","footer","footer1.xml"],["Image","image","media/image.png"]].map(([id,type,target]) => `<Relationship Id="rId${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join("")}<Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test" TargetMode="External"/></Relationships>`);
zip.file("word/styles.xml", `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="PingFang SC"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`);
zip.file("word/header1.xml", `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>AURELI 页眉</w:t></w:r></w:p></w:hdr>`);
zip.file("word/footer1.xml", `<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>测试文档页脚</w:t></w:r></w:p></w:ftr>`);
zip.file("word/media/image.png", picture);
zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
<w:p><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t>DOCX 完整文档预览</w:t></w:r></w:p>
<w:p><w:r><w:t>这是包含文字、图片和表格的测试文档。</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>项目</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>验证结果</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Blue square"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Blue square"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>外部链接</w:t></w:r></w:hyperlink></w:p>
<w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>第二页正文完整可见</w:t></w:r></w:p>
<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr></w:body></w:document>`);
const docx = await zip.generateAsync({ type: "nodebuffer" });
const tile = (id, name) => ({ id, tileType:"FILE", kind:"file", title:name, message:name, answer:name, fileName:name, fileSize:docx.length, fileContentType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document", relatedTileIds:[], status:"ready", weight:1 });
const tiles = [tile("docx-a", "文字图片表格.DOCX"), tile("docx-b", "第二份.docx")];
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath:process.env.BROWSER_EXECUTABLE_PATH } : {}) });
const page = await browser.newPage({ viewport:{ width:1440, height:1000 } });
let missing = false, corrupt = false, delay = false, release, requests = 0;
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.addInitScript(() => { localStorage.setItem("aureli-mode", "live"); localStorage.setItem("aureli-api-base", "http://backend.test"); });
await page.route("http://backend.test/customer-service/**", async route => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith("/workspace")) return route.fulfill({ json:{ success:true, data:{ tiles, edges:[] } } });
  if (path.endsWith("/file")) {
    requests++;
    if (delay) await new Promise(resolve => { release = resolve; });
    if (missing) return route.fulfill({ status:404, json:{ success:false, message:"文件不存在" } });
    return route.fulfill({ contentType:"application/octet-stream", body:corrupt ? Buffer.from("broken DOCX") : docx });
  }
  return route.fulfill({ json:{ success:true, data:[] } });
});
const open = id => page.getByRole("button", { name:`全页面查看 ${id}`, exact:true }).click();
const close = async () => { await page.getByRole("button", { name:/退出全页面/ }).click(); await page.locator(".fullscreen-viewer").waitFor({ state:"detached" }); };
const rendered = async () => {
  await page.locator('.docx-document-viewer[aria-busy="false"] iframe').waitFor();
  const frame = await page.locator(".docx-document-viewer iframe").elementHandle().then(handle => handle.contentFrame());
  await frame.getByText("第二页正文完整可见", { exact:true }).waitFor();
  return frame;
};
try {
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:4173");
  const sidebarColor = await page.locator(".sidebar").evaluate(el => getComputedStyle(el).backgroundColor);
  await open("docx-a");
  let frame = await rendered();
  assert.equal(await frame.locator("section.docx").count(), 2);
  assert.match(await frame.locator("table").innerText(), /项目.*验证结果/s);
  assert.equal(await frame.locator("header").first().innerText(), "AURELI 页眉");
  assert.equal(await frame.locator("footer").first().innerText(), "测试文档页脚");
  assert.equal(await frame.locator("img").evaluate(image => image.complete && image.naturalWidth === 2 && image.src.startsWith("data:image/png")), true);
  assert.equal(await page.locator(".sidebar").evaluate(el => getComputedStyle(el).backgroundColor), sidebarColor, "document styling stays isolated");
  await frame.getByText("外部链接", { exact:true }).click();
  assert.equal(frame.url(), "about:srcdoc");
  await page.getByLabel("DOCX 显示比例").selectOption("1.5");
  await page.waitForFunction(() => document.querySelector(".docx-document-viewer iframe").contentDocument.querySelector(".docx-wrapper").style.zoom === "1.5");
  await page.getByLabel("DOCX 显示比例").selectOption("fit");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name:"下载原文件", exact:true }).click()]);
  assert.equal(download.suggestedFilename(), "文字图片表格.DOCX");
  await mkdir("artifacts", { recursive:true });
  await page.screenshot({ path:"artifacts/docx-preview.png" });
  await frame.locator("body").press("Escape");
  await page.locator(".fullscreen-viewer").waitFor({ state:"detached" });
  missing = true;
  await open("docx-b");
  await page.getByRole("alert").filter({ hasText:"文件不存在" }).waitFor();
  missing = false;
  await page.getByRole("button", { name:"重新加载", exact:true }).click();
  frame = await rendered();
  await page.setViewportSize({ width:375, height:812 });
  // Poll from the app: timers/rAF are disabled inside the script-free reader.
  await page.waitForFunction(() => {
    const frame = document.querySelector(".docx-document-viewer iframe");
    return frame.contentDocument.documentElement.scrollWidth <= frame.contentWindow.innerWidth + 1;
  });
  assert.equal(await page.locator(".fullscreen-viewer").evaluate(el => el.scrollWidth <= innerWidth), true);
  await page.screenshot({ path:"artifacts/docx-preview-mobile.png" });
  await close();
  await page.setViewportSize({ width:1440, height:1000 });
  corrupt = true;
  await open("docx-a");
  await page.getByRole("alert").filter({ hasText:"DOCX 预览失败" }).waitFor();
  corrupt = false;
  await page.getByRole("button", { name:"重新加载", exact:true }).click();
  await rendered();
  await close();
  delay = true;
  const delayed = page.waitForRequest(request => request.url().endsWith("/tile/docx-a/file"));
  await open("docx-a");
  const request = await delayed;
  await close();
  const finished = page.waitForEvent("requestfinished", { predicate:item => item === request });
  release(); await finished;
  delay = false;
  await open("docx-b"); await rendered();
  assert.equal(await page.getByRole("heading", { name:"第二份.docx" }).isVisible(), true);
  await close();
  await page.addInitScript(() => localStorage.setItem("aureli-mode", "demo"));
  await page.reload();
  await page.getByRole("button", { name:"添加文件", exact:true }).click();
  await page.locator("#node-file").setInputFiles({ name:"示例.docx", mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer:docx });
  await page.getByRole("button", { name:"添加到画布", exact:true }).click();
  await page.locator(".modal").waitFor({ state:"hidden" });
  const beforeDemo = requests;
  await page.locator(".graph-node", { hasText:"示例.docx" }).locator('button[aria-label^="全页面查看"]').click();
  await rendered(); assert.equal(requests, beforeDemo, "demo document stays local");
  assert.deepEqual(errors, []);
  console.log("PASS: DOCX text/images/tables/pages/header/footer, style isolation, zoom, download, iframe Escape, retry/corrupt file, mobile fit, late request, custom backend and demo isolation");
} catch (error) {
  await mkdir("artifacts", { recursive:true });
  await page.screenshot({ path:"artifacts/docx-preview-failure.png" });
  const documentFrame = await page.locator(".docx-document-viewer iframe").elementHandle().then(handle => handle?.contentFrame());
  if (documentFrame) console.error("Reader dimensions:", await documentFrame.evaluate(() => ({ viewport:innerWidth, scroll:document.documentElement.scrollWidth, wrapper:document.querySelector(".docx-wrapper")?.getBoundingClientRect().width, zoom:document.querySelector(".docx-wrapper")?.style.zoom })));
  console.error("Browser errors:", errors); throw error;
} finally { release?.(); await browser.close(); }
