# Trash, the project panel, and one place to manage people

**Date:** 2026-09-18
**Status:** Design, approved for planning
**Trigger:** Deleting a project or a package is effectively impossible from the dashboard, and managing who is on what is split across two surfaces that each hold half the controls.

---

## The problem

Deletion is not missing. It is buried, and in the project's case it refuses.

**Packages** delete from `app/portal/[id]/settings/page.tsx`, four clicks from the dashboard: open the package, open its settings, find the danger zone, type the name. The delete itself is correct — rows cascade and `deleteObjects` clears S3 — but it is unrecoverable, and nothing on the dashboard hints that it exists.

**Projects** delete from a danger card inside `ProjectPeopleDrawer`, which opens by clicking the avatar stack. Nothing about a row of faces suggests project deletion lives behind it. Worse, `DELETE /api/projects/[id]` refuses while any portal row exists — archived ones included — so deleting a six-package project means six separate four-click journeys first, and only then does the project itself become deletable.

**People** are managed in two places that do not overlap:

| | People drawer (project-wide) | `/portal/[id]/settings/people` (per package) |
|---|---|---|
| See everyone at once | yes, person × package grid | no, one package |
| Change a role | yes | yes |
| Pending vs accepted | **no** | yes |
| Resend / revoke an invite | **no** | yes |
| Version scoping | **no** | yes |
| Download permission | **no** | yes |
| Reachable from the dashboard | yes | no |

The complete feature set exists. No single screen has it. That is the drift this design exists to end: each surface grew the half of the controls its own screen needed, and neither grew pending state.

## Scope

In:

- A trash holding **projects and packages**, with restore and a 28-day expiry
- A **project panel** on the dashboard carrying packages, people and deletion
- **One access editor** for a (person × package) pair, used by both people views
- Retiring **Archive** and `/portal/[id]/settings/people`

Deliberately out:

- **Versions, files and comments keep their existing delete flows.** Restoring a file into a version that has since been published, commented on and superseded is a different act from restoring a package, and it would fill a guest's trash with content from packages they only review. Comments already soft-delete with an undo window.
- **No manual empty, and no permanent-delete control.** Expiry is the only path out of the trash.
- **No quota enforcement.** `maxProjects` and `storageBytes` in `lib/plans.ts` stay display-only until Stripe lands.

## Decisions, and why

### Trash counts against storage; the project count excludes it

Trashed bytes remain in S3 and keep counting toward the storage meter, which is honest — the user has not freed anything yet. The *project count* excludes trashed projects, because "how much space am I using" and "how many projects are in my way" are different questions. `getAccountUsage` already documents exactly this asymmetry for archived projects; trash inherits it.

`AccountUsage.storage.trashBytes` already exists as a zero placeholder with a comment anticipating this change, and `UsageMeters` already renders a trash segment. Populating the number is the whole of that work.

### Expiry is computed at read time; the purge job is only cleanup

Every read filters `deleted_at > now() - 28 days`. An item past its window is invisible and unrestorable the moment it expires, whether or not the purge has run.

This matters more than the scheduler choice. Migrations here have been forgotten twice and there is no staging environment; a missed cron should cost storage, not correctness. It also means no user ever sees "−3 days left" or restores something that should already be gone.

### One card per deliberate deletion

The trash lists what a person chose to delete. Packages swept along by a project deletion are described on the project's card ("6 packages go back with it"), not listed separately — otherwise one deletion floods the panel.

This forces a distinction in the data. Consider:

- **Sep 1** — package *Level 2 RCP* is deleted on its own. Its 28-day clock starts.
- **Sep 10** — its project is deleted, sweeping the five remaining packages. Their clock starts now.
- **Sep 15** — the project is restored. The five swept packages come back. *Level 2 RCP* must **not** — it was deliberately deleted nine days earlier and nobody asked for it back.

So a trashed package records whether it was deleted directly or carried in by its project. One boolean, `deleted_with_project`. Restoring a project revives only the packages that carry it.

The mirror case is decided rather than asked: **restoring a package whose project is still trashed quietly restores the project too.** A package cannot exist without one, the intent is unambiguous, and an empty restored project is harmless.

### The trash belongs to the content, not to the actor

You see everything deleted from projects you own or coordinate, regardless of who deleted it, and each card names who did. The alternative — only what you personally deleted — means a project owner cannot undo a coordinator's mistake without asking that person to log in. That is the one job a trash exists for.

