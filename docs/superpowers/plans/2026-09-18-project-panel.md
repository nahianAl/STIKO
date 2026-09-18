# Project Panel & People Consolidation — Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One panel, opened from the dashboard, that holds a project's packages, everyone on them, and both delete controls — replacing a people drawer that can't see pending invites and a package settings page that can only see one package at a time.

**Architecture:** A `ProjectPanel` drawer opened by a new ⤢ control on each project row. It shows packages first, each expanding to its own people; a link swaps the body to the existing cross-package `TeamMatrix`. Both views open one shared `AccessEditor` for a (person × package) pair — which is literally one `participants` row. `ProjectPeopleDrawer` and `/portal/[id]/settings/people` are retired.

**Tech Stack:** Next.js 14 App Router, React 18 client components, Tailwind with the `stiko-*` token set, `node --test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-09-18-trash-and-project-panel-design.md`
**Plan 1 (shipped, live):** `docs/superpowers/plans/2026-09-18-trash.md`

## The finding that shapes this plan

**No new API routes are needed.** Every endpoint the access editor wants already exists and is already correctly gated:

| Need | Endpoint | Notes |
|---|---|---|
| A person's access on a package | `GET /api/participants?portalId=` | Returns `id`, `role`, `canDownload`, `allVersions`, `versionIds` |
| Change role, or remove | `POST /api/participants/role` | `role: null` removes |
| Toggle download | `POST /api/participants/download` | |
| Set version scope | `POST /api/participants/versions` | |
| Versions to pick from | `GET /api/versions?portalId=` | |
| Pending invites | `GET /api/invites?portalId=` | |
| Revoke an invite | `DELETE /api/invites` | |
| Invite / resend | `POST /api/participants` | Re-POSTing the same email resends |

`GET /api/participants` already withholds `allVersions`/`versionIds` from anyone without `canManagePeople`, using an allowlist rather than a blocklist. Do not weaken that.

The one server change in this plan is adding `createdAt` to each package in the project overview payload — the panel shows it and the payload doesn't carry it.

## Global Constraints

- **UI copy says "Package", never "Portal".** `Portal` is the code word only.
- **Use `stiko-*` tokens** from `tailwind.config.ts` — surfaces `stiko-app`/`stiko-wash`/`stiko-tint`, text `stiko-ink`/`stiko-secondary`/`stiko-muted`/`stiko-faint`, borders `stiko-border`/`stiko-sheet`/`stiko-divider`, radii `rounded-panel`/`rounded-inset`/`rounded-pill`, shadows `shadow-stiko-panel`. Role colours come from `roleTagSpec` in `lib/roles.ts`, never hand-picked hex.
- **Reuse the existing components.** `Drawer` (props `isOpen`, `onClose`, `title`, `subtitle`, `footer`, `width`, `anchor`), `Button` (variants `primary`/`secondary`/`ghost`/`danger`; sizes `sm`/`md`/`lg`; accepts `title`), `Avatar`/`AvatarStack`/`RoleTag`/`SectionLabel`/`SkeletonBar` from `components/ui/Primitives.tsx`, `useToast`, `DestructiveConfirm`, `DangerCard`. Do not hand-roll equivalents.
- **No Archive control.** Archive was retired in Plan 1; `archived_at` still exists as a column and must stay untouched.
- **No create-package control** in the panel. That stays on the dashboard.
- **Tested lib modules must not use the `@/` alias** — `node --test` runs the TypeScript with no bundler. `lib/queries` must be `import type` where touched.
- **Never `git add -A`.** Four long-lived untracked directories (`design_handoff_*`, `stiko_handoff`) must never be committed. Stage named files only.
- Commit trailer, own line: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## Why Tasks 3-5 specify behaviour and sources, not literal code

Tasks 1, 2, 6 and 7 give exact code. Tasks 3, 4 and 5 — the three React
components — deliberately do not, and that is a considered departure from this
repo's usual plan style.

