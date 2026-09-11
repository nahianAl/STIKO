# Account usage meters and plan badge

**Date:** 2026-09-11
**Status:** Designed, not implemented

## Problem

The account popover in the dashboard top bar shows a name, an email, two links
and a sign-out. It says nothing about how much of the product you are using or
what you are entitled to. There is no plan, quota or subscription concept
anywhere in the codebase — no `users.plan`, no billing integration, no limit
constants.

Add to that popover:

1. A storage meter, split into what projects hold and what trash holds.
2. A project-count meter.
3. The user's subscription plan.

## Decisions taken

| Question | Decision |
| --- | --- |
| Where do plan and limits come from? | A `users.plan` column plus a hardcoded catalogue in `lib/plans.ts`. No payment integration. |
| What counts as used bytes? | Uploaded files **and** comment attachments. |
| Whose bytes and projects? | Only projects the user **owns**. Not projects they were invited into. |
| Second meter counts what? | Projects, not packages. |
| Trash, which does not exist yet? | Build the segment now, show it at a real zero. |
| Where does it render? | Inline in the account popover, compact. |
| Tiers | Free: 2 GB, 2 projects. Standard (paid): 100 GB, unlimited projects. |

## Scope boundary

This is a **readout, not an enforcement mechanism**.

- Nothing blocks a third project on Free, and nothing blocks an upload that
  busts 2 GB. Existing accounts may already be over either limit on the day
  this ships, and the UI must render that state without breaking.
- There is no checkout, upgrade flow or payment integration. A user is moved to
  Standard with a one-line `UPDATE` until billing exists.
- The badge is therefore informational. It shows "Free" with no way to act on
  it from the UI.

Both limits are enforced nowhere by design. Enforcement is a separate piece of
work with its own failure modes (what happens to an over-quota account, whether
uploads hard-fail or soft-warn) and does not belong in a display change.

## Architecture

### 1. Schema

`lib/migrations/010-plans.sql`, mirrored into `lib/schema.sql`:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
```

Deliberately **no `CHECK` constraint** on the value. The catalogue of tiers
lives in code, and a CHECK would force a migration every time a tier is added
or renamed. Instead an unrecognised value resolves to Free in code with a
`console.warn`. The cost of this choice is that a typo in an `UPDATE` degrades
silently to Free rather than being rejected by the database; the warn is what
makes it findable.

Existing users pick up `'free'` from the column default.

### 2. Plan catalogue — `lib/plans.ts`

Single source of truth for tier identity and limits. Pure module, no DB import,
so it is unit-testable.

```ts
export type PlanId = 'free' | 'standard';

export interface Plan {
  id: PlanId;
  label: string;
  storageBytes: number;
  /** null means unlimited. */
  maxProjects: number | null;
}

export const PLANS: Record<PlanId, Plan> = {
  free:     { id: 'free',     label: 'Free',     storageBytes: 2 * 1024 ** 3,   maxProjects: 2 },
  standard: { id: 'standard', label: 'Standard', storageBytes: 100 * 1024 ** 3, maxProjects: null },
};

export const DEFAULT_PLAN: PlanId = 'free';

