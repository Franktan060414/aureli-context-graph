import test from 'node:test';
import assert from 'node:assert/strict';
import { labelForTile, labelStyle, commonLabelId } from '../src/lib/labels.js';
import { createApiClient } from '../src/lib/api.js';

test('labels support null, string IDs, missing references and mixed selections', () => {
  const label = { id: 1, name: '研究', colorHex: '#E8F2FF' };
  assert.equal(labelForTile({ labelId: '1' }, [label]), label);
  assert.equal(labelForTile({ labelId: null }, [label]), null);
  assert.equal(labelForTile({ labelId: 2 }, [label]), null);
  assert.equal(commonLabelId([]), '');
  assert.equal(commonLabelId([{ labelId: null }, {}]), '');
  assert.equal(commonLabelId([{ labelId: 1 }, { labelId: '1' }]), '1');
  assert.equal(commonLabelId([{ labelId: 1 }, { labelId: null }]), 'mixed');
});
test('every HEX background chooses a readable black or white foreground and rejects invalid colors', () => {
  for (let color = 0; color <= 0xffffff; color += 8191) {
    const hex = `#${color.toString(16).padStart(6, '0')}`;
    const style = labelStyle({ colorHex: hex });
    const linear = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const l = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
    const ratio = style['--tile-label-fg'] === '#000000' ? (l + .05) / .05 : 1.05 / (l + .05);
    assert.ok(ratio >= 4.5, `${hex} contrast ${ratio}`);
  }
  assert.deepEqual(labelStyle({ colorHex: 'red' }), {});
  assert.deepEqual(labelStyle(null), {});
});
test('label creation, edits, deletion and bulk clear keep the captured map scope', async () => {
  const previous = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
    return new Response(JSON.stringify({ success: true, data: {} }));
  };
  try {
    const client = createApiClient('https://example.test', () => 'map a');
    await client.createLabel({ name: '研究', colorHex: '#FFFFFF' });
    await client.updateLabel(1, { name: '更新', colorHex: '#000000' });
    await client.deleteLabel(1);
    await client.assignLabel(['one', 'two'], null);
    assert.equal(calls[0].body.mapId, 'map a');
    assert.equal(calls[1].body.mapId, 'map a');
    assert.equal(calls[2].url, 'https://example.test/customer-service/labels/1?mapId=map%20a');
    assert.equal(calls[2].method, 'DELETE');
    assert.deepEqual(calls[3].body, { mapId: 'map a', tileIds: ['one', 'two'], labelId: null });
  } finally { globalThis.fetch = previous; }
});
