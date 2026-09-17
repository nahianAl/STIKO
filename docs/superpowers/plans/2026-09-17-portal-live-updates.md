# Live Portal Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New comments, participant joins and published versions appear in an open portal within a few seconds, without the viewer refreshing the page.

**Architecture:** A new content-free endpoint `GET /api/portals/[id]/activity` returns a `(count, latest_stamp)` cursor per entity, computed under the same access filters the real routes use. A client hook polls it every 6s while the tab is visible and, when a cursor moves, re-runs the **existing** loader for that entity. No data is duplicated and no access rule is restated — the feed only ever answers "has something you may see changed?".

**Tech Stack:** Next.js 14 App Router, React 18 client components, Neon serverless Postgres (HTTP driver), `node --test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-09-17-portal-live-updates-design.md`

## Global Constraints

- **Poll interval:** 6000 ms base, doubling on transient failure to a 60000 ms cap.
- **401/403 is terminal** — stop polling permanently, never back off and retry.
- **Never `git add -A` in this repo.** Four long-lived untracked directories (`stiko_handoff/`, `design_handoff_*/`) get swept into unrelated commits. Always `git add` the exact paths listed in the task.
- **Tested lib modules must not use the `@/` alias.** `scripts/tests/*.mjs` loads `lib/*.ts` directly via relative path; a `@/` import fails to resolve under `node --test`. Type-only imports (`import type { … } from './capabilities'`) are erased and are safe.
- **Migration files are `IF NOT EXISTS` and re-runnable**, and every migration is mirrored into `lib/schema.sql`.
- **Production is the only environment.** Migration 013 must be applied before the code that reads `comments.edited_at` is deployed.
- Comment style in this codebase explains *why*, not *what*. Match it.

---

### Task 1: Pure change-feed logic (`lib/portalActivity.ts`)

Everything in this task is a pure function with no I/O, which is why it is the one task with real automated tests. It defines the types every later task consumes.

**Files:**
- Create: `lib/portalActivity.ts`
- Test: `scripts/tests/portalActivity.test.mjs`

**Interfaces:**
- Consumes: `VersionScope` (type only) from `lib/capabilities.ts` — it is `'all' | string[]`.
- Produces:
  - `interface EntityCursor { n: number; at: string | null }`
  - `type PortalEntity = 'comments' | 'participants' | 'versions' | 'files'`
  - `type PortalDigest = Record<PortalEntity, EntityCursor>`
  - `type DigestDiff = Record<PortalEntity, boolean>`
  - `const PORTAL_ENTITIES: PortalEntity[]`
  - `diffDigest(prev: PortalDigest | null, next: PortalDigest): DigestDiff`
  - `preserveIfUnchanged<T>(prev: T, next: T): T`
  - `interface FeedFilters { includeDrafts: boolean; versionIds: string[] | null }`
  - `feedFilters(access: { canUpload: boolean; versionScope: VersionScope }): FeedFilters`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/portalActivity.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffDigest,
  preserveIfUnchanged,
  feedFilters,
  PORTAL_ENTITIES,
} from '../../lib/portalActivity.ts';

/** A digest with every entity quiet, so each test can move exactly one thing. */
function digest(overrides = {}) {
  return {
    comments: { n: 3, at: '2026-09-17T09:00:00.000Z' },
    participants: { n: 2, at: '2026-09-16T08:00:00.000Z' },
    versions: { n: 1, at: '2026-09-15T08:00:00.000Z' },
    files: { n: 4, at: '2026-09-15T09:00:00.000Z' },
    ...overrides,
  };
}

test('an identical digest reports nothing changed', () => {
  const diff = diffDigest(digest(), digest());
  for (const key of PORTAL_ENTITIES) {
    assert.equal(diff[key], false, `${key} should be quiet`);
  }
});

test('the first poll seeds the baseline and fires nothing', () => {
  // Without this the very first response diffs against nothing and re-fetches
  // all four entities seconds after mount already loaded them.
  const diff = diffDigest(null, digest());
  for (const key of PORTAL_ENTITIES) {
    assert.equal(diff[key], false, `${key} must not fire on the seeding poll`);
  }
});

test('an insert moves both count and stamp', () => {
  const next = digest({ comments: { n: 4, at: '2026-09-17T09:05:00.000Z' } });
  assert.equal(diffDigest(digest(), next).comments, true);
});

