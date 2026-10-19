// A protocol test host, not an LLM emulator. It deliberately never generates text.
import { browserConversation } from './bridge.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

document.getElementById('host').innerHTML = `<style>
body{margin:0;font:14px/1.6 -apple-system,"PingFang SC",sans-serif;color:#172033;background:#f4f6fa}header{padding:14px 20px;background:white;border-bottom:1px solid #dbe2ec}header strong{font-size:17px}header p{margin:3px 0;color:#526078;font-size:12px}.layout{display:grid;grid-template-columns:minmax(0,1fr) 350px;height:calc(100dvh - 84px)}iframe{border:0;width:100%;height:100%;background:white}aside{padding:18px;overflow:auto;border-left:1px solid #dbe2ec}h2{font-size:15px}button{padding:10px 12px;background:white;border:1px solid #bcc7d7;border-radius:7px;cursor:pointer;margin:4px 0}textarea{width:100%;box-sizing:border-box;min-height:130px;padding:10px;font:13px/1.7 inherit}pre{font:11px/1.65 monospace;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:white;border:1px solid #dbe2ec;border-radius:7px}#status{color:#004080}#error{color:#92271e}@media(max-width:1000px){.layout{grid-template-columns:1fr;height:auto}iframe{height:900px}aside{border-left:0}}</style>
<header><strong>Aureli · MCP 桥接验证</strong><p>真实 MCP HTTP 与官方 AppBridge；不调用模型。这里只验证界面消息、上下文读取和结果回写。</p></header>
<div class="layout"><iframe id="canvas" title="Aureli MCP App" sandbox="allow-scripts"></iframe><aside><p id="status">正在建立 MCP 连接…</p><p id="error" role="alert"></p><h2>界面发给宿主的消息</h2><pre id="message">尚未收到任务</pre><button id="read" disabled>读取任务上下文</button><h2>模型可见的工具结果</h2><pre id="context">尚未读取</pre><h2>手动提交测试结果</h2><p>此处内容由你填写，用于验证保存；不是 AI 回答。</p><textarea id="answer" aria-label="手动测试回答" placeholder="输入一段测试内容，验证回写节点。"></textarea><button id="commit" disabled>保存测试回答</button><h2>工具调用记录</h2><pre id="calls"></pre></aside></div>`;
const $ = id => document.getElementById(id);
let taskId, appBridge;
const conversation_id = browserConversation();
function log(name) { $('calls').textContent = `${name}\n${$('calls').textContent}`; }
function fail(error) { $('error').textContent = error.message; }
const client = new Client({ name: 'aureli-protocol-test-host', version: '0.1.0' });
async function tool(name, args = {}) {
  log(name);
  const result = await client.callTool({ name, arguments: { ...args, conversation_id }, _meta: { 'openai/session': conversation_id } });
  if (result.isError) throw new Error(result.content?.find(item => item.type === 'text')?.text ?? '工具失败');
  return result;
}
try {
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', location.href)));
  const opened = await tool('aureli_open');
  const resource = await client.readResource({ uri: 'ui://aureli/canvas-v1.html' });
  appBridge = new AppBridge(null, { name: 'Aureli Protocol Test Host', version: '0.1.0' },
    { serverTools: {}, message: { text: {} }, logging: {} });
  appBridge.oncalltool = async params => tool(params.name, params.arguments);
  appBridge.onmessage = async ({ content }) => {
    const text = content.filter(item => item.type === 'text').map(item => item.text).join('\n');
    $('message').textContent = text;
    taskId = text.match(/[0-9a-f]{8}-[0-9a-f-]{27}/)?.[0];
    $('read').disabled = !taskId;
    $('commit').disabled = true;
    return {};
  };
  appBridge.oninitialized = async () => {
    await appBridge.sendToolInput({ arguments: {} });
    await appBridge.sendToolResult(opened);
    $('status').textContent = 'MCP 与 iframe 桥接已连接';
  };
  const iframe = $('canvas');
  await appBridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
  iframe.srcdoc = resource.contents[0].text;
} catch (error) { fail(error); }
$('read').onclick = async () => {
  try {
    const result = await tool('aureli_get_context', { taskId });
    // UI-only _meta deliberately excluded from the model-visible audit.
    $('context').textContent = JSON.stringify(result.structuredContent, null, 2);
    $('commit').disabled = result.structuredContent.status !== 'PENDING';
  } catch (error) { fail(error); }
};
$('commit').onclick = async () => {
  try {
    const answer = $('answer').value.trim(); if (!answer) throw new Error('先填写手动测试回答。');
    const result = await tool('aureli_commit', { taskId, answer });
    await appBridge.sendToolResult(result);
    $('commit').disabled = true;
    $('status').textContent = '测试回答已保存，画布应出现新节点';
  } catch (error) { fail(error); }
};
