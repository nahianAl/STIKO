# Account Usage Meters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a storage meter (split projects / trash), a project-count meter, and a subscription plan badge in the dashboard account popover.

**Architecture:** A `plan` column on `users` plus a hardcoded tier catalogue in `lib/plans.ts` — no billing integration. One SQL function sums real usage over projects the user owns, served by a new lazily-fetched `GET /api/me/usage`. A `Meter` primitive renders both bars; `UsageMeters` composes them; `AvatarMenu` widens and hosts them.

**Tech Stack:** Next.js App Router, `@neondatabase/serverless` (HTTP driver), NextAuth, Tailwind with the `stiko-*` token set. Tests are `node --test` over `scripts/tests/*.mjs`, importing `.ts` sources directly.

**Spec:** `docs/superpowers/specs/2026-09-11-account-usage-meters-design.md`

## Global Constraints

- Tests run with `npm test` → `node --test scripts/tests/*.mjs`. Test files are `.mjs` and import `.ts` sources directly (`../../lib/plans.ts`).
- Tier limits, exact: **Free** = `2 * 1024 ** 3` bytes, `2` projects. **Standard** = `100 * 1024 ** 3` bytes, unlimited projects (`maxProjects: null`).
- Binary units throughout (1 GB = 1024³), matching the base the existing `formatSize` already uses.
- **This is a readout. Do not add enforcement anywhere.** No upload is blocked, no project creation is blocked. An account may legitimately be over either limit.
- Every colour must be a value that already exists in `tailwind.config.ts`. Inline hex
  constants are fine where a runtime-computed inline style needs one (the codebase
  already does this in `ROLE_TEXT_COLOR` and `UploadProgress`), but the hex must match a
  token in that file and name it in a comment. Do not invent new colours.
- **Neon's HTTP driver returns `BIGINT` and `NUMERIC` aggregates as strings.** Every `SUM(...)` and `COUNT(*)` read in this plan must be wrapped in `Number()` in JS. Skipping this yields string concatenation (`"0" + "0"` → `"00"`), not addition.
- **Never source `.env.local` from the shell.** `. .env.local` has no slash, so zsh
  searches `PATH`, and the unquoted connection string's `?` gets glob-expanded and the
  whole `DATABASE_URL` echoed on failure — that is how the database password leaked into
  a transcript on 2026-09-04. Use `node --env-file=.env.local …`. Never print
  `DATABASE_URL`, `process.env`, or any R2 secret.
- `npm run dev` needs no env plumbing — Next.js loads `.env.local` itself.
- Never run `git add -A` in this repo. Three long-lived untracked directories (`stiko_handoff/`, `design_handoff_portal_view/`, `design_handoff_brief_section/`) will be swept into the commit. Always `git add` explicit paths.

---

### Task 1: Plan catalogue

**Files:**
- Create: `lib/plans.ts`
- Test: `scripts/tests/plans.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `PlanId`, `Plan`, `PLANS`, `DEFAULT_PLAN_ID`, `planFor(value)`, `usageFraction(used, limit)`. Tasks 4, 5, 6 and 7 all import from here.

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/tests/plans.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANS,
  DEFAULT_PLAN_ID,
  planFor,
  usageFraction,
} from '../../lib/plans.ts';

test('every tier has a label, a positive byte limit and a valid project limit', () => {
  for (const [id, plan] of Object.entries(PLANS)) {
    assert.equal(plan.id, id, `${id} id matches its key`);
    assert.ok(plan.label.length > 0, `${id} has a label`);
    assert.ok(plan.storageBytes > 0, `${id} has a positive byte limit`);
    assert.ok(
      plan.maxProjects === null ||
        (Number.isInteger(plan.maxProjects) && plan.maxProjects > 0),
      `${id} project limit is null or a positive integer`
    );
  }
});

test('the tiers carry the agreed limits', () => {
  assert.equal(PLANS.free.storageBytes, 2 * 1024 ** 3);
  assert.equal(PLANS.free.maxProjects, 2);
  assert.equal(PLANS.standard.storageBytes, 100 * 1024 ** 3);
  assert.equal(PLANS.standard.maxProjects, null);
});

test('an unrecognised plan resolves to the default rather than throwing', () => {
  // The column has no CHECK constraint, so anything can land in it. A typo in
  // an UPDATE must degrade to Free, never 500 the account menu.
  for (const bad of [null, undefined, '', 'enterprise', 'FREE', '  free  ']) {
    assert.equal(planFor(bad).id, DEFAULT_PLAN_ID, `${JSON.stringify(bad)}`);
  }
});

test('a recognised plan resolves to itself', () => {
  assert.equal(planFor('free').id, 'free');
  assert.equal(planFor('standard').id, 'standard');
});

test('usageFraction is null when the limit is unlimited', () => {
  // null means "draw no bar at all" — a bar with no denominator is meaningless.
  assert.equal(usageFraction(500, null), null);
});

test('usageFraction covers empty, partial, exact and over-limit', () => {
  assert.equal(usageFraction(0, 100), 0);
  assert.equal(usageFraction(25, 100), 0.25);
  assert.equal(usageFraction(100, 100), 1);
  // Over quota is reachable today — nothing enforces these limits.
  assert.equal(usageFraction(250, 100), 1, 'clamps rather than overflowing');
});

test('usageFraction survives junk input', () => {
  assert.equal(usageFraction(-5, 100), 0, 'negative usage floors at 0');
  assert.equal(usageFraction(0, 0), 0, 'zero limit, zero use');
  assert.equal(usageFraction(5, 0), 1, 'zero limit, any use is full');
  assert.equal(usageFraction(Number.NaN, 100), 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern="tier|plan|usageFraction" scripts/tests/plans.test.mjs`

