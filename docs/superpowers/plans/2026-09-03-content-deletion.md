# Content Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let owners and coordinators delete any file or version, and let uploaders delete their own files while the version is still a draft.

**Architecture:** A pure predicate in `lib/capabilities.ts` holds the rules and is unit-tested without a database. Two resolvers in `lib/access.ts` fetch role, ownership and publish state, then delegate to it. Two new DELETE routes call a resolver, delete the database rows, then best-effort remove the R2 objects. The server stamps `canDelete` onto the files and versions payloads so the UI never re-derives the rule.

**Tech Stack:** Next.js 14 App Router, TypeScript, Neon serverless Postgres (`@neondatabase/serverless`), NextAuth v5, S3-compatible R2 via `@aws-sdk/client-s3`, `node:test` for tests, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-03-content-deletion-design.md`

## Global Constraints

- Package is a permission boundary. Every route resolving an id must go through `getPackageAccess` / `getFileAccess` before answering. An id is an identifier, never a capability.
- "No access" and "does not exist" both return **404**, never distinguishable. **403** is only for a caller who has package access but lacks this specific power.
- Version numbers are never reassigned. Deleting a version leaves a permanent gap.
- SQL uses the tagged-template `sql` client from `@/lib/db`. Values interpolate as `${value}` — never string-concatenate into a query.
- Migrations are re-runnable: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
- Migrations are applied manually and have been forgotten twice. Task 1 must be deployed before any code reading `uploaded_by`.
- Comment style in this codebase explains *why*, not *what*. Match it. Do not add comments restating the code.
- UI copy says "package", never "portal". Code says `portal` everywhere.
- Run the full suite with `npm test` (`node --test scripts/tests/*.mjs`, Node v25 strips TypeScript natively, so `.ts` imports work directly).

---

### Task 1: Add `files.uploaded_by` with backfill

**Files:**
- Create: `lib/migrations/005-file-deletion.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: column `files.uploaded_by TEXT NULL` referencing `users(id)`, index `idx_files_uploaded_by`.

- [ ] **Step 1: Write the migration**

Create `lib/migrations/005-file-deletion.sql`:

```sql
-- Who uploaded each file. Needed so an uploader can delete their own mistake
-- before anyone sees it; versions already track created_by, files did not.
ALTER TABLE files
  ADD COLUMN IF NOT EXISTS uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL;

-- SET NULL, not CASCADE: removing a user account must never destroy the files
-- they uploaded. Matches versions.created_by.

-- Existing rows are credited to whoever created their version. A guess, but the
-- only one available, and bounded: the uploader's delete window closes at
-- publish, so this can only matter for files in currently-open drafts.
UPDATE files SET uploaded_by = (
  SELECT v.created_by FROM versions v WHERE v.id = files.version_id
) WHERE uploaded_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_files_uploaded_by ON files(uploaded_by);
```

- [ ] **Step 2: Verify it parses and is listed as outstanding**

Run: `set -a && . .env.local && set +a && npm run migrate -- --dry`

Expected: output lists `005-file-deletion.sql` as pending. If `DATABASE_URL` is unset the script exits with instructions — load env as shown.

- [ ] **Step 3: Apply it**

Run: `set -a && . .env.local && set +a && npm run migrate`

Expected: reports `005-file-deletion.sql` applied.

- [ ] **Step 4: Confirm the column and backfill landed**

Run:

```bash
set -a && . .env.local && set +a && node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`SELECT COUNT(*) AS total, COUNT(uploaded_by) AS attributed FROM files\`
  .then(r => console.log(r[0]));
"
```

Expected: an object like `{ total: N, attributed: M }`. `M` equals `N` minus any files whose version has a null `created_by` (that user was deleted). A zero `attributed` on a non-empty table means the backfill failed — stop and investigate.

- [ ] **Step 5: Commit**

```bash
git add lib/migrations/005-file-deletion.sql
git commit -m "feat(db): record who uploaded each file

Versions track created_by; files did not, so there was no way to tell whose
upload a file was. Needed for uploader-scoped deletion.

Backfills existing rows from versions.created_by."
```

---

### Task 2: `canDeleteContent` predicate

**Files:**
- Modify: `lib/capabilities.ts`
- Test: `scripts/tests/access.test.mjs`

**Interfaces:**
- Consumes: `EffectiveRole` from `lib/capabilities.ts`.
- Produces:
  - `export interface DeleteContext { role: EffectiveRole; isOwnUpload: boolean; isPublished: boolean }`
  - `export function canDeleteContent(ctx: DeleteContext): boolean`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/tests/access.test.mjs`. Add `canDeleteContent` to the existing import on line 3 so it reads:

```js
import { capabilitiesFor, canDeleteContent } from '../../lib/capabilities.ts';
```

Then append:

```js
// Deletion rules — docs/superpowers/specs/2026-09-03-content-deletion-design.md.
// Kept as an explicit matrix rather than derived from capabilitiesFor: "may add
// a file" and "may destroy one with other people's comments on it" are
// different powers, and deriving one from the other is how they silently merge.

test('owner and coordinator delete anything, published or not', () => {
  for (const role of ['owner', 'coordinator']) {
    for (const isOwnUpload of [true, false]) {
      for (const isPublished of [true, false]) {
        assert.equal(
          canDeleteContent({ role, isOwnUpload, isPublished }),
          true,
          `${role} own=${isOwnUpload} published=${isPublished}`
        );
      }
    }
  }
});

test('an uploader deletes their own file only while it is unpublished', () => {
  assert.equal(
    canDeleteContent({ role: 'uploader', isOwnUpload: true, isPublished: false }),
    true
  );
});

test('an uploader cannot delete their own file once it is published', () => {
  // The rule most likely to be loosened by accident. Publishing is the moment
  // reviewers can see and comment on the file, and deleting it cascades to
  // their comments and markups.
  assert.equal(
    canDeleteContent({ role: 'uploader', isOwnUpload: true, isPublished: true }),
    false
  );
});

test('an uploader cannot delete someone else\'s file, even in a draft', () => {
  assert.equal(
    canDeleteContent({ role: 'uploader', isOwnUpload: false, isPublished: false }),
    false
  );
});

test('commenters and viewers never delete anything', () => {
  for (const role of ['commenter', 'viewer']) {
    for (const isOwnUpload of [true, false]) {
      for (const isPublished of [true, false]) {
        assert.equal(
          canDeleteContent({ role, isOwnUpload, isPublished }),
          false,
          `${role} own=${isOwnUpload} published=${isPublished}`
        );
      }
    }
  }
});

test('an unrecognised role cannot delete', () => {
  // Same fail-closed guarantee capabilitiesFor makes: the database CHECK
  // constraint can gain a role the TypeScript union has not.
  assert.equal(
    canDeleteContent({ role: 'reviewer', isOwnUpload: true, isPublished: false }),
    false
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | grep -A3 "canDeleteContent\|not a function\|SyntaxError" | head -20`

Expected: failures reporting `canDeleteContent is not a function`.

- [ ] **Step 3: Implement the predicate**

Append to `lib/capabilities.ts`:

```ts
export interface DeleteContext {
  role: EffectiveRole;
  /** The caller uploaded this file. Always false when judging a whole version. */
  isOwnUpload: boolean;
  /** The version is published — for a file, the version containing it. */
  isPublished: boolean;
}