/** Always returns a valid plan. Unknown or null resolves to Free. */
export function planFor(value: string | null | undefined): Plan;
```

Limits are binary units (1 GB = 1024^3), matching the base the existing
`formatSize` helper already uses, so that a user exactly at the limit reads
"2.0 / 2 GB" rather than a rounding artefact.

### 3. Usage query — `getAccountUsage(userId)` in `lib/queries.ts`

Scoped throughout to `projects.owner_id = userId`. Returns:

- **`projectBytes`** — `SUM(files.file_size)` over every file in every version
  of every package in every owned project, plus the `size` field summed out of
  `comments.attachments` for comments on those files.
- **`trashBytes`** — literal `0` today, with a comment naming where the real
  query goes once trash exists.
- **`projectCount`** — owned projects with `archived_at IS NULL`.

Two guards on the JSONB sum. Both are crash risks, not style points — either
one 500s the route on real data:

- `jsonb_typeof(attachments) = 'array'` — `jsonb_array_elements` throws on a
  NULL or scalar. The column defaults to `'[]'` but is not `NOT NULL`.
- `jsonb_typeof(att->'size') = 'number'` — a missing or string `size` on an
  older attachment row throws on the `::bigint` cast.

### What counts, precisely

Included:

- Files in **archived packages**. The bytes are still in S3. Archiving is not
  trashing, so they sit in the Projects segment, not the Trash segment.
- Files in **unpublished draft versions**. They occupy real storage.

Excluded:

- **Converted derivatives** (`converted_storage_key`). No byte size is recorded
  for them anywhere; counting them would need a new column backfilled by S3
  HEAD requests. Separately, these are bytes the product generated, not bytes
  the user uploaded.
- **Markup snapshot images** (`comments.snapshot_url`). Same reason — no size
  is recorded.

The consequence is that the number shown is smaller than the true S3 footprint.
That is the right trade: the figure a user sees should be one they can act on
by deleting their own content.

### Counting asymmetry, stated deliberately

Bytes include archived packages; the project count excludes archived projects.
These are different questions. "How much space am I using" must include
everything that occupies space. "How many of my 2 projects are gone" must
count only projects that are in the way of creating a new one.

Note that nothing in the app currently writes `projects.archived_at` — only
`portals.archived_at` is reachable from the UI — so the project filter is
inert today and exists so the count stays correct when project archiving
arrives.

### 4. API — `GET /api/me/usage`

New route beside the existing `app/api/me/route.ts`, auth-gated identically
(401 when there is no session user).

```json
{
  "plan":     { "id": "free", "label": "Free", "storageBytes": 2147483648, "maxProjects": 2 },
  "storage":  { "projectBytes": 0, "trashBytes": 0, "totalBytes": 0 },
  "projects": { "count": 0, "max": 2 }
}
```

Kept **out of `/api/home`** on purpose. This is a full scan of the user's files
and comments; folding it into the dashboard payload would tax every paint of
the first screen for something only visible after a click. The popover fetches
it lazily on first open and holds it for the life of the mount.

### 5. UI

**`components/ui/Meter.tsx`** — presentational primitive taking a `segments[]`
array so the stacked storage bar and the plain project bar are one component
rather than two near-duplicates. Knows nothing about plans or bytes.

**`components/shell/UsageMeters.tsx`** — takes the `/api/me/usage` payload and
renders both rows plus the legend. No fetching of its own, so it can be
rendered from a settings page later without change.

**`components/shell/AvatarMenu.tsx`** — widens 240 → 300, adds the plan badge
beside the name, adds the meters section between the identity block and the
links, and owns the lazy fetch.

**`formatBytes` in `lib/design.ts`** — the current `formatSize` is local to
`UploadProgress.tsx` and caps out at MB, so it cannot render "2 GB". The new
helper is added to `lib/design.ts` beside the other formatters, and
`UploadProgress.tsx` is pointed at it so the duplicate goes away.

Layout:

```
+------------------------------------+
| (MA)  Muhammad          [ Free ]   |
|       m@stiko.design               |
+------------------------------------+
| Storage               1.4 / 2 GB   |
| ######################~~~~~~~~~~   |
| # Projects 1.4 GB   # Trash 0 B    |
|                                    |
| Projects                 1 of 2    |
| ################~~~~~~~~~~~~~~~~   |
+------------------------------------+
| Account settings                   |
| Notifications                      |
+------------------------------------+
| Sign out                           |
+------------------------------------+
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Unlimited projects (Standard) | No bar. A bar with no denominator is meaningless. The row renders as a plain count: "Projects · 14". |
| Over quota | Bar clamps at 100% and turns amber. Reachable today, since nothing enforces the limits. |
| Zero usage | Both bars render empty rather than being hidden. A new user should see what the limits are. |
| Trash at zero | Segment and legend both render, showing "Trash 0 B". |
| Fetch fails | A single muted line, "Usage unavailable". Never a permanent skeleton — a failure must not render as "still loading". |
| Unknown `plan` value | Resolves to Free, warns to the server console. |

## Testing

`node --test scripts/tests/*.mjs`, following the existing convention of testing
pure modules directly from `.ts`:

- `planFor` resolves unknown, null and empty plan values to Free.
- Every catalogue entry has a label, a positive byte limit, and a project limit
  that is either a positive integer or null.
- Meter maths: fraction at zero, partway, exactly at limit, and over limit
  (clamped to 1).
- Unlimited plans produce no fraction at all rather than a divide-by-zero.
- `formatBytes` boundaries: bytes, KB, MB, GB, and the MB→GB crossover.

The SQL cannot be covered this way — it needs a live database. It gets verified
by hand against the real one: a known account's figure checked against a direct
`SUM`, and an account with a NULL/legacy `attachments` row checked to confirm
the guards hold.

## Deploy

The migration is manual and must land before the code, or `/api/me/usage`
selects a column that does not exist.

```
set -a && . .env.local && set +a && npm run migrate
```

Rollback is to revert the code. The column is additive with a default and
harms nothing if left in place.

## Not in scope

- Enforcing either limit.
- Checkout, payment, upgrade flow, or any Stripe integration.
- The trash feature itself. This builds the segment that will display it.
- Counting converted derivatives or snapshot images toward storage.
- A settings-page version of the meters. `UsageMeters` is built so this is
  additive later.
