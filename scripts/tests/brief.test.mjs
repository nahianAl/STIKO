import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIEF_MIN_COMMENTS,
  shouldShowBrief,
  briefDigest,
  statChips,
  stalenessLine,
} from '../../lib/brief.ts';
import { getInitials } from '../../lib/initials.ts';

// --- Whether the Brief renders at all -------------------------------------

test('a version with no comments has no brief section', () => {
  assert.equal(shouldShowBrief(0), false);
});

test('four comments is still not enough', () => {
  // "More than four" — the threshold is a product decision, not a rounding of
  // the auto-generate threshold. Four is the last count that shows nothing.
  assert.equal(shouldShowBrief(4), false);
});

test('five comments is the first count that shows a brief', () => {
  assert.equal(shouldShowBrief(5), true);
  assert.equal(BRIEF_MIN_COMMENTS, 5);
});

test('the show threshold and the auto-generate threshold are the same number', () => {
  // If generation fired below the show threshold we would pay a model call for
  // a brief no one can ever see. Asserted here so the two cannot drift apart.
  assert.equal(shouldShowBrief(BRIEF_MIN_COMMENTS), true);
  assert.equal(shouldShowBrief(BRIEF_MIN_COMMENTS - 1), false);
});

// --- Collapsed digest ------------------------------------------------------

test('the digest counts themes and the ones still open', () => {
  assert.equal(
    briefDigest([
      { firstSeenVersionId: 'v1' },
      { firstSeenVersionId: null },
      { firstSeenVersionId: 'v1' },
    ]),
    '3 themes · 2 still open'
  );
});

test('the digest drops the open clause when nothing is carried over', () => {
  assert.equal(
    briefDigest([{ firstSeenVersionId: null }, { firstSeenVersionId: null }]),
    '2 themes'
  );
});

test('a single theme is not pluralised', () => {
  assert.equal(briefDigest([{ firstSeenVersionId: null }]), '1 theme');
});

// --- Stat chips ------------------------------------------------------------

const FACTS = {
  commentCount: 7,
  openThreadCount: 2,
  approvedCount: 2,
  changesRequestedCount: 1,
  participantCount: 4,
};

test('the three neutral chips always render, in order', () => {
  const chips = statChips({ ...FACTS, approvedCount: 0, changesRequestedCount: 0 });
  assert.deepEqual(
    chips.map((c) => c.label),
    ['2 unanswered', '7 comments', '4 people']
  );
  assert.ok(chips.every((c) => c.tone === 'neutral'));
});

test('verdict chips render only when their count is above zero', () => {
  const labels = statChips(FACTS).map((c) => c.label);
  assert.deepEqual(labels, [
    '2 unanswered',
    '7 comments',
    '4 people',
    '1 change requested',
    '2 approved',
  ]);
});

test('one change requested is grammatical', () => {
  // The old string was "1 requested changes".
  const chip = statChips(FACTS).find((c) => c.tone === 'red');
  assert.equal(chip.label, '1 change requested');
});

test('several changes requested is also grammatical', () => {
  const chip = statChips({ ...FACTS, changesRequestedCount: 3 }).find((c) => c.tone === 'red');
  assert.equal(chip.label, '3 changes requested');
});

test('a lone participant is a person, not people', () => {
  // Reachable above the threshold: one author can leave all five comments.
  const chips = statChips({ ...FACTS, participantCount: 1 });
  assert.ok(chips.some((c) => c.label === '1 person'));
});

test('verdict chips carry the tone their colour comes from', () => {
  const chips = statChips(FACTS);
  assert.equal(chips.find((c) => c.label === '1 change requested').tone, 'red');
  assert.equal(chips.find((c) => c.label === '2 approved').tone, 'green');
});

test('mostAnnotatedFile is deliberately not a chip', () => {
  // Pending a placement decision from the design owner. If it reappears it must
  // be a considered choice, not a regression.
  const labels = statChips({ ...FACTS, mostAnnotatedFile: 'A-201' }).map((c) => c.label);
  assert.ok(!labels.some((l) => l.includes('A-201')));
});

// --- Staleness line --------------------------------------------------------

test('the staleness line is singular at one', () => {
  assert.equal(stalenessLine(1), '1 new comment since this brief');
});

test('the staleness line is plural above one', () => {
  assert.equal(stalenessLine(2), '2 new comments since this brief');
});

// --- Initials --------------------------------------------------------------

test('initials take the first letter of the first two words', () => {
  assert.equal(getInitials('Ada Lovelace'), 'AL');
  assert.equal(getInitials('Jean Baptiste Point du Sable'), 'JB');
});

test('a single name yields a single initial', () => {
  assert.equal(getInitials('Prince'), 'P');
});

test('extra whitespace does not become a blank initial', () => {
  assert.equal(getInitials('  Ada   Lovelace '), 'AL');
});

test('an empty name yields an empty string rather than throwing', () => {
  // The citation avatar falls back to "?" on its own; getInitials must not be
  // the thing that crashes the panel.
  assert.equal(getInitials(''), '');
});