/**
 * Who may destroy content.
 *
 * Deleting a file cascades to every comment and markup on it, so this is the
 * power to erase other people's work, not just one's own. That is why an
 * uploader's reach stops at publication: before it nobody has seen the file, so
 * deletion harms no one; after it, removal is the owner's call.
 *
 * A version is never "own upload" — one version can hold files from several
 * uploaders, so letting any of them delete the container would let them delete
 * the others' work.
 */
export function canDeleteContent(ctx: DeleteContext): boolean {
  switch (ctx.role) {
    case 'owner':
    case 'coordinator':
      return true;
    case 'uploader':
      return ctx.isOwnUpload && !ctx.isPublished;
    case 'commenter':
    case 'viewer':
      return false;
    default: {
      // Same two guarantees as capabilitiesFor: a role added to EffectiveRole
      // without a case here fails to typecheck, and one that reaches this
      // through an unchecked cast is denied rather than falling through.
      const unhandled: never = ctx.role;
      void unhandled;
      return false;
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`

Expected: all tests pass, including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add lib/capabilities.ts scripts/tests/access.test.mjs
git commit -m "feat(access): add canDeleteContent predicate

Rules for deleting files and versions, kept pure and in capabilities.ts so
they can be asserted without a database — the same reason that file exists.

Uploaders reach only their own unpublished files: deleting a file cascades
to every comment and markup on it, so an unbounded window would let one
person destroy another's review work."
```

---

### Task 3: Delete decision resolvers

**Files:**
- Modify: `lib/access.ts`

**Interfaces:**
- Consumes: `canDeleteContent`, `DeleteContext` from Task 2; `sql` from `@/lib/db`.
- Produces:
  - `export interface DeleteDecision { allowed: boolean; portalId: string; storageKeys: string[] }`
  - `export async function getFileDeleteDecision(userId: string, fileId: string): Promise<DeleteDecision | null>`
  - `export async function getVersionDeleteDecision(userId: string, versionId: string): Promise<DeleteDecision | null>`

`null` means no such row **or** no access to its package — deliberately indistinguishable so an id probe cannot confirm existence. `allowed: false` means the caller can see the package but lacks the power.

- [ ] **Step 1: Add the resolvers**

Update the import at the top of `lib/access.ts` to include the new names:

```ts
import { capabilitiesFor, canDeleteContent, type Capabilities, type DeleteContext, type EffectiveRole, type PackageRole, type ProjectRole } from '@/lib/capabilities';

export { capabilitiesFor, canDeleteContent };
export type { Capabilities, DeleteContext, EffectiveRole, PackageRole, ProjectRole };
```

Append to `lib/access.ts`:

```ts
export interface DeleteDecision {
  allowed: boolean;
  portalId: string;
  /** R2 keys to clean up once the rows are gone. Nulls are filtered out. */
  storageKeys: string[];
}

/**
 * May this user delete this file, and what does deleting it strand in storage?
 *
 * Returns null when the file does not exist OR the caller cannot see its
 * package — the caller must not be able to tell those apart, or the id becomes
 * an existence oracle.
 *
 * The storage keys come back with the verdict because the rows are gone by the
 * time cleanup runs; re-querying afterwards would find nothing.
 */
export async function getFileDeleteDecision(
  userId: string,
  fileId: string
): Promise<DeleteDecision | null> {
  const rows = await sql`
    SELECT v.portal_id       AS "portalId",
           f.uploaded_by     AS "uploadedBy",
           f.storage_key     AS "storageKey",
           f.converted_storage_key AS "convertedStorageKey",
           v.published_at    AS "publishedAt"
    FROM files f
    JOIN versions v ON v.id = f.version_id
    WHERE f.id = ${fileId}
  `;
  const row = rows[0];
  if (!row) return null;

  const access = await getPackageAccess(userId, row.portalId as string);
  if (!access) return null;

  return {
    allowed: canDeleteContent({
      role: access.role,
      isOwnUpload: row.uploadedBy === userId,
      isPublished: row.publishedAt !== null,
    }),
    portalId: row.portalId as string,
    storageKeys: [row.storageKey, row.convertedStorageKey].filter(
      (k): k is string => typeof k === 'string' && k.length > 0
    ),
  };
}

/**
 * May this user delete this whole version, and what does it strand in storage?
 *
 * isOwnUpload is always false — see the note on canDeleteContent. In practice
 * that restricts version deletion to owners and coordinators.
 */
export async function getVersionDeleteDecision(
  userId: string,
  versionId: string
): Promise<DeleteDecision | null> {
  const rows = await sql`
    SELECT portal_id AS "portalId", published_at AS "publishedAt"
    FROM versions WHERE id = ${versionId}
  `;
  const row = rows[0];
  if (!row) return null;

  const access = await getPackageAccess(userId, row.portalId as string);
  if (!access) return null;

  const fileRows = await sql`
    SELECT storage_key AS "storageKey",
           converted_storage_key AS "convertedStorageKey"
    FROM files WHERE version_id = ${versionId}
  `;

  return {
    allowed: canDeleteContent({
      role: access.role,
      isOwnUpload: false,
      isPublished: row.publishedAt !== null,
    }),
    portalId: row.portalId as string,
    storageKeys: fileRows
      .flatMap((f) => [f.storageKey, f.convertedStorageKey])
      .filter((k): k is string => typeof k === 'string' && k.length > 0),
  };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors. If it reports that `DeleteContext` is unused, drop it from the `export type` list — it is re-exported for callers, not required here.

- [ ] **Step 3: Confirm the existing suite still passes**

Run: `npm test`

Expected: all pass. These resolvers need a live database so they are not unit-tested; Task 9 verifies them by hand.

- [ ] **Step 4: Commit**

```bash
git add lib/access.ts
git commit -m "feat(access): resolve delete decisions for files and versions

Fetches role, upload ownership and publish state, then defers to
canDeleteContent. Returns the storage keys alongside the verdict because the
rows are gone by the time cleanup runs.

Missing and forbidden both return null: the caller must not be able to use an
id to confirm a file exists."
```

---

### Task 4: Best-effort R2 cleanup helper

**Files:**
- Modify: `lib/s3.ts`

**Interfaces:**
- Consumes: existing `deleteObject(storageKey: string): Promise<void>` in `lib/s3.ts`.
- Produces: `export async function deleteObjects(keys: (string | null | undefined)[]): Promise<void>`

- [ ] **Step 1: Add the helper**

Append to `lib/s3.ts`:

```ts
/**
 * Remove several stored objects, best effort.
 *
 * Deliberately never throws. Callers run this *after* the database rows are
 * gone, so by the time it fails the user's intent is already satisfied; turning
 * a storage hiccup into a failed request would tell them the delete did not
 * happen when it did. A failure here leaves an orphaned object: invisible,
 * slightly costly, harmless.
 *
 * The reverse order — storage first — would risk a file gone from R2 but still
 * listed in the UI, which reads to the user as corruption.
 */
export async function deleteObjects(
  keys: (string | null | undefined)[]
): Promise<void> {
  const present = keys.filter(
    (k): k is string => typeof k === 'string' && k.length > 0
  );
  await Promise.all(
    present.map(async (key) => {
      try {
        await deleteObject(key);
      } catch (err) {
        console.error(`[s3] orphaned object, delete failed: ${key}`, err);
      }
    })
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/s3.ts
git commit -m "feat(s3): add best-effort multi-object delete

Never throws: callers run it after the database rows are already gone, so a
storage failure must not report the delete as failed. Logs the orphan instead."
```

---

### Task 5: Authorize `/api/files/complete` and stamp `uploaded_by`

**Files:**
- Modify: `app/api/files/complete/route.ts`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth`, `getPackageAccess` from `@/lib/access`.
- Produces: `files.uploaded_by` populated on every new insert.

This route currently has **no session check**. It accepts `fileId`, `versionId`, `filename` and `storageKey` from the request body and inserts them, so anyone could register a file row against any version. Recording `uploaded_by` needs a session, so authorizing it is a prerequisite rather than extra scope.

- [ ] **Step 1: Rewrite the route**

Replace the entire contents of `app/api/files/complete/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';
import { optimizedVariantKey } from '@/lib/storageKeys';

// Step 2: After the client has uploaded to S3, register the file in the DB
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const {
    fileId, versionId, filename, storageKey, fileSize, fileType, folderPath,
    hasOptimizedVariant,
  } = await request.json();

  if (!versionId) {
    return NextResponse.json({ error: 'versionId required' }, { status: 400 });
  }

  // This route used to insert whatever it was handed, so any signed-out caller
  // could attach a file row to any version. A version id is an identifier, not
  // a capability — resolve it to a package and check the caller may upload there.
  const versionRows = await sql`
    SELECT portal_id AS "portalId" FROM versions WHERE id = ${versionId}
  `;
  if (!versionRows[0]) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const access = await getPackageAccess(session.user.id, versionRows[0].portalId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.canUpload) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Derived, never accepted from the caller — see the security note in this task.
  const convertedStorageKey = hasOptimizedVariant ? optimizedVariantKey(storageKey) : null;

  // conversion_status stays NULL here on purpose. 'completed' means a CloudConvert job
  // finished, and the STEP flow reads it that way; a client-optimized GLB is not that.
  // converted_storage_key is populated independently of the status column.
  //
  // uploaded_by comes from the session, never the body: it decides who may later
  // delete this file, so a caller must not be able to name someone else.
  const rows = await sql`
    INSERT INTO files (id, version_id, filename, storage_key, file_size, file_type, folder_path, converted_storage_key, uploaded_by)
    VALUES (${fileId}, ${versionId}, ${filename}, ${storageKey}, ${fileSize}, ${fileType}, ${folderPath || null}, ${convertedStorageKey}, ${session.user.id})
    RETURNING id, version_id AS "versionId", filename, storage_key AS "storageKey",
              file_size AS "fileSize", file_type AS "fileType",
              conversion_status AS "conversionStatus",
              converted_storage_key AS "convertedStorageKey",
              folder_path AS "folderPath",
              uploaded_by AS "uploadedBy",
              created_at AS "createdAt"
  `;

  return NextResponse.json(rows[0], { status: 201 });
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/files/complete/route.ts
git commit -m "fix(files): authorize the upload-completion route

It had no session check: it inserted whatever fileId, versionId and storageKey
it was handed, so any caller could attach a file row to any version.

Now requires a session and canUpload on the version's package, and stamps
uploaded_by from the session rather than the body — that field decides who may
later delete the file."
```

---

### Task 6: `DELETE /api/files/[id]`, and authorize its GET

**Files:**
- Modify: `app/api/files/[id]/route.ts`

**Interfaces:**
- Consumes: `getFileDeleteDecision` (Task 3), `deleteObjects` (Task 4), `getFileAccess` from `@/lib/access`.
- Produces: `DELETE /api/files/:id` → `200 {success:true}` | `401` | `403` | `404`.

The existing GET has **no session check and no access check** — it returns any file's metadata, including its storage keys, to anyone who knows an id. It is the only read path in the app not going through `getPackageAccess`. It is fixed here because this task edits the same file.

- [ ] **Step 1: Rewrite the route**

Replace the entire contents of `app/api/files/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getFileAccess, getFileDeleteDecision } from '@/lib/access';
import { deleteObjects } from '@/lib/s3';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // This route previously answered with any file's row — storage keys included —
  // to anyone signed in who knew an id, without resolving the package at all.
  const access = await getFileAccess(session.user.id, params.id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = await sql`
    SELECT id, version_id AS "versionId", filename, storage_key AS "storageKey",
           file_size AS "fileSize", file_type AS "fileType",
           conversion_status AS "conversionStatus",
           converted_storage_key AS "convertedStorageKey",
           conversion_job_id AS "conversionJobId",
           folder_path AS "folderPath",
           uploaded_by AS "uploadedBy",
           created_at AS "createdAt"
    FROM files WHERE id = ${params.id}
  `;
  if (!rows[0]) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

/**
 * DELETE — remove one file.
 *
 * Owners and coordinators may remove any file; an uploader may remove their own
 * while the version is still a draft. Comments and markups on the file cascade,
 * which is exactly why the uploader's window closes at publication.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const decision = await getFileDeleteDecision(session.user.id, params.id);
  // Missing and invisible are the same answer on purpose.
  if (!decision) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!decision.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await sql`
    DELETE FROM files WHERE id = ${params.id} RETURNING id
  `;
  if (!result[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // After the row, never before: a storage failure now leaves a harmless orphan,
  // where the reverse order could leave a listed file whose bytes are gone.
  await deleteObjects(decision.storageKeys);

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/files/[id]/route.ts
git commit -m "feat(files): delete a single file, and authorize the GET

Adds DELETE gated on getFileDeleteDecision, removing the R2 objects after the
row so a storage failure orphans rather than corrupts.

The GET alongside it had no session or access check at all and returned any
file's row, storage keys included, to anyone with an id — the only read path
not going through getPackageAccess."
```

---

### Task 7: `DELETE /api/versions/[id]`

**Files:**
- Create: `app/api/versions/[id]/route.ts`

**Interfaces:**
- Consumes: `getVersionDeleteDecision` (Task 3), `deleteObjects` (Task 4).
- Produces: `DELETE /api/versions/:id` → `200 {success:true}` | `401` | `403` | `404`.

The directory already exists holding `changelog-draft/` and `summary/`; it has no `route.ts` of its own.

- [ ] **Step 1: Create the route**

Create `app/api/versions/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getVersionDeleteDecision } from '@/lib/access';
import { deleteObjects } from '@/lib/s3';

/**
 * DELETE — remove a whole version.
 *
 * Owners and coordinators only. Files, comments, markups, verdicts, views and
 * the AI summary all cascade from the version row.
 *
 * The version number is not reused and the gap is not closed. Numbers appear in
 * comments, notifications, verdicts and already-sent emails; renumbering would
 * silently repoint every one of those at different content.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const decision = await getVersionDeleteDecision(session.user.id, params.id);
  if (!decision) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!decision.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await sql`
    DELETE FROM versions WHERE id = ${params.id} RETURNING id
  `;
  if (!result[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await deleteObjects(decision.storageKeys);

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/versions/[id]/route.ts
git commit -m "feat(versions): delete a whole version

Owners and coordinators only — a version can hold several uploaders' files, so
letting one of them delete the container would let them delete the others' work.

Version numbers are not reused: they appear in comments, notifications and sent
emails, so closing the gap would repoint those at different content."
```

---

### Task 8: Send `canDelete` and version counts to the client

**Files:**
- Modify: `app/api/files/route.ts:29-40`
- Modify: `app/api/versions/route.ts:25-45`

**Interfaces:**
- Consumes: `canDeleteContent` (Task 2), `getPackageAccess` (already imported in both routes).
- Produces:
  - `GET /api/files?versionId=` rows gain `uploadedBy: string | null` and `canDelete: boolean`.
  - `GET /api/versions?portalId=` rows gain `canDelete: boolean`, `fileCount: number`, `commentCount: number`.

The UI must never re-derive the rule — a hidden button and a 403 disagreeing is the failure this prevents.

- [ ] **Step 1: Stamp `canDelete` onto the files payload**

In `app/api/files/route.ts`, add `canDeleteContent` to the access import:

```ts
import { canDeleteContent, getPackageAccess } from '@/lib/access';
```

Add `uploaded_by AS "uploadedBy",` to the SELECT list (after `folder_path AS "folderPath",`), then replace the final `return NextResponse.json(rows);` with:

```ts
  // Whether the version is published decides an uploader's reach, so it is
  // fetched once here rather than per row.
  const publishedRows = await sql`
    SELECT published_at AS "publishedAt" FROM versions WHERE id = ${versionId}
  `;
  const isPublished = publishedRows[0]?.publishedAt !== null;

  // Computed server-side and sent down, never re-derived in the client: a
  // hidden button and a 403 must not be able to disagree.
  return NextResponse.json(
    rows.map((row) => ({
      ...row,
      canDelete: canDeleteContent({
        role: access.role,
        isOwnUpload: row.uploadedBy === session.user!.id,
        isPublished,
      }),
    }))
  );
```

- [ ] **Step 2: Stamp `canDelete` and counts onto the versions payload**

In `app/api/versions/route.ts`, add `canDeleteContent` to the access import:

```ts
import { canDeleteContent, getPackageAccess } from '@/lib/access';
```

Replace the final `return NextResponse.json(rows);` in the GET handler with:

```ts
  // Counts come back with the rows so the delete confirm can state what dies
  // without a second round trip. Only versions the caller can delete need them.
  const counts = await sql`
    SELECT v.id,
           COUNT(DISTINCT f.id) AS "fileCount",
           COUNT(DISTINCT c.id) AS "commentCount"
    FROM versions v
    LEFT JOIN files f ON f.version_id = v.id
    LEFT JOIN comments c ON c.file_id = f.id
    WHERE v.portal_id = ${portalId}
    GROUP BY v.id
  `;
  const countsById = new Map(
    counts.map((c) => [
      c.id as string,
      { fileCount: Number(c.fileCount), commentCount: Number(c.commentCount) },
    ])
  );

  return NextResponse.json(
    rows.map((row) => ({
      ...row,
      canDelete: canDeleteContent({
        role: access.role,
        isOwnUpload: false,
        isPublished: row.publishedAt !== null,
      }),
      fileCount: countsById.get(row.id as string)?.fileCount ?? 0,
      commentCount: countsById.get(row.id as string)?.commentCount ?? 0,
    }))
  );
```

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors. If `session.user!.id` trips a lint rule, hoist `const userId = session.user.id;` above the query and use that instead.

- [ ] **Step 4: Confirm the suite still passes**

Run: `npm test`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/files/route.ts app/api/versions/route.ts
git commit -m "feat(api): tell the client what it may delete

canDelete is computed server-side per file and per version. The client never
re-derives the rule, so a hidden button and a 403 cannot disagree.

Versions also carry file and comment counts so the delete confirm can state
what dies without a second round trip."
```

---

### Task 9: Verify the API by hand against a real database

**Files:** none — verification only.

**Interfaces:**
- Consumes: every task above.
- Produces: confidence that cascades, storage cleanup and the 403/404 split behave as specified.

The resolvers and routes need a live database and bucket, so this is the only place they are exercised. Nothing here is automated.

- [ ] **Step 1: Start the app**

Run: `set -a && . .env.local && set +a && npm run dev`

Expected: server listening on `http://localhost:3000`.

- [ ] **Step 2: Confirm the unauthorized GET is closed**

In a second terminal, with no session cookie:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/files/any-id-at-all
```

Expected: `401`. Before Task 6 this returned file JSON.

- [ ] **Step 3: Delete a draft file as its uploader**

In the browser, signed in as a non-owner with the `uploader` role on a package: create a new version, upload two files, and delete one from the sidebar without publishing.

Expected: the row disappears, the other file remains, and the version is still a draft.

- [ ] **Step 4: Confirm the uploader loses that power at publish**

Publish the version, then reload and look at the remaining file.

Expected: no delete control on it. Confirm the server agrees rather than just the UI:

```bash
curl -s -X DELETE -b "<paste the uploader's session cookie>" \
  -w '\n%{http_code}\n' http://localhost:3000/api/files/<published-file-id>
```

Expected: `403`.

- [ ] **Step 5: Delete a published version as the owner and confirm the cascade**

Sign in as the project owner, comment on a file in a published version, then delete that whole version from the sidebar.

Expected: the confirm names the file and comment counts, the version vanishes from the rail, and the remaining version numbers are unchanged — a deleted V2 leaves V1 and V3.

Confirm nothing survived:

```bash
set -a && . .env.local && set +a && node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const v = '<deleted-version-id>';
Promise.all([
  sql\`SELECT COUNT(*) AS n FROM versions WHERE id = \${v}\`,
  sql\`SELECT COUNT(*) AS n FROM files WHERE version_id = \${v}\`,
]).then(([a, b]) => console.log({ versions: a[0].n, files: b[0].n }));
"
```

Expected: `{ versions: '0', files: '0' }`.

- [ ] **Step 6: Confirm the next version number does not reuse the gap**

Submit a new version in that package.

Expected: it takes `MAX + 1`, not the deleted number.

- [ ] **Step 7: Confirm the R2 objects are gone**

Using the storage keys noted before deleting, check the bucket in the R2 console or with the AWS CLI.

Expected: both the original and any converted variant are absent. If they remain, check the dev server log for `[s3] orphaned object` lines — the delete is still correct, but the cleanup failed and needs investigating.

- [ ] **Step 8: Confirm a commenter cannot delete**

Signed in as a commenter on the package:

```bash
curl -s -X DELETE -b "<the commenter's session cookie>" \
  -w '\n%{http_code}\n' http://localhost:3000/api/files/<any-visible-file-id>
```

Expected: `403`.

Then against a file in a package they are *not* on:

```bash
curl -s -X DELETE -b "<the commenter's session cookie>" \
  -w '\n%{http_code}\n' http://localhost:3000/api/files/<file-in-another-package>
```

Expected: `404`, not `403`. A `403` here would confirm the file exists.

- [ ] **Step 9: Record the results**

No commit. Note any step that failed and stop — do not proceed to the UI tasks on a broken API.

---

### Task 10: Delete controls in the sidebar

**Files:**
- Modify: `lib/types.ts:31-45` (`FileRecord`)
- Modify: `components/portal/FileTreeSidebar.tsx:7-42` (types), `:175-199` (`FileItem`), `:265-320` (version row)

**Interfaces:**
- Consumes: `canDelete` on files and versions from Task 8.
- Produces: two new optional props on `FileTreeSidebarProps`:
  - `onDeleteFile?: (file: FileRecord) => void`
  - `onDeleteVersion?: (version: Version) => void`

**Watch out — these shapes are declared more than once.** `FileRecord` exists both as the exported one in `lib/types.ts` (what `app/portal/[id]/page.tsx` imports) and as a structural duplicate local to `FileTreeSidebar.tsx`. `Version` is declared locally in *both* `app/portal/[id]/page.tsx:46` and `FileTreeSidebar.tsx:7`, with no shared definition anywhere. Nothing keeps them in sync, so a field added to one and not the others compiles fine and silently arrives `undefined` — which for `canDelete` means the control never renders and the feature looks broken with no error. Update every copy listed here and in Task 11.

Consolidating these into `lib/types.ts` would remove the hazard, but it touches every consumer and is left out of this plan deliberately.

`FileItem` is currently a single `<button>` wrapping the whole row. A delete control cannot nest inside it — nested buttons are invalid HTML and the two click targets fight. The row becomes a `<div>` holding the select button and the delete button as siblings.

- [ ] **Step 1: Extend the types**

In `lib/types.ts`, add to the exported `interface FileRecord` (before the closing brace):

```ts
  uploadedBy: string | null;
  /** Server's verdict on whether this caller may delete it. Never re-derived client-side. */
  canDelete?: boolean;
```

In `components/portal/FileTreeSidebar.tsx`, add the same two fields to its local `interface FileRecord`, and add to its local `interface Version`:

```ts
  publishedAt: string | null;
  canDelete?: boolean;
  fileCount?: number;
  commentCount?: number;
```

Add to `interface FileTreeSidebarProps`:

```ts
  /** Absent when the viewer may not delete anything — the row then renders no control. */
  onDeleteFile?: (file: FileRecord) => void;
  onDeleteVersion?: (version: Version) => void;
```

- [ ] **Step 2: Rebuild `FileItem` with a sibling delete control**

Replace `FileItem` (lines 175-199) entirely:

```tsx
function FileItem({
  file,
  isSelected,
  onSelect,
  onDelete,
}: {
  file: FileRecord;
  isSelected: boolean;
  onSelect: () => void;
  onDelete?: (file: FileRecord) => void;
}) {
  const chip = getFileChip(file.filename, file.fileType);
  // A div, not a button: the delete control is a sibling of the select control,
  // because a button inside a button is invalid and the two clicks would fight.
  return (
    <div className="group flex w-full items-center gap-2.5 py-1">
      <button
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <span className="text-[9px] font-extrabold px-[7px] py-[2px] rounded-full flex-shrink-0" style={{ background: chip.bg, color: chip.text }}>
          {chip.label}
        </span>
        <span className={`truncate text-[13px] ${isSelected ? 'font-semibold text-stiko-ink' : 'font-medium text-stiko-secondary group-hover:text-stiko-ink'}`}>
          {file.filename}
        </span>
      </button>

      {onDelete && file.canDelete && (
        <button
          onClick={() => onDelete(file)}
          aria-label={`Delete ${file.filename}`}
          title={`Delete ${file.filename}`}
          className="flex-shrink-0 rounded p-1 text-stiko-faint opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
    </div>
  );
}
```

The control stays invisible until the row is hovered or the button is focused, so the sidebar does not gain a column of trash icons — but it is reachable by keyboard, which `opacity-0` alone would not guarantee without the `focus:` variant.

- [ ] **Step 3: Pass `onDelete` down through both call sites**

In the default export, `FileItem` is rendered once directly and once inside `FolderItem`. Update the direct call (around line 310):

```tsx
                        {tree.rootFiles.map((file) => (
                          <FileItem key={file.id} file={file} isSelected={file.id === selectedFileId} onSelect={() => onSelectFile(file.id)} onDelete={onDeleteFile} />
                        ))}
                        {tree.folders.map((folder) => (
                          <FolderItem key={folder.path} folder={folder} selectedFileId={selectedFileId} onSelectFile={onSelectFile} onDeleteFile={onDeleteFile} />
                        ))}
```

Add `onDeleteFile` to `FolderItem`'s props and forward it to the `FileItem` it renders, matching the shape used above. Add `onDeleteFile` and `onDeleteVersion` to the destructured parameter list of the default export.

- [ ] **Step 4: Add the version delete control**

In the version row, the outer `<button>` has the same nesting problem. Wrap it in a `<div className="group relative">` and place the delete control as a sibling positioned over the row's right edge, before the chevron:

```tsx
              <div key={version.id}>
                <div className="group relative">
                  <button
                    onClick={() => onSelectVersion(version.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-[12px] text-left transition-colors ${isSelected ? 'bg-stiko-primary/20' : 'bg-stiko-primary/[0.08] hover:bg-stiko-primary/[0.14]'}`}
                  >
                    {/* ...existing contents unchanged... */}
                  </button>

                  {onDeleteVersion && version.canDelete && (
                    <button
                      onClick={() => onDeleteVersion(version)}
                      aria-label={`Delete version ${version.versionNumber}`}
                      title={`Delete version ${version.versionNumber}`}
                      className="absolute right-9 top-1/2 -translate-y-1/2 rounded p-1 text-stiko-faint opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
                {/* ...existing selected-files block unchanged... */}
              </div>
```

`right-9` clears the chevron, which sits at the row's right edge.

- [ ] **Step 5: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/portal/FileTreeSidebar.tsx
git commit -m "feat(portal): delete controls on files and versions

Both render only when the server said canDelete — the rule is never
re-derived here.

FileItem and the version row were single buttons wrapping the whole row, so
each becomes a container with the select and delete controls as siblings;
nesting them would be invalid HTML with two competing click targets."
```

---

### Task 11: Wire the confirms and the delete calls

**Files:**
- Modify: `app/portal/[id]/page.tsx` (state, handlers, `<FileTreeSidebar>` props around line 997, dialogs near the other modals)

**Interfaces:**
- Consumes: `onDeleteFile` / `onDeleteVersion` (Task 10), `DELETE /api/files/:id` (Task 6), `DELETE /api/versions/:id` (Task 7).
- Produces: nothing downstream.

Two different confirms, deliberately. `DestructiveConfirm` is **not** modified to make its typed name optional — its header states the typed name as a rule for every destructive confirm, and making it opt-out would turn that guarantee into a default.

- [ ] **Step 1: Add imports, extend `Version`, add state**

Add to the imports in `app/portal/[id]/page.tsx`:

```tsx
import { DestructiveConfirm } from '@/components/settings/DestructiveConfirm';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
```

Check each before adding — `Modal` and `Button` may already be imported. `useToast` is **not**: this page has no toast at present, unlike the settings page.

Extend the local `interface Version` at line 46 to match what Task 8 now sends, keeping it in step with the copy in `FileTreeSidebar.tsx`:

```tsx
interface Version {
  id: string;
  portalId: string;
  versionNumber: number;
  createdAt: string;
  publishedAt: string | null;
  canDelete?: boolean;
  fileCount?: number;
  commentCount?: number;
}
```

Add inside the component, alongside the other hooks near line 154:

```tsx
  const { toast } = useToast();

  // Two shapes of confirm, because the stakes differ. A published version
  // carries other people's comments; a file the uploader added a minute ago to
  // an unpublished version carries only their own mistake, and making them type
  // its name to undo it would train them to type past the serious dialog.
  const [fileToDelete, setFileToDelete] = useState<FileRecord | null>(null);
  const [versionToDelete, setVersionToDelete] = useState<Version | null>(null);
```

`FileRecord` is already imported from `@/lib/types` on line 22.

- [ ] **Step 2: Extract the versions fetch so it can be re-run**

The versions fetch is currently inline inside a `useEffect` at roughly lines 509-527, so nothing else can trigger a refresh. Deleting a version has to refresh it. Replace that whole `useEffect` with a `useCallback` plus a `useEffect` that calls it:

```tsx
  // Extracted from the effect below so deleting a version can re-run it.
  const loadVersions = useCallback(async () => {
    try {
      const res = await fetch(`/api/versions?portalId=${portalId}`);
      const data: Version[] = await res.json();
      setVersions(data);
      if (data.length > 0) {
        setSelectedVersionId((current) =>
          current && data.some((v) => v.id === current) ? current : data[0].id
        );
        setFilesLoading(true);
      }
    } catch (err) {
      console.error('Failed to fetch versions:', err);
    } finally {
      setLoading(false);
    }
  }, [portalId]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);
```

The selection is now preserved when it survives the refetch, rather than always snapping to the newest version. Without that, deleting any version would yank the user back to the top of the rail.

`useCallback` is already imported in this file.

- [ ] **Step 3: Add the delete handlers**

Add near the other handlers:

```tsx
  const confirmDeleteFile = async () => {
    if (!fileToDelete) return;
    const target = fileToDelete;
    setFileToDelete(null);

    const res = await fetch(`/api/files/${target.id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast('Could not delete this file');
      return;
    }

    // Selection has to move before the refetch, or the viewer keeps rendering a
    // file that no longer exists.
    if (selectedFileId === target.id) setSelectedFileId(null);
    toast('File deleted');
    if (selectedVersionId) fetchFiles(selectedVersionId);
  };

  const confirmDeleteVersion = async () => {
    if (!versionToDelete) return;
    const target = versionToDelete;
    setVersionToDelete(null);

    const res = await fetch(`/api/versions/${target.id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast('Could not delete this version');
      return;
    }

    toast(`Version ${target.versionNumber} deleted`);
    if (selectedVersionId === target.id) {
      setSelectedVersionId(null);
      setSelectedFileId(null);
    }
    await loadVersions();
  };
```

- [ ] **Step 4: Pass the handlers to the sidebar**

Update the `<FileTreeSidebar>` call around line 997 to add:

```tsx
          onDeleteFile={setFileToDelete}
          onDeleteVersion={setVersionToDelete}
```

- [ ] **Step 5: Render the two confirms**

Add near the other modals in the returned JSX:

```tsx
      {/* An uploader clearing their own unpublished file. Nothing is published
          and nobody has commented, so a plain confirm is the honest weight. */}
      <Modal
        isOpen={Boolean(fileToDelete)}
        onClose={() => setFileToDelete(null)}
        title="Delete this file?"
        subtitle={fileToDelete?.filename}
        width={420}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFileToDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDeleteFile}>Delete file</Button>
          </>
        }
      >
        <p className="text-[13px] text-stiko-secondary">
          This removes the file and anything attached to it. It cannot be undone.
        </p>
      </Modal>

      {/* A whole version, with other people's review work on it. Full weight:
          typed name and a count of what dies. */}
      {versionToDelete && (
        <DestructiveConfirm
          isOpen
          onClose={() => setVersionToDelete(null)}
          onConfirm={confirmDeleteVersion}
          title={`Delete version ${versionToDelete.versionNumber}?`}
          name={`V${versionToDelete.versionNumber}`}
          consequence="This cannot be undone. Everyone loses this version and every comment on it, including people mid-review."
          inventory={[
            { label: 'Files', value: versionToDelete.fileCount ?? 0 },
            { label: 'Comments', value: versionToDelete.commentCount ?? 0, urgent: (versionToDelete.commentCount ?? 0) > 0 },
          ]}
          confirmLabel="Delete version"
        />
      )}
```

The typed name is `V2`, not the package name — it is what the rail shows, so it is what the user can actually read back.

- [ ] **Step 6: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors. If `Modal`'s prop names differ from the above, read `components/ui/Modal.tsx` and match it rather than changing Modal.

- [ ] **Step 7: Verify in the browser**

Run: `set -a && . .env.local && set +a && npm run dev`

As the project owner, on a package with at least two versions and a comment:

1. Hover a file row — a trash icon appears at its right.
2. Click it — the plain confirm names the file.
3. Confirm — the file goes, a toast appears, the viewer does not error.
4. Hover a version row — a trash icon appears left of the chevron.
5. Click it — the strict confirm shows real file and comment counts and keeps the button disabled until `V2` is typed.
6. Confirm — the version goes and the remaining numbers are unchanged.

Then sign in as a commenter on the same package and confirm no trash icons appear anywhere.

- [ ] **Step 8: Commit**

```bash
git add app/portal/[id]/page.tsx
git commit -m "feat(portal): wire file and version delete confirms

A version delete gets the strict typed-name confirm with live file and comment
counts; an uploader clearing their own unpublished file gets a plain one.
DestructiveConfirm is left strict rather than given an optional name, so its
guarantee stays a guarantee.

Selection is cleared before refetching so the viewer never renders a file that
is already gone."
```

---

### Task 12: Adopt `deleteObjects` in package and project deletion

**Files:**
- Modify: `app/api/portals/[id]/route.ts` (the `DELETE` handler)
- Modify: `app/api/projects/[id]/route.ts` (the `DELETE` handler)

**Interfaces:**
- Consumes: `deleteObjects` (Task 4).
- Produces: nothing downstream.

Both already hard-delete and rely on cascade, and neither has ever removed a stored object — `deleteObject` has been exported from `lib/s3.ts` since it was written and called from nowhere. Every package deleted so far has stranded its files in R2 permanently.

Objects already orphaned by past deletions stay orphaned. Finding them means reasoning from bucket contents rather than the database, which is its own task and out of scope here.

- [ ] **Step 1: Collect and clean up keys on package delete**

In `app/api/portals/[id]/route.ts`, add the import:

```ts
import { deleteObjects } from '@/lib/s3';
```

In the `DELETE` handler, gather the keys *before* the delete — afterwards the rows are gone — then clean up after:

```ts
  // Collected before the delete: the rows are gone afterwards, and cascade
  // takes the files with the package.
  const doomed = await sql`
    SELECT f.storage_key AS "storageKey",
           f.converted_storage_key AS "convertedStorageKey"
    FROM files f
    JOIN versions v ON v.id = f.version_id
    WHERE v.portal_id = ${params.id}
  `;

  // Versions, files, comments, markups and participants all cascade.
  const result = await sql`
    DELETE FROM portals WHERE id = ${params.id} RETURNING id
  `;
  if (!result[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Until now this left every file in the bucket forever.
  await deleteObjects(doomed.flatMap((f) => [f.storageKey, f.convertedStorageKey]));

  return NextResponse.json({ success: true });
```

- [ ] **Step 2: Do the same for project delete**

In `app/api/projects/[id]/route.ts`, add the same import, then in the `DELETE` handler:

```ts
  const doomed = await sql`
    SELECT f.storage_key AS "storageKey",
           f.converted_storage_key AS "convertedStorageKey"
    FROM files f
    JOIN versions v ON v.id = f.version_id
    JOIN portals po ON po.id = v.portal_id
    WHERE po.project_id = ${params.id}
  `;

  const result = await sql`
    DELETE FROM projects WHERE id = ${params.id} AND owner_id = ${session.user.id}
    RETURNING id
  `;
  if (!result[0]) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  await deleteObjects(doomed.flatMap((f) => [f.storageKey, f.convertedStorageKey]));

  return NextResponse.json({ success: true });
```

The key collection runs before the ownership check resolves, so a non-owner's failed delete does one extra harmless SELECT. Keeping the order simple is worth more than saving that query — and no objects are touched, because the delete returns no row and the function exits first.

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Confirm the suite still passes**

Run: `npm test`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/portals/[id]/route.ts app/api/projects/[id]/route.ts
git commit -m "fix(storage): actually delete files when a package or project goes

deleteObject has been exported from lib/s3.ts since it was written and called
from nowhere, so every package deleted so far left its files in the bucket
permanently. Keys are collected before the cascade and removed after."
```

---

### Task 13: Update the architecture notes

**Files:**
- Modify: `ARCHITECTURE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Read the current file and find the right sections**

Run: `grep -n "capabilities\|access\|role\|delete" ARCHITECTURE.md | head -30`

- [ ] **Step 2: Document the delete rules**

Add to the section covering roles and access — match the file's existing heading depth and prose style:

```markdown
### Deleting content

`canDeleteContent` in `lib/capabilities.ts` holds the rules; `getFileDeleteDecision`
and `getVersionDeleteDecision` in `lib/access.ts` gather the facts it needs.

- Owners and coordinators delete any file or version.
- An uploader deletes their own files until the version is published. After
  that, removal is the owner's call — deleting a file cascades to every comment
  and markup on it.
- Commenters and viewers never delete.

Deletion is permanent; there is no trash. Version numbers are never reassigned,
so a deleted version leaves a gap — the numbers appear in comments,
notifications and sent emails.

Storage objects are removed by `deleteObjects` in `lib/s3.ts` *after* the
database rows, so a storage failure orphans an object rather than leaving a
listed file whose bytes are gone.
```

- [ ] **Step 3: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: record the content deletion rules"
```

---

## Deployment

Order matters, and migrations here are applied manually.

1. Apply migration `005` to production: `set -a && . .env.local && set +a && npm run migrate`
2. Confirm it registered: `SELECT * FROM schema_migrations ORDER BY applied_at DESC LIMIT 3;`
3. Deploy the code.

Reversed, `uploaded_by` does not exist, every read of it errors, and the upload-completion route — which now writes that column — fails outright. That breaks uploading, not just deleting.

**Rollback:** revert the deploy. The migration can stay; the column is additive and nothing outside this feature reads it.

There is no staging environment, so exercise Task 9 and Task 11 Step 6 against a local database pointed at a scratch project before deploying.

## Spec coverage

| Spec section | Task |
|---|---|
| `files.uploaded_by` + backfill | 1 |
| Authorize `/api/files/complete` | 5 |
| `canDeleteContent` predicate | 2 |
| Delete decision resolvers | 3 |
| `DELETE /api/files/[id]` | 6 |
| Authorize the GET on `files/[id]` | 6 |
| `DELETE /api/versions/[id]` | 7 |
| Response contract (401/403/404) | 6, 7, verified in 9 |
| `deleteObjects` helper, DB-first ordering | 4 |
| Existing R2 leak on package/project delete | 12 |
| Version numbering never shifts | 7, verified in 9 |
| `canDelete` sent from the server | 8 |
| `fileCount` / `commentCount` for the confirm | 8 |
| Sidebar affordances | 10 |
| Two confirms, `DestructiveConfirm` left strict | 11 |
| Predicate unit tests | 2 |
| Manual DB and storage verification | 9 |

## Out of scope

Undo or trash. Sweeping objects orphaned by past deletions. Bulk delete. Download authorization and per-version invite scoping — specs 2 and 3.
