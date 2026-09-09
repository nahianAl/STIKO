import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageForStatus } from '../../lib/submitErrors.ts';

test('an expired session is named as one, because it is the common case', () => {
  // /api/comments is in PUBLIC_PATHS, so an expired session is NOT redirected to
  // login — it returns a JSON 401. Telling the user to sign in again is the only
  // message that leads to a fix.
  const m = messageForStatus(401);
  assert.match(m, /sign in|signed out|session/i);
});

test('a permissions refusal does not tell the user to sign in again', () => {
  const m = messageForStatus(403);
  assert.doesNotMatch(m, /sign in again/i);
  assert.match(m, /permission|allowed|access/i);
});

test('every message is non-empty and free of jargon', () => {
  for (const status of [400, 401, 403, 404, 409, 413, 429, 500, 502, 503, 0]) {
    const m = messageForStatus(status);
    assert.ok(m.length > 0, `${status} produced an empty message`);
    assert.doesNotMatch(m, /undefined|NaN|\[object/i, `${status} leaked a raw value`);
  }
});

test('distinct causes get distinct messages, or the message is useless', () => {
  const seen = [401, 403, 404, 429, 500].map(messageForStatus);
  assert.equal(new Set(seen).size, seen.length, 'two causes share one message');
});

test('an unknown status still yields something actionable', () => {
  const m = messageForStatus(418);
  assert.ok(m.length > 0);
});
