# Dashboard redesign (owner home) — design

**Date:** 2026-09-11
**Source:** `design_handoff_dashboard_redesign/` (README.md + `Stiko Dashboard.dc.html` frame `1b`)
**Status:** approved, not yet implemented

## Problem

`app/page.tsx` is the owner/member dashboard. It renders a "Needs you" inbox followed by flat
package rows grouped under plain project headings. Four concrete faults:

1. A project with one package is indistinguishable from the package itself.
2. Nothing on the dashboard says which projects you own and which you were invited to.
3. You cannot create a project without going through "New package".
4. The screen wastes horizontal and vertical space.

## Solution

Replace the flat list with a **grid of project cards** — each card owning its packages — plus a
**global activity rail** on the right that absorbs the standalone "Needs you" block.

The design is fixed by the handoff and is not relitigated here. This spec records the decisions
the handoff left open and the shape of the implementation.

## Decisions taken during design

| Question | Decision |
|---|---|
| The guest-only home (`3m`, "Your reviews"), which the handoff never mentions | **Retired.** Invited users get the same grid, every card chipped `Invited · {Role}`. |
| The one-package floor (`5a`, flat 720px column) | **Retired.** One package renders as one card. |
| First-run (`3e`) | **Unchanged.** |
| People panel editability | **Read-only.** Derived highest role per person; no project-level role write. |
| Activity rail data source | **`notifications` table**, under the drawn "Activity" title. A true cross-project feed is a later upgrade behind the same UI. |
| "New project" | **Name-only modal**, landing on the new empty card. |
| Delivery | One feature branch, staged commits, merged once the whole screen is browser-verified. |

End state: `app/page.tsx` has **two** branches — first-run empty, and the grid.

### Why read-only people

Roles in Stiko are per-package (`participants.portal_id`). A project-level role is derived, not
stored. Making the panel editable would mean either a schema migration or a project-level write
that silently fans out across per-package grants — hard to reason about and hard to undo. The
panel therefore shows the derived summary and routes every actual change to the existing
per-package surfaces (`AddPeopleModal`, `TeamMatrix`).

### Why the rail keeps the "Activity" title

Notification rows exist only for things addressed to the viewer; muted packages and
unsubscribed events produce none. "Activity" therefore overstates the contents. Accepted
knowingly: the UI is the drawn one, the read/mark-all contract is the existing correct one, and
the feed can be widened later without touching the component.

## Architecture

### Chosen approach: additive parallel array

`/api/home` keeps `packages: PackageCard[]` byte-identical and **gains** `projects:
ProjectSummary[]`. The client groups packages by `projectId` and looks up project metadata.

Rejected alternatives:

- **Nested payload** (`projects[].packages[]`) — `PackageCard[]` flat is consumed by
  `CommandPalette` and mirrored on the project page; nesting means changing those consumers or
  shipping the same rows twice.
- **Pure client derivation** — free, but `ownedByMe` and the owner's name are not in the
  payload, which is exactly why ownership is invisible today. Does not fix issue #2.

The decisive property of the chosen approach: **every roll-up derives from the already
permission-scoped `packages` array.** Package counts, open-comment totals, the people union and
the stat tiles cannot include a package the viewer may not see, because there is no second
query that could get the scoping wrong.

### Data layer

**No migration. No schema change.**

`lib/queries.ts` → `getHomeData`, three additive edits:

1. The `visible` CTE already does `JOIN projects pr` and
   `LEFT JOIN project_members pm ON … AND pm.user_id = ${userId}`. Add `pr.owner_id` and
   `pm.role AS member_role` to its select list; add `LEFT JOIN users owner ON owner.id =
   visible.owner_id` to the outer query. Ownership and owner name cost no extra round trip.
2. `peopleRows` gains one column: `p.role`.
3. Build a deduped `projects` array in TS from rows already fetched.

```ts
export interface ProjectSummary {
  id: string;
  name: string;
  ownedByMe: boolean;      // projects.owner_id = userId
  createdByName: string;   // rendered as "you" client-side when ownedByMe
  myRole: string | null;   // 'owner' → member_role → highest participant role
}
```

`PackageCard.people[]`: `{id, name, pending?}` → `{id, name, role, pending?}`. Additive, so
`AvatarStack` and the project page are unaffected.

