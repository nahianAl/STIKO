# Live updates in the portal: comments, roster and versions without a refresh

**Date:** 2026-09-17
**Status:** Design, approved for planning
**Trigger:** Reviewing a package today requires manually refreshing the page to see a comment someone else posted, or to notice that an invited participant has joined. Two people reviewing side by side cannot see each other's work.

---

## The problem

`app/portal/[id]/page.tsx` is a client component that fetches its data **once on mount** and never again. Portal, participants, versions, files and comments each land in a `useEffect` keyed on an id that does not change while the page is open.

The one exception is a comment you post yourself: `handleSubmitComposer` bumps `commentsRefreshKey`, which re-runs the page's pin fetch and `CommentsPanel`'s own fetch. Nothing else in the page ever re-queries the server.

So the portal is correct at the instant it loads and stale from then on. Every other participant's activity is invisible until the page is reloaded by hand.

## Scope

Live, without a refresh:

- **Comments and replies** — including edits and deletions, not just new posts
- **Participants** — someone accepting an invite appears in the roster
- **Versions and files** — a published version or an added file appears in the sidebar

Deliberately **not** in scope: verdicts, AI briefs, part colours, calibrations, object transforms. No presence indicators. No "who is viewing this" surface.

One limitation follows from the cursor's shape and is accepted rather than overlooked: **a role or scope change to an existing participant is not detected.** `PATCH /api/participants/role` alters a row without changing the row count or `created_at`, so the participant pair does not move. Joins and removals — the stated requirement — are both detected, because both change the count. Covering in-place edits would mean adding `participants.updated_at` on the same pattern as `comments.edited_at`; that is a small, obvious follow-up if the roster panel ever needs it, and is left out here to keep this change to what was asked for.

## Freshness target

**Within a few seconds.** Explicitly not chat-grade. A comment thread on an engineering review does not need sub-second delivery, and buying it would mean either a realtime vendor or SSE connections held open on Vercel — new infrastructure and new per-connection cost for latency nobody will perceive.

## Approach: a change feed, polled

A single new endpoint answers one question — *has anything you are allowed to see changed?* — and returns no content. When the answer is yes, the client re-runs the **existing** loader for the affected entity.

This keeps access rules in exactly one place. The feed never serves comment bodies, names or ids; the routes that already exist keep serving the data under the access checks they already have.

### Approaches considered

**Polling the existing endpoints directly** was rejected on cost. It needs no new endpoint and no migration, but each tick fires four requests pulling full comment bodies, `attachments` JSONB, snapshot URLs and the whole roster — and `/api/versions` runs a second aggregate for per-version file and comment counts. Roughly thirty times the Neon traffic of a digest, per viewer, permanently.

**Push (SSE, or Pusher/Ably)** was rejected as unnecessary. Sub-second delivery, but Vercel bills held-open SSE connections as function time and the app would own reconnect, backoff and resume. The freshness target does not justify it.

Postgres `LISTEN/NOTIFY` is not available at all: `lib/db.ts` uses the Neon **HTTP** serverless driver, which has no persistent connection to listen on.

## Server: `GET /api/portals/[id]/activity`

Auth follows every sibling route — `auth()` → 401, `getPackageAccess(userId, portalId)` → null → 403.

One SQL statement for the digest, returning:

```json
{
  "participants": { "n": 4,  "at": "2026-09-17T09:12:03.221Z" },
  "versions":     { "n": 3,  "at": "2026-09-16T17:40:11.000Z" },
  "files":        { "n": 7,  "at": "2026-09-16T17:41:52.100Z" },
  "comments":     { "n": 22, "at": "2026-09-17T09:14:40.885Z" }
}
```

Response carries `Cache-Control: no-store`.

Cost per tick is the digest's single indexed aggregate plus whatever `getPackageAccess` already costs — one query, or two for a version-scoped guest. That is the same access cost every other portal route pays per call, and it is the floor for any design that checks permissions honestly.

### Why a pair, not a watermark

A `MAX(created_at)` watermark alone detects inserts and nothing else. Comments in Stiko are editable and hard-deletable:

- `PUT /api/comments/[id]` rewrites `content` and leaves `created_at` untouched
- `DELETE /api/comments/[id]` removes rows outright — there is no soft-delete column anywhere in the schema

Pairing a count with a stamp covers all three transitions:

| event | `n` | `at` |
|---|---|---|
| insert | increases | advances |
| delete | decreases | unchanged |
| edit | unchanged | advances (via `edited_at`) |

### Scoping: the part that must not be hand-rolled

`app/api/versions/route.ts` applies two filters that a naive portal-wide `COUNT(*)` would defeat. The feed applies the same two, pushed into SQL rather than JS:

1. **Drafts.** `published_at IS NOT NULL` unless `access.canUpload`. Without it, a reviewer's version counter bumps the moment an uploader starts a draft — disclosing work in progress that the versions route deliberately withholds.
2. **Version scope.** `v.id = ANY($scope)` when `access.versionScope !== 'all'`. Without it, a scoped reviewer learns the total number of versions in the package, which is precisely what `app/api/participants/route.ts` strips its scope fields to avoid.

`files` and `comments` are counted by joining **through** that filtered version set, so an out-of-scope or unpublished file cannot bump a counter either.

