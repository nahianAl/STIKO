/**
 * Turning a WorkOS identity into a local users.id.
 *
 * The local row is the identity of record — roughly twenty tables carry a
 * foreign key to users.id — so WorkOS never replaces it, only maps onto it.
 * This module holds the mapping rule and nothing else: the database lookups are
 * the caller's job, so this stays pure and testable. It is used by both
 * scripts/importUsersToWorkos.mjs and the sign-in path, which is why it is one
 * module rather than the same rule written twice.
 */

export type IdentityResolution =
  /** Already linked. Nothing to write. */
  | { action: 'use'; userId: string }
  /** Same person, pre-existing local row, no WorkOS id yet. Backfill it. */
  | { action: 'link'; userId: string }
  /** Nobody holds this address. Create a local row. */
  | { action: 'create' }
  /** This address belongs to a different WorkOS identity. Refuse. */
  | { action: 'conflict'; userId: string; existingWorkosUserId: string };

export function resolveLocalUser(lookups: {
  byWorkosId: { id: string } | null;
  byEmail: { id: string; workosUserId: string | null } | null;
}): IdentityResolution {
  // The WorkOS id is the durable link; email is not. Someone who changes their
  // address in WorkOS must stay attached to the same local row, so this match
  // deliberately wins over the email match below.
  if (lookups.byWorkosId) {
    return { action: 'use', userId: lookups.byWorkosId.id };
  }

  if (!lookups.byEmail) {
    return { action: 'create' };
  }

  // Already spoken for by a different WorkOS identity. Re-pointing the row here
  // would transfer that person's packages, comments and verdicts to whoever
  // just signed in. Surface it instead; it means something is wrong upstream.
  if (lookups.byEmail.workosUserId) {
    return {
      action: 'conflict',
      userId: lookups.byEmail.id,
      existingWorkosUserId: lookups.byEmail.workosUserId,
    };
  }

  return { action: 'link', userId: lookups.byEmail.id };
}
