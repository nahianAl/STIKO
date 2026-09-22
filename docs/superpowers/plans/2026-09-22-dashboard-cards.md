# Dashboard Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's project list with a grid of project cards, a Packages panel docked on the right, the Activity rail on the left, and Trash in the bottom-right corner, where it glides aside when the panel opens.

**Architecture:** Presentation only. There are no API, query or schema changes, and every number still derives from `/api/home` through the pure helpers in `lib/home.ts`. The side columns animate `width` between CSS-variable widths. A small hook watches the grid with a `ResizeObserver` and glides cards across column-count changes, and its maths lives in a tested pure module.

**Tech Stack:** Next.js 14 App Router, React 18 client components, Tailwind 3.4 with the `stiko-*` tokens, `node --test` for unit tests (TypeScript run directly, relative `.ts` imports).

**Spec:** `docs/superpowers/specs/2026-09-22-dashboard-cards-design.md`. Read its "Decisions that differ from the handoff" before starting.

## Global Constraints

- No API route, query, schema or migration changes.
- UI copy says **"Package"**; code keeps the `portal` names it already uses (e.g. `/portal/{id}` routes).
- No click inside a card, the rail or the Packages panel may reach the page root, which deselects on background click; otherwise a click selects and then deselects in one React batch. Cards stop it in each handler (their buttons sit in a pointer-events layer); the rail and the Packages panel stop it once, on their outer wrapper.
- `visibility` transitions get their own `0s` duration, delayed by the close duration, and are always listed last.
- Motion easing is `cubic-bezier(.32,.72,0,1)`: 520ms for the panel/summary/glide, 320ms for card states. The rail keeps `cubic-bezier(.4,0,.2,1)` at 340ms.
- Anything that moves carries the `stiko-motion` class, which honours `prefers-reduced-motion` (see `app/globals.css`).
- `lib/` modules imported by tests use relative imports with a `.ts` suffix and **no `@/` alias**. `lib/queries.ts` may only be imported with `import type`.
- **Never `git add -A` or `git add .`.** The repo root holds untracked handoff folders that must stay out of commits. Add named paths only.
- Commit message trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Work on branch `feature/dashboard-cards` (already created; the spec is committed there).

## File map

| File | Responsibility |
|---|---|
| `lib/home.ts` (modify) | + four label helpers: `packagesLabel`, `openCommentsLabel`, `packageMeta`, `packageCountLabel` |
| `lib/gridGlide.ts` (create) | Pure maths: `columnCount`, `planGlides` |
| `components/home/RoleChip.tsx` (create) | Owner / Invited pill, moved out of `ProjectListRow` |
| `components/home/ProjectCard.tsx` (create) | One project card |
| `components/home/useGridGlide.ts` (create) | The ResizeObserver + WAAPI glide hook |
| `components/home/ProjectGrid.tsx` (create) | The grid element; owns the ref and calls the hook |
| `components/home/PackagesPanel.tsx` (create) | The docked (lg+) / overlay (<lg) Packages panel |
| `app/globals.css` (modify) | `--stiko-rail-w`, `--stiko-packages-w` |
| `tailwind.config.ts` (modify) | Card colour and shadow tokens |
| `components/home/ActivityRail.tsx` (modify) | Left side, variable width |
| `components/home/ActivityFeedPanel.tsx` (modify) | Chevron points left |
| `components/home/ProjectSummaryPanel.tsx` (modify) | 520ms timings |
| `app/page.tsx` (modify) | Three-column layout, selection, Trash |
| `components/home/ProjectListRow.tsx`, `ProjectListHeader.tsx`, `PackageListRow.tsx` (delete) | Replaced |

Commands used throughout (run from the repo root):

- One test file: `node --test scripts/tests/<file>.test.mjs`
- All tests: `npm test` (baseline before this plan: **662 passing**)
- Types: `npx tsc --noEmit`
- Lint: `npm run lint`

---

### Task 1: Label helpers in `lib/home.ts`

**Files:**
- Modify: `lib/home.ts`
- Test: `scripts/tests/home.test.mjs`

**Interfaces:**
- Consumes: `relativeTime(iso: string, now?: number): string` from `lib/design.ts` (returns `''` for an unparseable date).
- Produces (used by Tasks 3 and 5):
  - `packagesLabel(count: number): string`
  - `openCommentsLabel(count: number): string`
  - `packageMeta(pkg: PackageCard, now?: number): string`
  - `packageCountLabel(pkg: PackageCard): string`

- [ ] **Step 1: Write the failing tests**

In `scripts/tests/home.test.mjs`, extend the import list at the top so it reads:

```js
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
  packagesLabel,
  openCommentsLabel,
  packageMeta,
  packageCountLabel,
} from '../../lib/home.ts';
```

Append to the end of the file:

```js
/* ---------------------------------------------------------------- labels -- */

test('the package count is singular only for one', () => {
  assert.equal(packagesLabel(0), '0 packages');
  assert.equal(packagesLabel(1), '1 package');
  assert.equal(packagesLabel(4), '4 packages');
});

test('the open-comments line says Nothing open at zero', () => {
  assert.equal(openCommentsLabel(0), 'Nothing open');
  assert.equal(openCommentsLabel(1), '1 open comment');
  assert.equal(openCommentsLabel(13), '13 open comments');
});

const NOW = Date.parse('2026-09-22T12:00:00Z');

test('package meta joins version, quoted changelog and age', () => {
  assert.equal(
    packageMeta(
      pkg({
        versionNumber: 4,
        changelog: 'Gutter detail added',
        updatedAt: '2026-09-22T10:00:00Z',
      }),
      NOW
    ),
    'V4 · "Gutter detail added" · 2h ago'
  );
});

test('package meta drops a missing changelog', () => {
  assert.equal(
    packageMeta(
      pkg({ versionNumber: 3, changelog: null, updatedAt: '2026-09-19T12:00:00Z' }),
      NOW
    ),
    'V3 · 3d ago'
  );
});

test('package meta drops a missing or unparseable time', () => {
  assert.equal(packageMeta(pkg({ versionNumber: 2, updatedAt: null }), NOW), 'V2');
  assert.equal(packageMeta(pkg({ versionNumber: 2, updatedAt: 'nope' }), NOW), 'V2');
});

test('a package with no version asks for files', () => {
  assert.equal(
    packageMeta(pkg({ versionNumber: null, changelog: 'ignored' }), NOW),
    'No files yet — add some'
  );
});

test('the count prefers open comments, then files, then empty', () => {
  assert.equal(packageCountLabel(pkg({ openComments: 7, fileCount: 12 })), '7 open');
  assert.equal(packageCountLabel(pkg({ openComments: 0, fileCount: 1 })), '1 file');
  assert.equal(packageCountLabel(pkg({ openComments: 0, fileCount: 9 })), '9 files');
  assert.equal(packageCountLabel(pkg({ openComments: 0, fileCount: 0 })), 'empty');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/tests/home.test.mjs`
Expected: FAIL with `SyntaxError: The requested module '../../lib/home.ts' does not provide an export named …` (one of the four new names).

- [ ] **Step 3: Implement**

In `lib/home.ts`, add this import directly under the existing `import { highestRole, ROLE_RANK, type ProjectRole } from './roles.ts';` line:

```ts
import { relativeTime } from './design.ts';
```

Then insert this block immediately **before** the `/* Activity rail */` banner comment (i.e. after `homeStats`):

```ts
/* -------------------------------------------------------------------------- */
/* Labels                                                                     */
/* -------------------------------------------------------------------------- */

/** The card footer: "1 package" / "N packages". */
export function packagesLabel(count: number): string {
  return count === 1 ? '1 package' : `${count} packages`;
}

/** The Packages panel header's open-comment line. */
export function openCommentsLabel(count: number): string {
  if (count === 0) return 'Nothing open';
  return `${count} open ${count === 1 ? 'comment' : 'comments'}`;
}

/**
 * A package item's second line: `V4 · "Gutter detail added" · 2h ago`.
 *
 * The changelog and age clauses drop out when absent. A package with no
 * version yet has nothing to describe, so it says what to do instead.
 */
export function packageMeta(pkg: PackageCard, now: number = Date.now()): string {
  if (pkg.versionNumber == null) return 'No files yet — add some';
  return [
    `V${pkg.versionNumber}`,
    pkg.changelog ? `"${pkg.changelog}"` : null,
    // relativeTime returns '' for an unparseable date, which filter drops.
    pkg.updatedAt ? relativeTime(pkg.updatedAt, now) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Open comments win; otherwise the file count; otherwise "empty". */
export function packageCountLabel(pkg: PackageCard): string {
  if (pkg.openComments > 0) return `${pkg.openComments} open`;
  if (pkg.fileCount > 0) {
    return `${pkg.fileCount} ${pkg.fileCount === 1 ? 'file' : 'files'}`;
  }
  return 'empty';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/tests/home.test.mjs`
