import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectEvictions, BUDGET_BYTES, MIN_RETAINED } from '../../lib/model/modelCache.ts';

const MB = 1024 * 1024;
const e = (url, mb, lastUsed) => ({ url, bytes: mb * MB, lastUsed });

test('the defaults match the spec', () => {
  assert.equal(BUDGET_BYTES, 300 * MB);
  assert.equal(MIN_RETAINED, 2);
});

test('nothing is evicted when everything fits', () => {
  const entries = [e('a', 10, 3), e('b', 10, 2), e('c', 10, 1)];
  assert.deepEqual(selectEvictions(entries, 'a'), []);
});

test('an empty cache evicts nothing', () => {
  assert.deepEqual(selectEvictions([], 'a'), []);
});

test('the coldest entries go once the budget is blown', () => {
  const entries = [e('a', 100, 4), e('b', 100, 3), e('c', 100, 2), e('d', 100, 1)];
  // a + b + c = 300MB exactly, which fits. d does not.
  assert.deepEqual(selectEvictions(entries, 'a'), ['d']);
});

test('once over budget, every colder entry goes — no cherry-picking a small one', () => {
  // The fixture must leave real HEADROOM after the minRetained cutoff, or it cannot
  // tell the two algorithms apart. a+b retain 200MB of the 300MB budget, leaving
  // 100MB free. 'c' at 150MB does not fit, so it trips the cascade. 'd' at 50MB
  // WOULD fit in that headroom, so a "keep whatever still fits" implementation
  // retains it and returns ['c']; only the strictly-ordered cascade returns
  // ['c','d'].
  //
  // An earlier fixture here used 150/150/150/1 MB, where a+b came to EXACTLY the
  // budget. With zero headroom both algorithms return ['c','d'], so the test passed
  // against the very regression it existed to catch.
  const entries = [e('a', 100, 4), e('b', 100, 3), e('c', 150, 2), e('d', 50, 1)];
  assert.deepEqual(selectEvictions(entries, 'a'), ['c', 'd']);
});

test('the active model is never evicted, even when it is the coldest', () => {
  const entries = [e('a', 200, 1), e('b', 200, 4), e('c', 200, 3)];
  const evicted = selectEvictions(entries, 'a');
  assert.ok(!evicted.includes('a'), 'the active model must survive');
});

test('at least MIN_RETAINED entries survive even when both blow the budget', () => {
  // Two 400MB models are over budget together, but A -> B -> A must still be
  // instant, so both are kept.
  const entries = [e('a', 400, 2), e('b', 400, 1)];
  assert.deepEqual(selectEvictions(entries, 'a'), []);
});

test('a single model larger than the whole budget is still retained while active', () => {
  const entries = [e('huge', 900, 1)];
  assert.deepEqual(selectEvictions(entries, 'huge'), []);
});

test('the budget and floor are overridable', () => {
  const entries = [e('a', 10, 3), e('b', 10, 2), e('c', 10, 1)];
  assert.deepEqual(selectEvictions(entries, 'a', 15 * MB, 1), ['b', 'c']);
});
