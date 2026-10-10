import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { selectView } from "./helpers/view-select.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem("aureli-mode", "demo"));
const output = new URL("../../output/view-select-preview/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
const trigger = page.locator(".view-select-trigger");
const menu = page.getByRole("listbox", { name: "视图选择" });

try {
  await page.goto(process.env.UI_TEST_URL || "http://127.0.0.1:5173");
  await page.waitForSelector(".graph-node");
  assert.match(await trigger.innerText(), /图谱视图/);
  assert.equal(await page.locator(".view-tabs").count(), 0);
  await trigger.click();
  await menu.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector(".view-select-drawer")?.getAnimations().length > 0);
  const slideFrame = await menu.evaluate(element => {
    const drawer = element.querySelector(".view-select-drawer");
    const animation = drawer.getAnimations()[0];
    animation.pause();
    animation.currentTime = 110;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(drawer).transform);
    const frame = { x: matrix.m41, y: matrix.m42, scaleX: matrix.m11, scaleY: matrix.m22,
      height: drawer.offsetHeight, opacity: getComputedStyle(drawer).opacity,
      mask: getComputedStyle(element).overflow };
    animation.play();
    return frame;
  });
  assert.equal(slideFrame.x, 0);
  assert.equal(slideFrame.scaleX, 1);
  assert.equal(slideFrame.scaleY, 1);
  assert.equal(slideFrame.opacity, "1");
  assert.equal(slideFrame.mask, "clip");
  assert.ok(slideFrame.y < 0 && slideFrame.y > -slideFrame.height);
  assert.equal(await trigger.getAttribute("aria-expanded"), "true");
  assert.equal(await menu.getByRole("option").count(), 3);
  assert.equal(await menu.getByRole("option", { name: "图谱视图" }).getAttribute("aria-selected"), "true");
  await page.locator('.view-select-enter-active').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('.view-select-content').getBoundingClientRect().top >= document.querySelector('.view-select-trigger').getBoundingClientRect().bottom);
  const bounds = await menu.boundingBox();
  const triggerBounds = await trigger.boundingBox();
  assert.ok(bounds.y >= triggerBounds.y + triggerBounds.height);
  assert.ok(Math.abs(bounds.width - triggerBounds.width) < 1);
  await page.screenshot({ path: `${output}dropdown-open.png` });

  // Pointer dismissal keeps the panel mounted while it animates back to its trigger.
  await page.mouse.click(bounds.x + bounds.width + 30, bounds.y + 15);
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator(".view-select-leave-active").count(), 1);
  assert.equal(await menu.evaluate(element => getComputedStyle(element).pointerEvents), "none");
  await menu.waitFor({ state: "hidden" });

  await selectView(page, "Tile 列表");
  assert.equal(await page.locator(".tile-list article").count(), 6);
  assert.equal(await page.locator(".graph-node").count(), 0);
  assert.match(await trigger.innerText(), /Tile 列表/);
  await selectView(page, "图谱视图");
  assert.equal(await page.locator(".graph-node").count(), 6);

  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await menu.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "option");
  await page.keyboard.press("End");
  await page.waitForFunction(() => document.activeElement?.textContent.includes("分支对话"));
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(() => document.activeElement?.textContent.includes("Tile 列表"));
  await page.keyboard.press("Enter");
  await menu.waitFor({ state: "hidden" });
  assert.match(await trigger.innerText(), /Tile 列表/);
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
  await page.keyboard.press("Enter");
  await menu.waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true);

  // Reopening during a pointer exit must settle into a usable single panel.
  await trigger.click();
  await menu.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector(".view-select-content")?.getBoundingClientRect().top > 0);
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "option");
  await page.locator(".view-select-enter-active").waitFor({ state: "detached" });
  await page.mouse.click(1100, 100);
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  await trigger.click();
  await menu.waitFor({ state: "visible" });
  assert.equal(await page.locator(".view-select-content").count(), 1);
  await page.getByRole("option", { name: "图谱视图", exact: true }).click();
  await menu.waitFor({ state: "hidden" });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await trigger.click();
  await menu.waitFor({ state: "visible" });
  assert.equal(await menu.evaluate(element => getComputedStyle(element).transform), "none");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  await page.emulateMedia({ reducedMotion: "no-preference" });

  for (const width of [375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await trigger.click();
    await menu.waitFor({ state: "visible" });
    const box = await menu.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width);
    if (width === 375) {
      await page.locator('.view-select-enter-active').waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.querySelector('.view-select-content').getBoundingClientRect().top >= document.querySelector('.view-select-trigger').getBoundingClientRect().bottom);
      await page.screenshot({ path: `${output}dropdown-mobile.png` });
    }
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
  }
  assert.deepEqual(errors, []);
  console.log("View dropdown: clipped drawer translation without scaling or fading, view switching, pointer exit animation, keyboard selection/focus, rapid reopen, reduced motion and mobile positioning passed.");
} finally {
  await browser.close();
}