Expected: PASS, 0 failures.

Run: `npm test`
Expected: 669 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add lib/home.ts scripts/tests/home.test.mjs
git commit -m "feat(home): label helpers for the project cards and packages panel

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Glide maths in `lib/gridGlide.ts`

**Files:**
- Create: `lib/gridGlide.ts`
- Test: `scripts/tests/gridGlide.test.mjs`

**Interfaces:**
- Produces (used by Task 4):
  - `interface GlidePoint { x: number; y: number }`
  - `interface Glide { key: string; dx: number; dy: number }`
  - `columnCount(template: string): number`
  - `planGlides(prev: ReadonlyMap<string, GlidePoint>, next: ReadonlyMap<string, GlidePoint>, columnsChanged: boolean, inFlight?: ReadonlyMap<string, GlidePoint>): Glide[]`

- [ ] **Step 1: Write the failing tests**

Create `scripts/tests/gridGlide.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnCount, planGlides } from '../../lib/gridGlide.ts';

const pts = (obj) => new Map(Object.entries(obj));

/* ----------------------------------------------------------- columnCount -- */

test('columnCount counts resolved tracks', () => {
  assert.equal(columnCount('300px 300px 300px'), 3);
  assert.equal(columnCount('  220px  '), 1);
  assert.equal(columnCount('241.5px 241.5px'), 2);
});

test('columnCount is zero for no tracks', () => {
  assert.equal(columnCount('none'), 0);
  assert.equal(columnCount(''), 0);
});

/* ------------------------------------------------------------ planGlides -- */

test('nothing glides while the column count holds — that is drift', () => {
  const prev = pts({ a: { x: 0, y: 0 }, b: { x: 242, y: 0 } });
  const next = pts({ a: { x: 0, y: 0 }, b: { x: 230, y: 0 } });
  assert.deepEqual(planGlides(prev, next, false), []);
});

test('a column change glides every card that moved, from its old spot', () => {
  const prev = pts({ a: { x: 0, y: 0 }, b: { x: 242, y: 0 }, c: { x: 484, y: 0 } });
  const next = pts({ a: { x: 0, y: 0 }, b: { x: 322, y: 0 }, c: { x: 0, y: 198 } });
  assert.deepEqual(planGlides(prev, next, true), [
    { key: 'b', dx: -80, dy: 0 },
    { key: 'c', dx: 484, dy: -198 },
  ]);
});

test('sub-pixel movement does not glide', () => {
  const prev = pts({ a: { x: 10, y: 0 } });
  const next = pts({ a: { x: 10.4, y: 0.3 } });
  assert.deepEqual(planGlides(prev, next, true), []);
});

test('a card with no previous position does not glide', () => {
  const prev = pts({ a: { x: 0, y: 0 } });
  const next = pts({ a: { x: 0, y: 0 }, fresh: { x: 242, y: 0 } });
  assert.deepEqual(planGlides(prev, next, true), []);
});

test('a card that has gone is ignored', () => {
  const prev = pts({ gone: { x: 242, y: 0 } });
  const next = pts({});
  assert.deepEqual(planGlides(prev, next, true), []);
});

test('a card caught mid-glide starts from where it visibly is', () => {
  const prev = pts({ c: { x: 484, y: 0 } });
  const next = pts({ c: { x: 0, y: 198 } });
  // Still showing translate(-100px, 20px) from an unfinished glide.
  const inFlight = pts({ c: { x: -100, y: 20 } });
  assert.deepEqual(planGlides(prev, next, true, inFlight), [
    { key: 'c', dx: 384, dy: -178 },
  ]);
});

test('a mid-glide card whose layout did not move is left to finish', () => {
  const prev = pts({ a: { x: 0, y: 0 } });
  const next = pts({ a: { x: 0, y: 0 } });
  const inFlight = pts({ a: { x: 50, y: 0 } });
  assert.deepEqual(planGlides(prev, next, true, inFlight), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/tests/gridGlide.test.mjs`
Expected: FAIL with `Cannot find module …/lib/gridGlide.ts` (ERR_MODULE_NOT_FOUND).

- [ ] **Step 3: Implement**

Create `lib/gridGlide.ts`:

```ts
/**
 * The maths behind the card grid's glide (components/home/useGridGlide.ts).
 *
 * The grid is `repeat(auto-fill, minmax(min(220px, 100%), 1fr))`, so while a
 * side panel animates its width the cards do two different things:
 *
 * - Between column-count changes they DRIFT: every track narrows or widens a
 *   little each frame and the cards follow. That is the layout animating, it
 *   is already smooth, and it must be left alone.
 * - When the column count changes they JUMP: a card changes row or column
 *   between one frame and the next. That movement has no frames of its own,
 *   so it is the only one that gets a glide.
 *
 * The trigger is the column count, not a distance threshold. A card that stays
 * in column 1 across a 4→3 change still moves by the change in track width
 * (≈80px at 1440px), and one fast frame of drift can move a far-right card
 * nearly as far. No single distance separates the two; the column count does.
 */

export interface GlidePoint {
  x: number;
  y: number;
}

export interface Glide {
  key: string;
  /** Where the card starts, relative to its new layout position. */
  dx: number;
  dy: number;
}

/**
 * Tracks in a resolved `grid-template-columns` value, as getComputedStyle
 * reports it: "300px 300px 300px" → 3. With auto-fill, empty tracks are still
 * listed, so this is the grid's column count however few cards it holds.
 */
export function columnCount(template: string): number {
  const value = template.trim();
  if (value === '' || value === 'none') return 0;
  return value.split(/\s+/).length;
}

/**
 * Which cards glide, and from how far.
 *
 * `prev` and `next` are LAYOUT positions (offsetLeft/offsetTop), which ignore
 * transforms, so an unfinished glide never pollutes them. `inFlight` is the
 * translate a card is showing right now from a glide that has not finished;
 * adding it means a card caught by a second jump starts from where it visibly
 * IS rather than snapping to where its layout was.
 *
 * Only cards whose LAYOUT moved glide. A mid-glide card whose cell did not
 * change keeps its current animation rather than restarting it.
 */
export function planGlides(
  prev: ReadonlyMap<string, GlidePoint>,
  next: ReadonlyMap<string, GlidePoint>,
  columnsChanged: boolean,
  inFlight: ReadonlyMap<string, GlidePoint> = new Map()
): Glide[] {
  if (!columnsChanged) return [];

  const glides: Glide[] = [];
  next.forEach((to, key) => {
    const from = prev.get(key);
    if (!from) return;

    const layoutDx = from.x - to.x;
    const layoutDy = from.y - to.y;
    if (Math.abs(layoutDx) < 1 && Math.abs(layoutDy) < 1) return;

    const offset = inFlight.get(key) ?? { x: 0, y: 0 };
    glides.push({ key, dx: layoutDx + offset.x, dy: layoutDy + offset.y });
  });
  return glides;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/tests/gridGlide.test.mjs`
Expected: PASS, 9 tests, 0 failures.

Run: `npm test`
Expected: 678 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add lib/gridGlide.ts scripts/tests/gridGlide.test.mjs
git commit -m "feat(home): pure maths for gliding cards across column changes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `ProjectCard`, `RoleChip` and the card tokens

**Files:**
- Create: `components/home/RoleChip.tsx`
- Create: `components/home/ProjectCard.tsx`
- Modify: `tailwind.config.ts`

**Interfaces:**
- Consumes: `packagesLabel` (Task 1); `AvatarStack` from `components/ui/Primitives.tsx` (`{ people: {id, name, pending?}[]; size?: number; max?: number; ring?: string }`, defaults `size 26, max 4, ring '#FFFFFF'`); `ProjectGroup` from `lib/home.ts` (`{ project: ProjectSummary; packages; packageCount; openComments; people }`).
- Produces (used by Task 4):
  - `export function RoleChip({ ownedByMe, myRole }: { ownedByMe: boolean; myRole: string | null })`
  - `export function ProjectCard(props: { group: ProjectGroup; selected: boolean; onToggle: (id: string) => void; onOpenPeople: (id: string) => void; onOpenPanel: (id: string) => void })`. The root element carries `data-glide={project.id}`, and the select toggle is the card's only direct-child `<button>` and carries `aria-pressed`.
  - Tailwind tokens: colours `stiko-card-line`, `stiko-card-line-hot`, `stiko-manage-line`; shadows `shadow-stiko-card-rest`, `shadow-stiko-card-hover`, `shadow-stiko-card-selected`.

- [ ] **Step 1: Add the tokens**

In `tailwind.config.ts`, inside `colors.stiko`, add after the `"no-access": "#D8DCE8",` line:

```ts

          // Project cards (dashboard). The rest line is the hot line mixed
          // halfway to the field, so a grid of cards reads as one set.
          "card-line": "#AEB9F7",
          "card-line-hot": "#7480F2",
          "manage-line": "#E6E4FA",
```

