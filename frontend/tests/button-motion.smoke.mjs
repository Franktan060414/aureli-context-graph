import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const url = process.env.UI_TEST_URL || 'http://127.0.0.1:5173';
const artifact = name => new URL(`../artifacts/${name}`, import.meta.url).pathname;
await mkdir(new URL('../artifacts', import.meta.url), { recursive: true });
await page.addInitScript(() => localStorage.setItem('aureli-mode', 'demo'));
await page.route('**/customer-service/model-settings', route => route.fulfill({ json: { success: true, data: { chat: { provider: 'local', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3:latest', keyConfigured: true }, embedding: { provider: 'local', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3-embedding:4b', keyConfigured: true }, dimensions: 1536 } } }));
const white = 'rgb(255, 255, 255)', blue = 'rgb(0, 102, 204)', yellow = 'rgb(255, 190, 0)', ink = 'rgb(0, 64, 128)', black = 'rgb(16, 16, 16)';
const errors = []; page.on('pageerror', e => errors.push(e.message));
async function state(control) {
 return control.evaluate(e => { const s = getComputedStyle(e), f = getComputedStyle(e, '::after'); return { background: s.backgroundColor, color: s.color, fill: f.backgroundColor, radius: s.borderRadius, fillRadius: f.borderRadius, x: f.transform === 'none' ? 0 : new DOMMatrix(f.transform).m41, duration: f.transitionDuration, width: e.getBoundingClientRect().width, position: s.position, easing: f.transitionTimingFunction }; });
}
async function until(control, filled) {
 const selector = await control.evaluate(e => { e.dataset.motionTest ||= crypto.randomUUID(); return `[data-motion-test="${e.dataset.motionTest}"]`; });
 await page.waitForFunction(({ selector, filled }) => { const e = document.querySelector(selector), f = getComputedStyle(e, '::after'), x = f.transform === 'none' ? 0 : new DOMMatrix(f.transform).m41; const settled = !document.getAnimations().some(a => a.effect.target === e && a.playState === 'running'); return settled && (filled ? Math.abs(x) < .01 : x < -e.getBoundingClientRect().width * .95); }, { selector, filled });
}
const away = () => page.mouse.move(2, 2);
async function pauseAt(control, time) { return control.evaluate((e, time) => { const a = document.getAnimations().find(a => a.effect.target === e && a.transitionProperty === 'transform'); if (!a) return false; a.pause(); a.currentTime = time; return true; }, time); }
try {
 await page.goto(url); await page.locator('.graph-node').first().waitFor();
 const primary = page.locator('.view-tabs button').first();
 const bounds = await primary.boundingBox(); let s = await state(primary);
 assert.equal(s.background, white); assert.equal(s.color, ink); assert.equal(s.fill, blue); assert.ok(s.x < -s.width * .95);
 await primary.hover(); assert.equal(await pauseAt(primary, 40), true, 'entry animates the accent layer');
 s = await state(primary); assert.ok(s.x < 0 && s.x > -s.width, 'fill moves across the button');
 await primary.screenshot({ path: artifact('button-sweep-midpoint.png') });
 await primary.evaluate(e => document.getAnimations().filter(a => a.effect.target === e).forEach(a => a.play())); await until(primary, true);
 assert.equal((await state(primary)).color, white); assert.deepEqual(await primary.boundingBox(), bounds);
 await primary.screenshot({ path: artifact('button-sweep-blue.png') });
 await away(); await until(primary, false); assert.equal((await state(primary)).color, ink);
 await primary.hover(); assert.equal(await pauseAt(primary, 20), true); const partial = await state(primary); await away();
 const start = await primary.evaluate(e => { const a = document.getAnimations().find(a => a.effect.target === e && a.transitionProperty === 'transform'); if (!a) return null; const frame = a.effect.getKeyframes()[0].transform; const probe = document.createElement('div'); probe.style.cssText = `position:fixed;width:${e.clientWidth}px;height:${e.clientHeight}px;transform:${frame}`; document.body.append(probe); const x = new DOMMatrix(getComputedStyle(probe).transform).m41; probe.remove(); return x; });
 assert.ok(start !== null && Math.abs(start - partial.x) < 1, 'exit starts at the interrupted position'); await until(primary, false);
 for (let i = 0; i < 3; i++) { await primary.hover(); await away(); } await until(primary, false);
 const yellowButton = page.locator('.inspector-tabs button.active'); s = await state(yellowButton); assert.equal(s.background, white); assert.equal(s.fill, yellow);
 await yellowButton.hover(); await until(yellowButton, true); assert.equal((await state(yellowButton)).color, black);
 await yellowButton.screenshot({ path: artifact('button-sweep-yellow.png') });

 const activeNav = page.locator('.sidebar nav a.active');
 s = await state(activeNav);
 assert.equal(s.background, blue);
 assert.equal(s.color, white);
 assert.equal(s.radius, s.fillRadius, 'active navigation fill follows the selection border radius');

 // Width, page type and graph zoom all share the same 320ms timing.
 for (const control of [primary, page.locator('.node-expand').first(), page.locator('.sidebar nav a.active'), page.getByRole('button', { name: '从此节点延伸', exact: true }), yellowButton]) {
  await away(); await control.hover(); assert.equal(await pauseAt(control, 20), true);
  assert.equal((await state(control)).duration, '0.32s');
  assert.equal(await control.evaluate(e => document.getAnimations().find(a => a.effect.target === e && a.transitionProperty === 'transform').effect.getTiming().duration), 320);
  await control.evaluate(e => document.getAnimations().filter(a => a.effect.target === e).forEach(a => a.play())); await until(control, true);
  await away(); assert.equal(await pauseAt(control, 20), true);
  assert.equal(await control.evaluate(e => document.getAnimations().find(a => a.effect.target === e && a.transitionProperty === 'transform').effect.getTiming().duration), 320);
  await control.evaluate(e => document.getAnimations().filter(a => a.effect.target === e).forEach(a => a.play())); await until(control, false);
 }
 await primary.hover(); assert.equal(await pauseAt(primary, 40), true);
 await primary.evaluate(e => e.style.width = '220px');
 assert.equal((await state(primary)).duration, '0.32s');
 assert.equal(await primary.evaluate(e => document.getAnimations().find(a => a.effect.target === e && a.transitionProperty === 'transform').effect.getTiming().duration), 320);
 await primary.evaluate(e => document.getAnimations().filter(a => a.effect.target === e).forEach(a => a.play())); await until(primary, true);
 await away(); await until(primary, false); await primary.evaluate(e => e.style.removeProperty('width'));
 await page.getByRole('button', { name: '缩小图谱', exact: true }).click();
 await page.waitForFunction(() => !document.getAnimations().some(a => a.effect.target.classList.contains('graph-world') && a.playState === 'running'));
 const nodeControl = page.locator('.node-expand').first(); await nodeControl.hover(); await until(nodeControl, true);
 assert.equal((await state(nodeControl)).duration, '0.32s');
 await away(); await until(nodeControl, false); await page.getByRole('button', { name: '放大图谱', exact: true }).click();
 assert.equal((await state(page.locator('.node-expand').first())).position, 'absolute');
 await away(); await page.locator('h1').focus(); await page.keyboard.press('Tab');
 const focused = page.locator('button:focus-visible'); assert.equal(await focused.count(), 1); assert.equal((await state(focused)).x, 0); assert.equal((await state(focused)).duration, '0s');
 await page.locator('h1').focus(); await primary.hover(); await until(primary, true); assert.equal((await state(primary)).easing, 'linear');
 await away(); await until(primary, false); await page.emulateMedia({ reducedMotion: 'reduce' }); await primary.hover();
 s = await state(primary); assert.equal(s.x, 0); assert.equal(s.duration, '0s'); assert.equal(s.color, white);
 await page.getByRole('button', { name: '全页面查看图谱', exact: true }).click();
 await page.locator('.fullscreen-header .secondary').waitFor(); assert.equal(await page.locator('.fullscreen-header .secondary').evaluate(e => { const value = getComputedStyle(e).getPropertyValue('--motion-button-fill').trim(); return parseFloat(value) * (value.endsWith('ms') ? 1 : 1000); }), 320);
 await page.keyboard.press('Escape'); await page.locator('.fullscreen-viewer').waitFor({ state: 'detached' });
 await away(); await page.getByRole('link', { name: '服务设置', exact: true }).click(); await page.waitForSelector('#chat-model:enabled');
 const provider = page.locator('.provider-options label.selected').first(); await provider.hover(); assert.equal((await state(provider)).color, white); assert.equal((await state(provider)).x, 0);
 await page.getByRole('link', { name: '知识库管理', exact: true }).click(); const disabled = page.getByRole('button', { name: '上传到知识库', exact: true });
 assert.equal(await disabled.isDisabled(), true); await disabled.hover(); assert.notEqual((await state(disabled)).fill, blue);
 const touch = await browser.newPage({ viewport: { width: 375, height: 900 }, hasTouch: true, isMobile: true });
 await touch.addInitScript(() => localStorage.setItem('aureli-mode', 'demo')); await touch.goto(url);
 await touch.getByRole('button', { name: '最小化节点配置', exact: true }).tap();
 const touchButton = touch.getByRole('button', { name: '延伸', exact: true }).first(); await touchButton.waitFor(); await touchButton.tap();
 await touch.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA' && !document.querySelector('.node-bottom button:last-child').matches(':active'));
 assert.equal((await state(touchButton)).background, white); assert.ok((await state(touchButton)).x < 0, 'touch does not retain a hover fill'); await touch.close();
 assert.deepEqual(errors, []);
 console.log('PASS: uniform 320ms across widths, resizing, zoom and dynamic pages, white rest, blue/yellow fill and text, stable bounds, interrupted exit, keyboard/pointer, reduced motion, disabled and touch states');
} finally { await browser.close(); }