`/api/home` returns `{ packages, projects, disclosure, isGuestOnly }`.

`projects` is NOT derived from `packages` alone. The `visible` CTE selects `FROM portals`, so a
project with no visible package produces no row; a second query returns projects the viewer owns
or coordinates, and the two are merged. Without it "New project" would create a project and show
nothing — the empty card is the whole point of that flow. That second query is scoped
owner-or-member, matching `GET /api/projects`: a guest is a participant on *packages*, so a
project with no package they can see is not theirs to know about.

`/api/notifications` GET gains `pr.id AS "projectId", pr.name AS "projectName"` via one
`LEFT JOIN projects pr ON pr.id = po.project_id`. `NotificationRow` grows two optional fields;
`NotificationTray` is untouched. `LIMIT 50` stays — the rail is a feed, not an archive.

`lib/disclosure.ts`: **delete `groupByProject`.** `app/page.tsx:85` is its only consumer and
that branch is being removed. Every other predicate is unchanged.

**Known and accepted:** because project people are the union of participants on *visible
packages*, a project owner who is not a participant on any package does not appear in the
people list — only in the card byline. This is the handoff's scoping rule applied honestly.

**Not queried, deliberately:** project members beyond participants, and any package outside
`visible`.

### Component structure

New pure module `lib/home.ts` — no React, unit-tested first:

| Export | Purpose |
|---|---|
| `groupByProject(packages, projects)` | The grid's spine |
| `projectRollup(pkgs)` | package count + open comments |
| `projectPeople(pkgs)` | union across visible packages, highest role, "on N packages" |
| `ROLE_RANK` | `owner > coordinator > uploader > commenter > viewer` |
| `groupActivity(notifications)` | Today / Yesterday / Earlier this week / Earlier |
| `activityAccent(type)` | 7 notification types → badge + left-border colour |

`ROLE_RANK` spans two tables: `participants.role` is `viewer|commenter|uploader`,
`project_members.role` is `owner|coordinator` (`lib/migrations/001-redesign.sql:54`).

New components under `components/home/`:

- `ProjectCard.tsx` — frame, header (name, ownership chip, byline, avatar-stack button), body
- `CardPackageRow.tsx` — the inset package row
- `ActivityRail.tsx` — header, three stat tiles, recency-grouped feed
- `ProjectPeopleDrawer.tsx` — read-only people summary
- `NewProjectModal.tsx` — single name field
- `HomeStates.tsx` — `HomeSkeleton` (reshaped to cards + rail) and `HomeError` (moved verbatim)

Deleted: `components/home/PackageRow.tsx` (`app/page.tsx` is its only consumer; the project page
has its own `ProjectPackageRow`) and `NeedsYouRow`, absorbed by the rail.

Reused unchanged: `Shell`/`TopBar`, `Button`, `Drawer`, `Modal`, `AvatarStack`, `Avatar`,
`StatusChip`, `SectionLabel`, `Note`, `AddPeopleModal`, `NotificationTray`, `CommandPalette`,
`STATUS_ACCENT`, `avatarSwatch`, `initials`, `relativeTime`.

Two primitive additions:

- `shadow-stiko-card` in `tailwind.config.ts`:
  `0 2px 6px -1px rgba(28,32,48,0.07), 0 1px 3px rgba(28,32,48,0.05)` — confirmed absent today.
- `RoleTag` beside `RolePill` in `Primitives.tsx`. `RolePill` is a fixed 30×24 single-letter
  tile for the matrix and its type excludes `owner`/`coordinator`; the drawer needs the full
  word at radius 6. Same colour source, different shape — a sibling, not a rewrite.

### Client state

New: `filter: 'all' | 'owned' | 'shared'`, `peoplePanelProjectId: string | null`,
`newProjectOpen: boolean`. Existing `packages`, `projects`, `disclosure`, `isGuestOnly`,
`notifications`, `loading`, `error` are unchanged. Everything else on the screen is derived.

### Derived values

Nothing below is stored or refetched; all of it comes from `packages` + `projects` +
`notifications` already in client state.