Expected: FAIL — `Cannot find module` for `lib/plans.ts`.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/plans.ts
/**
 * Subscription tiers and their limits.
 *
 * This is the single source of truth for what a tier is called and what it
 * allows. There is deliberately no CHECK constraint on users.plan in the
 * database: the catalogue lives here, and a CHECK would force a migration
 * every time a tier is added or renamed. planFor() is the cost of that —
 * anything unrecognised degrades to Free and warns.
 *
 * Nothing in the product ENFORCES these limits. They are displayed, not
 * applied, so an account can legitimately sit over either one.
 */

export type PlanId = 'free' | 'standard';

export interface Plan {
  id: PlanId;
  label: string;
  storageBytes: number;
  /** null means unlimited — render a count, not a bar. */
  maxProjects: number | null;
}

const GIB = 1024 ** 3;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    label: 'Free',
    storageBytes: 2 * GIB,
    maxProjects: 2,
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    storageBytes: 100 * GIB,
    maxProjects: null,
  },
};

export const DEFAULT_PLAN_ID: PlanId = 'free';

/** Always returns a valid plan. Unknown, null or malformed resolves to Free. */
export function planFor(value: string | null | undefined): Plan {
  if (value && Object.prototype.hasOwnProperty.call(PLANS, value)) {
    return PLANS[value as PlanId];
  }
  if (value) {
    // The only trace a mistyped UPDATE leaves. Without it the account silently
    // sits on Free limits and nobody can tell why.
    console.warn(`[plans] unknown plan ${JSON.stringify(value)}, using Free`);
  }
  return PLANS[DEFAULT_PLAN_ID];
}

/**
 * Fraction of a limit consumed, clamped to 0–1.
 *
 * Returns null for an unlimited limit, which callers read as "draw no bar".
 */
export function usageFraction(used: number, limit: number | null): number | null {
  if (limit === null) return null;
  if (!Number.isFinite(used) || used <= 0) return 0;
  if (!Number.isFinite(limit) || limit <= 0) return 1;
  return Math.min(1, used / limit);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-name-pattern="tier|plan|usageFraction" scripts/tests/plans.test.mjs`

Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/plans.ts scripts/tests/plans.test.mjs
git commit -m "feat: add subscription plan catalogue"
```

---

### Task 2: Byte formatting

The existing `formatSize` is local to `components/ui/UploadProgress.tsx` and tops out at MB, so it cannot render "2 GB". This replaces it with a shared helper and removes the duplicate.

**Files:**
- Modify: `lib/design.ts` (append after `relativeTime`)
- Modify: `components/ui/UploadProgress.tsx:19-21` (delete local `formatSize`), `:4` (import), `:82` (call site)
- Test: `scripts/tests/design.test.mjs` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `formatBytes(bytes: number): string`. Task 7 imports it.

- [ ] **Step 1: Write the failing test**

Append to `scripts/tests/design.test.mjs`, and add `formatBytes` to the existing import list at the top of that file:

```javascript
test('formatBytes covers each unit boundary', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 ** 2), '1 MB');
  assert.equal(formatBytes(1024 ** 3), '1 GB');
  assert.equal(formatBytes(1024 ** 4), '1 TB');
});

test('formatBytes never shows a trailing .0', () => {
  // A plan limit has to read "2 GB", not "2.0 GB".
  assert.equal(formatBytes(2 * 1024 ** 3), '2 GB');
  assert.equal(formatBytes(100 * 1024 ** 3), '100 GB');
});

test('formatBytes keeps one decimal below 100 and drops it above', () => {
  assert.equal(formatBytes(1.44 * 1024 ** 3), '1.4 GB');
  assert.equal(formatBytes(101.6 * 1024 ** 2), '102 MB');
});

test('formatBytes carries rather than printing 1024 of a unit', () => {
  // 1023.9 MB rounds to 1024 MB, which should read as 1 GB.
  assert.equal(formatBytes(1023.9 * 1024 ** 2), '1 GB');
});

test('formatBytes survives junk input', () => {
  assert.equal(formatBytes(-1), '0 B');
  assert.equal(formatBytes(Number.NaN), '0 B');
  assert.equal(formatBytes(Number.POSITIVE_INFINITY), '0 B');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern="formatBytes" scripts/tests/design.test.mjs`

Expected: FAIL — `formatBytes is not a function` (or an import error).

- [ ] **Step 3: Write the implementation**

Append to `lib/design.ts`:

```typescript
const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const;

/**
 * Human byte size, in the terse form the meters and upload rows use.
 *
 * Binary units (1 GB = 1024^3), matching the plan limits in lib/plans.ts, so
 * an account exactly at its limit reads "2 / 2 GB" with no rounding artefact.
 * One decimal below 100, none above, and never a trailing ".0".
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  let rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  // Rounding can push a value up into the next unit — 1023.9 MB rounds to
  // 1024 MB, which must read as 1 GB.
  if (rounded >= 1024 && unit < BYTE_UNITS.length - 1) {
    rounded = 1;
    unit += 1;
  }

  return `${rounded} ${BYTE_UNITS[unit]}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-name-pattern="formatBytes" scripts/tests/design.test.mjs`

Expected: PASS — 5 tests.

- [ ] **Step 5: Point UploadProgress at the shared helper**

In `components/ui/UploadProgress.tsx`, delete the local function (currently lines 19–21):

```typescript
function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}
```

Change the import on line 4 from:

```typescript
import { FileChip } from './Primitives';
```

to:

```typescript
import { FileChip } from './Primitives';
import { formatBytes } from '@/lib/design';
```

And the call site on line 82 from `{item.progress}% · {formatSize(item.bytes)}` to:

```tsx
{item.progress}% · {formatBytes(item.bytes)}
```

- [ ] **Step 6: Verify nothing else referenced the old name**

Run: `grep -rn "formatSize" components app lib`

Expected: no output. If anything remains, point it at `formatBytes` too.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`

