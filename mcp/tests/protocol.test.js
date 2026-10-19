import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, UI_URI } from '../server/tools.js';
import { Store } from '../server/store.js';
import { fileURLToPath } from 'node:url';
const conversation_id = 'chat-protocol';

test('real MCP initialization, tools, UI resource and generation roundtrip', async () => {
  const store = new Store(':memory:');
  const server = createMcpServer(store, fileURLToPath(new URL('../dist/index.html', import.meta.url)));
  const client = new Client({name:'aureli-test',version:'1'});
  const [a,b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(a),client.connect(b)]);
    const list = await client.listTools();
    assert.ok(list.tools.find(tool => tool.name === 'aureli_open')._meta.ui.resourceUri === UI_URI);
    assert.deepEqual(list.tools.find(tool => tool.name === 'aureli_workspace')._meta.ui.visibility,['app']);
    const resource = await client.readResource({uri:UI_URI});
    assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');
    assert.ok(resource.contents[0].text.includes('<html'));
    assert.ok(!/<script[^>]+src=/.test(resource.contents[0].text), 'UI is self-contained');
    await client.callTool({name:'aureli_demo',arguments:{conversation_id}});
    const opened = await client.callTool({name:'aureli_open',arguments:{conversation_id}});
    assert.equal(opened._meta.workspace.nodes.length,5);
    const source = opened._meta.workspace.nodes.find(n => n.title === '方案 A · 宿主协作');
    const prepared = await client.callTool({name:'aureli_prepare',arguments:{conversation_id,sourceIds:[source.id],question:'下一步'}});
    const taskId = prepared.structuredContent.taskId;
    const packet = await client.callTool({name:'aureli_get_context',arguments:{conversation_id,taskId}});
    assert.equal(packet.structuredContent.context.nodes.length,2);
    assert.ok(!JSON.stringify(packet.structuredContent).includes('方案 B'));
    const saved = await client.callTool({name:'aureli_commit',arguments:{conversation_id,taskId,answer:'协议测试结果'}});
    assert.equal(saved.structuredContent.saved,true);
    const metadata = { 'openai/session': 'another-host-chat' };
    const other = await client.callTool({ name: 'aureli_open', arguments: {}, _meta: metadata });
    assert.equal(other._meta.workspace.conversation_id, 'another-host-chat');
    assert.equal(other._meta.workspace.nodes.length, 0);
    const crossed = await client.callTool({ name: 'aureli_get_context', arguments: { taskId }, _meta: metadata });
    assert.equal(crossed.isError, true, 'MCP must forward host metadata into task isolation');
  } finally { await client.close(); await server.close(); store.close(); }
});
