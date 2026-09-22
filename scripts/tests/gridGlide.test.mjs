import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnCount, planGlides } from '../../lib/gridGlide.ts';

const pts = (obj) => new Map(Object.entries(obj));

/* ----------------------------------------------------------- columnCount -- */

test('columnCount counts resolved tracks', () => {
  assert.equal(columnCount('300px 300px 300px'), 3);
  assert.equal(columnCount('  220px  '), 1);
  assert.equal(columnCount('241.5px 241.5px'), 2);
});

test('columnCount is zero for no tracks', () => {
  assert.equal(columnCount('none'), 0);
  assert.equal(columnCount(''), 0);
});

/* ------------------------------------------------------------ planGlides -- */

test('nothing glides while the column count holds — that is drift', () => {
  const prev = pts({ a: { x: 0, y: 0 }, b: { x: 242, y: 0 } });
  const next = pts({ a: { x: 0, y: 0 }, b: { x: 230, y: 0 } });
  assert.deepEqual(planGlides(prev, next, false), []);
});

test('a column change glides every card that moved, from its old spot', () => {
  const prev = pts({ a: { x: 0, y: 0 }, b: { x: 242, y: 0 }, c: { x: 484, y: 0 } });
  const next = pts({ a: { x: 0, y: 0 }, b: { x: 322, y: 0 }, c: { x: 0, y: 198 } });
  assert.deepEqual(planGlides(prev, next, true), [
    { key: 'b', dx: -80, dy: 0 },
    { key: 'c', dx: 484, dy: -198 },
  ]);
});

test('sub-pixel movement does not glide', () => {
  const prev = pts({ a: { x: 10, y: 0 } });
  const next = pts({ a: { x: 10.4, y: 0.3 } });
  assert.deepEqual(planGlides(prev, next, true), []);
});

test('a card with no previous position does not glide', () => {
  const prev = pts({ a: { x: 0, y: 0 } });
  const next = pts({ a: { x: 0, y: 0 }, fresh: { x: 242, y: 0 } });
  assert.deepEqual(planGlides(prev, next, true), []);
});

test('a card that has gone is ignored', () => {
  const prev = pts({ gone: { x: 242, y: 0 } });
  const next = pts({});
  assert.deepEqual(planGlides(prev, next, true), []);
});

test('a card caught mid-glide starts from where it visibly is', () => {
  const prev = pts({ c: { x: 484, y: 0 } });
  const next = pts({ c: { x: 0, y: 198 } });
  // Still showing translate(-100px, 20px) from an unfinished glide.
  const inFlight = pts({ c: { x: -100, y: 20 } });
  assert.deepEqual(planGlides(prev, next, true, inFlight), [
    { key: 'c', dx: 384, dy: -178 },
  ]);
});

test('a mid-glide card whose layout did not move is left to finish', () => {
  const prev = pts({ a: { x: 0, y: 0 } });
  const next = pts({ a: { x: 0, y: 0 } });
  const inFlight = pts({ a: { x: 50, y: 0 } });
  assert.deepEqual(planGlides(prev, next, true, inFlight), []);
});

test('a grid that moved as a whole glides every card by the same amount', () => {
  // The header above re-wrapped and pushed the grid down 46px; no column change.
  const prev = pts({ a: { x: 4, y: 71 }, b: { x: 246, y: 71 } });
  const next = pts({ a: { x: 4, y: 117 }, b: { x: 246, y: 117 } });
  assert.deepEqual(planGlides(prev, next, true), [
    { key: 'a', dx: 0, dy: -46 },
    { key: 'b', dx: 0, dy: -46 },
  ]);
});