Expected: all tests PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add lib/design.ts scripts/tests/design.test.mjs components/ui/UploadProgress.tsx
git commit -m "feat: add shared formatBytes helper"
```

---

### Task 3: Schema — the plan column

**Files:**
- Create: `lib/migrations/011-plans.sql`
- Modify: `lib/schema.sql` (the `users` CREATE TABLE block, after `company TEXT,`)

**Interfaces:**
- Consumes: nothing.
- Produces: `users.plan TEXT NOT NULL DEFAULT 'free'`. Task 4 reads it.

- [ ] **Step 1: Write the migration**

```sql
-- lib/migrations/011-plans.sql
--
-- Subscription tier per user (2026-09-11). Mirrored in lib/schema.sql.
--
-- No CHECK constraint, deliberately. The catalogue of tiers lives in
-- lib/plans.ts, and a CHECK here would force a migration every time a tier is
-- added or renamed. planFor() resolves anything unrecognised to Free and warns
-- to the server log, which is what makes a mistyped UPDATE findable.
--
-- Nothing enforces the limits this implies. The column drives a readout only.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
```

- [ ] **Step 2: Mirror it in schema.sql**

In `lib/schema.sql`, add a **standalone `ALTER`** after the `users` table's
closing `);` — NOT a column inside the `CREATE TABLE` block.

`scripts/migrate.mjs` applies `schema.sql` first, unconditionally, and
`CREATE TABLE IF NOT EXISTS` is a whole-statement no-op against an existing
database: Postgres skips the entire statement rather than diffing columns. A
column added inside the block therefore never lands on any existing database.
This repo has already shipped that exact bug on this exact table — see commit
`94d27e9` on `workos-foundation`, which fixed it for `workos_user_id`.

Follow the `ai_summaries_enabled` precedent already in `schema.sql`:

```sql
-- Subscription tier (2026-09-11). Mirrored in lib/migrations/011-plans.sql.
-- An ALTER rather than a column in the CREATE TABLE above, because that
-- statement is a no-op once the table exists — this is what actually adds the
-- column to an existing database.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
```

- [ ] **Step 3: Dry-run the migration**

Run:

```bash
cd /Users/user/Desktop/STIKO-main
node --env-file=.env.local scripts/migrate.mjs --dry
```

Expected: output listing `011-plans.sql` as outstanding, and touching nothing.

- [ ] **Step 4: Apply the migration**

Run:

```bash
cd /Users/user/Desktop/STIKO-main
node --env-file=.env.local scripts/migrate.mjs
```

Expected: `011-plans.sql` applied, recorded in `schema_migrations`.

- [ ] **Step 5: Confirm the column exists and every user has a tier**

Run:

```bash
cd /Users/user/Desktop/STIKO-main
node --env-file=.env.local -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`SELECT plan, COUNT(*) AS n FROM users GROUP BY plan\`.then(r => console.log(r));
"
```

Expected: one row, `{ plan: 'free', n: '<your user count>' }`. No NULLs.

- [ ] **Step 6: Commit**

```bash
git add lib/migrations/011-plans.sql lib/schema.sql
git commit -m "feat: add users.plan column"
```

---

### Task 4: Usage query

**Files:**
- Modify: `lib/queries.ts` (append; follow the existing `getHomeData` style)

