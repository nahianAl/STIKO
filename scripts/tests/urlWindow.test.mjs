// scripts/tests/urlWindow.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { URL_WINDOW_MS, signingWindowStart } from '../../lib/urlWindow.ts';

const HOUR = 60 * 60 * 1000;

test('the window is one hour', () => {
  assert.equal(URL_WINDOW_MS, HOUR);
});

test('a timestamp is floored to the start of its hour', () => {
  const aligned = Math.floor(1757318400000 / HOUR) * HOUR;
  assert.equal(signingWindowStart(aligned + 12345).getTime(), aligned);
});

test('two times in the same window floor to the same instant', () => {
  const aligned = Math.floor(1757318400000 / HOUR) * HOUR;
  assert.equal(
    signingWindowStart(aligned + 60_000).getTime(),
    signingWindowStart(aligned + 3_599_000).getTime()
  );
});

test('a time in the next window floors to a different instant', () => {
  const aligned = Math.floor(1757318400000 / HOUR) * HOUR;
  assert.notEqual(
    signingWindowStart(aligned + 3_599_000).getTime(),
    signingWindowStart(aligned + 3_601_000).getTime()
  );
});

test('an exact boundary belongs to the window it opens, not the one it closes', () => {
  const aligned = Math.floor(1757318400000 / HOUR) * HOUR;
  assert.equal(signingWindowStart(aligned).getTime(), aligned);
});

test('the window size is overridable, for tests that need a short one', () => {
  assert.equal(signingWindowStart(1000, 1000).getTime(), 1000);
  assert.equal(signingWindowStart(1999, 1000).getTime(), 1000);
  assert.equal(signingWindowStart(2000, 1000).getTime(), 2000);
});
