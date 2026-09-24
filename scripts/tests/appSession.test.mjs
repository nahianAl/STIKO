import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAppSession } from '../../lib/appSession.ts';

test('a user with an id becomes a session', () => {
  assert.deepEqual(toAppSession({ id: 'u1', name: 'Dana Whitfield', email: 'dana@co.com' }), {
    user: { id: 'u1', name: 'Dana Whitfield', email: 'dana@co.com' },
  });
});

test('missing name and email are normalised, not undefined', () => {
  assert.deepEqual(toAppSession({ id: 'u1' }), { user: { id: 'u1', name: null, email: '' } });
});

// Every caller checks session?.user?.id. A session without one must read as
// signed out, never as a signed-in nobody.
test('no id means no session', () => {
  assert.equal(toAppSession({ name: 'x', email: 'x@y.z' }), null);
  assert.equal(toAppSession(null), null);
  assert.equal(toAppSession(undefined), null);
});