Plan 1's Task 9 is the reason. Its brief contained a complete invented
`TrashPanel`, written without reading the components it consumed, and the
implementer had to correct it in four places: it hand-rolled a paragraph that
`Drawer`'s `subtitle` slot already renders, used a "Loading…" string where
`Primitives.tsx` states the rule is "match the shape of the real content, no
spinners", built a bespoke bordered empty state against two existing plain
ones, and keyed a busy flag in a way that did not match its own list key.
Speculative component code did not help; it actively misled, and the review
caught the damage only because the implementer read the real components first.

Everything Tasks 3-5 need already exists in working form — the settings page
implements every access control, `ProjectPeopleDrawer` implements the overview
fetch and delete flow, `TrashPanel` implements the fetch-and-guard shape. So
those tasks name the source to lift from, the behaviour required, and the traps,
and leave the JSX to whoever is looking at the real components. The gate is
correspondingly weaker, which is what the verification section at the end is
about.

## Traps carried from Plan 1 and the dashboard

- **`ProjectListRow` is one absolutely-positioned button under a `pointer-events-none` layer**, because a button cannot nest inside a button. Any new control must re-enable `pointer-events-auto` on its own cell *and* call `stopPropagation` — the page root has a deselect-on-background-click handler that will otherwise undo the open in the same React batch.
- **`app/page.tsx` has two branches**: a first-run early return and the populated list. Plan 1 shipped the Trash button and panel in *both* after a review caught that the first-run branch had neither. The project panel only belongs in the populated branch (no projects means no project rows), but check the early return before assuming.
- The project-list column has deliberate `flex-none` / `lg:flex-1` mobile-stacking behaviour with explanatory comments. Read them before adding a wrapper.
- A fetch-on-open panel needs a **generation guard** so a stale response cannot overwrite a fresh one — see `components/home/TrashPanel.tsx` for the shape this repo settled on.

---

### Task 1: The project roster

The panel's "Everyone" strip needs one list combining accepted participants and pending invitees across a project's packages, deduplicated, ranked, each carrying how many packages they are on. `lib/home.ts`'s `projectPeople` does the accepted half for the dashboard row but knows nothing about pending invites. This is the pure, testable core.

**Files:**
- Create: `lib/projectRoster.ts`
- Test: `scripts/tests/projectRoster.test.mjs`

**Interfaces:**
- Consumes: nothing at runtime; the shapes it accepts mirror `ProjectPackage` from `lib/projectOverview.ts`
- Produces:
  ```typescript
  export interface RosterEntry {
    /** users.id for an accepted person; the email for a pending invite. */
    key: string;
    name: string;
    email: string;
    /** Strongest role held across the packages counted below. */
    role: string | null;
    packageCount: number;
    pending: boolean;
  }
  export function projectRoster(packages: RosterPackage[]): RosterEntry[];
  export function pendingCount(roster: RosterEntry[]): number;
  ```

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/projectRoster.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectRoster, pendingCount } from '../../lib/projectRoster.ts';

const pkg = (name, people = [], pending = []) => ({ id: name, name, people, pending });
const person = (id, role, over = {}) => ({
  id, name: id, email: `${id}@x.co`, role, ...over,
});

test('someone on two packages is listed once, counted twice', () => {
  const r = projectRoster([
    pkg('A', [person('dana', 'commenter')]),
    pkg('B', [person('dana', 'commenter')]),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].packageCount, 2);
});

test('the role shown is the strongest held anywhere', () => {
  // Uploader on one package out of two must not read as commenter.
  const r = projectRoster([
    pkg('A', [person('dana', 'commenter')]),
    pkg('B', [person('dana', 'uploader')]),
  ]);
  assert.equal(r[0].role, 'uploader');
});

test('a pending invite appears, flagged, keyed on its email', () => {
  const r = projectRoster([
    pkg('A', [], [{ email: 'mia@acme.com', role: 'viewer' }]),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].pending, true);
  assert.equal(r[0].key, 'mia@acme.com');
  assert.equal(r[0].email, 'mia@acme.com');
  assert.equal(r[0].name, 'mia@acme.com', 'no display name exists yet');
});

