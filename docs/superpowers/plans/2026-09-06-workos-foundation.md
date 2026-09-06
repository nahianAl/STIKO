# WorkOS Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the schema, the identity-resolution policy, and every existing account into WorkOS — with no user-visible change and nothing in the sign-in path touched.

**Architecture:** Phases 0–2 of `docs/superpowers/specs/2026-09-05-workos-auth-migration-design.md`. The local `users` row stays the identity of record; a new `workos_user_id` column links it to WorkOS. Existing accounts are imported with their bcrypt hashes so nobody is forced to reset a password. NextAuth remains the only live authenticator throughout this plan.

**Tech Stack:** Next.js 14 App Router, TypeScript, Neon Postgres, `@workos-inc/node`, Node's built-in test runner.

**This plan deliberately stops before the cutover.** Everything here is additive and reversible. The sign-in path, middleware, pages and invite flow are Plan 2 — see *What Plan 2 covers* at the end.

## Global Constraints

- **Test runner:** `npm test` runs `node --test scripts/tests/*.mjs`. Tests are `.mjs`, import `.ts` modules directly, and use `node:test` + `node:assert/strict`.
- **No DOM or React testing library exists and none may be added.** Route handlers, scripts with I/O, and components are not unit-tested; policy is extracted into pure `lib/` modules that are.
- **Test files mirror the module name:** `lib/foo.ts` → `scripts/tests/foo.test.mjs`.
- **Comment style:** explain *why* a guard exists and what bug it prevents.
- **Migrations run through `npm run migrate`**, which applies `lib/schema.sql` then every `lib/migrations/*.sql` in name order, recording each in `schema_migrations`. The runner strips `--` comments and splits on `;`, so **no statement may contain a semicolon inside a string literal**.
- **Migrations are applied manually and have been forgotten twice on this project.** Check `schema_migrations` before and after.
- **Do not touch `lib/auth.ts`, `middleware.ts`, or any route handler in this plan.** NextAuth stays live and untouched. Wiring is Plan 2.
- **Never read, write or source `.env.local` from a shell.** Scripts that need `DATABASE_URL` take it from `process.env`, exactly as `scripts/migrate.mjs` does.
- The verified sending domain is `stiko.design`. `stiko.app` does not resolve — never use it anywhere.

---

## Part 0 — Prerequisites you execute yourself

These are not implementer tasks. They are infrastructure and account setup, and **the code tasks below do not depend on them** except where noted, so they can proceed in parallel.

### P1 — Move the app to `app.stiko.design`

Confirmed decision: apex and `www` to Wix, app to Vercel, DNS zone stays at Namecheap.

1. Vercel → Stiko project → Settings → Domains → add `app.stiko.design`. Vercel gives you a CNAME target.
2. Namecheap → Advanced DNS → add `CNAME  app  →  <the target Vercel gave you>`.
3. Wait for `app.stiko.design` to serve the app, then in Vercel set `NEXTAUTH_URL=https://app.stiko.design` for Production and redeploy. Outbound email links come from this and nothing else (`lib/appUrl.ts`).
4. Only then point apex and `www` at Wix, using the A/CNAME records Wix gives you. **Decline Wix's offer to take over the nameservers** — keeping the zone at Namecheap is what keeps `app.` and your `MX` records out of a website builder's dashboard.
5. Ask your growth lead to add 301 redirects on the Wix side for `/invite/*`, `/portal/*` and `/reset-password/*` → the same path on `app.stiko.design`, and to keep them for about a month. Invitations expire in 14 days and reset tokens in 1 hour, so the exposure is self-limiting.

**Rollback:** point the apex back at Vercel. It is a DNS change.

### P2 — Create the WorkOS environment

1. Sign up at workos.com and create a Production environment for Stiko.
2. **Redirect URI:** `https://app.stiko.design/auth/callback`. Add `http://localhost:3000/auth/callback` for local development. This must be set against the final hostname, which is why P1 comes first.
3. **Enable Google OAuth** in the AuthKit provider list.
4. **Password policy:** leave WorkOS's default on. This is what closes audit finding 2 — signup currently validates nothing server-side.
5. **MFA:** enable, but leave it optional for users. Reversible toggle; no reason to add friction during a rollout.
6. Copy the **API key** (`sk_...`) and **Client ID** (`client_...`).

