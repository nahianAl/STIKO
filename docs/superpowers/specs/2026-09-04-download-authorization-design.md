# Download authorization

**Date:** 2026-09-04
**Status:** Approved, not yet implemented
**Scope:** Spec 2 of 3.

Spec 1 (`2026-09-03-content-deletion-design.md`) shipped and is merged. Spec 3 —
per-version invite scoping for commenters — follows this one, and is sequenced
after because it reshapes `participants`, which this spec adds a column to.

## Problem

There is no download feature anywhere in Stiko. `/api/files/url` exists, but it
is the **viewer's** render path — `components/viewers/ViewerContainer.tsx` is
its only caller. Nothing offers a reviewer a copy of a file.

Three people need different things:

- An **owner or coordinator** should be able to download any file in any
  version.
- An **uploader** should always be able to download what they themselves
  uploaded, and other people's files only if the owner allowed it.
- A **commenter or viewer** should be able to download only if the owner
  allowed it.

"Allowed it" is decided per person, when the invitation goes out, and can be
changed later.

## What this can and cannot enforce

**Read this before promising anything to a client.**

Viewing a file already hands the browser a working link to it.
`ViewerContainer` fetches a presigned R2 URL unconditionally — the `isViewable`
check happens *after* the fetch and only decides what renders — and it requests
`convertedStorageKey ?? storageKey`. Only 9 of 99 files in production have a
converted variant, and upload-time STEP tessellation is switched off, so for
essentially every file the presigned URL points at **the original**.

Anyone who can open a file can therefore save it from the browser's network
tab, whatever this feature says. What is being built is a gate on the
affordance, not on the bytes:

| Enforced | Not enforced |
|---|---|
| No download control appears unless authorized | Reading the URL out of the network tab |
| The download endpoint refuses unauthorized callers | Saving a file you are currently viewing |
| Share links and public link-access never grant it | |

Making this a real wall means never handing out an R2 URL — the server would
fetch each file and stream it to the browser instead. That puts every view of a
50 MB STEP file through the app server, and is deliberately **out of scope**.

This is a deterrent and a clear statement of intent, which is what the request
actually needs. It is not a technical control against a determined viewer.

## Decisions

| Question | Decision |
|---|---|
| Gate strength | UI and endpoint only; documented as a deterrent |
| Set when | At invite time, per person |
| Changeable after | Yes, from the People settings panel |
| Share links | Never grant download |
| Public link access | Never grants download |
| Existing participants | Default to no download |
| Uploader's own files | Always downloadable, flag or not |
| Bulk / zip download | Out of scope |

Defaulting existing participants to false takes nothing away: there is no
download feature today, so nobody loses an ability they had.

## Data model

New migration `lib/migrations/007-download-authorization.sql`:

```sql
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS can_download BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE invite_tokens
  ADD COLUMN IF NOT EXISTS can_download BOOLEAN NOT NULL DEFAULT FALSE;
```

Both default false, so no backfill is needed and no existing row changes
meaning. Mirror both into `lib/schema.sql`, which documents its own convention
that migrations are folded back into it.

The flag lives on the invite token as well as the participant because the
invitation is where the owner decides, and acceptance may happen days later.

## Authorization

### Pure predicate — `lib/capabilities.ts`

```ts
export interface DownloadContext {
  role: EffectiveRole;
  /** The caller uploaded this file. */
  isOwnUpload: boolean;
  /** The owner granted this person download on this package. */
  mayDownload: boolean;
}

export function canDownloadFile(ctx: DownloadContext): boolean
```

| Role | Own upload | Someone else's file |
|---|---|---|
| owner | yes | yes |
| coordinator | yes | yes |
| uploader | yes, always | only with the flag |
| commenter | n/a — cannot upload | only with the flag |
| viewer | n/a — cannot upload | only with the flag |

Unrecognised roles return false, using the same `const unhandled: never`
fail-closed default `capabilitiesFor` and `canDeleteContent` already use.

An uploader's own file is exempt from the flag because they supplied it. Asking
the owner's permission to retrieve your own upload is a rule nobody would
expect, and the file is already on the uploader's machine.

### Where `mayDownload` comes from — `lib/access.ts`

`Access` gains `mayDownload: boolean`. `getPackageAccess` sets it to `true` for
owners and coordinators, since they may download unconditionally, and otherwise
to the participant row's `can_download`.

A new resolver mirrors spec 1's shape:

```ts
export interface DownloadDecision {
  allowed: boolean;
  storageKey: string;
  filename: string;
}

export async function getFileDownloadDecision(
  userId: string,
  fileId: string
): Promise<DownloadDecision | null>
```

`null` means no such file **or** no access to its package — deliberately
indistinguishable, so an id cannot confirm existence. It returns the
**original** `storage_key`, never `converted_storage_key`: a download is the
file the uploader supplied, not the viewer's optimized copy.

