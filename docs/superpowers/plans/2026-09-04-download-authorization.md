# Download Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let owners and coordinators download any file, uploaders always download their own uploads, and everyone else download only if the owner granted it per person.

**Architecture:** A pure predicate in `lib/capabilities.ts` holds the rule and is unit-tested without a database. `getPackageAccess` gains a `mayDownload` field, and a resolver in `lib/access.ts` combines it with file ownership. A dedicated download route serves the **original** object with a `Content-Disposition: attachment` header. The server stamps `canDownload` onto the files payload so the UI never re-derives the rule.

**Tech Stack:** Next.js 14 App Router, TypeScript, Neon serverless Postgres, NextAuth v5, S3-compatible R2 via `@aws-sdk/client-s3`, `node:test`, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-04-download-authorization-design.md`

## Global Constraints

- A package is a permission boundary. Every route resolving an id goes through `getPackageAccess` / `getFileAccess` before answering. An id is an identifier, never a capability.
- "No access" and "does not exist" both return **404**, indistinguishably. **403** is only for a caller who can see the package but lacks this specific power.
- The server computes `canDownload`; the client never re-derives it. A hidden control and a 403 must not be able to disagree.
- A download serves `files.storage_key` — the original — never `converted_storage_key`.
- Share links and public link-access **never** grant download. The server forces the flag to false rather than relying on the UI to omit it.
- SQL uses the tagged-template `sql` client from `@/lib/db`, interpolating as `${value}`. Never string-concatenate into a query.
- Migrations are re-runnable (`ADD COLUMN IF NOT EXISTS`) and are mirrored back into `lib/schema.sql`, which documents that convention.
- Comment style explains *why*, not *what*. Do not add comments restating the code.
- UI copy says "package", never "portal". Code identifiers say `portal`.
- Full suite: `npm test` (`node --test scripts/tests/*.mjs`). It is at **320 passing** before this work.
- Do NOT apply migrations. The operator does that separately.

---

### Task 1: Add the `can_download` columns

**Files:**
- Create: `lib/migrations/007-download-authorization.sql`
- Modify: `lib/schema.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `participants.can_download BOOLEAN NOT NULL DEFAULT FALSE`, `invite_tokens.can_download BOOLEAN NOT NULL DEFAULT FALSE`.

- [ ] **Step 1: Write the migration**

Create `lib/migrations/007-download-authorization.sql`:

```sql
-- Whether this person may download files from the package, decided by the
-- owner when inviting them and changeable afterwards.
--
-- Default FALSE takes nothing away: there is no download feature before this,
-- so no existing participant loses an ability they had.
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS can_download BOOLEAN NOT NULL DEFAULT FALSE;

-- The same flag on the invitation, because the owner decides when inviting and
-- acceptance may happen days later.
ALTER TABLE invite_tokens
  ADD COLUMN IF NOT EXISTS can_download BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 2: Mirror both into `lib/schema.sql`**

That file states its own convention that migrations are folded back in, and 005 and 006 both were. Add to the `participants` table definition, after `role`:

```sql
  can_download BOOLEAN NOT NULL DEFAULT FALSE,
```

Add the same line to the `invite_tokens` table definition, after `role`.

Do NOT delete the migration — an existing database still needs it.

- [ ] **Step 3: Verify nothing else changed**

Run: `git diff --stat`

Expected: only `lib/schema.sql` modified and `lib/migrations/007-download-authorization.sql` created.

- [ ] **Step 4: Commit**

```bash
git add lib/migrations/007-download-authorization.sql lib/schema.sql
git commit -m "feat(db): record who may download from a package

Defaults to false on both the participant and the invitation, which takes
nothing away — there is no download feature before this."
```

---

### Task 2: `canDownloadFile` predicate

**Files:**
- Modify: `lib/capabilities.ts`
- Test: `scripts/tests/access.test.mjs`

**Interfaces:**
- Consumes: `EffectiveRole` from `lib/capabilities.ts`.
- Produces:
  - `export interface DownloadContext { role: EffectiveRole; isOwnUpload: boolean; mayDownload: boolean }`
  - `export function canDownloadFile(ctx: DownloadContext): boolean`

- [ ] **Step 1: Write the failing tests**

Append `canDownloadFile` to the existing import at the top of `scripts/tests/access.test.mjs`, then append:

```js
// Download rules — docs/superpowers/specs/2026-09-04-download-authorization-design.md.
// Kept as an explicit matrix rather than derived from any role table: download
// is not a property of the role alone, it is role plus a per-person grant plus
// whether you supplied the file yourself.

test('owner and coordinator download anything, granted or not', () => {
  for (const role of ['owner', 'coordinator']) {
    for (const isOwnUpload of [true, false]) {
      for (const mayDownload of [true, false]) {
        assert.equal(
          canDownloadFile({ role, isOwnUpload, mayDownload }),
          true,
          `${role} own=${isOwnUpload} granted=${mayDownload}`
        );
      }
    }
  }
});

test('an uploader always gets their own upload back, grant or no grant', () => {
  // They supplied the file; it is already on their machine. Requiring the
  // owner's permission to retrieve it is a rule nobody would expect.
  assert.equal(
    canDownloadFile({ role: 'uploader', isOwnUpload: true, mayDownload: false }),
    true
  );
});

test("an uploader needs the grant for someone else's file", () => {
  assert.equal(
    canDownloadFile({ role: 'uploader', isOwnUpload: false, mayDownload: false }),
    false
  );
  assert.equal(
    canDownloadFile({ role: 'uploader', isOwnUpload: false, mayDownload: true }),
    true
  );
});

test('commenters and viewers download only with the grant', () => {
  for (const role of ['commenter', 'viewer']) {
    assert.equal(
      canDownloadFile({ role, isOwnUpload: false, mayDownload: false }),
      false,
      `${role} without the grant`
    );
    assert.equal(
      canDownloadFile({ role, isOwnUpload: false, mayDownload: true }),
      true,
      `${role} with the grant`
    );
  }
});

test('an unrecognised role cannot download', () => {
  // Same fail-closed guarantee capabilitiesFor and canDeleteContent make.
  assert.equal(
    canDownloadFile({ role: 'reviewer', isOwnUpload: true, mayDownload: true }),
    false
  );
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test 2>&1 | grep -c "canDownloadFile is not a function"`

Expected: a non-zero count, or the whole file failing to load — either way, failing because the function does not exist yet.

- [ ] **Step 3: Implement the predicate**

Append to `lib/capabilities.ts`:

```ts
export interface DownloadContext {
  role: EffectiveRole;
  /** The caller uploaded this file. */
  isOwnUpload: boolean;
  /** The owner granted this person download on this package. */
  mayDownload: boolean;
}