**Interfaces:**
- Consumes: `planFor`, `Plan` from `lib/plans.ts` (Task 1).
- Produces:
  ```typescript
  export interface AccountUsage {
    plan: Plan;
    storage: { projectBytes: number; trashBytes: number; totalBytes: number };
    projects: { count: number; max: number | null };
  }
  export async function getAccountUsage(userId: string): Promise<AccountUsage>
  ```
  Task 5 calls this.

- [ ] **Step 1: Write the implementation**

Append to `lib/queries.ts`, and add `import { planFor, type Plan } from '@/lib/plans';` to the imports at the top:

```typescript
export interface AccountUsage {
  plan: Plan;
  storage: {
    projectBytes: number;
    trashBytes: number;
    totalBytes: number;
  };
  projects: {
    count: number;
    max: number | null;
  };
}

/**
 * What this account is using, against what its plan allows.
 *
 * Scoped throughout to projects the user OWNS. Projects they were invited into
 * belong to whoever owns them, and counting those here would bill two
 * coordinators for the same bytes.
 *
 * What counts, and why:
 *   - Files in archived packages DO count. The bytes are still in S3, and
 *     archiving is not deleting.
 *   - Files in unpublished drafts DO count, for the same reason.
 *   - Converted derivatives (files.converted_storage_key) do NOT. No byte size
 *     is recorded for them anywhere, and they are bytes the product generated
 *     rather than bytes the user uploaded.
 *   - Markup snapshots (comments.snapshot_url) do NOT, same reason.
 *
 * So the figure is smaller than the true S3 footprint, on purpose: the number
 * on screen should be one the user can act on by deleting their own content.
 *
 * The project COUNT excludes archived projects while the byte total includes
 * archived packages. That asymmetry is intentional — "how much space am I
 * using" and "how many of my projects are in the way" are different questions.
 * Nothing writes projects.archived_at today; the filter is there so the count
 * stays right when project archiving arrives.
 */
export async function getAccountUsage(userId: string): Promise<AccountUsage> {
  const rows = await sql`
    WITH owned_files AS (
      SELECT f.id, f.file_size
      FROM files f
      JOIN versions v ON v.id = f.version_id
      JOIN portals po ON po.id = v.portal_id
      JOIN projects pr ON pr.id = po.project_id
      WHERE pr.owner_id = ${userId}
    ),
    file_bytes AS (
      SELECT COALESCE(SUM(file_size), 0) AS bytes FROM owned_files
    ),
    attachment_bytes AS (
      -- Two hazards here, both of which raise rather than return NULL:
      --   jsonb_array_elements() throws on a non-array, and comments.attachments
      --   is nullable with a '[]' default, so a NULL or a scalar is possible.
      --   The CASE normalises those to an empty array before the function sees
      --   them; a WHERE would be applied too late to help.
      --   ::numeric, not ::bigint, because a JSONB number need not be an
      --   integer and '1234.5'::bigint is an error.
      SELECT COALESCE(SUM(
        CASE WHEN jsonb_typeof(att->'size') = 'number'
             THEN (att->>'size')::numeric
             ELSE 0 END
      ), 0) AS bytes
      FROM comments c
      JOIN owned_files f ON f.id = c.file_id
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(c.attachments) = 'array'
             THEN c.attachments
             ELSE '[]'::jsonb END
      ) AS att
    )
    SELECT (SELECT bytes FROM file_bytes) AS "fileBytes",
           (SELECT bytes FROM attachment_bytes) AS "attachmentBytes",
           (SELECT COUNT(*) FROM projects
             WHERE owner_id = ${userId} AND archived_at IS NULL) AS "projectCount",
           (SELECT plan FROM users WHERE id = ${userId}) AS "planId"
  `;

  const row = rows[0] ?? {};

  // The HTTP driver returns BIGINT and NUMERIC aggregates as strings. Without
  // Number() these concatenate instead of adding.
  const projectBytes =
    Number(row.fileBytes ?? 0) + Number(row.attachmentBytes ?? 0);

  // Trash does not exist yet, so this is a real zero rather than a placeholder.
  // When it ships, this becomes the same sum over soft-deleted rows and nothing
  // downstream changes.
  const trashBytes = 0;

  const plan = planFor(row.planId ?? null);

  return {
    plan,
    storage: {
      projectBytes,
      trashBytes,
      totalBytes: projectBytes + trashBytes,
    },
    projects: {
      count: Number(row.projectCount ?? 0),
      max: plan.maxProjects,
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Run it against the real database**

Run:

```bash
cd /Users/user/Desktop/STIKO-main
node --env-file=.env.local --experimental-strip-types -e "
import('./lib/queries.ts').then(async (m) => {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL);
  const [user] = await sql\`SELECT id, email FROM users ORDER BY created_at LIMIT 1\`;
  console.log('user:', user.email);
  console.log(JSON.stringify(await m.getAccountUsage(user.id), null, 2));
});
"
```

Expected: a JSON object with numeric (not string) `projectBytes` and `count`, `trashBytes: 0`, and `plan.id: "free"`.

**Hard gate:** if `projectBytes` prints as a string, or as something like `"00"`, the `Number()` wrapping in Step 1 was dropped. Fix before continuing.

- [ ] **Step 4: Cross-check the byte total by hand**

Run:

```bash
cd /Users/user/Desktop/STIKO-main
node --env-file=.env.local -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
(async () => {
  const [u] = await sql\`SELECT id FROM users ORDER BY created_at LIMIT 1\`;
  const r = await sql\`
    SELECT COALESCE(SUM(f.file_size), 0) AS bytes
    FROM files f
    JOIN versions v ON v.id = f.version_id
    JOIN portals po ON po.id = v.portal_id
    JOIN projects pr ON pr.id = po.project_id
    WHERE pr.owner_id = \${u.id}\`;
  console.log('files only:', r[0].bytes);
})();
"
```

Expected: a number at or just below the `projectBytes` from Step 3 — equal if that user has no comment attachments, lower if they do.

- [ ] **Step 5: Prove the JSONB guards hold**

The two guards exist because `jsonb_array_elements` *raises* on a non-array
rather than returning nothing. This proves them against every malformed shape
at once — as a pure `SELECT` over literal values, touching no table and writing
nothing. (An earlier draft of this step mutated a real `comments` row and
restored it; against a production database with no staging, a failure between
those two writes would have destroyed a real comment's attachments.)

```bash
cd /Users/user/Desktop/STIKO-main
node --env-file=.env.local -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`
  SELECT t.label,
         COALESCE(SUM(
           CASE WHEN jsonb_typeof(att->'size') = 'number'
                THEN (att->>'size')::numeric ELSE 0 END
         ), 0) AS bytes
  FROM (VALUES
    ('null column',  NULL::jsonb),
    ('object',       '{}'::jsonb),
    ('bare scalar',  '\"str\"'::jsonb),
    ('missing size', '[{\"filename\":\"x\"}]'::jsonb),
    ('string size',  '[{\"size\":\"12\"}]'::jsonb),
    ('float size',   '[{\"size\":12.5}]'::jsonb),
    ('good',         '[{\"size\":12},{\"size\":30}]'::jsonb)
  ) AS t(label, attachments)
  LEFT JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(t.attachments) = 'array'
         THEN t.attachments ELSE '[]'::jsonb END
  ) AS att ON TRUE
  GROUP BY t.label ORDER BY t.label
\`.then(r => r.forEach(x => console.log('  ', x.label, '->', x.bytes)))
 .catch(e => { console.error('GUARD FAILED:', e.message); process.exit(1); });
"
```

Expected: seven rows, no error. `good -> 42`, `float size -> 12.5`, and every
other case `-> 0`.

**Hard gate:** any `GUARD FAILED` output means a guard was altered or dropped.
The `bare scalar` and `object` cases are the ones that raise without the
`CASE`; `string size` is the one that raises without the `jsonb_typeof` check
on `att->'size'`. Restore the guards before continuing — this exact shape 500s
the account menu on real data otherwise.

- [ ] **Step 6: Commit**

```bash
git add lib/queries.ts
git commit -m "feat: add account usage query"
```

---

### Task 5: Usage API route

**Files:**
- Create: `app/api/me/usage/route.ts`

**Interfaces:**
- Consumes: `getAccountUsage` from `lib/queries.ts` (Task 4), `auth` from `lib/auth.ts`.
- Produces: `GET /api/me/usage` returning the `AccountUsage` shape as JSON. Task 8 fetches it.

- [ ] **Step 1: Write the route**

```typescript
// app/api/me/usage/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAccountUsage } from '@/lib/queries';

/**
 * Storage and project usage for the signed-in account, with their plan.
 *
 * Kept out of /api/home deliberately: this scans the user's files and comments,
 * and the dashboard should not pay for it on every paint to populate something
 * only visible after a click. The account menu fetches this lazily on open.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json(await getAccountUsage(session.user.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/me/usage] query failed:', message);

    // Migrations here are manual and have been forgotten before. A missing
    // users.plan is by far the most likely cause of this route failing on a
    // deploy, so say so rather than returning an opaque 500.
    if (/column .* does not exist/i.test(message)) {
      return NextResponse.json(
        {
          error:
            'The database is missing a column this version needs. Run `npm run migrate` to apply lib/migrations.',
          detail: message,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: 'Could not load your usage.' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Verify the route responds**

Start the dev server in one terminal:

```bash
cd /Users/user/Desktop/STIKO-main
npm run dev
```

In a second terminal, confirm it rejects an unauthenticated call:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/me/usage
```

Expected: `401`.

Then sign in at `http://localhost:3000/login` in a browser, open DevTools → Console, and run:

```javascript
await (await fetch('/api/me/usage')).json()
```

Expected: the usage object, with numeric byte values.

- [ ] **Step 4: Commit**

```bash
git add app/api/me/usage/route.ts
git commit -m "feat: add GET /api/me/usage"
```

---

### Task 6: Meter primitive

**Files:**
- Create: `components/ui/Meter.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```typescript
  export interface MeterSegment { fraction: number; color: string; key: string }
  export function Meter(props: { segments: MeterSegment[]; height?: number; label?: string }): JSX.Element
  ```
  Task 7 renders this twice.

- [ ] **Step 1: Write the component**

```tsx
// components/ui/Meter.tsx
import React from 'react';

export interface MeterSegment {
  /** 0–1 of the whole track. Segments are drawn in order, left to right. */
  fraction: number;
  /** A colour from tailwind.config.ts. Do not invent hex values. */
  color: string;
  key: string;
}

/**
 * A horizontal usage bar, one or more segments on a shared track.
 *
 * Presentational only — it knows nothing about plans, bytes or limits, so the
 * stacked storage bar and the plain project bar are the same component rather
 * than two near-duplicates that drift apart.
 */
export function Meter({
  segments,
  height = 6,
  label,
}: {
  segments: MeterSegment[];
  height?: number;
  label?: string;
}) {
  const filled = segments.reduce(
    (sum, s) => sum + Math.max(0, Math.min(s.fraction, 1)),
    0
  );

  return (
    <div
      className="w-full overflow-hidden rounded-full bg-stiko-idle"
      style={{ height }}
      role="img"
      aria-label={label}
    >
      <div className="flex h-full w-full">
        {segments.map((segment) => (
          <div
            key={segment.key}
            className="h-full transition-[width] duration-200"
            style={{
              // Face value while the segments fit. Only once they collectively
              // overflow the track are they scaled down in proportion, so two
              // segments can never sum past 100% and push one off the end.
              width: `${(Math.max(0, Math.min(segment.fraction, 1)) / Math.max(1, filled)) * 100}%`,
              background: segment.color,
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/ui/Meter.tsx
git commit -m "feat: add Meter primitive"
```

---

### Task 7: UsageMeters

**Files:**
- Create: `components/shell/UsageMeters.tsx`

**Interfaces:**
- Consumes: `Meter`, `MeterSegment` (Task 6); `usageFraction` from `lib/plans.ts` (Task 1); `formatBytes` from `lib/design.ts` (Task 2); `SkeletonBar` from `components/ui/Primitives.tsx`.
- Produces:
  ```typescript
  export interface UsagePayload {
    plan: { id: string; label: string; storageBytes: number; maxProjects: number | null };
    storage: { projectBytes: number; trashBytes: number; totalBytes: number };
    projects: { count: number; max: number | null };
  }
  export default function UsageMeters(props: { usage: UsagePayload | null; failed?: boolean }): JSX.Element
  ```
  Task 8 renders this.

- [ ] **Step 1: Write the component**

```tsx
// components/shell/UsageMeters.tsx
'use client';

import React from 'react';
import { Meter } from '@/components/ui/Meter';
import { SectionLabel, SkeletonBar } from '@/components/ui/Primitives';
import { usageFraction } from '@/lib/plans';
import { formatBytes } from '@/lib/design';

export interface UsagePayload {
  plan: {
    id: string;
    label: string;
    storageBytes: number;
    maxProjects: number | null;
  };
  storage: {
    projectBytes: number;
    trashBytes: number;
    totalBytes: number;
  };
  projects: {
    count: number;
    max: number | null;
  };
}

/** Projects segment. */
const PROJECT_COLOR = '#5B60FF'; // stiko.primary
/** Trash segment — deliberately quiet; it is zero until trash ships. */
const TRASH_COLOR = '#A2A7B8'; // stiko.faint
/**
 * Over quota. The palette has no amber fill token, and this is the colour the
 * failed-upload bar already uses, so an over-limit bar reads the same way.
 */
const OVER_COLOR = '#FF6B6B'; // note.red-accent

/**
 * Storage and project usage, as shown in the account menu.
 *
 * Takes its data rather than fetching it, so the same block can be dropped on
 * a settings page later without change.
 */
export default function UsageMeters({
  usage,
  failed = false,
}: {
  usage: UsagePayload | null;
  failed?: boolean;
}) {
  // A failure must never render as "still loading" — that leaves a skeleton on
  // screen forever with the real cause invisible.
  if (failed) {
    return (
      <div className="px-4 py-3 text-[11.5px] text-stiko-faint">
        Usage unavailable
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="space-y-3 px-4 py-3">
        <SkeletonBar width="100%" height={6} />
        <SkeletonBar width="100%" height={6} />
      </div>
    );
  }

  const { plan, storage, projects } = usage;

  const overStorage = storage.totalBytes > plan.storageBytes;
  const projectShare = usageFraction(storage.projectBytes, plan.storageBytes) ?? 0;
  const trashShare = usageFraction(storage.trashBytes, plan.storageBytes) ?? 0;

  const storageSegments = overStorage
    ? [{ key: 'over', fraction: 1, color: OVER_COLOR }]
    : [
        { key: 'projects', fraction: projectShare, color: PROJECT_COLOR },
        { key: 'trash', fraction: trashShare, color: TRASH_COLOR },
      ];

  const projectFraction = usageFraction(projects.count, projects.max);
  const overProjects = projects.max !== null && projects.count > projects.max;

  return (
    <div className="space-y-3 px-4 py-3">
      <div>
        <Row
          left="Storage"
          right={`${formatBytes(storage.totalBytes)} / ${formatBytes(plan.storageBytes)}`}
          alarm={overStorage}
        />
        <div className="mt-[6px]">
          <Meter
            segments={storageSegments}
            label={`${formatBytes(storage.totalBytes)} of ${formatBytes(plan.storageBytes)} used`}
          />
        </div>
        <div className="mt-[6px] flex items-center gap-3 text-[11px] text-stiko-muted">
          <Legend color={PROJECT_COLOR}>
            Projects {formatBytes(storage.projectBytes)}
          </Legend>
          <Legend color={TRASH_COLOR}>
            Trash {formatBytes(storage.trashBytes)}
          </Legend>
        </div>
      </div>

      <div>
        <Row
          left="Projects"
          right={
            projects.max === null
              ? String(projects.count)
              : `${projects.count} of ${projects.max}`
          }
          alarm={overProjects}
        />
        {/* An unlimited plan gets no bar — a bar with no denominator is
            meaningless, so the count stands on its own. */}
        {projectFraction !== null && (
          <div className="mt-[6px]">
            <Meter
              segments={[
                {
                  key: 'projects',
                  fraction: projectFraction,
                  color: overProjects ? OVER_COLOR : PROJECT_COLOR,
                },
              ]}
              label={`${projects.count} of ${projects.max} projects used`}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  left,
  right,
  alarm,
}: {
  left: string;
  right: string;
  alarm: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <SectionLabel>{left}</SectionLabel>
      <span
        className={`text-[11.5px] font-semibold ${
          alarm ? 'text-[#FF6B6B]' : 'text-stiko-secondary'
        }`}
      >
        {right}
      </span>
    </div>
  );
}

function Legend({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-[5px]">
      <span
        className="inline-block h-[7px] w-[7px] rounded-full"
        style={{ background: color }}
      />
      {children}
    </span>
  );
}
```

- [ ] **Step 2: Check SkeletonBar's actual props**

Run: `sed -n '388,410p' components/ui/Primitives.tsx`

Expected: the `SkeletonBar` signature. If its props are not `width`/`height`, adjust the two calls in Step 1 to match what it really takes — do not change `SkeletonBar` itself.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/shell/UsageMeters.tsx
git commit -m "feat: add UsageMeters block"
```

---

### Task 8: Wire into the account menu

**Files:**
- Modify: `components/shell/AvatarMenu.tsx`

**Interfaces:**
- Consumes: `UsageMeters`, `UsagePayload` (Task 7); `GET /api/me/usage` (Task 5).
- Produces: the finished feature. Nothing consumes it.

- [ ] **Step 1: Replace the file**

```tsx
// components/shell/AvatarMenu.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import Popover from '@/components/ui/Popover';
import { Avatar } from '@/components/ui/Primitives';
import UsageMeters, { type UsagePayload } from './UsageMeters';

/**
 * The account menu (gap #9 — there was no sign-out anywhere in the product).
 */
export default function AvatarMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);

  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [usageFailed, setUsageFailed] = useState(false);
  const requested = useRef(false);

  const name = session?.user?.name ?? session?.user?.email ?? '?';
  const id = session?.user?.id ?? 'me';

  // Fetched on first open, not on mount: this scans the user's files and
  // comments, and most dashboard visits never open this menu. Held for the life
  // of the mount afterwards — usage does not move fast enough to refetch.
  useEffect(() => {
    if (!open || requested.current) return;
    requested.current = true;

    fetch('/api/me/usage')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(setUsage)
      .catch((err) => {
        console.error('Failed to load usage', err);
        setUsageFailed(true);
      });
  }, [open]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        className="flex items-center gap-1 rounded-pill p-[3px] transition hover:bg-stiko-app"
      >
        <Avatar id={id} name={name} size={30} />
        <svg
          className="h-3 w-3 text-stiko-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <Popover isOpen={open} onClose={() => setOpen(false)} width={300}>
        <div className="flex items-center gap-3 px-4 py-[14px]">
          <Avatar id={id} name={name} size={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold text-stiko-ink">
              {session?.user?.name ?? 'You'}
            </div>
            <div className="truncate text-[11.5px] text-stiko-muted">
              {session?.user?.email}
            </div>
          </div>
          {/* Only once the real plan is known — a badge that flips from Free to
              Standard a beat after opening reads as a bug. */}
          {usage && (
            <span className="shrink-0 rounded-chip bg-stiko-tint px-[7px] py-[3px] text-[10px] font-extrabold uppercase tracking-label text-stiko-primary">
              {usage.plan.label}
            </span>
          )}
        </div>

        <div className="border-t border-stiko-border">
          <UsageMeters usage={usage} failed={usageFailed} />
        </div>

        <div className="border-t border-stiko-border p-2">
          <MenuLink href="/settings/account" onClick={() => setOpen(false)}>
            Account settings
          </MenuLink>
          <MenuLink href="/settings/notifications" onClick={() => setOpen(false)}>
            Notifications
          </MenuLink>
        </div>

        <div className="border-t border-stiko-border p-2">
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="block w-full rounded-[10px] px-3 py-[9px] text-left text-[13px] font-semibold text-stiko-secondary transition hover:bg-stiko-app hover:text-stiko-ink"
          >
            Sign out
          </button>
        </div>
      </Popover>
    </div>
  );
}

function MenuLink({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block rounded-[10px] px-3 py-[9px] text-[13px] font-semibold !text-stiko-secondary transition hover:bg-stiko-app hover:!text-stiko-ink"
    >
      {children}
    </Link>
  );
}
```

- [ ] **Step 2: Typecheck and run the suite**

Run: `npx tsc --noEmit && npm test`

Expected: no type errors, all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add components/shell/AvatarMenu.tsx
git commit -m "feat: show usage meters and plan in the account menu"
```

---

### Task 9: Verify in a browser

Nothing so far proves this renders. Per `docs/superpowers/specs` precedent, a feature is not done until it has been opened.

**Files:** none.

**Interfaces:**
- Consumes: everything above.
- Produces: confirmation, or a defect list.

- [ ] **Step 1: Start the app**

```bash
cd /Users/user/Desktop/STIKO-main
npm run dev
```

- [ ] **Step 2: Check the default state**

Sign in at `http://localhost:3000/login`, then click the avatar at the top right.

Expected: a 300px popover. Plan badge reads **FREE**. A storage bar with a "Projects … / Trash 0 B" legend, and a project bar reading "N of 2". No layout shift after the data lands beyond the skeletons filling in.

- [ ] **Step 3: Check the paid tier and the unlimited case**

```bash
cd /Users/user/Desktop/STIKO-main
node --env-file=.env.local -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`UPDATE users SET plan = 'standard' WHERE email = 'muhammadalnahian@gmail.com'\`
  .then(() => console.log('now standard'));
"
```

Reload, reopen the menu.

Expected: badge reads **STANDARD**, storage limit reads 100 GB, and the projects row shows a **bare count with no bar** — this is the unlimited path.

- [ ] **Step 4: Check the over-quota state**

```bash
cd /Users/user/Desktop/STIKO-main
node --env-file=.env.local -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`UPDATE users SET plan = 'free' WHERE email = 'muhammadalnahian@gmail.com'\`
  .then(() => console.log('back to free'));
"
```

If the account holds under 2 GB, temporarily lower the Free limit in `lib/plans.ts` to `1024` bytes, reload, and confirm the bar goes full-width red and the figure turns red. **Restore the real value afterwards** and confirm `git diff lib/plans.ts` is empty.

- [ ] **Step 5: Check the unknown-plan path**

```bash
cd /Users/user/Desktop/STIKO-main
node --env-file=.env.local -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`UPDATE users SET plan = 'enterprise' WHERE email = 'muhammadalnahian@gmail.com'\`
  .then(() => console.log('set to a bogus tier'));
"
```

Reload, reopen.

Expected: badge falls back to **FREE**, the menu renders normally, and the dev-server terminal logs `[plans] unknown plan "enterprise", using Free`. Then restore:

```bash
cd /Users/user/Desktop/STIKO-main
node --env-file=.env.local -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`UPDATE users SET plan = 'free' WHERE email = 'muhammadalnahian@gmail.com'\`
  .then(() => console.log('restored'));
"
```

- [ ] **Step 6: Check the failure path**

In DevTools → Network, block the `/api/me/usage` request (right-click → Block request URL), then hard-reload and open the menu.

Expected: a muted "Usage unavailable" line. **Not** a skeleton that never resolves. Unblock afterwards.

- [ ] **Step 7: Confirm the working tree holds only intended changes**

Run: `git status --porcelain`

Expected: the three known untracked handoff directories and nothing else. No modified files.

- [ ] **Step 8: Commit any fixes found**

If steps 2–6 turned up defects, fix them, re-run `npx tsc --noEmit && npm test`, and commit with explicit paths.

---

## Deploy

The migration must land **before** the code, or `/api/me/usage` selects a column that does not exist. It is manual here and has been forgotten before.

```bash
cd /Users/user/Desktop/STIKO-main
node --env-file=.env.local scripts/migrate.mjs
```

Rollback is to revert the code. The column is additive with a default and is harmless if left in place.

## Not in scope

- Enforcing either limit anywhere.
- Checkout, payment, upgrade flow, Stripe.
- The trash feature itself. This builds the segment that will display it.
- Counting converted derivatives or markup snapshots toward storage.
- A settings-page version of the meters. `UsageMeters` takes its data as a prop so this is additive later.
