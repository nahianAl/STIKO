import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStale } from '../../lib/ai/staleness.ts';

test('a brief is stale when comments have been added since it was built', () => {
  assert.equal(isStale(10, 14), true);
});

test('a brief covering every comment is fresh', () => {
  assert.equal(isStale(10, 10), false);
});

test('a deleted comment does not make a brief stale', () => {
  // Live count below covered_count means comments were removed. The brief is
  // now over-complete, not under-complete — regenerating costs money and
  // changes nothing a reader cares about.
  assert.equal(isStale(10, 7), false);
});

test('a version with no brief yet is not described as stale', () => {
  // Absent and stale are different states in the UI: one offers "Summarise",
  // the other "Refresh". Passing null must not collapse them.
  assert.equal(isStale(null, 5), false);
});
