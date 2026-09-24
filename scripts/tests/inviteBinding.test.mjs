import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRedeemInvite, inviteVouchesForEmail } from '../../lib/inviteBinding.ts';

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

const NOW = new Date('2026-09-24T12:00:00Z');
const addressed = (over = {}) => ({
  email: 'Dana@Co.com', multiUse: false,
  expiresAt: '2026-10-01T00:00:00Z', revokedAt: null, ...over,
});

// Arriving through a link emailed to an address proves you read that inbox,
// so asking for a second emailed code would be friction with nothing bought.
test('an addressed invitation vouches for its own address', () => {
  assert.equal(inviteVouchesForEmail({ invite: addressed(), email: ' dana@co.com', now: NOW }), true);
});

// A share link is posted in chats and forwarded; holding it proves nothing
// about any inbox.
test('a share link vouches for nobody', () => {
  assert.equal(inviteVouchesForEmail({ invite: addressed({ multiUse: true }), email: 'dana@co.com', now: NOW }), false);
  assert.equal(inviteVouchesForEmail({ invite: addressed({ email: null }), email: 'dana@co.com', now: NOW }), false);
});

test('a different address is not vouched for', () => {
  assert.equal(inviteVouchesForEmail({ invite: addressed(), email: 'someone@else.com', now: NOW }), false);
});

test('a dead invitation vouches for nobody', () => {
  assert.equal(inviteVouchesForEmail({ invite: addressed({ expiresAt: '2026-09-01T00:00:00Z' }), email: 'dana@co.com', now: NOW }), false);
  assert.equal(inviteVouchesForEmail({ invite: addressed({ revokedAt: '2026-09-20T00:00:00Z' }), email: 'dana@co.com', now: NOW }), false);
  assert.equal(inviteVouchesForEmail({ invite: null, email: 'dana@co.com', now: NOW }), false);
});