| Value | Derivation |
|---|---|
| Ownership chip | `ownedByMe` → solid `Owner`. Otherwise outlined `Invited · {Role}`, where Role is `myRole` title-cased; when `myRole` is null the chip reads `Invited` with no suffix. |
| Card byline | `"Created by you · N people"` when `ownedByMe`, else `"Created by {createdByName} · N people"`. N is the people union size. |
| Card meta row | `"N packages"` / `"1 package"`; `"N open comments"` or `"Nothing open"` summed over that project's visible packages. |
| Header subline | `"{projects} projects · {packages} packages · {k} need you"`; the "need you" clause is omitted when k is 0. |
| Rail: "need you" | Count of visible packages where `mentions > 0 \|\| (versionNumber != null && !seenLatest)` — the same predicate `needsYouCount` already uses in `getHomeData`, so the tile and the disclosure signal cannot disagree. |
| Rail: "open comments" | Sum of `openComments` across visible packages. |
| Rail: "in review" | Count of visible packages whose derived `status` is `in_review`. |

## Behaviour

| Trigger | Behavior |
|---|---|
| Filter All / Owned by me / Shared with me | Client-side over the grouped array. No refetch. |
| "New project" | `NewProjectModal` → `POST /api/projects` → refetch → new empty card |
| "Add a package" | `/new?project={id}` — already supported (`app/new/page.tsx:37`) |
| Project name | → `/project/{id}` |
| Package row | → `/portal/{id}` |
| Avatar stack | Opens `ProjectPeopleDrawer` for that project |
| Activity row | `PATCH /api/notifications {id}`, then navigate to `href` |
| "Mark all read" | `PATCH {all:true}` → refetch; rendered only when something is unread |

Transitions: 150ms on colour/background/border for hover states. Nothing animates on mount.

Filter row renders only when at least one owned AND at least one invited project exist — the
only case in which all three buttons match something. With only owned projects "Shared with
me" is always empty; with only invited ones "Owned by me" is. For a pure guest, therefore,
never. (This supersedes the handoff's "≥2 projects, or ≥1 owned and ≥1 invited", whose first
clause subsumes the second and shows a dead button in both single-ownership cases.)

Guest handling: the drawer's "Add people" and "Access matrix" footer renders only when
`ownedByMe || myRole === 'coordinator'`. `/api/projects/[id]/overview` is member-gated, so the
matrix link would 403 for a guest regardless.

Rail gating: renders when `notifications.length > 0`, **not** on the unread count — a rail that
vanishes once you have read everything would be worse than one that was never there.

## States

- **Loading** — skeleton in the shape of the answer, never a spinner: the 52px bar, then 2–4
  card-shaped blocks (header bar + two inset rows each), then a rail block with three tiles.
- **Error** — `HomeError` unchanged. An error must never render as a loading state.
- **First run** (zero packages) — existing `EmptyState` exactly as-is.
- **Empty project** (zero packages in a real project) — a real card reading "0 packages" with
  only the dashed add row. That card is the prompt.

## Responsive

`flex-wrap` + `flex: 1 1 420px` gives 2 columns at ≥1280px, 1 below. Under ~1100px the rail
moves beneath the grid at full width with a capped feed height.

## Design tokens

Every value is already in `tailwind.config.ts` under the `stiko` / `note` scales, plus the one
new `shadow-stiko-card`. Use the token, never the raw hex from the handoff prototype — the
prototype inlines hexes only because it has no Tailwind build.

## Verification

`main` deploys straight to production and there is no staging environment, so before any merge:

1. `npm run dev` — Next loads `.env.local` itself; do not source it from the shell.
2. Browser-drive all four paths against real data: multi-project owner, guest-only account, one
   package, zero packages. The guest path is new behaviour and gets a real login, not a
   reasoned argument.
3. Both widths: 1440 and ~1000.
4. Full `npm run build` with the six env vars before merging. A bare build failing at "Collect
   page data" is missing config, not a code defect.

Unit tests cover `lib/home.ts` — role ranking across the two role vocabularies, recency
bucketing, the people union, and the roll-ups.

Report what was actually observed. If a path cannot be exercised locally, say so rather than
imply it passed.

## Out of scope

- A true cross-project activity feed (`/api/activity`) — later, behind the same rail.
- Inline role editing in the people drawer.
- Plan-limit enforcement on project creation. `lib/plans.ts` states limits are displayed, not
  applied; a prominent "New project" button does not change that decision.
- Any change to the project page, portal, or the package flow beyond the existing
  `/new?project={id}` entry point.
