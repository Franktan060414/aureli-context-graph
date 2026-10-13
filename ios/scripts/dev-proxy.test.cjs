const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createProxy } = require('./dev-proxy.cjs');

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });

test('forwards map query, JSON POST and SSE without buffering', async () => {
  const upstream = http.createServer(async (req, res) => {
    if (req.url === '/customer-service/chat/tile/completion') {
      let body = '';
      for await (const part of req) body += part;
      assert.equal(JSON.parse(body).mapId, 'map-1');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"v":"你好"}\n\n');
      setTimeout(() => res.end('data: {"done":true}\n\n'), 30);
      return;
    }
    assert.equal(req.url, '/customer-service/tile/workspace?mapId=map-1');
    res.setHeader('content-type', 'application/json');
    res.end('{"success":true,"data":{"tiles":[],"edges":[]}}');
  });
  const upstreamPort = await listen(upstream);
  const proxy = createProxy(new URL(`http://127.0.0.1:${upstreamPort}`));
  const port = await listen(proxy);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/customer-service/tile/workspace?mapId=map-1`);
    assert.equal((await response.json()).success, true);
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 404);
    const stream = await fetch(`http://127.0.0.1:${port}/customer-service/chat/tile/completion`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mapId: 'map-1' }),
    });
    const reader = stream.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /你好/);
    let remainder = '';
    while (true) { const next = await reader.read(); if (next.done) break; remainder += new TextDecoder().decode(next.value); }
    assert.match(remainder, /done/);
  } finally { await close(proxy); await close(upstream); }
});

test('reports unavailable development backend as JSON failure', async () => {
  const reservation = http.createServer();
  const closedPort = await listen(reservation);
  await close(reservation);
  const proxy = createProxy(new URL(`http://127.0.0.1:${closedPort}`));
  const port = await listen(proxy);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/customer-service/maps`);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).success, false);
  } finally { await close(proxy); }
});