test('a delete is caught by the count alone', () => {
  // Comments are hard-deleted, so the stamp can sit still while a row vanishes.
  const next = digest({ comments: { n: 2, at: '2026-09-17T09:00:00.000Z' } });
  assert.equal(diffDigest(digest(), next).comments, true);
});

test('an edit is caught by the stamp alone', () => {
  // An edit rewrites content and leaves created_at alone; edited_at is what moves.
  const next = digest({ comments: { n: 3, at: '2026-09-17T09:07:00.000Z' } });
  assert.equal(diffDigest(digest(), next).comments, true);
});

test('one entity moving does not fire the others', () => {
  const next = digest({ participants: { n: 3, at: '2026-09-17T10:00:00.000Z' } });
  const diff = diffDigest(digest(), next);
  assert.equal(diff.participants, true);
  assert.equal(diff.comments, false);
  assert.equal(diff.versions, false);
  assert.equal(diff.files, false);
});

test('an empty package is quiet, not perpetually changing', () => {
  // MAX() over no rows is NULL. Compared naively that could read as a change
  // on every single poll.
  const empty = digest({ comments: { n: 0, at: null } });
  assert.equal(diffDigest(empty, empty).comments, false);
});

test('a package going from empty to its first comment fires', () => {
  const before = digest({ comments: { n: 0, at: null } });
  const after = digest({ comments: { n: 1, at: '2026-09-17T11:00:00.000Z' } });
  assert.equal(diffDigest(before, after).comments, true);
});

test('preserveIfUnchanged keeps the old reference for equal payloads', () => {
  // Identity, not equality, is the point: pin overlays and the 3D scene
  // re-render on reference change, and a portal-wide comment cursor re-fetches
  // this file's comments whenever anyone comments on any file.
  const prev = [{ id: 'c1', content: 'hi' }];
  const next = [{ id: 'c1', content: 'hi' }];
  assert.strictEqual(preserveIfUnchanged(prev, next), prev);
});

test('preserveIfUnchanged returns the new reference when anything differs', () => {
  const prev = [{ id: 'c1', content: 'hi' }];
  const next = [{ id: 'c1', content: 'hi there' }];
  assert.strictEqual(preserveIfUnchanged(prev, next), next);
});

test('feedFilters lets a publisher see drafts and hides them from a reviewer', () => {
  assert.equal(feedFilters({ canUpload: true, versionScope: 'all' }).includeDrafts, true);
  assert.equal(feedFilters({ canUpload: false, versionScope: 'all' }).includeDrafts, false);
});

test('feedFilters narrows to a scoped reviewer’s own versions', () => {
  // Counting the whole package would tell a scoped reviewer exactly how much
  // exists outside their scope — the thing the participants route strips its
  // scope fields to avoid.
  assert.deepEqual(feedFilters({ canUpload: false, versionScope: ['v1', 'v2'] }).versionIds, ['v1', 'v2']);
  assert.equal(feedFilters({ canUpload: true, versionScope: 'all' }).versionIds, null);
});