test('an invite the person has since accepted is not listed twice', () => {
  // The accepted row wins: same human, and a pending chip beside their
  // avatar would be a lie once they are in.
  const r = projectRoster([
    pkg('A', [person('dana', 'commenter', { email: 'mia@acme.com' })],
             [{ email: 'mia@acme.com', role: 'viewer' }]),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].pending, false);
  assert.equal(r[0].key, 'dana');
});

test('pending matching is case-insensitive on the email', () => {
  const r = projectRoster([
    pkg('A', [person('dana', 'commenter', { email: 'Mia@Acme.com' })],
             [{ email: 'mia@acme.com', role: 'viewer' }]),
  ]);
  assert.equal(r.length, 1, 'MIA@ACME.COM and mia@acme.com are one person');
});

test('the same pending email on two packages collapses to one entry', () => {
  const r = projectRoster([
    pkg('A', [], [{ email: 'mia@acme.com', role: 'viewer' }]),
    pkg('B', [], [{ email: 'mia@acme.com', role: 'commenter' }]),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].packageCount, 2);
  assert.equal(r[0].role, 'commenter', 'strongest pending role wins too');
});

test('accepted people sort above pending, then by role, then by name', () => {
  const r = projectRoster([
    pkg('A',
      [person('zoe', 'viewer'), person('adam', 'uploader')],
      [{ email: 'mia@acme.com', role: 'uploader' }]),
  ]);
  assert.deepEqual(r.map((e) => e.key), ['adam', 'zoe', 'mia@acme.com']);
});

test('an empty project has an empty roster', () => {
  assert.deepEqual(projectRoster([]), []);
  assert.equal(pendingCount([]), 0);
});

