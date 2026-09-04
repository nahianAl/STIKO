# Version Detail Drawer — Design

**Date:** 2026-09-04
**Status:** Approved for planning

## Problem

Deleting is rare — a user does it well under 1% of the time they look at a
version — yet the controls for it are attached to every file row and every
version row in the rail. They appear on hover, but they are attached to the
things people click constantly, so they intrude on the common path to serve the
rare one.

Separately, the AI Brief is rendered inside the per-file comment panel even
though it summarises the **whole version**. The same brief is repeated above
every file's comments, eating vertical space in the narrowest column on the
page and sitting in a place that misrepresents its scope.

## Solution

Move both into a version detail drawer, opened from a single icon on each
version card. The rail goes back to being a navigator: cards that select, file
rows that select, nothing else.

---

## 1. The version rail

`components/portal/FileTreeSidebar.tsx`

**Version cards.** The card keeps today's behaviour — clicking it selects the
version and expands its file list underneath. The right-hand chevron is
replaced by an **expand icon** (four corners pointing outward) which opens the
drawer. That is the only control on the row.

The chevron currently doubles as the expand indicator, rotating 90° when the
version is selected. That indicator is dropped. The card's darker selected tint
plus the indented file list appearing beneath it already say "this is open",
and re-adding a caret would put two icons back on the row.

**Structural consequence.** The card is a `<button>` today, so a nested
expand-icon button would be invalid HTML and the two click targets would fight.
The card becomes a `<div>` holding two sibling buttons — the same restructure
`FileItem` already carries, for the same reason. Note that this is *not* the
existing absolutely-positioned overlay pattern used by the current
delete-version button; that button is removed entirely.

**File rows.** `FileItem` loses `onDelete` and `onDownload`. With no sibling
controls left it collapses back to a single `<button>`, reverting the
div-plus-siblings workaround it needed.

**Props.** `onDeleteFile`, `onDeleteVersion` and `onDownloadFile` are removed
from `FileTreeSidebarProps`. One prop replaces them:

```ts
/** Opens the version detail drawer. Required, not optional: every role can
 *  open it, and the controls inside it gate themselves individually. */
onOpenVersionDetails: (version: Version) => void;
```

The expand icon is always visible, not hover-revealed, because it is now the
only route to a version's files, changelog and Brief.

---

## 2. The drawer

New component: `components/portal/VersionDetailDrawer.tsx`

Built on the existing `components/ui/Drawer.tsx` primitive at its default width
of 452px. The primitive already handles Escape, the scrim, focus and the
z-tier — a confirm `Modal` opened from inside it still stacks above, which the
delete flows depend on.

**Header.** Title `Version 3`. Subtitle varies on two axes — whether the
version is the current one, and whether it is published:

- Current and published: `Current · Published Sep 2, 2026 by Maya Chen`
- Published, not current: `Published Aug 28, 2026 by Maya Chen`
- Draft: `Draft · Created Sep 2, 2026 by Maya Chen`

"Current" means the highest `versionNumber` in the rail, the same definition
`FileTreeSidebar` already uses for its badge gradient. The page computes it and
passes it in; the drawer never recomputes it from a partial list.

`createdByName` may be null on legacy rows; the subtitle then omits the
`by …` clause rather than printing "by null".

**Body** scrolls as one column, in this order.

### 2.1 Files

Section label `Files · 3`. One card per file:

| Element | Source |
|---|---|
| Type chip | `getFileChip(filename, fileType)`, as the rail uses |
| Filename | `filename` |
| Meta line | `uploadedByName · createdAt · fileSize` |
| Folder line | `folderPath`, only when non-null |
| Comment count | `commentCount`, muted when zero |
| Download button | rendered only when `canDownload` |
| Delete button | rendered only when `canDelete` |

Files render as a **flat list** in the order the API returns them
(`folder_path ASC NULLS FIRST, created_at ASC`). The rail owns the folder tree;
rebuilding it here would duplicate `buildFolderTree` for no gain. The folder
path appears as a line on the card instead, so nothing is lost.

`uploadedByName` is null for two legitimate reasons — `files.uploaded_by` is
`ON DELETE SET NULL`, and rows predating migration 005 were backfilled from
`versions.created_by`, which can itself be null. The card then reads
*"Uploader unknown"* in italics. It must not guess.

Clicking a card selects that file and closes the drawer.

Empty: *"No files in this version."* While the version's files are still
loading (see §3), skeleton rows render instead — never the empty state.

### 2.2 What changed in this version

Section label, then `versions.changelog` in a tinted block. This is verbatim
what the uploader wrote when submitting; it is never generated or edited here.

- Empty or null changelog on a published version: *"No description was written
  for this version."*
