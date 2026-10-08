import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH});
const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
const artifact = name => new URL(`../artifacts/${name}`, import.meta.url).pathname;
await mkdir(new URL('../artifacts', import.meta.url), {recursive:true});
await page.addInitScript(()=>localStorage.setItem('aureli-mode','demo'));
await page.emulateMedia({reducedMotion:'reduce'});
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.route('**/customer-service/model-settings',route=>route.fulfill({json:{success:true,data:{chat:{provider:'local',baseUrl:'http://127.0.0.1:11434/v1',model:'llama3:latest',keyConfigured:true},embedding:{provider:'local',baseUrl:'http://127.0.0.1:11434/v1',model:'qwen3-embedding:4b',keyConfigured:true},dimensions:1536}}}));
const blue='rgb(0, 102, 204)', black='rgb(16, 16, 16)', yellow='rgb(255, 190, 0)';
async function styles(selector) { return page.locator(selector).first().evaluate(e=>{const s=getComputedStyle(e); return {color:s.color,background:s.backgroundColor,border:s.borderTopColor,borderWidth:s.borderTopWidth,fontSize:parseFloat(s.fontSize),weight:s.fontWeight,shadow:s.boxShadow,outline:s.outlineColor,outlineWidth:s.outlineWidth};}); }
function contrast(a,b) { const l=c=>{const values=c.match(/\d+/g).slice(0,3).map(Number).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return values[0]*.2126+values[1]*.7152+values[2]*.0722;};const [x,y]=[l(a),l(b)].sort((a,b)=>b-a);return(x+.05)/(y+.05); }
async function assertPage() {
 const heading=await styles('h1'); assert.equal(heading.color,black); assert.equal(heading.weight,'900'); assert.ok(heading.fontSize>=36);
 const surface=await styles('.surface'); assert.equal(surface.border,blue); assert.equal(surface.borderWidth,'2px'); assert.equal(surface.shadow,'none');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
}
try {
 await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:5173'); await page.locator('.graph-node').first().waitFor();
 await assertPage();
 assert.equal(await page.locator('.graph-workbench .metrics,.graph-workbench .mode-banner').count(),0);
 assert.equal(await page.locator('.graph-workbench > .sr-only').count(),1);
 const canvas=await page.locator('.graph-wrap').boundingBox(); assert.ok(canvas.y<320 && canvas.height>=1080*.6 && canvas.y+canvas.height<1080,'canvas fills the initial viewport');
 assert.equal((await styles('.sidebar')).border,blue); assert.equal((await styles('.sidebar nav a.active')).background,'rgb(255, 255, 255)'); assert.equal((await styles('.sidebar nav a.active')).border,blue);
 const button=await styles('.workspace-actions .export-button'); assert.ok(contrast(button.color,button.background)>=4.5);
 const selected=await styles('.graph-node.selected'); assert.equal(selected.border,blue); assert.equal(selected.outline,yellow);
 for (const selector of ['.workspace-actions .export-button','.graph-toolbar-actions .icon-button','.node-expand','.node-bottom button','.canvas-controls button']) {
  const box=await page.locator(selector).first().boundingBox(); assert.ok(box.width>=44&&box.height>=44,`${selector} must have a large target`);
 }
 const focus=page.getByRole('button',{name:'导出图谱',exact:true}); await focus.focus(); const focused=await styles('.workspace-actions .export-button'); assert.equal(focused.outline,blue); assert.equal(focused.outlineWidth,'3px'); assert.ok(focused.shadow.includes(yellow));
 await page.locator('h1').focus(); await page.screenshot({path:artifact('accessible-graph.png')});
 await page.getByRole('button',{name:'全页面查看 tile-003',exact:true}).click(); await page.locator('.fullscreen-viewer').waitFor();
 assert.equal((await styles('.tile-reading')).border,blue); assert.ok((await styles('.fullscreen-header h2')).fontSize>=24);
 await page.screenshot({path:artifact('accessible-tile.png')}); await page.keyboard.press('Escape');
 await page.getByRole('link',{name:'知识库管理',exact:true}).click(); await assertPage(); const description=await styles('.page-heading p'); assert.ok(contrast(description.color,'rgb(255, 255, 255)')>=7); await page.screenshot({path:artifact('accessible-knowledge.png')});
 await page.getByRole('button',{name:/^编辑 .* 备注$/}).first().click(); assert.equal((await styles('.modal')).border,blue); await page.keyboard.press('Escape');
 await page.getByRole('link',{name:'服务设置',exact:true}).click(); await page.waitForSelector('#chat-model:enabled'); await assertPage();
 assert.equal((await styles('.model-config-section')).border,blue); assert.equal((await styles('.provider-options label.selected')).background,'rgb(255, 255, 255)');
 await page.getByLabel('本地模型',{exact:true}).first().focus(); assert.equal((await styles('.provider-options label.selected')).outline,blue);
 await page.locator('h1').focus(); await page.screenshot({path:artifact('accessible-settings.png'),fullPage:true});
 for (const width of [375,768,1024,1440]) {
  await page.setViewportSize({width,height:900}); await assertPage();
  const nav = async name => { if(width<768) await page.getByRole('button',{name:'展开导航',exact:true}).click(); await page.getByRole('link',{name:name==='图谱工作台'?/^图谱工作台/:name,exact:true}).click(); await assertPage(); };
  await nav('图谱工作台'); if(width===375) await page.screenshot({path:artifact('accessible-mobile.png'),fullPage:true});
  await nav('知识库管理'); await nav('服务设置');
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: editorial headings, flat blue surfaces, outlined Dock, blue/yellow focus, large controls, text contrast, all pages/dialogs/fullscreen, four responsive widths');
} finally { await browser.close(); }
