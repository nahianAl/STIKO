import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAKED_TYPES, scalePoints, normalizeBox } from '../../lib/markup/bakeScale.ts';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('every stroked type is baked; text and image keep their own handling', () => {
  for (const t of ['freehand', 'highlight', 'line', 'arrow', 'rect', 'ellipse', 'cloud']) assert.ok(BAKED_TYPES.has(t), t);
  assert.equal(BAKED_TYPES.has('text'), false);
  assert.equal(BAKED_TYPES.has('image'), false);
});

test('scalePoints multiplies x by sx and y by sy', () => {
  assert.deepEqual(scalePoints([1, 2, 3, 4], 2, 0.5), [2, 1, 6, 2]);
});

test('scalePoints with a negative scale mirrors through the origin', () => {
  assert.deepEqual(scalePoints([10, 5], -1, 1), [-10, 5]);
});

test('normalizeBox leaves a positive box alone', () => {
  assert.deepEqual(normalizeBox({ x: 5, y: 6, width: 10, height: 20, rotation: 30 }), { x: 5, y: 6, width: 10, height: 20 });
});

test('normalizeBox: negative width moves the origin left by the width, unrotated', () => {
  assert.deepEqual(normalizeBox({ x: 100, y: 50, width: -40, height: 20, rotation: 0 }), { x: 60, y: 50, width: 40, height: 20 });
});

test('normalizeBox: negative height moves the origin up by the height, unrotated', () => {
  assert.deepEqual(normalizeBox({ x: 100, y: 50, width: 40, height: -20, rotation: 0 }), { x: 100, y: 30, width: 40, height: 20 });
});

test('normalizeBox: the shift follows the rotated axes, so the box does not move on screen', () => {
  // Rotated 90deg: local +x points down the screen. A width of -40 spans 40px UP from the origin.
  const r = normalizeBox({ x: 100, y: 50, width: -40, height: 20, rotation: 90 });
  close(r.x, 100);
  close(r.y, 10);
  assert.equal(r.width, 40);
  assert.equal(r.height, 20);
});

test('normalizeBox: both extents negative, rotated 180', () => {
  // Rotated 180deg: local +x points left, +y points up. Extents (-30, -10) span right and down.
  const r = normalizeBox({ x: 0, y: 0, width: -30, height: -10, rotation: 180 });
  close(r.x, 30);
  close(r.y, 10);
  assert.equal(r.width, 30);
  assert.equal(r.height, 10);
});
