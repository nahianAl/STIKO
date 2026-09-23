# Submissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every user-facing "version" becomes "submission", and each submission can be given a name from its expanded view by anyone who can upload.

**Architecture:**
- A nullable `versions.name` column holds a typed name. The default, "Submission N", is computed at render time by one pure helper module, and every title and badge goes through it.
- A `PATCH /api/versions/[id]` endpoint stores a name. Permission comes from a new pure rule in `lib/capabilities.ts`, sent to the client as `canRename`.
- A `renamed_at` column lets the portal change feed see renames.
- The copy sweep is guarded by a permanent test that walks the source's string literals and JSX text.

**Tech Stack:**
- Next.js 14 App Router, React client components, Tailwind with the `stiko-*` tokens
- Neon Postgres through the `sql` tagged template
- `node --test` for unit tests: TypeScript run directly, with relative `.ts` imports

**Spec:** `docs/superpowers/specs/2026-09-22-submissions-design.md`. Read its "Decisions" section before starting; those are settled.

## Global Constraints

- **Copy only.** "Submission" replaces "version" in rendered strings.
  - Never rename an identifier, file, route, table, column, API field, prop, or the `new_version` notification type key. `Version`, `versionNumber`, `/api/versions`, `NewVersionDrawer` and `VersionDetailDrawer` all keep their names.
  - Code comments are not copy. Leave them unless they would become false.
- **Titles and badges come only from `lib/submissionName.ts`.** Use `submissionTitle({ name, versionNumber })` for a title and `submissionBadge(n)` (`"S5"`) for a compact number. Never hand-build either in UI code.
- **Emails and notifications say "Submission N"**, never a custom name. They're written at publish, before a name can exist.
- **Name rules:** runs of whitespace collapse to one space, the result is trimmed, blank becomes `NULL`, and the maximum is 80 characters after that. `SUBMISSION_NAME_MAX = 80`.
- **Permission:** owner, coordinator and uploader can rename. The server sends `canRename`; the client never re-derives it.
- `lib/` modules imported by tests use relative imports with a `.ts` suffix and **no `@/` alias**. `lib/queries.ts` may only be imported with `import type`.
- **Never `git add -A`, `git add .` or `git commit -a`.** The repo root holds untracked handoff folders (`stiko_handoff/`, `design_handoff_*`) that must stay out of commits. Add named paths only, and after each commit check `git show --name-only --pretty=format: HEAD`.
- **Local dev reads and writes the PRODUCTION database.** `.env.local` points at it and there is no staging. Never write to data the user hasn't named as a test fixture.
- Commit message trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Work on branch `feature/submissions`, created from `main` in Task 1.
- **Steps marked "Ask the user" belong to the controlling session.** A subagent that reaches one stops and reports back rather than guessing or skipping. Production writes (the migration) and production-DB reads the sandbox can't make go to the user as literal Terminal commands.

## File map

| File | Responsibility |
|---|---|
| `lib/submissionName.ts` (new) | `SUBMISSION_NAME_MAX`, `submissionTitle`, `submissionBadge`, `normalizeSubmissionName` |
| `lib/capabilities.ts` (modify) | + `canRenameVersion(role)` |
| `lib/access.ts` (modify) | Re-export `canRenameVersion` |
| `lib/migrations/015-submission-names.sql` (new) | `versions.name`, `versions.renamed_at` |
| `lib/schema.sql` (modify) | Mirror both columns |
| `lib/types.ts` (modify) | `Version.name`, `Version.canRename` |
| `app/api/versions/route.ts` (modify) | GET selects `name`, adds `canRename` |
| `app/api/versions/[id]/route.ts` (modify) | + `PATCH` |
| `app/api/portals/[id]/activity/route.ts` (modify) | The versions cursor includes `renamed_at` |
| `components/ui/Drawer.tsx` (modify) | + optional `heading` slot |
| `components/portal/SubmissionNameEditor.tsx` (new) | Title + pencil + inline rename |
| `components/portal/VersionDetailDrawer.tsx` (modify) | Uses the editor; copy |
| `app/portal/[id]/page.tsx` (modify) | `onRenamed` state update; delete confirm and toast copy |
| `components/portal/FileTreeSidebar.tsx` (modify) | Card titles, CURRENT tag, S-badge, copy, "Add new submission" |
| `lib/home.ts`, `lib/status.ts`, `lib/versionDetail.ts`, `lib/email.ts`, `lib/notificationEvents.ts`, `lib/ai/prompt.ts`, `lib/ai/summarize.ts` (modify) | Copy |
| API routes: `participants/versions`, `verdicts`, `versions/publish`, `versions/[id]/changelog-draft` (modify) | Copy |
| 14 UI files (Task 7) | Copy |
| `scripts/tests/submissionName.test.mjs` (new) | Helper tests |
| `scripts/tests/copyTerms.test.mjs` (new) | Permanent guard: no user-facing "version" |
| `scripts/tests/access.test.mjs`, `versionDetail.test.mjs`, `email.test.mjs`, `home.test.mjs`, `status.test.mjs` (modify) | New permission test; copy assertions |

---

### Task 1: Naming helpers and the rename permission

**Files:**
- Create: `lib/submissionName.ts`
- Create: `scripts/tests/submissionName.test.mjs`
- Modify: `lib/capabilities.ts` (add after `canDeleteContent`, which ends around line 92)
- Modify: `lib/access.ts:2` and `lib/access.ts:4` (re-export)
- Modify: `scripts/tests/access.test.mjs:3` (import) and append tests

**Interfaces:**
- Produces (used by Tasks 2–7):
  - `SUBMISSION_NAME_MAX: 80`
  - `submissionTitle(v: { name?: string | null; versionNumber: number }): string`
  - `submissionBadge(versionNumber: number): string`
  - `normalizeSubmissionName(input: unknown): { ok: true; name: string | null } | { ok: false; error: string }`
  - `canRenameVersion(role: EffectiveRole): boolean`, exported from both `lib/capabilities.ts` and `lib/access.ts`

- [ ] **Step 1: Create the branch**

```bash
cd /Users/user/Desktop/STIKO-main
git checkout -b feature/submissions
```

- [ ] **Step 2: Write the failing helper tests**

