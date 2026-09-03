# Content deletion — files and versions

**Date:** 2026-09-03
**Status:** Approved, not yet implemented
**Scope:** Spec 1 of 3. Covers deleting individual files and whole versions.

Two companion specs follow and are explicitly *not* covered here:

- **Spec 2 — download authorization.** Owner downloads anything; everyone else
  is gated by a flag set at invite time.
- **Spec 3 — per-version invite scoping.** A commenter is invited to a version
  or a set of versions rather than the whole package.

They are sequenced after this one because both extend the capability model this
spec settles, and spec 3 changes the shape of `participants` itself.

## Problem

Nothing in Stiko can be deleted below the package level. `DELETE` handlers exist
for packages and projects only; there is no route for a file or a version, so
the sole way to remove one bad file is to destroy the package containing it.

Two people need this, for different reasons:

- A **project owner or coordinator** curating what reviewers see, including
  removing published content that should not have gone out.
- An **uploader** who has just uploaded the wrong file and wants it gone before
  anyone looks at it.

## Decisions

| Question | Decision |
|---|---|
| Uploader's delete window | Their own files, until the version is published |
| Published content with comments | Hard delete, with an inventory confirm |
| Coordinators | Same rights as owner |
| R2 objects | Deleted, DB row first, best-effort |
| Version numbers | Never renumbered; gaps are permanent |
| Rule location | Pure predicate in `capabilities.ts`, resolvers in `access.ts` |

### Why the uploader window closes at publish

Deleting a file cascades to every comment and markup on it
(`schema.sql:123`, `schema.sql:151`). An unbounded uploader window would let one
person destroy another's review work by removing the file it hung from. Publish
is already the moment content becomes visible to reviewers
(`app/api/versions/publish/route.ts`), so it is the honest boundary: before it,
nobody has seen the file and deletion harms no one; after it, removal is the
owner's call.

### Why hard delete rather than soft

Package deletion is already a hard delete fronted by a confirm that counts what
dies (`app/portal/[id]/settings/page.tsx`). Matching it keeps one mental model.
A `deleted_at` column would mean every version, file and comment read path needs
a `deleted_at IS NULL` filter, and missing one anywhere makes deleted content
reappear — a worse failure than the loss it prevents.

The safety comes from the confirm, not from recoverability. Deletion of
published content must state its cost before it happens.

## Data model

New migration `lib/migrations/005-file-deletion.sql`:

```sql
ALTER TABLE files
  ADD COLUMN IF NOT EXISTS uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL;

UPDATE files SET uploaded_by = (
  SELECT v.created_by FROM versions v WHERE v.id = files.version_id
) WHERE uploaded_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_files_uploaded_by ON files(uploaded_by);
```

`ON DELETE SET NULL`, not `CASCADE`, matching `versions.created_by` — removing a
user account must never destroy the files they uploaded.

**Backfill is an assumption:** existing rows are credited to the creator of
their version. That is a guess, but the only one available, and its blast radius
is small — the uploader window closes at publish, so it can only affect files
sitting in currently-open drafts.

`files.uploaded_by` is set on insert going forward, in the upload completion
path (`app/api/files/complete/route.ts`).

**Deployment note:** migrations here are applied manually and have been
forgotten before. This migration must run *before* the code that reads
`uploaded_by` is deployed, or every uploader delete check reads NULL and
silently denies.

## Authorization

### Pure predicate — `lib/capabilities.ts`

```ts
export interface DeleteContext {
  role: EffectiveRole;
  /** The caller uploaded this file. Always false for a version. */
  isOwnUpload: boolean;
  /** The version is published (for a file, the version containing it). */
  isPublished: boolean;
}

export function canDeleteContent(ctx: DeleteContext): boolean
```

| Role | Own draft file | Own published file | Anyone's file | Version |
|---|---|---|---|---|
| owner | yes | yes | yes | yes |
| coordinator | yes | yes | yes | yes |
| uploader | yes | no | no | no |
| commenter | no | no | no | no |
| viewer | no | no | no | no |

Unrecognised roles return `false`, using the same fail-closed default the file
already applies in `capabilitiesFor`. This lives in `capabilities.ts` and not
`access.ts` for the reason that file already states: it imports no database
client, so the security-relevant rules can be asserted by a test directly.

A version is never "own upload" — a version can hold files from several
uploaders, so letting one of them delete the container would let them delete
the others' work. Only owner and coordinator delete versions.

### Resolvers — `lib/access.ts`

```ts
export interface DeleteDecision {
  allowed: boolean;
  portalId: string;
  /** R2 keys to clean up after the row is gone. */
  storageKeys: string[];
}

export async function getFileDeleteDecision(userId, fileId): Promise<DeleteDecision | null>
export async function getVersionDeleteDecision(userId, versionId): Promise<DeleteDecision | null>
```

`null` means no such file/version, or the caller has no access to the package —
the two are deliberately indistinguishable, so an id probe cannot confirm
existence.

Each resolver does one query for role, ownership and publish state, then calls
`canDeleteContent`. It returns the storage keys alongside the verdict so the
route does not re-query for cleanup after the rows are gone.

## API

### `DELETE /api/files/[id]`

Added to the existing route file. Resolves the decision, deletes the row, then
cleans up R2.

### `DELETE /api/versions/[id]`

New `route.ts` in the existing `app/api/versions/[id]/` directory, which today
holds only `changelog-draft/` and `summary/`. Collects `storage_key` and
`converted_storage_key` for every file in the version before deleting, since
the rows are gone afterwards.

### Also: authorize the existing GET on `files/[id]`

