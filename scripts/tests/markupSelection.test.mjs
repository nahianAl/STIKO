import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickId, mergeSelection, normalizeBox, boxesTouch, isTinyBox } from '../../lib/markup/selection.ts';

test('pickId: plain click selects only the object, unless it is already selected', () => {
  assert.deepEqual(pickId([], 'a', false), ['a']);
  assert.deepEqual(pickId(['b', 'c'], 'a', false), ['a']);
  // Already selected: keep the group so a drag moves all of it.
  assert.deepEqual(pickId(['b', 'a'], 'a', false), ['b', 'a']);
});

test('pickId: shift-click toggles', () => {
  assert.deepEqual(pickId(['b'], 'a', true), ['b', 'a']);
  assert.deepEqual(pickId(['b', 'a'], 'a', true), ['b']);
  assert.deepEqual(pickId([], 'a', true), ['a']);
});

test('mergeSelection replaces, or adds without duplicates', () => {
  assert.deepEqual(mergeSelection(['x'], ['a', 'b'], false), ['a', 'b']);
  assert.deepEqual(mergeSelection(['x', 'a'], ['a', 'b'], true), ['x', 'a', 'b']);
  assert.deepEqual(mergeSelection(['x'], [], false), []);
  assert.deepEqual(mergeSelection(['x'], [], true), ['x']);
  assert.deepEqual(mergeSelection([], ['a', 'a'], false), ['a']);
});

test('normalizeBox works for a drag in any direction', () => {
  const want = { x: 10, y: 20, width: 30, height: 40 };
  assert.deepEqual(normalizeBox({ x: 10, y: 20 }, { x: 40, y: 60 }), want);
  assert.deepEqual(normalizeBox({ x: 40, y: 60 }, { x: 10, y: 20 }), want);
  assert.deepEqual(normalizeBox({ x: 40, y: 20 }, { x: 10, y: 60 }), want);
});

test('boxesTouch: any overlap or shared edge counts; separation does not', () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(boxesTouch(box, { x: 5, y: 5, width: 10, height: 10 }), true);   // partial overlap
  assert.equal(boxesTouch(box, { x: 2, y: 2, width: 2, height: 2 }), true);     // fully inside
  assert.equal(boxesTouch(box, { x: -5, y: -5, width: 30, height: 30 }), true); // fully around
  assert.equal(boxesTouch(box, { x: 10, y: 0, width: 5, height: 5 }), true);    // shared edge
  assert.equal(boxesTouch(box, { x: 11, y: 0, width: 5, height: 5 }), false);   // right of
  assert.equal(boxesTouch(box, { x: 0, y: -6, width: 5, height: 5 }), false);   // above
  // A zero-width box (a vertical line's bounds) still touches when it crosses.
  assert.equal(boxesTouch(box, { x: 5, y: -5, width: 0, height: 30 }), true);
});

test('isTinyBox: tiny only when BOTH sides are under the threshold', () => {
  assert.equal(isTinyBox({ x: 0, y: 0, width: 2, height: 2 }, 3), true);
  assert.equal(isTinyBox({ x: 0, y: 0, width: 2, height: 50 }, 3), false);
  assert.equal(isTinyBox({ x: 0, y: 0, width: 3, height: 0 }, 3), false);
  assert.equal(isTinyBox({ x: 0, y: 0, width: 0.5, height: 0.5 }, 0.75), true);
});