/**
 * Who may take a copy of a file away.
 *
 * Not derivable from the role alone: two commenters on the same package can
 * differ, because the grant is made per person when they are invited.
 *
 * An uploader's own file is exempt from the grant — they supplied it, so
 * needing permission to retrieve it would be a rule nobody would expect.
 *
 * Note this gates the control and the endpoint, not the bytes: viewing a file
 * already hands the browser a presigned URL to it. See the spec's "What this
 * can and cannot enforce".
 */
export function canDownloadFile(ctx: DownloadContext): boolean {
  switch (ctx.role) {
    case 'owner':
    case 'coordinator':
      return true;
    case 'uploader':
      return ctx.isOwnUpload || ctx.mayDownload;
    case 'commenter':
    case 'viewer':
      return ctx.mayDownload;
    default: {
      // Same two guarantees as capabilitiesFor: a role added to EffectiveRole
      // without a case here fails to typecheck, and one arriving through an
      // unchecked cast is denied rather than falling through.
      const unhandled: never = ctx.role;
      void unhandled;
      return false;
    }
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`

Expected: 325 passing (320 existing plus the 5 new), 0 failing.

- [ ] **Step 5: Commit**

```bash
git add lib/capabilities.ts scripts/tests/access.test.mjs
git commit -m "feat(access): add canDownloadFile predicate

Download is role plus a per-person grant plus whether you supplied the file,
so it lives beside canDeleteContent as a context predicate rather than in the
role table. Pure, so it is asserted without a database."
```

---

### Task 3: `mayDownload` on access, and the download resolver

**Files:**
- Modify: `lib/access.ts`

**Interfaces:**
- Consumes: `canDownloadFile`, `DownloadContext` from Task 2.
- Produces:
  - `Access` gains `mayDownload: boolean`
  - `export interface DownloadDecision { allowed: boolean; storageKey: string; filename: string }`
  - `export async function getFileDownloadDecision(userId: string, fileId: string): Promise<DownloadDecision | null>`

- [ ] **Step 1: Extend the imports and re-exports**

At the top of `lib/access.ts`, add `canDownloadFile` to the value import and re-export, and `DownloadContext` to the type import and re-export, alongside the existing `canDeleteContent` / `DeleteContext`.

- [ ] **Step 2: Add `mayDownload` to `Access` and populate it**

Add to the `Access` interface:

```ts
  /** Whether this person may take copies of files away. Always true for members. */
  mayDownload: boolean;
```

In `getPackageAccess`, the query already selects `pa.role AS "guestRole"`. Add the flag beside it:

```ts
      pa.role     AS "guestRole",
      pa.can_download AS "guestCanDownload"
```

Then set `mayDownload` on all three return paths. Owner and coordinator get `true`; the guest path reads the column:

```ts
  if (row.ownerId === userId) {
    return { role: 'owner', isProjectMember: true, mayDownload: true, ...capabilitiesFor('owner') };
  }

  if (row.memberRole === 'coordinator') {
    return { role: 'coordinator', isProjectMember: true, mayDownload: true, ...capabilitiesFor('coordinator') };
  }

  const guest = row.guestRole as PackageRole | null;
  if (!guest) return null;

  return {
    role: guest,
    isProjectMember: false,
    mayDownload: Boolean(row.guestCanDownload),
    ...capabilitiesFor(guest),
  };
```

- [ ] **Step 3: Add the resolver**

Append to `lib/access.ts`:

```ts
export interface DownloadDecision {
  allowed: boolean;
  /** The ORIGINAL object, never the viewer's optimized variant. */
  storageKey: string;
  filename: string;
}

/**
 * May this user take a copy of this file, and which object is the copy?
 *
 * Returns null when the file does not exist OR the caller cannot see its
 * package — the caller must not be able to tell those apart, or the id becomes
 * an existence oracle.
 *
 * The key returned is storage_key and never converted_storage_key: a download
 * is the file the uploader supplied, not the copy the viewer prefers.
 */
export async function getFileDownloadDecision(
  userId: string,
  fileId: string
): Promise<DownloadDecision | null> {
  const rows = await sql`
    SELECT v.portal_id     AS "portalId",
           f.uploaded_by   AS "uploadedBy",
           f.storage_key   AS "storageKey",
           f.filename      AS "filename"
    FROM files f
    JOIN versions v ON v.id = f.version_id
    WHERE f.id = ${fileId}
  `;
  const row = rows[0];
  if (!row) return null;

  const access = await getPackageAccess(userId, row.portalId as string);
  if (!access) return null;

  return {
    allowed: canDownloadFile({
      role: access.role,
      isOwnUpload: row.uploadedBy === userId,
      mayDownload: access.mayDownload,
    }),
    storageKey: row.storageKey as string,
    filename: row.filename as string,
  };
}
```

- [ ] **Step 4: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors. If it reports that some other construction of an `Access` object is now missing `mayDownload`, add it there too — `getPackageAccess` should be the only place, but check rather than assume.

- [ ] **Step 5: Confirm the suite still passes**

Run: `npm test`

Expected: 325 passing.

- [ ] **Step 6: Commit**

```bash
git add lib/access.ts
git commit -m "feat(access): resolve download decisions

getPackageAccess now reports whether a guest was granted download; members
always may. The resolver returns storage_key explicitly, so a download can
never hand back the viewer's optimized variant instead of the real file."
```

---

### Task 4: Make presigned URLs download rather than open

**Files:**
- Modify: `lib/s3.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getDownloadPresignedUrl(storageKey: string, expiresIn?: number, downloadFilename?: string): Promise<string>`

- [ ] **Step 1: Add the optional filename parameter**

In `lib/s3.ts`, replace `getDownloadPresignedUrl` with:

```ts
export async function getDownloadPresignedUrl(
  storageKey: string,
  expiresIn = 3600, // 1 hour
  downloadFilename?: string
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    // Without this the browser navigates to the object and renders it in place;
    // a PDF or image would open rather than save. Only set when a filename is
    // given, so the viewer's own presigned URLs are unaffected.
    ...(downloadFilename
      ? {
          ResponseContentDisposition: `attachment; filename="${downloadFilename.replace(/"/g, '')}"`,
        }
      : {}),
  });
  return getSignedUrl(s3, command, { expiresIn });
}
```

The quote-stripping matters: a filename containing `"` would otherwise terminate the header value early and corrupt it.

