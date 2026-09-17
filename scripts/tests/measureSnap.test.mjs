import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEASURE_SNAP_STEP, snapMeasureSegment, snapMeasurePoint } from '../../lib/measure/snap.ts';

const deg = (r) => (r * 180) / Math.PI;
const angleOf = (a, b) => deg(Math.atan2(b.y - a.y, b.x - a.x));

test('the step is 15 degrees', () => {
  assert.ok(Math.abs(deg(MEASURE_SNAP_STEP) - 15) < 1e-12);
});

test('a nearly-horizontal segment snaps flat', () => {
  const p = snapMeasureSegment(0, 0, 100, 7);
  assert.ok(Math.abs(angleOf({ x: 0, y: 0 }, p)) < 1e-9);
});

// The snap is ABSOLUTE, not a quantised delta: a 7 degree segment goes to 0, never to 15.
test('a 7 degree segment snaps to 0, not to 15', () => {
  const p = snapMeasureSegment(0, 0, Math.cos(deg2rad(7)) * 50, Math.sin(deg2rad(7)) * 50);
  assert.ok(Math.abs(angleOf({ x: 0, y: 0 }, p)) < 1e-9);
});
function deg2rad(d) { return (d * Math.PI) / 180; }

test('every 15 degree multiple is reachable, from either side', () => {
  for (const target of [15, 30, 45, 60, 75, 90, 120, 165]) {
    for (const nudge of [-4, 4]) {
      const a = deg2rad(target + nudge);
      const p = snapMeasureSegment(0, 0, Math.cos(a) * 80, Math.sin(a) * 80);
      const got = angleOf({ x: 0, y: 0 }, p);
      assert.ok(Math.abs(got - target) < 1e-9, `${target}${nudge >= 0 ? '+' : ''}${nudge} -> ${got}`);
    }
  }
});

// atan2 returns (-pi, pi], so the snap must behave across the discontinuity.
test('it works across the 180 degree wrap', () => {
  const near = deg2rad(178);
  const p = snapMeasureSegment(0, 0, Math.cos(near) * 40, Math.sin(near) * 40);
  assert.ok(Math.abs(Math.abs(angleOf({ x: 0, y: 0 }, p)) - 180) < 1e-9);
});

test('length is preserved exactly enough to measure with', () => {
  const p = snapMeasureSegment(10, 10, 10 + 60, 10 + 13);
  const length = Math.hypot(p.x - 10, p.y - 10);
  assert.ok(Math.abs(length - Math.hypot(60, 13)) < 1e-9);
});

test('it snaps about the anchor, not the origin', () => {
  const p = snapMeasureSegment(200, 500, 300, 507);
  assert.ok(Math.abs(p.y - 500) < 1e-9);
  assert.ok(Math.abs(p.x - 300) < 0.25);  // tolerance accounts for length preservation
});

// A zero-length segment has no direction to snap. Returning the point unchanged keeps the
// caller's first click exactly where it was put, instead of NaN from atan2(0,0)/hypot.
test('a zero-length segment is returned unchanged', () => {
  const p = snapMeasureSegment(42, 17, 42, 17);
  assert.deepEqual(p, { x: 42, y: 17 });
});

test('snapMeasurePoint passes the point straight through without Shift', () => {
  assert.deepEqual(snapMeasurePoint([0, 0], [100, 7], false), [100, 7]);
});

// The first click of a gesture has nothing to snap about. Shift must be inert there rather
// than snapping against a stale or absent anchor.
test('snapMeasurePoint passes through when there is no anchor', () => {
  assert.deepEqual(snapMeasurePoint(undefined, [100, 7], true), [100, 7]);
});

test('snapMeasurePoint snaps about the anchor when Shift is held', () => {
  const [x, y] = snapMeasurePoint([200, 500], [300, 507], true);
  assert.ok(Math.abs(y - 500) < 1e-9);
  assert.ok(Math.abs(x - 300) < 0.25);  // tolerance accounts for length preservation
});
