# Per-Version Invite Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a commenter or viewer be invited to one version, several, or all of them, instead of the whole package.

**Architecture:** `Access` gains a `versionScope`. One new resolver, `getVersionAccess`, and a version-aware `getFileAccess` carry the rule, so every version-keyed route enforces it by calling one of those two rather than reimplementing a filter. Out-of-scope reads answer 404, indistinguishable from a version that does not exist.

**Tech Stack:** Next.js 14 App Router, TypeScript, Neon serverless Postgres, NextAuth v5, `node:test`, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-04-version-scoped-invites-design.md`

**Branch note:** this branches from `feat/download-authorization` (spec 2), which is built and verified but deliberately unmerged. Both add columns to `participants`.

## Global Constraints

- A package is a permission boundary and now a version is too. Every version-keyed route resolves through `getVersionAccess` or a version-aware `getFileAccess` before answering.
- **Out of scope, no access, and does not exist are the same answer: 404.** A version you were not given must be indistinguishable from one that never existed.
- Only commenters and viewers are ever scoped. Owners, coordinators and uploaders always resolve to `'all'`.
- The server decides scope; the client renders what it is sent and never re-derives it.
- SQL uses the tagged-template `sql` client from `@/lib/db`, interpolating as `${value}`. Never string-concatenate into a query.
- Migrations are re-runnable (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`) and mirrored into `lib/schema.sql`.
- Comment style explains *why*, not *what*.
- UI copy says "package", never "portal". Code identifiers say `portal`.
- Full suite: `npm test`. It is at **326 passing** before this work.
- Do NOT apply migrations, connect to a database, or start a dev server. A production database and live storage credentials are reachable from `.env.local`. The operator handles migrations and verification.

---

### Task 1: Scope columns and join tables

**Files:**
- Create: `lib/migrations/008-version-scoped-invites.sql`
- Modify: `lib/schema.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `participants.all_versions`, `invite_tokens.all_versions`, tables `participant_versions` and `invite_token_versions`.

- [ ] **Step 1: Write the migration**

Create `lib/migrations/008-version-scoped-invites.sql`:

```sql
-- TRUE means every version, including ones published later — today's
-- behaviour. Defaulting to TRUE means no existing participant loses access
-- and no backfill is needed. FALSE means the join rows are the whole scope.
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS all_versions BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE invite_tokens
  ADD COLUMN IF NOT EXISTS all_versions BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS participant_versions (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  UNIQUE(participant_id, version_id)
);

