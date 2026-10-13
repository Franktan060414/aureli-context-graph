const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

// A loopback-only fixture. Mutations here never reach the user's development data.
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (data, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data));
  };
  if (url.pathname.endsWith('/maps')) return json({ success: true, data: [{ mapId: 'fixture-map', name: '验证工作区' }] });
  if (url.pathname.endsWith('/tile/workspace')) {
    const id = url.searchParams.get('mapId');
    if (id === 'failure') return json({ success: false, message: '图谱不存在' });
    if (id === 'missing') return json({ success: true });
    if (id === 'forbidden') return json({ success: false, message: '访问被拒绝' }, 403);
    if (id === 'html') { res.end('<html>not the API</html>'); return; }
    return json({ success: true, data: { tiles: [], edges: [] } });
  }
  if (url.pathname.endsWith('/chat/tile/completion')) {
    let body = '';
    for await (const chunk of req) body += chunk;
    const question = JSON.parse(body);
    if (question.mapId !== 'fixture-map' || question.edgeDirection !== 'DIRECTED') return json({ success: false, message: '请求字段不匹配' }, 400);
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    const data = Buffer.from('data: {"v":"你好🙂"}\r\n\r\n');
    // Deliberately divide the UTF-8 bytes, including Chinese characters and emoji.
    for (let i = 0; i < data.length; i++) res.write(data.subarray(i, i + 1));
    if (question.message === 'failure') res.end('data: {"error":"保存失败"}\n\n');
    else if (question.message === 'interrupt') res.end();
    else res.end('data: {"done":true}\n\n');
    return;
  }
  json({ success: false, message: '未知验证接口' }, 404);
});
server.listen(0, '127.0.0.1', () => {
  const child = spawn('swift', ['test', '--package-path', path.join(__dirname, '..', 'Core')], {
    stdio: 'inherit', env: { ...process.env, AURELI_IOS_FIXTURE_URL: `http://127.0.0.1:${server.address().port}` },
  });
  child.on('error', error => { console.error(error); server.close(); process.exitCode = 1; });
  child.on('exit', code => { server.close(); server.closeAllConnections(); process.exitCode = code ?? 1; });
});