Inside `boxShadow`, add after the `"stiko-focus": …,` line:

```ts
        // Project cards: ambient on all four sides (a zero-offset blur plus a
        // small downward layer), deepening from rest to hover to selected.
        // Distinct from stiko-card above, which other screens still use.
        "stiko-card-rest":
          "0 0 12px rgba(28,32,48,0.045), 0 3px 10px rgba(28,32,48,0.045)",
        "stiko-card-hover":
          "0 0 16px rgba(28,32,48,0.06), 0 5px 16px rgba(28,32,48,0.065)",
        "stiko-card-selected":
          "0 0 18px rgba(28,32,48,0.07), 0 6px 20px rgba(28,32,48,0.08)",
```

- [ ] **Step 2: Create `components/home/RoleChip.tsx`**

This is moved verbatim from `ProjectListRow.tsx`, which Task 7 deletes.

```tsx
import { roleLabel } from '@/lib/roles';

/** Solid for owner, outlined for invited — solid pills are facts about YOU. */
export function RoleChip({
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

- [ ] **Step 3: Create `components/home/ProjectCard.tsx`**

```tsx
'use client';

import { AvatarStack } from '@/components/ui/Primitives';
import { RoleChip } from '@/components/home/RoleChip';
import { packagesLabel, type ProjectGroup } from '@/lib/home';

/**
 * One project on the dashboard grid.
 *
 * Deliberately sparse — name, role, people, package count, manage. Everything
 * about the packages themselves lives in the Packages panel the card opens,
 * which is what keeps every card the same size at five packages as at one.
 *
 * Structure note, because the obvious version is invalid HTML: the whole card
 * is one click target, but the avatar stack and the manage control are buttons
 * of their own, and a button inside a button does not nest — browsers hoist
 * the inner one out and the click targets come apart. So the toggle is an
 * absolutely-positioned button filling the card, the content sits above it in
 * a pointer-events-none layer, and only the two inner buttons re-enable
 * pointer events. Hover lives on the card itself, so it covers all of it.
 *
 * `data-glide` opts the card into useGridGlide, which slides it to its new
 * cell when the grid's column count changes.
 */
export function ProjectCard({
  group,
  selected,
  onToggle,
  onOpenPeople,
  onOpenPanel,
}: {
  group: ProjectGroup;
  selected: boolean;
  onToggle: (id: string) => void;
  onOpenPeople: (id: string) => void;
  onOpenPanel: (id: string) => void;
}) {
  const { project, packageCount, people } = group;

  return (
    <div
      data-glide={project.id}
      // 1px → 2px border with 18px → 17px padding: the padding pays for the
      // thicker border, so nothing inside moves by a pixel on hover or select.
      className={`relative flex min-h-[176px] flex-col rounded-[20px] bg-white transition-[box-shadow,border-color,padding,border-width] duration-[320ms] ease-[cubic-bezier(.32,.72,0,1)] ${
        selected
          ? 'border-2 border-stiko-card-line-hot p-[17px] shadow-stiko-card-selected'
          : 'border border-stiko-card-line p-[18px] shadow-stiko-card-rest hover:border-2 hover:border-stiko-card-line-hot hover:p-[17px] hover:shadow-stiko-card-hover'
      }`}
    >
      <button
        type="button"
        // stopPropagation is load-bearing, not defensive: the page root
        // deselects on background click, so without it this click selects
        // and then bubbles up and deselects in the same React batch.
        onClick={(e) => {
          e.stopPropagation();
          onToggle(project.id);
        }}
        aria-pressed={selected}
        aria-label={`Show packages in ${project.name}`}
        className="absolute inset-0 h-full w-full rounded-[18px] focus:outline-none focus-visible:shadow-stiko-focus"
      />

      <div className="pointer-events-none relative flex flex-1 flex-col">
        <h3
          className="break-words text-[17px] font-extrabold leading-[1.25] tracking-title text-stiko-ink"
          style={{ textWrap: 'pretty' }}
        >
          {project.name}
        </h3>

        <div className="flex items-center gap-2 pt-[10px]">
          <RoleChip ownedByMe={project.ownedByMe} myRole={project.myRole} />
        </div>

        {/* Pushes the footer down, so every card in a row ends level. */}
        <div className="flex-1" />

        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {people.length > 0 && (
              <button
                type="button"
                title="People on this project"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenPeople(project.id);
                }}
                className="pointer-events-auto flex rounded-pill focus:outline-none focus-visible:shadow-stiko-focus"
              >
                <AvatarStack people={people} size={26} />
              </button>
            )}
            <div className="mt-[10px] text-[12px] font-bold text-stiko-secondary">
              {packagesLabel(packageCount)}
            </div>
          </div>

          <button
            type="button"
            // Same trap as the toggle: without stopPropagation the page root's
            // background-click handler deselects in the same batch.
            onClick={(e) => {
              e.stopPropagation();
              onOpenPanel(project.id);
            }}
            aria-label={`Manage ${project.name}`}
            title="Manage"
            className="pointer-events-auto flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] border border-stiko-manage-line bg-white text-stiko-secondary transition-[color,border-color] duration-300 ease-[cubic-bezier(.32,.72,0,1)] hover:border-stiko-card-line hover:text-stiko-primary focus:outline-none focus-visible:shadow-stiko-focus"
          >
            <svg
              className="h-[14px] w-[14px]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output (exit 0).

Run: `npm run lint`
Expected: `✔ No ESLint warnings or errors`.

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.ts components/home/RoleChip.tsx components/home/ProjectCard.tsx
git commit -m "feat(home): project card and its tokens

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `useGridGlide` and `ProjectGrid`

**Files:**
- Create: `components/home/useGridGlide.ts`
- Create: `components/home/ProjectGrid.tsx`

**Interfaces:**
- Consumes: `columnCount`, `planGlides`, `GlidePoint` (Task 2); `ProjectCard` (Task 3).
- Produces (used by Task 7):
  - `export function useGridGlide(gridRef: RefObject<HTMLElement>): void`
  - `export function ProjectGrid(props: { groups: ProjectGroup[]; selectedId: string | null; onToggle: (id: string) => void; onOpenPeople: (id: string) => void; onOpenPanel: (id: string) => void })`

The hook has no unit test: it is DOM glue over the tested maths, and Task 8's browser pass measures it directly.

- [ ] **Step 1: Create `components/home/useGridGlide.ts`**

```ts
'use client';

import { useEffect, type RefObject } from 'react';
import { columnCount, planGlides, type GlidePoint } from '@/lib/gridGlide';

/** The handoff's reflow timing — the same curve the Packages panel opens on. */
const GLIDE_MS = 520;
const GLIDE_EASE = 'cubic-bezier(.32,.72,0,1)';

/**
 * Glides the cards of a reflowing grid to their new cells instead of letting
 * them jump there.
 *
 * Cards opt in with `data-glide="<stable key>"`. The grid must be
 * `position: relative`, so each card's offsetParent is the grid and
 * offsetLeft/offsetTop are grid coordinates that ignore transforms.
 *
 * Why a ResizeObserver rather than a measure-before/after-commit FLIP: the
 * side panels animate `width`, so at commit time nothing has moved yet. The
 * jump happens mid-transition, on whichever frame the column count changes,
 * and only an observer that runs on every frame of the resize sees it. The
 * design prototype's commit-time FLIP never fires for exactly this reason.
 *
 * ResizeObserver callbacks run after layout and before paint, and a new
 * animation applies its first keyframe at once, so the frame that lays a card
 * out in its new cell already paints it at its old spot — no one-frame flash.
 */
export function useGridGlide(gridRef: RefObject<HTMLElement>): void {
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver === 'undefined') return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const running = new Map<string, Animation>();

    const cards = () =>
      Array.from(grid.querySelectorAll<HTMLElement>('[data-glide]'));

    const measure = () => {
      const points = new Map<string, GlidePoint>();
      for (const el of cards()) {
        const key = el.dataset.glide;
        if (key) points.set(key, { x: el.offsetLeft, y: el.offsetTop });
      }
      return points;
    };

    const columns = () =>
      columnCount(getComputedStyle(grid).gridTemplateColumns);

    let prev = measure();
    let prevColumns = columns();

    // A filter change or a reload swaps the cards without resizing the grid,
    // which would leave `prev` describing cards that have since moved or gone.
    // MutationObserver callbacks run as a microtask straight after React's
    // commit — before the next layout — so the baseline is retaken before any
    // resize frame can compare against a stale one.
    const mutations = new MutationObserver(() => {
      prev = measure();
      prevColumns = columns();
    });
    mutations.observe(grid, { childList: true });

    const resizes = new ResizeObserver(() => {
      const next = measure();
      const nextColumns = columns();

      if (nextColumns !== prevColumns && !reduceMotion.matches) {
        const byKey = new Map(
          cards().map((el) => [el.dataset.glide ?? '', el] as const)
        );

        // Where each still-gliding card visibly is, relative to its layout.
        // Read BEFORE the cancel below — cancelling drops the transform.
        const inFlight = new Map<string, GlidePoint>();
        running.forEach((animation, key) => {
          const el = byKey.get(key);
          if (!el || animation.playState !== 'running') {
            running.delete(key);
            return;
          }
          const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
          inFlight.set(key, { x: m.m41, y: m.m42 });
        });

        for (const { key, dx, dy } of planGlides(prev, next, true, inFlight)) {
          const el = byKey.get(key);
          if (!el) continue;
          running.get(key)?.cancel();
          running.set(
            key,
            el.animate(
              [
                { transform: `translate(${dx}px, ${dy}px)` },
                { transform: 'none' },
              ],
              { duration: GLIDE_MS, easing: GLIDE_EASE }
            )
          );
        }
      }

      prev = next;
      prevColumns = nextColumns;
    });
    resizes.observe(grid);

    return () => {
      resizes.disconnect();
      mutations.disconnect();
      running.forEach((animation) => animation.cancel());
    };
  }, [gridRef]);
}
```

