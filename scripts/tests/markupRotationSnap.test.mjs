import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RIGHT_ANGLE,
  ROTATION_SNAPS_DEG,
  ROTATION_SNAP_TOLERANCE_DEG,
  snapToRightAngle,
  snapEulerToRightAngles,
} from '../../lib/markup/rotationSnap.ts';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('the Konva snap set is the four right angles, in degrees', () => {
  assert.deepEqual(ROTATION_SNAPS_DEG, [0, 90, 180, 270]);
});

test('the tolerance reaches halfway to the neighbouring snap', () => {
  // Konva's default is 5 deg, which would snap only near-aligned rotations and make Shift
  // look broken everywhere else. 45 puts every angle within reach of the nearest of four.
  assert.equal(ROTATION_SNAP_TOLERANCE_DEG, 45);
});

test('snapping is absolute, not incremental', () => {
  // An object at 7 deg goes to 0, never to 97.
  close(snapToRightAngle(0.12), 0, 'a small angle straightens');
  close(snapToRightAngle(RIGHT_ANGLE + 0.1), RIGHT_ANGLE, 'near a right angle');
  close(snapToRightAngle(Math.PI - 0.2), Math.PI, 'near a half turn');
  close(snapToRightAngle(-0.2), 0, 'negative small angles straighten too');
  close(snapToRightAngle(-1.4), -RIGHT_ANGLE, 'and negative right angles are kept negative');
  close(snapToRightAngle(2 * Math.PI - 0.05), 2 * Math.PI, 'a full turn is a snap point');
});

test('ties round toward positive infinity (away on +, toward on -)', () => {
  // Math.round(0.5) is 1, rounding away from zero.
  close(snapToRightAngle(RIGHT_ANGLE / 2), RIGHT_ANGLE, '+45° → +90°');
  // Math.round(-0.5) is 0 via -Infinity, rounding toward zero. Result is 0, not -0.
  assert.ok(Object.is(snapToRightAngle(-RIGHT_ANGLE / 2), 0), '-45° → 0 (not -0)');
  // Math.round(-1.5) is -1, rounding toward +Infinity.
  close(snapToRightAngle(-3 * RIGHT_ANGLE / 2), -RIGHT_ANGLE, '-135° → -90°');
});

test('a straightened angle is never negative zero', () => {
  // -0 flows into three.js Euler and out to the persisted transform, where it compares
  // unequal to 0 under Object.is and shows up as a spurious diff.
  assert.ok(Object.is(snapToRightAngle(-0.01), 0), 'got -0');
});

test('an Euler triple snaps component-wise', () => {
  const out = snapEulerToRightAngles([0.05, RIGHT_ANGLE - 0.05, Math.PI + 0.05]);
  assert.equal(out.length, 3);
  close(out[0], 0, 'x');
  close(out[1], RIGHT_ANGLE, 'y');
  close(out[2], Math.PI, 'z');
});
