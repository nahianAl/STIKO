# Dashboard List Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's grid of project cards with a single dense project list that reveals packages on click, split the activity rail into an AI summary panel plus the activity feed, and retire `/project/[id]` by moving its remaining functions into the dashboard's people drawer.

**Architecture:** One screen (`app/page.tsx`) holds three pieces of local state — `expanded` (selected project id), `lastId` (kept so the summary panel can animate shut with content still in it), and `railOpen`. Everything else stays derived from the `PackageCard[]` that `/api/home` already returns; the new attention derivations join the existing pure helpers in `lib/home.ts` so they can be unit-tested. The AI summary panel reads the project brief endpoint that is already in production, rendering one bullet per package section rather than re-prompting the model.

**Tech Stack:** Next.js App Router, React 18 client components, TypeScript, Tailwind (tokens in `tailwind.config.ts`), `node --test` over `.mjs` files in `scripts/tests/`.

## Global Constraints

- **Tokens, not hex.** Every colour in the design maps to a `tailwind.config.ts` token. Three values are genuinely missing and Task 2 adds them; no other new tokens are permitted. Inline `style` is allowed only where a value is data-driven (status accent, avatar colour) — the existing components already follow this split.
- **Terminology:** "Package" in all user-visible copy, "Portal" everywhere in code. Never surface the word "portal" to a user.
- **Derived, never stored:** package counts, open-comment sums, attention flags, the three stat tiles and the page subline all derive from the package collection at render time. No literals, no second source.
- **`lib/` modules under test must not use the `@/` alias** and must import `lib/queries` as `import type` only — `lib/queries` pulls `lib/db`, which throws at module load without `DATABASE_URL`.
- **Test command:** `npm test` runs `node --test scripts/tests/*.mjs`. React components are not unit-tested in this repo; verify them in a browser (see `stiko-local-visual-verification`).
- **Respect `prefers-reduced-motion`** on every animation this plan adds. `app/globals.css` already has the precedent at the `.stiko-cube` rule.
- **Mobile is load-bearing.** `app/page.tsx:201-210` documents why the left column is `flex-none lg:flex-1`: without it the rail's content-driven height collapses the project column to 0px and renders it *under* the rail. Every layout change below keeps that behaviour.
- **Commit after every task.** Never `git add -A` in this repo — four untracked handoff directories will be swept in. Add files by path.

## Deliberate deviations from the design document

Record these in the PR description; they are decisions, not oversights.

1. **Summary content model.** The spec asks for three points grouped by urgency (`Needs you` / `Moving` / `Settled`). The live endpoint returns one section per package. We render one point per package section — label = package name, accent = that package's real status accent, text = the section body. No prompt, validator or AI test changes.
2. **Provenance line.** The spec's `Drafted from {n} comments and {n} versions` needs a comment count the endpoint does not return. We render `Drafted from {n} packages and {n} versions · updated {relative}`, derived entirely from the brief already in hand. The line keeps its purpose — saying what the summary was computed from — with no server change.
3. **No project page.** `/project/[id]` is deleted. Its access matrix, AI-summaries switch and delete-project control move into the dashboard's people drawer. Its "Waiting on" panel is dropped as near-duplicate of the attention pills the new row shows.
4. **Filters stay gated.** The spec shows all three filter buttons always. `showFilterRow()` hides the row unless the viewer has both an owned and an invited project; that gating is kept.

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/home.ts` *(modify)* | Gains `packageAttention` / `projectAttention`. Stays pure and tested. |
| `lib/projectOverview.ts` *(create)* | Home for the `ProjectPerson` / `ProjectPackage` / `Overview` types currently exported from the page being deleted. |
| `tailwind.config.ts`, `app/globals.css` *(modify)* | The three missing tokens and the two keyframes. |
| `components/home/ProjectListRow.tsx` *(create)* | One project: collapsed row, expansion panel, package rows, "Add a package". |
| `components/home/ProjectListHeader.tsx` *(create)* | The column header strip. |
| `components/home/PackageListRow.tsx` *(create)* | A package row inside an expansion. Replaces `CardPackageRow.tsx`. |
| `components/home/ActivityFeedPanel.tsx` *(create)* | Panel B — stat tiles plus the grouped feed. The body of today's `ActivityRail`. |
| `components/home/ProjectSummaryPanel.tsx` *(create)* | Panel A — fetches and renders the project brief; owns its three states. |
| `components/home/ActivityRail.tsx` *(rewrite)* | Now just the animating wrapper stacking Panel A over Panel B. |
| `components/shell/RailToggle.tsx` *(create)* | The header bell, as a toggle. Replaces `NotificationTray`'s button. |
| `components/shell/NotificationTray.tsx` *(reduce)* | Keep the `NotificationRow` interface; delete the popover UI. |
| `components/home/ProjectPeopleDrawer.tsx` *(modify)* | Fetches the project overview; absorbs the access matrix, AI switch and delete. |
| `app/page.tsx` *(rewrite)* | Owns `expanded` / `lastId` / `railOpen` and composes the above. |
| `components/home/ProjectCard.tsx`, `components/home/CardPackageRow.tsx`, `app/project/[id]/page.tsx`, `components/project/WaitingOn.tsx`, `components/project/ProjectBrief.tsx` *(delete)* | Superseded. |

---

### Task 1: Attention derivations

Attention is computed inline in `CardPackageRow` today. The new design needs the same fact at project level too, so it moves to `lib/home.ts` where it can be tested and cannot drift.

Note there is already a `deriveAttention` in `lib/status.ts`. **Do not use it here.** It returns uppercase labels and an `UP TO DATE` fallback for a different surface. The function below is a lift of the logic `CardPackageRow` actually ships.

**Files:**
- Modify: `lib/home.ts` (append after `needsYou`, around line 154)
- Test: `scripts/tests/home.test.mjs`

**Interfaces:**
- Consumes: `needsYou(pkg: PackageCard): boolean` — already exported from `lib/home.ts`.
- Produces:
  - `interface Attention { kind: 'mention' | 'new_version'; label: string; bg: string; fg: string }`
  - `packageAttention(pkg: PackageCard): Attention | null`
  - `projectAttention(pkgs: PackageCard[]): Attention | null`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/tests/home.test.mjs`:

```javascript
/* ------------------------------------------------------------- attention -- */

test('a package needing nothing has no attention pill', () => {
  assert.equal(packageAttention(pkg({ mentions: 0, seenLatest: true })), null);
});

test('mentions outrank an unseen version', () => {
  const a = packageAttention(pkg({ mentions: 2, seenLatest: false }));
  assert.equal(a.kind, 'mention');
  assert.equal(a.label, '2 mentions');
  assert.equal(a.bg, '#FFE2E2');
  assert.equal(a.fg, '#B23A52');
});

test('a single mention reads singular', () => {
  assert.equal(packageAttention(pkg({ mentions: 1 })).label, '1 mention');
});

test('an unseen version with no mentions is a new-version pill', () => {
  const a = packageAttention(pkg({ mentions: 0, seenLatest: false, versionNumber: 3 }));
  assert.equal(a.kind, 'new_version');
  assert.equal(a.label, 'New version');
  assert.equal(a.bg, '#FFFCCE');
  assert.equal(a.fg, '#7A5E00');
});

test('a package with no version cannot carry a new-version pill', () => {
  assert.equal(
    packageAttention(pkg({ mentions: 0, seenLatest: false, versionNumber: null })),
    null
  );
});

test('the project pill is the first attention-carrying package', () => {
  const a = projectAttention([
    pkg({ id: 'a', mentions: 0, seenLatest: true }),
    pkg({ id: 'b', mentions: 0, seenLatest: false, versionNumber: 2 }),
    pkg({ id: 'c', mentions: 5 }),
  ]);
  assert.equal(a.kind, 'new_version');
});

test('a project where nothing needs you has no pill', () => {
  assert.equal(projectAttention([pkg({ mentions: 0, seenLatest: true })]), null);
});

test('a project with no packages has no pill', () => {
  assert.equal(projectAttention([]), null);
});
```