- [ ] **Step 2: Create `components/home/ProjectGrid.tsx`**

```tsx
'use client';

import { useRef } from 'react';
import { ProjectCard } from '@/components/home/ProjectCard';
import { useGridGlide } from '@/components/home/useGridGlide';
import type { ProjectGroup } from '@/lib/home';

/**
 * The project cards.
 *
 * Its own component, not markup inside app/page.tsx, because useGridGlide has
 * to run in whatever mounts the grid element: the page renders a skeleton
 * first, so an effect on the page would run before the grid exists and, with
 * a stable ref as its only dependency, never run again.
 *
 * `auto-fill`, not `auto-fit`: auto-fit collapses empty tracks, so a lone
 * project's card would stretch across the whole column. The `min(220px,100%)`
 * floor is what lets the grid fall to one column, instead of overflowing, when
 * both side columns are open. `relative` makes this the cards' offsetParent,
 * which useGridGlide measures against.
 */
export function ProjectGrid({
  groups,
  selectedId,
  onToggle,
  onOpenPeople,
  onOpenPanel,
}: {
  groups: ProjectGroup[];
  selectedId: string | null;
  onToggle: (id: string) => void;
  onOpenPeople: (id: string) => void;
  onOpenPanel: (id: string) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  useGridGlide(gridRef);

  return (
    <div
      ref={gridRef}
      className="relative grid shrink-0 gap-[22px] px-1 pt-1"
      style={{
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))',
      }}
    >
      {groups.map((group) => (
        <ProjectCard
          key={group.project.id}
          group={group}
          selected={selectedId === group.project.id}
          onToggle={onToggle}
          onOpenPeople={onOpenPeople}
          onOpenPanel={onOpenPanel}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output (exit 0).

Run: `npm run lint`
Expected: `✔ No ESLint warnings or errors`.

- [ ] **Step 4: Commit**

```bash
git add components/home/useGridGlide.ts components/home/ProjectGrid.tsx
git commit -m "feat(home): card grid that glides across column changes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `PackagesPanel` and the side-column widths

**Files:**
- Create: `components/home/PackagesPanel.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `openCommentsLabel`, `packageMeta`, `packageCountLabel` (Task 1); `packageAttention`, `projectAttention`, `ProjectGroup` from `lib/home.ts`; `AttentionPill`, `AvatarStack`, `StatusChip` from `components/ui/Primitives.tsx`; `STATUS_ACCENT` from `lib/status.ts`.
- Produces (used by Tasks 6 and 7):
  - CSS variables `--stiko-rail-w` and `--stiko-packages-w` on `:root`
  - `export default function PackagesPanel(props: { group: ProjectGroup | null; open: boolean; onClose: () => void; onOpenPeople: (id: string) => void })`. Its inner `<section>` has `aria-label="Packages in {project name}"`.

- [ ] **Step 1: Add the width variables**

Append to `app/globals.css`:

```css

/* Dashboard side columns (app/page.tsx). Written in vw rather than % so the
   INNER element of each column can be given the same open width: the wrapper
   animates `width` under overflow:hidden while its content keeps its size, so
   nothing inside reflows on any frame of the slide. 100vw - 32px is the body
   row's width — Shell's 12px padding plus the row's 4px, on each side. The
   page never scrolls at lg (h-screen), so 100vw carries no page scrollbar. */
:root {
  --stiko-rail-w: clamp(264px, calc((100vw - 32px) * 0.28), 356px);
  --stiko-packages-w: clamp(280px, calc((100vw - 32px) * 0.3), 372px);
}
```

- [ ] **Step 2: Create `components/home/PackagesPanel.tsx`**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import {
  AttentionPill,
  AvatarStack,
  StatusChip,
} from '@/components/ui/Primitives';
import { STATUS_ACCENT } from '@/lib/status';
import {
  openCommentsLabel,
  packageAttention,
  packageCountLabel,
  packageMeta,
  projectAttention,
  type ProjectGroup,
} from '@/lib/home';
// Type-only: lib/queries.ts imports lib/db, which throws at module load
// without DATABASE_URL. A type-only import is erased.
import type { PackageCard } from '@/lib/queries';

/**
 * The selected project's packages.
 *
 * From lg up it is the dashboard's right-hand column: the wrapper animates
 * `width` 0 ↔ --stiko-packages-w while the section inside holds the full open
 * width, so the list never reflows mid-slide. Below lg there is no room for a
 * third column and a block stacked under a long grid would open where nobody
 * can see it, so the same element is a fixed overlay that slides in from the
 * right instead. One transition list serves both: at lg the transform is pinned
 * to none, and below lg the width is pinned, so each breakpoint only ever
 * animates the property that means something there.
 *
 * `group` is the LAST selected project, not the current one. The panel must
 * keep rendering the outgoing project for the whole close, or it visibly
 * empties on the way out — the same reason ProjectSummaryPanel takes lastId.
 */
export default function PackagesPanel({
  group,
  open,
  onClose,
  onOpenPeople,
}: {
  group: ProjectGroup | null;
  open: boolean;
  /** Deselects the project, which is what closes this panel. */
  onClose: () => void;
  onOpenPeople: (id: string) => void;
}) {
  return (
    <div
      // Clicks inside must not reach the page root's deselect handler.
      onClick={(e) => e.stopPropagation()}
      aria-hidden={!open}
      className={`stiko-motion fixed inset-y-3 right-3 z-40 w-[min(372px,calc(100vw_-_24px))] lg:static lg:z-auto lg:h-full lg:shrink-0 lg:translate-x-0 lg:overflow-hidden ${
        open
          ? 'translate-x-0 opacity-100 lg:w-[var(--stiko-packages-w)]'
          : 'translate-x-[calc(100%_+_12px)] opacity-0 lg:w-0'
      }`}
      style={{
        transitionProperty: 'width, opacity, transform, visibility',
        // visibility is a 0s step, delayed to the end of the close — see the
        // note in ActivityRail. A shared 520ms would keep it focusable twice
        // as long as it is visible.
        transitionDuration: '520ms, 380ms, 520ms, 0s',
        transitionTimingFunction: 'cubic-bezier(.32,.72,0,1)',
        visibility: open ? 'visible' : 'hidden',
        transitionDelay: open ? '0s' : '0s, 0s, 0s, 520ms',
      }}
    >
      <section
        aria-label={group ? `Packages in ${group.project.name}` : 'Packages'}
        className="flex h-full w-full flex-col overflow-hidden rounded-panel bg-white shadow-stiko-drawer lg:w-[var(--stiko-packages-w)] lg:shadow-stiko-panel"
      >
        {group && (
          <PanelContents
            group={group}
            onClose={onClose}
            onOpenPeople={onOpenPeople}
          />
        )}
      </section>
    </div>
  );
}

function PanelContents({
  group,
  onClose,
  onOpenPeople,
}: {
  group: ProjectGroup;
  onClose: () => void;
  onOpenPeople: (id: string) => void;
}) {
  const router = useRouter();
  const { project, packages, openComments, people } = group;
  const attention = projectAttention(packages);

  // `myRole === 'coordinator'` is safe as a permission signal because
  // participants.role is CHECK-constrained to viewer|commenter|uploader, so
  // coordinator can only have come from a project_members row.
  const canManage = project.ownedByMe || project.myRole === 'coordinator';

  return (
    <>
      <div className="flex shrink-0 items-start justify-between gap-[10px] border-b border-stiko-border px-4 py-[14px]">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-extrabold tracking-heading text-stiko-ink">
            {project.name}
          </h2>
          <div className="mt-1 flex items-center gap-2">
            <span
              className="whitespace-nowrap text-[11.5px] font-bold"
              style={{ color: openComments > 0 ? '#B23A52' : '#8A90A6' }}
            >
              {openCommentsLabel(openComments)}
            </span>
            {attention && (
              <AttentionPill
                label={attention.label}
                bg={attention.bg}
                fg={attention.fg}
              />
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close packages"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-stiko-app text-stiko-muted transition duration-150 hover:bg-stiko-idle hover:text-stiko-ink"
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

      <div className="flex shrink-0 items-center justify-between gap-[10px] px-4 pb-1 pt-3">
        <span className="text-[10px] font-bold uppercase tracking-label text-stiko-faint">
          Packages
        </span>
        {people.length > 0 && (
          <button
            type="button"
            title="People on this project"
            onClick={() => onOpenPeople(project.id)}
            className="flex rounded-pill focus:outline-none focus-visible:shadow-stiko-focus"
          >
            <AvatarStack people={people} size={26} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
        <div className="flex flex-col gap-2">
          {packages.map((pkg) => (
            <PackageItem key={pkg.id} pkg={pkg} />
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
              className="flex w-full items-center justify-center gap-[6px] rounded-[10px] border-[1.5px] border-dashed border-stiko-border-strong bg-transparent p-[11px] text-[11.5px] font-bold text-stiko-muted transition-[border-color,color] duration-150 hover:border-stiko-primary hover:text-stiko-primary"
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
      </div>
    </>
  );
}

/** One package: name and status, then meta, attention and count. */
function PackageItem({ pkg }: { pkg: PackageCard }) {
  const router = useRouter();
  const attention = packageAttention(pkg);

  return (
    <button
      type="button"
      onClick={() => router.push(`/portal/${pkg.id}`)}
      className="flex flex-col rounded-inset border border-stiko-border bg-white px-3 py-[11px] text-left shadow-stiko-panel transition-shadow duration-150 hover:shadow-stiko-lift"
      // The left edge is the package's status accent — declared after the
      // uniform border so it wins on that one side.
      style={{ borderLeft: `3px solid ${STATUS_ACCENT[pkg.status]}` }}
    >
      <span className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-stiko-ink">
          {pkg.name}
        </span>
        {/* No version means no status to state yet. */}
        {pkg.versionNumber != null && (
          <span className="shrink-0">
            <StatusChip status={pkg.status} />
          </span>
        )}
      </span>

      <span className="flex w-full items-center gap-2 pt-[6px]">
        <span className="min-w-0 flex-1 truncate text-[11px] text-stiko-muted">
          {packageMeta(pkg)}
        </span>
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
          className="shrink-0 text-[11px] font-extrabold"
          style={{ color: pkg.openComments > 0 ? '#B23A52' : '#8A90A6' }}
        >
          {packageCountLabel(pkg)}
        </span>
      </span>
    </button>
  );
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output (exit 0).

Run: `npm run lint`
Expected: `✔ No ESLint warnings or errors`.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css components/home/PackagesPanel.tsx
git commit -m "feat(home): packages panel, docked from lg up and an overlay below

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Activity rail moves to the left

**Files:**
- Modify: `components/home/ActivityRail.tsx` (full replacement below)
- Modify: `components/home/ActivityFeedPanel.tsx:87-88`
- Modify: `components/home/ProjectSummaryPanel.tsx:153` and `:166-167`

**Interfaces:**
- Consumes: `--stiko-rail-w` (Task 5).
- Produces: `ActivityRail`'s props are unchanged. It renders on the left from lg up via `lg:order-first`, so Task 7 places it **after** the grid column in the DOM.

- [ ] **Step 1: Replace `components/home/ActivityRail.tsx`**

```tsx
'use client';

