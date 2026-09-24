import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodePendingAuth, decodePendingAuth, pendingAuthCookieOptions,
} from '../../lib/pendingAuth.ts';

test('round trip', () => {
  const p = { token: 'pat_1', emailVerificationId: 'ev_1', email: 'dana@co.com' };
  assert.deepEqual(decodePendingAuth(encodePendingAuth(p)), p);
});

test('a missing verification id survives as null', () => {
  const p = { token: 'pat_1', emailVerificationId: null, email: 'dana@co.com' };
  assert.deepEqual(decodePendingAuth(encodePendingAuth(p)), p);
});

// The cookie is the visitor's to edit. Garbage must read as "no pending
// sign-in", never throw and 500 the code form.
test('anything malformed is null', () => {
  for (const raw of [undefined, '', 'not-base64-json', Buffer.from('{"email":"x"}').toString('base64url'),
    Buffer.from('[1,2]').toString('base64url'), Buffer.from('{"token":5,"email":"x"}').toString('base64url')]) {
    assert.equal(decodePendingAuth(raw), null, String(raw));
  }
});

test('the cookie is httpOnly, short-lived and scoped to the WorkOS routes', () => {
  assert.deepEqual(pendingAuthCookieOptions(true), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth/workos', maxAge: 600,
  });
  assert.equal(pendingAuthCookieOptions(false).secure, false);
});