Extend the import at the top of the same file:

```javascript
import {
  deriveMyRole,
  projectPeople,
  groupProjects,
  filterGroups,
  showFilterRow,
  needsYou,
  homeStats,
  packageAttention,
  projectAttention,
} from '../../lib/home.ts';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --test-name-pattern='attention|pill'`
Expected: FAIL — `packageAttention is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/home.ts`, directly after `needsYou`:

```typescript
export interface Attention {
  kind: 'mention' | 'new_version';
  /** Sentence case; the pill uppercases it in CSS. */
  label: string;
  bg: string;
  fg: string;
}

/**
 * The personal attention pill for one package — a fact about YOU, so it is a
 * SOLID pastel pill, never the outlined chip that states the work's status.
 *
 * Gated on the same `needsYou` predicate the header subline and the rail's
 * stat tiles count with, so a pill and a count can never disagree.
 */
export function packageAttention(pkg: PackageCard): Attention | null {
  if (!needsYou(pkg)) return null;

  if (pkg.mentions > 0) {
    return {
      kind: 'mention',
      label: `${pkg.mentions} mention${pkg.mentions === 1 ? '' : 's'}`,
      bg: '#FFE2E2',
      fg: '#B23A52',
    };
  }

  return { kind: 'new_version', label: 'New version', bg: '#FFFCCE', fg: '#7A5E00' };
}

/**
 * One pill for a whole project: the first attention-carrying package wins.
 *
 * "First" means first in the project's own package order, which /api/home
 * returns in recency order — so the pill describes the most recent thing that
 * wants the viewer, which is what a collapsed row should surface.
 */
export function projectAttention(pkgs: PackageCard[]): Attention | null {
  for (const pkg of pkgs) {
    const attention = packageAttention(pkg);
    if (attention) return attention;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — every test in `home.test.mjs`, and no regression elsewhere.

- [ ] **Step 5: Commit**

```bash
git add lib/home.ts scripts/tests/home.test.mjs
git commit -m "feat: derive package and project attention pills in lib/home"
```

---

### Task 2: Design tokens and keyframes

Three values in the design have no home in the config. Add them before any component references them, so no task is tempted to inline a hex.

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `bg-stiko-wash` (`#FBFCFF`), `shadow-stiko-lift`, and the `.stiko-panel-in` / `.stiko-row-in` animation classes.

- [ ] **Step 1: Add the colour and shadow tokens**

In `tailwind.config.ts`, inside `colors.stiko`, directly after the `subtle` line:

```typescript
          subtle: "#F6F8FE",
          // One step above the field and one below white: the column header
          // strip and the expansion behind package rows. Previously only
          // existed inside the stiko-hatch gradient.
          wash: "#FBFCFF",
```

In the same file, inside `boxShadow`, after `"stiko-card"`:

```typescript
        "stiko-lift": "0 6px 14px -6px rgba(28,32,48,0.2)",
```

- [ ] **Step 2: Add the keyframes**

Append to `app/globals.css`:

```css
/* Dashboard disclosure. The expansion panel fades down into place and its
   package rows fade up — opposite directions on purpose, so the panel reads as
   a surface arriving and the rows as content settling onto it. */
@keyframes stikoPanelIn {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes stikoRowIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.stiko-panel-in {
  animation: stikoPanelIn 240ms cubic-bezier(0.4, 0, 0.2, 1);
}

.stiko-row-in {
  animation: stikoRowIn 260ms ease both;
}

/* Movement is decoration here — every one of these states is also carried by a
   colour or a layout change, so dropping the motion loses nothing. */
@media (prefers-reduced-motion: reduce) {
  .stiko-panel-in,
  .stiko-row-in {
    animation: none;
  }
  .stiko-motion {
    transition: none !important;
  }
  .stiko-motion:hover {
    transform: none !important;
  }
}
```

- [ ] **Step 3: Verify the build picks the tokens up**

Run: `npx tsc --noEmit`
Expected: PASS, no output.

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.ts app/globals.css
git commit -m "feat: add wash colour, lift shadow and disclosure keyframes"
```

---

### Task 3: The package row

The row inside an expansion. Same content as today's `CardPackageRow`, re-laid-out from two stacked lines into one row of fixed-width cells.

**Files:**
- Create: `components/home/PackageListRow.tsx`

**Interfaces:**
- Consumes: `packageAttention(pkg)` from Task 1; `STATUS_ACCENT` / `StatusChip` / `AttentionPill` as they exist today.
- Produces: `export function PackageListRow({ pkg }: { pkg: PackageCard })`

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { AttentionPill, StatusChip } from '@/components/ui/Primitives';
import { STATUS_ACCENT } from '@/lib/status';
import { relativeTime } from '@/lib/design';
import { packageAttention } from '@/lib/home';
import type { PackageCard } from '@/lib/queries';

/**
 * A package inside its project's expansion.
 *
 * Single row of fixed-width cells rather than the two stacked lines the old
 * card used: inside an expansion the package's siblings are directly above and
 * below it, so the eye scans a column and the columns have to line up.
 */
export function PackageListRow({ pkg }: { pkg: PackageCard }) {
  const router = useRouter();

  const meta =
    pkg.versionNumber == null
      ? 'No files yet — add some'
      : [
          `V${pkg.versionNumber}`,
          pkg.changelog ? `"${pkg.changelog}"` : null,
          pkg.updatedAt ? relativeTime(pkg.updatedAt) : null,
        ]
          .filter(Boolean)
          .join(' · ');

  const count =
    pkg.openComments > 0
      ? `${pkg.openComments} open`
      : pkg.fileCount > 0
        ? `${pkg.fileCount} ${pkg.fileCount === 1 ? 'file' : 'files'}`
        : 'empty';

  const attention = packageAttention(pkg);

  return (
    <button
      onClick={() => router.push(`/portal/${pkg.id}`)}
      className="stiko-motion stiko-row-in flex items-center gap-3 rounded-[10px] bg-white px-3 py-[11px] text-left shadow-stiko-panel transition-[transform,box-shadow] duration-[160ms] ease-[cubic-bezier(.34,1.3,.64,1)] hover:translate-x-[3px] hover:shadow-stiko-lift"
      style={{ borderLeft: `3px solid ${STATUS_ACCENT[pkg.status]}` }}
    >
      <span
        className="truncate text-[13px] font-bold text-stiko-ink"
        style={{ flex: '1 1 200px', minWidth: 170 }}
      >
        {pkg.name}
      </span>

      <span className="w-[200px] shrink-0 truncate text-[11px] text-stiko-muted">
        {meta}
      </span>

      {pkg.versionNumber != null && (
        <span className="shrink-0">
          <StatusChip status={pkg.status} />
        </span>
      )}

      {attention && (
        <span className="shrink-0">
          <AttentionPill
            label={attention.label}
            bg={attention.bg}
            fg={attention.fg}
          />
        </span>
      )}

      <span
        className="w-[62px] shrink-0 text-right text-[11px] font-extrabold"
        style={{ color: pkg.openComments > 0 ? '#B23A52' : '#8A90A6' }}
      >
        {count}
      </span>

      <svg
        className="h-[13px] w-[13px] shrink-0 text-stiko-ghost"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/home/PackageListRow.tsx
git commit -m "feat: add the package row for the dashboard list"
```