### P3 — Environment variables

Add to Vercel Production, and to your local `.env.local`:

```
WORKOS_API_KEY=sk_...
WORKOS_CLIENT_ID=client_...
WORKOS_COOKIE_PASSWORD=<32+ random characters>
NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://app.stiko.design/auth/callback
AUTH_PROVIDER=nextauth
```

Generate the cookie password with `openssl rand -base64 32`.

`AUTH_PROVIDER` is the cutover switch introduced in Plan 2. Set it to `nextauth` **now** so that when Plan 2 ships, behaviour does not change until you deliberately flip it.

While you are in Vercel: **re-add `EMAIL_FROM` as a plain variable rather than a Secret**, value `Stiko <noreply@stiko.design>`. It is the `From:` header on every email you send — the least secret value in the config — and storing it as a secret means you cannot verify it.

---

### Task 1: Schema — link column and the casing index

Adds `workos_user_id` and the `lower(email)` unique index. The index is what permanently closes audit finding 3, and it is now a **deploy-ordering dependency**: `lib/auth.ts` still matches email case-sensitively at sign-in, while `lib/inviteBinding.ts` compares case-insensitively. Until the index exists, any further case-insensitive matching risks a query that matches two rows.

Production was checked on 2026-09-05: 8 users, zero case-duplicate addresses, so this index builds cleanly. Re-check before applying — see Step 3.

**Files:**
- Create: `lib/migrations/010-workos-auth.sql`
- Modify: `lib/schema.sql` (so a fresh database gets the same shape)

**Interfaces:**
- Consumes: nothing.
- Produces: `users.workos_user_id TEXT`, unique where not null; a unique index on `lower(email)`.

- [ ] **Step 1: Write the migration**

Create `lib/migrations/010-workos-auth.sql`:

```sql
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
```

- [ ] **Step 2: Mirror it in the base schema**

In `lib/schema.sql`, in the `users` table definition, add the column after `password_hash`:

```sql
  password_hash TEXT,
  workos_user_id TEXT,
```

Then, immediately after the closing `);` of the `users` table, add:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS users_workos_user_id_key
  ON users (workos_user_id) WHERE workos_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
  ON users (lower(email));
```

A fresh database must end up identical to a migrated one, or local development diverges from production in exactly the way that hides bugs.

- [ ] **Step 3: Confirm the index can build, before applying anything**

Run this against production first. It is read-only:

```bash
npm run migrate -- --dry
```

**Note what `--dry` does and does not tell you.** It skips the `schema_migrations` lookup, so it prints *every* migration as "would run", not just the outstanding ones. To see what is actually pending, query directly:

```sql
SELECT name FROM schema_migrations ORDER BY name;
```

Verified 2026-09-06: `001` through `009` are applied, `010` is the only outstanding one, and `users.workos_user_id` does not yet exist.

Then check for case duplicates — if this returns any rows, **stop** and merge those accounts before continuing:

```sql
SELECT lower(email) AS addr, count(*), array_agg(email) AS variants
FROM users GROUP BY 1 HAVING count(*) > 1;
```

- [ ] **Step 4: Apply**

```bash
npm run migrate
```

Expected: `lib/migrations/010-workos-auth.sql — 3 statement(s)` followed by three ✓ lines. (One `ALTER TABLE`, two `CREATE UNIQUE INDEX` — the runner splits on `;` after stripping `--` comments.)

- [ ] **Step 5: Verify it landed**

```sql
SELECT name, applied_at FROM schema_migrations ORDER BY name;
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'users' AND column_name = 'workos_user_id';
SELECT indexname FROM pg_indexes WHERE tablename = 'users';
```

Expected: `010-workos-auth.sql` present, the column present, and both `users_workos_user_id_key` and `users_email_lower_key` listed.

- [ ] **Step 6: Commit**

```bash
git add lib/migrations/010-workos-auth.sql lib/schema.sql
git commit -m "feat: add workos_user_id and a lower(email) unique index"
```

Full commit message body:

```
The local users row stays the identity of record — ~20 tables FK to users.id —
so WorkOS maps on through a nullable workos_user_id rather than replacing it.

