# Per-version invite scoping

**Date:** 2026-09-04
**Status:** Approved, not yet implemented
**Scope:** Spec 3 of 3, and the largest.

Spec 1 (content deletion) is merged and pushed. Spec 2 (download authorization)
is built and live-verified but deliberately **unmerged**; this spec builds on its
branch, because both add columns to `participants`.

## Problem

A package is currently all-or-nothing. Being on it means seeing every version it
has ever held, forever. That is right for an uploader — their work builds on what
came before — but wrong for a reviewer brought in to look at one thing.

A client asked to review V3 has no reason to see V1, its files, its changelog, or
the fact that two earlier rounds happened. Today they see all of it.

## Decisions

| Question | Decision |
|---|---|
| Which roles can be scoped | Commenter and viewer |
| Uploaders | Always the whole package — never scoped |
| Out-of-scope versions | Filtered out entirely; no row, no count, no metadata |
| Default for a new invite | All versions |
| Changeable after invite | Yes, from the People panel |
| Existing participants | All versions — today's behaviour, unchanged |
| New version published | Visible only to `all_versions` people |

Defaulting to all versions means an invitation sent without touching the new
control grants exactly what it grants today. The feature is opt-in narrowing,
not a silent change to what existing links and habits do.

## Data model

New migration `lib/migrations/008-version-scoped-invites.sql`:

```sql
-- TRUE means "every version, including ones published later" — today's
-- behaviour, so every existing participant is unaffected and no backfill is
-- needed. FALSE means the participant_versions rows are the whole of it.
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS all_versions BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE invite_tokens
  ADD COLUMN IF NOT EXISTS all_versions BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS participant_versions (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  UNIQUE(participant_id, version_id)
);

-- The scope has to survive on the invitation too: the owner chooses it when
-- inviting, and acceptance may be days later.
CREATE TABLE IF NOT EXISTS invite_token_versions (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES invite_tokens(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  UNIQUE(token_id, version_id)
);

CREATE INDEX IF NOT EXISTS idx_participant_versions_participant
  ON participant_versions(participant_id);
```

Both `version_id` foreign keys cascade, so deleting a version cleans up every
scope row naming it. That is deliberate: a scope entry for a version that no
longer exists is meaningless, and leaving one would make an "empty scope" and a
"scope of one deleted version" indistinguishable.

Mirror all of it into `lib/schema.sql`, which documents that convention.

## Access

### The scope on `Access`

`Access` gains:

```ts
  /** 'all' means every version, now and future. A list means exactly those. */
  versionScope: 'all' | string[];
```

`getPackageAccess` resolves it:

- owner, coordinator → `'all'`
- uploader → `'all'` — an uploader's work builds on what came before, so
  scoping them would break the thing they are there to do
- commenter, viewer → `'all'` when `all_versions`, else their
  `participant_versions` ids

### The predicate — `lib/capabilities.ts`

```ts
export function canSeeVersion(
  scope: 'all' | string[],
  versionId: string
): boolean
```

Trivial to implement and the reason it exists is not the logic but the location:
one place to read the rule, and one thing to assert without a database. It
returns `true` for `'all'`, otherwise membership. An empty array returns `false`
for everything, which is correct — someone whose only version was deleted can
see nothing.

### The keystone — `lib/access.ts`

```ts
export async function getVersionAccess(
  userId: string,
  versionId: string
): Promise<Access | null>
```

Resolves the version to its package, calls `getPackageAccess`, then returns
`null` unless `canSeeVersion` passes. **Every version-keyed route switches from
`getPackageAccess(portalId)` to this.**

And `getFileAccess` becomes version-aware — it already resolves a file to its
package through its version, so adding the scope check there covers the file
route, the transform route, the download route, `/api/files/url` and both
comment paths in a single change. That is the difference between a rule enforced
once and a rule reimplemented eleven times.

`null` means "no such version, no access to its package, or not in your scope",
all indistinguishable. A version you were not given must look exactly like a
version that does not exist — the same posture specs 1 and 2 established.

## Read paths that change