-- The scope lives on the invitation too: the owner chooses it when inviting,
-- and acceptance may be days later.
CREATE TABLE IF NOT EXISTS invite_token_versions (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES invite_tokens(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  UNIQUE(token_id, version_id)
);

-- Every authorized request resolves a scope, so this lookup is hot.
CREATE INDEX IF NOT EXISTS idx_participant_versions_participant
  ON participant_versions(participant_id);
```

Both `version_id` foreign keys cascade on purpose: a scope row naming a deleted version is meaningless, and leaving one would make "scoped to nothing" and "scoped to something that is gone" indistinguishable.

- [ ] **Step 2: Mirror into `lib/schema.sql`**

Add `all_versions BOOLEAN NOT NULL DEFAULT TRUE,` after `role` in both the `participants` and `invite_tokens` table definitions — bare lines with no inline comment, matching how migrations 005, 006 and 007 were mirrored.

Then add both `CREATE TABLE IF NOT EXISTS` blocks, placed after the `participants` table definition so the file reads in dependency order.

Do not delete the migration; an existing database still needs it.

- [ ] **Step 3: Verify scope**

Run: `git diff --stat`

Expected: only `lib/schema.sql` modified, `lib/migrations/008-version-scoped-invites.sql` created.

- [ ] **Step 4: Commit**

```bash
git add lib/migrations/008-version-scoped-invites.sql lib/schema.sql
git commit -m "feat(db): record which versions a guest may see

all_versions defaults TRUE, so every existing participant keeps the access
they have today and no backfill is needed."
```

---

### Task 2: `canSeeVersion` predicate

**Files:**
- Modify: `lib/capabilities.ts`
- Test: `scripts/tests/access.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type VersionScope = 'all' | string[]`
  - `export function canSeeVersion(scope: VersionScope, versionId: string): boolean`

- [ ] **Step 1: Write the failing tests**

Add `canSeeVersion` to the existing import at the top of `scripts/tests/access.test.mjs`, then append:

```js
// Version scoping — docs/superpowers/specs/2026-09-04-version-scoped-invites-design.md.
// Trivial logic deliberately given its own home: the rule needs one place to be
// read and one place to be asserted, because a dozen routes depend on it.

test("'all' sees every version, including ones that did not exist yet", () => {
  // The whole point of 'all' rather than an enumerated list: a version
  // published tomorrow is covered without anyone updating a row.
  assert.equal(canSeeVersion('all', 'v1'), true);
  assert.equal(canSeeVersion('all', 'a-version-nobody-has-created'), true);
});

test('a list sees exactly its members', () => {
  assert.equal(canSeeVersion(['v1', 'v2'], 'v1'), true);
  assert.equal(canSeeVersion(['v1', 'v2'], 'v2'), true);
  assert.equal(canSeeVersion(['v1', 'v2'], 'v3'), false);
});

test('an empty list sees nothing', () => {
  // Reachable: deleting a version cascades its scope rows away, so someone
  // scoped to one deleted version ends up here. Seeing nothing is correct.
  assert.equal(canSeeVersion([], 'v1'), false);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test 2>&1 | tail -20`

Expected: failures, or the whole file failing to load, because `canSeeVersion` is not exported yet.

- [ ] **Step 3: Implement**

Append to `lib/capabilities.ts`:

```ts
/** Which versions a person may see. 'all' includes versions not yet created. */
export type VersionScope = 'all' | string[];

/**
 * Whether this scope admits this version.
 *
 * The logic is one line; the reason it lives here is that a dozen routes
 * depend on it, so it needs a single place to be read and a single place to be
 * asserted without a database.
 *
 * An empty list admits nothing, which is right rather than a degenerate case:
 * deleting a version cascades its scope rows away, so someone scoped to a
 * single deleted version lands here and should see nothing.
 */
export function canSeeVersion(scope: VersionScope, versionId: string): boolean {
  return scope === 'all' || scope.includes(versionId);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`

Expected: 329 passing (326 plus the 3 new), 0 failing.

- [ ] **Step 5: Commit**

```bash
git add lib/capabilities.ts scripts/tests/access.test.mjs
git commit -m "feat(access): add canSeeVersion

One line of logic, but a dozen routes will depend on it, so it gets one home
and one set of assertions rather than being inlined at each call site."
```

---

### Task 3: `versionScope` on access, and the two resolvers

**Files:**
- Modify: `lib/access.ts`

**Interfaces:**
- Consumes: `canSeeVersion`, `VersionScope` from Task 2.
- Produces:
  - `Access` gains `versionScope: VersionScope`
  - `export async function getVersionAccess(userId: string, versionId: string): Promise<Access | null>`
  - `getFileAccess` becomes version-aware (same signature, stricter behaviour)

This is the keystone. Everything after it is routing calls through these.

- [ ] **Step 1: Extend the imports and re-exports**

Add `canSeeVersion` to the value import and re-export from `@/lib/capabilities`, and `VersionScope` to the type import and re-export, alongside the existing entries.

- [ ] **Step 2: Add the field to `Access`**

```ts
  /** Which versions this person may see. Always 'all' for members and uploaders. */
  versionScope: VersionScope;
```

- [ ] **Step 3: Resolve the scope in `getPackageAccess`**

The existing query selects `pa.role AS "guestRole"` and `pa.can_download AS "guestCanDownload"`. Add the participant id and the flag:

```ts
      pa.id           AS "participantId",
      pa.all_versions AS "guestAllVersions",
```

Owners and coordinators return `versionScope: 'all'` alongside their existing fields.

For the guest path, an uploader is always `'all'`; a commenter or viewer with `all_versions` is `'all'`; otherwise fetch the list:

```ts
  const guest = row.guestRole as PackageRole | null;
  if (!guest) return null;

  // An uploader's work builds on what came before, so scoping one would break
  // the thing they are there to do. Only commenters and viewers are narrowed.
  let versionScope: VersionScope = 'all';
  if (guest !== 'uploader' && row.guestAllVersions === false) {
    const scoped = await sql`
      SELECT version_id AS "versionId"
      FROM participant_versions
      WHERE participant_id = ${row.participantId}
    `;
    versionScope = scoped.map((r) => r.versionId as string);
  }

  return {
    role: guest,
    isProjectMember: false,
    mayDownload: Boolean(row.guestCanDownload),
    versionScope,
    ...capabilitiesFor(guest),
  };
```

- [ ] **Step 4: Add `getVersionAccess`**

Append to `lib/access.ts`:

```ts
/**
 * The caller's access to one version, or null if they may not see it.
 *
 * Null covers three cases deliberately made indistinguishable: no such
 * version, no access to its package, and not in your scope. A version you were
 * not given must look exactly like one that never existed, or the id becomes a
 * way to learn what a package contains.
 */
export async function getVersionAccess(
  userId: string,
  versionId: string
): Promise<Access | null> {
  const rows = await sql`
    SELECT portal_id AS "portalId" FROM versions WHERE id = ${versionId}
  `;
  if (!rows[0]) return null;

  const access = await getPackageAccess(userId, rows[0].portalId as string);
  if (!access) return null;
  if (!canSeeVersion(access.versionScope, versionId)) return null;

  return access;
}
```

- [ ] **Step 5: Make `getFileAccess` version-aware**

Every file belongs to a version, so putting the check here covers the file route, the transform route, the download route, `/api/files/url` and both comment paths at once — the difference between enforcing the rule once and reimplementing it in six places.

Replace `portalForFile` and `getFileAccess` with:

```ts
/**
 * The package and version a file belongs to, or null if there is no such file.
 *
 * Anything keyed by fileId — comments, markups, downloads — must resolve
 * through here before answering, or the fileId itself becomes the capability.
 */
export async function portalForFile(
  fileId: string
): Promise<{ portalId: string; versionId: string } | null> {
  const rows = await sql`
    SELECT v.portal_id AS "portalId", v.id AS "versionId"
    FROM files f JOIN versions v ON v.id = f.version_id
    WHERE f.id = ${fileId}
    LIMIT 1
  `;
  return rows[0]
    ? { portalId: rows[0].portalId as string, versionId: rows[0].versionId as string }
    : null;
}

/**
 * The caller's access to the package a file lives in, or null if they may not
 * see it — including when the file's version is outside their scope.
 */
export async function getFileAccess(
  userId: string,
  fileId: string
): Promise<Access | null> {
  const location = await portalForFile(fileId);
  if (!location) return null;

  const access = await getPackageAccess(userId, location.portalId);
  if (!access) return null;
  if (!canSeeVersion(access.versionScope, location.versionId)) return null;

  return access;
}
```

`portalForFile`'s return type changed from `string | null` to an object. Run `grep -rn "portalForFile" app lib` and update every caller. Report which files you changed.

- [ ] **Step 6: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors. If a caller of `portalForFile` breaks, fix it to read `.portalId`; do not change the return type back.

- [ ] **Step 7: Confirm the suite still passes**

Run: `npm test`

Expected: 329 passing.

- [ ] **Step 8: Commit**

```bash
git add lib/access.ts
git commit -m "feat(access): resolve a version scope, and enforce it

getVersionAccess is the single gate for version-keyed routes, and
getFileAccess now checks the scope too — every file belongs to a version, so
that one change covers the file, transform, download, url and comment paths
without repeating the rule in each."
```

---

### Task 4: Route the version-keyed endpoints through `getVersionAccess`

**Files:**
- Modify: `app/api/verdicts/route.ts`
- Modify: `app/api/version-views/route.ts`
- Modify: `app/api/versions/[id]/summary/route.ts`
- Modify: `app/api/files/route.ts`

**Interfaces:**
- Consumes: `getVersionAccess` (Task 3).
- Produces: those four routes answer 404 for an out-of-scope version.

Each of these currently does the same three steps: look up the version's
`portal_id`, call `getPackageAccess`, and 403 on null. Replace that with one
call. **The status changes from 403 to 404** — an out-of-scope version must be
indistinguishable from a nonexistent one, and a caller who can see the package
but not this version must not learn the difference.

- [ ] **Step 1: `app/api/verdicts/route.ts`**

In the GET handler, replace the `portal` lookup and the `getPackageAccess` call with:

```ts
  // 404 rather than 403: a version outside the caller's scope must look exactly
  // like one that does not exist.
  const access = await getVersionAccess(session.user.id, versionId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
```

Change the import from `getPackageAccess` to `getVersionAccess`. If the POST handler in this file does the same lookup, change it the same way.

- [ ] **Step 2: `app/api/version-views/route.ts`**

Same replacement in the POST handler:

```ts
  const access = await getVersionAccess(session.user.id, versionId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
```

- [ ] **Step 3: `app/api/versions/[id]/summary/route.ts`**

This file has a `gate()` helper both GET and POST call. Change the gate's access resolution to `getVersionAccess(session.user.id, params.id)` and have it return 404 on null. Read the helper before editing — preserve whatever else it checks.

- [ ] **Step 4: `app/api/files/route.ts`**

The GET resolves `versionId` to a portal then calls `getPackageAccess`. Replace with `getVersionAccess`, returning 404 on null. Leave the rest of the handler — the `canDelete` and `canDownload` computation, the counts, the `transform` construction — exactly as it is.

- [ ] **Step 5: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors. Remove any now-unused `getPackageAccess` import.

- [ ] **Step 6: Confirm the suite still passes**

Run: `npm test`

Expected: 329 passing.

- [ ] **Step 7: Commit**

```bash
git add app/api/verdicts/route.ts app/api/version-views/route.ts \
        "app/api/versions/[id]/summary/route.ts" app/api/files/route.ts
git commit -m "feat(api): enforce version scope on version-keyed routes

All four answer 404 rather than 403 for a version outside the caller's
scope, so it cannot be told apart from one that does not exist."
```

---

### Task 5: Filter the version list, and scope `/api/files/url`

**Files:**
- Modify: `app/api/versions/route.ts`
- Modify: `app/api/files/url/route.ts`

**Interfaces:**
- Consumes: `canSeeVersion` from `@/lib/access` (Task 2/3).
- Produces: `GET /api/versions?portalId=` returns only versions in scope.

- [ ] **Step 1: Filter the versions list**

`app/api/versions/route.ts`'s GET already has `access` in scope and builds `rows` from one of two branches. After `rows` is built and before the counts query, add:

```ts
  // A scoped reviewer sees only their versions — no row, no count, nothing
  // about the rest. The version number still reveals that a history exists,
  // which is accepted; the content of it does not.
  const visible = rows.filter((r) =>
    canSeeVersion(access.versionScope, r.id as string)
  );
```

Then use `visible` in place of `rows` for the rest of the handler — both the counts lookup and the final `.map`. Add `canSeeVersion` to the `@/lib/access` import.

- [ ] **Step 2: Scope `/api/files/url`**

That route resolves an arbitrary storage key back to a portal via `portalForStorageKey`, then calls `getPackageAccess`. A scoped reviewer must not be able to presign an object belonging to a version they cannot see.

Change `portalForStorageKey` to return the file id as well as the portal id for the file case. Read the function first — it has two branches, one matching `files` and one matching `comments`. For the files branch, also select `f.id`; for the comments branch, also select `f.id` via the join it already makes.

Then in the handler, replace the `getPackageAccess` call with a scope-aware check:

```ts
  const located = await portalForStorageKey(storageKey);
  if (!located) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Resolve through the file so the version scope applies — otherwise a
  // storage key is a way around it.
  const access = await getFileAccess(session.user.id, located.fileId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
```

Import `getFileAccess` from `@/lib/access`; drop `getPackageAccess` if it becomes unused.

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Confirm the suite still passes**

Run: `npm test`

Expected: 329 passing.

- [ ] **Step 5: Commit**

```bash
git add app/api/versions/route.ts app/api/files/url/route.ts
git commit -m "feat(api): filter the version rail, and scope presigned URLs

/api/files/url resolved a storage key straight to a package, which would
have been a way around the version scope; it now resolves through the file."
```

---

### Task 6: Carry the scope through the invitation

**Files:**
- Modify: `app/api/participants/route.ts` (POST)
- Modify: `app/api/invite/[token]/route.ts` (POST, and the GET preview)

**Interfaces:**
- Consumes: the tables from Task 1.
- Produces: `POST /api/participants` accepts `allVersions: boolean` and `versionIds: string[]`; acceptance copies them onto the participant.

- [ ] **Step 1: Accept and store the scope when inviting**

In `app/api/participants/route.ts`'s POST, add to the destructured body:

```ts
  const { portalId, email, role, note, shareLink, canDownload, allVersions, versionIds } =
    await request.json();
```

After the existing `grantsDownload` derivation, add:

```ts
  // Only commenters and viewers are ever scoped. An uploader's work builds on
  // what came before, so a scoped uploader would be unable to do the job.
  const scopable = role === 'commenter' || role === 'viewer';
  const scopeAll = !scopable || allVersions !== false;
  const scopeIds: string[] =
    scopeAll || !Array.isArray(versionIds) ? [] : versionIds.filter((v) => typeof v === 'string');
```

The `allVersions !== false` shape matters: an invitation that omits the field entirely keeps today's behaviour, so an older client or a bulk import cannot accidentally narrow someone.

Add `all_versions` to the `invite_tokens` INSERT column list and `${scopeAll}` to its values. Capture the inserted row id — change `RETURNING token` to `RETURNING id, token` — then insert the scope rows:

```ts
  if (!scopeAll && scopeIds.length > 0) {
    // Only versions that really belong to this package. A caller could
    // otherwise name a version from a package they have nothing to do with.
    for (const vId of scopeIds) {
      await sql`
        INSERT INTO invite_token_versions (id, token_id, version_id)
        SELECT ${uuidv4()}, ${rows[0].id}, ${vId}
        WHERE EXISTS (
          SELECT 1 FROM versions WHERE id = ${vId} AND portal_id = ${portalId}
        )
        ON CONFLICT (token_id, version_id) DO NOTHING
      `;
    }
  }
```

- [ ] **Step 2: Copy the scope on acceptance**

In `app/api/invite/[token]/route.ts`'s POST, the participant INSERT currently sets `can_download` and uses a conditional `ON CONFLICT DO UPDATE`. Add `all_versions` to it, following the same rule — an addressed invitation applies its scope, a share link does not overwrite an existing one:

```ts
  const joined = await sql`
    INSERT INTO participants (id, portal_id, user_id, role, can_download, all_versions)
    VALUES (${uuidv4()}, ${invite.portal_id}, ${session.user.id}, ${invite.role},
            ${invite.can_download === true}, ${invite.all_versions !== false})
    ON CONFLICT (portal_id, user_id) DO UPDATE
      SET can_download = EXCLUDED.can_download,
          all_versions = EXCLUDED.all_versions
      WHERE ${!invite.multi_use}
    RETURNING id, (xmax = 0) AS "isNew"
  `;
```

Then copy the version rows, replacing any existing scope so a re-accepted invitation is authoritative:

```ts
  const participantId = joined[0]?.id;
  if (participantId && invite.all_versions === false) {
    // Replace rather than add: the invitation the owner just sent is the
    // intended scope, not an increment on whatever was there before.
    await sql`DELETE FROM participant_versions WHERE participant_id = ${participantId}`;
    await sql`
      INSERT INTO participant_versions (id, participant_id, version_id)
      SELECT gen_random_uuid()::text, ${participantId}, version_id
      FROM invite_token_versions WHERE token_id = ${invite.id}
      ON CONFLICT (participant_id, version_id) DO NOTHING
    `;
  }
```

Read the surrounding code first and confirm `invite.id` is available — the handler does `SELECT * FROM invite_tokens`, so it should be. If the column is named differently in that row, use the actual name and say so in your report.

- [ ] **Step 3: Preview a version the invitation actually grants**

The GET in the same file shows "the latest published version and its files" to the invitee before they accept. For a scoped invitation that must be a version the invitation grants, not simply the newest.

Change the version lookup so that when `invite.all_versions === false`, it picks the highest-numbered published version among `invite_token_versions` for this token; otherwise it keeps today's behaviour. Read the existing query and adapt it, keeping its `published_at IS NOT NULL` filter and `ORDER BY version_number DESC LIMIT 1`.

- [ ] **Step 4: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Confirm the suite still passes**

Run: `npm test`

Expected: 329 passing.

- [ ] **Step 6: Commit**

```bash
git add app/api/participants/route.ts "app/api/invite/[token]/route.ts"
git commit -m "feat(invites): carry a version scope from invitation to participant

Only commenters and viewers are scopable, and an omitted field means all
versions, so an older client cannot accidentally narrow someone. Version ids
are checked against the package before they are stored."
```

---

### Task 7: Change the scope after the invitation

**Files:**
- Create: `app/api/participants/versions/route.ts`

**Interfaces:**
- Consumes: `getPackageAccess` from `@/lib/access`.
- Produces: `POST /api/participants/versions` taking `{ userId, portalId, allVersions, versionIds }`.

**Read `app/api/participants/download/route.ts` first.** This is its sibling and shares its shape, including that `userId` may be a user id **or** an email address — the People panel lists pending invitations alongside accepted people, and a pending invitation has no `participants` row.

- [ ] **Step 1: Create the route**

Create `app/api/participants/versions/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';

/**
 * Widen or narrow which versions one person may see, after the invitation.
 *
 * `userId` may be a user id (an accepted guest) or an email (a pending
 * invitation), the same split /api/participants/role and
 * /api/participants/download handle — a pending invitation has no participants
 * row, so its scope lives on the token instead.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { userId, portalId, allVersions, versionIds } = await request.json();

  if (!userId || !portalId) {
    return NextResponse.json(
      { error: 'userId and portalId are required' },
      { status: 400 }
    );
  }
  if (typeof allVersions !== 'boolean') {
    return NextResponse.json(
      { error: 'allVersions must be a boolean' },
      { status: 400 }
    );
  }
  const ids: string[] = Array.isArray(versionIds)
    ? versionIds.filter((v) => typeof v === 'string')
    : [];

  const access = await getPackageAccess(session.user.id, portalId);
  if (!access?.canManagePeople) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isEmail = String(userId).includes('@');

  if (isEmail) {
    const tokens = await sql`
      UPDATE invite_tokens SET all_versions = ${allVersions}
      WHERE portal_id = ${portalId} AND email = ${userId}
        AND used_at IS NULL AND revoked_at IS NULL
      RETURNING id
    `;
    for (const t of tokens) {
      await sql`DELETE FROM invite_token_versions WHERE token_id = ${t.id}`;
      if (!allVersions) {
        for (const vId of ids) {
          await sql`
            INSERT INTO invite_token_versions (id, token_id, version_id)
            SELECT ${uuidv4()}, ${t.id}, ${vId}
            WHERE EXISTS (
              SELECT 1 FROM versions WHERE id = ${vId} AND portal_id = ${portalId}
            )
            ON CONFLICT (token_id, version_id) DO NOTHING
          `;
        }
      }
    }
    return NextResponse.json({ ok: true, updated: tokens.length });
  }

  const rows = await sql`
    UPDATE participants SET all_versions = ${allVersions}
    WHERE portal_id = ${portalId} AND user_id = ${userId}
    RETURNING id
  `;
  if (!rows[0]) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await sql`DELETE FROM participant_versions WHERE participant_id = ${rows[0].id}`;
  if (!allVersions) {
    for (const vId of ids) {
      // Checked against the package, so a caller cannot grant sight of a
      // version belonging to somewhere else entirely.
      await sql`
        INSERT INTO participant_versions (id, participant_id, version_id)
        SELECT ${uuidv4()}, ${rows[0].id}, ${vId}
        WHERE EXISTS (
          SELECT 1 FROM versions WHERE id = ${vId} AND portal_id = ${portalId}
        )
        ON CONFLICT (participant_id, version_id) DO NOTHING
      `;
    }
  }

  return NextResponse.json({ ok: true });
}
```

Note this returns 404 when no participant row matched, unlike its download sibling which returns `{ok:true}` regardless — a reviewer flagged that silence as a real problem, and there is no reason to reproduce it in a new route.

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/participants/versions/route.ts
git commit -m "feat(participants): change a version scope after inviting

Keyed like the role and download routes so it reaches a pending invitation
as well as an accepted guest, and every version id is checked against the
package before it is stored."
```

---

### Task 8: Report scope, and offer the versions to choose from

**Files:**
- Modify: `app/api/participants/route.ts` (GET)
- Modify: `app/api/invites/route.ts` (GET)

**Interfaces:**
- Consumes: the tables from Task 1.
- Produces: participant and pending-invite rows gain `allVersions: boolean` and `versionIds: string[]`.

Neither the People panel nor the invite modals can render a scope editor without knowing the current scope.

- [ ] **Step 1: Add scope to the participants listing**

In `app/api/participants/route.ts`'s GET, add `p.all_versions AS "allVersions",` to the SELECT list beside `p.role`. Then after the query, attach each row's version ids:

```ts
  // The panel renders a scope editor, which needs the current selection.
  const scopes = await sql`
    SELECT pv.participant_id AS "participantId", pv.version_id AS "versionId"
    FROM participant_versions pv
    JOIN participants p ON p.id = pv.participant_id
    WHERE p.portal_id = ${portalId}
  `;
  const byParticipant = new Map<string, string[]>();
  for (const s of scopes) {
    const key = s.participantId as string;
    byParticipant.set(key, [...(byParticipant.get(key) ?? []), s.versionId as string]);
  }

  return NextResponse.json(
    rows.map((r) => ({ ...r, versionIds: byParticipant.get(r.id as string) ?? [] }))
  );
```

Replace the existing `return NextResponse.json(rows);` with that.

- [ ] **Step 2: Add scope to the pending-invites listing**

In `app/api/invites/route.ts`'s GET, add `all_versions AS "allVersions",` to the SELECT list beside `role`, and attach version ids the same way, joining `invite_token_versions` on `token_id` and filtering to this package's invitations. Read the existing query to see what it selects and how it filters, and match its shape.

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Confirm the suite still passes**

Run: `npm test`

Expected: 329 passing.

- [ ] **Step 5: Commit**

```bash
git add app/api/participants/route.ts app/api/invites/route.ts
git commit -m "feat(api): report each person's version scope

The People panel and the invite modals cannot render a scope editor without
knowing the current selection."
```

---

### Task 9: Stop notifying people about versions they cannot see

**Files:**
- Modify: `app/api/versions/publish/route.ts`

**Interfaces:**
- Consumes: the `all_versions` column from Task 1.
- Produces: publish notifies only people who can see the new version.

This is the leak that matters most. Publishing currently sends an in-app notification **and an email** to every participant, titled "Version N published in <package>". A commenter scoped away from that version would be told it exists — and by email, which reaches people who never open the app.

- [ ] **Step 1: Narrow the recipient query**

In the `if (notify)` block, add one condition to the recipients query:

```ts
    const recipients = await sql`
      SELECT u.id, u.email, u.name
      FROM participants p
      JOIN users u ON u.id = p.user_id
      WHERE p.portal_id = ${version.portalId}
        AND p.user_id <> ${session.user.id}
        -- A version published seconds ago cannot be in anyone's explicit
        -- scope, so only the unscoped can see it. Telling a scoped reviewer
        -- would leak by email exactly what the scope hides in the UI.
        AND p.all_versions = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM portal_mutes m
          WHERE m.portal_id = p.portal_id AND m.user_id = p.user_id
        )
    `;
```

Change nothing else in the handler — not the email preference lookup, not the pause check, not the notification insert.

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Confirm the suite still passes**

Run: `npm test`

Expected: 329 passing.

- [ ] **Step 4: Commit**

```bash
git add app/api/versions/publish/route.ts
git commit -m "fix(notifications): do not announce a version to someone scoped away from it

Publish emailed every participant, so a reviewer limited to V2 would be told
V4 exists — a leak that travels further than a UI one, because it reaches
people who never open the app."
```

---

### Task 10: Keep the dashboard and overview inside the scope

**Files:**
- Modify: `lib/queries.ts`
- Modify: `app/api/projects/[id]/overview/route.ts`

**Interfaces:**
- Consumes: the `all_versions` column and `participant_versions` from Task 1.
- Produces: neither surface shows an out-of-scope version's details.

`lib/queries.ts` shows each package's **latest** version on the dashboard — its number, changelog, file count and unseen state. The project overview does the same. For a scoped reviewer, "latest" must mean the latest they can see.

- [ ] **Step 1: Scope the dashboard's latest-version subquery**

Read `lib/queries.ts` and find the lateral/`DISTINCT ON` subquery that picks the newest version per portal (around lines 54-59). Add a condition so a version is only eligible when the viewer may see it:

```sql
        AND (
          EXISTS (
            SELECT 1 FROM participants pa
            WHERE pa.portal_id = v.portal_id AND pa.user_id = ${userId}
              AND (pa.all_versions OR pa.role = 'uploader')
          )
          OR EXISTS (
            SELECT 1 FROM participant_versions pv
            JOIN participants pa2 ON pa2.id = pv.participant_id
            WHERE pa2.portal_id = v.portal_id AND pa2.user_id = ${userId}
              AND pv.version_id = v.id
          )
          OR EXISTS (
            SELECT 1 FROM projects pr
            LEFT JOIN project_members pm
              ON pm.project_id = pr.id AND pm.user_id = ${userId}
            JOIN portals po ON po.project_id = pr.id
            WHERE po.id = v.portal_id
              AND (pr.owner_id = ${userId} OR pm.user_id IS NOT NULL)
          )
        )
```

Three branches, matching `getPackageAccess`: an unscoped or uploader participant, a participant explicitly scoped to this version, or a project member. Read the surrounding query and confirm the alias for the versions table is `v` and that `${userId}` is the parameter already in scope — adapt the names to what is actually there rather than assuming.

- [ ] **Step 2: Scope the project overview the same way**

`app/api/projects/[id]/overview/route.ts` has its own latest-version lookup. That route is gated on `isProjectMember`, and project members always see everything — so **verify whether any non-member can reach it**. Read the route's authorization. If it is members-only, no change is needed; say so in your report and move on. If a guest can reach it, apply the same condition.

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Confirm the suite still passes**

Run: `npm test`

Expected: 329 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/queries.ts "app/api/projects/[id]/overview/route.ts"
git commit -m "feat(dashboard): latest version means the latest you can see

The dashboard card showed each package's newest version with its number,
changelog and file count regardless of scope."
```

---

### Task 11: Choose a scope when inviting

**Files:**
- Modify: `components/portal/ShareModal.tsx`
- Modify: `components/people/AddPeopleModal.tsx`

**Interfaces:**
- Consumes: `POST /api/participants` accepting `allVersions` and `versionIds` (Task 6); `GET /api/versions?portalId=` for the list to choose from.
- Produces: nothing downstream.

The selector appears only when the chosen role is **commenter or viewer**. It is **absent** for uploader, not disabled — an uploader is never scoped, and absence states that where a greyed-out control invites the question.

- [ ] **Step 1: Add the selector to `ShareModal`**

That modal already knows its `portalId`. Add state and a fetch of the package's versions:

```tsx
  const [allVersions, setAllVersions] = useState(true);
  const [scopeIds, setScopeIds] = useState<string[]>([]);
  const [versions, setVersions] = useState<{ id: string; versionNumber: number }[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    fetch(`/api/versions?portalId=${portalId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((v) => setVersions(Array.isArray(v) ? v : []))
      .catch(() => setVersions([]));
  }, [isOpen, portalId]);
```

Reset `allVersions` to `true` and `scopeIds` to `[]` in the existing close-reset effect, and again after a successful invite alongside the email and download resets.

Render below the role selector, only for a scopable role:

```tsx
        {(inviteRole === 'commenter' || inviteRole === 'viewer') && versions.length > 0 && (
          <div className="mt-2">
            <span className="mb-[6px] block text-[12px] font-bold text-stiko-secondary">
              Versions they can see
            </span>
            <label className="flex items-center gap-2 text-[12.5px] font-semibold text-stiko-secondary">
              <input
                type="checkbox"
                checked={allVersions}
                onChange={(e) => setAllVersions(e.target.checked)}
                className="h-[15px] w-[15px] accent-stiko-primary"
              />
              All versions, including future ones
            </label>
            {!allVersions && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {versions.map((v) => {
                  const on = scopeIds.includes(v.id);
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() =>
                        setScopeIds((prev) =>
                          prev.includes(v.id) ? prev.filter((x) => x !== v.id) : [...prev, v.id]
                        )
                      }
                      className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold transition ${
                        on
                          ? 'bg-stiko-primary text-white'
                          : 'bg-stiko-app text-stiko-secondary hover:text-stiko-ink'
                      }`}
                    >
                      V{v.versionNumber}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
```

Widen `createInvite` to take the scope and include `allVersions` and `versionIds` in its request body. The share-link call passes the same scope — unlike the download grant, narrowing is safe on a forwardable link.

- [ ] **Step 2: Add the selector to `AddPeopleModal`**

That modal holds `selection` as `Record<string, PackageGrant>` where `PackageGrant` is `{ role, canDownload }`. Widen it:

```tsx
  type PackageGrant = {
    role: Role;
    canDownload: boolean;
    allVersions: boolean;
    versionIds: string[];
  };
```

Seed new entries with `allVersions: true, versionIds: []` in `toggle` and in the single-package initial state. Include both fields in the send loop's request body.

This modal is project-level and may cover several packages, so it needs each package's versions. Fetch them for the selected packages when the modal opens:

```tsx
  const [versionsByPackage, setVersionsByPackage] = useState<
    Record<string, { id: string; versionNumber: number }[]>
  >({});

  useEffect(() => {
    if (!isOpen) return;
    // Only the packages actually ticked — fetching every package's versions on
    // open would be a request per package for a list most invites never use.
    for (const portalId of Object.keys(selection)) {
      if (versionsByPackage[portalId]) continue;
      fetch(`/api/versions?portalId=${portalId}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((v) =>
          setVersionsByPackage((prev) => ({ ...prev, [portalId]: Array.isArray(v) ? v : [] }))
        )
        .catch(() => undefined);
    }
  }, [isOpen, selection, versionsByPackage]);
```

Render the same "All versions" checkbox and version pills beneath each ticked package whose role is commenter or viewer, writing to `selection[pkg.id].allVersions` and `.versionIds`.

- [ ] **Step 3: Verify it typechecks and lints**

Run: `npx tsc --noEmit && npm run lint`

Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add components/portal/ShareModal.tsx components/people/AddPeopleModal.tsx
git commit -m "feat(invites): choose which versions a reviewer can see

Shown only for commenter and viewer. Absent for uploader rather than
disabled — an uploader is never scoped, and absence says so."
```

---

### Task 12: Edit the scope from the People panel

**Files:**
- Modify: `app/portal/[id]/settings/people/page.tsx`

**Interfaces:**
- Consumes: `POST /api/participants/versions` (Task 7); `allVersions` and `versionIds` on both listings (Task 8).
- Produces: nothing downstream.

- [ ] **Step 1: Extend the row types and fetch the versions**

Add to both the accepted-person and `Pending` interfaces:

```tsx
  allVersions?: boolean;
  versionIds?: string[];
```

Add state and a fetch for the package's versions, alongside the existing loads:

```tsx
  const [versions, setVersions] = useState<{ id: string; versionNumber: number }[]>([]);
```

and inside the existing `load()`, add a fetch of `/api/versions?portalId=${id}` guarded with `res.ok`, setting `versions` to `[]` on failure.

- [ ] **Step 2: Add the handler**

```tsx
  // Sent whole rather than as a diff: the panel always holds the complete
  // selection, and a diff would need a merge rule for a scope changed in
  // another tab.
  const changeScope = async (
    userId: string,
    allVersions: boolean,
    versionIds: string[]
  ) => {
    const res = await fetch('/api/participants/versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, portalId: id, allVersions, versionIds }),
    });
    if (!res.ok) {
      toast('Could not change which versions they can see');
      return;
    }
    toast('Versions updated');
    load();
  };
```

- [ ] **Step 3: Render the editor on each accepted person's row**

Only for a scopable role. Beneath the row's existing controls:

```tsx
                {(p.role === 'commenter' || p.role === 'viewer') && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-stiko-secondary">
                      <input
                        type="checkbox"
                        checked={p.allVersions !== false}
                        onChange={(e) => changeScope(p.userId, e.target.checked, p.versionIds ?? [])}
                        className="h-[14px] w-[14px] accent-stiko-primary"
                      />
                      All versions
                    </label>
                    {p.allVersions === false &&
                      versions.map((v) => {
                        const on = (p.versionIds ?? []).includes(v.id);
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() =>
                              changeScope(
                                p.userId,
                                false,
                                on
                                  ? (p.versionIds ?? []).filter((x) => x !== v.id)
                                  : [...(p.versionIds ?? []), v.id]
                              )
                            }
                            className={`rounded-full px-2 py-0.5 text-[11px] font-bold transition ${
                              on ? 'bg-stiko-primary text-white' : 'bg-stiko-app text-stiko-secondary'
                            }`}
                          >
                            V{v.versionNumber}
                          </button>
                        );
                      })}
                  </div>
                )}
```

- [ ] **Step 4: Render it on each pending invitation's row**

The same control, keyed on the invitation's email rather than a user id, and guarded by `p.email &&` because a share-link row has no email. TypeScript's narrowing does not cross the arrow-function boundary, so use `p.email!` inside the handler — the same pattern the existing `resend(p.email!, p.role)` in that file already uses.

- [ ] **Step 5: Verify it typechecks and lints**

Run: `npx tsc --noEmit && npm run lint`

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add "app/portal/[id]/settings/people/page.tsx"
git commit -m "feat(people): edit which versions a reviewer can see

Works for pending invitations as well as accepted people, and is hidden for
roles that are never scoped."
```

---

### Task 13: Say so when nothing has been shared

**Files:**
- Modify: `app/portal/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/versions?portalId=` returning a filtered list (Task 5).
- Produces: nothing downstream.

If the owner deletes the only version in someone's scope, the cascade removes their scope rows and they become a participant who can see nothing. The package page currently renders an empty version rail, which reads as a loading failure or a broken app rather than a deliberate state.

- [ ] **Step 1: Distinguish "nothing shared" from "no versions yet"**

The page already tracks `versions` and `loading`. The sidebar shows "Submit your first version to get started" when the list is empty — right for an owner, wrong for a scoped reviewer.

`FileTreeSidebar` receives `onSubmitVersion` only when the viewer can upload, so it already knows which case it is in. In `components/portal/FileTreeSidebar.tsx`, change the empty-state text to depend on that:

```tsx
          <p className="text-[13px] text-stiko-faint py-2">
            {onSubmitVersion
              ? 'Submit your first version to get started'
              : 'Nothing in this package has been shared with you yet'}
          </p>
```

Read the surrounding JSX first and keep whatever wrapper and classes are already there — change only the string and make it conditional.

- [ ] **Step 2: Verify it typechecks and lints**

Run: `npx tsc --noEmit && npm run lint`

Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add components/portal/FileTreeSidebar.tsx
git commit -m "feat(portal): say when nothing has been shared with you

An empty rail read as a broken page. A scoped reviewer whose only version
was deleted now gets told that is what happened."
```

---

### Task 14: Record it in the architecture notes

**Files:**
- Modify: `ARCHITECTURE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Read the surrounding sections**

Run: `grep -n "^#\{1,3\} " ARCHITECTURE.md`

Read the Auth Model section and the Deletion Flow and Download Flow subsections added by the previous two features. Match their voice — terse, consequence-first, vendor-neutral — and do not restructure the document.

- [ ] **Step 2: Add a Version Scope subsection**

Add under Data Flow, after Download Flow. Convey, in the document's own words:

- A commenter or viewer may be limited to specific versions; owners, coordinators and uploaders never are, because an uploader's work builds on what came before.
- `canSeeVersion` in `lib/capabilities.ts` holds the rule; `getVersionAccess` in `lib/access.ts` is the gate every version-keyed route calls, and `getFileAccess` applies the same check so the file, transform, download, url and comment routes inherit it.
- Out of scope answers 404, indistinguishable from a version that does not exist.
- `all_versions` covers versions published later; an explicit list does not, so a new version reaches only unscoped people — which is also why publish does not notify anyone else.

- [ ] **Step 3: Record what scoping does not hide**

Add a short paragraph: version numbers are not renumbered per viewer, so someone scoped to V3 sees the label "Version 3" and can infer earlier versions existed. Scoping hides the content of other versions — files, changelogs, comments, dates, reviewers — not the bare fact that the package has a history. Renumbering per viewer would contradict the rule that version numbers are never reassigned, which exists because numbers appear in sent emails.

- [ ] **Step 4: Note the migration**

Add one line to Migration Notes for `008-version-scoped-invites.sql`: adds `all_versions` to `participants` and `invite_tokens`, both defaulting true, plus the two join tables; must be applied before deploying code that reads them.

- [ ] **Step 5: Verify only that file changed**

Run: `git diff --stat`

Expected: only `ARCHITECTURE.md`.

- [ ] **Step 6: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: record per-version invite scoping

Including what it does not hide: version numbers still reveal that a
history exists."
```

---

## Deployment

1. Apply migration `008`, then confirm it in `schema_migrations`.
2. Deploy the code.

Reversed, `participants.all_versions` does not exist, and `getPackageAccess` selects it — so Postgres 42703 takes down **every authorized route in the app**, not the scoping feature. Same failure shape as 007, and for the same reason: the column is read by the central access helper.

Both columns default TRUE and the join tables start empty, so applying the migration ahead of the code changes nothing for anyone.

**Rollback:** revert the deploy. The columns and tables can stay; they are additive and nothing outside this feature reads them.

## Spec coverage

| Spec section | Task |
|---|---|
| `all_versions` + both join tables | 1 |
| Mirrored into `lib/schema.sql` | 1 |
| `canSeeVersion` predicate + tests | 2 |
| `Access.versionScope`, uploaders always 'all' | 3 |
| `getVersionAccess` | 3 |
| Version-aware `getFileAccess` | 3 |
| Version-keyed routes answer 404 | 4 |
| Version list filtered | 5 |
| `/api/files/url` scoped | 5 |
| Invite carries scope; ids checked against the package | 6 |
| Acceptance copies scope | 6 |
| Invite preview shows a granted version | 6 |
| Changeable afterwards, incl. pending invites | 7, 8, 12 |
| Publish does not notify scoped people | 9 |
| Dashboard and overview respect scope | 10 |
| Invite modal selector, absent for uploader | 11 |
| People panel scope editor | 12 |
| Empty-scope state | 13 |
| What scoping does not hide, in the docs | 14 |

## Out of scope

Scoping uploaders, coordinators or owners. Per-file scoping within a version. Any change to how version numbers are assigned or displayed. Retroactively narrowing existing participants. Notifying someone that their scope changed.