Create `scripts/tests/submissionName.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBMISSION_NAME_MAX,
  submissionTitle,
  submissionBadge,
  normalizeSubmissionName,
} from '../../lib/submissionName.ts';

// --- Titles ----------------------------------------------------------------

test('an unnamed submission is called by its number', () => {
  assert.equal(submissionTitle({ name: null, versionNumber: 5 }), 'Submission 5');
});

test('a missing name reads the same as a null one', () => {
  // The share and access pickers get versions from routes that do not select
  // the name at all.
  assert.equal(submissionTitle({ versionNumber: 2 }), 'Submission 2');
});

test('a named submission shows its name', () => {
  assert.equal(
    submissionTitle({ name: 'Revised per structural notes', versionNumber: 5 }),
    'Revised per structural notes'
  );
});

test('a whitespace-only stored name falls back to the default', () => {
  assert.equal(submissionTitle({ name: '   ', versionNumber: 3 }), 'Submission 3');
});

test('the badge is S and the number', () => {
  assert.equal(submissionBadge(5), 'S5');
  assert.equal(submissionBadge(12), 'S12');
});

// --- What the rename endpoint stores ---------------------------------------

test('null clears the name', () => {
  assert.deepEqual(normalizeSubmissionName(null), { ok: true, name: null });
});

test('blank and whitespace-only clear the name rather than storing ""', () => {
  assert.deepEqual(normalizeSubmissionName(''), { ok: true, name: null });
  assert.deepEqual(normalizeSubmissionName('   \n\t '), { ok: true, name: null });
});

test('a name is trimmed', () => {
  assert.deepEqual(normalizeSubmissionName('  Revised  '), { ok: true, name: 'Revised' });
});

test('inner whitespace, newlines included, collapses to one space', () => {
  assert.deepEqual(
    normalizeSubmissionName('Revised\n per   notes'),
    { ok: true, name: 'Revised per notes' }
  );
});

test('exactly the maximum length is accepted', () => {
  const name = 'x'.repeat(SUBMISSION_NAME_MAX);
  assert.deepEqual(normalizeSubmissionName(name), { ok: true, name });
});

test('one over the maximum is rejected', () => {
  const r = normalizeSubmissionName('x'.repeat(SUBMISSION_NAME_MAX + 1));
  assert.equal(r.ok, false);
  assert.match(r.error, /80/);
});

test('the limit is measured after trimming', () => {
  const name = 'x'.repeat(SUBMISSION_NAME_MAX);
  assert.deepEqual(normalizeSubmissionName(`   ${name}   `), { ok: true, name });
});

test('anything that is not text or null is rejected', () => {
  for (const bad of [undefined, 42, {}, [], true]) {
    assert.equal(normalizeSubmissionName(bad).ok, false, JSON.stringify(bad));
  }
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `node --test scripts/tests/submissionName.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/submissionName.ts`.

- [ ] **Step 4: Write `lib/submissionName.ts`**

```ts
/**
 * What a submission is called, in one place.
 *
 * "Submission" is the user-facing word only. The table is still `versions` and
 * the code still says version throughout, the same split as portal/package.
 * Every rendered title and badge goes through here so the word cannot drift
 * between screens.
 *
 * Imports nothing, so node --test loads it without a database.
 */

/** Longest name the API accepts, after trimming. The rename input's maxLength matches. */
export const SUBMISSION_NAME_MAX = 80;

/**
 * The name someone gave it, or "Submission N" when nobody has.
 *
 * `name` is optional because not every payload carries it (the share and
 * access pickers read versions from routes that never select it), and a
 * missing name means the same as a null one.
 */
export function submissionTitle(v: { name?: string | null; versionNumber: number }): string {
  const name = v.name?.trim();
  return name ? name : `Submission ${v.versionNumber}`;
}

/** The compact form for badges, chips and meta lines: "S5". */
export function submissionBadge(versionNumber: number): string {
  return `S${versionNumber}`;
}

export type NormalizedSubmissionName =
  | { ok: true; name: string | null }
  | { ok: false; error: string };

/**
 * What the rename endpoint stores for a request's `name` value.
 *
 * Blank means "go back to the default", so it becomes null rather than an
 * empty string: the default is computed at render time and never written down.
 * Runs of whitespace, newlines included, collapse to one space, so a pasted
 * name cannot break the title across lines.
 */
export function normalizeSubmissionName(input: unknown): NormalizedSubmissionName {
  if (input === null) return { ok: true, name: null };
  if (typeof input !== 'string') return { ok: false, error: 'Name must be text' };
  const name = input.replace(/\s+/g, ' ').trim();
  if (!name) return { ok: true, name: null };
  if (name.length > SUBMISSION_NAME_MAX) {
    return { ok: false, error: `Keep the name to ${SUBMISSION_NAME_MAX} characters or fewer` };
  }
  return { ok: true, name };
}
```

- [ ] **Step 5: Run the helper tests**

Run: `node --test scripts/tests/submissionName.test.mjs`
Expected: PASS, 13 tests.

- [ ] **Step 6: Write the failing permission tests**

In `scripts/tests/access.test.mjs`, change line 3 to:

```js
import { capabilitiesFor, canDeleteContent, canDownloadFile, canRenameVersion, canSeeVersion } from '../../lib/capabilities.ts';
```

Append at the end of the file:

```js
// --- Renaming a submission --------------------------------------------------

test('owner, coordinator and uploader can rename a submission; nobody else can', () => {
  // Deliberately not canDeleteContent's rule. A rename destroys nothing and can
  // be undone, so uploaders keep it after publication.
  const allowed = Object.keys(EXPECTED).filter((r) => canRenameVersion(r));
  assert.deepEqual(allowed.sort(), ['coordinator', 'owner', 'uploader']);
});

test('an unrecognised role cannot rename', () => {
  // Reaches the function through an unchecked cast from a DB CHECK constraint
  // that gained a role before the union did.
  assert.equal(canRenameVersion('admin'), false);
});
```

- [ ] **Step 7: Run it to confirm it fails**

Run: `node --test scripts/tests/access.test.mjs`
Expected: FAIL with `SyntaxError: The requested module '../../lib/capabilities.ts' does not provide an export named 'canRenameVersion'`.

- [ ] **Step 8: Add `canRenameVersion` to `lib/capabilities.ts`**

Insert directly after the closing `}` of `canDeleteContent`:

```ts
/**
 * Who may rename a submission.
 *
 * Not canDeleteContent's rule. A rename destroys nothing and can be undone, so
 * there is no reason to cut uploaders off at publication. It matches who may
 * transform a 3D object: the other change that alters what everyone sees
 * without removing anything.
 */
export function canRenameVersion(role: EffectiveRole): boolean {
  switch (role) {
    case 'owner':
    case 'coordinator':
    case 'uploader':
      return true;
    case 'commenter':
    case 'viewer':
      return false;
    default: {
      // Same two guarantees as capabilitiesFor: a role added to EffectiveRole
      // without a case here fails to typecheck, and one that reaches this
      // through an unchecked cast is denied rather than falling through.
      const unhandled: never = role;
      void unhandled;
      return false;
    }
  }
}
```

In `lib/access.ts`, add `canRenameVersion` to both the import on line 2 and the re-export on line 4:

```ts
import { capabilitiesFor, canDeleteContent, canDownloadFile, canRenameVersion, canSeeVersion, type Capabilities, type DeleteContext, type DownloadContext, type EffectiveRole, type PackageRole, type ProjectRole, type VersionScope } from '@/lib/capabilities';
```
```ts
export { capabilitiesFor, canDeleteContent, canDownloadFile, canRenameVersion, canSeeVersion };
```

- [ ] **Step 9: Run the tests**

Run: `npm test`
Expected: PASS, with 0 failures.

- [ ] **Step 10: Commit**

```bash
cd /Users/user/Desktop/STIKO-main
git add lib/submissionName.ts lib/capabilities.ts lib/access.ts scripts/tests/submissionName.test.mjs scripts/tests/access.test.mjs
git commit -m "$(cat <<'EOF'
feat: submission naming helpers and the rename permission

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
git show --name-only --pretty=format: HEAD
```
Expected: exactly those 5 paths.

---

### Task 2: Migration and the rename API

**Files:**
- Create: `lib/migrations/015-submission-names.sql` (the number is confirmed in Step 1)
- Modify: `lib/schema.sql:108-116` (the `versions` table)
- Modify: `lib/types.ts:25-44` (`Version`)
- Modify: `app/api/versions/route.ts` (both GET selects around lines 34–53, and the response map around line 88)
- Modify: `app/api/versions/[id]/route.ts` (add `PATCH`)
- Modify: `app/api/portals/[id]/activity/route.ts:54-60` and `:84`

**Interfaces:**
- Consumes: `normalizeSubmissionName` from `@/lib/submissionName`, and `canRenameVersion` and `getVersionAccess` from `@/lib/access`
- Produces:
  - `Version.name: string | null` and `Version.canRename?: boolean`
  - `PATCH /api/versions/[id]`, body `{ name: string | null }`, returning 200 `{ id: string; name: string | null }`
  - Status codes: 401 no session · 404 not visible · 403 not allowed · 400 bad name or bad JSON

- [ ] **Step 1: Confirm the migration number against the live table (the user runs this)**

`schema_migrations` is keyed on the filename. A second file under an already-recorded name is silently skipped, and unmerged branches have claimed numbers before. The sandbox can't read `.env.local`, so **ask the user** to run this in Terminal and paste the output:

```bash
cd /Users/user/Desktop/STIKO-main
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2-)" node --input-type=module -e "
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const rows = await sql\`SELECT name FROM schema_migrations ORDER BY name\`;
console.log(rows.map((r) => r.name).join('\n'));
"
```

