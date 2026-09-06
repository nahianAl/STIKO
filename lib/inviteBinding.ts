/**
 * Who may redeem an invitation token.
 *
 * An addressed invitation used to be a bearer token: POST /api/invite/[token]
 * checked expiry, revocation and single use, but never compared the invitation's
 * address to the person redeeming it. A forwarded link therefore admitted
 * whoever opened it first, with the invited role.
 *
 * Kept out of the route so it can be tested — this project's runner cannot
 * exercise a Next.js route handler.
 */

export type InviteRedemption = { ok: true } | { ok: false; reason: 'wrong_account' };

export function canRedeemInvite(opts: {
  inviteEmail: string | null;
  multiUse: boolean;
  signedInEmail: string;
}): InviteRedemption {
  // A share link is walked by many people by design and carries no address; it
  // ends by expiring or being revoked. Binding it to one identity would delete
  // the feature. Rows predating addressed invitations have no email either, and
  // refusing those would lock people out of packages they were really invited to.
  if (opts.multiUse || !opts.inviteEmail) return { ok: true };

  // Case-insensitive deliberately. Login matches email exactly while
  // forgot-password matches lower(email), so `Dana@Co.com` and `dana@co.com` can
  // both exist in the wild. A case-sensitive check here would refuse the actual
  // recipient.
  const invited = opts.inviteEmail.trim().toLowerCase();
  const signedIn = opts.signedInEmail.trim().toLowerCase();

  return invited === signedIn ? { ok: true } : { ok: false, reason: 'wrong_account' };
}
