const http = require('node:http');
const os = require('node:os');

// Explicit opt-in LAN entry point; the embedded database stays on loopback.
function createProxy(upstream = new URL('http://127.0.0.1:18081')) {
  if (upstream.protocol !== 'http:') throw new Error('开发转发仅支持本机 HTTP 后端。');
  return http.createServer((req, res) => {
    if (!req.url?.startsWith('/customer-service/')) {
      res.writeHead(404); res.end('Aureli API only'); return;
    }
    const headers = { ...req.headers, host: upstream.host };
    delete headers.connection;
    const outgoing = http.request({ hostname: upstream.hostname, port: upstream.port || 80,
      path: req.url, method: req.method, headers }, incoming => {
      res.writeHead(incoming.statusCode, { ...incoming.headers, 'cache-control': 'no-store' });
      incoming.pipe(res);
      incoming.on('error', () => res.destroy());
    });
    outgoing.on('error', () => {
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: '无法连接桌面开发版，请先运行 desktop 中的 npm run dev。' }));
    });
    req.on('aborted', () => outgoing.destroy());
    res.on('close', () => { if (!res.writableFinished) outgoing.destroy(); });
    req.pipe(outgoing);
  });
}
module.exports = { createProxy };
if (require.main === module) {
  const upstream = new URL(process.env.AURELI_IOS_BACKEND_URL || 'http://127.0.0.1:18081');
  const port = Number(process.env.AURELI_IOS_PROXY_PORT || 18082);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('转发端口应为 1 至 65535。');
  const server = createProxy(upstream);
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Aureli iPhone 开发入口，连接后端 ${upstream.origin}`);
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const address of addresses || []) {
        if (address.family === 'IPv4' && !address.internal) console.log(`手机服务地址：http://${address.address}:${port}`);
      }
    }
    console.log('只在可信局域网调试；按 Ctrl+C 停止转发。');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    server.close(); server.closeAllConnections();
  });
}
