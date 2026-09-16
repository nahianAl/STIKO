import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginGesture, addPoint, pointsNeeded } from '../../lib/measure/gesture.ts';

test('a linear needs two points, an angle needs three', () => {
  assert.equal(pointsNeeded('linear'), 2);
  assert.equal(pointsNeeded('angular'), 3);
});

test('two clicks commit a linear measurement', () => {
  let g = beginGesture('linear');
  const first = addPoint(g, [0, 0], 3);
  assert.equal(first.status, 'pending');
  assert.deepEqual(first.gesture.points, [[0, 0]]);

  const second = addPoint(first.gesture, [100, 0], 3);
  assert.equal(second.status, 'committed');
  assert.equal(second.measurement.kind, 'linear');
  assert.deepEqual(second.measurement.points, [[0, 0], [100, 0]]);
});

test('three clicks commit an angular measurement in leg-vertex-leg order', () => {
  let r = addPoint(beginGesture('angular'), [10, 0], 3);
  r = addPoint(r.gesture, [0, 0], 3);
  assert.equal(r.status, 'pending');
  r = addPoint(r.gesture, [0, 10], 3);
  assert.equal(r.status, 'committed');
  assert.deepEqual(r.measurement.points, [[10, 0], [0, 0], [0, 10]]);
});

test('a linear shorter than minSeparation is rejected, not committed', () => {
  const first = addPoint(beginGesture('linear'), [0, 0], 3);
  const second = addPoint(first.gesture, [1, 1], 3);
  assert.equal(second.status, 'rejected');
  assert.equal(second.reason, 'degenerate');
});

test('minSeparation is per-surface — 3D passes a scene-scaled epsilon', () => {
  const first = addPoint(beginGesture('linear'), [0, 0, 0], 0.0001);
  const second = addPoint(first.gesture, [0.01, 0, 0], 0.0001);
  assert.equal(second.status, 'committed');
});

test('an angle with a zero-length leg is rejected', () => {
  let r = addPoint(beginGesture('angular'), [0, 0], 3);
  r = addPoint(r.gesture, [0, 0], 3);
  r = addPoint(r.gesture, [0, 10], 3);
  assert.equal(r.status, 'rejected');
});

test('three collinear clicks are rejected — almost always a misclick', () => {
  let r = addPoint(beginGesture('angular'), [0, 0], 3);
  r = addPoint(r.gesture, [50, 0], 3);
  r = addPoint(r.gesture, [100, 0], 3);
  assert.equal(r.status, 'rejected');
});

test('the page is carried from the gesture onto the committed measurement', () => {
  const first = addPoint(beginGesture('linear', 4), [0, 0], 3);
  const second = addPoint(first.gesture, [100, 0], 3);
  assert.equal(second.measurement.page, 4);
});

test('a rejected gesture does not mutate the pending gesture it came from', () => {
  const first = addPoint(beginGesture('linear'), [0, 0], 3);
  const before = JSON.stringify(first.gesture);
  addPoint(first.gesture, [1, 1], 3);
  assert.equal(JSON.stringify(first.gesture), before);
});
