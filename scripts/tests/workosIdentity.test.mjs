import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocalUser } from '../../lib/workosIdentity.ts';

test('an already-linked account is used as-is', () => {
  const result = resolveLocalUser({
    byWorkosId: { id: 'user_local_1' },
    byEmail: { id: 'user_local_1', workosUserId: 'workos_1' },
  });

  assert.deepEqual(result, { action: 'use', userId: 'user_local_1' });
});

// The link case: someone registered with a password before the migration and
// now signs in with Google. Same person, same address, no workos_user_id yet.
// Creating a second row here would strand every comment, verdict and package
// membership on the old one.
test('an unlinked account matching by email is linked, not duplicated', () => {
  const result = resolveLocalUser({
    byWorkosId: null,
    byEmail: { id: 'user_local_2', workosUserId: null },
  });

  assert.deepEqual(result, { action: 'link', userId: 'user_local_2' });
});

test('an address nobody holds yet creates a new local user', () => {
  const result = resolveLocalUser({ byWorkosId: null, byEmail: null });

  assert.deepEqual(result, { action: 'create' });
});

// Never silently take over an account. If this address is already linked to a
// different WorkOS identity, something is wrong upstream — two WorkOS users for
// one address — and quietly re-pointing the row would hand one person's
// packages, comments and verdicts to another.
test('an email already linked to a different WorkOS id is a conflict, not a takeover', () => {
  const result = resolveLocalUser({
    byWorkosId: null,
    byEmail: { id: 'user_local_3', workosUserId: 'workos_someone_else' },
  });

  assert.deepEqual(result, {
    action: 'conflict',
    userId: 'user_local_3',
    existingWorkosUserId: 'workos_someone_else',
  });
});

// The workos_user_id match wins over the email match. An address change in
// WorkOS must follow the person, not orphan them onto a new row.
test('a match by WorkOS id wins when the email now points elsewhere', () => {
  const result = resolveLocalUser({
    byWorkosId: { id: 'user_local_4' },
    byEmail: { id: 'user_local_5', workosUserId: null },
  });

  assert.deepEqual(result, { action: 'use', userId: 'user_local_4' });
});

test('a match by WorkOS id wins even when no row matches the email', () => {
  const result = resolveLocalUser({
    byWorkosId: { id: 'user_local_6' },
    byEmail: null,
  });

  assert.deepEqual(result, { action: 'use', userId: 'user_local_6' });
});
