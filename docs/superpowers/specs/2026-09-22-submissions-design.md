# Submissions: "version" becomes "submission", and submissions can be named

**Date:** 2026-09-22
**Status:** Design, approved for planning
**Source:** User request with an annotated screenshot of the portal's version rail and detail drawer.

---

## What changes

1. **Terminology.** Every user-facing "version" becomes "submission", across the whole app. The rail button "Submit new version" becomes **"Add new submission"**.
2. **Names.** Each submission can carry a name. When it has none, it shows as "Submission N". Anyone who can upload can rename a submission from its expanded view (the detail drawer).

This is a **copy change, like portal → package**: the database, routes, types, components and variables all keep the name `version`. Only rendered strings change. No identifier, file or route is renamed.

## Decisions

Settled with the user on 2026-09-22. Do not relitigate.

1. **The rename covers the whole app, not just the panel**, so a reviewer never sees both words.
2. **Owner, coordinator and uploader can rename.** A rename destroys nothing and can be undone, so it follows `canTransform` (uploaders included), not `canDeleteContent`, which cuts uploaders off once a submission is published. Commenters and viewers see the name but can't change it.
3. **The rail card leads with the name.** The newest card keeps its gradient badge and adds a small **CURRENT** tag on its date line. It no longer replaces the name with the word "Current".
4. **The badge prefix changes from V to S** (`V5` → `S5`) everywhere a compact number appears.
5. **An empty name means "use the default".** The default is computed at render time and never written to the row.
6. **No name field in the submit drawer.** Names are edited only in the expanded view.

## Data

Migration `lib/migrations/015-submission-names.sql`. It's additive and nullable, so it's safe to apply before the code ships:

```sql
ALTER TABLE versions ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE versions ADD COLUMN IF NOT EXISTS renamed_at TIMESTAMPTZ;
```

Mirror both columns in `lib/schema.sql`.

- `name` is `NULL` until someone names the submission. No backfill: existing rows read "Submission N" immediately.
- `renamed_at` is set to `NOW()` on every successful rename. It exists only so the live-update feed can see a rename (see "Live updates").
- **Check the live `schema_migrations` table before committing the number `015`.** It is keyed on the filename, and a second file under a name already recorded is silently skipped. Unmerged branches have claimed numbers before (`010`).

Rejected alternatives:
- Writing "Submission N" into every row at creation. That stores today's wording in the database, so the next wording change would need a backfill, and a typed name would look the same as a default.
- Browser-only names. Other people would never see them.

## Naming helpers: `lib/submissionName.ts` (new)

A pure module with no DB and no `@/` imports, so `node --test` can import it:

```ts
export const SUBMISSION_NAME_MAX = 80;

/** "Revised per structural notes", or "Submission 5" when unnamed. */
export function submissionTitle(v: { name: string | null; versionNumber: number }): string;

/** "S5". The compact form used in badges, chips and meta lines. */
export function submissionBadge(versionNumber: number): string;

/** Trims the input. Blank or whitespace-only input becomes null (the default comes back).
 *  Returns { ok: false } for a non-string, or for input longer than SUBMISSION_NAME_MAX
 *  after trimming. */
export function normalizeSubmissionName(input: unknown):
  | { ok: true; name: string | null }
  | { ok: false; error: string };
```

Every place that shows a submission's title or badge goes through these two functions. None of them builds the string itself.

`Version` in `lib/types.ts` gains `name: string | null` and `canRename?: boolean`.

## Permission: `canRenameVersion(role)` in `lib/capabilities.ts`

It returns true for `owner`, `coordinator` and `uploader`, and false for `commenter` and `viewer`. An unknown role fails closed, using the same exhaustive `never` switch as `canDeleteContent`. The server decides and sends the result to the client, which never recomputes it:

- `GET /api/versions` selects `v.name` and adds `canRename` to each row, next to `canDelete`.
- The drawer shows the pencil only when `version.canRename` is true.

## API: `PATCH /api/versions/[id]`

Body: `{ "name": string | null }`.

| Case | Response |
|---|---|
| No session | 401 |
| The caller can't see the version: no package access, a draft they can't publish, or outside their version scope | **404**, not 403, matching DELETE, so the response never confirms the version exists |
| Visible, but `canRenameVersion` is false | 403 |
| `normalizeSubmissionName` rejects the input | 400 with its error |
| OK | `UPDATE versions SET name = $name, renamed_at = NOW()`, returning 200 with `{ id, name }` |

Visibility, in order:
1. `getVersionAccess(userId, id)` in `lib/access.ts`. It returns null for a missing version, no package access, or a version outside the caller's scope, and each of those gives 404.
2. Then read the row's `published_at`. If it's a draft and `!access.canUpload`, respond 404. `getVersionAccess` doesn't apply the draft rule, and without this step a commenter probing a draft would get a 403 that confirms the draft exists.
3. Only then check `canRenameVersion(access.role)`, which gives the 403.

