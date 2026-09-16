import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, angleAt } from '../../lib/measure/geometry.ts';

test('distance works in 2D and 3D from the same implementation', () => {
  assert.equal(distance([0, 0], [3, 4]), 5);
  assert.equal(distance([0, 0, 0], [0, 3, 4]), 5);
  assert.equal(distance([1, 1, 1], [1, 1, 1]), 0);
});

test('distance refuses to compare points of different dimensions', () => {
  assert.throws(() => distance([0, 0], [1, 1, 1]), RangeError);
});

test('angleAt measures the angle at the middle point', () => {
  const right = angleAt([0, 0], [1, 0], [0, 1]);
  assert.ok(Math.abs(right - Math.PI / 2) < 1e-12);

  const straight = angleAt([0, 0], [1, 0], [-1, 0]);
  assert.ok(Math.abs(straight - Math.PI) < 1e-12);
});

test('angleAt works in 3D', () => {
  const right = angleAt([0, 0, 0], [5, 0, 0], [0, 0, 5]);
  assert.ok(Math.abs(right - Math.PI / 2) < 1e-12);
});

// The trap this exists for: dot/(|a||b|) can land on 1.0000000000000002 for genuinely
// collinear input, and Math.acos of that is NaN. Without clamping, pointing at two points
// on the same edge produces a blank label instead of 0.0°.
test('angleAt clamps floating-point overshoot instead of returning NaN', () => {
  const collinear = angleAt([0, 0, 0], [0.1, 0.2, 0.3], [0.2, 0.4, 0.6]);
  assert.ok(Number.isFinite(collinear), 'expected a finite angle');
  assert.ok(Math.abs(collinear) < 1e-6);
});

test('angleAt returns NaN when a leg has no length', () => {
  assert.ok(Number.isNaN(angleAt([0, 0], [0, 0], [1, 0])));
  assert.ok(Number.isNaN(angleAt([0, 0], [1, 0], [0, 0])));
});
