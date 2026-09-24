-- Link a local users row to its WorkOS identity.
--
-- The local row stays the identity of record: roughly twenty tables carry a
-- foreign key to users.id, including participants, comments, verdicts,
-- notifications and part_colors. WorkOS becomes the authenticator only, mapped
-- on through this column, so lib/access.ts and every route handler are
-- untouched by the migration.
--
-- Nullable and non-unique-when-null on purpose: rows are backfilled by
-- scripts/importUsersToWorkos.mjs, and a user created locally but not yet
-- pushed to WorkOS is a valid intermediate state during that import.
ALTER TABLE users ADD COLUMN IF NOT EXISTS workos_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_workos_user_id_key
  ON users (workos_user_id) WHERE workos_user_id IS NOT NULL;

-- One account per address, regardless of case.
--
-- users.email is already UNIQUE, but Postgres compares it case-sensitively, so
-- Dana@co.com and dana@co.com were two separate accounts. That was a hygiene
-- problem until invitation redemption began comparing addresses
-- case-insensitively (lib/inviteBinding.ts), at which point it became an
-- authorization bypass: registering a case variant of an invited address
-- redeemed someone else's invitation.
--
-- app/api/auth/signup/route.ts was patched to match lower(email), but
-- lib/auth.ts still signs in on an exact match. This index is what makes it
-- safe to fix that, so it must land BEFORE any further case-insensitive
-- matching, not after.
--
-- If this fails to build, the database already holds addresses differing only
-- by case. That is a data problem to resolve deliberately rather than paper
-- over: merge the accounts first.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
  ON users (lower(email));
