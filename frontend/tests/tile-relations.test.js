import assert from 'node:assert/strict';
import test from 'node:test';
import { relationTypeForEdge } from '../src/lib/tile-relations.js';

test('split relations preserve their meaning across corrected and legacy spelling', () => {
  for (const relationType of ['DIVIDES', 'DEVIDES']) {
    assert.equal(relationTypeForEdge({ relationType, direction: 'DIRECTED' }), 'DIVIDES');
  }
  assert.equal(relationTypeForEdge({ relationType: 'FUSES', direction: 'DIRECTED' }), 'FUSES');
  assert.equal(relationTypeForEdge({ relationType: 'CUSTOM', direction: 'UNDIRECTED' }), 'RELATES');
  assert.equal(relationTypeForEdge({ relationType: 'CUSTOM', direction: 'DIRECTED' }), 'EXTENDS');
});
