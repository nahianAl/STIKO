import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authErrorMessage } from '../../lib/authMessages.ts';

test('a wrong password keeps the existing wording', () => {
  assert.equal(authErrorMessage({ ok: false, error: 'invalid_credentials' }), 'Invalid email or password');
});

test('a taken address keeps the existing wording', () => {
  assert.equal(authErrorMessage({ ok: false, error: 'email_taken' }), 'Email already in use');
});

// WorkOS explains which rule a password broke; that explanation is the useful
// part and must reach the person choosing the password.
test('a rejected password shows the reason when there is one', () => {
  assert.equal(
    authErrorMessage({ ok: false, error: 'password_rejected', message: 'Password is too common.' }),
    'Password is too common.'
  );
  assert.match(authErrorMessage({ ok: false, error: 'password_rejected' }), /stronger password/);
});

test('every code has a sentence, never an empty string or a raw code', () => {
  for (const error of [
    'invalid_credentials', 'email_verification_required', 'email_taken', 'account_conflict',
    'password_rejected', 'invalid_code', 'verification_expired', 'rate_limited',
    'unsupported', 'invalid_request', 'unknown',
  ]) {
    const text = authErrorMessage({ ok: false, error });
    assert.ok(text.length > 10, error);
    assert.doesNotMatch(text, /_/, error);
  }
});