test('feedFilters returns an empty list, not null, for a reviewer scoped to nothing', () => {
  // null means "no restriction". Collapsing an empty scope to null would hand
  // a reviewer with no versions the whole package.
  assert.deepEqual(feedFilters({ canUpload: false, versionScope: [] }).versionIds, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test scripts/tests/portalActivity.test.mjs
```

Expected: FAIL — `Cannot find module` / `ERR_MODULE_NOT_FOUND` for `../../lib/portalActivity.ts`.

- [ ] **Step 3: Write the implementation**

Create `lib/portalActivity.ts`:

```typescript
import type { VersionScope } from './capabilities';

/**
 * Pure logic behind the portal's change feed. No imports that touch I/O and no
 * `@/` alias — scripts/tests loads this file directly under `node --test`.
 */

/**
 * One entity's change cursor: how many rows this viewer may see, and the newest
 * timestamp among them.
 *
 * The PAIR is the point. A stamp alone detects an insert and nothing else, and
 * comments here are both editable and hard-deletable:
 *
 *   insert  count rises, stamp advances
 *   delete  count falls,  stamp sits still
 *   edit    count sits still, stamp advances (via comments.edited_at)
 *
 * `at` is null when there are no rows at all — MAX() over nothing is NULL.
 */
export interface EntityCursor {
  n: number;
  at: string | null;
}

export type PortalEntity = 'comments' | 'participants' | 'versions' | 'files';

export type PortalDigest = Record<PortalEntity, EntityCursor>;

export type DigestDiff = Record<PortalEntity, boolean>;

export const PORTAL_ENTITIES: PortalEntity[] = [
  'comments',
  'participants',
  'versions',
  'files',
];

/**
 * Which entities moved between two polls.
 *
 * A null `prev` means the caller has no baseline yet and reports NOTHING
 * changed. That is what makes the first poll a silent seed: without it, the
 * first response diffs against nothing, every entity reads as changed, and the
 * page re-fetches all four seconds after mount had already loaded them.
 */
export function diffDigest(prev: PortalDigest | null, next: PortalDigest): DigestDiff {
  const out = {} as DigestDiff;
  for (const key of PORTAL_ENTITIES) {
    const before = prev?.[key];
    const after = next?.[key];
    // A missing side means a malformed or older payload shape. Treat it as
    // quiet: a re-fetch loop is a worse failure than a missed update.
    if (!before || !after) {
      out[key] = false;
      continue;
    }
    out[key] = before.n !== after.n || before.at !== after.at;
  }
  return out;
}

/**
 * Return the PREVIOUS reference when the two payloads are structurally equal.
 *
 * Identity matters more than equality here. The portal hands these arrays to
 * the pin overlay and the 3D scene, which re-render whenever the reference
 * changes. The comment cursor is portal-wide, so a comment posted on another
 * file re-fetches THIS file's comments and gets byte-identical data back;
 * without this guard the viewer would churn every time anyone commented
 * anywhere in the package.
 *
 * JSON round-tripping is safe for these values specifically: they come
 * straight from a JSON response, so key order is whatever the serializer
 * produced and is stable between polls.
 */
export function preserveIfUnchanged<T>(prev: T, next: T): T {
  try {
    return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
  } catch {
    return next;
  }
}

export interface FeedFilters {
  /**
   * Unpublished drafts count toward the cursor only for someone who may
   * publish. app/api/versions/route.ts hides draft rows from reviewers, so the
   * cursor deciding whether to re-fetch them must hide them too — otherwise a
   * reviewer's counter moves the moment an uploader starts a draft, disclosing
   * work in progress the route deliberately withholds.
   */
  includeDrafts: boolean;
  /**
   * null means every version in the package. An array means exactly these.
   *
   * An EMPTY array is meaningful and must not be collapsed to null: it is a
   * reviewer scoped to no versions at all, and null would hand them counts for
   * the whole package.
   */
  versionIds: string[] | null;
}

export function feedFilters(access: {
  canUpload: boolean;
  versionScope: VersionScope;
}): FeedFilters {
  return {
    includeDrafts: access.canUpload === true,
    versionIds: access.versionScope === 'all' ? null : [...access.versionScope],
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test scripts/tests/portalActivity.test.mjs
```

Expected: PASS — 13 tests, 0 failures.

- [ ] **Step 5: Run the whole suite to check nothing regressed**

```bash
npm test
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add lib/portalActivity.ts scripts/tests/portalActivity.test.mjs
git commit -m "feat: pure change-feed logic for portal live updates

diffDigest treats a null baseline as quiet so the first poll seeds rather
than triggering a re-fetch of data the page just loaded. feedFilters keeps
the cursor's visibility rules identical to the versions route's."
```

---

### Task 2: Migration 013 — `comments.edited_at`

Without this column the feed cannot see an edit: `PUT /api/comments/[id]` rewrites `content` and leaves `created_at` untouched, so a created_at cursor is blind to it.

**Files:**
- Create: `lib/migrations/013-comment-edits.sql`
- Modify: `lib/schema.sql` (the `comments` table, around line 167)
- Modify: `app/api/comments/[id]/route.ts` (the `PUT` handler, around lines 29-35)

**Interfaces:**
- Produces: the `comments.edited_at TIMESTAMPTZ` column that Task 3's SQL reads, and an `editedAt` field on the JSON a PUT returns.

- [ ] **Step 1: Write the migration**

Create `lib/migrations/013-comment-edits.sql`:

```sql
-- When a comment was last edited. Mirrored in lib/schema.sql.
--
-- Exists for the portal's change feed, not for the UI. The feed decides whether
-- an open portal should re-fetch by comparing a (count, latest stamp) pair per
-- entity. An edit moves neither on its own: PUT /api/comments/[id] rewrites
-- content and leaves created_at alone, and the row count is unchanged. So an
-- edit made by one reviewer would stay invisible to every other open tab until
-- something else happened to move the cursor.
--
-- NULL means never edited, which is true of every row that predates this.
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ DEFAULT NULL;
```

- [ ] **Step 2: Mirror it in `lib/schema.sql`**

In the `comments` table definition, replace:

```sql
  author TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

with:

```sql
  author TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Set by PUT /api/comments/[id]. Read by the portal's change feed, which
  -- cannot otherwise see an edit: an edit leaves created_at untouched and the
  -- row count unchanged. See lib/migrations/013-comment-edits.sql.
  edited_at TIMESTAMPTZ DEFAULT NULL
);
```

- [ ] **Step 3: Verify the migration is listed and parses**

```bash
set -a && . .env.local && set +a && npm run migrate -- --dry
```

Expected: the output lists `013-comment-edits.sql` as outstanding and touches nothing. If `.env.local` is absent, skip to Step 4 — this is re-checked at rollout.

- [ ] **Step 4: Stamp `edited_at` on edit**

In `app/api/comments/[id]/route.ts`, in the `PUT` handler, replace:

```typescript
  const rows = await sql`
    UPDATE comments SET content = ${content.trim()}
    WHERE id = ${params.id}
    RETURNING id, file_id AS "fileId", user_id AS "userId",
              parent_comment_id AS "parentCommentId", content,
              x_position AS "xPosition", y_position AS "yPosition",
              world_x AS "worldX", world_y AS "worldY", world_z AS "worldZ",
              snapshot_url AS "snapshotUrl", author, created_at AS "createdAt"
  `;
```

with:

```typescript
  // edited_at is what lets every other open portal notice this edit. The change
  // feed compares a (count, latest stamp) pair, and an edit moves neither
  // created_at nor the row count — see lib/migrations/013-comment-edits.sql.
  const rows = await sql`
    UPDATE comments SET content = ${content.trim()}, edited_at = NOW()
    WHERE id = ${params.id}
    RETURNING id, file_id AS "fileId", user_id AS "userId",
              parent_comment_id AS "parentCommentId", content,
              x_position AS "xPosition", y_position AS "yPosition",
              world_x AS "worldX", world_y AS "worldY", world_z AS "worldZ",
              snapshot_url AS "snapshotUrl", author, created_at AS "createdAt",
              edited_at AS "editedAt"
  `;
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/migrations/013-comment-edits.sql lib/schema.sql app/api/comments/\[id\]/route.ts
git commit -m "feat: track comments.edited_at so the change feed can see edits

An edit rewrites content and moves neither created_at nor the row count, so
a (count, stamp) cursor is blind to it without a dedicated column."
```

---

### Task 3: The change-feed endpoint

**Files:**
- Create: `app/api/portals/[id]/activity/route.ts`

**Interfaces:**
- Consumes: `feedFilters` and the `PortalDigest` type from `lib/portalActivity.ts` (Task 1); `comments.edited_at` (Task 2); `getPackageAccess` from `lib/access.ts`, which returns `{ canUpload: boolean; versionScope: 'all' | string[]; … }` or `null`.
- Produces: `GET /api/portals/[id]/activity` → 200 with a `PortalDigest` body, 401 unauthenticated, 403 for a non-participant.

- [ ] **Step 1: Write the route**

Create `app/api/portals/[id]/activity/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';
import { feedFilters, type PortalDigest } from '@/lib/portalActivity';

/**
 * The portal's change feed: has anything this viewer may see changed?
 *
 * Returns NO content — no bodies, no names, no ids. Only a (count, latest
 * stamp) pair per entity. The client re-runs the existing loader for whichever
 * pair moved, so every access rule stays in the routes that already own it and
 * is never restated here.
 *
 * Polled once every few seconds per open portal, so it is one statement.
 */

/** TIMESTAMPTZ arrives as a Date from the HTTP driver, or null when MAX() saw no rows. */
function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** COUNT() is bigint, which the driver hands back as a string. */
function toCount(value: unknown): number {
  return Number(value ?? 0);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await getPackageAccess(session.user.id, params.id);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { includeDrafts, versionIds } = feedFilters(access);
  // `scoped` and `scopeList` are separate because an EMPTY scope list is
  // meaningful — a reviewer narrowed to no versions — and `= ANY('{}')` is
  // false for every row, which is exactly right. Collapsing the two would hand
  // that reviewer the whole package.
  const scoped = versionIds !== null;
  const scopeList = versionIds ?? [];

  // Casts on every parameter: the HTTP driver sends values as text, and
  // Postgres cannot infer a type for a bare placeholder sitting alone in an OR
  // or against an empty array.
  const rows = await sql`
    WITH visible_versions AS (
      SELECT v.id, v.created_at
      FROM versions v
      WHERE v.portal_id = ${params.id}
        AND (${includeDrafts}::boolean OR v.published_at IS NOT NULL)
        AND (NOT ${scoped}::boolean OR v.id = ANY(${scopeList}::text[]))
    ),
    visible_files AS (
      SELECT f.id, f.created_at
      FROM files f
      JOIN visible_versions vv ON vv.id = f.version_id
    ),
    visible_comments AS (
      SELECT c.created_at, c.edited_at
      FROM comments c
      JOIN visible_files vf ON vf.id = c.file_id
    )
    SELECT
      (SELECT COUNT(*) FROM participants WHERE portal_id = ${params.id}) AS "participantsN",
      (SELECT MAX(created_at) FROM participants WHERE portal_id = ${params.id}) AS "participantsAt",
      (SELECT COUNT(*) FROM visible_versions) AS "versionsN",
      (SELECT MAX(created_at) FROM visible_versions) AS "versionsAt",
      (SELECT COUNT(*) FROM visible_files) AS "filesN",
      (SELECT MAX(created_at) FROM visible_files) AS "filesAt",
      (SELECT COUNT(*) FROM visible_comments) AS "commentsN",
      -- GREATEST skips NULL inputs in Postgres and returns NULL only when every
      -- input is NULL, so a package where nothing has been edited yields the
      -- created_at maximum rather than NULL. Several other SQL engines
      -- propagate NULL here instead, which would silently blind the cursor.
      (SELECT GREATEST(MAX(created_at), MAX(edited_at)) FROM visible_comments) AS "commentsAt"
  `;

  const row = rows[0] ?? {};

  const digest: PortalDigest = {
    participants: { n: toCount(row.participantsN), at: toIso(row.participantsAt) },
    versions: { n: toCount(row.versionsN), at: toIso(row.versionsAt) },
    files: { n: toCount(row.filesN), at: toIso(row.filesAt) },
    comments: { n: toCount(row.commentsN), at: toIso(row.commentsAt) },
  };

  return NextResponse.json(digest, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Lint**

```bash
npm run lint
```

Expected: no new warnings for `app/api/portals/[id]/activity/route.ts`.

- [ ] **Step 4: Verify it builds**

```bash
npm run build
```

Expected: build succeeds and the route list includes `/api/portals/[id]/activity`.

- [ ] **Step 5: Commit**

```bash
git add app/api/portals/\[id\]/activity/route.ts
git commit -m "feat: content-free change feed for an open portal

Answers only whether something the viewer may see has changed. Applies the
same draft and version-scope filters as /api/versions, pushed into SQL, so a
scoped reviewer's counts cannot reveal how much exists outside their scope."
```

---

### Task 4: The polling hook

**Files:**
- Create: `components/portal/usePortalActivity.ts`

**Interfaces:**
- Consumes: `diffDigest`, `PortalDigest`, `PortalEntity` from `lib/portalActivity.ts` (Task 1); `GET /api/portals/[id]/activity` (Task 3).
- Produces: `usePortalActivity(portalId: string | null, handlers: ActivityHandlers): void` where `type ActivityHandlers = Partial<Record<PortalEntity, () => void>>`. Returns nothing; it calls the handler for each entity that moved.

- [ ] **Step 1: Write the hook**

Create `components/portal/usePortalActivity.ts`:

```typescript
'use client';

import { useEffect, useRef } from 'react';
import { diffDigest, type PortalDigest, type PortalEntity } from '@/lib/portalActivity';

const BASE_INTERVAL_MS = 6000;
const MAX_INTERVAL_MS = 60000;

export type ActivityHandlers = Partial<Record<PortalEntity, () => void>>;

/**
 * Poll the package's change feed and call back for whatever moved.
 *
 * Owns the timer and nothing else: it never fetches portal data itself, so the
 * loaders it triggers remain the single place each entity is loaded from.
 */
export function usePortalActivity(portalId: string | null, handlers: ActivityHandlers) {
  // The handlers object is rebuilt on every render because it closes over page
  // state. Holding it in a ref keeps that out of the effect's dependencies —
  // otherwise the timer is torn down and rebuilt on every render and never
  // survives long enough to fire. The ref also means handlers read current
  // state (e.g. the selected version) rather than whatever was current at mount.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!portalId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let interval = BASE_INTERVAL_MS;
    let previous: PortalDigest | null = null;
    const controller = new AbortController();

    const schedule = (ms: number) => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(poll, ms);
    };

    const poll = async () => {
      // A tick that lands while the previous request is still out is dropped.
      // The in-flight request reschedules in its own finally, so on a slow
      // connection this degrades to "as fast as the network allows" instead of
      // piling requests up.
      if (cancelled || inFlight) return;

      // A hidden tab costs nothing at all: no request AND no timer. The
      // visibilitychange listener re-arms it.
      if (document.visibilityState !== 'visible') return;

      inFlight = true;
      try {
        const res = await fetch(`/api/portals/${portalId}/activity`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (cancelled) return;

        // Access revoked mid-session. Stop for good rather than backing off:
        // retrying cannot start succeeding, and an open tab would otherwise
        // poll a 403 until it was closed.
        if (res.status === 401 || res.status === 403) {
          cancelled = true;
          return;
        }
        if (!res.ok) throw new Error(`activity ${res.status}`);

        const next = (await res.json()) as PortalDigest;
        const changed = diffDigest(previous, next);
        previous = next;
        interval = BASE_INTERVAL_MS;

        for (const key of Object.keys(changed) as PortalEntity[]) {
          if (changed[key]) handlersRef.current[key]?.();
        }
      } catch (err) {
        if (cancelled || (err as Error)?.name === 'AbortError') return;
        // Transient — a Neon blip, or a deploy swapping the function out. Back
        // off rather than hammer, and reset on the first success above.
        interval = Math.min(interval * 2, MAX_INTERVAL_MS);
      } finally {
        inFlight = false;
        schedule(interval);
      }
    };

    const onVisibilityChange = () => {
      // Poll at once rather than serving up to six seconds of stale data to
      // someone who has just come back to the tab.
      if (document.visibilityState === 'visible') schedule(0);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    schedule(interval);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      controller.abort();
    };
  }, [portalId]);
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/portal/usePortalActivity.ts
git commit -m "feat: usePortalActivity polls the change feed

Zero cost while the tab is hidden — no request and no timer — and polls
immediately on return rather than serving up to six seconds of stale data.
401/403 is terminal so a revoked tab stops instead of retrying forever."
```

---

### Task 5: Stop the refresh from being visible

Three existing behaviours are correct for a one-shot mount and wrong for a repeating poll. Fixing them **before** wiring the hook in means live updates never ship a visible regression.

**Files:**
- Modify: `components/portal/CommentsPanel.tsx` (`fetchComments` around lines 490-509; the scroll effect around lines 519-524)
- Modify: `app/portal/[id]/page.tsx` (`fetchFiles` around lines 1136-1163)

**Interfaces:**
- Consumes: `preserveIfUnchanged` from `lib/portalActivity.ts` (Task 1).
- Produces: `fetchFiles(versionId: string, options?: { background?: boolean }): Promise<void>` — Task 6 calls it with `{ background: true }`.

- [ ] **Step 1: Add the import to `CommentsPanel.tsx`**

Alongside the existing imports at the top of the file, add:

```typescript
import { preserveIfUnchanged } from '@/lib/portalActivity';
```

- [ ] **Step 2: Make `CommentsPanel.fetchComments` quiet on re-fetch**

Replace the `fetchComments` callback (around lines 490-509) with:

```typescript
  // Which file the panel has already shown comments for. The spinner belongs to
  // opening a file, not to refreshing one that is already on screen: a
  // poll-driven re-fetch would otherwise flash a loading state over the thread
  // every few seconds.
  const loadedFileRef = useRef<string | null>(null);

  const fetchComments = useCallback(async () => {
    if (!fileId) {
      setComments([]);
      loadedFileRef.current = null;
      return;
    }
    const firstLoad = loadedFileRef.current !== fileId;
    if (firstLoad) setLoading(true);
    try {
      const res = await fetch(`/api/comments?fileId=${fileId}`);
      // A 401/403/500 body is a JSON object, not an array, and would reach
      // setComments and break every .filter below it. Harmless when this ran
      // once on mount; with a poll behind it, one transient failure would take
      // the panel out for the rest of the session.
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data)) return;
      // Keep the old array when nothing actually differs — see Step 4.
      setComments((prev) => preserveIfUnchanged(prev, data));
      loadedFileRef.current = fileId;
    } catch (err) {
      console.error('Failed to fetch comments:', err);
    } finally {
      if (firstLoad) setLoading(false);
    }
  }, [fileId]);
```

- [ ] **Step 3: Stop the scroll from being yanked**

Replace the scroll-to-active effect (around lines 512-524, including its existing comment block) with:

```typescript
  // Scroll to the active comment, ONCE per active id.
  //
  // This also re-runs when `comments` changes, not just `activeCommentId`,
  // because a citation chip for a comment on a different file sets both at
  // once: the target's file switches, which starts an async re-fetch, and the
  // first run finds the old file's comments still in the DOM with no element
  // for the new id. Re-running once `comments` lands retries against the DOM
  // the new fetch actually produced.
  //
  // The ref is what keeps that retry from becoming a nuisance under polling:
  // without it, every arriving comment re-runs this effect and drags the panel
  // back to the active pin, out from under someone who has scrolled elsewhere.
  const scrolledToRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeCommentId) {
      scrolledToRef.current = null;
      return;
    }
    if (scrolledToRef.current === activeCommentId) return;
    const el = document.getElementById(`comment-${activeCommentId}`);
    if (!el) return; // comments for the new file have not landed yet; retry on the next run
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    scrolledToRef.current = activeCommentId;
  }, [activeCommentId, comments]);
