import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newVersionEmail } from '../../lib/email.ts';

const BASE = {
  publisherName: 'Dana',
  packageName: 'Level 3 Framing',
  versionNumber: 4,
  link: 'https://stiko.example/portal/abc',
};

test('a note is quoted under a "What changed" heading', () => {
  const mail = newVersionEmail({ ...BASE, changelog: 'Shear tabs added at grid line 4' });

  assert.match(mail.body, /\n\nWhat changed:/);
  assert.match(mail.body, /"Shear tabs added at grid line 4"/);
  assert.match(mail.body, /Review it here: https:\/\/stiko\.example\/portal\/abc/);
});

test('no note means no heading and no stray empty quotes', () => {
  // The note became optional on 2026-08-14. Before that this function
  // interpolated unconditionally, so a missing note emailed a bare "".
  for (const changelog of [null, undefined, '', '   ']) {
    const mail = newVersionEmail({ ...BASE, changelog });

    assert.doesNotMatch(mail.body, /What changed/, `changelog=${JSON.stringify(changelog)}`);
    assert.doesNotMatch(mail.body, /""/, `changelog=${JSON.stringify(changelog)}`);
    assert.match(mail.body, /Dana published version 4 of Level 3 Framing\./);
    assert.match(mail.body, /Review it here: https:\/\/stiko\.example\/portal\/abc/);
  }
});

test('the subject line is the same with or without a note', () => {
  const withNote = newVersionEmail({ ...BASE, changelog: 'Anything' });
  const without = newVersionEmail({ ...BASE, changelog: null });

  assert.equal(withNote.subject, without.subject);
  assert.equal(
    withNote.subject,
    'Version 4 of Level 3 Framing is ready to review'
  );
});

test('a note is trimmed before it is quoted', () => {
  const mail = newVersionEmail({ ...BASE, changelog: '  Trimmed  ' });
  assert.match(mail.body, /"Trimmed"/);
});

test('the body keeps a blank line before the review link either way', () => {
  // Readability of the plain-text mail: without the blank line the link runs
  // straight onto the sentence above it.
  const withNote = newVersionEmail({ ...BASE, changelog: 'Anything' });
  const without = newVersionEmail({ ...BASE, changelog: null });

  assert.match(withNote.body, /\n\nReview it here:/);
  assert.match(without.body, /\n\nReview it here:/);
});