- Draft: *"Not published yet."*

### 2.3 Brief

`components/portal/VersionBrief.tsx` moves here unchanged in substance, with
two edits:

1. **Default expanded.** It defaults to collapsed today because it competes for
   space in the comment panel. The drawer exists partly to show it, so
   collapsed-by-default would mean two clicks to reach the thing you opened the
   drawer for. The collapse toggle and `briefDigest` are kept — a long brief
   can still be folded to reach what is below it.
2. **Auto-generation is removed from the component** and moved to the portal
   page. See §4.

Its `onSelectComment` callback keeps working: it closes the drawer, selects the
cited comment's file, and activates the comment.

The existing visibility rule is unchanged — `shouldShowBrief` hides the section
entirely below `BRIEF_MIN_COMMENTS` (5). The manual *Summarise* button in the
no-brief state stays, so a brief can still be produced on demand when
auto-generation did not run or failed.

### 2.4 Delete this version

A single destructive button at the very end of the scrolling body, rendered
only when `version.canDelete`.

It is deliberately **not** in the drawer's footer slot. A pinned footer would
keep a destructive control permanently on screen, which is the problem this
whole change exists to remove.

It calls the page's existing `openVersionDelete`, which opens the existing
confirm modal with refreshed counts. No new confirm dialog is built.

---

## 3. Opening, closing and selection

**Opening the drawer also selects the version.** Clicking the expand icon on V2
while V3 is selected moves the whole page to V2 — rail, viewer and comment
panel — and then opens the drawer on V2. The drawer therefore always reads the
page's already-loaded `files` and needs no fetch of its own.

**Guard against re-selecting.** `handleSelectVersion` clears `files`, sets
`filesLoading`, and resets `selectedFileId`, the active tool and the active
comment. Calling it for the version that is *already* selected would throw away
the user's open file and viewer state just because they opened the drawer. The
open handler must call it only when the id differs:

```ts
const handleOpenVersionDetails = useCallback((version: Version) => {
  if (version.id !== selectedVersionId) handleSelectVersion(version.id);
  setDetailVersionId(version.id);
}, [selectedVersionId]);
```

**The drawer's version is derived, never copied.** The page holds
`detailVersionId: string | null` and resolves the object each render:

```ts
const detailVersion = versions.find((v) => v.id === detailVersionId) ?? null;
```

The drawer is open when `detailVersion` is non-null. Deleting the version makes
it vanish from `versions` on the next `loadVersions()`, which closes the drawer
with no extra bookkeeping. A version that disappears for any other reason —
a scope change, a refetch — closes it the same way.

**Deleting a file** from the drawer runs the existing `confirmDeleteFile`,
which refetches `files`. The drawer reads that state, so its list updates in
place and it stays open.

Escape and a scrim click close the drawer; both come from the `Drawer`
primitive.

---

## 4. Brief generation moves to the page

Today the auto-generate lives in `VersionBrief`: the component mounts in the
comment panel whenever a version is selected, and POSTs once if the version has
at least `BRIEF_MIN_COMMENTS` comments and no brief yet.

If that logic moves into the drawer, generation only fires when someone opens
the drawer. The version card's headline — read by the page from
`GET /api/versions/[id]/summary`, which never generates — would then stay empty
until someone had already opened the drawer. The hint meant to make the Brief
discoverable could only appear after the Brief had been found. The loop never
starts.

So the **trigger stays on version selection** and only the **display** moves.
The portal page gains one effect keyed on `selectedVersionId` that reproduces
today's cadence exactly — one attempt per selected version, identical model
spend:

```ts
// One auto-generate per selected version, matching what VersionBrief used to do
// when it lived in the comment panel. The ref is set BEFORE the first await:
// React re-invokes effects in development, and a guard set after an await lets
// both invocations through to a paid endpoint.
useEffect(() => {
  if (!selectedVersionId) return;
  if (autoBriefAttempted.current === selectedVersionId) return;
  autoBriefAttempted.current = selectedVersionId;
  // GET to check eligibility, POST only if there is no brief and enough comments.
}, [selectedVersionId]);
```

Setting the guard synchronously means a failed network check does not retry for
that version in that session. That is the safer failure: the drawer's
*Summarise* and *Refresh* buttons both remain, so a brief is never unreachable.

On success the effect writes the new headline into `headlines`, so the card
hint appears without a full refetch.

**`VersionBrief` keeps** its stale-response guards (`currentVersion`,
`loadedFor`), its manual `generate()`, and its four render states. Only the
auto-generate effect and the `autoAttempted` ref are removed.

---

## 5. Comment panel