```

- [ ] **Step 4: Give `fetchFiles` a background mode in `page.tsx`**

Replace the `fetchFiles` callback (around lines 1136-1163) with:

```typescript
  // Fetch files when version changes.
  //
  // `background: true` is for a poll-driven refresh: someone else uploading a
  // file must not flash the sidebar spinner over content that is already on
  // screen.
  const fetchFiles = useCallback(
    async (versionId: string, options?: { background?: boolean }) => {
      const background = options?.background === true;
      if (!background) setFilesLoading(true);
      try {
        const res = await fetch(`/api/files?versionId=${versionId}`);
        // Same failure shape as loadVersions: a 401/403 body is a JSON object,
        // not an array, and would otherwise reach setFiles and blow up render.
        if (!res.ok) {
          if (!background) setFiles([]);
          return;
        }
        const data: FileRecord[] = await res.json();
        setFiles((prev) => preserveIfUnchanged(prev, data));
        if (data.length > 0) {
          // A version change should land on the first file, but a delete that
          // leaves the current selection intact must not throw the viewer back
          // to file 1.
          setSelectedFileId((current) =>
            current && data.some((f) => f.id === current) ? current : data[0].id
          );
        } else {
          setSelectedFileId(null);
        }
      } catch (err) {
        console.error('Failed to fetch files:', err);
      } finally {
        if (!background) setFilesLoading(false);
      }
    },
    []
  );
