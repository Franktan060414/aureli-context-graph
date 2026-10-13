import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../src/lib/api.js';

test('Tavily settings use shared API endpoints, no-store reads and POST bodies for secrets', async context => {
  const calls = [];
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json({ success: true, data: { enabled: false, mcpUrl: 'https://mcp.tavily.com/mcp/', keyConfigured: true } });
  });
  const api = createApiClient('http://127.0.0.1:18081', () => 'map-should-not-be-sent');
  await api.tavilySettings();
  assert.equal(calls[0].url, 'http://127.0.0.1:18081/customer-service/tavily-settings');
  assert.equal(calls[0].options.cache, 'no-store');
  await api.saveTavilySettings({ enabled: true, mcpUrl: 'https://mcp.tavily.com/mcp/', apiKey: 'fixture-secret' });
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(JSON.parse(calls[1].options.body).apiKey, 'fixture-secret');
  assert.equal(JSON.parse(calls[1].options.body).mapId, undefined);
  assert.ok(!calls[1].url.includes('fixture-secret'));
  await api.testTavilySettings();
  assert.equal(calls[2].url, 'http://127.0.0.1:18081/customer-service/tavily-settings/test');
  assert.equal(calls[2].options.method, 'POST');
  assert.equal(calls[2].options.body, undefined);
});