The lower(email) unique index is the ordering dependency: signup was patched to
match lower(email) and invitation redemption compares addresses
case-insensitively, but lib/auth.ts still signs in on an exact match. The index
must exist before that is changed, or a case-insensitive lookup could match two
rows. Production had 8 users and zero case-duplicates when this was written.
```

**Rollback:** `DROP INDEX users_email_lower_key; DROP INDEX users_workos_user_id_key; ALTER TABLE users DROP COLUMN workos_user_id;` then delete the row from `schema_migrations`.

---

### Task 2: Identity resolution policy

The rule for turning a WorkOS identity into a local `users.id`. It is needed twice — by the import script in Task 3, and by the sign-in path in Plan 2 — so it lives in one pure, tested module rather than being written twice and drifting.

The interesting case is **linking**: someone who registered with a password and later signs in with Google arrives as a WorkOS user whose email matches an existing local row that has no `workos_user_id` yet. That row must be linked, not duplicated. The dangerous case is a local row already linked to a *different* WorkOS id — that must never be silently taken over.

**Files:**
- Create: `lib/workosIdentity.ts`
- Create: `scripts/tests/workosIdentity.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveLocalUser(lookups): IdentityResolution`, where `lookups` is `{ byWorkosId: { id: string } | null; byEmail: { id: string; workosUserId: string | null } | null }` and `IdentityResolution` is one of `{ action: 'use'; userId: string }`, `{ action: 'link'; userId: string }`, `{ action: 'create' }`, `{ action: 'conflict'; userId: string; existingWorkosUserId: string }`.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/workosIdentity.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="linked|conflict|WorkOS id|local user"`

Expected: FAIL — `Cannot find module '../../lib/workosIdentity.ts'`.

- [ ] **Step 3: Write the implementation**

Create `lib/workosIdentity.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`

Expected: PASS, all files.

- [ ] **Step 5: Commit**

```bash
git add lib/workosIdentity.ts scripts/tests/workosIdentity.test.mjs
git commit -m "feat: add the WorkOS-to-local identity resolution policy"
```

Full commit message body:

```
One pure module holding the rule for mapping a WorkOS identity onto a local
users row, because both the import script and the sign-in path need it and
writing it twice is how the two drift.

The link case is the point: someone who registered with a password and later
signs in with Google matches by email with no workos_user_id yet, and must be
linked rather than duplicated - a second row would strand their comments,
verdicts and package memberships on the first.

A row already linked to a different WorkOS id returns a conflict rather than
being re-pointed, since silently re-pointing hands one person's packages to
another.
```

---

### Task 3: Import existing users into WorkOS

An idempotent script that creates a WorkOS user for every local account, carrying the existing bcrypt hash across so **nobody is forced to reset a password**, and writing `workos_user_id` back.

WorkOS accepts `passwordHash` with `passwordHashType: 'bcrypt'` on `createUser`. Stiko hashes with bcrypt cost 12 (`lib/password.ts`), which is exactly what that expects.

**Files:**
- Create: `scripts/importUsersToWorkos.mjs`
- Modify: `package.json` (add the `import-users` script)

**Interfaces:**
- Consumes: `resolveLocalUser` from Task 2 is *not* used here — the import runs in the opposite direction (local → WorkOS) and its only question is "already linked?". Task 2's policy is for the sign-in direction in Plan 2.
- Produces: `npm run import-users` and `npm run import-users -- --dry`.

- [ ] **Step 1: Add the npm script**

In `package.json`, in `"scripts"`, after the `"migrate"` line:

```json
    "import-users": "node scripts/importUsersToWorkos.mjs",
```

- [ ] **Step 2: Install the WorkOS SDK**

```bash
npm install @workos-inc/node
```

- [ ] **Step 3: Write the script**

Create `scripts/importUsersToWorkos.mjs`:

