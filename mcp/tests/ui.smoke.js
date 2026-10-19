import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(),'aureli-ui-'));
const proc = spawn(process.execPath,['server/main.js'],{cwd:root,env:{...process.env,
  AURELI_MCP_DB:join(temporary,'test.sqlite'),AURELI_MCP_PORT:'0'},stdio:['ignore','pipe','pipe']});
let logs = '';
const base = await new Promise((resolve,reject) => {
  const timeout = setTimeout(() => reject(new Error(logs || 'Server startup timeout')),10000);
  proc.stderr.on('data',chunk => { logs += chunk; const match = logs.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
  proc.once('exit',code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${logs}`)); });
});
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let browser, page;
try {
  browser = await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH
    ?? (existsSync(chromium.executablePath()) ? undefined : existsSync(systemChrome) ? systemChrome : undefined)});
  page = await browser.newPage({viewport:{width:1440,height:1000}});
  await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
  await page.addInitScript(()=>{
    window.addEventListener('message',event=>{
      if(!window.rejectNextHostMessage || event.data?.method!=='ui/message') return;
      window.rejectNextHostMessage=false;
      event.stopImmediatePropagation();
      event.source.postMessage({jsonrpc:'2.0',id:event.data.id,result:{isError:true}},'*');
    },true);
  });
  const errors=[];
  page.on('pageerror',error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  const packet = async surface => JSON.parse(await surface.getByLabel('精确上下文资料包').inputValue());
  async function waitPacket(surface,predicate) {
    for(let i=0;i<80;i++) {
      try { const current=await packet(surface); if(predicate(current)) return current; } catch {}
      await page.waitForTimeout(100);
    }
    throw new Error('Expected context packet was not rendered');
  }
  await page.goto(`${base}/?conversation_id=ui-a`);
  assert.equal(await page.getByText('01 / 选择',{exact:true}).count(),0);
  assert.equal(await page.getByText('02 / 审阅',{exact:true}).count(),0);
  assert.equal(await page.locator('#context-panel > :first-child h2').textContent(),'推演');
  assert.equal(await page.locator('#context-panel > :last-child input[type=range]').count(),1);
  assert.equal(await page.locator('.context-details').getAttribute('open'),null);
  assert.ok(await page.getByRole('button',{name:'冻结并复制任务指令',exact:true}).isDisabled());
  await page.getByRole('button',{name:'加载实验图谱'}).click();
  await page.locator('.node').nth(4).waitFor();
  assert.equal((await waitPacket(page,p=>p.nodes.length===0)).nodes.length,0);
  await page.getByRole('button',{name:'选择来源 方案 A · 宿主协作',exact:true}).click();
  let context=await waitPacket(page,p=>p.nodes.length===2);
  assert.ok(context.nodes.some(n=>n.title==='项目约束'));
  assert.ok(!context.nodes.some(n=>n.title.includes('方案 B')));
  await page.locator('.context-details > summary').click();
  await page.getByRole('radio',{name:'仅选中节点',exact:true}).check();
  await waitPacket(page,p=>p.nodes.length===1);
  await page.getByRole('radio',{name:'沿关系追溯来源',exact:true}).check();
  await waitPacket(page,p=>p.nodes.length===2);
  await page.getByRole('button',{name:'排除 项目约束',exact:true}).click();
  await waitPacket(page,p=>p.nodes.length===1);
  await page.getByRole('button',{name:'恢复 项目约束',exact:true}).click();
  await waitPacket(page,p=>p.nodes.length===2);

  // Drag persists across full page reload; no click on a node button starts a drag.
  const card = page.locator('.node').filter({has:page.getByRole('button',{name:'查看 方案 A · 宿主协作',exact:true})});
  const before = await card.evaluate(el=>({id:el.dataset.nodeId,x:parseFloat(el.style.left)}));
  const drag = await card.locator('.node-top').boundingBox();
  await page.mouse.move(drag.x+25,drag.y+10);await page.mouse.down();await page.mouse.move(drag.x+80,drag.y+40,{steps:8});await page.mouse.up();
  await page.waitForTimeout(400);await page.reload();
  await page.locator(`[data-node-id="${before.id}"]`).waitFor();
  const after=await page.locator(`[data-node-id="${before.id}"]`).evaluate(el=>parseFloat(el.style.left));
  assert.notEqual(after,before.x);

  // The manual creation entry is gone; existing nodes remain editable.
  assert.equal(await page.getByRole('button',{name:/新建便签/}).count(),0);
  assert.equal(await page.getByRole('dialog').count(),0);
  await page.getByRole('button',{name:'查看 独立资料 · 尚未关联',exact:true}).click();
  await page.getByRole('tabpanel').getByLabel('标题',{exact:true}).fill('浏览器测试来源');
  await page.getByRole('tabpanel').getByLabel('正文',{exact:true}).fill('browser-source-body');
  await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await page.getByRole('combobox',{name:/^来源节点/}).selectOption({label:'项目约束'});
  await page.getByRole('button',{name:'建立关系',exact:true}).click();
  await page.getByRole('button',{name:'作为本次直接来源',exact:true}).click();
  context=await waitPacket(page,p=>p.nodes.length===2);
  assert.ok(context.nodes.some(n=>n.content==='browser-source-body'));
  await page.getByLabel('本次问题',{exact:true}).fill('验证来源是否严格受控');
  await page.getByRole('button',{name:'冻结并复制任务指令',exact:true}).click();
  await page.locator('.prepared-task').waitFor();
  await page.getByRole('button',{name:'任务指令已复制',exact:true}).waitFor();
  const copiedTask=await page.locator('.prepared-task > code').textContent();
  assert.ok((await page.evaluate(()=>navigator.clipboard.readText())).includes(copiedTask));
  assert.equal(await page.getByRole('button',{name:'发送到宿主聊天',exact:true}).count(),0);
  mkdirSync(join(root,'artifacts'),{recursive:true});
  await page.screenshot({path:join(root,'artifacts/canvas.png'),fullPage:true});

  // Real MCP-over-HTTP + official AppBridge + sandboxed iframe; no LLM simulation.
  await page.goto(`${base}/host?conversation_id=ui-a`);
  await page.getByText('MCP 与 iframe 桥接已连接',{exact:true}).waitFor();
  const frame=page.frameLocator('#canvas');
  await frame.getByRole('button',{name:'选择来源 方案 A · 宿主协作',exact:true}).click();
  await waitPacket(frame,p=>p.nodes.length===2);
  await frame.getByLabel('本次问题',{exact:true}).fill('桥接测试：保留选中分支');
  await frame.getByRole('button',{name:'冻结并发送到宿主',exact:true}).click();
  await page.locator('#read:not([disabled])').waitFor();
  assert.ok(await frame.getByRole('button',{name:'已发送，等待回写',exact:true}).isDisabled());
  assert.equal((await page.locator('#calls').textContent()).split('\n').filter(name=>name==='aureli_prepare').length,1);
  await page.getByRole('button',{name:'读取任务上下文',exact:true}).click();
  await page.locator('#commit:not([disabled])').waitFor();
  const visible=JSON.parse(await page.locator('#context').textContent());
  assert.equal(visible.context.nodes.length,2);
  assert.ok(!JSON.stringify(visible).includes('方案 B'));
  await page.getByLabel('手动测试回答',{exact:true}).fill('这是手动桥接测试结果，不是 AI 生成。');
  await page.getByRole('button',{name:'保存测试回答',exact:true}).click();
  await frame.locator('.node').nth(5).waitFor();
  await page.screenshot({path:join(root,'artifacts/bridge.png'),fullPage:true});

  // A rejected message keeps the frozen task; retry sends it without preparing another one.
  await frame.getByLabel('本次问题',{exact:true}).fill('发送失败后使用同一份冻结资料包重试');
  await page.evaluate(()=>{ window.rejectNextHostMessage=true; });
  await frame.getByRole('button',{name:'冻结并发送到宿主',exact:true}).click();
  await frame.getByRole('alert').filter({hasText:'资料包已冻结并保留'}).waitFor();
  const retryTask=await frame.locator('.prepared-task > code').textContent();
  assert.equal((await page.locator('#calls').textContent()).split('\n').filter(name=>name==='aureli_prepare').length,2);
  await frame.getByRole('button',{name:'发送到宿主聊天',exact:true}).click();
  await frame.getByRole('button',{name:'已发送，等待回写',exact:true}).waitFor();
  assert.ok((await page.locator('#message').textContent()).includes(retryTask));
  assert.equal(await frame.locator('.prepared-task > code').textContent(),retryTask);
  assert.equal((await page.locator('#calls').textContent()).split('\n').filter(name=>name==='aureli_prepare').length,2);

  // Restoring a task also restores the visible question and source settings.
  await frame.getByLabel('本次问题',{exact:true}).fill('尚未发送的新草稿');
  await frame.locator('.task-history > div').filter({hasText:retryTask.slice(0,8)}).getByRole('button',{name:'恢复',exact:true}).click();
  assert.equal(await frame.getByLabel('本次问题',{exact:true}).inputValue(),'发送失败后使用同一份冻结资料包重试');
  assert.equal(await frame.locator('.prepared-task > code').textContent(),retryTask);
  assert.equal((await waitPacket(frame,p=>p.question==='发送失败后使用同一份冻结资料包重试')).nodes.length,2);
  assert.equal((await page.locator('#calls').textContent()).split('\n').filter(name=>name==='aureli_prepare').length,2);
  assert.deepEqual(errors,[]);

  // A different host conversation starts empty; returning restores the first graph.
  await page.goto(`${base}/?conversation_id=ui-b`);
  await page.getByRole('button',{name:'加载实验图谱',exact:true}).waitFor();
  assert.equal(await page.locator('.node').count(),0);
  await page.reload();
  await page.getByRole('button',{name:'加载实验图谱',exact:true}).waitFor();
  assert.ok(page.url().includes('conversation_id=ui-b'));
  await page.goto(`${base}/?conversation_id=ui-a`);
  await page.locator('.node').nth(5).waitFor();
  await page.setViewportSize({width:375,height:844});
  await page.getByRole('button',{name:'查看 方案 A · 宿主协作',exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:join(root,'artifacts/mobile.png'),fullPage:true});
  await page.setViewportSize({width:844,height:375});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('.task-composer').scrollIntoViewIfNeeded();
  await page.screenshot({path:join(root,'artifacts/dark-landscape.png')});
  console.log('PASS: selection, scope, exclusion, drag persistence, note editing/link creation, conversation isolation, one-click freeze/copy/send, rejection retry without duplicate tasks, task restore, real HTTP/iframe bridge, commit, responsive light/dark layout');
} catch(error) {
  mkdirSync(join(root,'artifacts'),{recursive:true});
  await page?.screenshot({path:join(root,'artifacts/failure.png'),fullPage:true});
  console.error(await page?.locator('body').innerText());
  throw error;
} finally {
  await browser?.close();
  proc.kill('SIGTERM');
  await new Promise(resolve=>proc.once('exit',resolve));
  rmSync(temporary,{recursive:true,force:true});
}
