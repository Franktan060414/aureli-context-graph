import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMapZoomSaver } from '../src/lib/map-zoom.js';

test('zoom writes serialize per map and coalesce to the latest setting', async () => {
  const calls = [], errors = [];
  let release;
  const saver = createMapZoomSaver(error => errors.push(error));
  const send = zoom => { calls.push(zoom); return calls.length === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(); };
  const saved = saver.save('server:map-a', 0.6, send);
  saver.save('server:map-a', 0.7, send);
  saver.save('server:map-a', 0.8, send);
  assert.deepEqual(calls, [0.6]);
  assert.equal(saver.pending('server:map-a'), 0.8);
  release(); await saved;
  assert.deepEqual(calls, [0.6, 0.8]);
  assert.equal(saver.pending('server:map-a'), undefined);
  assert.deepEqual(errors, []);
});

test('a slow map save does not block another map or send it the wrong ratio', async () => {
  const calls = [];
  let release;
  const saver = createMapZoomSaver(() => {});
  const savedA = saver.save('server:map-a', 0.6, zoom => { calls.push(['a', zoom]); return new Promise(resolve => { release = resolve; }); });
  await saver.save('server:map-b', 1.2, zoom => { calls.push(['b', zoom]); });
  assert.deepEqual(calls, [['a', 0.6], ['b', 1.2]]);
  release(); await savedA;
});

test('failed saves report an error and a subsequent adjustment can save again', async () => {
  const errors = [], calls = [];
  const saver = createMapZoomSaver(error => errors.push(error.message));
  await saver.save('map-a', 0.7, async () => { throw new Error('offline'); });
  await saver.save('map-a', 0.8, async zoom => { calls.push(zoom); });
  assert.deepEqual(errors, ['offline']);
  assert.deepEqual(calls, [0.8]);
});

test('deleting a map discards queued zoom writes and ignores its late error', async () => {
  const errors = [], calls = [];
  let reject;
  const saver = createMapZoomSaver(error => errors.push(error.message));
  const running = saver.save('map-a', 0.6, zoom => { calls.push(['a', zoom]); return new Promise((_, fail) => { reject = fail; }); });
  saver.save('map-a', 0.8, zoom => { calls.push(['a', zoom]); });
  saver.discard('map-a');
  await saver.save('map-b', 1.2, zoom => { calls.push(['b', zoom]); });
  reject(new Error('map deleted')); await running;
  assert.equal(saver.pending('map-a'), undefined);
  assert.deepEqual(calls, [['a', 0.6], ['b', 1.2]]);
  assert.deepEqual(errors, []);
});