`app/api/files/[id]/route.ts` currently has a GET with **no session check and no
access check** — it returns any file's metadata, including its storage keys, to
anyone signed in, given only an id. It is the one read path in the app that does
not go through `getPackageAccess`.

It is fixed here rather than deferred, because this spec adds a DELETE beside it
and leaving a known hole in a file being edited is not defensible. The fix is
the standard four lines already used by every neighbouring route: session check,
then `getFileAccess`, then 404 on null.

### Response contract

| Status | Meaning |
|---|---|
| 200 | Deleted. Body `{ success: true }`. |
| 401 | Not signed in. |
| 403 | Signed in, has package access, but not allowed to delete this. |
| 404 | No such id, or no access to its package. Indistinguishable by design. |

An R2 cleanup failure still returns 200 — the row is gone and the user's intent
is satisfied. The orphan is logged, not surfaced.

## R2 cleanup

New helper in `lib/s3.ts`:

```ts
export async function deleteObjects(keys: (string | null)[]): Promise<void>
```

Wraps the existing `deleteObject`, skips nulls, and is best-effort: it catches
per-key failures, logs them, and never throws into a request path.

**Ordering is deliberate — database row first, then storage.** If R2 fails
afterwards, the result is an orphaned object: invisible, costs a little money,
harmless. The reverse order risks a file gone from storage but still listed in
the UI, which reads to the user as corruption.

This also fixes an existing leak. `deleteObject` has been exported from
`lib/s3.ts` since it was written and is called from nowhere, so every package
deletion to date has stranded its files in R2 permanently. Package and project
deletion adopt `deleteObjects` as part of this work.

Objects already orphaned by past deletions are **out of scope**. They are
unreferenced, so a cleanup sweep would have to reason from bucket contents
rather than the database; that is its own task.

## Version numbering

Numbers are never reassigned. Deleting V2 of V1/V2/V3 leaves V1 and V3 with a
permanent gap, and the next version is still `MAX(version_number) + 1`, so V4
follows. The gap is correct and must not be closed: version numbers appear in
comments, notifications, verdicts and already-sent emails, and renumbering would
silently repoint every one of those references at different content.

Two consequences, both intended:

- Deleting the last file from a draft is allowed. Publish already refuses an
  empty version, so no new guard is needed.
- Deleting a package's only version is allowed. The package survives empty — it
  is the permission boundary, so it should outlive its contents.

## UI

### Server tells the client what is deletable

`GET /api/files?versionId=` gains `canDelete` per file, and
`GET /api/versions?portalId=` gains `canDelete` per version. Both routes
already resolve `getPackageAccess`, so the role is in hand; the file case
additionally compares `uploaded_by` against the session user.

The client never re-derives the rule from role and publish state. A hidden
button and a 403 must not be able to disagree, and the only way to guarantee
that is a single source of truth.

`GET /api/versions` also gains `fileCount` and `commentCount` per version, so
the confirm dialog can state what will be destroyed without a second round
trip.

### Affordances

- `components/portal/FileList.tsx` — per-file delete, rendered only when
  `canDelete`.
- The version rail in `app/portal/[id]/page.tsx` — per-version delete, same
  gating.

### Confirms scale to the stakes

Two different confirms, deliberately.

- **Owner or coordinator deleting published content** — the existing
  `components/settings/DestructiveConfirm.tsx`, with an inventory of the files,
  comments and markups that die with it. Matches package deletion.
- **Uploader deleting their own draft file** — a plain `components/ui/Modal.tsx`
  confirm. Nothing is published, nobody has commented, and the point is a fast
  fix for a wrong upload.

`DestructiveConfirm` is **not** reused for the second case and **not** modified
to make its typed name optional. Its header states its three rules — count what
dies, require typing the name, offer the reversible alternative — as applying to
every destructive confirm, and making the name optional would turn that rule
into a default that each call site can quietly opt out of. Keeping the component
strict means the strictness is guaranteed wherever it appears.

The two cases genuinely differ: deleting a published file destroys other
people's work, while deleting an unpublished one you uploaded a minute ago
destroys only your own mistake. Requiring a filename to be typed for the second
would train users to type past the first.

Deletion is not offered as reversible anywhere, because it is not. Unlike
package deletion, there is no archive alternative to point at.

## Testing

`canDeleteContent` is pure, so it is asserted in the existing
`scripts/tests/access.test.mjs` with no database:

- Full matrix: five roles across own/not-own upload and draft/published.
- Uploader on own published file — denied. This is the rule most likely to be
  loosened by accident.
- Uploader on someone else's draft file in the same version — denied.
- An unrecognised role string — denied, confirming fail-closed.

Not covered by unit tests, and verified by hand against a real database before
deploy:

- The migration backfill populates `uploaded_by` for existing rows.
- Deleting a version removes its files, comments, markups and verdicts by
  cascade.
- R2 objects for both original and converted keys actually disappear.

## Risks

| Risk | Mitigation |
|---|---|
| Migration not run before deploy — every uploader check reads NULL and denies | Deploy migration first; confirm `schema_migrations` before shipping code |
| Owner deletes published version, destroying reviewer comments | Typed-name confirm with explicit comment and markup counts |
| Backfill misattributes a file to the version creator | Bounded — only affects open drafts; owner can delete regardless |
| R2 delete succeeds, DB delete fails | Impossible in this order; DB is deleted first |
| Cascade reaches further than the confirm claims | Confirm counts are queried, not estimated |

## Out of scope

- Undo, trash, or restore. Deletion is permanent.
- Sweeping R2 objects orphaned by past package deletions.
- Bulk delete of multiple files at once.
- Deleting comments or markups directly — that already exists.
- Download authorization and per-version scoping — specs 2 and 3.