---

### Task 4: The project row and column header

The collapsed row plus its expansion. The structure here is deliberate and easy to get wrong — read the comment in the code.

**Files:**
- Create: `components/home/ProjectListRow.tsx`
- Create: `components/home/ProjectListHeader.tsx`

**Interfaces:**
- Consumes: `PackageListRow` (Task 3); `projectAttention` (Task 1); `ProjectGroup` from `lib/home`.
- Produces:
  - `export function ProjectListHeader()` — no props.
  - `export function ProjectListRow({ group, expanded, onToggle, onOpenPeople }: { group: ProjectGroup; expanded: boolean; onToggle: (id: string) => void; onOpenPeople: (id: string) => void })`

- [ ] **Step 1: Write the column header**

`components/home/ProjectListHeader.tsx`:

```tsx
/**
 * The list's column header. Its cell widths must match ProjectListRow's
 * exactly — they are a single visual grid split across two components, and
 * nothing enforces the match but this comment.
 */
export function ProjectListHeader() {
  return (
    <div className="box-border flex min-w-[760px] items-center gap-3 border-b border-stiko-divider bg-stiko-wash px-[14px] py-[9px] text-[10px] font-bold uppercase tracking-label text-stiko-faint">
      <span className="w-[13px] shrink-0" />
      <span style={{ flex: '1 1 340px', minWidth: 300 }}>Project</span>
      <span className="w-[84px] shrink-0 text-right">Packages</span>
      <span className="w-[200px] shrink-0 text-right">Open</span>
      <span className="w-[96px] shrink-0 text-right">People</span>
    </div>
  );
}
```

- [ ] **Step 2: Write the project row**