test('pendingCount counts only the pending entries', () => {
  const r = projectRoster([
    pkg('A', [person('dana', 'commenter')],
      [{ email: 'mia@acme.com', role: 'viewer' },
       { email: 'ray@x.co', role: 'viewer' }]),
  ]);
  assert.equal(pendingCount(r), 2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="listed once, counted twice"`

Expected: FAIL — `Cannot find module '../../lib/projectRoster.ts'`.

- [ ] **Step 3: Write the implementation**

Create `lib/projectRoster.ts`:

```typescript
import { highestRole, ROLE_RANK } from './roles.ts';

/**
 * The people on a project, accepted and invited, in one list.
 *
 * `lib/home.ts`'s projectPeople does the accepted half for the dashboard row.
 * This adds pending invitees, because the panel's whole reason for existing is
 * that neither of the two surfaces it replaces could show both at once — the
 * drawer knew roles but not invitations, the settings page knew invitations but
 * only one package at a time.
 *
 * Relative import, not `@/`: this module is unit-tested by `node --test`, which
 * runs the TypeScript directly with no bundler.
 */

export interface RosterPerson {
  id: string;
  name: string;
  email: string;
  role: string | null;
}

export interface RosterPending {
  email: string;
  role: string | null;
}

export interface RosterPackage {
  id: string;
  name: string;
  people: RosterPerson[];
  pending: RosterPending[];
}

export interface RosterEntry {
  /** users.id for an accepted person; the lower-cased email for an invite. */
  key: string;
  name: string;
  email: string;
  /** Strongest role held across the packages counted below. */
  role: string | null;
  packageCount: number;
  pending: boolean;
}

const norm = (email: string) => (email ?? '').trim().toLowerCase();

/**
 * Accepted first, then pending; within each, strongest role first, then name.
 * Pending sort last because they cannot do anything yet — the list should read
 * as "here is the team, and here is who hasn't turned up".
 *
 * Ranking comes from ROLE_RANK rather than a second table here. lib/roles.ts
 * says why in as many words: two copies of this ordering is exactly how the
 * panel and the dashboard row come to disagree about someone's role.
 */

export function projectRoster(packages: RosterPackage[]): RosterEntry[] {
  const accepted = new Map<
    string,
    { name: string; email: string; roles: string[]; count: number }
  >();
  // Keyed on the normalised email so an invite and its acceptance can be
  // matched after both passes.
  const acceptedEmails = new Set<string>();

  for (const pkg of packages) {
    for (const p of pkg.people ?? []) {
      acceptedEmails.add(norm(p.email));
      const seen = accepted.get(p.id);
      if (seen) {
        seen.count += 1;
        if (p.role) seen.roles.push(p.role);
      } else {
        accepted.set(p.id, {
          name: p.name || p.email,
          email: p.email,
          roles: p.role ? [p.role] : [],
          count: 1,
        });
      }
    }
  }

  const pending = new Map<string, { roles: string[]; count: number }>();
  for (const pkg of packages) {
    for (const inv of pkg.pending ?? []) {
      const email = norm(inv.email);
      // An invitation the person has already accepted is not pending — it is
      // just an old row. Showing a pending chip beside someone who is plainly
      // in the package reads as a bug to whoever sees it.
      if (acceptedEmails.has(email)) continue;
      const seen = pending.get(email);
      if (seen) {
        seen.count += 1;
        if (inv.role) seen.roles.push(inv.role);
      } else {
        pending.set(email, { roles: inv.role ? [inv.role] : [], count: 1 });
      }
    }
  }

  const rank = (e: RosterEntry) =>
    e.role ? (ROLE_RANK[e.role as keyof typeof ROLE_RANK] ?? 0) : 0;
  const byRoleThenName = (a: RosterEntry, b: RosterEntry) =>
    rank(b) - rank(a) || a.name.localeCompare(b.name);

  const acceptedEntries: RosterEntry[] = Array.from(accepted, ([key, v]) => ({
    key,
    name: v.name,
    email: v.email,
    role: highestRole(v.roles),
    packageCount: v.count,
    pending: false,
  })).sort(byRoleThenName);

  const pendingEntries: RosterEntry[] = Array.from(pending, ([email, v]) => ({
    key: email,
    // No display name exists until they accept — the address is the only
    // honest label.
    name: email,
    email,
    role: highestRole(v.roles),
    packageCount: v.count,
    pending: true,
  })).sort(byRoleThenName);

  return [...acceptedEntries, ...pendingEntries];
}

/** How many of these are still invitations. Drives the "n not accepted" chip. */
export function pendingCount(roster: RosterEntry[]): number {
  return roster.filter((e) => e.pending).length;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`

Expected: the nine new `projectRoster.test.mjs` tests pass, and every pre-existing test still passes (baseline is 652, so 661).

- [ ] **Step 5: Commit**

```bash
git add lib/projectRoster.ts scripts/tests/projectRoster.test.mjs
git commit -m "feat: one project roster covering accepted people and pending invites"
```

---

### Task 2: `createdAt` on each package in the overview payload

The panel shows when each package was created. The payload doesn't carry it.

**Files:**
- Modify: `app/api/projects/[id]/overview/route.ts` (the `packageRows` query and the `packages` map)
- Modify: `lib/projectOverview.ts` (the `ProjectPackage` interface)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `ProjectPackage.createdAt: string` — an ISO timestamp, present on every package

- [ ] **Step 1: Add the column to the query**

In `app/api/projects/[id]/overview/route.ts`, the `packageRows` query selects from `portals po`. Add `po.created_at AS "createdAt"` to its select list, alongside the existing `po.` columns. Do **not** change its `WHERE po.project_id = … AND po.deleted_at IS NULL` — that filter is Plan 1's and is correct.

- [ ] **Step 2: Carry it through the map**

In the same file's `packages` map, add `createdAt` to the returned object:

```typescript
      createdAt: p.createdAt as string,
```

Neon's HTTP driver returns `TIMESTAMPTZ` as a **`Date`**, not a string — this repo has already shipped one bug from assuming otherwise. `NextResponse.json` serialises a `Date` to ISO, so passing it straight through is correct here and matches how `publishedAt` is already handled two lines away. Do not call `String()` on it: that produces a locale-formatted string, which is exactly the defect Plan 1's Task 6 had to fix.

- [ ] **Step 3: Add it to the type**

In `lib/projectOverview.ts`, add to `ProjectPackage`, after `tag`:

```typescript
  /** ISO timestamp. The panel shows when each package was created. */
  createdAt: string;
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`

Expected: clean. If a consumer constructs a `ProjectPackage` literal and now lacks `createdAt`, the compiler names it — `components/home/ProjectPeopleDrawer.tsx`'s `toAddPeoplePackages` is the likely one. Fill it with the real value if available, or `new Date(0).toISOString()` with a comment if not; that file is deleted in Task 6 anyway.

- [ ] **Step 5: Run the tests and commit**

Run: `npm test` — expect 661 passing, unchanged by this task.

```bash
git add "app/api/projects/[id]/overview/route.ts" lib/projectOverview.ts
git commit -m "feat: carry each package's created date in the project overview"
```

---

### Task 3: The access editor

One component for a (person × package) pair — which is exactly one `participants` row. Role, version scope, download permission, remove. Opened later from both the package-first list and the cross-package grid.

**This is the fix for the drift the whole plan exists to end.** Two views pointing at the same row must open the same editor, or each grows its own half of the controls again — which is precisely how the drawer learned roles while the settings page learned roles plus versions plus downloads, and neither learned pending state.

**Files:**
- Create: `components/people/AccessEditor.tsx`

**Interfaces:**
- Consumes: `GET /api/participants?portalId=`, `GET /api/versions?portalId=`, `POST /api/participants/role`, `POST /api/participants/download`, `POST /api/participants/versions`, `POST /api/participants`, `GET /api/invites?portalId=`, `DELETE /api/invites`
- Produces:
  ```typescript
  export default function AccessEditor(props: {
    isOpen: boolean;
    onClose: () => void;
    /** The package this access is on. */
    portalId: string;
    packageName: string;
    /** users.id for an accepted person, null for a pending invite. */
    userId: string | null;
    /** Always present — the pending case has only an address. */
    email: string;
    displayName: string;
    pending: boolean;
    /** Refetch the panel; access changed. */
    onChanged: () => void;
  }): JSX.Element
  ```

- [ ] **Step 1: Read what already does this, then reuse it**

`app/portal/[id]/settings/people/page.tsx` already implements every control this component needs — role selector with its help text, the download toggle, the "All versions" checkbox plus per-version list, revoke, and resend. **Read it in full first.** The goal is to lift that behaviour into a reusable component, not to reinvent it: the fetch shapes, the optimistic-update patterns and the guard at its `allVersions` toggle (unchecking with nothing selected) are all already correct and hard-won.

Also read `components/ui/Drawer.tsx` and `components/ui/Primitives.tsx` for the real props, and `lib/roles.ts` for `roleTagSpec`/`roleLabel`.

- [ ] **Step 2: Build the component**

Render it in a `Drawer` with `anchor="inline"` so it can sit beside the project panel rather than starting at the window edge — read `Drawer`'s `anchor` documentation before choosing.

Sections, in this order:

1. **Header** — `Avatar` (dashed outline when `pending`), display name, email.
2. **A line naming the package**: `Access on {packageName}`.
3. **Role** — a three-way segmented control (Viewer / Commenter / Uploader) with the one-line help text for the selected role. Take the help strings verbatim from the settings page's `ROLE_HELP`.
4. **Versions they can see** — two radios, "All versions, including future ones" and "Only the versions I pick", the second revealing a checkbox list from `GET /api/versions?portalId=`. **Uploaders are never scoped** — an uploader's work builds on what came before, so hide this section entirely when the selected role is `uploader` (`lib/access.ts` documents why). Preserve the settings page's guard that unchecking "All versions" with nothing selected is refused.
5. **Downloads** — a toggle bound to `canDownload`.
6. **Danger strip** — "Remove from {packageName}", calling `POST /api/participants/role` with `role: null`.

For a **pending** person: role and scope still apply (they are stored on the invite), but show `Resend invitation` and `Revoke invitation` instead of the remove control. Resend is `POST /api/participants` with the same email and role; revoke is `DELETE /api/invites`. Read the settings page's `revoke` handler — it does *two* calls, and the second is the one that actually matters.

Every mutation calls `onChanged()` on success and shows a toast on failure. Use `useToast`.

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx next lint --file components/people/AccessEditor.tsx`

Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add components/people/AccessEditor.tsx
git commit -m "feat: one access editor for a person on a package"
```

---

### Task 4: Upgrade the team matrix

`TeamMatrix` is the cross-package grid. It can set roles but has never known about pending invites, resend or revoke. It becomes the panel's "everyone across packages" view and delegates all cell editing to `AccessEditor`.

**Files:**
- Modify: `components/people/TeamMatrix.tsx`

**Interfaces:**
- Consumes: `AccessEditor` from Task 3; `RosterEntry` from Task 1
- Produces: the same default export, with its inline role menu replaced by `AccessEditor` and pending rows added

- [ ] **Step 1: Replace the inline editor with `AccessEditor`**

`TeamMatrix` currently holds `editing: { personId, portalId } | null` and renders its own role menu. Keep the state (it identifies the cell); replace what it renders with `AccessEditor`, passing that cell's `portalId`, the person's `userId`/`email`/name, and `pending`.

Clicking an em-dash (no access) must still grant access — that path currently creates a participant. Route it through the same editor rather than a second code path: open `AccessEditor` for that cell, and let the role selector's first write create the row.

- [ ] **Step 2: Add pending rows**

The grid takes `packages: ProjectPackage[]`, each of which carries `pending`. Build the row set from `projectRoster(packages)` (Task 1) rather than from `people` alone, so pending invitees get rows. Render a pending row's name cell as the email with an `Invited {relativeTime}` chip, using the note-yellow pair (`#FFFCCE` / `#7A5E00`) that the rest of the app uses for "waiting on someone".

A pending person's cell in a package they were invited to shows their invited role at reduced emphasis; a package they were not invited to stays an em-dash.

- [ ] **Step 3: Typecheck, lint and commit**

Run: `npx tsc --noEmit && npx next lint --file components/people/TeamMatrix.tsx`

```bash
git add components/people/TeamMatrix.tsx
git commit -m "feat: the access matrix learns pending invites and shares the access editor"
```

---

### Task 5: The project panel

**Files:**
- Create: `components/home/ProjectPanel.tsx`

**Interfaces:**
- Consumes: `projectRoster`/`pendingCount` (Task 1), `ProjectPackage.createdAt` (Task 2), `AccessEditor` (Task 3), `TeamMatrix` (Task 4), `GET /api/projects/[id]/overview`, `DELETE /api/portals/[id]`, `DELETE /api/projects/[id]`
- Produces:
  ```typescript
  export default function ProjectPanel(props: {
    group: ProjectGroup | null;
    isOpen: boolean;
    onClose: () => void;
    /** Refetch the dashboard. */
    onChanged: () => void;
    /** Land on the cross-package grid instead of the package list. */
    initialView?: 'packages' | 'everyone';
  }): JSX.Element
  ```

- [ ] **Step 1: Read the two things it replaces**

Read `components/home/ProjectPeopleDrawer.tsx` in full — it already does the overview fetch, the AI-summaries toggle, the delete flow and the `canManage` gating, and those parts are correct. This component is that drawer reorganised around packages, not a fresh start. Read `components/home/TrashPanel.tsx` too, for the generation-guard fetch shape this repo settled on.

- [ ] **Step 2: Build the panel**

A `Drawer` titled with the project name. Body:

- **Header block** — project name, the viewer's role tag, and `{n} packages · {m} people · created {date}`.
- **Everyone strip** — `AvatarStack` from `projectRoster(...)`, a `{n} not accepted` chip in the note-yellow pair when `pendingCount > 0`, an `+ Add people` button opening the existing `AddPeopleModal`, and a `See everyone across packages →` link that swaps the body to `TeamMatrix`.
- **Packages list** — one row per package: name, latest version chip, `createdAt` formatted with `relativeTime` or a short date, and its own `AvatarStack`. Expanding a row reveals its people (avatar, name, `RoleTag`, pending chip where applicable) each with a `⋯` opening `AccessEditor`, plus `+ Add person` and **Delete package**.
- **Danger strip, pinned at the bottom** — **Delete project**, stating how many packages go with it and that it is recoverable for 28 days.

Both delete controls use `DestructiveConfirm`. Their copy must match what Plan 1 shipped — recoverable for 28 days, still counting toward storage — not "cannot be undone". Read the strings in `app/portal/[id]/settings/page.tsx` and reuse their shape.

**No Archive control. No create-package control.**

Gate management controls on `group.project.ownedByMe || group.project.myRole === 'coordinator'`, matching what `ProjectPeopleDrawer` already does, and keep its note explaining why `coordinator` is safe to trust there.

- [ ] **Step 3: Typecheck, lint and commit**

Run: `npx tsc --noEmit && npx next lint --file components/home/ProjectPanel.tsx`

```bash
git add components/home/ProjectPanel.tsx
git commit -m "feat: the project panel — packages, people and both delete controls in one place"
```

---

### Task 6: Wire it to the dashboard and retire the drawer

**Files:**
- Modify: `components/home/ProjectListRow.tsx`
- Modify: `app/page.tsx`
- Delete: `components/home/ProjectPeopleDrawer.tsx`

**Interfaces:**
- Consumes: `ProjectPanel` (Task 5)
- Produces: `ProjectListRow` gains `onOpenPanel: (projectId: string) => void`

- [ ] **Step 1: Add the ⤢ control to the row**

In `components/home/ProjectListRow.tsx`, add a cell at the **far right**, after the People cell. It must:

- be `pointer-events-auto` on its own cell, because the row's content sits in a `pointer-events-none` layer over one big absolutely-positioned button — the file's own comment explains why;
- call `e.stopPropagation()` before `onOpenPanel(project.id)`, or the page root's deselect handler undoes the open in the same React batch;
- be **invisible at rest and visible on hover or while the row is expanded** — use `opacity-0 group-hover:opacity-100` plus a condition on `expanded`, matching the `group` class already on the row's wrapper. Give it an `aria-label` of `Manage {project.name}` so it is reachable and named even while visually hidden, and do **not** hide it with `display:none` or remove it from the DOM, which would take it out of the tab order.

- [ ] **Step 2: Swap the panel in `app/page.tsx`**

Replace the `ProjectPeopleDrawer` import and element with `ProjectPanel`. Keep the existing `peoplePanelProjectId` state — the avatar stack still opens the panel, now with `initialView="everyone"`. Add state for the ⤢ entry point opening `initialView="packages"`, and pass `onOpenPanel` down through `ProjectListRow`.

`onChanged` keeps pointing at the page's `load`.

**Check the first-run early return before you finish.** Plan 1 shipped the Trash button and panel in both branches after a review found the first-run branch had neither. The project panel needs no entry point there — no projects means no project rows — but confirm that rather than assuming, and say what you found in your report.

- [ ] **Step 3: Delete the old drawer**

```bash
git rm components/home/ProjectPeopleDrawer.tsx
```

Then `npx tsc --noEmit` and fix whatever the compiler names. `toAddPeoplePackages` lived in that file; if `AddPeopleModal` still needs a `PackageCard → ProjectPackage` adapter, move it to `ProjectPanel` rather than resurrecting the file.

- [ ] **Step 4: Typecheck, lint, test and commit**

Run: `npx tsc --noEmit && npx next lint && npm test` — expect 661 passing.

```bash
git add components/home/ProjectListRow.tsx app/page.tsx
git commit -m "feat: open the project panel from the dashboard, and retire the people drawer"
```

---

### Task 7: Retire the per-package people page

**Files:**
- Delete: `app/portal/[id]/settings/people/page.tsx`
- Modify: `app/portal/[id]/settings/page.tsx` (its nav) and any other link to that route

**Interfaces:**
- Consumes: nothing
- Produces: `/portal/[id]/settings/people` redirects to the dashboard

- [ ] **Step 1: Find every link to it**

Run: `grep -rn "settings/people" --include="*.ts" --include="*.tsx" app components`

Every hit is either the page itself, a nav entry, or a link. Record them all before deleting anything.

- [ ] **Step 2: Replace the page with a redirect**

Replace the file's contents with a server component that redirects to `/`:

```tsx
import { redirect } from 'next/navigation';

/**
 * Retired. Everything this page did — roles, version scoping, download
 * permission, pending invites, resend and revoke — now lives in the project
 * panel on the dashboard, reachable without leaving it.
 *
 * A redirect rather than a deletion because this URL has been linked from the
 * package settings nav for months and may sit in a bookmark or an email.
 */
export default function RetiredPackagePeoplePage() {
  redirect('/');
}
```

The spec's ideal is landing on the dashboard with that project's panel already open. That needs the project id, which this route does not have — it has a portal id — and resolving it would mean a database read in a page whose only job is to leave. Redirect to `/` and note the gap in your report; a follow-up can add `?panel={projectId}` once something needs it.

- [ ] **Step 3: Remove the nav entry**

In `app/portal/[id]/settings/page.tsx` and any sibling that renders the settings nav, remove the `{ key: 'people', label: 'People', href: … }` entry. Leave the other entries untouched.

- [ ] **Step 4: Verify nothing still links there**

Run the Step 1 grep again. Expected: only the redirect file itself.

- [ ] **Step 5: Typecheck, lint, test and commit**

Run: `npx tsc --noEmit && npx next lint && npm test`

```bash
git add "app/portal/[id]/settings/people/page.tsx" "app/portal/[id]/settings/page.tsx"
git commit -m "refactor: retire the per-package people page for the project panel"
```

---

## Done when

- A project row shows a ⤢ control on hover, and while expanded, that opens the panel.
- The panel lists packages with created dates and their own people, expands each in place, and deletes either a package or the whole project — with copy that matches what Plan 1 actually does.
- Clicking the avatar stack opens the same panel on the cross-package grid.
- One access editor opens from both a package row and a grid cell, and handles role, version scope, download and removal — plus resend and revoke for someone who hasn't accepted.
- Pending invitees are visible in both views. Neither surface has controls the other lacks.
- `ProjectPeopleDrawer` and `/portal/[id]/settings/people` are gone.
- `npx tsc --noEmit`, `npx next lint` and `npm test` (661) are all clean.

## Verification this plan cannot do for itself

No test in this repo renders a React component, so every task here is gated by `tsc` and lint only — which catch wrong prop names and nothing about behaviour. **The panel has to be driven in a browser before it is believed.** At minimum: open it from both entry points, expand a package, change someone's role, scope someone to one version, resend an invite, delete a package, delete a project, and confirm the dashboard updates without a manual reload.

Plan 1 shipped to production without that pass. Do not repeat it here — this plan's surface is entirely UI, so static analysis covers even less of it than it did there.

## Not in this plan

Two things the Plan 1 reviews surfaced that need their own specs, and are **not** fixed here:

- `app/api/markups/route.ts` and `app/api/markups/[id]/route.ts` have **no `auth()` call and no access check at all** — any signed-in user can read, write or delete markups on any file in any package.
- `snapshots/{uuid}` and `comment-attachments/{uuid}` are minted flat with no portal segment, so the trash purge orphans them in storage permanently.
