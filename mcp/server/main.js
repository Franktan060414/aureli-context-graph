import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Store } from './store.js';
import { createMcpServer, executeTool } from './tools.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const uiPath = join(root, 'dist/index.html');
if (!existsSync(uiPath)) throw new Error('请先在 mcp/ 中运行 npm run build。');
const defaultDir = process.platform === 'darwin' ? join(homedir(), 'Library/Application Support/Aureli MCP Prototype')
  : process.platform === 'win32' ? join(process.env.APPDATA ?? homedir(), 'Aureli MCP Prototype')
    : join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'), 'aureli-mcp-prototype');
const store = new Store(resolve(process.env.AURELI_MCP_DB ?? join(defaultDir, 'aureli.sqlite')));
const stdio = process.argv.includes('--stdio');
const port = Number(process.env.AURELI_MCP_PORT ?? 18765);
let httpServer, stdioServer;
let shuttingDown = false;
async function close() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (httpServer) { httpServer.closeAllConnections(); await new Promise(resolve => httpServer.close(resolve)); }
  if (stdioServer) await stdioServer.close();
  store.close();
}
process.on('SIGINT', () => close().then(() => process.exit(0)));
process.on('SIGTERM', () => close().then(() => process.exit(0)));

if (!stdio || process.env.AURELI_MCP_VIEWER === '1') {
  httpServer = createServer(async (req, res) => {
    const host = req.headers.host;
    const allowedHosts = [`127.0.0.1:${httpServer.address()?.port}`, `localhost:${httpServer.address()?.port}`];
    if (!allowedHosts.includes(host) || (req.headers.origin && !allowedHosts.map(value => `http://${value}`).includes(req.headers.origin))) {
      res.writeHead(403).end('仅允许本机同源访问。'); return;
    }
    const path = new URL(req.url, `http://${host}`).pathname;
    try {
      if (req.method === 'POST' && ['/api/tool', '/mcp'].includes(path)) {
        if (path === '/api/tool' && req.headers['x-aureli-local'] !== '1') { res.writeHead(403).end(); return; }
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 200000) { res.writeHead(413).end(); return; } }
        const input = JSON.parse(body);
        if (path === '/api/tool') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(await executeTool(store, input.name, input.arguments)));
        } else {
          const server = createMcpServer(store, uiPath);
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
          res.on('close', () => { transport.close(); server.close(); });
          await server.connect(transport);
          await transport.handleRequest(req, res, input);
        }
        return;
      }
      const files = { '/': uiPath, '/index.html': uiPath, '/host': join(root, 'dist/host.html') };
      if (req.method === 'GET' && files[path]) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
        res.end(readFileSync(files[path])); return;
      }
      res.writeHead(404).end('Not found');
    } catch (error) {
      console.error(error.message);
      if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '请求处理失败，请检查服务日志。' }));
    }
  });
  await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(port, '127.0.0.1', resolve); });
  console.error(`Aureli MCP · http://127.0.0.1:${httpServer.address().port} · /host 为桥接验证页`);
}
if (stdio) {
  stdioServer = createMcpServer(store, uiPath);
  const transport = new StdioServerTransport();
  await stdioServer.connect(transport);
  // Host termination closes stdin; keep the database lifecycle tied to that host.
  process.stdin.on('end', () => close().then(() => process.exit(0)));
}
