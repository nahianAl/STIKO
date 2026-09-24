import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authProvider } from '../../lib/authProvider.ts';

test('unset means NextAuth — the rollback path is the default', () => {
  assert.equal(authProvider({}), 'nextauth');
  assert.equal(authProvider({ AUTH_PROVIDER: '' }), 'nextauth');
});

test('only the exact word workos turns WorkOS on', () => {
  assert.equal(authProvider({ AUTH_PROVIDER: 'workos' }), 'workos');
  assert.equal(authProvider({ AUTH_PROVIDER: ' WorkOS ' }), 'workos');
});

// A typo must fail safe to the path that has worked for months, not to a
// half-configured one.
test('anything else falls back to NextAuth', () => {
  for (const v of ['nextauth', 'work-os', 'true', 'workos2']) {
    assert.equal(authProvider({ AUTH_PROVIDER: v }), 'nextauth', v);
  }
});