In practice today this is the owner alone: only `owner` and `coordinator` can delete a package (`lib/capabilities.ts`), and nothing in the codebase writes `project_members`, so coordinators do not yet exist. Guests can delete no container, so their trash is always empty — the button still shows, with an empty state.

### Archive retires

Archive was kept in an earlier round of this design and then removed from the panel on the grounds that two reversible states confuse people. That leaves it in a half-state worth resolving properly: `archived_at` exists, archived packages are hidden from the dashboard with no way to reach them, and they still block project deletion. A mechanism with no entry point is not a feature, it is a trap for whoever reads the code next.

So Archive goes — from the panel, from `PATCH /api/portals/[id]`, and from the package settings page. Trash already covers "I want this gone but might change my mind," which is the honest majority of what Archive was for.

**The column and its values stay.** Nothing nulls `archived_at`; the read paths simply stop filtering on it, so any currently-archived package reappears on the dashboard rather than being stranded. That un-archives everything in effect without destroying the record of what had been archived, and makes the rollback a revert rather than a restore. Dropping the column is a later decision, made once someone has looked at production and confirmed it is unused.

### Approaches considered for the purge

**Vercel Cron** — chosen. `ARCHITECTURE.md` already puts the app on Vercel; a daily tick against `/api/cron/purge-trash`, guarded by `CRON_SECRET`, is enough for a 28-day window and fits the two-cron Hobby allowance. Costs one new piece of infrastructure to remember.

**Lazy sweep on dashboard load** — rejected. No infrastructure, but an account nobody signs into never purges and keeps costing S3 indefinitely, and it puts a batch of S3 deletes in the path of a page load.

**GitHub Actions cron** — rejected as a larger surface than the problem. There is no `.github/` in this repo; adding CI purely to run one daily HTTP request introduces a whole deployment concern for no gain over Vercel's own scheduler.

### Approaches considered for the people panel

**Package-first** — a list of packages, each expanding to its own people. Matches how the feature was described and keeps everything about one package together. Poor at the cross-package question.

**People-first grid** — the existing `TeamMatrix`, upgraded. Best at the question packages exist to answer: *can the client see the consultant's markup?* is one row. Poor at "who is on Facade Study", which becomes reading a column.

**Package-first with the grid one click away** — chosen. A package is a permission boundary, so the cross-package view has to be reachable, but it is not the common case. Package-first is the default; a link in the Everyone strip swaps the same panel to the grid. Both granularities, one place, no tab to learn before it is needed.

---

## Data model

`lib/migrations/014-trash.sql`. **010 is reserved** for the unimplemented WorkOS migration — do not reuse it.

```sql
-- Soft deletion for the two container objects. Neither reuses archived_at:
-- archive is being retired, and overloading its column would make the rollback
-- indistinguishable from the feature.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_by TEXT
  REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE portals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE portals ADD COLUMN IF NOT EXISTS deleted_by TEXT
  REFERENCES users(id) ON DELETE SET NULL;

-- Was this package deleted on its own, or swept in by its project? Restoring a
-- project revives only the packages that say "swept". Without this, a package
-- deliberately deleted before its project would come back with it.
ALTER TABLE portals ADD COLUMN IF NOT EXISTS deleted_with_project BOOLEAN
  NOT NULL DEFAULT FALSE;

-- Partial: the trash is a tiny minority of rows and every query that reads it
-- asks for exactly this predicate.
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at
  ON projects(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_portals_deleted_at
  ON portals(deleted_at) WHERE deleted_at IS NOT NULL;
```

`deleted_by` is `ON DELETE SET NULL`, matching `files.uploaded_by` and `versions.created_by`: removing a user account must never destroy the record of what was deleted. The card then reads "deleted by someone who has since left", which is true and useful.

A boolean rather than a `deleted_via_project_id` FK, because a package's project is already `portals.project_id`. Restoring project *P* revives `WHERE project_id = P AND deleted_with_project`. A second reference would be redundant and could disagree with the first.

Mirror all of this into `lib/schema.sql`.

`lib/trash.ts` holds `TRASH_RETENTION_DAYS = 28` and the cutoff helper, so the window is one constant rather than an interval literal repeated across a dozen queries.

## The filter, and the risk

**This is the part most likely to ship a bug.** Soft deletion is only correct if every read path excludes trashed rows — a missed one leaves a deleted package reachable, which for a permission-boundary object is a data leak, not a cosmetic slip.