- [ ] **Step 2: Verify it typechecks and existing callers still work**

Run: `npx tsc --noEmit`

Expected: no errors. The third parameter is optional, so `app/api/files/url/route.ts`, `app/api/comments/route.ts` and `app/api/conversions/retry/route.ts` are unaffected.

- [ ] **Step 3: Confirm the suite still passes**

Run: `npm test`

Expected: 325 passing.

- [ ] **Step 4: Commit**

```bash
git add lib/s3.ts
git commit -m "feat(s3): let a presigned URL ask the browser to save

Optional, so the viewer's URLs keep opening in place as before."
```

---

### Task 5: `GET /api/files/[id]/download`

**Files:**
- Create: `app/api/files/[id]/download/route.ts`

**Interfaces:**
- Consumes: `getFileDownloadDecision` (Task 3), `getDownloadPresignedUrl` (Task 4).
- Produces: `GET /api/files/:id/download` → `200 { url }` | `401` | `403` | `404`.

- [ ] **Step 1: Create the route**

Create `app/api/files/[id]/download/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getFileDownloadDecision } from '@/lib/access';
import { getDownloadPresignedUrl } from '@/lib/s3';

/**
 * Hand back a URL that saves the original file.
 *
 * Separate from /api/files/url, which is the viewer's render path and serves
 * the optimized variant when one exists. A download is the file as uploaded.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const decision = await getFileDownloadDecision(session.user.id, params.id);
  // Missing and invisible are the same answer on purpose.
  if (!decision) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!decision.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = await getDownloadPresignedUrl(
    decision.storageKey,
    3600,
    decision.filename
  );
  return NextResponse.json({ url });
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/api/files/[id]/download/route.ts"
git commit -m "feat(files): add a gated download endpoint

Serves the original object, not the viewer's variant, and answers 404 for a
missing file and an invisible one alike."
```

