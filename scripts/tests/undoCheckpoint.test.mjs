import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shallowEqual, checkpointStep } from '../../lib/undo/checkpoint.ts';

const a = { id: 'a' };
const b = { id: 'b' };

test('arrays with the same items are equal even when the array is new', () => {
  // A filter that removed nothing returns a fresh array: that is not a change.
  assert.equal(shallowEqual([a, b], [a, b]), true);
  assert.equal(shallowEqual([a, b], [a, b].filter(() => true)), true);
});

test('a reorder, a replaced item, or a length change is a change', () => {
  assert.equal(shallowEqual([a, b], [b, a]), false);
  assert.equal(shallowEqual([a, b], [a, { id: 'b' }]), false);
  assert.equal(shallowEqual([a], [a, b]), false);
});

test('records compare key by key, by identity', () => {
  const s1 = { visible: false };
  const s2 = { visible: false };
  assert.equal(shallowEqual({ 1: s1, 2: s2 }, { 1: s1, 2: s2 }), true);
  assert.equal(shallowEqual({ 1: s1, 2: s2 }, { 1: s1, 2: { visible: true } }), false);
  assert.equal(shallowEqual({ 1: s1 }, { 1: s1, 2: s2 }), false);
});

test('an array never equals a record, and primitives compare by value', () => {
  assert.equal(shallowEqual([], {}), false);
  assert.equal(shallowEqual(1, 1), true);
  assert.equal(shallowEqual(null, {}), false);
});

test('checkpointStep: no step without a change, otherwise before/after', () => {
  const base = [a];
  assert.equal(checkpointStep(base, [a]), null);
  const next = [a, b];
  assert.deepEqual(checkpointStep(base, next), { before: base, after: next });
  assert.equal(checkpointStep(base, next).before, base);
  assert.equal(checkpointStep(base, next).after, next);
});