Call sites that must gain the filter:

- `lib/access.ts` — `getPackageAccess`, and the `archived_at IS NULL` at line 181. **The critical one:** if a trashed package still resolves access, every route that trusts `getPackageAccess` serves it.
- `lib/queries.ts` — `getHomeData`'s `visible` CTE, the `emptyProjectRows` query, and `getAccountUsage`'s project count
- `app/api/projects/route.ts`, `app/api/projects/[id]/route.ts`, `app/api/projects/[id]/overview/route.ts`
- `app/api/portals/route.ts`, `app/api/portals/[id]/route.ts`
- `lib/ai/summarize.ts` — three joins currently keyed on `archived_at IS NULL`

The `archived_at IS NULL` clauses are the hook: every one of them is a place that already knew to exclude hidden packages, and each becomes a `deleted_at` window check. That correspondence is the practical checklist — but it is not sufficient on its own, because `getPackageAccess` is reached by paths that never filtered archive at all. The plan should include a grep for every `FROM portals` and `FROM projects` in the repo, checked one by one.

## API

**`DELETE /api/projects/[id]`** — becomes a soft delete. The "still has packages" 409 guard is **removed**: deleting a project now sweeps its packages into the trash with `deleted_with_project = TRUE`, which is the behaviour the guard existed to prevent when deletion was irreversible. Owner only, unchanged. No `deleteObjects` call — nothing leaves S3 until the purge.

**`DELETE /api/portals/[id]`** — becomes a soft delete, `deleted_with_project = FALSE`. Still gated on `canManagePeople`. No `deleteObjects`.

**`GET /api/trash`** — projects and packages the caller owns or coordinates, within the window, newest first. Each row carries name, kind, parent project name for packages, swept-package count for projects, byte total, `deletedAt`, deleting user's name, and computed days remaining.

**`POST /api/trash/restore`** — `{ kind, id }`. Clears `deleted_at`, `deleted_by`, and for a project clears `deleted_with_project` on the packages it swept. Restoring a package whose project is trashed restores the project too, in the same transaction. Re-checks the expiry window server-side: a panel left open past midnight must not resurrect an expired item.

**`GET /api/cron/purge-trash`** — requires `Authorization: Bearer $CRON_SECRET`. Collects storage keys via `storageKeysForFiles` **before** deleting, then hard-deletes expired projects and packages and calls `deleteObjects`. Rows cascade as they do today. Idempotent, and safe to run twice.

`vercel.json` gains a daily schedule. The endpoint must also be added to `PUBLIC_PATHS` handling in `middleware.ts` — or explicitly excluded from auth — since Vercel's cron invoker carries no session. **Note the prefix trap recorded in the auth-hardening work:** a careless `PUBLIC_PATHS` entry can match more routes than intended.

## UI

### The dashboard row

Three affordances, three verbs:

- **Chevron** — expands the package list inline, exactly as today. A fast scan. Nothing destructive.
- **Avatars** — open the project panel onto the cross-package people grid.
- **⤢ Expand** — opens the project panel. Appears on hover, and stays visible while the row is expanded, so it is never in the way and never far.

**Implementation trap:** `ProjectListRow` documents that the row is one absolutely-positioned button beneath a `pointer-events-none` layer, because a button cannot nest inside a button. The new ⤢ control must re-enable `pointer-events-auto` on its own cell the way the People cell does, and call `stopPropagation` — the page root carries a deselect-on-background-click handler that will otherwise undo the open in the same React batch.

### The project panel

`components/home/ProjectPanel.tsx`, replacing `ProjectPeopleDrawer`.

- **Header** — project name, the viewer's role tag, package and people counts, created date.
- **Everyone strip** — avatar stack, a "*n* not accepted" chip when any invite is pending, "+ Add people", and "See everyone across packages →" which swaps the body to the grid.
- **Packages** — one row each with name, latest version chip, created date and its own avatar stack, so "who is in each package" is answerable without expanding anything. Expanding reveals its people with role tags and pending state, a per-person ⋯, "+ Add person", and **Delete package**.
- **Danger strip**, pinned at the bottom — **Delete project**, stating how many packages go with it and that it is recoverable for 28 days.

No Archive control. No create-package control — that stays on the dashboard where it already lives.

Both destructive actions keep `DestructiveConfirm`, but the consequence copy changes from "This cannot be undone" to the truth: recoverable for 28 days, and still counting toward storage until then.