import React from 'react';
import ActivityFeedPanel from '@/components/home/ActivityFeedPanel';
import type { NotificationRow } from '@/components/shell/NotificationTray';
import type { PackageCard } from '@/lib/queries';

/**
 * The left-hand rail: an AI summary panel stacked over the activity feed.
 *
 * The wrapper animates its width while the inner column holds the rail's full
 * open width (--stiko-rail-w, app/globals.css) — that is what stops the feed's
 * contents from reflowing on every frame of the open/close.
 *
 * `lg:order-first` puts it on the left while it stays AFTER the card grid in
 * the DOM. Below lg, where the columns stack, that keeps it under the grid
 * rather than above it, and at every size keyboard focus reaches the projects
 * first. Below lg it is a full-width block, and hiding it animates max-height
 * instead: a width on a stacked block animates nothing anyone can see.
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
  // Deliberately NOT unmounted when closed: an unmount cannot animate, and the
  // rail has to slide rather than vanish.
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      aria-hidden={!railOpen}
      className={`stiko-motion w-full shrink-0 overflow-hidden ease-[cubic-bezier(.4,0,.2,1)] lg:order-first lg:h-full lg:max-h-none ${
        railOpen
          ? 'max-h-[3000px] opacity-100 lg:w-[var(--stiko-rail-w)]'
          : 'max-h-0 opacity-0 lg:w-0'
      }`}
      style={{
        transitionProperty: 'width, max-height, opacity, visibility',
        // visibility takes 0s, NOT the shared 340ms. It interpolates as a step
        // that lands at the END of its own duration, so a 340ms duration on top
        // of the 340ms delay would hold the rail focusable for 680ms — twice as
        // long as it is visible.
        transitionDuration: '340ms, 340ms, 340ms, 0s',
        // Held until the slide finishes, so the panel is visible on the way out
        // but leaves the tab order once it is actually gone.
        visibility: railOpen ? 'visible' : 'hidden',
        transitionDelay: railOpen ? '0s' : '0s, 0s, 0s, 340ms',
      }}
    >
      <aside className="flex h-full w-full flex-col overflow-hidden lg:w-[var(--stiko-rail-w)]">
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

- [ ] **Step 2: Point the collapse chevron left**

In `components/home/ActivityFeedPanel.tsx`, inside the `aria-label="Hide activity"` button, change the svg's class:

```tsx
            <svg
              className="h-[13px] w-[13px]"
```

to:

```tsx
            {/* Points left: toward the edge the rail collapses into. */}
            <svg
              className="h-[13px] w-[13px] rotate-180"
```

- [ ] **Step 3: Match the summary's timing to the Packages panel**

In `components/home/ProjectSummaryPanel.tsx`, in the outer wrapper `div`:

Change `duration-[380ms]` to `duration-[520ms]` in its `className`.

Change:

```tsx
        transitionDuration: '380ms, 260ms, 380ms, 380ms, 0s',
        transitionDelay: visible ? '0s' : '0s, 0s, 0s, 0s, 380ms',
```

to:

```tsx
        // 520ms to match the Packages panel it opens alongside (opacity 340ms).
        transitionDuration: '520ms, 340ms, 520ms, 520ms, 0s',
        transitionDelay: visible ? '0s' : '0s, 0s, 0s, 0s, 520ms',
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no output (exit 0).

Run: `npm run lint`
Expected: `✔ No ESLint warnings or errors`.

- [ ] **Step 5: Commit**

```bash
git add components/home/ActivityRail.tsx components/home/ActivityFeedPanel.tsx components/home/ProjectSummaryPanel.tsx
git commit -m "feat(home): activity rail on the left, summary on the panel's timing

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Wire the dashboard, move Trash, retire the list

**Files:**
- Modify: `app/page.tsx` (full replacement below)
- Delete: `components/home/ProjectListRow.tsx`, `components/home/ProjectListHeader.tsx`, `components/home/PackageListRow.tsx`

**Interfaces:**
- Consumes: `ProjectGrid` (Task 4), `PackagesPanel` (Task 5), `ActivityRail` (Task 6). The rest is unchanged: `ProjectSummaryPanel`, `ProjectPanel`, `NewProjectModal`, `TrashPanel`, `CommandPalette`, `RailToggle`, `AvatarMenu`.

- [ ] **Step 1: Replace `app/page.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import EmptyState from '@/components/ui/EmptyState';
import { Column, Shell, TopBar } from '@/components/ui/Shell';
import { ProjectGrid } from '@/components/home/ProjectGrid';
import PackagesPanel from '@/components/home/PackagesPanel';
import NewProjectModal from '@/components/home/NewProjectModal';
import ProjectPanel from '@/components/home/ProjectPanel';
import TrashPanel from '@/components/home/TrashPanel';
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

/**
 * Owner home. Two states: first run, and the project cards.
 *
 * The cards cover every populated case — one package or fifty, owned or
 * invited. A project's packages never appear in the grid: selecting a card
 * opens them in the Packages panel docked on the right, which is what keeps a
 * card the same size at five packages as at one.
 */
