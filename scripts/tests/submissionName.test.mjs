import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBMISSION_NAME_MAX,
  submissionTitle,
  submissionBadge,
  normalizeSubmissionName,
} from '../../lib/submissionName.ts';

// --- Titles ----------------------------------------------------------------

test('an unnamed submission is called by its number', () => {
  assert.equal(submissionTitle({ name: null, versionNumber: 5 }), 'Submission 5');
});

test('a missing name reads the same as a null one', () => {
  // Not every payload carries a name — the /api/home package cards and the
  // invite page don't.
  assert.equal(submissionTitle({ versionNumber: 2 }), 'Submission 2');
});

test('a named submission shows its name', () => {
  assert.equal(
    submissionTitle({ name: 'Revised per structural notes', versionNumber: 5 }),
    'Revised per structural notes'
  );
});

test('a whitespace-only stored name falls back to the default', () => {
  assert.equal(submissionTitle({ name: '   ', versionNumber: 3 }), 'Submission 3');
});

test('the badge is S and the number', () => {
  assert.equal(submissionBadge(5), 'S5');
  assert.equal(submissionBadge(12), 'S12');
});

// --- What the rename endpoint stores ---------------------------------------

test('null clears the name', () => {
  assert.deepEqual(normalizeSubmissionName(null), { ok: true, name: null });
});

test('blank and whitespace-only clear the name rather than storing ""', () => {
  assert.deepEqual(normalizeSubmissionName(''), { ok: true, name: null });
  assert.deepEqual(normalizeSubmissionName('   \n\t '), { ok: true, name: null });
});

test('a name is trimmed', () => {
  assert.deepEqual(normalizeSubmissionName('  Revised  '), { ok: true, name: 'Revised' });
});

test('inner whitespace, newlines included, collapses to one space', () => {
  assert.deepEqual(
    normalizeSubmissionName('Revised\n per   notes'),
    { ok: true, name: 'Revised per notes' }
  );
});

test('exactly the maximum length is accepted', () => {
  const name = 'x'.repeat(SUBMISSION_NAME_MAX);
  assert.deepEqual(normalizeSubmissionName(name), { ok: true, name });
});

test('one over the maximum is rejected', () => {
  const r = normalizeSubmissionName('x'.repeat(SUBMISSION_NAME_MAX + 1));
  assert.equal(r.ok, false);
  assert.match(r.error, /80/);
});

test('the limit is measured after trimming', () => {
  const name = 'x'.repeat(SUBMISSION_NAME_MAX);
  assert.deepEqual(normalizeSubmissionName(`   ${name}   `), { ok: true, name });
});

test('anything that is not text or null is rejected', () => {
  for (const bad of [undefined, 42, {}, [], true]) {
    assert.equal(normalizeSubmissionName(bad).ok, false, JSON.stringify(bad));
  }
});
