import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newVersionEmail, emailFrom, verificationCodeEmail } from '../../lib/email.ts';

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
    assert.match(mail.body, /Dana published submission 4 of Level 3 Framing\./);
    assert.match(mail.body, /Review it here: https:\/\/stiko\.example\/portal\/abc/);
  }
});

test('the subject line is the same with or without a note', () => {
  const withNote = newVersionEmail({ ...BASE, changelog: 'Anything' });
  const without = newVersionEmail({ ...BASE, changelog: null });

  assert.equal(withNote.subject, without.subject);
  assert.equal(
    withNote.subject,
    'Submission 4 of Level 3 Framing is ready to review'
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

// EMAIL_FROM used to default to 'Stiko <noreply@stiko.app>'. stiko.app is not a
// domain Stiko owns and does not resolve, so that default silently broke every
// email in the product whenever the variable went missing — and password resets
// discard the delivery result, so nobody found out.
test('emailFrom refuses to invent a sender', () => {
  const saved = process.env.EMAIL_FROM;
  try {
    for (const value of [undefined, '', '   ']) {
      if (value === undefined) delete process.env.EMAIL_FROM;
      else process.env.EMAIL_FROM = value;

      assert.throws(() => emailFrom(), /EMAIL_FROM must be configured/, `value=${JSON.stringify(value)}`);
    }
  } finally {
    if (saved === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = saved;
  }
});

test('emailFrom returns the configured sender, trimmed', () => {
  const saved = process.env.EMAIL_FROM;
  try {
    process.env.EMAIL_FROM = '  Stiko <noreply@stiko.design>  ';
    assert.equal(emailFrom(), 'Stiko <noreply@stiko.design>');
  } finally {
    if (saved === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = saved;
  }
});

test('sendEmail reports undelivered rather than throwing when the sender is missing', async () => {
  // sendEmail's callers rely on an EmailResult, never a thrown error:
  // app/api/participants/route.ts surfaces result.delivered to the invite UI.
  // Making emailFrom throw must not turn that into a 500.
  const savedFrom = process.env.EMAIL_FROM;
  const savedKey = process.env.RESEND_API_KEY;
  try {
    delete process.env.EMAIL_FROM;
    process.env.RESEND_API_KEY = 'test-key-never-used';

    const { sendEmail } = await import('../../lib/email.ts');
    const result = await sendEmail({ to: 'a@b.com', subject: 's', body: 'b' });

    assert.equal(result.delivered, false);
    assert.match(result.reason, /sender/i);
  } finally {
    if (savedFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = savedFrom;
    if (savedKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedKey;
  }
});

test('the verification email carries the code and says what it is for', () => {
  const mail = verificationCodeEmail({ code: '482913' });
  assert.equal(mail.subject, 'Your Stiko sign-in code');
  assert.match(mail.body, /482913/);
  assert.match(mail.body, /ignore/);
});