export default function Home() {
  const router = useRouter();
  const { data: session } = useSession();

  const [packages, setPackages] = useState<PackageCard[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [disclosure, setDisclosure] = useState<DisclosureState | null>(null);
  const [isGuestOnly, setIsGuestOnly] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<HomeFilter>('all');
  const [peoplePanelProjectId, setPeoplePanelProjectId] = useState<string | null>(
    null
  );
  // The ⤢ control on each card opens the same panel, landing on the
  // cross-package view instead of the avatar stack's people view. Separate
  // state rather than a shared id + view pair: only one of the two is ever
  // non-null at a time (nothing opens both at once), and closing the panel
  // clears both together below.
  const [managePanelProjectId, setManagePanelProjectId] = useState<
    string | null
  >(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [hasTrash, setHasTrash] = useState(false);

  const [selected, setSelected] = useState<string | null>(null);
  // The last non-null selection, so the summary and Packages panels keep
  // their content for the whole close animation instead of emptying on the
  // way out.
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
    setSelected((current) => (current === id ? null : id));
    setLastId(id);
    // Forced open, never forced closed: otherwise the summary panel would
    // animate open behind a hidden rail. The user's own choice to hide the
    // rail is never overridden in the other direction.
    setRailOpen(true);
    window.localStorage.setItem('stiko.railOpen', 'true');
  }, []);

  // Changing the filter clears the selection: the selected card may be about
  // to leave the grid, and a Packages panel for a card nobody can see has no
  // visible owner.
  const changeFilter = (key: HomeFilter) => {
    setFilter(key);
    setSelected(null);
  };

  // Two entry points share one ProjectPanel instance (see panelProjectId /
  // panelView below). Each clears the other's id on open, not just on close —
  // without that, opening one while the other is still set from a previous
  // open (never closed, just superseded) would leave both non-null and the
  // people-takes-precedence merge below would show the wrong view.
  const openPeoplePanel = useCallback((id: string) => {
    setManagePanelProjectId(null);
    setPeoplePanelProjectId(id);
  }, []);
  const openManagePanel = useCallback((id: string) => {
    setPeoplePanelProjectId(null);
    setManagePanelProjectId(id);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [homeRes, notifRes] = await Promise.all([
        fetch('/api/home'),
        fetch('/api/notifications'),
      ]);

      if (!homeRes.ok) {
        // A failure must never render as "still loading". Without this the
        // skeleton stays on screen forever and the real cause is invisible.
        const body = await homeRes.json().catch(() => ({}));
        setError(
          homeRes.status === 401
            ? 'Your session has expired.'
            : (body.error ?? `Couldn’t load your packages (${homeRes.status}).`)
        );
        return;
      }

      const data = await homeRes.json();
      setPackages(data.packages);
      setProjects(data.projects ?? []);
      setDisclosure(data.disclosure);
      setIsGuestOnly(data.isGuestOnly);

      // Notifications are supporting detail; losing them must not take the
      // whole screen down.
      if (notifRes.ok) setNotifications(await notifRes.json());
    } catch (err) {
      console.error('Failed to load home', err);
      setError('Couldn’t reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The first-run screen is also where you land after deleting your only
  // project, so the trash cannot simply be absent from it — that would strand
  // 28 days of recoverable content behind no door at all. But a real
  // first-run user's trash is empty and the button there is pure noise, so
  // the screen asks before offering it. Scoped to the branch that renders
  // that screen: the populated dashboard never pays for this call.
  const dashboardIsEmpty =
    !loading && packages.length === 0 && projects.length === 0;

  useEffect(() => {
    if (!dashboardIsEmpty) return;
    let cancelled = false;
    fetch('/api/trash')
      .then((res) => (res.ok ? res.json() : []))
      .then((body) => {
        if (!cancelled) setHasTrash(Array.isArray(body) && body.length > 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dashboardIsEmpty]);

  const groups = useMemo(
    () => groupProjects(packages, projects),
    [packages, projects]
  );
  const visible = useMemo(() => {
    // The pills unmount when there is nothing to filter; without this the last
    // selection would keep filtering a grid the user can no longer unfilter.
    const active = showFilterRow(groups) ? filter : 'all';
    return filterGroups(groups, active);
  }, [groups, filter]);

  const newPackage = () => router.push('/new');

  if (loading) return <HomeSkeleton />;

  // Anything that isn't "still loading" gets a real answer, never the skeleton.
  if (error || !disclosure) return <HomeError message={error} onRetry={load} />;

  // 03: everything on the right of the top bar is earned.
  const showSearch = DISCLOSURE.showSearch(disclosure);
  const showBell = DISCLOSURE.showNotifications(disclosure);

  const topBarRight = (
    <>
      {showSearch && (
        <button
          onClick={() => {
            // The palette owns search; the field is its affordance.
            document.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'k', metaKey: true })
            );
          }}
          className="hidden items-center gap-2 whitespace-nowrap rounded-[10px] bg-stiko-app px-3 py-[7px] text-[12.5px] text-stiko-faint transition duration-150 hover:text-stiko-muted md:flex"
        >
          <svg
            className="h-[15px] w-[15px]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
          >
            <path d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
          </svg>
          Search packages, files, comments
        </button>
      )}
      {showBell && (
        <RailToggle
          open={railOpen}
          hasUnread={notifications.some((n) => !n.readAt)}
          onToggle={toggleRail}
        />
      )}
      <AvatarMenu />
    </>
  );

  // 3e — first run. Nothing at all to show.
  if (packages.length === 0 && projects.length === 0) {
    const firstName = (session?.user?.name ?? '').split(' ')[0];
    return (
      <Shell>
        <TopBar right={<AvatarMenu />} />
        <Column width={900}>
          <EmptyState
            size="lg"
            heading={`Welcome to Stiko${firstName ? `, ${firstName}` : ''}`}
            description="Drop a set of drawings, invite the people who need to see them, and every comment lands as a note pinned exactly where it belongs."
            actionLabel="Send your first drawings for review"
            onAction={newPackage}
            explainers={[
              {
                title: 'Drop your files',
                body: 'Drawings, models, PDFs. Folders keep their structure.',
              },
              {
                title: 'Invite reviewers',
                body: 'They get an email and land straight on the file.',
              },
              {
                title: 'Collect the notes',
                body: 'Every comment stays pinned where it belongs.',
              },
            ]}
          />
          <p className="mt-8 text-center text-[12.5px] text-stiko-faint">
            Waiting on an invite instead? It&apos;ll arrive by email — nothing to
            set up here.
          </p>

        </Column>

        {/* Absent for a real first run — see the dashboardIsEmpty effect
            above. It reappears only if this screen is the aftermath of
            deleting everything, which is the one case where the trash has
            something in it and no other door. */}
        {hasTrash && <TrashButton onClick={() => setTrashOpen(true)} />}
        <TrashPanel
          isOpen={trashOpen}
          onClose={() => setTrashOpen(false)}
          onRestored={load}
        />
        <CommandPalette packages={packages} onNewPackage={newPackage} />
      </Shell>
    );
  }

  const visiblePackages = visible.flatMap((g) => g.packages);
  const needsYouCount = visiblePackages.filter(needsYou).length;
  const subline = [
    `${visible.length} ${visible.length === 1 ? 'project' : 'projects'}`,
    `${visiblePackages.length} ${visiblePackages.length === 1 ? 'package' : 'packages'}`,
    needsYouCount > 0 ? `${needsYouCount} need you` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // The last selection, not the current one — both panels keep rendering it
  // while they animate shut.
  const panelGroup = groups.find((g) => g.project.id === lastId) ?? null;
  const panelOpen = selected !== null && panelGroup !== null;

  // Whichever entry point was used last — the avatar stack (people) or the
  // card's ⤢ control (manage) — wins; the other is always null at that point,
  // since opening either sets the other back to null via the shared onClose.
  const panelProjectId = peoplePanelProjectId ?? managePanelProjectId;
  const panelView: 'everyone' | 'packages' =
    peoplePanelProjectId !== null ? 'everyone' : 'packages';

  return (
    <Shell>
      <TopBar right={topBarRight} />

      {/* Clicking the page background deselects. Everything that would be
          closing the thing you just clicked inside of — a card, the panels,
          the rail, the header's own controls — stops the event itself.

          From lg up this is a row: rail (left, via its own lg:order-first),
          card grid, Packages panel. Below lg it is a scrolling column of grid
          then rail, and the Packages panel is a fixed overlay. */}
      <div
        onClick={() => setSelected(null)}
        className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-1 lg:flex-row lg:gap-3 lg:overflow-visible"
      >
        {/* flex-none (not flex-1) below lg: this is a flex column here, and
            the rail is shrink-0 with a content-driven height — once the rail's
            content is taller than this row (a handful of notifications is
            enough on a phone), flex-1's flex-basis:0% has nothing to grow into
            and the column collapses to 0px, rendering the grid UNDER the rail
            instead of above it. flex-none makes this column size to its own
            content. lg:flex-1 restores fill-remaining-space once the layout is
            a row. Every child is shrink-0: this is a scrolling flex column
            from lg up, and a shrinkable child would be squashed instead of
            scrolled. */}
        <div className="flex min-h-0 flex-none flex-col lg:min-w-[240px] lg:flex-1 lg:overflow-y-auto lg:px-2">
          <div className="flex shrink-0 flex-wrap items-end justify-between gap-4 px-[2px] pb-4 pt-5">
            <div>
              {/* Title and count share a baseline rather than stacking: the
                  count is an attribute of the title, not a second heading, and
                  side by side it reads as one line instead of two. */}
              <div className="flex flex-wrap items-baseline gap-3">
                <h1 className="text-[20px] font-extrabold tracking-title text-stiko-ink">
                  Your projects
                </h1>
                <p className="text-[12.5px] text-stiko-muted">{subline}</p>
              </div>
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
                      onClick={() => changeFilter(key)}
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

          <ProjectGrid
            groups={visible}
            selectedId={selected}
            onToggle={toggleProject}
            onOpenPeople={openPeoplePanel}
            onOpenPanel={openManagePanel}
          />

          {/* Trash's row. From lg up it is the column's last child: mt-auto
              drops it to the column's bottom when the grid is short, and
              sticky bottom-0 pins it there while a long grid scrolls under
              it. Being inside the scroll container's content box is what
              lines it up with the cards' right edge and keeps it off the
              scrollbar — and as the Packages panel opens and this column
              narrows, it travels left with the column's edge. It also takes
              space at the end of the content, so the last row of cards always
              scrolls clear of it. Below lg the button is fixed instead (see
              TrashButton) and this row collapses to nothing.
              pointer-events-none so the strip never blocks the cards behind
              it; the button re-enables its own. */}
          <div className="pointer-events-none z-10 shrink-0 lg:sticky lg:bottom-0 lg:mt-auto lg:flex lg:justify-end lg:px-1 lg:pt-4">
            <TrashButton docked onClick={() => setTrashOpen(true)} />
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
                group={panelGroup}
                open={selected !== null}
                onClose={() => setSelected(null)}
              />
            }
          />
        )}

        <PackagesPanel
          group={panelGroup}
          open={panelOpen}
          onClose={() => setSelected(null)}
          onOpenPeople={openPeoplePanel}
        />
      </div>

      <NewProjectModal
        isOpen={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreated={load}
      />
      <ProjectPanel
        group={groups.find((g) => g.project.id === panelProjectId) ?? null}
        isOpen={panelProjectId !== null}
        onClose={() => {
          setPeoplePanelProjectId(null);
          setManagePanelProjectId(null);
        }}
        onChanged={load}
        initialView={panelView}
      />
      <TrashPanel
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        onRestored={load}
      />
      <CommandPalette packages={packages} onNewPackage={newPackage} />
    </Shell>
  );
}

/**
 * The trash door — bottom-right.
 *
 * `docked` is the populated dashboard. From lg up the button sits static in
 * the sticky row at the foot of the card-grid column (see the note at that
 * row), so it is pinned to that column's bottom-right rather than to the
 * window and glides left, never over the Packages panel, as the panel opens.
 *
 * Everywhere else — the welcome screen, and the dashboard below lg where the
 * column is not a fixed-height scroller — it is fixed to the window's corner,
 * on the shell's own 12px gutter. `fixed` resolves against the viewport
 * because no ancestor carries a transform, filter or will-change: the card
 * glides animate transforms on the CARDS, which are siblings, not ancestors.
 * Putting one on an ancestor later would silently re-anchor this button.
 *
 * z-30 is chosen, not inherited: above everything the dashboard paints, below
 * the Packages overlay (z-40) that covers it below lg, and below Drawer
 * (z-58/59) so the trash panel's own scrim covers this button once it opens.
 *
 * Rendered by this file and nowhere else — the trash belongs to the projects
 * dashboard, so it never follows the user into a portal, a settings page or
 * the review viewport.
 */
function TrashButton({
  onClick,
  docked = false,
}: {
  onClick: () => void;
  docked?: boolean;
}) {
  return (
    <button
      type="button"
      // The page root deselects on background click. Without this the click
      // opens the panel and then bubbles up and clears the selection in the
      // same React batch. Harmless on the first-run branch, which has no such
      // handler.
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title="Deleted projects and packages"
      className={`pointer-events-auto fixed bottom-3 right-3 z-30 flex items-center gap-2 rounded-[10px] border border-stiko-sheet bg-white px-[13px] py-2 text-[12.5px] font-bold text-stiko-secondary shadow-stiko-lift transition duration-150 hover:text-stiko-ink hover:shadow-stiko-sheet focus:outline-none focus-visible:shadow-stiko-focus ${
        docked ? 'lg:static' : ''
      }`}
    >
      <svg
        className="h-[13px] w-[13px]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
      </svg>
      Trash
    </button>
  );
}
```

- [ ] **Step 2: Delete the retired list components**

```bash
git rm components/home/ProjectListRow.tsx components/home/ProjectListHeader.tsx components/home/PackageListRow.tsx
```

Then confirm nothing still imports them:

Run: `grep -rn "ProjectListRow\|ProjectListHeader\|PackageListRow" app components lib`
Expected: no output. (A mention inside a comment is fine; an `import` is not.)

- [ ] **Step 3: Type-check, lint and test**

Run: `npx tsc --noEmit`
Expected: no output (exit 0).

Run: `npm run lint`
Expected: `✔ No ESLint warnings or errors`.

Run: `npm test`
Expected: 678 passing, 0 failing.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(home): project cards, packages panel on the right, trash bottom-right

The project list becomes a card grid. Selecting a card opens its
packages in a panel docked on the right; the activity rail moves to
the left; Trash moves to the bottom-right of the grid column and
travels left with it when the panel opens, so it never covers it.

Retires ProjectListRow, ProjectListHeader and PackageListRow.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(The `git rm` in Step 2 already staged the deletions; this commit includes them.)

---

### Task 8: Verify in a real browser, then build

The local account has **zero projects**, so `/` shows the welcome screen unless `/api/home` is stubbed. tsc and lint can't catch any of the traps here: stopPropagation, the transform containing block, sticky positioning, and animation. This task is not optional.

**Files:** none changed unless a defect is found. Fix defects in the file that owns them, re-run Task 7 Step 3, and commit each fix separately.

- [ ] **Step 1: Start the dev server**

In a terminal at the repo root: `npm run dev`. Wait for `✓ Ready`.

- [ ] **Step 2: Open the dashboard with stubbed data**

With chrome-devtools: `new_page` at `http://localhost:3000/`, `resize_page` to 1440×900, then `navigate_page` to `http://localhost:3000/` with this `initScript`. If the page renders the skeleton forever, the bundle was still compiling: navigate again.

```js
(() => {
  const iso = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const people = [
    { id: 'u1', name: 'Mara Ellison', role: 'commenter' },
    { id: 'u2', name: 'Tobi Adeyemi', role: 'viewer' },
    { id: 'u3', name: 'Ana Costa', role: 'uploader' },
    { id: 'u4', name: 'Kwan Park', role: 'viewer' },
    { id: 'u5', name: 'Priya Nair', role: 'commenter' },
  ];
  const P = (id, name, projectId, projectName, over) => ({
    id, name, tag: null, projectId, projectName, status: 'in_review',
    versionNumber: 1, changelog: null, fileCount: 4, openComments: 0,
    updatedAt: iso(5), updatedByName: 'Mara Ellison', people,
    seenLatest: true, mentions: 0, ...over,
  });
  const packages = [
    P('k1', 'Structural steel — GA drawings', 'p1', 'Riverside Depot — Phase 2', { status: 'changes_requested', versionNumber: 4, changelog: 'Revised column grid', openComments: 7, fileCount: 12, mentions: 2 }),
    P('k2', 'Loading bay canopy', 'p1', 'Riverside Depot — Phase 2', { versionNumber: 2, openComments: 4, seenLatest: false }),
    P('k3', 'Site setup — hoarding', 'p1', 'Riverside Depot — Phase 2', { status: 'no_files', versionNumber: null, fileCount: 0, updatedAt: null }),
    P('k4', 'Level 3 partitions', 'p2', 'Harbour Point Fit-Out', { versionNumber: 6, openComments: 3, seenLatest: false }),
    P('k5', 'Switchroom layout', 'p3', 'Kingsway Substation', { status: 'approved', versionNumber: 2, people: people.slice(0, 2) }),
    P('k6', 'Block A — plans and sections', 'p4', 'Oak Lane Housing', { versionNumber: 5, openComments: 5 }),
    P('k7', 'Block B — plans and sections', 'p4', 'Oak Lane Housing', { status: 'draft', versionNumber: 3 }),
    P('k8', 'Deck waterproofing', 'p5', 'Northgate Interchange', { versionNumber: 3, openComments: 2, mentions: 1 }),
  ];
  const projects = [
    { id: 'p1', name: 'Riverside Depot — Phase 2', ownedByMe: true, createdByName: 'You', myRole: 'owner' },
    { id: 'p2', name: 'Harbour Point Fit-Out', ownedByMe: false, createdByName: 'Ana Costa', myRole: 'commenter' },
    { id: 'p3', name: 'Kingsway Substation', ownedByMe: true, createdByName: 'You', myRole: 'owner' },
    { id: 'p4', name: 'Oak Lane Housing', ownedByMe: true, createdByName: 'You', myRole: 'owner' },
    { id: 'p5', name: 'Northgate Interchange', ownedByMe: false, createdByName: 'Kwan Park', myRole: 'viewer' },
    { id: 'p6', name: 'Empty Project', ownedByMe: true, createdByName: 'You', myRole: 'owner' },
  ];
  const home = {
    packages, projects, isGuestOnly: false,
    disclosure: { packageCount: 8, fileCount: 40, notificationCount: 2, needsYouCount: 4, packagesInProject: 0, peopleCount: 0, reviewerCount: 0, hasPublishedVersion: true, versionCount: 0 },
  };
  const notifications = [
    { id: 'n1', type: 'mention', title: 'Mara Ellison mentioned you', excerpt: null, href: '/', createdAt: iso(2), readAt: null, portalId: 'k1', packageName: 'Structural steel — GA drawings', projectId: 'p1', projectName: 'Riverside Depot — Phase 2', actorId: 'u1', actorName: 'Mara Ellison' },
    { id: 'n2', type: 'new_version', title: 'Ana Costa published V6', excerpt: null, href: '/', createdAt: iso(5), readAt: null, portalId: 'k4', packageName: 'Level 3 partitions', projectId: 'p2', projectName: 'Harbour Point Fit-Out', actorId: 'u3', actorName: 'Ana Costa' },
  ];
  window.__stub = { home, notifications };
  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const json = (b) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    if (url.indexOf('/api/home') !== -1) return json(window.__stub.home);
    if (url.indexOf('/api/notifications') !== -1 && !(init && init.method && init.method !== 'GET')) return json(window.__stub.notifications);
    return realFetch.apply(this, arguments);
  };
})();
```

Take a screenshot. Expected: six cards in a grid, the Activity rail on the **left**, no Packages panel, and Trash at the bottom-right of the grid column.

- [ ] **Step 3: Selection, glide and Trash position**

Run this with `evaluate_script`:

```js
async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const trashRect = () => document.querySelector('button[title="Deleted projects and packages"]').getBoundingClientRect();
  const before = trashRect();
  const card = document.querySelector('[data-glide="p1"]');
  card.querySelector(':scope > button[aria-pressed]').click();
  let maxGlides = 0;
  for (let i = 0; i < 40; i++) {
    await wait(16);
    const glides = document.getAnimations().filter((a) =>
      a.effect && a.effect.target && a.effect.target.hasAttribute &&
      a.effect.target.hasAttribute('data-glide') &&
      a.effect.getKeyframes().some((k) => k.transform && k.transform !== 'none'));
    maxGlides = Math.max(maxGlides, glides.length);
  }
  await wait(300);
  const panel = document.querySelector('section[aria-label="Packages in Riverside Depot — Phase 2"]').getBoundingClientRect();
  const after = trashRect();
  return {
    pressed: card.querySelector(':scope > button').getAttribute('aria-pressed'),
    maxGlides,
    trashBefore: [Math.round(before.right), Math.round(before.bottom)],
    trashAfter: [Math.round(after.right), Math.round(after.bottom)],
    panelLeft: Math.round(panel.left),
    trashClearsPanel: after.right <= panel.left,
    viewportBottom: innerHeight,
  };
}
```

Expected:
- `pressed` is `"true"`
- `maxGlides` ≥ 1: cards glided across the column change instead of jumping
- `trashAfter[0]` < `trashBefore[0]`: Trash moved left with the column
- `trashClearsPanel` is `true`
- `trashBefore[1]` and `trashAfter[1]` are both `viewportBottom − 12` (±1)

Take a screenshot. It should match the handoff's layout: summary panel over the feed on the left, the selected card with a 2px border, and the Packages panel on the right. The panel shows three packages with the "2 mentions" and "New version" pills, "NO FILES YET" hidden on the unversioned package, and "Add a package" at the bottom.

- [ ] **Step 4: Every way of deselecting**

Check each of these with a fresh `evaluate_script`, reselecting `p1` first each time. After each, wait 700ms and assert that `document.querySelector('[data-glide="p1"] > button').getAttribute('aria-pressed') === 'false'` and that the panel wrapper's computed `visibility` is `hidden`:

1. Click the same card's toggle again.
2. Click `button[aria-label="Close packages"]`.
3. Click `button[aria-label="Close the summary and deselect the project"]`.
4. Click the page background, e.g. the grid element's empty area: `document.querySelector('[data-glide]').parentElement.parentElement.click()`.
5. Click "Owned by me".

Also check that clicking **inside** the open panel (e.g. on its "Packages" label) does NOT deselect.

Expected: all five deselect; the in-panel click does not. While the panel closes, sample its `<h2>` text at 100ms. It must still read the project name, proving the `lastId` retention.

- [ ] **Step 5: Inner buttons open the drawer without toggling the card**

With `p1` unselected, click `[data-glide="p1"] button[aria-label="Manage Riverside Depot — Phase 2"]`. Expected: the ProjectPanel drawer opens, and the card's `aria-pressed` stays `"false"`. Close the drawer with Escape. Then click the card's `button[title="People on this project"]`. Expected: the drawer opens on the people view, and the card stays unselected.

- [ ] **Step 6: Rail toggle and the one-project case**

- Click the header bell: `header button[aria-label="Hide activity"]`. Scope it to `header`, because the feed's own collapse chevron carries the same label. Expected: the rail collapses to width 0, the cards glide, and the bell shows the unread dot. Click `header button[aria-label="Show activity"]` to bring it back.
- Navigate again with a copy of the Step 2 `initScript` in which the `const home = {` line's first entries read `packages: packages.filter((p) => p.projectId === 'p1'), projects: projects.slice(0, 1),` in place of `packages, projects,`. Expected: one card about 220–300px wide, **not** stretched across the column.

- [ ] **Step 7: Narrow widths**

- `resize_page` to 1100×800 and select `p1`. Expected: rail + one-column grid + panel, with no horizontal page scroll (`document.documentElement.scrollWidth <= innerWidth`).
- `resize_page` to 390×844 and reload with the stub. Expected: the grid is above the rail. Trash is fixed at the viewport's bottom-right: its rect's right is 390 − 12 and its bottom is 844 − 12. Selecting a card slides the Packages overlay in from the right over the grid, and "Close packages" slides it back out.

- [ ] **Step 8: Welcome screen Trash**

Navigate to `http://localhost:3000/` with this `initScript`:

```js
(() => {
  const TRASH = [{ id: 't1' }];
  const empty = {
    packages: [], projects: [], isGuestOnly: false,
    disclosure: { packageCount: 0, fileCount: 0, notificationCount: 0, needsYouCount: 0, packagesInProject: 0, peopleCount: 0, reviewerCount: 0, hasPublishedVersion: false, versionCount: 0 },
  };
  const realFetch = window.fetch;
  window.fetch = function (input) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const json = (b) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    if (url.indexOf('/api/home') !== -1) return json(empty);
    if (url.indexOf('/api/notifications') !== -1) return json([]);
    if (url.indexOf('/api/trash') !== -1) return json(TRASH);
    return realFetch.apply(this, arguments);
  };
})();
```

Expected: the welcome screen, with Trash fixed at the bottom-right (rect right = `innerWidth − 12`, bottom = `innerHeight − 12`).

Navigate again with the same script, with `const TRASH = [];`. Expected: no Trash button (`document.querySelector('button[title="Deleted projects and packages"]')` is `null`).

- [ ] **Step 9: Stop the dev server, then build**

Stop `npm run dev` (Ctrl-C in its terminal). A build and a dev server share `.next`.

Run:

```bash
AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' \
R2_ACCESS_KEY_ID=dev R2_SECRET_ACCESS_KEY=dev \
R2_ENDPOINT_URL='https://example.invalid' R2_BUCKET_NAME=dev npm run build
```

Expected: `✓ Compiled successfully` and the route table, with no type or lint errors.

- [ ] **Step 10: Final checks**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: 678 passing, no tsc output, `✔ No ESLint warnings or errors`.

Run: `git status --short`
Expected: only the four untracked handoff folders (`design_handoff_brief_section/`, `design_handoff_dashboard_redesign/`, `design_handoff_portal_view/`, `stiko_handoff/`) and nothing else.

## Shipping (after Task 8, with the user's go-ahead)

Merging to `main` deploys to production; there is no staging. Before merging, state the rollback: `git revert -m 1 <merge sha>`. It's clean: no migration, and nothing on this branch writes data.