```js
#!/usr/bin/env node
/**
 * Create a WorkOS user for every local account and record the link.
 *
 * Existing bcrypt hashes are carried across, so nobody is forced to reset a
 * password at cutover. Stiko hashes at bcrypt cost 12 (lib/password.ts), which
 * is what WorkOS's passwordHashType: 'bcrypt' expects.
 *
 * Safe to re-run: users already carrying a workos_user_id are skipped, and a
 * user WorkOS reports as already existing is adopted by email rather than
 * failing the run. That matters because this runs against production with no
 * staging environment to rehearse in.
 *
 * Written as a script rather than a migration because it talks to a third-party
 * API: it is rate-limited, partially resumable, and must be able to report what
 * it could not do. lib/migrations/*.sql is for DDL only.
 *
 * Usage:  npm run import-users -- --dry   list what would happen, touch nothing
 *         npm run import-users            do it
 */

import { neon } from '@neondatabase/serverless';
import { WorkOS } from '@workos-inc/node';

const dry = process.argv.includes('--dry');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    'DATABASE_URL is not set.\n' +
      'Load your env first, e.g.:  set -a && . .env.local && set +a && npm run import-users'
  );
  process.exit(1);
}

const apiKey = process.env.WORKOS_API_KEY;
if (!apiKey) {
  console.error('WORKOS_API_KEY is not set.');
  process.exit(1);
}

const sql = neon(connectionString);
const workos = new WorkOS(apiKey);

/** Split a stored name into the first/last pair WorkOS expects. */
function splitName(name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return { firstName: undefined, lastName: undefined };
  const parts = trimmed.split(/\s+/);
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
  };
}

async function main() {
  const users = await sql`
    SELECT id, name, email, password_hash, workos_user_id
    FROM users ORDER BY created_at
  `;

  const pending = users.filter((u) => !u.workos_user_id);

  console.log(`${users.length} local user(s), ${pending.length} not yet linked.`);
  if (dry) {
    for (const u of pending) {
      const how = u.password_hash ? 'with existing password' : 'WITHOUT a password';
      console.log(`  would create ${u.email.toLowerCase()} ${how}`);
    }
    console.log('\nDry run — nothing was changed.');
    return;
  }

  let created = 0;
  let adopted = 0;
  const failures = [];

  for (const u of pending) {
    // Lowercased on the way in. The lower(email) unique index added in
    // migration 010 makes this the canonical form locally, and it must match on
    // both sides or the sign-in lookup will miss.
    const email = u.email.toLowerCase();
    const { firstName, lastName } = splitName(u.name);

    try {
      const workosUser = await workos.userManagement.createUser({
        email,
        firstName,
        lastName,
        // These are existing users who have been using the product. Making them
        // re-verify an address they already receive invitations at would be
        // friction with nothing bought.
        emailVerified: true,
        ...(u.password_hash
          ? { passwordHash: u.password_hash, passwordHashType: 'bcrypt' }
          : {}),
      });

      await sql`UPDATE users SET workos_user_id = ${workosUser.id} WHERE id = ${u.id}`;
      created++;
      console.log(`  ✓ created ${email}`);
    } catch (err) {
      // A re-run after a partial failure, or an address someone already claimed
      // in WorkOS directly. Adopt it rather than failing the whole run: the
      // alternative is a half-imported database and no way to finish.
      //
      // listUsers returns an AutoPaginatable, which is async-iterable. Taking
      // the first item that way rather than reaching into a page wrapper keeps
      // this off an undocumented property of the SDK's list response.
      let existing = null;
      try {
        const page = await workos.userManagement.listUsers({ email, limit: 1 });
        for await (const candidate of page) {
          existing = candidate;
          break;
        }
      } catch {
        existing = null;
      }

      if (existing) {
        await sql`UPDATE users SET workos_user_id = ${existing.id} WHERE id = ${u.id}`;
        adopted++;
        console.log(`  ✓ adopted existing ${email}`);
      } else {
        failures.push({ email, message: err.message });
        console.log(`  ✗ ${email} — ${err.message}`);
      }
    }
  }

  console.log(`\ncreated ${created}, adopted ${adopted}, failed ${failures.length}`);

  if (failures.length) {
    console.error('\nFailures — re-run to retry only these:');
    for (const f of failures) console.error(`  ${f.email}: ${f.message}`);
    process.exit(1);
  }

  console.log('Done. Every local user is linked to a WorkOS user.');
}

main().catch((err) => {
  console.error(`\nImport failed: ${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 4: Dry run**

```bash
npm run import-users -- --dry
```

Expected: `8 local user(s), 8 not yet linked.` followed by one `would create` line each. Nothing is written.

- [ ] **Step 5: Run it**

```bash
npm run import-users
```

Expected: a ✓ per user and `created 8, adopted 0, failed 0`.

- [ ] **Step 6: Verify idempotency — run it a second time**

```bash
npm run import-users
```

Expected: `8 local user(s), 0 not yet linked.` and `created 0, adopted 0, failed 0`. If it tries to create anything on the second run, the write-back is broken; stop and report it.

- [ ] **Step 7: Verify the link in both directions**

```sql
SELECT count(*) AS unlinked FROM users WHERE workos_user_id IS NULL;
```

Expected: `0`. Then open the WorkOS dashboard → Users and confirm the same count with the same addresses, all lowercase.

- [ ] **Step 8: Commit**

```bash
git add scripts/importUsersToWorkos.mjs package.json package-lock.json
git commit -m "feat: import existing users into WorkOS with their password hashes"
```

Full commit message body:

```
Carries existing bcrypt hashes across via createUser's passwordHash /
passwordHashType, so no one is forced to reset a password at cutover. Stiko
hashes at bcrypt cost 12, which is what WorkOS expects.

Idempotent by design: users already carrying a workos_user_id are skipped, and
an address WorkOS reports as already existing is adopted by email rather than
failing the run. Production is the only environment, so a half-imported
database with no way to finish would be the worst outcome.

Addresses are lowercased on the way in, matching the lower(email) unique index
from migration 010 - the two sides must agree or the sign-in lookup misses.

Imported users are marked emailVerified: these are existing accounts already
receiving invitations at those addresses.
```

---

## Verification before calling this plan done

- [ ] `npm test` passes in full.
- [ ] `npm run build` completes.
- [ ] `schema_migrations` contains `010-workos-auth.sql`.
- [ ] `SELECT count(*) FROM users WHERE workos_user_id IS NULL` returns `0`.
- [ ] `npm run import-users` a second time creates nothing.
- [ ] **Sign in to Stiko with an existing password account and confirm nothing changed.** NextAuth is still the live authenticator; if anything about sign-in behaves differently, something in this plan touched what it should not have.
- [ ] WorkOS dashboard shows the same user count as the database, all addresses lowercase.

## What Plan 2 covers

Written once this plan is executed and Part 0 is done, so it can be built against a real WorkOS environment rather than an assumed one:

- `lib/auth.ts` becomes a switch on `AUTH_PROVIDER`, keeping `auth()`'s exported name and return shape so no route handler changes.
- `middleware.ts` moves to `authkit()` + `handleAuthkitHeaders()` — the composable form, because Stiko's `PUBLIC_PATHS` logic must survive; the drop-in `authkitMiddleware()` would replace it. The `'/api/comments'` prefix hazard must be carried across verbatim.
- `/app/auth/callback/route.ts` using `handleAuth({ onSuccess })`.
- Login and signup pages redirect to AuthKit, with Google.
- **The invite flow.** The highest-risk piece: the embedded password form stays, via `authenticateWithPassword()` + `saveSession()`, while Google necessarily round-trips and must carry the invite token through AuthKit's `state` parameter. Returning from Google has to land on the package's first file, never the dashboard.
- Email verification: required for self-serve signups, skipped for invited reviewers.
- Making sign-in case-insensitive, now that the `lower(email)` index exists.
- Phase 4 cleanup: remove the NextAuth path, the `AUTH_PROVIDER` flag and `password_hash`, on a separate day after a clean week.
