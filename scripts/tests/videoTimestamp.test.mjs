import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatVideoTimestamp } from '../../lib/videoTimestamp.ts';

test('formats under a minute with a zero minute', () => {
  assert.equal(formatVideoTimestamp(0), '0:00');
  assert.equal(formatVideoTimestamp(7), '0:07');
});

test('floors fractional seconds rather than rounding up', () => {
  assert.equal(formatVideoTimestamp(4.6), '0:04');
  assert.equal(formatVideoTimestamp(59.999), '0:59');
});

test('formats minutes and hours', () => {
  assert.equal(formatVideoTimestamp(754), '12:34');
  assert.equal(formatVideoTimestamp(3723), '1:02:03');
});

test('treats bad input as the start', () => {
  assert.equal(formatVideoTimestamp(NaN), '0:00');
  assert.equal(formatVideoTimestamp(-3), '0:00');
  assert.equal(formatVideoTimestamp(Infinity), '0:00');
});
