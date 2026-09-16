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

// The trap this exists for: dot/(|a||b|) can land one ulp outside [-1, 1] for genuinely
// collinear input, and Math.acos of such a value is NaN. Without clamping to [-1, 1], the
// quotient lands at 1.0000000000000002 or -1.0000000000000002, producing NaN instead of 0 or π.
// That would render as a blank measurement label for a perfectly valid gesture.
test('angleAt clamps upper overshoot: dot/denominator lands at 1.0000000000000002', () => {
  const angle = angleAt([0, 0, 0], [0.1, 0.1, 0.2], [0.5, 0.5, 1.0]);
  // Without the clamp, Math.acos(1.0000000000000002) is NaN; with it, Math.acos(1) is 0.
  assert.ok(Number.isFinite(angle), 'expected a finite angle');
  assert.ok(Math.abs(angle) < 1e-12);
});

test('angleAt clamps lower overshoot: dot/denominator lands at -1.0000000000000002', () => {
  const angle = angleAt([0, 0, 0], [0.1, 0.1, 0.2], [-0.5, -0.5, -1.0]);
  // Without the clamp, Math.acos(-1.0000000000000002) is NaN; with it, Math.acos(-1) is π.
  assert.ok(Number.isFinite(angle), 'expected a finite angle');
  assert.ok(Math.abs(angle - Math.PI) < 1e-12);
});

test('angleAt returns NaN when a leg has no length', () => {
  assert.ok(Number.isNaN(angleAt([0, 0], [0, 0], [1, 0])));
  assert.ok(Number.isNaN(angleAt([0, 0], [1, 0], [0, 0])));
});