Duplicate names are allowed, because the S-number keeps two submissions apart.

## Live updates

The versions cursor in `app/api/portals/[id]/activity/route.ts` is currently `GREATEST(MAX(created_at), MAX(published_at))`. Add `MAX(renamed_at)` to it. Postgres `GREATEST` ignores NULLs, so rows that were never renamed change nothing. With this, a rename moves the cursor, and other people's open tabs re-fetch the rail through the existing `versions` entity path. The draft and scope filters already in the `visible_versions` CTE still apply, so a reviewer's cursor doesn't move when someone renames a submission hidden from them.

## UI

### Rail: `components/portal/FileTreeSidebar.tsx`

- **Header:** "Submissions". Collapse tooltip: "Expand submissions".
- **Card title:** `submissionTitle(version)` on every card, truncated as today.
- **Current card:** keeps the gradient badge and puts a small `CURRENT` pill before the date on its date line. It keeps the `font-bold` title weight.
- **Badge:** `submissionBadge(n)`.
- **Details icon:** `aria-label` "Open submission details for {title}", `title` "{title} details".
- **Empty states:** "Add your first submission to get started" and "No files in this submission".
- **Button:** **"Add new submission"**.

### Expanded view: `components/portal/VersionDetailDrawer.tsx` + `components/ui/Drawer.tsx`

- **`Drawer`** gains an optional `heading?: React.ReactNode`. When it's given, it replaces the contents of the `<h2>`. The string `title` stays required and keeps feeding `aria-label`. Every other drawer is untouched.
- **Title:** `submissionTitle(version)`. When `version.canRename` is true, a pencil button sits beside it (aria-label "Rename submission").
- **Editing:**
  - Clicking the pencil swaps the title for a text input pre-filled with the **current name**, or empty when unnamed. The placeholder is `Submission N`, and `maxLength` is `SUBMISSION_NAME_MAX`.
  - **Enter** or **blur** saves. **Escape** cancels and restores the title.
  - Saving an unchanged value sends nothing.
  - Clearing the field and saving stores NULL, so the title goes back to "Submission N". That is the defaults-are-editable rule: the default can be erased, and whatever the user types replaces it.
- **Escape must not close the drawer while editing.** The input's Escape handler calls `e.stopPropagation()` **and** `e.nativeEvent.stopImmediatePropagation()`. `closeOnEscape={!confirmOpen}` stays as it is.
  - **Why both.** Next 14's App Router hydrates React onto `document` itself (`next/dist/client/app-index.js`, `const appElement = document`). That puts React's key listener on the same node as the drawer's, and React's is registered first, at hydration.
  - `stopPropagation` cannot stop a listener on the same node; `stopImmediatePropagation` stops the drawer's.
  - `stopPropagation` is still needed, because it stops `window` listeners such as the page's measure-tool Escape.
  - Corrected 2026-09-23 during the Task 3 review: the first version of this spec assumed a React root below `document`, and its mechanism would have let the drawer close.
- **Save:**
  - Nothing optimistic. The input stays and shows a busy state until the PATCH returns.
  - On success, the page's `versions` state is updated with the returned name, so the rail and the drawer change together.
  - On failure, a toast reads "Could not rename this submission". The input closes and the previous title comes back.
- **Other copy:** "No files in this submission." / "What changed in this submission" / delete button "Delete this submission and everything in it". The drawer title already says which submission; putting the name in the button would make a long name wrap.

### Delete confirm: `app/portal/[id]/page.tsx`

- Title: `Delete "{submissionTitle}"?`. Name chip: `submissionBadge(n)`.
- Consequence: "This cannot be undone. Everyone loses this submission and every comment on it, including people mid-review."
- Confirm label: "Delete submission".
- Toasts: "{submissionTitle} deleted" / "Could not delete this submission".

### Compact pickers and chips

These are pills or meta fragments with no room for a name. Each shows `submissionBadge(n)`, and gets `title={submissionTitle(v)}` as a tooltip wherever its data already carries `name`. Don't widen a query just to add a tooltip.

- `components/portal/ShareModal.tsx` (both pickers)
- `components/people/AccessEditor.tsx`
- `components/people/AddPeopleModal.tsx` (the picker and the ` · V{n}` meta)
- `app/invite/[token]/page.tsx`
- `components/home/ProjectPanel.tsx`
- `lib/home.ts` (the `V${n}` meta fragment)
- `components/ui/UploadProgress.tsx` ("Replaces S{n}")
- `app/portal/[id]/settings/page.tsx` (" — S{n} currently…", "Open S{n}")

