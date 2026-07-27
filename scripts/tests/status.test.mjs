import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveStatus,
  deriveAttention,
  approvalSummary,
} from '../../lib/status.ts';

const base = {
  hasVersion: true,
  isPublished: true,
  verdicts: [],
  requiredReviewers: 3,
};

test('a package with no version reads "no files yet"', () => {
  assert.equal(deriveStatus({ ...base, hasVersion: false }), 'no_files');
});

test('an unpublished version is a draft, whatever its verdicts', () => {
  assert.equal(
    deriveStatus({ ...base, isPublished: false, verdicts: ['approved'] }),
    'draft'
  );
});

test('a published version with no verdicts yet is in review', () => {
  assert.equal(deriveStatus(base), 'in_review');
});

test('one request for changes outranks every approval', () => {
  assert.equal(
    deriveStatus({
      ...base,
      verdicts: ['approved', 'approved', 'changes_requested'],
      requiredReviewers: 3,
    }),
    'changes_requested'
  );
});

test('approval needs every required reviewer, not a majority', () => {
  assert.equal(
    deriveStatus({ ...base, verdicts: ['approved', 'approved'] }),
    'in_review'
  );
  assert.equal(
    deriveStatus({
      ...base,
      verdicts: ['approved', 'approved', 'approved'],
    }),
    'approved'
  );
});

test('with no required reviewers a version never auto-approves', () => {
  assert.equal(
    deriveStatus({ ...base, verdicts: ['approved'], requiredReviewers: 0 }),
    'in_review'
  );
});

test('approval summary counts only approvals', () => {
  assert.equal(
    approvalSummary(['approved', 'changes_requested', 'approved'], 4),
    '2 of 4 approved'
  );
});

// --- personal attention -----------------------------------------------------

test('the zero state is "UP TO DATE" — no synonyms', () => {
  const pill = deriveAttention({
    mentions: 0,
    needsYou: 0,
    hasUnseenVersion: false,
  });
  assert.equal(pill.label, 'UP TO DATE');
});

test('a mention outranks a pending review and a new version', () => {
  assert.equal(
    deriveAttention({ mentions: 1, needsYou: 4, hasUnseenVersion: true }).label,
    '1 MENTION'
  );
});

test('mentions pluralise', () => {
  assert.equal(
    deriveAttention({ mentions: 3, needsYou: 0, hasUnseenVersion: false }).label,
    '3 MENTIONS'
  );
});

test('a new version shows only when nothing needs you', () => {
  assert.equal(
    deriveAttention({ mentions: 0, needsYou: 0, hasUnseenVersion: true }).label,
    'NEW VERSION'
  );
  assert.equal(
    deriveAttention({ mentions: 0, needsYou: 2, hasUnseenVersion: true }).label,
    '2 NEED YOU'
  );
});

test('attention pills are solid, status chips are outlined — they never match', () => {
  // 01: conflating these is the regression to watch for. A pill carries a
  // background; a chip carries a border.
  const pill = deriveAttention({
    mentions: 0,
    needsYou: 1,
    hasUnseenVersion: false,
  });
  assert.ok(pill.bg, 'attention pill must be solid');
  assert.equal('border' in pill, false, 'attention pill must not be outlined');
});