| Route | Change |
|---|---|
| `GET /api/versions?portalId=` | Filter the returned list by scope |
| `GET /api/files?versionId=` | `getVersionAccess` |
| `GET /api/verdicts?versionId=` | `getVersionAccess` |
| `POST /api/version-views` | `getVersionAccess` |
| `GET`/`POST /api/versions/[id]/summary` | `getVersionAccess` |
| `DELETE /api/versions/[id]` | `getVersionAccess` |
| `GET`/`DELETE /api/files/[id]` | via version-aware `getFileAccess` |
| `GET /api/files/[id]/download` | via version-aware `getFileAccess` |
| `POST /api/files/[id]/transform` | via version-aware `getFileAccess` |
| `GET /api/files/url` | resolve the key to its file, then scope |
| `GET`/`POST /api/comments` | via version-aware `getFileAccess` |
| `GET /api/invite/[token]` | Preview a version the invitation actually grants |
| `GET /api/home`, project overview | "Latest version" must respect scope |

`/api/versions/[id]/changelog-draft` and `POST /api/versions/publish` are
uploader-and-above only, and those roles are never scoped, so they are unchanged
beyond routing through the same helper for consistency.

## Notifications must respect scope

`POST /api/versions/publish` currently notifies **every participant on the
package** — an in-app notification and an email, both titled "Version N
published in <package>".

Left alone, a commenter scoped to V2 is told V4 exists and emailed about it.
That leaks precisely what the feature hides, and it leaks *further* than a UI
bug would, because it reaches people who never open the app.

The recipient query must exclude anyone who cannot see the new version. In
practice that means `all_versions = true`, since a version published seconds ago
cannot already be in anyone's explicit list.

The same applies to comment notifications: a scoped person must not be told
about activity on a version they cannot open.

## UI

**Both invite modals** (`components/portal/ShareModal.tsx`,
`components/people/AddPeopleModal.tsx`) — choosing commenter or viewer reveals a
version selector offering "All versions" or a specific set. It is **absent** for
uploader, not disabled, matching how the download checkbox is absent on the
share-link path: absence states the rule where a greyed-out control invites the
question.

A share link may carry a scope like any addressed invitation. Unlike the
download grant, scoping is a *narrowing*, so it is safe on a forwardable link —
the risk that motivated forcing download off does not apply.

**The People settings panel** — scope editing alongside the role dropdown and
download toggle, working for pending invitations as well as accepted people, the
same split `/api/participants/role` and `/api/participants/download` already
handle.

**The version rail** needs no change. It renders what the API returns, and the
API now returns less.

**The empty case needs its own state.** If the owner deletes the only version in
someone's scope, the cascade removes their scope rows and they become a
participant who can see nothing. The package page must say that plainly —
something like "Nothing in this package has been shared with you yet" — rather
than rendering an empty rail that reads as a loading failure or a broken app.

## What this does not hide

Version numbers are not renumbered per viewer. Someone scoped to V3 sees the
label "Version 3" and can infer that V1 and V2 existed. Renumbering per viewer
would be worse — it contradicts spec 1's rule that numbers are never reassigned,
which exists because numbers appear in sent emails and notifications.

So scoping hides the *content* of other versions — files, changelogs, comments,
dates, who reviewed them — but not the bare fact that the package has a history.
That is the honest boundary and it should be described that way rather than as
"they cannot tell there are other versions".

## Testing

`canSeeVersion` is pure, so `scripts/tests/access.test.mjs` covers it with no
database:

- `'all'` returns true for any id, including one not in any list.
- A populated list returns true for a member and false for a non-member.
- An empty list returns false for everything — the deleted-scope case.

Verified by hand against a real database and bucket before deploy:

- A scoped commenter's version list contains only their versions.
- `GET /api/files?versionId=` for an out-of-scope version returns 404, identical
  to a nonexistent id.
- Publishing a new version does not notify or email a scoped commenter, and does
  notify an `all_versions` one.
- Deleting a version removes the scope rows naming it.
- Editing scope in the People panel changes what the version list returns.
- An uploader is never scoped, whatever the invitation asked for.

## Risks

| Risk | Mitigation |
|---|---|
| A read path is missed and leaks an out-of-scope version | The rule lives in `getVersionAccess` and a version-aware `getFileAccess`; the route table above is the checklist |
| A scoped person is emailed about a version they cannot see | The publish recipient query is part of this spec, not an afterthought |
| Existing participants silently lose access | `all_versions` defaults TRUE; no backfill touches anyone |
| Migration not applied before deploy | Selecting a missing column raises 42703, which 500s `getPackageAccess` and therefore every authorized route. Apply first, as with 005, 006 and 007 |
| Scope rows outlive their version | Both `version_id` FKs cascade |

## Out of scope

- Scoping uploaders, coordinators or owners.
- Per-file scoping within a version.
- Any change to how version numbers are assigned or displayed.
- Retroactively narrowing existing participants.
- Notifying someone that their scope changed.