`components/home/ProjectListRow.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { AvatarStack, AttentionPill } from '@/components/ui/Primitives';
import { PackageListRow } from '@/components/home/PackageListRow';
import { projectAttention } from '@/lib/home';
import { roleLabel } from '@/lib/roles';
import type { ProjectGroup } from '@/lib/home';

/**
 * One project in the list.
 *
 * Structure note, because the obvious version is invalid HTML: the whole row
 * reads as one click target, but the People cell holds its own button (the
 * people drawer). A button inside a button does not nest — browsers hoist the
 * inner one out and the click targets come apart. So the toggle is an
 * absolutely-positioned button filling the row, the cells sit above it in a
 * pointer-events-none layer, and only the People cell re-enables pointer
 * events for its own button. Hover lives on the wrapper so it still covers the
 * whole row.
 */
export function ProjectListRow({
  group,
  expanded,
  onToggle,
  onOpenPeople,
}: {
  group: ProjectGroup;
  expanded: boolean;
  onToggle: (id: string) => void;
  onOpenPeople: (id: string) => void;
}) {
  const router = useRouter();
  const { project, packages, packageCount, openComments, people } = group;

  const attention = projectAttention(packages);

  // `myRole === 'coordinator'` is safe as a permission signal because
  // participants.role is CHECK-constrained to viewer|commenter|uploader, so
  // coordinator can only have come from a project_members row.
  const canManage = project.ownedByMe || project.myRole === 'coordinator';

  return (
    <div className="box-border min-w-[760px] border-b border-stiko-border">
      <div
        className={`group relative transition-colors duration-[160ms] ${
          expanded ? 'bg-stiko-app' : 'bg-white hover:bg-stiko-app'
        }`}
      >
        <button
          type="button"
          onClick={() => onToggle(project.id)}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`}
          className="absolute inset-0 h-full w-full"
        />

        <div className="pointer-events-none relative flex items-center gap-3 px-[14px] py-[13px]">
          <svg
            className="h-[13px] w-[13px] shrink-0 text-stiko-muted transition-transform duration-[220ms] ease-[cubic-bezier(.4,0,.2,1)]"
            style={{ transform: `rotate(${expanded ? 90 : 0}deg)` }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>

          <span
            className="flex items-center gap-2"
            style={{ flex: '1 1 340px', minWidth: 300 }}
          >
            <span
              className="truncate text-[14px] font-extrabold tracking-heading text-stiko-ink"
              style={{ flex: '1 1 auto', minWidth: 120 }}
            >
              {project.name}
            </span>
            <RoleChip ownedByMe={project.ownedByMe} myRole={project.myRole} />
          </span>

          <span className="w-[84px] shrink-0 text-right text-[11.5px] font-bold text-stiko-secondary">
            {packageCount === 1 ? '1 package' : `${packageCount} packages`}
          </span>

          <span className="flex w-[200px] shrink-0 items-center justify-end gap-2">
            {attention && (
              <AttentionPill
                label={attention.label}
                bg={attention.bg}
                fg={attention.fg}
              />
            )}
            <span
              className="whitespace-nowrap text-[11.5px] font-bold"
              style={{ color: openComments > 0 ? '#B23A52' : '#8A90A6' }}
            >
              {openComments === 0
                ? 'Nothing open'
                : `${openComments} open ${openComments === 1 ? 'comment' : 'comments'}`}
            </span>
          </span>

          <span className="flex w-[96px] shrink-0 justify-end">
            {people.length > 0 && (
              <button
                type="button"
                title="People on this project"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenPeople(project.id);
                }}
                className="pointer-events-auto rounded-pill"
              >
                <AvatarStack people={people} size={24} />
              </button>
            )}
          </span>
        </div>
      </div>

      {expanded && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="stiko-panel-in flex flex-col gap-[6px] bg-stiko-wash pb-[14px] pl-[34px] pr-[14px] pt-[10px]"
        >
          {packages.map((pkg) => (
            <PackageListRow key={pkg.id} pkg={pkg} />
          ))}

          {packages.length === 0 && (
            <p className="px-1 py-2 text-[11.5px] text-stiko-muted">
              No packages in this project yet.
            </p>
          )}

          {canManage && (
            <button
              type="button"
              onClick={() => router.push(`/new?project=${project.id}`)}
              className="flex w-full items-center justify-center gap-[6px] rounded-[10px] border-[1.5px] border-dashed border-stiko-border-strong p-[10px] text-[11.5px] font-bold text-stiko-muted transition-[border-color,color] duration-150 hover:border-stiko-primary hover:text-stiko-primary"
            >
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.8}
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add a package
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Solid for owner, outlined for invited — solid pills are facts about YOU. */
function RoleChip({
  ownedByMe,
  myRole,
}: {
  ownedByMe: boolean;
  myRole: string | null;
}) {
  if (ownedByMe) {
    return (
      <span
        className="shrink-0 whitespace-nowrap rounded-pill border-[1.5px] border-transparent bg-note-purple px-2 py-[3px] text-[9.5px] font-extrabold uppercase text-note-purple-text"
        style={{ letterSpacing: '0.04em' }}
      >
        Owner
      </span>
    );
  }

  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-pill border-[1.5px] border-stiko-chip-grey bg-white px-2 py-[3px] text-[9.5px] font-extrabold uppercase text-stiko-muted"
      style={{ letterSpacing: '0.04em' }}
    >
      {myRole ? `Invited · ${roleLabel(myRole)}` : 'Invited'}
    </span>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/home/ProjectListRow.tsx components/home/ProjectListHeader.tsx
git commit -m "feat: add the project list row and column header"
```

---

### Task 5: Split the activity rail

`ActivityRail` becomes the animating wrapper; its current body becomes `ActivityFeedPanel`. This task also fixes a live inconsistency: the rail's stat tiles count **all** packages while the page subline counts the **filtered** ones, so filtering to "Owned by me" leaves the two disagreeing.

**Files:**
- Create: `components/home/ActivityFeedPanel.tsx`
- Modify: `components/home/ActivityRail.tsx`

**Interfaces:**
- Produces:
  - `export default function ActivityFeedPanel({ notifications, packages, onChanged, onCollapse }: { notifications: NotificationRow[]; packages: PackageCard[]; onChanged: () => void; onCollapse: () => void })` — `packages` must be the **filtered** set.
  - `ActivityRail` keeps its default export and gains `railOpen: boolean`, `summary: React.ReactNode`, `onCollapse: () => void`.

- [ ] **Step 1: Create the feed panel**

Create `components/home/ActivityFeedPanel.tsx` with the entire current contents of `components/home/ActivityRail.tsx`, then apply these four changes:

1. Rename the function `ActivityRail` → `ActivityFeedPanel`.
2. Add `onCollapse: () => void` to the props type and destructuring.
3. Replace the outer `<aside …>` opening tag with:

```tsx
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel bg-white shadow-stiko-panel">
```

and its closing `</aside>` with `</section>`.

4. Replace the header block (currently the `<div>` containing the `h2`, subline and "Mark all read") with:

```tsx
      <div className="flex shrink-0 items-center justify-between gap-[10px] border-b border-stiko-border px-4 py-[14px]">
        <div className="min-w-0">
          <h2 className="text-[15px] font-extrabold text-stiko-ink">Activity</h2>
          <p className="mt-[2px] text-[11.5px] text-stiko-muted">
            Everything, newest first
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasUnread && (
            <button
              onClick={markAll}
              className="text-[11.5px] font-bold text-stiko-primary transition duration-150"
            >
              Mark all read
            </button>
          )}
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Hide activity"
            className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-stiko-app text-stiko-muted transition duration-150 hover:bg-stiko-idle hover:text-stiko-ink"
          >
            <svg
              className="h-[13px] w-[13px]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
```

Also add `shrink-0` to the stat-tile grid's class list, and change the feed scroller's classes to `min-h-0 flex-1 overflow-y-auto px-3 pb-[14px] pt-[6px]` — the panel now always has a bounded height from its flex parent, so the `lg:` escape hatches the old rail needed are gone.

- [ ] **Step 2: Rewrite ActivityRail as the wrapper**

Replace the whole of `components/home/ActivityRail.tsx` with:

```tsx
'use client';

import React from 'react';
import ActivityFeedPanel from '@/components/home/ActivityFeedPanel';
import type { NotificationRow } from '@/components/shell/NotificationTray';
import type { PackageCard } from '@/lib/queries';

/**
 * The right-hand rail: an AI summary panel stacked over the activity feed.
 *
 * The wrapper animates its width while the inner column stays a fixed 344px —
 * that is what stops the feed's contents from reflowing on every frame of the
 * open/close. Below lg the rail is a full-width block stacked under the project
 * list instead, and hiding it is a plain unmount: animating a width on a
 * stacked block animates nothing the user can see, and the fixed inner width
 * would overflow a phone.
 */
export default function ActivityRail({
  notifications,
  packages,
  railOpen,
  summary,
  onChanged,
  onCollapse,
}: {
  notifications: NotificationRow[];
  /** The FILTERED package set — the stat tiles must match the page subline. */
  packages: PackageCard[];
  railOpen: boolean;
  summary: React.ReactNode;
  onChanged: () => void;
  onCollapse: () => void;
}) {
  if (!railOpen) return null;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="stiko-motion w-full shrink-0 overflow-hidden transition-[width,opacity] duration-[340ms] ease-[cubic-bezier(.4,0,.2,1)] lg:h-full lg:w-[356px]"
    >
      <aside className="flex h-full w-full flex-col overflow-hidden lg:w-[344px]">
        {summary}
        <ActivityFeedPanel
          notifications={notifications}
          packages={packages}
          onChanged={onChanged}
          onCollapse={onCollapse}
        />
      </aside>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: one error in `app/page.tsx` — `ActivityRail` is missing the new required props. Task 7 fixes it. Nothing else.

- [ ] **Step 4: Commit**

```bash
git add components/home/ActivityRail.tsx components/home/ActivityFeedPanel.tsx
git commit -m "refactor: split the activity rail into wrapper and feed panel"
```

---

### Task 6: The AI summary panel

Panel A. It owns its own fetching, caches per project, and has three real states — there is no fourth "spinner forever" state, because generating a summary is a ~30 second call the user has to opt into.

**Files:**
- Create: `components/home/ProjectSummaryPanel.tsx`

**Interfaces:**
- Consumes: `GET|POST /api/projects/{id}/summary`, which returns `{ enabled: boolean; configured: boolean; brief: { headline: string; sections: { portalId: string; body: string; versionIds: string[] }[] } | null; generatedAt: string | null; stale: boolean }`.
- Produces: `export default function ProjectSummaryPanel({ group, open, onClose }: { group: ProjectGroup | null; open: boolean; onClose: () => void })`

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { STATUS_ACCENT } from '@/lib/status';
import { relativeTime } from '@/lib/design';
import type { ProjectGroup } from '@/lib/home';

interface Section {
  portalId: string;
  body: string;
  versionIds: string[];
}

interface SummaryResponse {
  enabled: boolean;
  configured: boolean;
  brief: { headline: string; sections: Section[] } | null;
  generatedAt: string | null;
  stale?: boolean;
}

/**
 * Panel A — the project's AI summary.
 *
 * `group` is the LAST selected project, not the current one: it must keep
 * rendering the outgoing project's content for the whole close animation, or
 * the panel visibly empties on the way down. `open` alone drives the geometry.
 *
 * Summaries are generated on demand (a ~30s model call), so a project that has
 * never been summarised shows a button rather than a spinner. Firing the
 * generation automatically on select would mean a half-minute wait and a paid
 * call for every row the user clicks through.
 */
export default function ProjectSummaryPanel({
  group,
  open,
  onClose,
}: {
  group: ProjectGroup | null;
  open: boolean;
  /** Deselects the project. The ✕ does NOT merely hide this panel — leaving
   *  the row expanded under a dismissed summary is two states for one fact. */
  onClose: () => void;
}) {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-selecting a project the user already looked at must not re-fetch, and a
  // fast run down the list must not leave a slow response overwriting a fast
  // one — hence the cache and the abort.
  const cache = useRef(new Map<string, SummaryResponse>());
  const inflight = useRef<AbortController | null>(null);

  const projectId = group?.project.id ?? null;

  useEffect(() => {
    if (!projectId || !open) return;

    const cached = cache.current.get(projectId);
    if (cached) {
      setData(cached);
      setError(null);
      return;
    }

    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;

    setData(null);
    setError(null);

    fetch(`/api/projects/${projectId}/summary`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: SummaryResponse | null) => {
        if (controller.signal.aborted || !body) return;
        cache.current.set(projectId, body);
        setData(body);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Couldn’t load the summary.');
      });

    return () => controller.abort();
  }, [projectId, open]);

  const generate = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/summary`, {
        method: 'POST',
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Couldn’t write a summary.');
      } else {
        cache.current.set(projectId, body);
        setData(body);
      }
    } catch {
      setError('Couldn’t reach the server.');
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  // Switched off for this project: the panel is absent, not empty. The feed
  // below simply takes the whole rail.
  const visible = open && Boolean(group) && data?.enabled !== false;

  return (
    <div
      className="stiko-motion shrink-0 overflow-hidden transition-[max-height,opacity,margin-bottom,transform] duration-[380ms] ease-[cubic-bezier(.32,.72,0,1)]"
      style={{
        maxHeight: visible ? 328 : 0,
        opacity: visible ? 1 : 0,
        marginBottom: visible ? 12 : 0,
        transform: visible ? 'none' : 'translateY(-10px)',
      }}
      aria-hidden={!visible}
    >
      <section className="flex h-[328px] flex-col overflow-hidden rounded-panel border-[1.5px] border-stiko-divider bg-white shadow-stiko-panel">
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-stiko-border px-4 py-[13px]">
          <div className="min-w-0">
            <div className="flex items-center gap-[7px]">
              <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-chip bg-gradient-to-br from-[#8094F5] to-[#5B60FF] text-[9px] font-extrabold text-white">
                AI
              </span>
              <h2 className="text-[14px] font-extrabold text-stiko-ink">
                Project summary
              </h2>
            </div>
            <p className="mt-[3px] truncate text-[11.5px] font-bold text-stiko-primary">
              {group?.project.name ?? ''}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close the summary and deselect the project"
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] bg-stiko-app text-stiko-muted transition duration-150 hover:bg-stiko-idle hover:text-stiko-ink"
          >
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[14px] pt-3">
          {error ? (
            <p className="text-[12px] text-note-red-text">{error}</p>
          ) : data?.brief ? (
            <Brief brief={data.brief} group={group} generatedAt={data.generatedAt} />
          ) : data ? (
            <div>
              <p className="text-[12.5px] leading-[1.55] text-stiko-secondary">
                {data.configured
                  ? 'No summary yet. Stiko can read this project’s comments and versions and write one.'
                  : 'Summaries aren’t configured for this deployment.'}
              </p>
              {data.configured && (
                <button
                  type="button"
                  onClick={generate}
                  disabled={busy}
                  className="mt-3 rounded-[10px] bg-gradient-to-br from-[#8094F5] to-[#5B60FF] px-[14px] py-2 text-[12.5px] font-bold text-white shadow-stiko-primary transition duration-150 hover:brightness-[1.04] disabled:opacity-50"
                >
                  {busy ? 'Writing…' : 'Summarise this project'}
                </button>
              )}
              {busy && (
                <p className="mt-2 text-[10.5px] text-stiko-faint">
                  This takes about half a minute.
                </p>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-stiko-faint">Loading…</p>
          )}
        </div>
      </section>
    </div>
  );
}

function Brief({
  brief,
  group,
  generatedAt,
}: {
  brief: { headline: string; sections: Section[] };
  group: ProjectGroup | null;
  generatedAt: string | null;
}) {
  // The accent is the package's REAL derived status, never something the model
  // chose — the palette has to keep meaning what it means everywhere else.
  const statusOf = (portalId: string) =>
    group?.packages.find((p) => p.id === portalId)?.status ?? 'draft';

  const nameOf = (portalId: string) =>
    group?.packages.find((p) => p.id === portalId)?.name ?? 'A package';

  const versions = new Set(brief.sections.flatMap((s) => s.versionIds)).size;

  return (
    <>
      <p
        className="text-[12.5px] leading-[1.55] text-stiko-ink"
        style={{ textWrap: 'pretty' }}
      >
        {brief.headline}
      </p>

      <div className="flex flex-col gap-[10px] pt-3">
        {brief.sections.map((section) => (
          <div key={section.portalId} className="flex gap-[9px]">
            <span
              className="w-[3px] shrink-0 rounded-full"
              style={{ background: STATUS_ACCENT[statusOf(section.portalId)] }}
            />
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-label text-stiko-faint">
                {nameOf(section.portalId)}
              </div>
              <p
                className="text-[12px] leading-[1.5] text-stiko-secondary"
                style={{ textWrap: 'pretty' }}
              >
                {section.body}
              </p>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-[14px] text-[10.5px] text-stiko-faint">
        Drafted from {brief.sections.length}{' '}
        {brief.sections.length === 1 ? 'package' : 'packages'} and {versions}{' '}
        {versions === 1 ? 'version' : 'versions'}
        {generatedAt ? ` · updated ${relativeTime(generatedAt)}` : ''}
      </p>
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: the `app/page.tsx` error from Task 5 only.

- [ ] **Step 3: Commit**

```bash
git add components/home/ProjectSummaryPanel.tsx
git commit -m "feat: add the AI project summary panel"
```

---

### Task 7: Rewire the dashboard

The screen itself. This is where the three pieces of state live, where the bell becomes the rail toggle, and where `ProjectCard` stops being rendered.

**Files:**
- Modify: `app/page.tsx`
- Create: `components/shell/RailToggle.tsx`
- Modify: `components/shell/NotificationTray.tsx`
- Delete: `components/home/ProjectCard.tsx`, `components/home/CardPackageRow.tsx`

**Interfaces:**
- Consumes: everything produced by Tasks 3–6.
- Produces: `export default function RailToggle({ open, hasUnread, onToggle }: { open: boolean; hasUnread: boolean; onToggle: () => void })`

- [ ] **Step 1: Write the rail toggle**

`components/shell/RailToggle.tsx`:

```tsx
'use client';

/**
 * The header bell. It no longer opens a tray — it shows and hides the activity
 * rail, which is the same information without a second surface to maintain.
 *
 * The unread dot appears ONLY while the rail is hidden: with the rail open the
 * feed itself is the indicator, and a dot over a visible list of unread items
 * is noise.
 */
export default function RailToggle({
  open,
  hasUnread,
  onToggle,
}: {
  open: boolean;
  hasUnread: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={open ? 'Hide activity' : 'Show activity'}
      aria-pressed={open}
      className={`relative flex h-9 w-9 items-center justify-center rounded-[10px] transition duration-150 ${
        open
          ? 'bg-stiko-tint text-stiko-primary'
          : 'text-stiko-muted hover:bg-stiko-app hover:text-stiko-ink'
      }`}
    >
      <svg
        className="h-[17px] w-[17px]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
      </svg>
      {!open && hasUnread && (
        <span className="absolute right-[7px] top-[7px] h-[7px] w-[7px] rounded-full bg-note-red-accent ring-2 ring-white" />
      )}
    </button>
  );
}
```

- [ ] **Step 2: Reduce NotificationTray to its type**

Replace the whole of `components/shell/NotificationTray.tsx` with:

```tsx
/**
 * The notification tray's popover is gone — the header bell now toggles the
 * activity rail, which shows the same rows with more room and no second
 * surface to keep in sync.
 *
 * This file survives for the row shape, which /api/notifications returns and
 * both the rail and the feed panel consume.
 */
export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  excerpt: string | null;
  href: string;
  createdAt: string;
  readAt: string | null;
  portalId: string | null;
  packageName: string | null;
  projectId: string | null;
  projectName: string | null;
  actorId: string | null;
  actorName: string | null;
}
```

- [ ] **Step 3: Rewire the page**

In `app/page.tsx`, replace the import block (lines 5–26) with:

```tsx
import EmptyState from '@/components/ui/EmptyState';
import { Column, Shell, TopBar } from '@/components/ui/Shell';
import { ProjectListRow } from '@/components/home/ProjectListRow';
import { ProjectListHeader } from '@/components/home/ProjectListHeader';
import NewProjectModal from '@/components/home/NewProjectModal';
import ProjectPeopleDrawer from '@/components/home/ProjectPeopleDrawer';
import { HomeError, HomeSkeleton } from '@/components/home/HomeStates';
import type { NotificationRow } from '@/components/shell/NotificationTray';
import ActivityRail from '@/components/home/ActivityRail';
import ProjectSummaryPanel from '@/components/home/ProjectSummaryPanel';
import RailToggle from '@/components/shell/RailToggle';
import AvatarMenu from '@/components/shell/AvatarMenu';
import CommandPalette from '@/components/shell/CommandPalette';
import { DISCLOSURE, type DisclosureState } from '@/lib/disclosure';
import {
  filterGroups,
  groupProjects,
  needsYou,
  showFilterRow,
  type HomeFilter,
} from '@/lib/home';
import type { PackageCard, ProjectSummary } from '@/lib/queries';
import { useSession } from 'next-auth/react';
```

Add the three new state hooks after `const [newProjectOpen, setNewProjectOpen] = useState(false);`:

```tsx
  const [expanded, setExpanded] = useState<string | null>(null);
  // The last non-null selection, so the summary panel keeps its content for
  // the whole close animation instead of flashing empty on the way down.
  const [lastId, setLastId] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);

  // Read from localStorage in an effect, never as the initial state: this
  // component is still server-rendered, and a value the server cannot see
  // would make the first client render disagree with the HTML.
  useEffect(() => {
    const stored = window.localStorage.getItem('stiko.railOpen');
    if (stored !== null) setRailOpen(stored === 'true');
  }, []);

  const toggleRail = useCallback(() => {
    setRailOpen((v) => {
      window.localStorage.setItem('stiko.railOpen', String(!v));
      return !v;
    });
  }, []);

  const toggleProject = useCallback((id: string) => {
    setExpanded((current) => (current === id ? null : id));
    setLastId(id);
    // Forced open, never forced closed: otherwise the summary panel would
    // animate open behind a hidden rail. The user's own choice to hide the
    // rail is never overridden in the other direction.
    setRailOpen(true);
    window.localStorage.setItem('stiko.railOpen', 'true');
  }, []);
```

Replace the `topBarRight` bell block — swap `<NotificationTray notifications={notifications} onChanged={load} />` for:

```tsx
      {showBell && (
        <RailToggle
          open={railOpen}
          hasUnread={notifications.some((n) => !n.readAt)}
          onToggle={toggleRail}
        />
      )}
```

Replace everything from `const visiblePackages = …` through the closing `</div>` of the content row with:

```tsx
  const visiblePackages = visible.flatMap((g) => g.packages);
  const needsYouCount = visiblePackages.filter(needsYou).length;
  const subline = [
    `${visible.length} ${visible.length === 1 ? 'project' : 'projects'}`,
    `${visiblePackages.length} ${visiblePackages.length === 1 ? 'package' : 'packages'}`,
    needsYouCount > 0 ? `${needsYouCount} need you` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const summaryGroup = groups.find((g) => g.project.id === lastId) ?? null;

  return (
    <Shell>
      <TopBar right={topBarRight} />

      {/* Clicking the page background deselects. Everything that would be
          closing the thing you just clicked inside of — the expansion panel,
          the rail, the header's own controls — stops the event itself. */}
      <div
        onClick={() => setExpanded(null)}
        className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-1 lg:flex-row lg:gap-3 lg:overflow-visible"
      >
        {/* flex-none (not flex-1) below lg: this is a flex column here, and
            the rail is shrink-0 with a content-driven height — once the rail's
            content is taller than this row (a handful of notifications is
            enough on a phone), flex-1's flex-basis:0% has nothing to grow into
            and the column collapses to 0px, rendering the list UNDER the rail
            instead of above it. flex-none makes this column size to its own
            content. lg:flex-1 restores fill-remaining-space once the layout is
            a row. */}
        <div className="min-h-0 flex-none lg:flex-1 lg:overflow-y-auto lg:pr-2">
          <div className="flex flex-wrap items-end justify-between gap-4 px-[2px] pb-3 pt-[2px]">
            <div>
              <h1 className="text-[20px] font-extrabold tracking-title text-stiko-ink">
                Your projects
              </h1>
              <p className="mt-[3px] text-[12.5px] text-stiko-muted">{subline}</p>
              {/* The only place in the product that states this contract to an
                  invited-only user: they never publish, so the sole signal
                  that a new version exists is the email that goes out when
                  one is pushed. */}
              {isGuestOnly && (
                <p className="mt-[3px] text-[12.5px] text-stiko-muted">
                  You&apos;ll get an email whenever a new version lands.
                </p>
              )}
            </div>

            <div
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-[6px]"
            >
              {showFilterRow(groups) && (
                <>
                  {(
                    [
                      ['all', 'All'],
                      ['owned', 'Owned by me'],
                      ['shared', 'Shared with me'],
                    ] as [HomeFilter, string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setFilter(key)}
                      className={`rounded-[9px] border-[1.5px] px-[11px] py-[6px] text-[12px] font-bold transition duration-150 ${
                        filter === key
                          ? 'border-stiko-border-strong bg-white text-stiko-ink'
                          : 'border-transparent bg-transparent text-stiko-muted hover:text-stiko-ink'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <span
                    className="bg-stiko-divider"
                    style={{ width: 1, height: 20, margin: '0 4px' }}
                  />
                </>
              )}

              <button
                onClick={() => setNewProjectOpen(true)}
                className="flex items-center gap-[6px] rounded-[10px] bg-gradient-to-br from-[#8094F5] to-[#5B60FF] px-[14px] py-2 text-[12.5px] font-bold text-white shadow-stiko-primary transition duration-150 hover:brightness-[1.04]"
              >
                <svg
                  className="h-[13px] w-[13px]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.8}
                  strokeLinecap="round"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New project
              </button>
            </div>
          </div>

          {/* overflow-x on the container with min-w on every child: below
              760px the list scrolls sideways rather than crushing the project
              name. Every child carries box-border too — a mixed box model here
              drifts the columns out of alignment and stops the row dividers
              short of the row edge once scrolled. */}
          <div className="overflow-x-auto overflow-y-hidden rounded-panel border border-stiko-sheet bg-white shadow-stiko-panel">
            <ProjectListHeader />
            {visible.map((group) => (
              <ProjectListRow
                key={group.project.id}
                group={group}
                expanded={expanded === group.project.id}
                onToggle={toggleProject}
                onOpenPeople={setPeoplePanelProjectId}
              />
            ))}
          </div>
        </div>

        {notifications.length > 0 && (
          <ActivityRail
            notifications={notifications}
            packages={visiblePackages}
            railOpen={railOpen}
            onChanged={load}
            onCollapse={toggleRail}
            summary={
              <ProjectSummaryPanel
                group={summaryGroup}
                open={expanded !== null}
                onClose={() => setExpanded(null)}
              />
            }
          />
        )}
      </div>
```

- [ ] **Step 4: Delete the superseded components**

```bash
git rm components/home/ProjectCard.tsx components/home/CardPackageRow.tsx
```

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS on both, no output from tsc.

- [ ] **Step 6: Verify in a browser**

Run: `npm run dev`, open the dashboard signed in, and confirm each of:
- A project row expands on click, caret rotates, packages fade in.
- Three routes deselect and all behave identically: clicking the expanded row again, the summary panel's ✕, and the page background. Clicking a filter button, the rail, or inside an expansion does **not**.
- The bell hides and shows the rail; the unread dot appears only while hidden.
- Reloading the page keeps the rail in the state you left it.
- Filtering to "Owned by me" changes the subline **and** the three stat tiles together.
- Narrowing the window below 760px scrolls the list sideways; below `lg` the rail stacks underneath the list, not over it.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx components/shell/RailToggle.tsx components/shell/NotificationTray.tsx
git commit -m "feat: rebuild the dashboard as a project list with a split rail"
```

---

### Task 8: Move the overview types out of the page

`ProjectPeopleDrawer` and `TeamMatrix` both import `ProjectPackage` from `app/project/[id]/page.tsx`. Move the types first so deleting that page in Task 10 is a clean removal.

**Files:**
- Create: `lib/projectOverview.ts`
- Modify: `app/project/[id]/page.tsx`, `components/home/ProjectPeopleDrawer.tsx`, `components/people/TeamMatrix.tsx`

**Interfaces:**
- Produces: `ProjectPerson`, `ProjectPackage`, `ProjectOverview` from `lib/projectOverview.ts`.

- [ ] **Step 1: Create the module**

```typescript
import type { VersionStatus } from './status';

/**
 * The shapes /api/projects/[id]/overview returns.
 *
 * These lived on the project page until the dashboard absorbed it. They are
 * here rather than in lib/queries because nothing under test imports them and
 * lib/queries pulls a database connection at module load.
 */

export interface ProjectPerson {
  id: string;
  name: string;
  email: string;
  company: string | null;
  role: string;
  verdict: string | null;
  viewedAt: string | null;
  commentCount: number;
  lastCommentAt: string | null;
}

export interface ProjectPackage {
  id: string;
  name: string;
  tag: string | null;
  versionNumber: number | null;
  changelog: string | null;
  publishedAt: string | null;
  updatedByName: string | null;
  fileCount: number;
  openComments: number;
  status: VersionStatus;
  people: ProjectPerson[];
  pending: {
    email: string;
    role: string;
    createdAt: string;
    expiresAt: string;
  }[];
}

export interface ProjectOverview {
  project: { id: string; name: string; createdAt: string };
  members: {
    id: string;
    name: string;
    email: string;
    company: string | null;
    role: string;
    isYou: boolean;
  }[];
  packages: ProjectPackage[];
  /** Every portal under the project, ARCHIVED INCLUDED — the delete gate. */
  totalPackageCount: number;
  disclosure: {
    packagesInProject: number;
    peopleCount: number;
    hasPublishedVersion: boolean;
  };
}
```

- [ ] **Step 2: Repoint the importers**

In `components/people/TeamMatrix.tsx`, replace:

```tsx
import type { ProjectPackage } from '@/app/project/[id]/page';
```

with:

```tsx
import type { ProjectPackage } from '@/lib/projectOverview';
```

In `components/home/ProjectPeopleDrawer.tsx`, replace:

```tsx
import type { ProjectPackage } from '@/app/project/[id]/page';
```

with:

```tsx
import type { ProjectPackage } from '@/lib/projectOverview';
```

In `app/project/[id]/page.tsx`, delete the `ProjectPerson`, `ProjectPackage` and `Overview` interface declarations (lines 25–73) and add at the top of its imports:

```tsx
import type {
  ProjectPackage,
  ProjectOverview as Overview,
} from '@/lib/projectOverview';
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/projectOverview.ts components/people/TeamMatrix.tsx components/home/ProjectPeopleDrawer.tsx "app/project/[id]/page.tsx"
git commit -m "refactor: move project overview types into lib"
```

---

### Task 9: The people drawer absorbs the project page

Three controls live only on the page being deleted. They move here. The drawer fetches the overview it needs on open — a guest's fetch will 404, which is why every one of these is behind `canManage`.

**Files:**
- Modify: `components/home/ProjectPeopleDrawer.tsx`

**Interfaces:**
- Consumes: `GET /api/projects/{id}/overview` → `ProjectOverview`; `PATCH /api/projects/{id}` with `{ aiSummariesEnabled }`; `DELETE /api/projects/{id}`.
- Produces: no signature change — the drawer keeps `{ group, isOpen, onClose, onChanged }`.

- [ ] **Step 1: Add the imports**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { TeamMatrix } from '@/components/people/TeamMatrix';
import { DangerCard } from '@/components/settings/SettingsShell';
import { DestructiveConfirm } from '@/components/settings/DestructiveConfirm';
import { useToast } from '@/components/ui/Toast';
import type { ProjectOverview } from '@/lib/projectOverview';
```

Remove the now-unused `import Link from 'next/link';`.

- [ ] **Step 2: Fetch the overview when the drawer opens**

Add inside the component, after `const [addOpen, setAddOpen] = useState(false);`:

```tsx
  const { toast } = useToast();
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // The last value the server confirmed, so a failed save can roll the switch
  // back to the truth rather than to whatever it was mid-flight.
  const confirmedAi = useRef(true);

  const projectId = group?.project.id ?? null;
  const canManage =
    Boolean(group) &&
    (group!.project.ownedByMe || group!.project.myRole === 'coordinator');

  useEffect(() => {
    if (!isOpen || !projectId || !canManage) return;
    setOverview(null);

    fetch(`/api/projects/${projectId}/overview`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: ProjectOverview | null) => body && setOverview(body))
      .catch(() => {});

    fetch(`/api/projects/${projectId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body && typeof body.aiSummariesEnabled === 'boolean') {
          setAiEnabled(body.aiSummariesEnabled);
          confirmedAi.current = body.aiSummariesEnabled;
        }
      })
      .catch(() => {});
  }, [isOpen, projectId, canManage]);

  const isOwner = overview?.members.some((m) => m.isYou && m.role === 'owner') ?? false;

  const saveAi = useCallback(
    async (next: boolean) => {
      if (aiSaving || !projectId) return;
      setAiError(null);
      setAiEnabled(next);
      setAiSaving(true);
      try {
        const res = await fetch(`/api/projects/${projectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aiSummariesEnabled: next }),
        });
        if (!res.ok) {
          setAiEnabled(confirmedAi.current);
          setAiError(
            `Couldn’t save that — the switch is still ${confirmedAi.current ? 'on' : 'off'}.`
          );
        } else {
          confirmedAi.current = next;
        }
      } catch {
        setAiEnabled(confirmedAi.current);
        setAiError('Couldn’t reach the server — nothing changed.');
      } finally {
        setAiSaving(false);
      }
    },
    [aiSaving, projectId]
  );

  const deleteProject = async () => {
    if (!projectId) return;
    const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    // An expired session is 302'd to /login by middleware and fetch follows it,
    // handing back 200 HTML — res.ok alone would report a deletion that never
    // happened and leave the project still listed.
    if (res.redirected) {
      toast('Your session has expired. Sign in and try again.');
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast(body.error ?? 'Could not delete this project');
      return;
    }
    setConfirmDelete(false);
    onClose();
    onChanged();
  };
```

Delete the existing `const canManage = …` line further down, which this replaces.

- [ ] **Step 3: Replace the footer**

The "Access matrix" link pointed at the page being deleted. Replace the whole `footer={…}` prop with:

```tsx
        footer={
          canManage && packages.length > 0 ? (
            <Button fullWidth onClick={() => setAddOpen(true)}>
              Add people
            </Button>
          ) : undefined
        }
```

- [ ] **Step 4: Add the three absorbed sections**

Insert directly after the closing `</Note>` inside the drawer body:

```tsx
          {/* Below lives everything the project page used to hold. Access is
              granted per package, so the matrix is the only place a
              coordinator can see the whole (person × package) grid — which is
              how they avoid showing the client the consultant's markup. */}
          {canManage && overview && overview.packages.length >= 2 && (
            <div className="mt-6 border-t border-stiko-border pt-5">
              <TeamMatrix
                members={overview.members}
                packages={overview.packages}
                onChanged={onChanged}
                onAddPeople={() => setAddOpen(true)}
              />
            </div>
          )}

          {isOwner && (
            <div className="mt-6 border-t border-stiko-border pt-5">
              <label className="flex items-center gap-2 text-[11.5px] text-stiko-muted">
                <input
                  type="checkbox"
                  checked={aiEnabled}
                  disabled={aiSaving}
                  onChange={(e) => saveAi(e.target.checked)}
                />
                Let Stiko summarise this project
              </label>
              {aiError && (
                <p className="mt-1 text-[11px] text-note-red-text">{aiError}</p>
              )}
            </div>
          )}

          {/* Gated on totalPackageCount, not the visible list: an archived
              package is deliberately hidden from that list while its versions,
              files, comments and S3 objects all still exist, so
              "packages.length === 0" is not "nothing to lose". This only
              avoids offering a control that would fail — the server enforces
              the real guarantee and refuses with 409 if any portal exists. */}
          {isOwner && overview?.totalPackageCount === 0 && (
            <div className="mt-6">
              <DangerCard
                rows={[
                  {
                    title: 'Delete project',
                    description:
                      'Permanently removes this project. This cannot be undone.',
                    actionLabel: 'Delete',
                    onAction: () => setConfirmDelete(true),
                  },
                ]}
              />
            </div>
          )}
```

- [ ] **Step 5: Mount the confirm dialog**

Directly after the `<AddPeopleModal … />` block, still inside the fragment:

```tsx
      {group && (
        <DestructiveConfirm
          isOpen={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={deleteProject}
          title={`Delete ${group.project.name}?`}
          name={group.project.name}
          consequence="This permanently removes the project. This cannot be undone."
          inventory={[]}
          confirmLabel="Delete project"
        />
      )}
```

Also widen the drawer so the matrix fits — change `width={390}` to `width={520}`, and make Escape respect the new dialog: `closeOnEscape={!addOpen && !confirmDelete}`.

- [ ] **Step 6: Typecheck and verify**

Run: `npx tsc --noEmit`
Expected: PASS.

Then in a browser: open the drawer from a project's avatar stack and confirm the people list, the matrix (on a project with 2+ packages), the AI switch (as owner), and that the delete card appears **only** on a project with zero packages including archived ones.

- [ ] **Step 7: Commit**

```bash
git add components/home/ProjectPeopleDrawer.tsx
git commit -m "feat: move the access matrix, AI switch and project delete into the people drawer"
```

---

### Task 10: Delete the project page

Nothing points at it and nothing it offered is unreachable. Remove it.

**Files:**
- Delete: `app/project/[id]/page.tsx`, `components/project/WaitingOn.tsx`, `components/project/ProjectBrief.tsx`
- Modify: any file still linking to `/project/`

- [ ] **Step 1: Find every remaining reference**

Run: `grep -rn "/project/" --include="*.tsx" --include="*.ts" app components lib`
Expected: hits only in the files about to be deleted. Any other hit is a link that must be removed or repointed **before** the delete — resolve it and re-run until clean.

- [ ] **Step 2: Delete**

```bash
git rm -r "app/project" components/project/WaitingOn.tsx components/project/ProjectBrief.tsx
```

- [ ] **Step 3: Typecheck, lint and build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all three PASS. `npm run build` is the one that catches a route still referenced by a `<Link href>` that tsc accepts as a plain string.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS, every file.

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "feat: retire the project page now the dashboard covers it"
```

---

## Verification before calling this done

- [ ] `npm test` passes in full.
- [ ] `npx tsc --noEmit` is silent.
- [ ] `npm run lint` passes.
- [ ] `npm run build` succeeds.
- [ ] Browser pass against a real database, signed in as an owner AND as an invited-only user: an invited user sees no "Add a package", no matrix, no AI switch, no delete card, and no crash from the member-gated overview fetch.
- [ ] The rail's stat tiles and the page subline agree under every filter.
- [ ] `prefers-reduced-motion: reduce` (DevTools → Rendering → Emulate CSS media feature) leaves the list usable with no transforms.
- [ ] Every one of the four deliberate deviations above is written into the PR description.
