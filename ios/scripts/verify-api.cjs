const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

// A loopback-only fixture. Mutations here never reach the user's development data.
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (data, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data));
  };
  if (url.pathname === '/v1/chat/completions' || url.pathname === '/v1/messages') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw), anthropic = url.pathname.endsWith('/messages');
    if (body.model === 'native-ui' && !body.messages.some(message=>message.content.includes('第一条验收问题')))
      return json({error:'native context was not forwarded'},400);
    if (anthropic ? req.headers['x-api-key'] !== 'fixture-secret' || req.headers['anthropic-version'] !== '2023-06-01'
      : req.headers.authorization !== 'Bearer fixture-secret') return json({error:'invalid credentials'},401);
    if (body.model === 'http-error') return json({error:{message:'fixture-secret upstream detail'}},401);
    if (!body.stream) return json(anthropic ? {content:[{type:'thinking',thinking:'hidden'},{type:'text',text:'完整回答🙂'}]}
      : {choices:[{message:{content:'完整回答🙂'}}]});
    res.writeHead(200, {'content-type':'text/event-stream'});
    function event(data) {
      const bytes = Buffer.from('data: '+JSON.stringify(data)+'\r\n\r\n');
      for (let i=0;i<bytes.length;i++) res.write(bytes.subarray(i,i+1));
    }
    if (anthropic) {
      event({type:'message_start',message:{content:[]}});
      event({type:'content_block_start',content_block:{type:'text',text:'完整'}});
      event({type:'content_block_delta',delta:{type:'thinking_delta',thinking:'不得输出'}});
      event({type:'content_block_delta',delta:{type:'text_delta',text:'回答🙂'}});
    } else event({choices:[{delta:{content:'完整回答🙂'},finish_reason:null}]});
    if (body.model === 'error') event({type:'error',error:{message:'fixture-secret upstream detail'}});
    else if (body.model !== 'interrupt') {
      if (anthropic) event({type:'message_stop'});
      else { event({choices:[{delta:{},finish_reason:'stop'}]}); res.write('data: [DONE]\n\n'); }
    }
    res.end(); return;
  }
  if (url.pathname === '/mcp') {
    if (req.headers.authorization !== 'Bearer fixture-secret') return json({error:'unauthorized'},401);
    if (req.method === 'DELETE') { res.writeHead(204); res.end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const rpc = JSON.parse(raw);
    if (rpc.method === 'initialize') {
      res.setHeader('Mcp-Session-Id','fixture-session');
      return json({jsonrpc:'2.0',id:rpc.id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}});
    }
    if (req.headers['mcp-session-id'] !== 'fixture-session' || req.headers['mcp-protocol-version'] !== '2025-03-26')
      return json({error:'missing session or negotiated protocol'},400);
    if (rpc.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    let result;
    if (rpc.method === 'tools/list') {
      result = rpc.params.cursor ? {tools:[{name:'tavily_extract',inputSchema:{properties:{urls:{type:'array'},extract_depth:{type:'string'}}}}]}
        : {tools:[{name:'tavily_search',inputSchema:{properties:{query:{type:'string'},max_results:{type:'integer'}}}}],nextCursor:'page2'};
    } else if (rpc.method === 'tools/call') {
      const args = rpc.params.arguments;
      if (rpc.params.name === 'tavily_search') {
        if (Object.keys(args).some(key=>!['query','max_results'].includes(key))) return json({jsonrpc:'2.0',id:rpc.id,error:{code:-32602}});
        result = {content:[{type:'text',text:JSON.stringify({results:[{title:'搜索结果',url:'https://example.com',content:'可用资料🙂'}]})}]};
      } else if (args.extract_depth === 'basic') result = {isError:true,content:[{type:'text',text:'fixture-secret'}]};
      else result = {structuredContent:{results:[{title:'',url:args.urls[0],raw_content:'# 网页标题\n网页正文🙂'}]}};
    } else return json({jsonrpc:'2.0',id:rpc.id,error:{code:-32601}});
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.end('event: message\ndata: '+JSON.stringify({jsonrpc:'2.0',id:'unrelated',result:{}})+'\n\n'+
      'data: '+JSON.stringify({jsonrpc:'2.0',id:rpc.id,result})+'\n\n');
    return;
  }
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
  const root = path.join(__dirname, '..', 'Core');
  const fixture = 'http://127.0.0.1:'+server.address().port;
  const nativeUI = process.env.AURELI_TEST_NATIVE_UI_DEVICE_ID;
  const device = nativeUI || process.env.AURELI_TEST_IOS_DEVICE_ID;
  const child = spawn(device ? 'xcodebuild' : 'swift', device ?
    ['test','-scheme',nativeUI ? 'Aureli' : 'AureliCore-Package','-destination','platform=iOS Simulator,id='+device,
      '-derivedDataPath',nativeUI ? '/tmp/aureli-native-branch-build' : '/tmp/aureli-core-ios-tests',
      ...(process.env.AURELI_TEST_ONLY ? ['-only-testing:'+process.env.AURELI_TEST_ONLY] : []),
      ...(nativeUI ? ['CODE_SIGNING_ALLOWED=NO','ONLY_ACTIVE_ARCH=YES'] : [])] : ['test','--package-path',root], {
    cwd:nativeUI ? path.join(__dirname,'..') : root, stdio:'inherit',
    env:{...process.env,AURELI_IOS_FIXTURE_URL:fixture,TEST_RUNNER_AURELI_IOS_FIXTURE_URL:fixture},
  });
  child.on('error', error => { console.error(error); server.close(); process.exitCode = 1; });
  child.on('exit', code => { server.close(); server.closeAllConnections(); process.exitCode = code ?? 1; });
});