---

### Task 6: Send `canDownload` with the files payload

**Files:**
- Modify: `app/api/files/route.ts`

**Interfaces:**
- Consumes: `canDownloadFile` (Task 2) via `@/lib/access`.
- Produces: `GET /api/files?versionId=` rows gain `canDownload: boolean`.

- [ ] **Step 1: Stamp the flag**

Add `canDownloadFile` to the existing `@/lib/access` import in `app/api/files/route.ts`.

The GET handler already maps rows to add `canDelete` and a `transform` object, and already has `access` and `userId` in scope. Add one more field inside that same map, beside `canDelete`:

```ts
      canDownload: canDownloadFile({
        role: access.role,
        isOwnUpload: file.uploadedBy === userId,
        mayDownload: access.mayDownload,
      }),
```

Do not add a second pass over the rows, and do not disturb the existing `canDelete` computation or the `transform` construction.

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Confirm the suite still passes**

Run: `npm test`

Expected: 325 passing.

- [ ] **Step 4: Commit**

```bash
git add app/api/files/route.ts
git commit -m "feat(api): tell the client which files it may download

Computed server-side from the same predicate the endpoint uses, so a hidden
control and a 403 cannot disagree."
```

---

### Task 7: Carry the grant through the invitation

**Files:**
- Modify: `app/api/participants/route.ts` (the POST handler)
- Modify: `app/api/invite/[token]/route.ts` (the POST handler)

**Interfaces:**
- Consumes: the `invite_tokens.can_download` column (Task 1).
- Produces: `POST /api/participants` accepts an optional `canDownload` boolean; acceptance copies it onto the participant row.

- [ ] **Step 1: Accept and store the flag when inviting**

In `app/api/participants/route.ts`'s POST handler, add `canDownload` to the destructured body:

```ts
  const { portalId, email, role, note, shareLink, canDownload } = await request.json();
```

After the existing `isShareLink` / `recipient` derivation, add:

```ts
  // A share link never carries download rights, whatever the body asked for.
  // Enforced here rather than by omitting the control, because a link can be
  // forwarded to anyone and the UI is not what protects this.
  const grantsDownload = isShareLink ? false : canDownload === true;
```

Then add the column to the INSERT — extend both the column list and the values list:

