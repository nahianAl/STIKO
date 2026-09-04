# Version Detail Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move per-file and per-version delete/download controls, plus the AI Brief, out of the always-visible UI and into a version detail drawer opened from a single icon on each version card.

**Architecture:** A new `VersionDetailDrawer` built on the existing `components/ui/Drawer.tsx` primitive renders a version's files, changelog, Brief and delete action. The version rail reverts to pure navigation. Brief *display* moves into the drawer while Brief *generation* moves to the portal page, so the version card's headline keeps appearing. All formatting logic lands in a pure, unit-tested `lib/versionDetail.ts`.

**Tech Stack:** Next.js 14.2.35 App Router, React 18, TypeScript, Tailwind (Stiko design tokens), Neon serverless Postgres via tagged-template `sql`, `node:test` unit tests run with `npm test`.

## Global Constraints

- **Never re-derive a permission client-side.** Controls render only from server-sent `canDelete` / `canDownload` / `version.canDelete`. A hidden control and a 403 must not be able to disagree.
- **404, never 403, for access failures** in any route touched. No id may become an existence oracle.
- **No new API routes.** Exactly one route changes: `app/api/files/route.ts` gains a `LEFT JOIN users`.
- **No access-control logic changes.** `getVersionAccess`, `canDeleteContent`, `canDownloadFile` are read, never edited.
- **Adding files to an existing version is out of scope.** Do not add an upload control to the drawer.
- **Unit tests cover pure modules only.** This repo has no React component test harness; do not add one.
- **Test command is `npm test`** (`node --test scripts/tests/*.mjs`). Node strips TypeScript natively, so `.mjs` tests import `.ts` modules directly with an explicit `.ts` extension.
- **Stiko design tokens only** — `stiko-*` and `note-*` Tailwind classes. No raw hex outside the gradient `linear-gradient(135deg, #8094F5, #5B60FF)` already used across the app.
- Every task ends green on `npx tsc --noEmit`, `npm test`, and `npm run lint`.

## Refinements to the spec

The spec's §8 sketched `versionSubtitle` and `fileMetaLine` as taking raw ISO
timestamps. This plan passes them **pre-formatted date strings** instead.
Formatting a timestamp calls `toLocaleDateString`, whose output depends on the
machine's timezone, so asserting on it in a unit test makes the suite fail in
some regions and pass in others. The branching logic — which is where the bugs
are — stays pure and fully tested; the one-line date format stays in the
component, matching how `FileTreeSidebar` already does it.

## File Structure

| File | Responsibility |
|---|---|
| `lib/types.ts` | Shared `Version` and `FileRecord` shapes. Gains the fields the drawer needs; becomes the single declaration site. |
| `app/api/files/route.ts` | Adds `uploadedByName` via `LEFT JOIN users`. No other change. |
| `lib/versionDetail.ts` | **New.** Pure formatting/branching helpers. Imports nothing. |
| `scripts/tests/versionDetail.test.mjs` | **New.** Unit tests for the above. |
| `components/portal/VersionBrief.tsx` | Loses auto-generation; keeps display, manual generate/refresh, stale-response guards. |
| `app/portal/[id]/page.tsx` | Owns the one auto-generate trigger, `detailVersionId` state, and renders the drawer. |
| `components/portal/VersionDetailDrawer.tsx` | **New.** Files, changelog, Brief, delete-version. |
| `components/portal/FileTreeSidebar.tsx` | Loses all delete/download controls; gains the expand icon. |
| `components/portal/CommentsPanel.tsx` | Loses the Brief block and two now-dead props. |

---

## Task 1: Shared types and the uploader's name

**Files:**
- Modify: `lib/types.ts:24-51`
- Modify: `app/api/files/route.ts:26-37`
- Modify: `components/portal/FileTreeSidebar.tsx:1-40`
- Modify: `app/portal/[id]/page.tsx:48-59`

**Interfaces:**
- Consumes: nothing.
- Produces: `Version` and `FileRecord` from `@/lib/types`, imported by every later task. `FileRecord.uploadedByName: string | null`. `Version.publishedAt: string | null`, `Version.changelog: string | null`, `Version.createdByName: string | null`, `Version.canDelete?: boolean`, `Version.fileCount?: number`, `Version.commentCount?: number`.

There is no unit test in this task — it changes type declarations and one SQL
projection, neither of which the pure-module suite can reach. `npx tsc --noEmit`
is the gate: deleting the duplicate declarations makes the compiler prove every
consumer agrees.

- [ ] **Step 1: Extend the shared `Version` interface**

In `lib/types.ts`, replace the existing `Version` interface with:

```ts
export interface Version {
  id: string;
  portalId: string;
  versionNumber: number;
  createdAt: string;
  /** Null until the version is published. Drafts are visible only to uploaders. */
  publishedAt: string | null;
  /** Verbatim what the uploader wrote when submitting. Set at publish, so null
   *  on drafts and on rows that predate the field. */
  changelog: string | null;
  /** Display name of whoever created the version. Null when that user row was
   *  deleted — the created_by FK is ON DELETE SET NULL. */
  createdByName: string | null;
  /** Server's verdict on whether this caller may delete it. Never re-derived
   *  client-side. */
  canDelete?: boolean;
  fileCount?: number;
  commentCount?: number;
}
```

- [ ] **Step 2: Add `uploadedByName` to the shared `FileRecord`**

In the same file, inside `export interface FileRecord`, immediately after the
existing `uploadedBy: string | null;` line, add:

```ts
  /** Display name for `uploadedBy`. Null for two legitimate reasons: the
   *  uploader's user row was deleted (uploaded_by is ON DELETE SET NULL), or a
   *  row predating migration 005 was backfilled from a null versions.created_by.
   *  The UI must say so rather than guess. */
  uploadedByName: string | null;
```

- [ ] **Step 3: Return the uploader's name from the files route**

In `app/api/files/route.ts`, replace the `rows` query. Every column must become
qualified — an unqualified `id` is ambiguous once `users` is joined:

