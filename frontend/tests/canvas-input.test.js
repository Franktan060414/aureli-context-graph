import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasWheelClassifier } from '../src/lib/canvas-input.js';

const event = (deltaY, overrides = {}) => ({ deltaX: 0, deltaY, deltaMode: 0, ctrlKey: false, ...overrides });
test('mouse notches and line/page wheels retain zoom', () => {
  const input = createCanvasWheelClassifier();
  for (const delta of [100, -100, 120, -120]) assert.equal(input.classify(event(delta)), 'zoom');
  assert.equal(input.classify(event(3, { deltaMode: 1 })), 'zoom');
  assert.equal(input.classify(event(-1, { deltaMode: 2 })), 'zoom');
  assert.equal(input.classify(event(12, { wheelDeltaY: -120 })), 'zoom', 'small mouse notches retain zoom');
});
test('fine, horizontal, diagonal, precise and momentum trackpad deltas pan', () => {
  for (const sample of [event(5), event(-2.5), event(0, { deltaX: 80 }), event(120, { deltaX: 2 }),
    event(80, { wheelDeltaY: -240 }), event(120, { momentum: true })]) {
    assert.equal(createCanvasWheelClassifier().classify(sample), 'pan');
  }
});
test('accelerating and decelerating trackpad gestures stay in pan mode', () => {
  const input = createCanvasWheelClassifier();
  assert.equal(input.classify(event(2), 0), 'pan');
  assert.equal(input.classify(event(100), 16), 'pan');
  assert.equal(input.classify(event(60), 240), 'pan');
  assert.equal(input.classify(event(4), 420), 'pan');
  assert.equal(input.classify(event(100), 800), 'zoom', 'idle clears the gesture');
  input.classify(event(2), 810);
  assert.equal(input.classify(event(100, { wheelDeltaY: -120 }), 820), 'zoom', 'switching to a mouse works immediately');
  input.reset(); assert.equal(input.classify(event(100), 830), 'zoom');
});
test('pinch/Ctrl always zooms even during a trackpad pan', () => {
  const input = createCanvasWheelClassifier();
  input.classify(event(2), 0);
  assert.equal(input.classify(event(-2, { ctrlKey: true, deltaX: 1 }), 16), 'zoom');
});