`components/portal/CommentsPanel.tsx` drops the `<VersionBrief>` block and its
`versionId` guard around it. Nothing else in the panel changes. The
`onSelectCitedComment` prop moves from the panel to the drawer. The page's
`handleSelectCitedComment` keeps its existing body and gains one line closing
the drawer, so a citation click does not leave the panel covering the file it
just navigated to.

---

## 6. API and types

**One route changes.** `app/api/files/route.ts` returns `uploadedBy` as a bare
user id. The drawer needs a name, so the query gains:

```sql
LEFT JOIN users u ON u.id = f.uploaded_by
```

selecting `u.name AS "uploadedByName"`. `LEFT JOIN` because a null
`uploaded_by` must still return the file. No access logic changes — the route's
`getVersionAccess` gate, its `canDelete`/`canDownload` computation and its
comment counts are untouched.

Everything else the drawer needs is already served: `changelog` and
`createdByName` from `/api/versions`, and `commentCount`, `fileSize`,
`canDelete`, `canDownload` from `/api/files`.

**Types.** `lib/types.ts` already exports `Version` and `FileRecord`, but
`FileTreeSidebar.tsx` redeclares both locally and `page.tsx` redeclares
`Version` — with a comment documenting the friction that causes. Since all
three files are being edited anyway:

- `FileRecord` gains `uploadedByName: string | null`.
- `Version` gains the fields the API already returns and the drawer needs:
  `publishedAt: string | null`, `changelog: string | null`,
  `createdByName: string | null`, `canDelete?: boolean`, `fileCount?: number`,
  `commentCount?: number`.
- The local duplicates in `FileTreeSidebar.tsx` and `page.tsx` are deleted in
  favour of importing from `lib/types`.

This is confined to the files this change already touches. No other consumer of
these types is modified.

---

## 7. Permissions

Nothing about authorization changes. Every gate is server-decided and already
in place:

| Control | Gate |
|---|---|
| Open the drawer | none — any role with access to the version |
| Download a file | `file.canDownload` from `/api/files` |
| Delete a file | `file.canDelete` from `/api/files` |
| Delete the version | `version.canDelete` from `/api/versions` |

A commenter or viewer sees the same drawer with no red controls and no download
buttons: file list, changelog and Brief, all read-only. A scoped reviewer can
only open the drawer for versions already in their scope, because the rail only
lists those.

The client never re-derives a permission. A hidden control and a 403 must not
be able to disagree — the same rule the deletion and download work established.

---

## 8. Pure helpers and testing

The repo's unit tests (`node --test scripts/tests/*.mjs`) cover pure modules,
not React components. To keep that pattern, the drawer's formatting logic is
extracted:

`lib/versionDetail.ts` — imports nothing, so it loads without a database:

```ts
export function uploaderLabel(name: string | null): string;

export function versionSubtitle(input: {
  versionNumber: number;
  isCurrent: boolean;
  publishedAt: string | null;
  createdAt: string;
  createdByName: string | null;
}): string;

/** null when a changelog exists and the section renders it verbatim. */
export function changelogFallback(input: {
  changelog: string | null;
  publishedAt: string | null;
}): string | null;

export function fileMetaLine(input: {
  uploadedByName: string | null;
  createdAt: string;
  fileSize: number;
}): string;
```

`uploaderLabel` returns the name or `'Uploader unknown'`. `versionSubtitle`
produces the three variants in §2. `changelogFallback` returns the draft line,
the no-description line, or null.

`fileMetaLine` joins its three parts with ` · `. For the size it uses the
one-decimal form — `${(bytes / 1024).toFixed(1)} KB` below 1 MiB, then
`${(bytes / 1048576).toFixed(1)} MB` — matching the local helper in
`CommentsPanel.tsx`. There is no shared byte formatter in the repo today:
`CommentsPanel` and `UploadProgress` each carry their own and they disagree on
rounding. Unifying them is **out of scope** — this adds a third, in the pure
module where it can at least be tested, and changes neither existing copy.

`scripts/tests/versionDetail.test.mjs` covers each, including every null case.

**Verification:** `npx tsc --noEmit`, `npm test` (329 existing plus the new
file), `npm run lint`, then a browser pass against a real package covering:
owner sees all controls; a commenter sees none; opening the drawer on a
non-selected version moves the page; opening it on the *selected* version does
not disturb the open file; deleting a file leaves the drawer open with an
updated list; deleting the version closes it.

---

## 9. Out of scope

- **Adding files to an existing version.** Considered and dropped. It would let
  content appear in a version after reviewers had approved it, and because an
  uploader may not delete from a published version, they could add a file and
  then be unable to remove it. New work goes in a new version.
- Folder tree rendering inside the drawer (§2.1).
- Any change to the delete or download authorization rules.
- Any change to how briefs are composed or what they contain.