```ts
  const rows = await sql`
    SELECT f.id, f.version_id AS "versionId", f.filename,
           f.storage_key AS "storageKey",
           f.file_size AS "fileSize", f.file_type AS "fileType",
           f.conversion_status AS "conversionStatus",
           f.converted_storage_key AS "convertedStorageKey",
           f.conversion_job_id AS "conversionJobId",
           f.folder_path AS "folderPath",
           f.uploaded_by AS "uploadedBy",
           u.name AS "uploadedByName",
           f.position_x AS "positionX", f.position_y AS "positionY",
           f.position_z AS "positionZ",
           f.rotation_x AS "rotationX", f.rotation_y AS "rotationY",
           f.rotation_z AS "rotationZ",
           f.created_at AS "createdAt"
    FROM files f
    LEFT JOIN users u ON u.id = f.uploaded_by
    WHERE f.version_id = ${versionId}
    ORDER BY f.folder_path ASC NULLS FIRST, f.created_at ASC
  `;
```

`LEFT JOIN`, not `JOIN`: a file whose `uploaded_by` is null must still be
returned. Change nothing else in this route — the `getVersionAccess` gate, the
`canDelete` / `canDownload` computation and the comment-count query are all
untouched.

- [ ] **Step 4: Delete the duplicate declarations in the sidebar**

In `components/portal/FileTreeSidebar.tsx`, delete the local
`interface Version { … }` and `interface FileRecord { … }` blocks entirely
(they sit between the imports and `interface FileTreeSidebarProps`).

The file's existing `import type { ObjectTransform } from '@/lib/objectTransform';`
exists only to type the local `FileRecord.transform` field, so it becomes
unused. Delete that line and put this in its place:

```ts
import type { FileRecord, Version } from '@/lib/types';
```

- [ ] **Step 5: Delete the duplicate declaration in the portal page**

In `app/portal/[id]/page.tsx`, delete the local `interface Version { … }` block
(including its comment about staying assignable to FileTreeSidebar's). Change
the existing type import on line 22 to:

```ts
import type { Comment, FileRecord, Version } from '@/lib/types';
```

- [ ] **Step 6: Verify**

Run each and report the actual output:

```bash
npx tsc --noEmit
npm test
npm run lint
```

Expected: `tsc` clean, 329 tests passing, lint clean. If `tsc` reports an error
at any other consumer of `Version` or `FileRecord`, that consumer was relying on
a shape the API does not actually return — report it as BLOCKED with the file
and line rather than widening a type to silence it.

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts app/api/files/route.ts \
        components/portal/FileTreeSidebar.tsx "app/portal/[id]/page.tsx"
git commit -m "refactor: one declaration of Version and FileRecord, plus uploader name

The files route returned uploaded_by as a bare user id, which the version
drawer cannot display. It now LEFT JOINs users for uploadedByName — LEFT so a
file whose uploader row was deleted is still returned.

lib/types already exported both interfaces, but FileTreeSidebar redeclared
each and the portal page redeclared Version, with a comment documenting the
friction that caused. Adding three fields in three places is what finally made
that worth fixing."
```

---

## Task 2: Pure formatting helpers

**Files:**
- Create: `lib/versionDetail.ts`
- Create: `scripts/tests/versionDetail.test.mjs`

**Interfaces:**
- Consumes: nothing. This module imports nothing at all, so it loads without a database — the same rule `lib/brief.ts` follows.
- Produces:
  - `uploaderLabel(name: string | null): string`
  - `formatFileSize(bytes: number): string`
  - `versionSubtitle(input: { isCurrent: boolean; isPublished: boolean; dateLabel: string; createdByName: string | null }): string`
  - `changelogFallback(input: { changelog: string | null; isPublished: boolean }): string | null`
  - `fileMetaLine(input: { uploadedByName: string | null; dateLabel: string; fileSize: number }): string`

- [ ] **Step 1: Write the failing tests**

Create `scripts/tests/versionDetail.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  uploaderLabel,
  formatFileSize,
  versionSubtitle,
  changelogFallback,
  fileMetaLine,
} from '../../lib/versionDetail.ts';

// --- Who uploaded it ------------------------------------------------------

test('a known uploader is named', () => {
  assert.equal(uploaderLabel('Maya Chen'), 'Maya Chen');
});

test('a missing uploader is stated, not guessed', () => {
  // uploaded_by is ON DELETE SET NULL, and pre-migration-005 rows were
  // backfilled from versions.created_by, which can itself be null.
  assert.equal(uploaderLabel(null), 'Uploader unknown');
});

test('an empty name is treated as missing, not printed as blank', () => {
  assert.equal(uploaderLabel(''), 'Uploader unknown');
});

// --- Sizes ----------------------------------------------------------------

test('bytes below a kilobyte are shown as bytes', () => {
  assert.equal(formatFileSize(900), '900 B');
});

test('kilobytes carry one decimal', () => {
  assert.equal(formatFileSize(2048), '2.0 KB');
});

test('megabytes carry one decimal', () => {
  assert.equal(formatFileSize(2516582), '2.4 MB');
});

test('the boundary at one kibibyte is a kilobyte, not 1024 bytes', () => {
  assert.equal(formatFileSize(1024), '1.0 KB');
});

test('the boundary at one mebibyte is a megabyte', () => {
  assert.equal(formatFileSize(1048576), '1.0 MB');
});

// --- The drawer header ----------------------------------------------------

test('the current published version says so', () => {
  assert.equal(
    versionSubtitle({
      isCurrent: true,
      isPublished: true,
      dateLabel: 'Sep 2, 2026',
      createdByName: 'Maya Chen',
    }),
    'Current · Published Sep 2, 2026 by Maya Chen'
  );
});

test('an older published version omits the Current marker', () => {
  assert.equal(
    versionSubtitle({
      isCurrent: false,
      isPublished: true,
      dateLabel: 'Aug 28, 2026',
      createdByName: 'Maya Chen',
    }),
    'Published Aug 28, 2026 by Maya Chen'
  );
});