## API

### `GET /api/files/[id]/download`

New route. Resolves the decision and returns `{ url }` — a presigned URL for
the original object, carrying
`Content-Disposition: attachment; filename="<original filename>"` so the
browser saves it rather than navigating to it. `lib/s3.ts`'s
`getDownloadPresignedUrl` gains an optional filename parameter to set that
header; existing callers are unaffected.

| Status | Meaning |
|---|---|
| 200 | `{ url }` |
| 401 | Not signed in |
| 403 | Can see the package, but not allowed to download this file |
| 404 | No such file, or no access to its package. Indistinguishable. |

### `GET /api/files?versionId=`

Gains `canDownload` per file, computed server-side from the same predicate.
The client never re-derives the rule — a hidden control and a 403 must not be
able to disagree, which is the invariant spec 1 established.

### `POST /api/participants`

Accepts an optional `canDownload` boolean and stores it on the invite token.

**A share link forces it to false**, regardless of the request body — the same
shape as the existing `shareLink` handling, which learned that inferring
permission from a missing or malformed field is how a client regression turns
into a standing grant.

### `POST /api/invite/[token]`

Acceptance copies `invite_tokens.can_download` onto the new participant row.

### `POST /api/participants/download`

New route, deliberately shaped like its sibling `/api/participants/role`:

```
{ userId: string, portalId: string, canDownload: boolean }
```

Gated on `canManagePeople`. This is what makes the permission changeable after
the invitation.

**`userId` may be a user id or an email address**, exactly as the role route
documents. That is not incidental — the People panel lists *pending invites*
alongside accepted participants, and a pending invite has no `participants` row
at all. So the handler branches the same way the role route does:

- an accepted guest → update `participants.can_download`
- a pending invite (an email) → update `invite_tokens.can_download`, so the
  grant is already correct whenever they accept

A `PATCH /api/participants/[id]` keyed on the participant row id was considered
and rejected: it cannot address a pending invite, which is half of what the
People panel shows.

## UI

Four surfaces. All of them read the server's answer; none re-derive it.

**`components/portal/ShareModal.tsx`** — a "Can download files" checkbox on the
email-invite path. It is **absent** from the share-link path rather than
present-and-disabled, because a disabled control invites the question "why
can't I?" where absence states that links simply do not carry this.

**`components/people/AddPeopleModal.tsx`** — the same checkbox per selected
package, beside the existing role dropdown. Role and download are both
per-package here, matching how that screen already works.

**The People settings panel** (`app/portal/[id]/settings/people/page.tsx`) — a
per-person toggle beside the role dropdown, calling the new route. It must work
for pending invites as well as accepted people, since the panel lists both.

**`components/portal/FileTreeSidebar.tsx`** — a download control on the file
row, rendered only when the server said `canDownload`, appearing on hover with
`focus:opacity-100` for keyboard reach, exactly as the delete control does.
Clicking it fetches the URL and navigates to it.

## Copy

The invite checkbox reads **"Can download files"**. The People panel toggle
reads **"Download"**. Neither claims more than the feature does — no wording
like "prevent downloading", which would overstate it given the limits above.

UI copy says "package"; code identifiers say `portal`.

## Testing

`canDownloadFile` is pure, so it is asserted in `scripts/tests/access.test.mjs`
with no database:

- The full matrix: five roles across own/not-own upload and flag on/off.
- An uploader downloads their own file with the flag **off** — the exemption
  most likely to be lost in a refactor.
- An uploader cannot download someone else's file with the flag off.
- A commenter and a viewer with the flag on can download; with it off cannot.
- An unrecognised role cannot download, confirming fail-closed.

Verified by hand against a real database and bucket before deploy, as spec 1
was:

- A share link's participant has `can_download = false` even when the request
  asked for true.
- The People-panel toggle actually changes what the file list reports.
- The downloaded object is the original, not the optimized variant.
- `Content-Disposition` makes the browser save rather than navigate.

## Risks

| Risk | Mitigation |
|---|---|
| Someone believes this prevents downloading | Stated in its own section here, and in `ARCHITECTURE.md` |
| A share link carries download rights | Forced false server-side, not merely omitted from the UI |
| The download serves the optimized variant | The resolver returns `storage_key` explicitly and never the variant |
| Migration not applied before deploy | Both columns are `DEFAULT FALSE`, so unread columns are harmless; but a missing column raises Postgres 42703, which 500s the routes that select it. Apply first, as with 005 and 006. |

## Out of scope

- Bulk or zip download of a whole version.
- Download counts, audit logging, or notifying the owner of a download.
- Any change to how the viewer fetches files, including byte-proxying.
- Watermarking or any other copy deterrent.
- Per-version scoping of any kind — that is spec 3.
