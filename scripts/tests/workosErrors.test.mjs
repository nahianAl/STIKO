import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWorkosError, publicFailure, failureStatus } from '../../lib/workosErrors.ts';

// Stand-ins shaped like @workos-inc/node 10.14 exceptions: the classifier reads
// fields, not classes, so these are all it needs.
function sdkError(fields) {
  return Object.assign(new Error(fields.message ?? 'WorkOS error'), fields);
}

test('a wrong password', () => {
  assert.deepEqual(
    classifyWorkosError(sdkError({ name: 'GenericServerException', status: 400, code: 'invalid_credentials' })),
    { ok: false, error: 'invalid_credentials' }
  );
});

test('an unverified address carries what the code step needs', () => {
  const failure = classifyWorkosError(
    sdkError({
      name: 'AuthenticationException',
      code: 'email_verification_required',
      rawData: {
        pending_authentication_token: 'pat_123',
        email: 'Dana@Co.com',
        email_verification_id: 'email_verification_9',
      },
    })
  );
  assert.deepEqual(failure, {
    ok: false,
    error: 'email_verification_required',
    email: 'dana@co.com',
    pendingAuthenticationToken: 'pat_123',
    emailVerificationId: 'email_verification_9',
  });
});

// Without the pending token there is no way to finish the sign-in, so saying
// "check your email" would strand the person on a form that cannot work.
test('an unverified address without a pending token is unknown, not a code step', () => {
  assert.deepEqual(
    classifyWorkosError(sdkError({ code: 'email_verification_required', rawData: { email: 'a@b.c' } })),
    { ok: false, error: 'unknown' }
  );
});

test('steps Stiko has no screen for are unsupported', () => {
  for (const code of [
    'mfa_enrollment', 'mfa_challenge', 'mfa_verification', 'radar_email_challenge',
    'radar_sms_challenge', 'sso_required', 'organization_selection_required',
  ]) {
    assert.deepEqual(classifyWorkosError(sdkError({ code })), { ok: false, error: 'unsupported' }, code);
  }
});

test('rate limits carry the wait when WorkOS gives one', () => {
  assert.deepEqual(
    classifyWorkosError(sdkError({ name: 'RateLimitExceededException', status: 429, retryAfter: 30 })),
    { ok: false, error: 'rate_limited', retryAfterSeconds: 30 }
  );
  assert.deepEqual(classifyWorkosError(sdkError({ status: 429 })), {
    ok: false, error: 'rate_limited', retryAfterSeconds: null,
  });
});

test('a duplicate address on createUser', () => {
  assert.deepEqual(
    classifyWorkosError(
      sdkError({ name: 'BadRequestException', code: 'user_creation_error', errors: [{ code: 'email_not_available' }] })
    ),
    { ok: false, error: 'email_taken' }
  );
});

test('a rejected password keeps WorkOS’s explanation', () => {
  assert.deepEqual(
    classifyWorkosError(
      sdkError({ code: 'password_strength_error', message: 'Password is too weak.' })
    ),
    { ok: false, error: 'password_rejected', message: 'Password is too weak.' }
  );
  assert.deepEqual(
    classifyWorkosError(
      sdkError({
        code: 'user_creation_error',
        message: 'Could not create user.',
        errors: [{ code: 'password_too_weak', message: 'Password has appeared in a data breach.' }],
      })
    ),
    { ok: false, error: 'password_rejected', message: 'Password has appeared in a data breach.' }
  );
});

test('anything unrecognised is unknown', () => {
  for (const err of [null, undefined, 'boom', new Error('network down'), sdkError({ code: 'something_new' })]) {
    assert.deepEqual(classifyWorkosError(err), { ok: false, error: 'unknown' });
  }
});

// The pending token authorises finishing someone's sign-in. It goes in an
// httpOnly cookie, never into a JSON body that page scripts can read.
test('the public form drops the pending token and verification id', () => {
  const pub = publicFailure({
    ok: false,
    error: 'email_verification_required',
    email: 'dana@co.com',
    pendingAuthenticationToken: 'pat_123',
    emailVerificationId: 'email_verification_9',
  });
  assert.deepEqual(pub, { ok: false, error: 'email_verification_required', email: 'dana@co.com' });
});

test('status codes', () => {
  const s = (error) => failureStatus({ ok: false, error });
  assert.equal(s('invalid_credentials'), 401);
  assert.equal(s('email_verification_required'), 403);
  assert.equal(s('unsupported'), 403);
  assert.equal(s('email_taken'), 409);
  assert.equal(s('account_conflict'), 409);
  assert.equal(s('password_rejected'), 400);
  assert.equal(s('invalid_code'), 400);
  assert.equal(s('verification_expired'), 400);
  assert.equal(s('invalid_request'), 400);
  assert.equal(s('rate_limited'), 429);
  assert.equal(s('unknown'), 502);
});