Existing indexes cover the aggregate: `comments_file_created_idx` on `comments(file_id, created_at)` and `files_version_idx` on `files(version_id)`.

## Migration 013: `comments.edited_at`

```sql
ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
```

`PUT /api/comments/[id]` sets `edited_at = NOW()` alongside `content`. The feed folds it in as `GREATEST(MAX(created_at), MAX(edited_at))`.

Postgres `GREATEST` skips NULL inputs and returns NULL only when every input is NULL — so a package where nothing has been edited yields the `created_at` maximum, not NULL. This is worth stating because several other SQL engines propagate NULL here instead, and the expression would silently blind the cursor if it behaved that way.

An empty table yields `n: 0` and `at: null`. `diffDigest` treats a null stamp as a legitimate value and compares it by equality, so an empty package does not read as perpetually changing.

Existing rows stay `NULL` and read as never-edited, which is true of them. No UI change — the column exists so the cursor can see an edit.

## Client

### `lib/portalActivity.ts` — pure, alias-free

No `@/` imports, so `node --test` loads it directly.

- `diffDigest(prev, next)` → `{ comments, participants, versions, files }` booleans
- `preserveIfUnchanged(prev, next)` → returns the **previous reference** when the payloads are structurally equal, the new one otherwise

### `components/portal/usePortalActivity.ts` — owns the timer, nothing else

- Polls every **6 seconds**, and **only while `document.visibilityState === 'visible'`**. A backgrounded tab costs nothing.
- On `visibilitychange → visible`, polls **immediately** rather than waiting out the interval, so returning to the tab is instant instead of up to six seconds stale.
- **Single in-flight guard.** A tick is skipped while the previous request is outstanding. On a slow connection this degrades to "as fast as the network allows" instead of piling requests up.
- **Backoff on transient failure:** 6s → 12s → 24s → 48s, capped at 60s, reset to 6s on the first success.
- **401/403 is terminal.** Access revoked mid-session stops the poll permanently — no backoff, no retry. Without the split, a revoked guest's open tab hammers the endpoint indefinitely.
- **The first response seeds the baseline silently.** It fires no callbacks. Otherwise the first poll diffs against nothing and re-fetches all four entities seconds after mount had already loaded them.
- `AbortController` on unmount.

### Wiring into `app/portal/[id]/page.tsx`

| digest changed | action |
|---|---|
| `comments` | `setCommentsRefreshKey(k => k + 1)` — one bump already drives both the page's pin fetch and `CommentsPanel`'s own fetch |
| `participants` | `fetchParticipants()` — extracted from its inline effect into a `useCallback`, matching the shape of `loadVersions` |
| `versions` | `loadVersions()` — already preserves the selected version |
| `files` | `fetchFiles(selectedVersionId)` — already preserves the selected file |

Composer text, markup, measurement and camera state live in separate state and are never written by these loaders.

## Four traps that would otherwise make this feel broken

These are the difference between "it updates" and "it updates without anyone noticing it updated".

1. **Sidebar spinner flash.** `fetchFiles` sets `setFilesLoading(true)`. A poll-driven refetch would flash the sidebar spinner whenever anyone uploads. It takes a `background` flag that skips the spinner.

2. **Comment panel loading flash.** `CommentsPanel.fetchComments` sets `setLoading(true)` for the same reason and needs the same flag.

3. **Pin re-render churn.** The comments digest is portal-wide, so a comment posted on *file B* re-fetches *file A*'s comments and gets byte-identical data. `setComments(newArray)` would still hand every pin and the 3D overlay a fresh array identity and re-render them. `preserveIfUnchanged` keeps the old reference when the payload matches.

   A portal-wide comment cursor is the deliberate choice here: per-file cursors would avoid the false positive but multiply the feed's cost and complexity, and the guard makes the false positive free.

4. **Scroll yank.** `CommentsPanel`'s scroll-to-active effect depends on `comments`, not only `activeCommentId`. When a new comment arrives the effect re-runs and `scrollIntoView`s back to the active pin, pulling the panel out from under someone who has scrolled elsewhere. Trap 3's guard covers the identical-payload case, but a genuinely new comment still triggers it. The effect tracks the last id it scrolled to in a ref and scrolls only when that id changes, not merely when the array does.

## Arrival presentation

New comments appear **silently** — no highlight, no "N new" pill, no badge. The complaint being fixed is having to refresh; solving exactly that and nothing more avoids introducing new state to track and new affordances to dismiss.

## Testing

`scripts/tests/portalActivity.test.mjs`, under the existing `node --test scripts/tests/*.mjs` setup:

- `diffDigest` flags the right entity for an insert, an edit and a delete, and flags nothing when the digest is identical
- The seed-first-response rule fires no callbacks on the first poll
- `preserveIfUnchanged` returns the identical reference for structurally-equal payloads and a new one otherwise

Access scoping is covered in the style of `scripts/tests/access.test.mjs`: drafts excluded for non-uploaders, out-of-scope versions excluded for scoped reviewers.

## Rollout

Production is the only environment, so ordering matters.

1. Apply migration 013 and confirm it in `schema_migrations` — the feed's `GREATEST(…, MAX(edited_at))` references the column and the route 500s without it.
2. Deploy the app.

Rollback is a revert of the application code. The column is additive and harmless if left in place.