Expected: a list ending in `014-trash.sql`, with `001-redesign.sql` and `010-workos-auth.sql` present and no `015-*`.
- If any `015-*` is listed, use the next unused number for the filename below and everywhere this plan says `015`.
- If the list is empty or lacks `001-redesign.sql`, **stop and do not let anyone run migrate**. The history is lost, and re-running 001 executes a one-time backfill that publishes every unpublished draft.

- [ ] **Step 2: Write the migration**

Create `lib/migrations/015-submission-names.sql`:

```sql
-- lib/migrations/015-submission-names.sql
--
-- Submissions can be named (2026-09-22). Mirrored in lib/schema.sql.
--
-- "Submission" is the user-facing word only; the table keeps its name, as
-- portals did when they became packages.
--
-- name: NULL until someone names it. The default ("Submission N") is computed
-- at render time and never stored, so a future wording change needs no
-- backfill and a typed name is never confused with a default.
ALTER TABLE versions ADD COLUMN IF NOT EXISTS name TEXT;

-- renamed_at: exists only so the portal change feed notices a rename. Its
-- versions cursor is a (count, latest stamp) pair, and an in-place rename
-- moves neither half without this. See app/api/portals/[id]/activity/route.ts.
ALTER TABLE versions ADD COLUMN IF NOT EXISTS renamed_at TIMESTAMPTZ;
```

In `lib/schema.sql`, the `versions` table becomes:

```sql
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  portal_id TEXT NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  changelog TEXT,
  published_at TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT,
  renamed_at TIMESTAMPTZ
);
```

- [ ] **Step 3: Add the fields to `Version` in `lib/types.ts`**

Insert after the `createdByName` field:

```ts
  /** What someone named it. Null means unnamed: render submissionTitle(),
   *  which falls back to "Submission N". Never compare this to a default. */
  name: string | null;
  /** Server's verdict on whether this caller may rename it. Never re-derived
   *  client-side. */
  canRename?: boolean;
```

- [ ] **Step 4: Select the name and send `canRename` from `GET /api/versions`**

In `app/api/versions/route.ts`:
- Change the import on line 5 to `import { canDeleteContent, canRenameVersion, canSeeVersion, getPackageAccess } from '@/lib/access';`.
- In **both** SELECTs, add `v.name,` after the `v.changelog, v.published_at AS "publishedAt",` line:

```sql
        SELECT v.id, v.portal_id AS "portalId",
               v.version_number AS "versionNumber",
               v.changelog, v.published_at AS "publishedAt",
               v.name,
               v.created_at AS "createdAt", u.name AS "createdByName"
```

- In the response map, add `canRename` after `canDelete`:

```ts
      canDelete: canDeleteContent({
        role: access.role,
        isOwnUpload: false,
        isPublished: row.publishedAt !== null,
      }),
      canRename: canRenameVersion(access.role),
```

- [ ] **Step 5: Add `PATCH` to `app/api/versions/[id]/route.ts`**

Change the imports at the top to:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { canRenameVersion, getVersionAccess, getVersionDeleteDecision } from '@/lib/access';
import { deleteObjects } from '@/lib/s3';
import { normalizeSubmissionName } from '@/lib/submissionName';
```

Append after `DELETE`:

```ts
/**
 * PATCH — rename a submission. Body: { name: string | null }.
 *
 * A blank or null name clears it, and the rail goes back to "Submission N".
 * Owner, coordinator and uploader only (canRenameVersion).
 *
 * The order of the checks is the point. Anything the caller cannot see is a
 * 404, and only then is the permission judged, so a 403 can never confirm that
 * a hidden version exists.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Package access and version scope. Null for a missing version too.
  const access = await getVersionAccess(session.user.id, params.id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // getVersionAccess does not apply the draft rule that GET /api/versions
  // does: drafts are visible only to people who can publish. Without this, a
  // commenter probing a draft id would get the 403 below, which says "this
  // exists".
  const rows = await sql`
    SELECT published_at AS "publishedAt" FROM versions WHERE id = ${params.id}
  `;
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (rows[0].publishedAt === null && !access.canUpload) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!canRenameVersion(access.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = normalizeSubmissionName(
    body && typeof body === 'object' ? (body as { name?: unknown }).name : undefined
  );
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const updated = await sql`
    UPDATE versions SET name = ${parsed.name}, renamed_at = NOW()
    WHERE id = ${params.id}
    RETURNING id, name
  `;
  if (!updated[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ id: updated[0].id, name: updated[0].name });
}
```

- [ ] **Step 6: Make a rename move the change-feed cursor**

In `app/api/portals/[id]/activity/route.ts`, change the `visible_versions` CTE's select list to include `v.renamed_at`:

```sql
    WITH visible_versions AS (
      SELECT v.id, v.created_at, v.published_at, v.renamed_at
      FROM versions v
```

Replace the `versionsAt` line (84) and add one sentence to the comment block above it:

```sql
      -- renamed_at is folded in for the same reason: a rename changes a row in
      -- place, so without it nobody else's rail would show the new name.
      (SELECT GREATEST(MAX(created_at), MAX(published_at), MAX(renamed_at)) FROM visible_versions) AS "versionsAt",
```

- [ ] **Step 7: Typecheck, lint, test**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc prints nothing, lint prints `✔ No ESLint warnings or errors`, and tests have 0 failures.

- [ ] **Step 8: Commit**

```bash
cd /Users/user/Desktop/STIKO-main
git add lib/migrations/015-submission-names.sql lib/schema.sql lib/types.ts app/api/versions/route.ts "app/api/versions/[id]/route.ts" "app/api/portals/[id]/activity/route.ts"
git commit -m "$(cat <<'EOF'
feat: versions.name, the rename endpoint, and renames in the change feed

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
git show --name-only --pretty=format: HEAD
```
Expected: exactly those 6 paths.

- [ ] **Step 9: Have the user apply the migration now**

It's additive and nullable. The code running in production selects explicit columns, so it ignores the new ones, which makes it safe to apply before merging. Task 8's browser pass needs it, because local dev reads production. **Ask the user** to run this in Terminal:

```bash
cd /Users/user/Desktop/STIKO-main
git checkout feature/submissions
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2-)" npm run migrate
```

Expected output includes a `015-submission-names.sql` line with its two `ALTER TABLE` statements, and no error. `001`–`014` are skipped as already applied. Step 1 already confirmed `001` is recorded, which is what makes this run safe.

---

### Task 3: Rename in the expanded view

**Files:**
- Modify: `components/ui/Drawer.tsx` (props around line 25–60, header around line 123)
- Create: `components/portal/SubmissionNameEditor.tsx`
- Modify: `components/portal/VersionDetailDrawer.tsx` (props ~145–185, render ~196–275)
- Modify: `app/portal/[id]/page.tsx` (the `<VersionDetailDrawer>` element around line 2553)

**Interfaces:**
- Consumes: `submissionTitle` and `SUBMISSION_NAME_MAX` (Task 1); `Version.name`, `Version.canRename` and `PATCH /api/versions/[id]` (Task 2)
- Produces:
  - `Drawer` prop `heading?: React.ReactNode`
  - `<SubmissionNameEditor version onRenamed />`
  - `VersionDetailDrawer` prop `onRenamed: (versionId: string, name: string | null) => void`

**The Escape trap. Read this before touching the key handler.** Escape in the name field must cancel the edit **without** closing the drawer. Gating the drawer's `closeOnEscape` on an `editing` flag, the way the delete confirm does, **does not work here**, for two reasons:
- The input's React `onKeyDown` runs at React's root container, *before* the event bubbles to the drawer's `document` listener.
- React flushes a keydown's state update synchronously in a microtask between those two points, including the effect that re-registers the drawer's listener.

So by the time the event reaches `document`, the drawer is listening with `closeOnEscape` back to `true`, and it closes. (The delete confirm is the opposite case: its handler is itself a `document` listener that runs after the drawer's.) The fix is `e.stopPropagation()` in the input's Escape branch, which stops the native event at the root so no `document` or `window` listener sees it. `VersionDetailDrawer` keeps `closeOnEscape={!confirmOpen}` unchanged. That's a deliberate departure from the spec's wording, which assumed the gate would work.

- [ ] **Step 1: Give `Drawer` a heading slot**

In `components/ui/Drawer.tsx`, add `heading` to the destructured props (after `subtitle`) and to the prop types:

```ts
  title: string;
  /** Replaces the plain <h2> title when given, e.g. a title that can be
   *  edited in place. `title` is still required: it names the dialog for
   *  screen readers (aria-label), which a control-bearing node cannot do. */
  heading?: React.ReactNode;
  subtitle?: string;