```ts
  const rows = await sql`
    INSERT INTO invite_tokens
      (id, token, portal_id, role, email, multi_use, expires_at, invited_by, note, can_download)
    VALUES (
      ${uuidv4()}, ${token}, ${portalId}, ${role}, ${recipient}, ${isShareLink},
      ${expiresAt.toISOString()}, ${session.user.id}, ${note ?? null}, ${grantsDownload}
    )
    RETURNING token
  `;
```

Note `canDownload === true` rather than `Boolean(canDownload)`: a truthy string like `"false"` arriving from a form must not grant the right.

- [ ] **Step 2: Copy the flag on acceptance**

In `app/api/invite/[token]/route.ts`'s POST handler, the participant insert currently reads:

```ts
  const joined = await sql`
    INSERT INTO participants (id, portal_id, user_id, role)
    VALUES (${uuidv4()}, ${invite.portal_id}, ${session.user.id}, ${invite.role})
    ON CONFLICT (portal_id, user_id) DO NOTHING
    RETURNING id
  `;
```

Change it to carry the grant through:

```ts
  const joined = await sql`
    INSERT INTO participants (id, portal_id, user_id, role, can_download)
    VALUES (${uuidv4()}, ${invite.portal_id}, ${session.user.id}, ${invite.role},
            ${invite.can_download === true})
    ON CONFLICT (portal_id, user_id) DO NOTHING
    RETURNING id
  `;
```

`ON CONFLICT DO NOTHING` is deliberately left alone: someone re-walking a share link they are already on must not have their existing grant overwritten by the link's.

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Confirm the suite still passes**

Run: `npm test`

Expected: 325 passing.

- [ ] **Step 5: Commit**

```bash
git add app/api/participants/route.ts "app/api/invite/[token]/route.ts"
git commit -m "feat(invites): carry a download grant from invitation to participant

A share link is forced to no-download server-side rather than by leaving the
control out of the UI: a link can be forwarded, so the UI is not what
protects this."
```

---

### Task 8: Change the grant after the invitation

**Files:**
- Create: `app/api/participants/download/route.ts`

**Interfaces:**
- Consumes: `getPackageAccess` from `@/lib/access`.
- Produces: `POST /api/participants/download` taking `{ userId, portalId, canDownload }`.

**Read `app/api/participants/role/route.ts` first.** This route is its sibling and must follow the same shape, including the detail that `userId` may be either a user id or an email address.

- [ ] **Step 1: Create the route**

Create `app/api/participants/download/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';

/**
 * Grant or withdraw download on one package, after the invitation went out.
 *
 * `userId` may be a user id (an accepted guest) or an email (a pending
 * invitation), which is what the people matrix keys its rows on — the same
 * split /api/participants/role handles. A pending invitation has no
 * participants row at all, so the grant is written to the token instead and is
 * already correct whenever they accept.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { userId, portalId, canDownload } = await request.json();

  if (!userId || !portalId) {
    return NextResponse.json(
      { error: 'userId and portalId are required' },
      { status: 400 }
    );
  }
  if (typeof canDownload !== 'boolean') {
    return NextResponse.json(
      { error: 'canDownload must be a boolean' },
      { status: 400 }
    );
  }

  const access = await getPackageAccess(session.user.id, portalId);
  if (!access?.canManagePeople) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isEmail = String(userId).includes('@');

  if (isEmail) {
    await sql`
      UPDATE invite_tokens SET can_download = ${canDownload}
      WHERE portal_id = ${portalId} AND email = ${userId}
        AND used_at IS NULL AND revoked_at IS NULL
    `;
  } else {
    await sql`
      UPDATE participants SET can_download = ${canDownload}
      WHERE portal_id = ${portalId} AND user_id = ${userId}
    `;
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/participants/download/route.ts
git commit -m "feat(participants): change a download grant after inviting

Keyed the same way as the role route, so it reaches a pending invitation as
well as an accepted guest."
```

---

### Task 9: Report the grant in the people list

**Files:**
- Modify: `app/api/participants/route.ts` (the GET handler)
- Modify: `app/api/invites/route.ts` (the GET handler, if it has one)

**Interfaces:**
- Consumes: the columns from Task 1.
- Produces: participant rows gain `canDownload: boolean`; pending invite rows gain `canDownload: boolean`.

The People panel cannot show a toggle without knowing its current state.

- [ ] **Step 1: Add the column to the participants GET**