## Copy sweep

Every user-facing "version" becomes "submission", keeping the original's case and number. Known sites as of 2026-09-22, beyond the UI sections above:

| File | Strings |
|---|---|
| `components/portal/NewVersionDrawer.tsx` | Title "Add submission {n}", button "Publish submission {n}", toast "Submission {n} published", errors "Could not start the submission" / "Could not publish the submission" |
| `app/new/page.tsx` | Changelog default and placeholder "First submission" (both occurrences), hint "shown on the submission", the two error strings |
| `components/portal/VersionBrief.tsx` | "…comments on this submission into themes." |
| `lib/versionDetail.ts` | "No description was written for this submission." |
| `components/people/AccessEditor.tsx` | Role blurb "…and publish submissions.", toasts, "Submissions they can see", the two load/empty states, the "All submissions" references |
| `components/home/ProjectSummaryPanel.tsx` | Empty-state sentence, "submission" / "submissions" count |
| `app/portal/[id]/settings/page.tsx` | Both count sentences, the "Submissions" stat label |
| `lib/status.ts` | "NEW SUBMISSION" |
| `lib/home.ts` | "New submission" |
| `lib/notificationEvents.ts` | "A new submission is published" |
| `lib/email.ts` | Body "…published submission {n} of {package}.", subject "Submission {n} of {package} is ready to review" |
| `app/api/versions/publish/route.ts` | Notification title "Submission {n} published in {package}" |
| `app/api/verdicts/route.ts` | Notification title "…requested changes on Submission {n} of {package}"; error "This submission has not been published yet" |
| `app/api/versions/publish/route.ts`, `app/api/participants/versions/route.ts`, `app/api/versions/[id]/changelog-draft/route.ts` | The user-facing `error:` strings |
| `lib/ai/summarize.ts` | `'Submission not found'`. `app/api/versions/[id]/summary/route.ts` returns this reason as the `error` body, so it can reach the screen |
| `lib/ai/prompt.ts` | `SUBMISSION {n}`, "where this submission stands", "PRIOR THEMES (from earlier submissions)", the project and changelog system prompts, "Open concerns from submission {n}" |

**Emails and notifications use "Submission N", never the custom name.** They're written at publish, before anyone could have named the submission.

**Left alone deliberately:**
- The developer-facing "The database is missing … this version needs" strings, which refer to the app's version.
- `pdfjs.version`.
- Code comments, identifiers, routes, API field names, and the `new_version` notification type key.

**Already-stored text keeps its old wording, and there is no backfill:** AI Briefs and headlines already generated ("Version 5 requires c…"), notification rows already written, and emails already sent. Briefs pick up the new word when they're regenerated.

**Acceptance check for the sweep:** after the plan's edits, a case-insensitive search for `\bversions?\b` inside string literals and JSX text under `app/`, `components/` and `lib/` (tests excluded) returns only the "Left alone" items above. A search for the badge form `V{` / `` `V${ `` returns nothing.

## Testing

The repo has no React component test harness, so the logic goes where `node --test` can reach it:

- `scripts/tests/submissionName.test.mjs` (new):
  - `submissionTitle`, both named and unnamed
  - `submissionBadge`
  - `normalizeSubmissionName`: trims; blank or whitespace-only becomes null; exactly 80 characters passes; 81 fails; a non-string fails
- `scripts/tests/roles.test.mjs` or `access.test.mjs`: `canRenameVersion` for all five roles, plus an unknown role failing closed.
- These existing tests assert old copy and must be updated, not deleted: `versionDetail.test.mjs`, `email.test.mjs`, `home.test.mjs`, `status.test.mjs`, `access.test.mjs`, plus `aiPrompt.test.mjs` if it asserts the prompt wording.
- `npx tsc --noEmit`, `npm run lint` and `npm test` all clean.

**Browser pass** against a production build (`npm run build && npm start`, not `npm run dev`). Local dev points at the **production** database, so rename only a submission in a package created for the test, then delete that package afterwards:

1. The rail shows "Submission N" titles, S-badges, the CURRENT tag and "Add new submission".
2. Rename in the drawer. The rail and the drawer both update, and a reload keeps the name.
3. Escape while editing cancels the edit and leaves the drawer open. A second Escape closes it.
4. Clear the name and save. The title goes back to "Submission N".
5. An 81-character paste is capped by the input.
6. Signed in as a commenter, no pencil appears.
7. With two tabs open, a rename in one appears in the other without a reload.

## Rollout and rollback

1. Apply migration 015 to production **first**. It's additive, so the running code ignores it.
2. Merge to `main`, which auto-deploys.
3. **Rollback:** revert the merge commit. The two columns stay behind harmlessly; nothing else reads them.