```

Replace the header's title block:

```tsx
          <div>
            <h2 className="text-[17px] font-extrabold text-stiko-ink">{title}</h2>
```

with:

```tsx
          <div className="min-w-0 flex-1">
            {heading ?? (
              <h2 className="text-[17px] font-extrabold text-stiko-ink">{title}</h2>
            )}
```

(`min-w-0 flex-1` lets a long name wrap instead of pushing the close button out. Other drawers' titles are short and render the same.)

- [ ] **Step 2: Write `components/portal/SubmissionNameEditor.tsx`**

```tsx
'use client';

import React, { useRef, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import {
  SUBMISSION_NAME_MAX,
  normalizeSubmissionName,
  submissionTitle,
} from '@/lib/submissionName';
import type { Version } from '@/lib/types';

const FOCUS = 'focus:outline-none focus-visible:shadow-stiko-focus';

/**
 * The expanded view's title, and (for anyone allowed) the control that
 * renames the submission.
 *
 * Nothing is optimistic. The title changes only once the server has stored the
 * name, so a failed save can never leave the rail and the drawer showing a
 * name the database does not have.
 */
export default function SubmissionNameEditor({
  version,
  onRenamed,
}: {
  version: Version;
  /** Called with the name the server stored; null when it went back to the default. */
  onRenamed: (versionId: string, name: string | null) => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  // Set by whichever of Enter, blur or Escape ends the edit first. Enter saves
  // and the input then unmounts, which can fire blur and save a second time;
  // Escape cancels and unmounts, and that blur must not save at all.
  const settled = useRef(false);

  const start = () => {
    settled.current = false;
    setDraft(version.name ?? '');
    setEditing(true);
  };

  const cancel = () => {
    settled.current = true;
    setEditing(false);
  };

  const save = async () => {
    if (settled.current) return;
    settled.current = true;

    const parsed = normalizeSubmissionName(draft);
    if (!parsed.ok) {
      // Unreachable through the input (maxLength), kept so a bad value is
      // stated rather than silently dropped.
      toast(parsed.error);
      setEditing(false);
      return;
    }
    // Compare what would be STORED, not the raw text: "  Revised " is
    // "Revised", and a blank field is the same as no name.
    if (parsed.name === (version.name ?? null)) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/versions/${version.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: parsed.name }),
      });
      if (!res.ok) throw new Error(`rename failed: ${res.status}`);
      const data: { id: string; name: string | null } = await res.json();
      onRenamed(data.id, data.name);
    } catch {
      toast('Could not rename this submission');
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape') {
            // stopPropagation is what keeps the drawer open. Gating the
            // drawer's closeOnEscape on `editing` would not: this handler runs
            // at React's root, before the drawer's listener on document, and
            // React flushes this state update and the effect that re-registers
            // that listener in between. The drawer would already be listening
            // with closeOnEscape back on when the event reached it.
            e.preventDefault();
            e.stopPropagation();
            cancel();
          }
        }}
        // readOnly, not disabled: a disabled input drops focus, and Escape
        // pressed mid-save would then reach the drawer and close it.
        readOnly={saving}
        maxLength={SUBMISSION_NAME_MAX}
        placeholder={submissionTitle({ versionNumber: version.versionNumber })}
        aria-label="Submission name"
        className={`-mx-2 -my-[3px] w-[calc(100%+16px)] rounded-[8px] border border-stiko-divider bg-white px-2 py-[2px] text-[17px] font-extrabold text-stiko-ink placeholder:text-stiko-faint ${FOCUS} ${saving ? 'opacity-60' : ''}`}
      />
    );
  }

  return (
    <div className="flex min-w-0 items-start gap-1.5">
      <h2 className="min-w-0 break-words text-[17px] font-extrabold text-stiko-ink">
        {submissionTitle(version)}
      </h2>
      {version.canRename && (
        <button
          type="button"
          onClick={start}
          aria-label="Rename submission"
          title="Rename"
          className={`mt-[3px] flex-shrink-0 rounded-[7px] p-1 text-stiko-faint transition hover:bg-stiko-subtle hover:text-stiko-primary ${FOCUS}`}
        >
          <svg className="h-[14px] w-[14px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Use it in `VersionDetailDrawer.tsx`**

Add the imports:

```ts
import SubmissionNameEditor from '@/components/portal/SubmissionNameEditor';
import { submissionTitle } from '@/lib/submissionName';
```

Add the prop to the destructuring (after `onDeleteVersion`) and the type (after `onDeleteVersion?:`):

```ts
  /** The server stored a new name (null = back to the default). The page
   *  updates its `versions` list, which is what both the rail and this drawer
   *  render from. */
  onRenamed: (versionId: string, name: string | null) => void;
```

Replace `title={`Version ${version.versionNumber}`}` with:

```tsx
      title={submissionTitle(version)}
      // Keyed by id so an edit in progress can never carry over to a
      // different submission's title.
      heading={<SubmissionNameEditor key={version.id} version={version} onRenamed={onRenamed} />}
```

Copy changes in the same file:

| Old | New |
|---|---|
| `No files in this version.` | `No files in this submission.` |
| `What changed in this version` | `What changed in this submission` |
| `Delete Version {version.versionNumber} and everything in it` | `Delete this submission and everything in it` |

- [ ] **Step 4: Wire `onRenamed` in the page**

In `app/portal/[id]/page.tsx`, add this prop to the `<VersionDetailDrawer …>` element, after `onDeleteVersion={openVersionDelete}`:

```tsx
          onRenamed={(versionId, name) =>
            setVersions((prev) =>
              prev.map((v) => (v.id === versionId ? { ...v, name } : v))
            )
          }
```

- [ ] **Step 5: Typecheck, lint, test**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all clean. This behaviour is checked in the browser in Task 8, because the repo has no component test harness.

- [ ] **Step 6: Commit**

```bash
cd /Users/user/Desktop/STIKO-main
git add components/ui/Drawer.tsx components/portal/SubmissionNameEditor.tsx components/portal/VersionDetailDrawer.tsx "app/portal/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
feat: rename a submission from its expanded view

Escape cancels the edit without closing the drawer: the input stops the
event, because gating closeOnEscape cannot work for a handler that runs
before the drawer's document listener.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
git show --name-only --pretty=format: HEAD
```
Expected: exactly those 4 paths.

---

### Task 4: The rail

**Files:**
- Modify: `components/portal/FileTreeSidebar.tsx` (lines ~207–340)

**Interfaces:**
- Consumes: `submissionTitle` and `submissionBadge` (Task 1); `Version.name` (Task 2)

- [ ] **Step 1: Import the helpers**

```ts
import { submissionBadge, submissionTitle } from '@/lib/submissionName';
```

- [ ] **Step 2: Replace the card's badge and text block**

Replace the badge contents `V{version.versionNumber}` with `{submissionBadge(version.versionNumber)}`.

Replace the title and date spans:

```tsx
                      <span className={`block text-[14px] truncate ${isCurrent ? 'font-bold text-stiko-ink' : 'font-semibold text-stiko-ink'}`}>
                        {isCurrent ? 'Current' : `Version ${version.versionNumber}`}
                      </span>
                      <span className="block text-[11px] text-stiko-muted">{formatDate(version.createdAt)}</span>
```

with:

```tsx
                      {/* The name leads on every card, the newest included. It
                          used to read "Current" there, which would now hide the
                          name on the submission people look at most. */}
                      <span className={`block text-[14px] truncate ${isCurrent ? 'font-bold text-stiko-ink' : 'font-semibold text-stiko-ink'}`}>
                        {submissionTitle(version)}
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-stiko-muted">
                        {isCurrent && (
                          <span className="flex-shrink-0 rounded-chip bg-white px-[5px] py-[1px] text-[9px] font-extrabold uppercase tracking-[0.06em] text-stiko-primary">
                            Current
                          </span>
                        )}
                        <span className="truncate">{formatDate(version.createdAt)}</span>
                      </span>
```

- [ ] **Step 3: Details icon labels**

Before the `return (` inside `versions.map(...)`, add `const title = submissionTitle(version);`, then:

```tsx
                    aria-label={`Open submission details for ${title}`}
                    title={`${title} details`}
```

- [ ] **Step 4: Remaining copy in this file**

| Old | New |
|---|---|
| `title="Expand versions"` | `title="Expand submissions"` |
| `>Versions</span>` (the header) | `>Submissions</span>` |
| `'Submit your first version to get started'` | `'Add your first submission to get started'` |
| `No files in this version` | `No files in this submission` |
| `Submit new version` (button) | `Add new submission` |

- [ ] **Step 5: Typecheck, lint, test**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/user/Desktop/STIKO-main
git add components/portal/FileTreeSidebar.tsx
git commit -m "$(cat <<'EOF'
feat(rail): submission names, a CURRENT tag, S-badges, "Add new submission"

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Copy in `lib/`, test-first

**Files:**
- Modify tests: `scripts/tests/versionDetail.test.mjs:111,118`, `scripts/tests/email.test.mjs:28,40`, `scripts/tests/status.test.mjs:98`, `scripts/tests/home.test.mjs:231,286,296,301,302`
- Modify: `lib/versionDetail.ts:71`, `lib/email.ts:152,158`, `lib/status.ts:123`, `lib/home.ts:184,238` (+ import), `lib/notificationEvents.ts:33`, `lib/ai/summarize.ts:30`, `lib/ai/prompt.ts` (several)

**Interfaces:**
- Consumes: `submissionBadge` from `./submissionName.ts` (relative, with `.ts`: `lib/home.ts` is unit-tested)

- [ ] **Step 1: Update the assertions to the new copy**

| File:line | Old | New |
|---|---|---|
| `versionDetail.test.mjs:111` and `:118` | `'No description was written for this version.'` | `'No description was written for this submission.'` |
| `email.test.mjs:28` | `/Dana published version 4 of Level 3 Framing\./` | `/Dana published submission 4 of Level 3 Framing\./` |
| `email.test.mjs:40` | `'Version 4 of Level 3 Framing is ready to review'` | `'Submission 4 of Level 3 Framing is ready to review'` |
| `status.test.mjs:98` | `'NEW VERSION'` | `'NEW SUBMISSION'` |
| `home.test.mjs:231` | `'New version'` | `'New submission'` |
| `home.test.mjs:286` | `'V4 · "Gutter detail added" · 2h ago'` | `'S4 · "Gutter detail added" · 2h ago'` |
| `home.test.mjs:296` | `'V3 · 3d ago'` | `'S3 · 3d ago'` |
| `home.test.mjs:301` and `:302` | `'V2'` | `'S2'` |

- [ ] **Step 2: Run them to confirm they fail**

Run: `node --test scripts/tests/versionDetail.test.mjs scripts/tests/email.test.mjs scripts/tests/status.test.mjs scripts/tests/home.test.mjs`
Expected: FAIL, with 9 failing tests (versionDetail 2, email 2, status 1, home 4), each an `AssertionError` showing the old "version"/"V" string as actual.

- [ ] **Step 3: Change the `lib/` copy**

| File | Old | New |
|---|---|---|
| `lib/versionDetail.ts:71` | `'No description was written for this version.'` | `'No description was written for this submission.'` |
| `lib/email.ts:152` | `` `${opts.publisherName} published version ${opts.versionNumber} of ${opts.packageName}.` `` | `` `${opts.publisherName} published submission ${opts.versionNumber} of ${opts.packageName}.` `` |
| `lib/email.ts:158` | `` `Version ${opts.versionNumber} of ${opts.packageName} is ready to review` `` | `` `Submission ${opts.versionNumber} of ${opts.packageName} is ready to review` `` |
| `lib/status.ts:123` | `label: 'NEW VERSION'` | `label: 'NEW SUBMISSION'` |
| `lib/home.ts:184` | `label: 'New version'` | `label: 'New submission'` |
| `lib/home.ts:238` | `` `V${pkg.versionNumber}`, `` | `submissionBadge(pkg.versionNumber),` |
| `lib/notificationEvents.ts:33` | `'A new version is published'` | `'A new submission is published'` |
| `lib/ai/summarize.ts:30` | `reason: 'Version not found'` | `reason: 'Submission not found'` (the summary route returns this as its `error` body) |

In `lib/home.ts`, add below the existing relative imports:

```ts
import { submissionBadge } from './submissionName.ts';
```

In `lib/ai/prompt.ts`, change only the human words. The JSON keys `firstSeenVersionId` and `versionIds` are a contract with `lib/ai/validate.ts` and **must not change**:

| Old | New |
|---|---|
| `"headline": "one sentence on where this version stands",` | `"headline": "one sentence on where this submission stands",` |
| `"<a version id from PRIOR THEMES, or null>"` | `"<a submission id from PRIOR THEMES, or null>"` |
| `` lines.push(`VERSION ${input.versionNumber}`); `` | `` lines.push(`SUBMISSION ${input.versionNumber}`); `` |
| `'PRIOR THEMES (from earlier versions):'` | `'PRIOR THEMES (from earlier submissions):'` |
| `from per-version summaries.` | `from per-submission summaries.` |
| `"versionIds": ["<version ids supplied below>"]` | `"versionIds": ["<submission ids supplied below>"]` |
| `- Use only the package and version ids supplied below.` | `- Use only the package and submission ids supplied below.` |
| `` `  - [${v.versionId}] v${v.versionNumber}: ${v.headline}` `` | `` `  - [${v.versionId}] submission ${v.versionNumber}: ${v.headline}` `` |
| `for a new version of a design package.` | `for a new submission of a design package.` |
| `Write what the new version addresses, based on the open concerns from the previous`<br>`version.` | `Write what the new submission addresses, based on the open concerns from the previous`<br>`submission.` |
| `` `Open concerns from version ${input.previousVersionNumber}:` `` | `` `Open concerns from submission ${input.previousVersionNumber}:` `` |

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, 0 failures, `aiPrompt.test.mjs` included. It doesn't assert these words; if it does fail, update only the assertion's wording, never the JSON keys.

- [ ] **Step 5: Commit**

```bash
cd /Users/user/Desktop/STIKO-main
git add lib/versionDetail.ts lib/email.ts lib/status.ts lib/home.ts lib/notificationEvents.ts lib/ai/summarize.ts lib/ai/prompt.ts scripts/tests/versionDetail.test.mjs scripts/tests/email.test.mjs scripts/tests/status.test.mjs scripts/tests/home.test.mjs
git commit -m "$(cat <<'EOF'
copy(lib): version -> submission in labels, email, notifications, AI prompts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
git show --name-only --pretty=format: HEAD
```
Expected: exactly those 11 paths.

---

### Task 6: Copy in API responses and notifications

**Files:**
- Modify: `app/api/participants/versions/route.ts:44`
- Modify: `app/api/verdicts/route.ts:73,114`
- Modify: `app/api/versions/publish/route.ts:48,60,113`
- Modify: `app/api/versions/[id]/changelog-draft/route.ts:48`

- [ ] **Step 1: Replace the strings**

| File:line | Old | New |
|---|---|---|
| `participants/versions/route.ts:44` | `'Choose at least one version, or allow all versions'` | `'Choose at least one submission, or allow all submissions'` |
| `verdicts/route.ts:73` | `'This version has not been published yet'` | `'This submission has not been published yet'` |
| `verdicts/route.ts:114` | `` `… requested changes on V${version.versionNumber} of …` `` | `` `… requested changes on Submission ${version.versionNumber} of …` `` (only the `V` → `Submission ` part changes) |
| `versions/publish/route.ts:48` | `'This version is already published'` | `'This submission is already published'` |
| `versions/publish/route.ts:60` | `'This version has no files yet'` | `'This submission has no files yet'` |
| `versions/publish/route.ts:113` | `` `Version ${version.versionNumber} published in ${packageName}` `` | `` `Submission ${version.versionNumber} published in ${packageName}` `` |
| `versions/[id]/changelog-draft/route.ts:48` | `'The previous version has no summary to draw from'` | `'The previous submission has no summary to draw from'` |

These are literal "Submission N", not `submissionTitle`, on purpose: emails and notifications never carry a custom name (see Global Constraints).

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/user/Desktop/STIKO-main
git add app/api/participants/versions/route.ts app/api/verdicts/route.ts app/api/versions/publish/route.ts "app/api/versions/[id]/changelog-draft/route.ts"
git commit -m "$(cat <<'EOF'
copy(api): version -> submission in errors and notification titles

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Copy in the UI, plus the permanent guard

**Files:**
- Create: `scripts/tests/copyTerms.test.mjs`
- Modify: `app/portal/[id]/page.tsx`, `components/portal/NewVersionDrawer.tsx`, `app/new/page.tsx`, `app/page.tsx`, `app/invite/[token]/page.tsx`, `app/portal/[id]/settings/page.tsx`, `components/home/ProjectPanel.tsx`, `components/home/ProjectSummaryPanel.tsx`, `components/people/AccessEditor.tsx`, `components/people/AddPeopleModal.tsx`, `components/portal/ShareModal.tsx`, `components/portal/VersionBrief.tsx`, `components/portal/WhoCanSeeThis.tsx`, `components/ui/UploadProgress.tsx`

**Interfaces:**
- Consumes: `submissionTitle` and `submissionBadge` from `@/lib/submissionName` (components and pages may use `@/`)

- [ ] **Step 1: Write the guard test**

Create `scripts/tests/copyTerms.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * "Submission" is the user-facing word; "version" survives only in code. This
 * is the same rule as portal -> package (see the 2026-09-22 submissions spec).
 *
 * Walks every string literal, template-literal chunk and JSX text under app/,
 * components/ and lib/, and fails on any that still says "version", or that
 * renders a V-badge (`V${n}`, or V{n} in JSX), outside the short list below of
 * strings that are not about submissions at all.
 *
 * Skipped by construction: the text of sql`` templates (table and column
 * names; templates nested in their ${} are still checked), import specifiers,
 * string-literal TYPES, and strings starting with "/" (routes like /api/versions).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORD = /\bversions?\b/i;
// "V" right before an interpolation: `V${n}` in a template, V{n} in JSX.
const BADGE_TAIL = /(^|[^A-Za-z])V\s*$/;

/** Strings that say "version" and mean something other than a submission. */
const ALLOWED = [
  // Developer diagnostics: logged, never rendered.
  (file, text) => /^Failed to fetch\b/.test(text),
  // "This version" of the APP, in the missing-migration error.
  (file, text) => /this version needs\. Run `npm run migrate`/.test(text),
  // The change feed's entity key: an identifier that happens to be a string.
  (file, text) => file === 'lib/portalActivity.ts' && text === 'versions',
];

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(p);
    }
  };
  for (const d of ['app', 'components', 'lib']) walk(path.join(ROOT, d));
  return out;
}

function findOffenders() {
  const offenders = [];
  for (const abs of sourceFiles()) {
    const file = path.relative(ROOT, abs).split(path.sep).join('/');
    const sf = ts.createSourceFile(
      abs,
      fs.readFileSync(abs, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      abs.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    // Only a sql`` template's OWN text is SQL.
    const isSqlText = (n) => {
      let tpl = null;
      if (ts.isNoSubstitutionTemplateLiteral(n)) tpl = n;
      else if (ts.isTemplateHead(n)) tpl = n.parent;
      else if (ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) tpl = n.parent.parent;
      return !!tpl && ts.isTaggedTemplateExpression(tpl.parent) && tpl.parent.tag.getText(sf) === 'sql';
    };

    const flag = (n, text, why) => {
      if (ALLOWED.some((ok) => ok(file, text))) return;
      const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      offenders.push(`${file}:${line + 1} ${why}: ${JSON.stringify(text.trim().slice(0, 100))}`);
    };

    const visit = (n) => {
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isLiteralTypeNode(n)) return;
      if (
        ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ||
        ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)
      ) {
        const text = n.text;
        if (!isSqlText(n) && !text.startsWith('/')) {
          if (WORD.test(text)) flag(n, text, 'says "version"');
          else if ((ts.isTemplateHead(n) || ts.isTemplateMiddle(n)) && BADGE_TAIL.test(text)) {
            flag(n, text, 'V-badge');
          }
        }
      } else if (ts.isJsxText(n)) {
        if (WORD.test(n.text)) flag(n, n.text, 'says "version"');
        else if (BADGE_TAIL.test(n.text)) flag(n, n.text, 'V-badge');
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return offenders;
}

test('no user-facing string says "version": the word is "submission"', () => {
  const offenders = findOffenders();
  assert.deepEqual(offenders, [], `\n${offenders.join('\n')}\n`);
});
```

- [ ] **Step 2: Run it to see what is left**

Run: `node --test scripts/tests/copyTerms.test.mjs`
Expected: FAIL, listing roughly 60 offenders, all in the 14 files of this task. If an offender is in a file **not** listed in this task, a previous task missed it. Fix it here too.

- [ ] **Step 3: `app/portal/[id]/page.tsx`**

Add `import { submissionBadge, submissionTitle } from '@/lib/submissionName';`.

| Old | New |
|---|---|
| `toast('Could not delete this version');` | `toast('Could not delete this submission');` |
| ``toast(`Version ${target.versionNumber} deleted`);`` | ``toast(`${submissionTitle(target)} deleted`);`` |
| ``title={`Delete version ${versionToDelete.versionNumber}?`}`` | ``title={`Delete "${submissionTitle(versionToDelete)}"?`}`` |
| ``name={`V${versionToDelete.versionNumber}`}`` | `name={submissionBadge(versionToDelete.versionNumber)}` (this is the text the user types to confirm, so it stays short) |
| `…Everyone loses this version and every comment…` | `…Everyone loses this submission and every comment…` |
| `confirmLabel="Delete version"` | `confirmLabel="Delete submission"` |

- [ ] **Step 4: `components/portal/NewVersionDrawer.tsx`**

Add `import { submissionBadge } from '@/lib/submissionName';`.

| Old | New |
|---|---|
| `'Could not start the version'` | `'Could not start the submission'` |
| `'Could not publish the version'` | `'Could not publish the submission'` |
| ``toast(`Version ${nextVersionNumber} published`);`` | ``toast(`Submission ${nextVersionNumber} published`);`` |
| ``title={`Submit version ${nextVersionNumber}`}`` | ``title={`Add submission ${nextVersionNumber}`}`` |
| ``: `Publish version ${nextVersionNumber}`}`` | ``: `Publish submission ${nextVersionNumber}`}`` |
| `Shown on the version and in the notification your reviewers receive.` | `Shown on the submission and in the notification your reviewers receive.` |

The carry-over note (around line 294) currently reads `…on V` + newline + `{currentVersionNumber} will carry over…`. Replace those two lines with:

```tsx
            {openComments} open comment{openComments === 1 ? '' : 's'} on{' '}
            {currentVersionNumber != null
              ? submissionBadge(currentVersionNumber)
              : 'the current submission'}{' '}
            will carry over and stay pinned to their
```

(`currentVersionNumber` is typed `number | null`; the old code would have rendered a bare "V".)

- [ ] **Step 5: `app/new/page.tsx`**

| Old | New |
|---|---|
| `useState('First version')` (line 48) | `useState('First submission')` |
| `'Could not start the version'` | `'Could not start the submission'` |
| `changelog.trim() \|\| 'First version'` (line 186) | `changelog.trim() \|\| 'First submission'` |
| `'Could not publish the version'` | `'Could not publish the submission'` |
| `The version is published only when every file lands — a failure`<br>`here never leaves a half-empty V1 for your reviewers.` | `The submission is published only when every file lands — a failure`<br>`here never leaves a half-empty S1 for your reviewers.` |
| `hint="shown on the version"` | `hint="shown on the submission"` |
| `placeholder="First version"` | `placeholder="First submission"` |

- [ ] **Step 6: `app/page.tsx`, `app/invite/[token]/page.tsx`, `app/portal/[id]/settings/page.tsx`**

`app/page.tsx`: `whenever a new version lands.` → `whenever a new submission lands.`

`app/invite/[token]/page.tsx`: add `import { submissionBadge } from '@/lib/submissionName';`, then:
- `first version lands.` → `first submission lands.`
- `V{invite.version.versionNumber}` → `{submissionBadge(invite.version.versionNumber)}`

`app/portal/[id]/settings/page.tsx`: add `import { submissionBadge } from '@/lib/submissionName';`, then:

| Old | New |
|---|---|
| `` · ${data.counts.versions} version${data.counts.versions === 1 ? '' : 's'} · `` (line 189) | `` · ${data.counts.versions} submission${data.counts.versions === 1 ? '' : 's'} · `` |
| `Set on the version, not here` | `Set on the submission, not here` |
| `` ` — V${data.latestVersionNumber} currently ${statusPhrase(data.status)}.` `` | `` ` — ${submissionBadge(data.latestVersionNumber)} currently ${statusPhrase(data.status)}.` `` |
| `Open V{data.latestVersionNumber}` | `Open {submissionBadge(data.latestVersionNumber)}` |
| `` `All ${data.counts.versions} version${data.counts.versions === 1 ? '' : 's'}, `` (line 314) | `` `All ${data.counts.versions} submission${data.counts.versions === 1 ? '' : 's'}, `` |
| `{ label: 'Versions', value: data.counts.versions }` | `{ label: 'Submissions', value: data.counts.versions }` |

- [ ] **Step 7: Home components**

`components/home/ProjectPanel.tsx`: add `import { submissionBadge } from '@/lib/submissionName';`, then `V{pkg.versionNumber}` → `{submissionBadge(pkg.versionNumber)}`.

`components/home/ProjectSummaryPanel.tsx`:
- `…this project’s comments and versions and write one.` → `…this project’s comments and submissions and write one.`
- `{versions === 1 ? 'version' : 'versions'}` → `{versions === 1 ? 'submission' : 'submissions'}`

- [ ] **Step 8: People and share components**

`components/people/AccessEditor.tsx`: add `import { submissionBadge } from '@/lib/submissionName';`, then:

| Old | New |
|---|---|
| `'Uploaders can do everything a commenter can, and publish versions.'` | `'Uploaders can do everything a commenter can, and publish submissions.'` |
| `'Could not change which versions they can see'` | `'Could not change which submissions they can see'` |
| `toast('Versions updated')` | `toast('Submissions updated')` |
| `'Keep at least one version selected, or turn "All versions" back on.'` (twice) | `'Keep at least one submission selected, or turn "All submissions" back on.'` |
| `Versions they can see` | `Submissions they can see` |
| `'Could not load versions — close and reopen this drawer to retry.'` (twice) | `'Could not load submissions — close and reopen this drawer to retry.'` |
| `'This package has no published versions to narrow to yet.'` | `'This package has no published submissions to narrow to yet.'` |
| `All versions, including future ones` | `All submissions, including future ones` |
| `V{v.versionNumber}` | `{submissionBadge(v.versionNumber)}` |
| `'No versions published yet.'` | `'No submissions published yet.'` |
| `Pick at least one version — nothing is sent until you do.` | `Pick at least one submission — nothing is sent until you do.` |

`components/people/AddPeopleModal.tsx`: add `import { submissionBadge } from '@/lib/submissionName';`, then:
- `` ` · V${pkg.versionNumber}` `` → `` ` · ${submissionBadge(pkg.versionNumber)}` ``
- `Versions they can see` → `Submissions they can see`
- `All versions, including future ones` → `All submissions, including future ones`
- `V{v.versionNumber}` → `{submissionBadge(v.versionNumber)}`

`components/portal/ShareModal.tsx`: add `import { submissionBadge } from '@/lib/submissionName';`, then, **both occurrences of each** (the email invite and the link invite):
- `Versions they can see` → `Submissions they can see`
- `All versions, including future ones` → `All submissions, including future ones`
- `V{v.versionNumber}` → `{submissionBadge(v.versionNumber)}`

The pickers' data doesn't carry `name`, so no tooltips are added. The spec adds a tooltip only where the name is already in the payload.

- [ ] **Step 9: Remaining portal and ui components**

`components/portal/VersionBrief.tsx`: `` …comments on this version into themes.` `` → `` …comments on this submission into themes.` ``

`components/portal/WhoCanSeeThis.tsx`: `Everything here — files, versions and every comment.` → `Everything here — files, submissions and every comment.`

`components/ui/UploadProgress.tsx`: add `import { submissionBadge } from '@/lib/submissionName';`, then `Replaces V{item.replacesVersion}` → `Replaces {submissionBadge(item.replacesVersion)}`. It sits inside `item.replacesVersion != null &&`, so the value is a number there. If TypeScript does not narrow it through the JSX, pass `item.replacesVersion as number`.

- [ ] **Step 10: Run the guard and everything else**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: `copyTerms.test.mjs` passes with an empty offender list, all other tests pass, tsc is silent, and lint is clean.

- [ ] **Step 11: Commit**

```bash
cd /Users/user/Desktop/STIKO-main
git add scripts/tests/copyTerms.test.mjs "app/portal/[id]/page.tsx" components/portal/NewVersionDrawer.tsx app/new/page.tsx app/page.tsx "app/invite/[token]/page.tsx" "app/portal/[id]/settings/page.tsx" components/home/ProjectPanel.tsx components/home/ProjectSummaryPanel.tsx components/people/AccessEditor.tsx components/people/AddPeopleModal.tsx components/portal/ShareModal.tsx components/portal/VersionBrief.tsx components/portal/WhoCanSeeThis.tsx components/ui/UploadProgress.tsx
git commit -m "$(cat <<'EOF'
copy(ui): version -> submission everywhere, guarded by a source scan

copyTerms.test.mjs walks every string literal and JSX text in app/,
components/ and lib/ and fails on user-facing "version" or a V-badge.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
git show --name-only --pretty=format: HEAD
```
Expected: exactly those 15 paths.

---

### Task 8: Verify in a browser, then hand back

**Files:** none changed, unless the pass finds a defect. In that case, fix it, re-run Step 1, and commit the fix with named paths.

- [ ] **Step 1: The full gate**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass, and the build ends with the route table and no errors. If the build fails at "Collect page data" complaining about R2 or S3 variables, that's missing local config, not a code defect. Rerun with the throwaway variables:
```bash
AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' R2_ACCESS_KEY_ID=dev R2_SECRET_ACCESS_KEY=dev R2_ENDPOINT_URL='https://example.invalid' R2_BUCKET_NAME=dev npm run build
```

- [ ] **Step 2: Confirm the migration is applied (Task 2 Step 9)**

If the user hasn't confirmed it, ask now. Without it, `GET /api/versions` throws on `v.name`, and every package renders empty with no visible error.

- [ ] **Step 3: Start a production server**

Run the server in the background: `npm run build && npm start` (use a production build, **not** `npm run dev`, whose pdfjs crash blanks the page). Open `http://localhost:3000` with chrome-devtools `new_page`.

**Which data to touch.** Local dev reads and writes production. **Ask the user** which package to use. The package in their screenshot ("test test" in "kjsadnaksjnd", 5 submissions) is the obvious candidate, but only with their OK. Every rename made during the pass is cleared back to the default at the end. If the local session can't reach that package (the local Chrome profile has previously had a stale session and zero projects), ask the user to sign in in that browser. Don't work around it by stubbing a write.

- [ ] **Step 4: The checks (from the spec)**

1. **Rail:** every card shows "Submission N" titles and S-badges. The newest card has the white CURRENT pill on its date line. The header reads "Submissions" and the button reads "Add new submission".
2. **Rename:** open S5's details, click the pencil, type `Revised per structural notes` and press Enter. The drawer title and the rail card both change with no reload. Reload the page and the name is still there.
3. **Escape:** click the pencil, type something, press Escape. The edit is cancelled, the old title is back, and **the drawer is still open**. Press Escape again and the drawer closes.
4. **Clear:** reopen, click the pencil, clear the field (use the native-setter snippet from the local-verification notes if a fill doesn't reach React), press Enter. The title reads "Submission 5" again.
5. **Limit:** the input's `maxLength` is 80. Confirm by evaluating `document.querySelector('input[aria-label="Submission name"]').maxLength`.
6. **Blur:** click the pencil, type a name, click elsewhere in the drawer. It saves exactly once: check the network list for a single `PATCH /api/versions/…`.
7. **Two tabs:** open the same package in a second page. Rename in the first. Within one poll interval, the second tab's rail shows the new name without a reload.
8. **Commenter:** if the user has a commenter account on a test package, confirm no pencil appears. Otherwise, record that this was checked only by the server tests and the `canRename` flag.
9. **Delete confirm (don't confirm it):** open S1's delete. The title reads `Delete "Submission 1"?` and the text to type is `S1`. Cancel.
10. **Spot-check the sweep:** the "Add new submission" drawer reads "Add submission 6" and "Publish submission 6". The share modal's pickers show S-chips.
11. **Clean up:** clear every name set during the pass (step 4's method) so the test package is as it was.

- [ ] **Step 5: Hand back**

Report what was verified and what wasn't (e.g. check 8). Then use `superpowers:finishing-a-development-branch`. Merging and pushing need the user's go-ahead, because `main` auto-deploys to production. **Rollback:** revert the merge commit. The two new columns can stay; nothing else reads them.