test('a draft is labelled a draft and dated by creation', () => {
  assert.equal(
    versionSubtitle({
      isCurrent: true,
      isPublished: false,
      dateLabel: 'Sep 2, 2026',
      createdByName: 'Maya Chen',
    }),
    'Draft · Created Sep 2, 2026 by Maya Chen'
  );
});

test('a deleted author drops the by-clause rather than printing null', () => {
  assert.equal(
    versionSubtitle({
      isCurrent: false,
      isPublished: true,
      dateLabel: 'Aug 28, 2026',
      createdByName: null,
    }),
    'Published Aug 28, 2026'
  );
});

// --- The changelog section ------------------------------------------------

test('a real changelog needs no fallback', () => {
  assert.equal(
    changelogFallback({ changelog: 'Reworked the ceiling plan.', isPublished: true }),
    null
  );
});

test('a published version with no changelog says nothing was written', () => {
  assert.equal(
    changelogFallback({ changelog: null, isPublished: true }),
    'No description was written for this version.'
  );
});

test('whitespace is not a changelog', () => {
  assert.equal(
    changelogFallback({ changelog: '   \n  ', isPublished: true }),
    'No description was written for this version.'
  );
});

test('a draft says it is not published rather than that nothing was written', () => {
  // The changelog is captured at publish time, so a draft has not had the
  // chance to carry one. Reporting it as missing would blame the uploader.
  assert.equal(
    changelogFallback({ changelog: null, isPublished: false }),
    'Not published yet.'
  );
});

// --- The file card meta line ----------------------------------------------

test('the meta line joins uploader, date and size', () => {
  assert.equal(
    fileMetaLine({
      uploadedByName: 'Maya Chen',
      dateLabel: 'Sep 2, 4:12 PM',
      fileSize: 2516582,
    }),
    'Maya Chen · Sep 2, 4:12 PM · 2.4 MB'
  );
});