### The access editor

`components/people/AccessEditor.tsx` — one component for a (person × package) pair, which is literally one `participants` row. Holds role, version scoping, download permission, and remove-from-package. Opens from a package row's ⋯ **and** from a grid cell.

This is the fix for the drift described at the top. Two views pointing at the same row must open the same editor, or each grows its own half of the controls again.

`TeamMatrix` gains pending rows, resend and revoke, and delegates cell editing to `AccessEditor` instead of its own inline role menu.

### The trash panel

Button at the bottom-left of the dashboard shell, count badge only when non-empty. Opens a panel of cards, each showing kind, name, parent project for packages, what goes back with it, byte weight, who deleted it and when, days remaining, and **Restore**. Items in their final days are marked. Empty state explains the 28-day rule and that trashed items still count toward storage.

## Retirements

- `ProjectPeopleDrawer` → replaced by `ProjectPanel`
- `/portal/[id]/settings/people` → deleted, redirecting to the dashboard with that project's panel open. Everything it did lives in the panel; keeping it would mean wiring the same editor twice, which is how the two surfaces drifted apart in the first place.
- Archive UI in `/portal/[id]/settings`, and the `archived` branch of `PATCH /api/portals/[id]`
- The `archived_at IS NULL` filters, replaced by `deleted_at` window checks

## Testing

`npm test` runs `node --test scripts/tests/*.mjs`. **Tested modules must not use the `@/` alias, and `lib/queries` must be imported as `import type`** — both rules have bitten this repo before.

Pure-logic tests, no database:

- `lib/trash.ts` — the cutoff helper across the boundary: 27 days is live, 28 is expired, 29 is expired
- Restore resolution — given a project and a mixed set of packages, restoring the project revives only `deleted_with_project` rows. The Sep 1 / Sep 10 / Sep 15 case above is the fixture.
- Trash card shaping — swept counts, byte totals, days-remaining arithmetic

Queries and routes are covered by the existing manual pass against a real database, as elsewhere in this codebase.

## Rollout

Production is the only environment and migrations are applied by hand, so:

1. Apply `014-trash.sql` and verify it in `schema_migrations` **before** deploying. Every new column is additive and nullable (or defaulted), so the migration is safe to apply ahead of the code.
2. Deploy. Soft deletion begins immediately; nothing is purged for 28 days.
3. Add `CRON_SECRET` and the `vercel.json` schedule. **The purge can safely land in a later deploy** — nothing expires for four weeks, and computed expiry means the UI is correct in the meantime.

**Rollback:** revert the deploy. The new columns are additive and unread by the old code; previously-archived packages reappear on the dashboard under the new code and re-hide under the old. Anything soft-deleted while the feature was live becomes invisible to the old code — it filters on `archived_at`, not `deleted_at` — so trashed items would appear restored. That is recoverable rather than destructive, and no S3 object is removed until the purge runs.

## Phasing

This is one design but it should not be one implementation plan — it is a migration, four routes, a cron endpoint, three new components and two retirements. Two plans, in order:

**Plan 1 — Trash.** Migration 014, soft deletion on both DELETE routes, the filter sweep across every read path, `GET /api/trash`, `POST /api/trash/restore`, the trash button and panel, `trashBytes` in `getAccountUsage`, and the purge endpoint with its schedule. Deliverable on its own: deletion becomes recoverable, reachable from the two places it already lives.

**Plan 2 — Project panel and people.** `ProjectPanel`, `AccessEditor`, the `TeamMatrix` upgrade, the ⤢ affordance, retiring `ProjectPeopleDrawer`, `/portal/[id]/settings/people` and the Archive UI.

The order matters: plan 2 puts Delete package and Delete project into the panel, and those should already be soft by the time they become easy to reach. Doing it the other way round makes irreversible deletion three clicks more discoverable for however long plan 1 takes.

## Deferred

**Does a trashed project consume a project slot?** Moot today, since `maxProjects` is display-only. It becomes a real decision the day Stripe enforcement lands, and it has a deadlock in it: if trashed projects count and users cannot empty the trash, a free user at their limit who deletes a project to make room has no lever. The likely answer is that trashed projects do not count toward the project limit — which is what this design already does for the readout — while trashed bytes continue to count toward storage.

**Dropping `archived_at`.** Left in place deliberately; drop it once production confirms it is unused.