In `app/api/participants/route.ts`'s GET handler, add to the SELECT list:

```sql
           p.can_download AS "canDownload",
```

Place it beside `p.role` so the shape reads in the same order the UI uses.

- [ ] **Step 2: Add it to the pending-invites listing**

`app/api/invites/route.ts` has a GET that supplies the People panel's `pending`
array. Add to its SELECT list:

```sql
           can_download AS "canDownload",
```

Place it beside `role`, matching the order the panel renders.

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/participants/route.ts app/api/invites/route.ts
git commit -m "feat(api): report each person's download grant

The People panel cannot render a toggle without its current state."
```

---

### Task 10: The invite-time checkbox

**Files:**
- Modify: `components/portal/ShareModal.tsx`
- Modify: `components/people/AddPeopleModal.tsx`

**Interfaces:**
- Consumes: `POST /api/participants` accepting `canDownload` (Task 7).
- Produces: nothing downstream.

- [ ] **Step 1: Add the checkbox to `ShareModal`**

Add state beside the existing `inviteRole`:

```tsx
  const [inviteCanDownload, setInviteCanDownload] = useState(false);
```

Reset it in the existing `useEffect` that clears the form on close, alongside `setEmail('')`.

Pass it through `createInvite`. Change that function's signature to take the flag and include it in the body:

```tsx
  const createInvite = async (
    emailValue: string,
    role: Role,
    canDownload = false
  ): Promise<{ link: string; emailDelivered: boolean } | null> => {
```

and in the `JSON.stringify` body add `canDownload`. Update the call in `handleInvite` to pass `inviteCanDownload`; leave the share-link call passing nothing, so it defaults to false.

Render the checkbox **only on the email-invite path**, below the role selector:

```tsx
        <label className="mt-2 flex items-center gap-2 text-[12.5px] font-semibold text-stiko-secondary">
          <input
            type="checkbox"
            checked={inviteCanDownload}
            onChange={(e) => setInviteCanDownload(e.target.checked)}
            className="h-[15px] w-[15px] accent-stiko-primary"
          />
          Can download files
        </label>
```

Do **not** render it on the share-link path, and do not render it disabled there. A share link never carries the grant, and absence states that where a greyed-out box would invite the question.

- [ ] **Step 2: Add the checkbox to `AddPeopleModal`**

That modal holds `selection` as `Record<string, Role>` — a role per chosen package. Widen it to carry the flag:

```tsx
  type PackageGrant = { role: Role; canDownload: boolean };
  const [selection, setSelection] = useState<Record<string, PackageGrant>>(
    singlePackage
      ? { [packages[0]?.id ?? '']: { role: 'commenter', canDownload: false } }
      : {}
  );
```

Update `toggle` to insert `{ role: 'commenter', canDownload: false }`, the role `<select>` to read `selection[pkg.id].role` and write `{ ...prev[pkg.id], role: ... }`, and the send loop to destructure `{ role, canDownload }` and include `canDownload` in the request body.

Add a checkbox beside each selected package's role dropdown, with the same label and styling as Step 1.

- [ ] **Step 3: Verify it typechecks and lints**

Run: `npx tsc --noEmit && npm run lint`

Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add components/portal/ShareModal.tsx components/people/AddPeopleModal.tsx
git commit -m "feat(invites): choose download access when inviting

Absent from the share-link path rather than disabled there: links never carry
the grant, and absence says so where a greyed-out control would not."
```

---

### Task 11: The People-panel toggle

**Files:**
- Modify: `app/portal/[id]/settings/people/page.tsx`

**Interfaces:**
- Consumes: `POST /api/participants/download` (Task 8), `canDownload` on the listings (Task 9).
- Produces: nothing downstream.

- [ ] **Step 1: Add the field to the local row types**

The file declares local interfaces for the accepted people and the pending invitations — both have a `role: Role` field. Add to each:

```tsx
  canDownload?: boolean;
```

- [ ] **Step 2: Add the handler**

Beside the existing `changeRole`:

```tsx
  const changeDownload = async (userId: string, next: boolean) => {
    await fetch('/api/participants/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, portalId: id, canDownload: next }),
    });
    toast(next ? 'Download allowed' : 'Download turned off');
    load();
  };
```

- [ ] **Step 3: Render the toggle on each accepted person's row**

In the `people.map` row, immediately before the role `<select>`:

```tsx
                <label
                  className="flex shrink-0 items-center gap-1.5 text-[11.5px] font-semibold text-stiko-secondary"
                  title="Allow this person to download files from this package"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(p.canDownload)}
                    onChange={(e) => changeDownload(p.userId, e.target.checked)}
                    className="h-[14px] w-[14px] accent-stiko-primary"
                  />
                  Download
                </label>
```

- [ ] **Step 4: Render it on each pending invitation's row**

Find the `pending.map` block and add the same control, keyed on the invitation's email rather than a user id:

```tsx
                {p.email && (
                  <label
                    className="flex shrink-0 items-center gap-1.5 text-[11.5px] font-semibold text-stiko-secondary"
                    title="Allow this person to download files once they accept"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(p.canDownload)}
                      onChange={(e) => changeDownload(p.email, e.target.checked)}
                      className="h-[14px] w-[14px] accent-stiko-primary"
                    />
                    Download
                  </label>
                )}
```

The `p.email &&` guard matters: a share-link row has no email, and links never carry the grant, so it must not show a control that cannot mean anything.

- [ ] **Step 5: Verify it typechecks and lints**

Run: `npx tsc --noEmit && npm run lint`

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add "app/portal/[id]/settings/people/page.tsx"
git commit -m "feat(people): grant or withdraw download after inviting

Shown for accepted people and pending email invitations, and never for a
share link, which cannot carry the grant."
```

---

### Task 12: The download control on the file row

**Files:**
- Modify: `lib/types.ts`
- Modify: `components/portal/FileTreeSidebar.tsx`
- Modify: `app/portal/[id]/page.tsx`

**Interfaces:**
- Consumes: `canDownload` on the files payload (Task 6), `GET /api/files/:id/download` (Task 5).
- Produces: a new optional prop `onDownloadFile?: (file: FileRecord) => void` on `FileTreeSidebarProps`.

**`FileRecord` is declared in more than one place** — exported from `lib/types.ts` and declared again locally in `components/portal/FileTreeSidebar.tsx`. A field added to one and not the other compiles and then arrives `undefined`, so the control silently never renders. Update both.

- [ ] **Step 1: Add the field to both `FileRecord` declarations**

In `lib/types.ts` and in the local copy in `FileTreeSidebar.tsx`, add beside `canDelete`:

```ts
  canDownload?: boolean;
```

- [ ] **Step 2: Add the prop and thread it to both `FileItem` call sites**

Add to `FileTreeSidebarProps`:

```ts
  /** Absent when the viewer may not download anything. */
  onDownloadFile?: (file: FileRecord) => void;
```

Add `onDownloadFile` to the destructured parameter list of the default export, pass it into `FileItem` at the direct call site, and thread it through `FolderItem` — which renders `FileItem` too, and recurses into itself. Miss the recursive forward and files inside nested folders lose the control while root-level ones keep it.

- [ ] **Step 3: Render the control in `FileItem`**

`FileItem` already takes `onDelete` and renders it as a sibling of the select button inside a `group` container. Add a matching prop and control. In the props:

```tsx
  onDownload?: (file: FileRecord) => void;
```

And immediately before the existing delete button:

```tsx
      {onDownload && file.canDownload && (
        <button
          onClick={() => onDownload(file)}
          aria-label={`Download ${file.filename}`}
          title={`Download ${file.filename}`}
          className="flex-shrink-0 rounded p-1 text-stiko-faint opacity-0 transition hover:bg-stiko-app hover:text-stiko-ink focus:opacity-100 group-hover:opacity-100"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      )}
```

It hides until hover like the delete control, and carries `focus:opacity-100` so it stays reachable by keyboard.

- [ ] **Step 4: Wire the handler in the package page**

In `app/portal/[id]/page.tsx`, add beside the other file handlers:

```tsx
  // The URL is minted per click rather than held on the row: it is presigned
  // and short-lived, and a row rendered an hour ago would hand over a dead one.
  const downloadFile = useCallback(async (file: FileRecord) => {
    try {
      const res = await fetch(`/api/files/${file.id}/download`);
      if (!res.ok) {
        toast('Could not download this file');
        return;
      }
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      toast('Could not download this file');
    }
  }, [toast]);
```

Pass it to the sidebar:

```tsx
          onDownloadFile={downloadFile}
```

- [ ] **Step 5: Verify it typechecks and lints**

Run: `npx tsc --noEmit && npm run lint`

Expected: both clean.

- [ ] **Step 6: Confirm the suite still passes**

Run: `npm test`

Expected: 325 passing.

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts components/portal/FileTreeSidebar.tsx "app/portal/[id]/page.tsx"
git commit -m "feat(portal): download control on the file row

Rendered only when the server said canDownload. The URL is minted per click
because it is presigned and short-lived."
```

---

### Task 13: Record it in the architecture notes

**Files:**
- Modify: `ARCHITECTURE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Read the surrounding sections**

Run: `grep -n "^#\{1,3\} " ARCHITECTURE.md`

Read the Auth Model section and the Deletion Flow subsection added by the previous spec. Match their voice — terse, consequence-first — and do not restructure the document.

- [ ] **Step 2: Add a Download Flow subsection**

Add under Data Flow, after the Deletion Flow subsection. Convey, in the document's own words:

- `canDownloadFile` in `lib/capabilities.ts` holds the rule; `getFileDownloadDecision` in `lib/access.ts` supplies its inputs.
- Owners and coordinators download anything. An uploader always gets their own uploads back. Everyone else — including an uploader wanting someone else's file — needs a grant made per person when they were invited, changeable afterwards from the People panel.
- Share links and public link access never carry the grant; the server forces it false rather than relying on the UI.
- `GET /api/files/[id]/download` serves `storage_key`, never the optimized variant, with `Content-Disposition: attachment`.

- [ ] **Step 3: State the limit**

This matters more than the rest of the section. Add a short paragraph recording that this gates the control and the endpoint, **not the bytes**: `ViewerContainer` fetches a presigned URL unconditionally and asks for `convertedStorageKey ?? storageKey`, so anyone who can view a file can save it from the browser's network tab. Note that a real wall would mean proxying every view through the app server, and that this was deliberately not done.

Without this paragraph the section reads as a stronger promise than the code makes, and someone will eventually repeat that promise to a client.

- [ ] **Step 4: Note the migration**

Add one line to Migration Notes recording that `007-download-authorization.sql` adds `can_download` to `participants` and `invite_tokens`, both defaulting false, and must be applied before deploying code that reads them.

- [ ] **Step 5: Verify only that file changed**

Run: `git diff --stat`

Expected: only `ARCHITECTURE.md`.

- [ ] **Step 6: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: record the download authorization rules

Including what it does not do: viewing already hands out a URL to the file,
so this gates the control, not the bytes."
```

---

## Deployment

1. Apply migration `007` to production: `node <scratch>/with-env.mjs npm run migrate`
2. Confirm it registered: `SELECT * FROM schema_migrations ORDER BY applied_at DESC LIMIT 3;`
3. Deploy the code.

Reversed, `can_download` does not exist and every route selecting it raises Postgres 42703 — a 500, not a silent false. That takes down the people list and the file list, not just downloading.

Both columns default false, so the migration is safe to apply ahead of the code: nothing reads them until the deploy.

**Rollback:** revert the deploy. The columns can stay; they are additive and nothing outside this feature reads them.

## Spec coverage

| Spec section | Task |
|---|---|
| `can_download` on participants and invite_tokens | 1 |
| Mirrored into `lib/schema.sql` | 1 |
| `canDownloadFile` predicate + matrix | 2 |
| Uploader's own-file exemption | 2 |
| `Access.mayDownload` | 3 |
| `getFileDownloadDecision`, returns the original key | 3 |
| `Content-Disposition: attachment` | 4 |
| `GET /api/files/[id]/download`, 401/403/404 contract | 5 |
| `canDownload` on the files payload | 6 |
| Invite carries the grant; share links forced false | 7 |
| Acceptance copies the grant | 7 |
| Changeable afterwards, incl. pending invites | 8, 9, 11 |
| ShareModal checkbox, absent on the link path | 10 |
| AddPeopleModal checkbox per package | 10 |
| People panel toggle | 11 |
| Download control on the file row | 12 |
| The limit stated in ARCHITECTURE.md | 13 |
| Predicate unit tests | 2 |

## Out of scope

Bulk or zip download. Download counts, audit logging, or notifying the owner. Any change to how the viewer fetches files, including byte-proxying. Watermarking. Per-version scoping — that is spec 3.