```

Note the `if (!background) setFiles([])` on the failure path: a one-shot load clearing to empty on a 403 is correct, but a background poll must never wipe a working viewer because one request failed.

- [ ] **Step 5: Add the import to `page.tsx`**

Alongside the existing `@/lib/...` imports near the top of the file, add:

```typescript
import { preserveIfUnchanged } from '@/lib/portalActivity';
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/portal/CommentsPanel.tsx app/portal/\[id\]/page.tsx
git commit -m "fix: make portal re-fetches invisible when nothing changed

Three behaviours that were fine for a one-shot mount and wrong under a poll:
a spinner on every re-fetch, a scroll yank on every arriving comment, and an
unchecked res.ok that would put an error object into setComments."
```

---

### Task 6: Wire the hook into the portal

**Files:**
- Modify: `app/portal/[id]/page.tsx` (the participants effect around lines 986-997; the page's `fetchComments` around lines 1181-1195; a new hook call after the loaders are defined)

**Interfaces:**
- Consumes: `usePortalActivity` and `ActivityHandlers` from `components/portal/usePortalActivity.ts` (Task 4); `fetchFiles(versionId, { background: true })` from Task 5; `preserveIfUnchanged` from Task 1.

- [ ] **Step 1: Add the import**

Alongside the other `@/components/portal/...` imports near the top of `app/portal/[id]/page.tsx`:

```typescript
import { usePortalActivity } from '@/components/portal/usePortalActivity';
```

- [ ] **Step 2: Extract `fetchParticipants` into a callback**

Replace the participants effect (around lines 986-997) with:

```typescript
  // Extracted from an effect into a callback so the change feed can re-run it,
  // the same shape as loadVersions.
  const fetchParticipants = useCallback(async () => {
    try {
      const res = await fetch(`/api/participants?portalId=${portalId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data)) return;
      setParticipants((prev) => preserveIfUnchanged(prev, data));
    } catch (err) {
      console.error('Failed to fetch participants:', err);
    }
  }, [portalId]);

  useEffect(() => {
    fetchParticipants();
  }, [fetchParticipants]);
```

- [ ] **Step 3: Guard the page's own comment fetch against churn**

Replace the body of the page's `fetchComments` callback (around lines 1181-1195) with:

```typescript
  // Fetch comments for the selected file (for pins)
  const fetchComments = useCallback(async () => {
    if (!selectedFileId) {
      setComments([]);
      return;
    }
    try {
      const res = await fetch(`/api/comments?fileId=${selectedFileId}`);
      if (res.ok) {
        const data = await res.json();
        if (!Array.isArray(data)) return;
        // The comment cursor is portal-wide, so a comment on ANOTHER file
        // re-fetches this one and gets identical data. Without this guard every
        // pin and the 3D overlay would re-render on a new array identity each
        // time anyone commented anywhere in the package.
        setComments((prev) => preserveIfUnchanged(prev, data));
      }
    } catch (err) {
      console.error('Failed to fetch comments for pins:', err);
    }
  }, [selectedFileId]);
```

- [ ] **Step 4: Subscribe to the feed**

Immediately after the `fetchComments` effect (the one at around line 1197 reading `useEffect(() => { fetchComments(); }, [fetchComments, commentsRefreshKey]);`), add:

```typescript
  // Live updates. Each handler re-runs the loader that already owns that
  // entity, so nothing about how data is loaded or authorized is duplicated
  // here — the feed only says WHICH loader to re-run.
  usePortalActivity(portalId, {
    // One bump drives both this page's pin fetch and CommentsPanel's own fetch,
    // which is why there is no second call here.
    comments: () => setCommentsRefreshKey((k) => k + 1),
    participants: fetchParticipants,
    versions: loadVersions,
    files: () => {
      if (selectedVersionId) fetchFiles(selectedVersionId, { background: true });
    },
  });
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Lint and build**

```bash
npm run lint && npm run build
```

Expected: both succeed.

- [ ] **Step 7: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add app/portal/\[id\]/page.tsx
git commit -m "feat: portal updates comments, roster and versions without a refresh

Each handler re-runs the loader that already owns its entity, so the feed
only decides WHICH loader runs and never restates an access rule."
```

---

### Task 7: Verify it in a browser

The four traps in Task 5 are about how this *feels*, and none of them are caught by a type-check. This must be seen.

**Files:** none — verification only.

- [ ] **Step 1: Boot the app against the real database**

```bash
set -a && . .env.local && set +a && npm run dev
```

- [ ] **Step 2: Open the same package in two browser profiles**

Open the same `/portal/<id>` in a normal window and a private window signed in as a second participant, side by side.

- [ ] **Step 3: Confirm each entity goes live**

Post a comment as the second participant. Expected: it appears in the first window's panel **and** its pin appears in the viewer, within ~6 seconds, with no spinner flash and no scroll jump.

Edit that comment. Expected: the edited text appears in the first window within ~6 seconds. (This is the check that proves migration 013 is actually applied — before it, edits stay invisible.)

Delete it. Expected: it disappears from the first window within ~6 seconds.

- [ ] **Step 4: Confirm nothing churns when nothing changed**

Leave both windows idle on a 3D file for a minute with the DevTools Network tab open. Expected: one ~200-byte request to `/api/portals/<id>/activity` every 6 seconds, and **no** requests to `/api/comments`, `/api/files` or `/api/versions` between them. If those fire on every tick, `diffDigest` is reporting a false change — most likely a timestamp being serialized inconsistently.

- [ ] **Step 5: Confirm a hidden tab is free**

Switch to another tab for 30 seconds, then come back. Expected: **no** activity requests while hidden, and one immediately on return.

- [ ] **Step 6: Confirm the roster and versions go live**

Invite a third person and accept from another profile. Expected: they appear in People without a refresh. Publish a new version as an uploader. Expected: it appears in the reviewer's sidebar without a refresh, with no spinner flash.

- [ ] **Step 7: Note the results**

Record what was verified and anything that behaved unexpectedly. Do not claim this works without having done Steps 3-6.

---

## Rollout

Production is the only environment, so the order is not optional.

1. **Apply migration 013 first.** `set -a && . .env.local && set +a && npm run migrate`
2. **Confirm it landed:** check `013-comment-edits.sql` is in `schema_migrations`. Task 3's SQL selects `edited_at`, so the feed 500s on every poll without it.
3. **Then deploy** (`main` auto-deploys).

Rollback is a revert of the application code. The column is additive and harmless if left in place.
