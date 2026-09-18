import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRASH_RETENTION_DAYS, daysRemaining } from '../../lib/trash.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-18T12:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY);

test('the window is 28 days', () => {
  assert.equal(TRASH_RETENTION_DAYS, 28);
});

test('days remaining counts whole days and never goes negative', () => {
  assert.equal(daysRemaining(daysAgo(0), NOW), 28);
  assert.equal(daysRemaining(daysAgo(2), NOW), 26);
  assert.equal(daysRemaining(daysAgo(28), NOW), 0);
  assert.equal(daysRemaining(daysAgo(400), NOW), 0, 'clamped, not negative');
});

test('a part-day remaining rounds up rather than reading as gone', () => {
  // Six hours left must say "1 day left", not "0" — a row that is still
  // restorable must never be labelled as though it has already been purged.
  assert.equal(daysRemaining(daysAgo(27.75), NOW), 1);
});

test('it accepts the ISO strings the HTTP driver returns', () => {
  // Neon's HTTP driver hands back TIMESTAMPTZ as a string, not a Date, so the
  // panel would otherwise be doing arithmetic on NaN.
  assert.equal(daysRemaining(daysAgo(10).toISOString(), NOW), 18);
});

test('a missing or unparseable timestamp reads as zero, not NaN', () => {
  // Fails closed: better to render "Gone today" than "NaN days left".
  assert.equal(daysRemaining(null, NOW), 0);
  assert.equal(daysRemaining('not a date', NOW), 0);
});
