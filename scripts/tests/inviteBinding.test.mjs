import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRedeemInvite } from '../../lib/inviteBinding.ts';

test('the addressed recipient can redeem their own invitation', () => {
  const result = canRedeemInvite({
    inviteEmail: 'dana@consultant.com',
    multiUse: false,
    signedInEmail: 'dana@consultant.com',
  });

  assert.deepEqual(result, { ok: true });
});

// The gap this closes: an addressed invitation was a bearer token, so a forwarded
// link let whoever opened it first join the package as the invited role.
test('someone else holding the link cannot redeem an addressed invitation', () => {
  const result = canRedeemInvite({
    inviteEmail: 'dana@consultant.com',
    multiUse: false,
    signedInEmail: 'marcus@builder.com',
  });

  assert.deepEqual(result, { ok: false, reason: 'wrong_account' });
});

// Login matches email exactly while forgot-password matches lower(email). A
// case-sensitive check here would inherit that bug and lock out the very person
// the invitation was addressed to.
test('the address comparison ignores case and surrounding space', () => {
  for (const [inviteEmail, signedInEmail] of [
    ['Dana@Consultant.com', 'dana@consultant.com'],
    ['dana@consultant.com', 'DANA@CONSULTANT.COM'],
    ['  dana@consultant.com  ', 'dana@consultant.com'],
  ]) {
    assert.deepEqual(
      canRedeemInvite({ inviteEmail, multiUse: false, signedInEmail }),
      { ok: true },
      `${inviteEmail} vs ${signedInEmail}`
    );
  }
});

// Share links are exempt by design — they carry no address, are handed around
// deliberately, and are bounded by expiry and revocation instead. Binding them
// would remove the feature.
test('a share link is redeemable by anyone signed in', () => {
  for (const inviteEmail of [null, 'ignored@example.com']) {
    assert.deepEqual(
      canRedeemInvite({ inviteEmail, multiUse: true, signedInEmail: 'anyone@anywhere.com' }),
      { ok: true },
      `inviteEmail=${inviteEmail}`
    );
  }
});

test('an addressed invitation with no recorded address stays redeemable', () => {
  // Older rows predate addressed invitations. Refusing them would lock existing
  // users out of packages they were legitimately invited to.
  assert.deepEqual(
    canRedeemInvite({ inviteEmail: null, multiUse: false, signedInEmail: 'dana@consultant.com' }),
    { ok: true }
  );
});
