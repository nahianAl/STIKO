import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepPoints, ERASE_SAMPLE_SPACING, MAX_ERASE_SAMPLES } from '../../lib/markup/eraseSweep.ts';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('the first sample of a drag is just the point itself', () => {
  assert.deepEqual(sweepPoints(null, { x: 5, y: 7 }), [{ x: 5, y: 7 }]);
});

test('a move shorter than the spacing is one sample', () => {
  assert.deepEqual(sweepPoints({ x: 0, y: 0 }, { x: 2, y: 2 }), [{ x: 2, y: 2 }]);
});

test('a fast flick is filled in so no object between frames is skipped', () => {
  const pts = sweepPoints({ x: 0, y: 0 }, { x: 60, y: 0 });
  assert.ok(pts.length >= 60 / ERASE_SAMPLE_SPACING, `only ${pts.length} samples across 60px`);
  let prev = { x: 0, y: 0 };
  for (const p of pts) {
    assert.ok(Math.hypot(p.x - prev.x, p.y - prev.y) <= ERASE_SAMPLE_SPACING + 1e-9, 'gap too wide');
    prev = p;
  }
});

test('the drag always ends exactly under the cursor', () => {
  const pts = sweepPoints({ x: 10, y: 10 }, { x: 137, y: -44 });
  close(pts[pts.length - 1].x, 137, 'last x');
  close(pts[pts.length - 1].y, -44, 'last y');
});

test('the origin is not re-sampled', () => {
  // It was erased on the previous event; re-testing it every move is pure waste.
  const pts = sweepPoints({ x: 0, y: 0 }, { x: 30, y: 0 });
  assert.ok(pts[0].x > 0, 'first sample must be past the origin');
});

test('an enormous jump is capped rather than allocating thousands of samples', () => {
  const pts = sweepPoints({ x: 0, y: 0 }, { x: 100000, y: 0 });
  assert.equal(pts.length, MAX_ERASE_SAMPLES);
  close(pts[pts.length - 1].x, 100000, 'and still ends under the cursor');
});

test('spacing is overridable', () => {
  assert.equal(sweepPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 50).length, 2);
});
