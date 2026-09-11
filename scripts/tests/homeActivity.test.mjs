import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityAccent, groupActivity } from '../../lib/home.ts';

/* ---------------------------------------------------------------- accent -- */

test('mentions and requested changes are the red, attention-carrying kinds', () => {
  assert.deepEqual(activityAccent('mention'), {
    badge: 'MENTION', border: '#FF6B6B', bg: '#F6F8FE',
  });
  assert.deepEqual(activityAccent('changes_requested'), {
    badge: 'ACTION', border: '#FF6B6B', bg: '#F6F8FE',
  });
});

test('a new version is yellow and badged NEW', () => {
  assert.deepEqual(activityAccent('new_version'), {
    badge: 'NEW', border: '#FFCF2E', bg: '#F6F8FE',
  });
});

test('ordinary activity carries no badge and no fill', () => {
  // The border stays null so the component can render a TRANSPARENT 3px
  // border: without it, text baselines shift between the two kinds of row.
  for (const type of ['comment_reply', 'new_comment', 'invite_accepted', 'approved']) {
    assert.deepEqual(activityAccent(type), { badge: null, border: null, bg: null }, type);
  }
});

test('an unknown notification type degrades to plain, not to a crash', () => {
  // The CHECK constraint can gain a type before this map does.
  assert.deepEqual(activityAccent('something_new'), { badge: null, border: null, bg: null });
});

/* ----------------------------------------------------------------- group -- */

const NOW = Date.parse('2026-09-11T15:00:00Z');
const at = (iso) => ({ createdAt: iso });

test('activity is bucketed by recency, newest group first', () => {
  const groups = groupActivity(
    [
      at('2026-09-11T09:00:00Z'),
      at('2026-09-10T22:00:00Z'),
      at('2026-09-08T10:00:00Z'),
      at('2026-08-01T10:00:00Z'),
    ],
    NOW
  );

  assert.deepEqual(groups.map((g) => g.label), [
    'Today', 'Yesterday', 'Earlier this week', 'Earlier',
  ]);
  assert.equal(groups[0].items.length, 1);
});

test('empty buckets are not rendered', () => {
  const groups = groupActivity([at('2026-09-11T09:00:00Z')], NOW);
  assert.deepEqual(groups.map((g) => g.label), ['Today']);
});

test('no activity produces no groups at all', () => {
  assert.deepEqual(groupActivity([], NOW), []);
});

test('items keep newest-first order inside a bucket', () => {
  const groups = groupActivity(
    [at('2026-09-11T09:00:00Z'), at('2026-09-11T13:00:00Z')],
    NOW
  );
  assert.deepEqual(
    groups[0].items.map((i) => i.createdAt),
    ['2026-09-11T13:00:00Z', '2026-09-11T09:00:00Z']
  );
});

test('a future timestamp lands in Today rather than vanishing', () => {
  // Clock skew between the database and the browser is real and must not
  // silently drop a row out of every bucket.
  const groups = groupActivity([at('2026-09-11T23:59:00Z')], NOW);
  assert.deepEqual(groups.map((g) => g.label), ['Today']);
});