test('the meta line still reads correctly with no uploader', () => {
  assert.equal(
    fileMetaLine({
      uploadedByName: null,
      dateLabel: 'Aug 30, 11:02 AM',
      fileSize: 921600,
    }),
    'Uploader unknown · Aug 30, 11:02 AM · 900.0 KB'
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`

Expected: FAIL — `Cannot find module` for `../../lib/versionDetail.ts`.

- [ ] **Step 3: Write the implementation**

Create `lib/versionDetail.ts`:

```ts
/**
 * Pure presentation logic for the version detail drawer.
 *
 * Imports nothing, so tests load it without a database — the same split that
 * keeps lib/brief.ts loadable when DATABASE_URL is unset.
 *
 * Dates arrive already formatted. Formatting them here would mean asserting on
 * toLocaleDateString output, which varies by the machine's timezone and would
 * make this suite pass or fail by region.
 */

/**
 * Who uploaded a file, or an honest admission that we do not know.
 *
 * files.uploaded_by is ON DELETE SET NULL, and rows predating migration 005
 * were backfilled from versions.created_by, which can itself be null. Guessing
 * — "the version author probably uploaded it" — would attribute a file to
 * someone who may not have touched it.
 */
export function uploaderLabel(name: string | null): string {
  return name && name.trim() ? name : 'Uploader unknown';
}

/** One decimal from a kilobyte up, matching the local helper in CommentsPanel. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The drawer's header subtitle. Varies on two axes: whether this is the newest
 * version in the package, and whether it has been published.
 *
 * `createdByName` is null when the author's user row was deleted; the by-clause
 * is dropped rather than rendering "by null".
 */
export function versionSubtitle({
  isCurrent,
  isPublished,
  dateLabel,
  createdByName,
}: {
  isCurrent: boolean;
  isPublished: boolean;
  dateLabel: string;
  createdByName: string | null;
}): string {
  const by = createdByName && createdByName.trim() ? ` by ${createdByName}` : '';
  if (!isPublished) return `Draft · Created ${dateLabel}${by}`;
  const prefix = isCurrent ? 'Current · ' : '';
  return `${prefix}Published ${dateLabel}${by}`;
}

/**
 * What to show instead of a changelog, or null when there is a real one.
 *
 * A draft gets a different line from a published version with an empty
 * changelog: the field is captured at publish time, so "no description was
 * written" would blame an uploader who has not reached that step yet.
 */
export function changelogFallback({
  changelog,
  isPublished,
}: {
  changelog: string | null;
  isPublished: boolean;
}): string | null {
  if (changelog && changelog.trim()) return null;
  return isPublished
    ? 'No description was written for this version.'
    : 'Not published yet.';
}

/** The second line of a file card: who, when, how big. */
export function fileMetaLine({
  uploadedByName,
  dateLabel,
  fileSize,
}: {
  uploadedByName: string | null;
  dateLabel: string;
  fileSize: number;
}): string {
  return `${uploaderLabel(uploadedByName)} · ${dateLabel} · ${formatFileSize(fileSize)}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`

Expected: PASS — 329 previous tests plus 18 new ones, 347 total.

- [ ] **Step 5: Commit**

```bash
git add lib/versionDetail.ts scripts/tests/versionDetail.test.mjs
git commit -m "feat: pure formatting helpers for the version drawer

Dates arrive pre-formatted rather than as ISO strings: formatting here would
mean asserting on toLocaleDateString, whose output depends on the machine's
timezone, so the suite would pass or fail by region. The branching — draft
versus published, current versus older, missing author, missing uploader,
whitespace-only changelog — is what carries the bugs, and all of it is tested."
```

---

## Task 3: Move Brief generation to the portal page

**Files:**
- Modify: `components/portal/VersionBrief.tsx:1-160`
- Modify: `app/portal/[id]/page.tsx:555-581`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `VersionBrief` becomes display-plus-manual-generate only. The portal page owns the sole auto-generate trigger, keyed on `selectedVersionId`.

**Why this task exists.** The version card's headline is read by the page from
`GET /api/versions/[id]/summary`, which never generates a brief — it only
returns one that already exists. Generation happens today as a side effect of
`VersionBrief` mounting, which occurs whenever a version is selected because
the component lives in the comment panel. Once it moves into the drawer
(Task 4), that mount only happens when someone opens the drawer. No brief means
no headline, no headline means no hint that a Brief exists, and no hint means
nobody opens the drawer. The loop never starts.

So the trigger stays on version selection and only the display moves. After
this task the Brief still renders in the comment panel and still generates on
selection — the observable behaviour is unchanged. That is the point: this task
is a safe relocation with no user-visible effect, verified before anything moves.

- [ ] **Step 1: Remove auto-generation from `VersionBrief`**

In `components/portal/VersionBrief.tsx`, delete all four of these:

1. The `AUTO_GENERATE_THRESHOLD` constant and its comment.
2. The `autoAttempted` ref and its comment.
3. The `loadedFor` ref and its comment, **and** the `loadedFor.current = target;`
   assignments inside `load()` and `generate()`.
4. The entire second `useEffect` — the one beginning
   `if (loadedFor.current !== versionId) return;`.

In the first `useEffect`, delete the `autoAttempted.current = null;` and
`loadedFor.current = null;` lines; keep the rest of its body.

`BRIEF_MIN_COMMENTS` was imported solely to define `AUTO_GENERATE_THRESHOLD`,
so remove it from the `@/lib/brief` import list. `shouldShowBrief`,
`briefDigest`, `statChips` and `stalenessLine` all stay — they are still used
by the render.

**Keep everything else**, in particular the `currentVersion` ref and every
`if (target !== currentVersion.current) return;` guard. Those protect against a
slow response for one version landing in another version's panel, and are
unrelated to auto-generation.

- [ ] **Step 2: Add the single trigger to the portal page**

In `app/portal/[id]/page.tsx`, immediately after the existing headline-fetching
`useEffect` (the one ending `}, [versions]);`), add:

```tsx
  // One auto-generate attempt per selected version.
  //
  // This used to live inside VersionBrief, which mounted in the comment panel
  // whenever a version was selected. The component now lives in the version
  // drawer, which most people never open — and the card headline below is read
  // from a GET that never generates. Leaving the trigger in the component would
  // mean no brief, so no headline, so no hint that a Brief exists, so nobody
  // opens the drawer. The cadence here is exactly what the component did: one
  // attempt per selected version, per mount.
  useEffect(() => {
    const target = selectedVersionId;
    if (!target) return;
    if (autoBriefAttempted.current === target) return;
    // Claimed synchronously, before any await. React re-invokes effects in
    // development, and a guard set after an await lets both invocations through
    // to a paid endpoint. The cost of claiming early is that a network failure
    // skips this version for the rest of the session — acceptable, because the
    // drawer's Summarise and Refresh buttons both still work.
    autoBriefAttempted.current = target;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/versions/${target}/summary`);
        if (cancelled || !res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        // Switched off for the deployment, unconfigured, or already summarised.
        if (!body.enabled || !body.configured || body.brief) return;
        if ((body.facts?.commentCount ?? 0) < BRIEF_MIN_COMMENTS) return;

        const gen = await fetch(`/api/versions/${target}/summary`, { method: 'POST' });
        if (cancelled || !gen.ok) return;
        const genBody = await gen.json();
        if (cancelled) return;
        const headline = genBody.brief?.headline;
        // Fold the new headline straight into the rail rather than refetching
        // every version's summary again.
        if (headline) setHeadlines((h) => ({ ...h, [target]: headline }));
      } catch {
        // A brief is an enhancement. Failing to produce one must not put an
        // error in front of someone reviewing drawings.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedVersionId]);
```

- [ ] **Step 3: Declare the guard ref and import the threshold**

In the same file, beside the other `useRef` declarations near the top of the
component, add:

```tsx
  // Which version an auto-generate has already been attempted for this mount.
  const autoBriefAttempted = useRef<string | null>(null);
```

And add the import beside the other `@/lib` imports:

```tsx
import { BRIEF_MIN_COMMENTS } from '@/lib/brief';
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npm test
npm run lint
```

Expected: `tsc` clean, 347 tests passing, lint clean.

`npm test` covers `lib/brief.ts` but not either file changed here, so state
plainly in your report that the suite does not exercise this change and that
`tsc` and lint are the automated gates for it.

- [ ] **Step 5: Commit**

```bash
git add components/portal/VersionBrief.tsx "app/portal/[id]/page.tsx"
git commit -m "refactor: move Brief auto-generation from the component to the page

The version card's headline comes from a GET that never generates a brief;
generation happened as a side effect of VersionBrief mounting in the comment
panel. Moving that component into the version drawer would have meant briefs
were only generated once someone opened the drawer — but the headline is the
hint that makes anyone open it. The loop would never start.

The trigger now sits on version selection, which is where the component's
mount effectively put it, so the cadence and the model spend are unchanged.
The guard ref is claimed before the first await: React re-invokes effects in
development, and a guard set afterwards lets both invocations reach a paid
endpoint."
```

---

## Task 4: The version detail drawer component

**Files:**
- Create: `components/portal/VersionDetailDrawer.tsx`

**Interfaces:**
- Consumes: `Version`, `FileRecord` from `@/lib/types` (Task 1); `versionSubtitle`, `changelogFallback`, `fileMetaLine` from `@/lib/versionDetail` (Task 2 — `uploaderLabel` and `formatFileSize` are reached through `fileMetaLine`, not imported here); `VersionBrief` from `@/components/portal/VersionBrief`; `Drawer` from `@/components/ui/Drawer`; `getFileChip` from `@/lib/fileChips`; `SkeletonBar` from `@/components/ui/Primitives`.
- Produces: default export `VersionDetailDrawer` with exactly this prop shape:

```ts
{
  version: Version | null;      // null = closed
  isCurrent: boolean;
  files: FileRecord[];
  filesLoading: boolean;
  onClose: () => void;
  onSelectFile: (fileId: string) => void;
  onSelectCitedComment: (commentId: string, fileId: string) => void;
  onDeleteFile?: (file: FileRecord) => void;
  onDownloadFile?: (file: FileRecord) => void;
  onDeleteVersion?: (version: Version) => void;
}
```

This task builds the component but does not render it anywhere. Task 5 wires it
in. Its pure logic is already covered by Task 2's tests; `tsc` and lint are the
gates here.

- [ ] **Step 1: Write the component**

Create `components/portal/VersionDetailDrawer.tsx`:

```tsx
'use client';

import React from 'react';
import Drawer from '@/components/ui/Drawer';
import VersionBrief from '@/components/portal/VersionBrief';
import { SkeletonBar } from '@/components/ui/Primitives';
import { getFileChip } from '@/lib/fileChips';
import {
  changelogFallback,
  fileMetaLine,
  versionSubtitle,
} from '@/lib/versionDetail';
import type { FileRecord, Version } from '@/lib/types';

/**
 * Everything about one version, behind one icon.
 *
 * This exists so the rail can go back to being a navigator. Deleting is rare —
 * well under one percent of the time anyone spends looking at a version — and
 * its controls were attached to the rows people click constantly.
 *
 * The Brief lives here too. It summarises a whole version, but it used to
 * render inside the per-file comment panel, so the same brief was repeated
 * above every file's comments in the narrowest column on the page.
 *
 * Every control gates on a server-sent verdict. Nothing here re-derives a
 * permission: a hidden button and a 403 must never be able to disagree.
 */

const FOCUS = 'focus:outline-none focus-visible:shadow-stiko-focus';

/** Matches the rail's format, so the same file reads the same in both places. */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-[9px] text-[10px] font-extrabold uppercase tracking-label text-stiko-faint">
      {children}
    </h3>
  );
}

function FileCard({
  file,
  onSelect,
  onDelete,
  onDownload,
}: {
  file: FileRecord;
  onSelect: () => void;
  onDelete?: (file: FileRecord) => void;
  onDownload?: (file: FileRecord) => void;
}) {
  const chip = getFileChip(file.filename, file.fileType);
  const comments = file.commentCount ?? 0;

  // A div with sibling buttons, not a button wrapping buttons: nesting is
  // invalid HTML and the two click targets fight each other.
  return (
    <div className="mb-[7px] flex items-center gap-2.5 rounded-[11px] border border-stiko-border p-[9px_10px] transition-colors hover:border-stiko-divider">
      <button
        type="button"
        onClick={onSelect}
        className={`flex min-w-0 flex-1 items-center gap-2.5 text-left ${FOCUS}`}
      >
        <span
          className="flex-shrink-0 rounded-full px-[7px] py-[3px] text-[8.5px] font-extrabold"
          style={{ background: chip.bg, color: chip.text }}
        >
          {chip.label}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-bold text-stiko-ink">
            {file.filename}
          </span>
          <span className="block truncate text-[10.5px] text-stiko-muted">
            {fileMetaLine({
              uploadedByName: file.uploadedByName,
              dateLabel: formatDateTime(file.createdAt),
              fileSize: file.fileSize,
            })}
          </span>
          {file.folderPath && (
            <span className="mt-[1px] block truncate text-[10.5px] text-stiko-faint">
              {file.folderPath}
            </span>
          )}
        </span>
      </button>

      <span
        title={`${comments} comment${comments === 1 ? '' : 's'}`}
        className={`flex flex-shrink-0 items-center gap-[3px] rounded-chip px-[7px] py-[3px] text-[9.5px] font-bold ${
          comments > 0
            ? 'bg-stiko-tint text-stiko-primary'
            : 'bg-stiko-subtle text-stiko-faint'
        }`}
      >
        <svg className="h-[9px] w-[9px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path d="M21 12c0 4.4-4 8-9 8a9.9 9.9 0 01-4.3-.9L3 20l1.4-3.7A7.9 7.9 0 013 12c0-4.4 4-8 9-8s9 3.6 9 8z" />
        </svg>
        {comments}
      </span>

      {onDownload && file.canDownload && (
        <button
          type="button"
          onClick={() => onDownload(file)}
          aria-label={`Download ${file.filename}`}
          title={`Download ${file.filename}`}
          className={`flex-shrink-0 rounded-[7px] border border-stiko-border p-[5px] text-stiko-secondary transition hover:bg-stiko-app hover:text-stiko-ink ${FOCUS}`}
        >
          <svg className="h-[13px] w-[13px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      )}

      {onDelete && file.canDelete && (
        <button
          type="button"
          onClick={() => onDelete(file)}
          aria-label={`Delete ${file.filename}`}
          title={`Delete ${file.filename}`}
          className={`flex-shrink-0 rounded-[7px] border border-stiko-chip-red p-[5px] text-note-red-text transition hover:bg-note-red ${FOCUS}`}
        >
          <svg className="h-[13px] w-[13px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default function VersionDetailDrawer({
  version,
  isCurrent,
  files,
  filesLoading,
  onClose,
  onSelectFile,
  onSelectCitedComment,
  onDeleteFile,
  onDownloadFile,
  onDeleteVersion,
}: {
  version: Version | null;
  isCurrent: boolean;
  files: FileRecord[];
  filesLoading: boolean;
  onClose: () => void;
  onSelectFile: (fileId: string) => void;
  onSelectCitedComment: (commentId: string, fileId: string) => void;
  onDeleteFile?: (file: FileRecord) => void;
  onDownloadFile?: (file: FileRecord) => void;
  onDeleteVersion?: (version: Version) => void;
}) {
  // Open is derived from the version being resolvable, not from a boolean the
  // page has to remember to clear. Deleting the version removes it from the
  // rail's list, which closes this with no extra bookkeeping.
  if (!version) return null;

  const isPublished = version.publishedAt !== null;
  const fallback = changelogFallback({ changelog: version.changelog, isPublished });

  return (
    <Drawer
      isOpen
      onClose={onClose}
      title={`Version ${version.versionNumber}`}
      subtitle={versionSubtitle({
        isCurrent,
        isPublished,
        // Published date when there is one, creation date for a draft. Written
        // as ?? rather than a non-null assertion: TypeScript cannot narrow
        // publishedAt through the isPublished boolean, and the fallback is the
        // same value the assertion would have forced.
        dateLabel: formatDay(version.publishedAt ?? version.createdAt),
        createdByName: version.createdByName,
      })}
    >
      <div className="flex flex-col gap-6">
        <section>
          <SectionLabel>Files{filesLoading ? '' : ` · ${files.length}`}</SectionLabel>
          {filesLoading ? (
            <div className="flex flex-col gap-[7px]">
              <SkeletonBar height={52} />
              <SkeletonBar height={52} secondary />
            </div>
          ) : files.length === 0 ? (
            <p className="text-[12.5px] text-stiko-faint">No files in this version.</p>
          ) : (
            files.map((file) => (
              <FileCard
                key={file.id}
                file={file}
                onSelect={() => {
                  onSelectFile(file.id);
                  onClose();
                }}
                onDelete={onDeleteFile}
                onDownload={onDownloadFile}
              />
            ))
          )}
        </section>

        <section>
          <SectionLabel>What changed in this version</SectionLabel>
          {fallback ? (
            <p className="rounded-[11px] bg-stiko-subtle p-[11px_12px] text-[12.5px] italic leading-[1.55] text-stiko-faint">
              {fallback}
            </p>
          ) : (
            <p className="whitespace-pre-wrap rounded-[11px] bg-stiko-subtle p-[11px_12px] text-[12.5px] leading-[1.55] text-stiko-secondary">
              {version.changelog}
            </p>
          )}
        </section>

        {/* Renders nothing below BRIEF_MIN_COMMENTS — no card, no placeholder. */}
        <VersionBrief
          versionId={version.id}
          onSelectComment={(commentId, fileId) => {
            onSelectCitedComment(commentId, fileId);
            onClose();
          }}
        />

        {onDeleteVersion && version.canDelete && (
          <button
            type="button"
            onClick={() => onDeleteVersion(version)}
            className={`w-full rounded-[11px] border border-stiko-chip-red bg-white p-[10px] text-[12.5px] font-bold text-note-red-text transition hover:bg-note-red ${FOCUS}`}
          >
            Delete Version {version.versionNumber} and everything in it
          </button>
        )}
      </div>
    </Drawer>
  );
}
```

Note the delete button is the last child of the scrolling body, **not** passed
to `Drawer`'s `footer` prop. A pinned footer would keep a destructive control
permanently on screen, which is the problem this whole change removes.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
npm test
npm run lint
```

Expected: `tsc` clean, 347 tests passing, lint clean. `tsc` may report the
component as unused — that is expected until Task 5 renders it. If lint fails on
an unused import, remove that import rather than suppressing the rule.

- [ ] **Step 3: Commit**

```bash
git add components/portal/VersionDetailDrawer.tsx
git commit -m "feat: version detail drawer component

Files with uploader, time, size, folder and comment count; the changelog the
uploader wrote; the version Brief; and the delete action. Every control gates
on a server-sent verdict — canDownload, canDelete, version.canDelete — so a
commenter sees the same drawer with none of them.

Open state is derived from the version being resolvable rather than a separate
boolean, so deleting the version closes the drawer with no extra bookkeeping.
The delete button is the last item in the scrolling body rather than a pinned
footer: pinning a destructive control keeps it permanently on screen, which is
what this change exists to stop."
```

---

## Task 5: Rewire the rail and the page

**Files:**
- Modify: `components/portal/FileTreeSidebar.tsx:135-260`
- Modify: `components/portal/FileTreeSidebar.tsx:300-400`
- Modify: `app/portal/[id]/page.tsx:1141-1160`

**Interfaces:**
- Consumes: `VersionDetailDrawer` from Task 4 with the prop shape declared there.
- Produces: `FileTreeSidebarProps` loses `onDeleteFile`, `onDeleteVersion`, `onDownloadFile` and gains `onOpenVersionDetails: (version: Version) => void`.

- [ ] **Step 1: Strip the controls off `FileItem`**

In `components/portal/FileTreeSidebar.tsx`, replace the whole `FileItem`
function with this. It reverts to a single `<button>` — with no sibling
controls left, the div-plus-siblings workaround is no longer needed:

```tsx
function FileItem({
  file,
  isSelected,
  onSelect,
}: {
  file: FileRecord;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const chip = getFileChip(file.filename, file.fileType);
  return (
    <button
      onClick={onSelect}
      className="group flex w-full items-center gap-2.5 py-1 text-left"
    >
      <span className="text-[9px] font-extrabold px-[7px] py-[2px] rounded-full flex-shrink-0" style={{ background: chip.bg, color: chip.text }}>
        {chip.label}
      </span>
      <span className={`truncate text-[13px] ${isSelected ? 'font-semibold text-stiko-ink' : 'font-medium text-stiko-secondary group-hover:text-stiko-ink'}`}>
        {file.filename}
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Drop the control props from `FolderItem`**

In the same file, remove the `onDeleteFile` and `onDownloadFile` parameters from
`FolderItem`'s props and from both places it passes them down — the
`<FileItem>` call and the recursive `<FolderItem>` call. Everything else in
`FolderItem` stays.

- [ ] **Step 3: Update the sidebar's prop interface**

In `FileTreeSidebarProps`, delete these three lines and their comments:

```ts
  onDeleteFile?: (file: FileRecord) => void;
  onDeleteVersion?: (version: Version) => void;
  onDownloadFile?: (file: FileRecord) => void;
```

Replace them with:

```ts
  /** Opens the version detail drawer. Required, not optional: every role can
   *  open it, and the controls inside it gate themselves individually. */
  onOpenVersionDetails: (version: Version) => void;
```

Update the component's destructured parameter list to match.

- [ ] **Step 4: Replace the version card's chevron with the expand icon**

In the `versions.map(...)` body, replace the whole `<div className="group relative">`
block — the card `<button>` and the delete button that follows it — with this:

```tsx
                {/* A div with two sibling buttons, not a button containing a
                    button: nesting is invalid HTML and the two click targets
                    would fight. The card still selects the version and expands
                    its files; the icon opens the detail drawer. */}
                <div
                  className={`flex items-center gap-3 rounded-[12px] pr-2 transition-colors ${isSelected ? 'bg-stiko-primary/20' : 'bg-stiko-primary/[0.08] hover:bg-stiko-primary/[0.14]'}`}
                >
                  <button
                    onClick={() => onSelectVersion(version.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                  >
                    <span
                      className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 text-[13px] font-extrabold"
                      style={isCurrent
                        ? { background: 'linear-gradient(135deg, #8094F5, #5B60FF)', color: '#fff' }
                        : { background: '#FFFFFF', color: '#5A6076' }}
                    >
                      V{version.versionNumber}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className={`block text-[14px] truncate ${isCurrent ? 'font-bold text-stiko-ink' : 'font-semibold text-stiko-ink'}`}>
                        {isCurrent ? 'Current' : `Version ${version.versionNumber}`}
                      </span>
                      <span className="block text-[11px] text-stiko-muted">{formatDate(version.createdAt)}</span>
                      {headlines?.[version.id] && (
                        <span className="mt-0.5 block truncate text-xs font-normal text-gray-500">
                          {headlines[version.id]}
                        </span>
                      )}
                    </span>
                  </button>

                  {/* Always visible, not hover-revealed: this is now the only
                      route to the version's files, changelog and Brief. */}
                  <button
                    onClick={() => onOpenVersionDetails(version)}
                    aria-label={`Open version ${version.versionNumber} details`}
                    title={`Version ${version.versionNumber} details`}
                    className="flex-shrink-0 rounded-[8px] p-1.5 text-stiko-primary transition hover:bg-stiko-primary/20 focus:outline-none focus-visible:shadow-stiko-focus"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5v4m0-4h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                    </svg>
                  </button>
                </div>
```

The rotating chevron is gone deliberately. The card's darker selected tint plus
the indented file list already say the version is open; re-adding a caret would
put two icons back on the row.

- [ ] **Step 5: Drop the control props from the file and folder renders**

Further down the same `versions.map` body, in the `isSelected &&` block, change
the two render calls to stop passing the removed props:

```tsx
                        {tree.rootFiles.map((file) => (
                          <FileItem key={file.id} file={file} isSelected={file.id === selectedFileId} onSelect={() => onSelectFile(file.id)} />
                        ))}
                        {tree.folders.map((folder) => (
                          <FolderItem key={folder.path} folder={folder} selectedFileId={selectedFileId} onSelectFile={onSelectFile} />
                        ))}
```

- [ ] **Step 6: Hold the drawer's state on the page**

In `app/portal/[id]/page.tsx`, beside the other `useState` declarations, add:

```tsx
  // Which version the detail drawer is showing. The version OBJECT is resolved
  // from `versions` each render rather than copied into state, so a version that
  // disappears — deleted, or dropped by a scope change — closes the drawer with
  // no extra bookkeeping.
  const [detailVersionId, setDetailVersionId] = useState<string | null>(null);
```

- [ ] **Step 7: Add the open handler**

In the same file, immediately after `handleSelectVersion`, add:

```tsx
  // A plain function, matching handleSelectVersion directly above it. Wrapping
  // it in useCallback would need handleSelectVersion in its dependency array,
  // and that is redefined every render, so the memo would never hold — while
  // omitting it trips react-hooks/exhaustive-deps. The sidebar is not memoized,
  // so a stable identity buys nothing here.
  const handleOpenVersionDetails = (version: Version) => {
    // Opening the drawer moves the whole page to that version. Guarded on the
    // id: handleSelectVersion clears the file list, the selected file, the
    // active tool and the active comment, so calling it for the version that is
    // ALREADY selected would throw away the open drawing just because someone
    // asked to see the version's details.
    if (version.id !== selectedVersionId) handleSelectVersion(version.id);
    setDetailVersionId(version.id);
  };
```

- [ ] **Step 8: Close the drawer when its version is deleted**

In `confirmDeleteVersion`, immediately after `setVersionToDelete(null);`, add:

```tsx
    // The drawer resolves its version from `versions`, so loadVersions() below
    // would close it anyway — but only after a round trip. Clearing it here
    // means the drawer does not linger over the confirm's dismissal.
    if (detailVersionId === target.id) setDetailVersionId(null);
```

- [ ] **Step 9: Rewire the sidebar and render the drawer**

Replace the three removed props on `<FileTreeSidebar>`:

```tsx
          onOpenVersionDetails={handleOpenVersionDetails}
```

Then, above the component's `return (`, beside the other derived values, add:

```tsx
  // Resolved from `versions` each render rather than held in state, so a
  // version that disappears takes the drawer with it. "Current" is the highest
  // version number, the same rule FileTreeSidebar uses for its badge gradient.
  const detailVersion = versions.find((v) => v.id === detailVersionId) ?? null;
  const maxVersionNumber = versions.reduce((m, v) => Math.max(m, v.versionNumber), 0);
```

And immediately before the existing `<NewVersionDrawer` element, add:

```tsx
        <VersionDetailDrawer
          version={detailVersion}
          isCurrent={!!detailVersion && detailVersion.versionNumber === maxVersionNumber}
          files={files}
          filesLoading={filesLoading}
          onClose={() => setDetailVersionId(null)}
          onSelectFile={setSelectedFileId}
          onSelectCitedComment={handleSelectCitedComment}
          onDeleteFile={openFileDelete}
          onDownloadFile={downloadFile}
          onDeleteVersion={openVersionDelete}
        />
```

Add the import beside the other portal component imports:

```tsx
import VersionDetailDrawer from '@/components/portal/VersionDetailDrawer';
```

- [ ] **Step 10: Verify**

```bash
npx tsc --noEmit
npm test
npm run lint
```

Expected: `tsc` clean, 347 tests passing, lint clean. `tsc` failing on
`onOpenVersionDetails` missing at the `<FileTreeSidebar>` call site means Step 9
was not applied — fix it rather than making the prop optional.

- [ ] **Step 11: Commit**

```bash
git add components/portal/FileTreeSidebar.tsx "app/portal/[id]/page.tsx"
git commit -m "feat: open the version drawer from the rail

The rail is a navigator again: file rows lost both hover controls and revert to
a plain button, and the version row's hover delete is gone. The chevron becomes
an expand icon that opens the drawer — one always-visible control, because it
is now the only route to a version's files, changelog and Brief.

The rotating chevron went with it. The card's selected tint plus the indented
file list already say the version is open, and re-adding a caret would put two
icons back on the row.

Opening the drawer moves the page to that version, guarded on the id:
handleSelectVersion clears the file list, selected file, active tool and active
comment, so calling it for the already-selected version would discard the open
drawing just because someone asked to see the details."
```

---

## Task 6: Take the Brief out of the comment panel

**Files:**
- Modify: `components/portal/CommentsPanel.tsx:9`
- Modify: `components/portal/CommentsPanel.tsx:12-27`
- Modify: `components/portal/CommentsPanel.tsx:469`
- Modify: `components/portal/CommentsPanel.tsx:575-582`
- Modify: `components/portal/VersionBrief.tsx`
- Modify: `app/portal/[id]/page.tsx:1326-1338`

**Interfaces:**
- Consumes: the drawer from Task 5 is now the only consumer of `VersionBrief`.
- Produces: `CommentsPanelProps` loses `versionId` and `onSelectCitedComment`.

This task runs last on purpose. Until Task 5 rendered the drawer,
`handleSelectCitedComment` had exactly one consumer — the comment panel —
so removing it earlier would have left dead code in the page.

- [ ] **Step 1: Remove the Brief from the comment panel**

In `components/portal/CommentsPanel.tsx`, delete the import on line 9:

```tsx
import VersionBrief from '@/components/portal/VersionBrief';
```

Then delete the whole render block inside the comment list — the
`{versionId && ( … )}` expression wrapping `<VersionBrief>`.

- [ ] **Step 2: Remove the two now-dead props**

In `CommentsPanelProps`, delete both:

```ts
  versionId?: string | null;
  onSelectCitedComment?: (commentId: string, fileId: string) => void;
```

Remove `versionId` and `onSelectCitedComment` from the destructured parameter
list on the component's function signature. Confirm with a search that neither
identifier appears anywhere else in the file before deleting — the only other
uses were the block removed in Step 1.

- [ ] **Step 3: Stop passing them from the page**

In `app/portal/[id]/page.tsx`, on the `<CommentsPanel>` element, delete these
two lines:

```tsx
          versionId={selectedVersionId}
          onSelectCitedComment={handleSelectCitedComment}
```

`handleSelectCitedComment` stays — the drawer consumes it, wired in Task 5.

- [ ] **Step 4: Default the Brief to expanded**

In `components/portal/VersionBrief.tsx`, change the collapse default:

```tsx
  // Expanded by default. It defaulted to collapsed when it lived in the comment
  // panel, where it competed for space above every file's comments. It now has
  // a drawer of its own that people open deliberately, so collapsed-by-default
  // would mean two clicks to reach the thing they opened the drawer for. The
  // toggle stays, so a long brief can still be folded to reach what is below it.
  const [collapsed, setCollapsed] = useState(false);
```

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit
npm test
npm run lint
```

Expected: `tsc` clean, 347 tests passing, lint clean.

- [ ] **Step 6: Confirm nothing was orphaned**

```bash
grep -rn "VersionBrief" components/ app/ | grep -v node_modules
grep -rn "onSelectCitedComment\|briefDigest" components/ app/ lib/ scripts/
```

Expected: `VersionBrief` appears only in its own file and in
`VersionDetailDrawer.tsx`. `onSelectCitedComment` appears only in
`VersionDetailDrawer.tsx` and the portal page. `briefDigest` still appears in
`lib/brief.ts`, `VersionBrief.tsx` and `scripts/tests/brief.test.mjs` — it is
still used by the collapsed header, which is retained.

Report the actual output of both commands. If `briefDigest` has become
unreferenced in `VersionBrief.tsx`, Step 4 removed the collapse toggle by
mistake — restore it.

- [ ] **Step 7: Commit**

```bash
git add components/portal/CommentsPanel.tsx components/portal/VersionBrief.tsx \
        "app/portal/[id]/page.tsx"
git commit -m "feat: the Brief lives in the version drawer, not the comment panel

The Brief summarises a whole version but rendered inside the per-file comment
panel, so the same brief was repeated above every file's comments in the
narrowest column on the page. It now has one home that matches its scope.

It defaults to expanded there: it defaulted to collapsed when it was competing
for space, and a drawer someone opened deliberately should not need a second
click to show what they came for. The toggle stays so a long brief can be
folded to reach the delete action below it."
```

---

## Manual verification

Automated gates cannot reach any of this — the suite covers pure modules, and
every change above is React or SQL. Run the app against a real package and
check each of these, reporting what you actually saw:

1. **Owner, current version.** The rail shows one icon per version card and no
   hover controls anywhere. The icon opens a drawer listing every file with
   uploader, time, size and comment count, plus download and delete on each.
2. **Opening the drawer on the selected version** does not disturb the open
   drawing, the active tool, or the comment panel.
3. **Opening the drawer on an older version** moves the rail, viewer and
   comments to it, and the drawer shows that version's files.
4. **Clicking a file card** selects it behind the drawer and closes the drawer.
5. **Deleting a file** from the drawer opens the existing confirm above the
   drawer, and on confirm the drawer stays open with the file gone.
6. **Deleting the version** closes the drawer and the version leaves the rail.
7. **A version with at least five comments** shows a Brief, expanded, with
   working citation avatars that close the drawer and jump to the comment.
8. **A version with fewer than five comments** shows no Brief section at all.
9. **A draft version** reads "Draft · Created …" and "Not published yet."
10. **A commenter account** sees the same drawer with no delete buttons, no
    download buttons, and no delete-version button.
11. **The version card headline** still appears for versions that have a brief.
