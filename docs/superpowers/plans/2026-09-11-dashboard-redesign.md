# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat package list on `app/page.tsx` with a grid of project cards plus a global activity rail, fixing the four faults in `docs/superpowers/specs/2026-09-11-dashboard-redesign-design.md`.

**Architecture:** `/api/home` keeps its flat `packages: PackageCard[]` byte-identical and gains an additive `projects: ProjectSummary[]`. All grouping, roll-ups, people unions and stat tiles are pure functions over that already-permission-scoped array, so no derived number can include a package the viewer may not see. No database migration.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind, `@neondatabase/serverless` tagged-template SQL, `node:test` for unit tests.

## Global Constraints

- **No database migration.** No schema change of any kind. If a task seems to need one, stop and raise it.
- **Tests are `node --test` over pure `lib/` modules.** Run with `npm test`. The repo has **no React testing library** and 527 passing pure-logic tests. Follow that pattern: `lib/` gets TDD, components are verified in the browser (Task 10). Do **not** add a component test framework.
- **Tests import `.ts` directly** (`import { x } from '../../lib/x.ts'`) and run under Node's native type stripping. Node v25.9.0 is in use.
- **A VALUE import between unit-tested `lib/` modules must be relative AND carry an explicit `.ts` extension** — `import { NOTES } from './design.ts'`. Two separate failures otherwise, both verified empirically against this repo on 2026-09-11: the `@/` alias gives `ERR_MODULE_NOT_FOUND: Cannot find package '@/lib'` because Node's resolver knows nothing of `tsconfig.json` paths, and an extensionless relative path gives `ERR_MODULE_NOT_FOUND: Cannot find module '.../lib/design'` because Node's ESM resolver does no extension guessing. `lib/s3.ts` and `lib/storageKeys.ts` already import siblings this way. `tsconfig.json` already sets `allowImportingTsExtensions: true` and `moduleResolution: bundler`, so `tsc` and webpack both accept it. Components and route handlers are not run by `node --test` and may keep using `@/`.
- **A type-only import is erased, and that is load-bearing.** `lib/home.ts` imports types from `lib/queries.ts`, which imports `lib/db` and throws at module load without `DATABASE_URL`. Writing `import type { ... }` means the test never loads it. Writing a plain `import` would make every `lib/home.ts` test require a database.
- **Use Tailwind tokens for colour where one exists.** Two exceptions match what the codebase already does: a value passed as an inline `style` (how `StatusChip` and `RolePill` render colours that come from a TS map), and the primary gradient's arbitrary-value classes `from-[#8094F5] to-[#5B60FF]`, which `Button.tsx` and `Shell.tsx` already spell exactly that way. Every token exists in `tailwind.config.ts` except `shadow-stiko-card`, added in Task 6.
- **Never `git add -A` in this repo.** Four long-lived untracked directories (`design_handoff_*`, `stiko_handoff/`) get swept into unrelated commits. Stage files by exact path.
- **Tailwind arbitrary-value overrides do not cascade by class order.** `<SectionLabel className="text-[10px]">` will NOT reliably override the component's built-in `text-[11px]` — equal specificity means stylesheet source order decides. Where the design calls for a size a primitive does not have, write the element inline rather than fighting it.
- **Copy rule:** "Package" in all user-visible strings, "Portal" only in code and routes.
- `main` deploys straight to production and there is no staging environment. Nothing merges until Task 10 passes.

---

### Task 1: Role vocabulary (`lib/roles.ts`)

Stiko has two role tables: `participants.role` is `viewer|commenter|uploader`, `project_members.role` is `owner|coordinator` (`lib/migrations/001-redesign.sql:54`). The card chip and the people drawer both need to rank across both, and the drawer needs a full-word pill. That is one coherent unit, so it gets its own module rather than being buried in `lib/home.ts`.

**Files:**
- Create: `lib/roles.ts`
- Test: `scripts/tests/roles.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ProjectRole = 'owner' | 'coordinator' | 'uploader' | 'commenter' | 'viewer'`
  - `ROLE_RANK: Record<ProjectRole, number>`
  - `highestRole(roles: (string | null | undefined)[]): ProjectRole | null`
  - `roleLabel(role: string | null | undefined): string`
  - `interface RoleTagSpec { bg: string; fg: string }`
  - `roleTagSpec(role: string | null | undefined): RoleTagSpec | null`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/roles.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_RANK,
  highestRole,
  roleLabel,
  roleTagSpec,
} from '../../lib/roles.ts';

// The two role vocabularies are stored in different tables and must be
// comparable, because a project-level role is derived from whichever is
// strongest across the packages the viewer can see.
test('project roles outrank package roles', () => {
  assert.ok(ROLE_RANK.owner > ROLE_RANK.coordinator);
  assert.ok(ROLE_RANK.coordinator > ROLE_RANK.uploader);
  assert.ok(ROLE_RANK.uploader > ROLE_RANK.commenter);
  assert.ok(ROLE_RANK.commenter > ROLE_RANK.viewer);
});

test('highestRole picks the strongest role across packages', () => {
  assert.equal(highestRole(['viewer', 'uploader', 'commenter']), 'uploader');
  assert.equal(highestRole(['commenter', 'commenter']), 'commenter');
  assert.equal(highestRole(['viewer']), 'viewer');
});

test('highestRole ignores nulls, blanks and unknown roles', () => {
  // An unrecognised role must not win by accident: the database CHECK
  // constraint can gain a value the TypeScript union has not.
  assert.equal(highestRole([null, 'commenter', undefined]), 'commenter');
  assert.equal(highestRole(['reviewer', 'viewer']), 'viewer');
  assert.equal(highestRole([]), null);
  assert.equal(highestRole([null, 'reviewer']), null);
});

test('roleLabel title-cases for the ownership chip', () => {
  assert.equal(roleLabel('commenter'), 'Commenter');
  assert.equal(roleLabel('uploader'), 'Uploader');
  assert.equal(roleLabel(null), '');
});

test('role tag colours match the existing role palette', () => {
  assert.deepEqual(roleTagSpec('owner'), { bg: '#EBE4FD', fg: '#6b4fc4' });
  assert.deepEqual(roleTagSpec('uploader'), { bg: '#EBE4FD', fg: '#6b4fc4' });
  assert.deepEqual(roleTagSpec('coordinator'), { bg: '#F1F3FF', fg: '#5B60FF' });
  assert.deepEqual(roleTagSpec('commenter'), { bg: '#EDFFDA', fg: '#4B7A28' });
  assert.deepEqual(roleTagSpec('viewer'), { bg: '#E2F2FF', fg: '#2f7fc4' });
});

test('an unknown role has no tag rather than a blank one', () => {
  assert.equal(roleTagSpec('reviewer'), null);
  assert.equal(roleTagSpec(null), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/roles.test.mjs`
Expected: FAIL — `Cannot find module` for `lib/roles.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/roles.ts`:

```typescript
import { NOTES } from './design';

/**
 * The two role vocabularies, ranked against each other.
 *
 * `project_members.role` is owner|coordinator; `participants.role` is
 * viewer|commenter|uploader (lib/migrations/001-redesign.sql). A project-level
 * role is DERIVED, never stored — see the design spec. Ranking them in one
 * place is what makes that derivation auditable.
 */
export type ProjectRole =
  | 'owner'
  | 'coordinator'
  | 'uploader'
  | 'commenter'
  | 'viewer';

export const ROLE_RANK: Record<ProjectRole, number> = {
  owner: 5,
  coordinator: 4,
  uploader: 3,
  commenter: 2,
  viewer: 1,
};

function isRole(value: unknown): value is ProjectRole {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(ROLE_RANK, value)
  );
}

/**
 * The strongest role in a list, ignoring anything unrecognised.
 *
 * Unknown roles return null rather than ranking at zero, so a role added to the
 * database CHECK constraint but not to this union can never silently outrank a
 * real one.
 */
export function highestRole(
  roles: (string | null | undefined)[]
): ProjectRole | null {
  let best: ProjectRole | null = null;
  for (const role of roles) {
    if (!isRole(role)) continue;
    if (best === null || ROLE_RANK[role] > ROLE_RANK[best]) best = role;
  }
  return best;
}

/** "commenter" -> "Commenter", for the `Invited · {Role}` chip. */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return '';
  return role[0].toUpperCase() + role.slice(1);
}

export interface RoleTagSpec {
  bg: string;
  fg: string;
}

/**
 * Full-word role pill colours. Distinct from ROLE_PILL in Primitives.tsx, which
 * is a fixed 30x24 single-letter tile for the access matrix and whose type
 * excludes owner and coordinator entirely.
 */
const ROLE_TAG: Record<ProjectRole, RoleTagSpec> = {
  owner: { bg: NOTES.purple.pastel, fg: NOTES.purple.text },
  uploader: { bg: NOTES.purple.pastel, fg: NOTES.purple.text },
  coordinator: { bg: '#F1F3FF', fg: '#5B60FF' },
  commenter: { bg: NOTES.green.pastel, fg: NOTES.green.text },
  viewer: { bg: NOTES.blue.pastel, fg: NOTES.blue.text },
};

export function roleTagSpec(
  role: string | null | undefined
): RoleTagSpec | null {
  return isRole(role) ? ROLE_TAG[role] : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tests/roles.test.mjs`
Expected: PASS, 6 tests.

If `NOTES.purple.pastel` is not `#EBE4FD`, read `lib/design.ts:19` and use the literal hexes from the test instead — the test is the contract.

- [ ] **Step 5: Commit**

```bash
git add lib/roles.ts scripts/tests/roles.test.mjs
git commit -m "feat: rank the two role vocabularies in one place"
```

---

### Task 2: Project grouping and roll-ups (`lib/home.ts`)

**Files:**
- Create: `lib/home.ts`
- Test: `scripts/tests/home.test.mjs`

**Interfaces:**
- Consumes: `ProjectRole`, `highestRole` from `lib/roles.ts` (Task 1).
- Produces:
  - `interface ProjectPerson { id: string; name: string; role: ProjectRole | null; packageCount: number }`
  - `interface ProjectGroup { project: ProjectSummary; packages: PackageCard[]; packageCount: number; openComments: number; people: ProjectPerson[] }`
  - `type HomeFilter = 'all' | 'owned' | 'shared'`
  - `deriveMyRole(input: { ownedByMe: boolean; memberRole: string | null; participantRoles: string[] }): ProjectRole | null`
  - `projectPeople(pkgs: PackageCard[]): ProjectPerson[]`
  - `groupProjects(packages: PackageCard[], projects: ProjectSummary[]): ProjectGroup[]`
  - `filterGroups(groups: ProjectGroup[], filter: HomeFilter): ProjectGroup[]`
  - `showFilterRow(groups: ProjectGroup[]): boolean`
  - `needsYou(pkg: PackageCard): boolean`
  - `homeStats(packages: PackageCard[]): { needsYou: number; openComments: number; inReview: number }`

`PackageCard` and `ProjectSummary` are imported as types from `lib/queries.ts`. `ProjectSummary` does not exist until Task 4 — **create it in Task 4 and do not stub it here.** Instead this task's implementation declares the two shapes it needs structurally, so Task 4's type slots in without an edit. See Step 3.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/home.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveMyRole,
  projectPeople,
  groupProjects,
  filterGroups,
  showFilterRow,
  needsYou,
  homeStats,
} from '../../lib/home.ts';

const pkg = (over = {}) => ({
  id: 'p1',
  name: 'Package',
  tag: null,
  projectId: 'proj1',
  projectName: 'Project',
  status: 'in_review',
  versionNumber: 1,
  changelog: null,
  fileCount: 0,
  openComments: 0,
  updatedAt: null,
  updatedByName: null,
  people: [],
  seenLatest: true,
  mentions: 0,
  ...over,
});

const proj = (over = {}) => ({
  id: 'proj1',
  name: 'Project',
  ownedByMe: true,
  createdByName: 'Maya Chen',
  myRole: 'owner',
  ...over,
});

/* ---------------------------------------------------------------- myRole -- */

test('owning the project beats every other signal', () => {
  assert.equal(
    deriveMyRole({ ownedByMe: true, memberRole: 'coordinator', participantRoles: ['viewer'] }),
    'owner'
  );
});

test('a project member role beats a package participant role', () => {
  assert.equal(
    deriveMyRole({ ownedByMe: false, memberRole: 'coordinator', participantRoles: ['viewer'] }),
    'coordinator'
  );
});

test('a guest falls back to their strongest package role', () => {
  assert.equal(
    deriveMyRole({ ownedByMe: false, memberRole: null, participantRoles: ['viewer', 'commenter'] }),
    'commenter'
  );
});

test('no role anywhere is null, not a default', () => {
  // The chip must degrade to a bare "Invited" rather than inventing a role.
  assert.equal(
    deriveMyRole({ ownedByMe: false, memberRole: null, participantRoles: [] }),
    null
  );
});

/* ---------------------------------------------------------------- people -- */

test('people are the union across packages, with their highest role', () => {
  const people = projectPeople([
    pkg({ id: 'a', people: [{ id: 'u1', name: 'Ada', role: 'viewer' }] }),
    pkg({ id: 'b', people: [{ id: 'u1', name: 'Ada', role: 'uploader' }, { id: 'u2', name: 'Bo', role: 'commenter' }] }),
  ]);

  assert.deepEqual(people, [
    { id: 'u1', name: 'Ada', role: 'uploader', packageCount: 2 },
    { id: 'u2', name: 'Bo', role: 'commenter', packageCount: 1 },
  ]);
});

test('people are ordered by role strength, then by name', () => {
  const people = projectPeople([
    pkg({ people: [
      { id: 'u1', name: 'Zoe', role: 'viewer' },
      { id: 'u2', name: 'Ada', role: 'viewer' },
      { id: 'u3', name: 'Bo', role: 'uploader' },
    ] }),
  ]);
  assert.deepEqual(people.map((p) => p.name), ['Bo', 'Ada', 'Zoe']);
});

test('a person on a package with no role still appears', () => {
  // participants.role is NOT NULL, but the payload is shared with pending
  // invitees, and a missing role must not delete the person from the panel.
  const people = projectPeople([pkg({ people: [{ id: 'u1', name: 'Ada' }] })]);
  assert.deepEqual(people, [{ id: 'u1', name: 'Ada', role: null, packageCount: 1 }]);
});

/* ----------------------------------------------------------------- group -- */

test('packages are grouped under their project with roll-ups', () => {
  const groups = groupProjects(
    [
      pkg({ id: 'a', openComments: 4 }),
      pkg({ id: 'b', openComments: 2 }),
      pkg({ id: 'c', projectId: 'proj2', projectName: 'Other', openComments: 1 }),
    ],
    [proj(), proj({ id: 'proj2', name: 'Other', ownedByMe: false, myRole: 'commenter' })]
  );

  assert.equal(groups.length, 2);
  assert.equal(groups[0].project.id, 'proj1');
  assert.equal(groups[0].packageCount, 2);
  assert.equal(groups[0].openComments, 6);
  assert.equal(groups[1].packageCount, 1);
  assert.equal(groups[1].openComments, 1);
});

test('a project with no packages still gets a card', () => {
  // "New project" creates an empty project, and the empty card IS the prompt
  // to add a package. Dropping it would make the button look broken.
  const groups = groupProjects([], [proj()]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].packageCount, 0);
  assert.deepEqual(groups[0].packages, []);
  assert.deepEqual(groups[0].people, []);
});

test('a package whose project is missing from the payload is still shown', () => {
  // Losing a package because a join went wrong is worse than a card with a
  // thin header: the package is the thing with the user's work in it.
  const groups = groupProjects([pkg({ projectId: 'ghost', projectName: 'Ghost' })], []);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].project.id, 'ghost');
  assert.equal(groups[0].project.name, 'Ghost');
  assert.equal(groups[0].project.ownedByMe, false);
  assert.equal(groups[0].packageCount, 1);
});

/* ---------------------------------------------------------------- filter -- */

test('the filter splits owned from invited', () => {
  const groups = groupProjects(
    [pkg(), pkg({ id: 'c', projectId: 'proj2', projectName: 'Other' })],
    [proj(), proj({ id: 'proj2', name: 'Other', ownedByMe: false, myRole: 'commenter' })]
  );
  assert.deepEqual(filterGroups(groups, 'all').map((g) => g.project.id), ['proj1', 'proj2']);
  assert.deepEqual(filterGroups(groups, 'owned').map((g) => g.project.id), ['proj1']);
  assert.deepEqual(filterGroups(groups, 'shared').map((g) => g.project.id), ['proj2']);
});

test('the filter row needs both an owned and an invited project', () => {
  const oneOwned = groupProjects([pkg()], [proj()]);
  assert.equal(showFilterRow(oneOwned), false);

  // Two owned, none invited: "Shared with me" could never match anything.
  const twoOwned = groupProjects(
    [pkg(), pkg({ id: 'c', projectId: 'proj2', projectName: 'Other' })],
    [proj(), proj({ id: 'proj2', name: 'Other' })]
  );
  assert.equal(showFilterRow(twoOwned), false);

  // A pure guest across two projects: "Owned by me" could never match.
  const twoInvited = groupProjects(
    [pkg(), pkg({ id: 'c', projectId: 'proj2', projectName: 'Other' })],
    [
      proj({ ownedByMe: false, myRole: 'commenter' }),
      proj({ id: 'proj2', name: 'Other', ownedByMe: false, myRole: 'viewer' }),
    ]
  );
  assert.equal(showFilterRow(twoInvited), false);

  // One of each is the only shape where all three buttons mean something.
  const mixed = groupProjects(
    [pkg(), pkg({ id: 'c', projectId: 'proj2', projectName: 'Other' })],
    [proj(), proj({ id: 'proj2', name: 'Other', ownedByMe: false, myRole: 'commenter' })]
  );
  assert.equal(showFilterRow(mixed), true);
});

/* ----------------------------------------------------------------- stats -- */

test('needsYou matches the predicate getHomeData already uses', () => {
  assert.equal(needsYou(pkg({ mentions: 1 })), true);
  assert.equal(needsYou(pkg({ versionNumber: 3, seenLatest: false })), true);
  assert.equal(needsYou(pkg({ versionNumber: 3, seenLatest: true })), false);
  assert.equal(needsYou(pkg({ versionNumber: null, seenLatest: false })), false);
});

test('the rail tiles count over visible packages only', () => {
  const stats = homeStats([
    pkg({ id: 'a', openComments: 3, mentions: 1, status: 'in_review' }),
    pkg({ id: 'b', openComments: 2, status: 'approved' }),
    pkg({ id: 'c', openComments: 0, status: 'in_review' }),
  ]);
  assert.deepEqual(stats, { needsYou: 1, openComments: 5, inReview: 2 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/home.test.mjs`
Expected: FAIL — `Cannot find module` for `lib/home.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/home.ts`:

```typescript
import { highestRole, ROLE_RANK, type ProjectRole } from './roles.ts';
// `import type` is load-bearing: lib/queries.ts imports lib/db, which throws at
// module load without DATABASE_URL. A type-only import is erased, so the unit
// tests never pull a database connection in. Do not turn this into a plain
// import.
import type { PackageCard, ProjectSummary } from './queries.ts';

/**
 * Every derivation the home screen needs, as pure functions over the payload
 * /api/home already returns.
 *
 * The point of keeping them here rather than inside the components: the
 * `packages` array is ALREADY scoped to what the viewer may see, so every count
 * and every avatar derived from it is scoped by construction. There is no
 * second query that could get the permission boundary wrong.
 */

export interface ProjectPerson {
  id: string;
  name: string;
  /** Highest role across the packages the viewer can see. */
  role: ProjectRole | null;
  packageCount: number;
}

export interface ProjectGroup {
  project: ProjectSummary;
  packages: PackageCard[];
  packageCount: number;
  openComments: number;
  people: ProjectPerson[];
}

export type HomeFilter = 'all' | 'owned' | 'shared';

/**
 * The viewer's own role on a project. Owning it wins, then the project_members
 * row, then the strongest role they hold on any visible package.
 */
export function deriveMyRole(input: {
  ownedByMe: boolean;
  memberRole: string | null;
  participantRoles: string[];
}): ProjectRole | null {
  if (input.ownedByMe) return 'owner';
  return highestRole([input.memberRole, ...input.participantRoles]);
}

/** The union of participants across the packages passed in — nothing wider. */
export function projectPeople(pkgs: PackageCard[]): ProjectPerson[] {
  const seen = new Map<string, { name: string; roles: string[]; count: number }>();

  for (const pkg of pkgs) {
    for (const person of pkg.people) {
      const entry = seen.get(person.id);
      if (entry) {
        entry.count += 1;
        if (person.role) entry.roles.push(person.role);
      } else {
        seen.set(person.id, {
          name: person.name,
          roles: person.role ? [person.role] : [],
          count: 1,
        });
      }
    }
  }

  // Ranked with ROLE_RANK rather than a second table: two copies of this
  // ordering is exactly how the panel and the chip would come to disagree.
  const rank = (p: ProjectPerson) => (p.role ? ROLE_RANK[p.role] : 0);

  return Array.from(seen, ([id, v]) => ({
    id,
    name: v.name,
    role: highestRole(v.roles),
    packageCount: v.count,
  })).sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
}

/**
 * The grid's spine. Project order follows the `projects` array (which /api/home
 * returns in package-recency order), then any project referenced only by a
 * package.
 */
export function groupProjects(
  packages: PackageCard[],
  projects: ProjectSummary[]
): ProjectGroup[] {
  const byProject = new Map<string, PackageCard[]>();
  for (const pkg of packages) {
    const list = byProject.get(pkg.projectId);
    if (list) list.push(pkg);
    else byProject.set(pkg.projectId, [pkg]);
  }

  const known = new Map(projects.map((p) => [p.id, p]));
  const ids = [
    ...projects.map((p) => p.id),
    ...Array.from(byProject.keys()).filter((id) => !known.has(id)),
  ];

  return ids.map((id) => {
    const pkgs = byProject.get(id) ?? [];
    // A package whose project is absent from the payload keeps its card rather
    // than disappearing: the package holds the user's work, the project header
    // is only a label.
    const project: ProjectSummary = known.get(id) ?? {
      id,
      name: pkgs[0]?.projectName ?? 'Project',
      ownedByMe: false,
      createdByName: null,
      myRole: null,
    };

    return {
      project,
      packages: pkgs,
      packageCount: pkgs.length,
      openComments: pkgs.reduce((n, p) => n + p.openComments, 0),
      people: projectPeople(pkgs),
    };
  });
}

export function filterGroups(
  groups: ProjectGroup[],
  filter: HomeFilter
): ProjectGroup[] {
  if (filter === 'all') return groups;
  const wantOwned = filter === 'owned';
  return groups.filter((g) => g.project.ownedByMe === wantOwned);
}

/**
 * 03's ladder: never render a control with nothing to control.
 *
 * Both an owned and an invited project must exist. With only owned projects
 * "Shared with me" can never match; with only invited ones "Owned by me" can
 * never match — and a row carrying a permanently empty button is exactly the
 * dead control the ladder exists to remove.
 */
export function showFilterRow(groups: ProjectGroup[]): boolean {
  const owned = groups.filter((g) => g.project.ownedByMe).length;
  return owned >= 1 && groups.length - owned >= 1;
}

/**
 * Deliberately the same predicate getHomeData uses for `needsYouCount`, so the
 * rail tile and the disclosure signal cannot drift apart.
 */
export function needsYou(pkg: PackageCard): boolean {
  return pkg.mentions > 0 || (pkg.versionNumber != null && !pkg.seenLatest);
}

export function homeStats(packages: PackageCard[]): {
  needsYou: number;
  openComments: number;
  inReview: number;
} {
  return {
    needsYou: packages.filter(needsYou).length,
    openComments: packages.reduce((n, p) => n + p.openComments, 0),
    inReview: packages.filter((p) => p.status === 'in_review').length,
  };
}
```

`ProjectSummary` does not exist yet, so `tsc` will fail on this file until Task 4. That is expected and is why Task 4 immediately follows. The `node --test` run works regardless, because Node strips types without checking them.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tests/home.test.mjs`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/home.ts scripts/tests/home.test.mjs
git commit -m "feat: pure project grouping and roll-ups for home"
```

---

### Task 3: Activity derivations (`lib/home.ts`)

**Files:**
- Modify: `lib/home.ts` (append)
- Test: `scripts/tests/homeActivity.test.mjs`

**Interfaces:**
- Consumes: `lib/home.ts` from Task 2.
- Produces:
  - `type ActivityBadge = 'MENTION' | 'ACTION' | 'NEW' | null`
  - `interface ActivityAccent { badge: ActivityBadge; border: string | null; bg: string | null }`
  - `activityAccent(type: string): ActivityAccent`
  - `groupActivity<T extends { createdAt: string }>(rows: T[], now?: number): { label: string; items: T[] }[]`

`groupActivity` is generic over `{ createdAt: string }` rather than importing `NotificationRow`, which lives in a component file (`components/shell/NotificationTray.tsx`). `lib/` must not import from `components/`.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/homeActivity.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityAccent, groupActivity } from '../../lib/home.ts';

/* ---------------------------------------------------------------- accent -- */

test('mentions and requested changes are the red, attention-carrying kinds', () => {
  assert.deepEqual(activityAccent('mention'), {
    badge: 'MENTION', border: '#FF6B6B', bg: '#F6F8FE',
  });
  assert.deepEqual(activityAccent('changes_requested'), {
    badge: 'ACTION', border: '#FF6B6B', bg: '#F6F8FE',
  });
});

test('a new version is yellow and badged NEW', () => {
  assert.deepEqual(activityAccent('new_version'), {
    badge: 'NEW', border: '#FFCF2E', bg: '#F6F8FE',
  });
});

test('ordinary activity carries no badge and no fill', () => {
  // The border stays null so the component can render a TRANSPARENT 3px
  // border: without it, text baselines shift between the two kinds of row.
  for (const type of ['comment_reply', 'new_comment', 'invite_accepted', 'approved']) {
    assert.deepEqual(activityAccent(type), { badge: null, border: null, bg: null }, type);
  }
});

test('an unknown notification type degrades to plain, not to a crash', () => {
  // The CHECK constraint can gain a type before this map does.
  assert.deepEqual(activityAccent('something_new'), { badge: null, border: null, bg: null });
});

/* ----------------------------------------------------------------- group -- */

const NOW = Date.parse('2026-09-11T15:00:00Z');
const at = (iso) => ({ createdAt: iso });

test('activity is bucketed by recency, newest group first', () => {
  const groups = groupActivity(
    [
      at('2026-09-11T09:00:00Z'),
      at('2026-09-10T22:00:00Z'),
      at('2026-09-08T10:00:00Z'),
      at('2026-08-01T10:00:00Z'),
    ],
    NOW
  );

  assert.deepEqual(groups.map((g) => g.label), [
    'Today', 'Yesterday', 'Earlier this week', 'Earlier',
  ]);
  assert.equal(groups[0].items.length, 1);
});

test('empty buckets are not rendered', () => {
  const groups = groupActivity([at('2026-09-11T09:00:00Z')], NOW);
  assert.deepEqual(groups.map((g) => g.label), ['Today']);
});

test('no activity produces no groups at all', () => {
  assert.deepEqual(groupActivity([], NOW), []);
});

test('items keep newest-first order inside a bucket', () => {
  const groups = groupActivity(
    [at('2026-09-11T09:00:00Z'), at('2026-09-11T13:00:00Z')],
    NOW
  );
  assert.deepEqual(
    groups[0].items.map((i) => i.createdAt),
    ['2026-09-11T13:00:00Z', '2026-09-11T09:00:00Z']
  );
});

test('a future timestamp lands in Today rather than vanishing', () => {
  // Clock skew between the database and the browser is real and must not
  // silently drop a row out of every bucket.
  const groups = groupActivity([at('2026-09-11T23:59:00Z')], NOW);
  assert.deepEqual(groups.map((g) => g.label), ['Today']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/homeActivity.test.mjs`
Expected: FAIL — `activityAccent is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/home.ts`:

```typescript
/* -------------------------------------------------------------------------- */
/* Activity rail                                                              */
/* -------------------------------------------------------------------------- */

export type ActivityBadge = 'MENTION' | 'ACTION' | 'NEW' | null;

export interface ActivityAccent {
  badge: ActivityBadge;
  /** 3px left border. Null means the row renders a TRANSPARENT border, so
   *  baselines line up with the accented rows beside it. */
  border: string | null;
  bg: string | null;
}

const PLAIN: ActivityAccent = { badge: null, border: null, bg: null };

const ACCENTS: Record<string, ActivityAccent> = {
  mention: { badge: 'MENTION', border: '#FF6B6B', bg: '#F6F8FE' },
  changes_requested: { badge: 'ACTION', border: '#FF6B6B', bg: '#F6F8FE' },
  new_version: { badge: 'NEW', border: '#FFCF2E', bg: '#F6F8FE' },
};

/** Unknown types degrade to plain — the CHECK constraint can outrun this map. */
export function activityAccent(type: string): ActivityAccent {
  return ACCENTS[type] ?? PLAIN;
}

const DAY = 86_400_000;

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Recency buckets for the feed. Generic over `{ createdAt }` so lib/ does not
 * have to import a type that lives in a component.
 */
export function groupActivity<T extends { createdAt: string }>(
  rows: T[],
  now: number = Date.now()
): { label: string; items: T[] }[] {
  const today = startOfLocalDay(now);
  const buckets: { label: string; items: T[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Earlier this week', items: [] },
    { label: 'Earlier', items: [] },
  ];

  for (const row of [...rows].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  )) {
    const t = Date.parse(row.createdAt);
    // A future timestamp (clock skew between Neon and the browser is real)
    // belongs in Today, not nowhere.
    if (Number.isNaN(t) || t >= today) buckets[0].items.push(row);
    else if (t >= today - DAY) buckets[1].items.push(row);
    else if (t >= today - 7 * DAY) buckets[2].items.push(row);
    else buckets[3].items.push(row);
  }

  return buckets.filter((b) => b.items.length > 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tests/homeActivity.test.mjs`
Expected: PASS, 8 tests.

Note: the bucket tests use local-time day boundaries. If the machine's timezone puts `2026-09-11T09:00:00Z` on a different local day than `NOW`, the assertions still hold because both are compared against the same local midnight.

- [ ] **Step 5: Commit**

```bash
git add lib/home.ts scripts/tests/homeActivity.test.mjs
git commit -m "feat: activity accents and recency buckets for the rail"
```

---

### Task 4: Data layer — `ProjectSummary` on `/api/home`, project name on notifications

**Files:**
- Modify: `lib/queries.ts:14-232` (the `PackageCard` interface and `getHomeData`)
- Modify: `app/api/notifications/route.ts:11-23` (the GET query)
- Modify: `components/shell/NotificationTray.tsx:9-21` (the `NotificationRow` interface)
- Modify: `lib/disclosure.ts:44-46` (delete `groupByProject`)
- Modify: `scripts/tests/disclosure.test.mjs:14-17` (delete its test)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface ProjectSummary { id: string; name: string; ownedByMe: boolean; createdByName: string | null; myRole: ProjectRole | null }` exported from `lib/queries.ts`
  - `getHomeData` returns `{ packages, projects, disclosure, isGuestOnly }`
  - `PackageCard.people[]` items gain `role?: string`
  - `NotificationRow` gains `projectId: string | null` and `projectName: string | null`

- [ ] **Step 1: Add `ProjectSummary` and widen `PackageCard.people`**

In `lib/queries.ts`, change the `people` line inside `PackageCard` (currently line 26):

```typescript
  people: { id: string; name: string; role?: string; pending?: boolean }[];
```

Then add below the `PackageCard` interface:

```typescript
/**
 * A project as the dashboard needs it. Deliberately additive to the flat
 * PackageCard[] payload rather than nesting packages inside projects: the flat
 * array is consumed by CommandPalette and mirrored on the project page, and
 * every roll-up the grid needs derives from it.
 */
export interface ProjectSummary {
  id: string;
  name: string;
  /** projects.owner_id = the viewer. */
  ownedByMe: boolean;
  /** The owner's name. Rendered as "you" client-side when ownedByMe. */
  createdByName: string | null;
  myRole: ProjectRole | null;
}
```

And add the import at the top of `lib/queries.ts`:

```typescript
import { deriveMyRole } from '@/lib/home';
import type { ProjectRole } from '@/lib/roles';
```

`lib/home.ts` imports types back from `lib/queries.ts`, so this looks circular. It is not at
runtime: that direction is `import type` and is erased. `lib/queries.ts` is not unit-tested and
goes through webpack, so the `@/` alias is fine here.

- [ ] **Step 2: Widen the `visible` CTE**

In `getHomeData`, replace the `visible` CTE select list (currently `lib/queries.ts:41-43`):

```sql
      SELECT DISTINCT po.id, po.name, po.tag, po.project_id,
             pr.name AS project_name,
             (pr.owner_id = ${userId} OR pm.user_id IS NOT NULL) AS is_member
```

with:

```sql
      SELECT DISTINCT po.id, po.name, po.tag, po.project_id,
             pr.name AS project_name, pr.owner_id,
             pm.role AS member_role,
             (pr.owner_id = ${userId} OR pm.user_id IS NOT NULL) AS is_member
```

`project_members` is `UNIQUE(project_id, user_id)` (`001-redesign.sql:56`), so `pm.role` is single-valued per viewer per project and cannot multiply the `SELECT DISTINCT` rows.

- [ ] **Step 3: Return ownership from the outer query**

Add these three columns to the outer `SELECT` (after `visible.is_member AS "isMember"`, currently `lib/queries.ts:83`):

```sql
           (visible.owner_id = ${userId}) AS "ownedByMe",
           visible.member_role AS "memberRole",
           owner.name AS "ownerName",
```

and add this join immediately after `FROM visible` (currently `lib/queries.ts:97`), before the existing `LEFT JOIN latest`:

```sql
    LEFT JOIN users owner ON owner.id = visible.owner_id
```

- [ ] **Step 4: Return the participant role**

Change the `peopleRows` query (currently `lib/queries.ts:143`) from:

```sql
        SELECT p.portal_id AS "portalId", u.id, u.name
```

to:

```sql
        SELECT p.portal_id AS "portalId", p.role, u.id, u.name
```

and the loop that builds `peopleBy` (currently `lib/queries.ts:165-169`) from:

```typescript
    list.push({ id: p.id as string, name: (p.name as string) ?? 'Someone' });
```

to:

```typescript
    list.push({
      id: p.id as string,
      name: (p.name as string) ?? 'Someone',
      role: (p.role as string) ?? undefined,
    });
```

- [ ] **Step 5: Build the projects array**

Insert after the `const packages: PackageCard[] = rows.map(...)` block (after `lib/queries.ts:202`):

```typescript
  // One entry per distinct project, in the order its packages appear (the
  // query already sorts by recency). The viewer's own role is DERIVED — there
  // is no project-level role column, and inventing one would need a migration.
  const projectsById = new Map<string, ProjectSummary>();
  const viewerRoles = new Map<string, string[]>();

  for (const pkg of packages) {
    const mine = pkg.people.find((p) => p.id === userId)?.role;
    if (mine) {
      viewerRoles.set(pkg.projectId, [
        ...(viewerRoles.get(pkg.projectId) ?? []),
        mine,
      ]);
    }
  }

  for (const r of rows) {
    const id = r.projectId as string;
    if (projectsById.has(id)) continue;
    projectsById.set(id, {
      id,
      name: r.projectName as string,
      ownedByMe: Boolean(r.ownedByMe),
      createdByName: (r.ownerName as string) ?? null,
      myRole: deriveMyRole({
        ownedByMe: Boolean(r.ownedByMe),
        memberRole: (r.memberRole as string) ?? null,
        participantRoles: viewerRoles.get(id) ?? [],
      }),
    });
  }

  const projects = Array.from(projectsById.values());
```

**Step 5b — also return projects that have no visible package.** The `visible` CTE selects
`FROM portals`, so a project with zero visible packages produces no rows and would never reach
the payload — which would make the Task 5 "New project" flow create a project and show nothing.
Add this query after `mentionRows`:

```typescript
  const emptyProjectRows = await sql`
    SELECT DISTINCT pr.id, pr.name, pr.created_at,
           (pr.owner_id = ${userId}) AS "ownedByMe",
           owner.name AS "ownerName",
           pm.role AS "memberRole"
    FROM projects pr
    LEFT JOIN users owner ON owner.id = pr.owner_id
    LEFT JOIN project_members pm
      ON pm.project_id = pr.id AND pm.user_id = ${userId}
    WHERE pr.archived_at IS NULL
      AND (pr.owner_id = ${userId} OR pm.user_id IS NOT NULL)
    ORDER BY pr.created_at DESC
  `;
```

and merge it after the `rows` loop, before `Array.from`:

```typescript
  for (const r of emptyProjectRows) {
    const id = r.id as string;
    if (projectsById.has(id)) continue;
    projectsById.set(id, {
      id,
      name: r.name as string,
      ownedByMe: Boolean(r.ownedByMe),
      createdByName: (r.ownerName as string) ?? null,
      myRole: deriveMyRole({
        ownedByMe: Boolean(r.ownedByMe),
        memberRole: (r.memberRole as string) ?? null,
        participantRoles: [],
      }),
    });
  }
```

Scoped to owner-or-member on purpose, matching `GET /api/projects`: a guest is a participant on
*packages*, so a project with no package they can see is not theirs to know about.

Then change the return statement (currently `lib/queries.ts:230`) from:

```typescript
  return { packages, disclosure, isGuestOnly };
```

to:

```typescript
  return { packages, projects, disclosure, isGuestOnly };
```

and widen `getHomeData`'s return type annotation (currently `lib/queries.ts:34-38`) to include:

```typescript
  projects: ProjectSummary[];
```

`app/api/home/route.ts` needs **no change** — it returns `getHomeData`'s result verbatim.

- [ ] **Step 6: Add the project join to notifications**

In `app/api/notifications/route.ts`, change the GET query's select list and joins:

```sql
    SELECT n.id, n.type, n.title, n.excerpt, n.href, n.created_at AS "createdAt",
           n.read_at AS "readAt", n.portal_id AS "portalId",
           po.name AS "packageName",
           pr.id AS "projectId", pr.name AS "projectName",
           actor.id AS "actorId", actor.name AS "actorName"
    FROM notifications n
    LEFT JOIN portals po ON po.id = n.portal_id
    LEFT JOIN projects pr ON pr.id = po.project_id
    LEFT JOIN users actor ON actor.id = n.actor_id
    WHERE n.user_id = ${session.user.id}
    ORDER BY n.created_at DESC
    LIMIT 50
```

Keep `LIMIT 50` — the rail is a feed, not an archive.

In `components/shell/NotificationTray.tsx`, add two fields to `NotificationRow` after `packageName`:

```typescript
  projectId: string | null;
  projectName: string | null;
```

`NotificationTray`'s own rendering is unchanged.

- [ ] **Step 7: Retire `groupByProject`**

Delete these three lines from `lib/disclosure.ts` (currently lines 44-46):

```typescript
  /** Home is a flat package list until a second package exists. */
  groupByProject: (s: DisclosureState) => s.packageCount >= 2,
```

Delete this test from `scripts/tests/disclosure.test.mjs` (currently lines 14-17):

```javascript
test('home stays a flat package list until a second package exists', () => {
  assert.equal(DISCLOSURE.groupByProject(s({ packageCount: 1 })), false);
  assert.equal(DISCLOSURE.groupByProject(s({ packageCount: 2 })), true);
});
```

`app/page.tsx:85-86` still references it and will not compile until Task 7. That is expected — the two changes belong to one branch, and the alternative is leaving a dead predicate behind.

- [ ] **Step 8: Verify the suite still passes**

Run: `npm test 2>&1 | tail -8`
Expected: `pass 524` or more, `fail 0`. (527 baseline, minus the 1 deleted disclosure test, plus Tasks 1–3.)

- [ ] **Step 9: Verify the query against the real database**

Type-checking cannot catch a wrong column alias. Run the dev server and read the actual payload:

```bash
npm run dev
```

In a second terminal, after signing in through the browser at `http://localhost:3000`, open DevTools → Network → `home`, and confirm the JSON has a `projects` array whose entries carry `ownedByMe`, `createdByName` and `myRole`, and that `packages[].people[]` entries now carry `role`.

If `/api/home` returns 503 with "The database is missing tables this version needs", that is the existing migration guard, not this change.

- [ ] **Step 10: Commit**

```bash
git add lib/queries.ts app/api/notifications/route.ts \
  components/shell/NotificationTray.tsx lib/disclosure.ts \
  scripts/tests/disclosure.test.mjs
git commit -m "feat: return project ownership and roles from /api/home"
```

---

### Task 5: `NewProjectModal`

Built before the page rewrite so Task 7 can wire the header button to something real.

**Files:**
- Create: `components/home/NewProjectModal.tsx`

**Interfaces:**
- Consumes: `Modal` from `components/ui/Modal`, `Button`, `Input` from `components/ui/Primitives`, `useToast` from `components/ui/Toast`.
- Produces: `export default function NewProjectModal({ isOpen, onClose, onCreated }: { isOpen: boolean; onClose: () => void; onCreated: () => void })`

- [ ] **Step 1: Write the component**

Create `components/home/NewProjectModal.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Primitives';
import { useToast } from '@/components/ui/Toast';

/**
 * Creating a project without going through the package flow.
 *
 * Name only. The empty card the new project produces IS the prompt to add a
 * package, so there is nothing to duplicate from app/new/page.tsx here.
 */
export default function NewProjectModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  // A reopened modal must not still hold the last attempt's text.
  useEffect(() => {
    if (isOpen) {
      setName('');
      setSaving(false);
    }
  }, [isOpen]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onCreated();
      onClose();
    } catch {
      // Staying open with the text intact is the only way the person can
      // retry without retyping.
      toast('Could not create the project.');
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New project"
      subtitle="A project holds the packages you send for review."
      width={440}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!name.trim() || saving}>
            {saving ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      }
    >
      <label
        htmlFor="new-project-name"
        className="mb-[6px] block text-[12px] font-bold text-stiko-secondary"
      >
        Project name
      </label>
      <Input
        id="new-project-name"
        autoFocus
        value={name}
        placeholder="Riverside Tower"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') create();
        }}
      />
      <p className="mt-[10px] text-[12px] text-stiko-muted">
        You can add packages to it straight afterwards.
      </p>
    </Modal>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit 2>&1 | grep -v "app/page.tsx" | head -20`
Expected: no errors mentioning `NewProjectModal`. Errors in `app/page.tsx` about `groupByProject` are expected until Task 7.

If `Modal` does not accept a `subtitle` or `footer` prop, read `components/ui/Modal.tsx:1-25` and match its actual signature.

- [ ] **Step 3: Commit**

```bash
git add components/home/NewProjectModal.tsx
git commit -m "feat: name-only new project modal"
```

---

### Task 6: `ProjectCard` and `CardPackageRow`

**Files:**
- Modify: `tailwind.config.ts:86-98` (add `shadow-stiko-card`)
- Create: `components/home/CardPackageRow.tsx`
- Create: `components/home/ProjectCard.tsx`

**Interfaces:**
- Consumes: `ProjectGroup` from `lib/home` (Task 2), `roleLabel` from `lib/roles` (Task 1).
- Produces:
  - `export function CardPackageRow({ pkg }: { pkg: PackageCard })`
  - `export default function ProjectCard({ group, onOpenPeople }: { group: ProjectGroup; onOpenPeople: (projectId: string) => void })`

- [ ] **Step 1: Add the card shadow token**

In `tailwind.config.ts`, add to `boxShadow` immediately after the `"stiko-panel"` entry:

```typescript
        "stiko-card":
          "0 2px 6px -1px rgba(28,32,48,0.07), 0 1px 3px rgba(28,32,48,0.05)",
```

- [ ] **Step 2: Write `CardPackageRow`**

Create `components/home/CardPackageRow.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { StatusChip } from '@/components/ui/Primitives';
import { STATUS_ACCENT } from '@/lib/status';
import { relativeTime } from '@/lib/design';
import type { PackageCard } from '@/lib/queries';

/**
 * A package INSIDE its project card.
 *
 * Inset on the card's white, with the status accent on its left edge — the
 * whole point of the redesign is that a package reads as a child of a project,
 * not as its peer.
 */
export function CardPackageRow({ pkg }: { pkg: PackageCard }) {
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
        ? `${pkg.fileCount} files`
        : 'empty';

  return (
    <button
      onClick={() => router.push(`/portal/${pkg.id}`)}
      className="flex w-full items-center justify-between gap-[10px] rounded-[11px] bg-stiko-app px-3 py-[10px] text-left transition duration-150 hover:bg-stiko-tint"
      style={{ borderLeft: `3px solid ${STATUS_ACCENT[pkg.status]}` }}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-bold text-stiko-ink">
            {pkg.name}
          </span>
          <span className="shrink-0">
            <StatusChip status={pkg.status} />
          </span>
        </span>
        <span className="mt-[3px] block truncate text-[11px] text-stiko-muted">
          {meta}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-[10px]">
        <span
          className="text-[11px] font-extrabold"
          style={{ color: pkg.openComments > 0 ? '#B23A52' : '#8A90A6' }}
        >
          {count}
        </span>
        <svg
          className="h-[13px] w-[13px] text-stiko-ghost"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </span>
    </button>
  );
}
```

- [ ] **Step 3: Write `ProjectCard`**

Create `components/home/ProjectCard.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AvatarStack } from '@/components/ui/Primitives';
import { CardPackageRow } from '@/components/home/CardPackageRow';
import { roleLabel } from '@/lib/roles';
import type { ProjectGroup } from '@/lib/home';

/**
 * One project, owning its packages.
 *
 * Grows with its package count and never stretches to match a taller sibling —
 * `items-start` on the grid does that, not anything here.
 */
export default function ProjectCard({
  group,
  onOpenPeople,
}: {
  group: ProjectGroup;
  onOpenPeople: (projectId: string) => void;
}) {
  const router = useRouter();
  const { project, packages, packageCount, openComments, people } = group;

  const byline = project.ownedByMe
    ? 'Created by you'
    : `Created by ${project.createdByName ?? 'someone else'}`;

  return (
    <section
      className="overflow-hidden rounded-panel border border-stiko-sheet bg-white shadow-stiko-card"
      style={{ flex: '1 1 420px', minWidth: 0 }}
    >
      <header className="flex items-start justify-between gap-3 px-4 pb-[13px] pt-[15px]">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href={`/project/${project.id}`}
              className="truncate text-[16px] font-extrabold tracking-heading text-stiko-ink transition duration-150 hover:text-stiko-primary"
            >
              {project.name}
            </Link>
            <OwnershipChip
              ownedByMe={project.ownedByMe}
              myRole={project.myRole}
            />
          </div>
          <p className="mt-1 truncate text-[11.5px] text-stiko-muted">
            {byline} · {people.length}{' '}
            {people.length === 1 ? 'person' : 'people'}
          </p>
        </div>

        <button
          type="button"
          title="Manage people"
          onClick={() => onOpenPeople(project.id)}
          className="flex shrink-0 items-center rounded-pill border-[1.5px] border-transparent py-[3px] pl-[11px] pr-[6px] transition duration-150 hover:border-stiko-border-strong hover:bg-stiko-app"
        >
          <AvatarStack people={people} size={26} />
        </button>
      </header>

      <div className="flex flex-col gap-[6px] border-t border-stiko-border p-[10px]">
        <div className="flex items-center justify-between px-1 pb-[2px]">
          <span className="text-[10px] font-bold uppercase tracking-label text-stiko-faint">
            {packageCount === 1 ? '1 package' : `${packageCount} packages`}
          </span>
          <span className="text-[10.5px] font-bold text-stiko-muted">
            {openComments > 0 ? `${openComments} open comments` : 'Nothing open'}
          </span>
        </div>

        {packages.map((pkg) => (
          <CardPackageRow key={pkg.id} pkg={pkg} />
        ))}

        <button
          type="button"
          onClick={() => router.push(`/new?project=${project.id}`)}
          className="flex w-full items-center justify-center gap-[6px] rounded-[11px] border-[1.5px] border-dashed border-stiko-border-strong p-2 text-[11.5px] font-bold text-stiko-muted transition duration-150 hover:border-stiko-primary hover:text-stiko-primary"
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
      </div>
    </section>
  );
}

/**
 * Issue #2. Solid for owner, outlined for invited — 01's rule: solid pills are
 * facts about YOU, outlined chips are facts about the work, and ownership is
 * personal.
 */
function OwnershipChip({
  ownedByMe,
  myRole,
}: {
  ownedByMe: boolean;
  myRole: string | null;
}) {
  if (ownedByMe) {
    return (
      <span
        className="shrink-0 whitespace-nowrap rounded-pill border-[1.5px] border-transparent px-2 py-[3px] text-[9.5px] font-extrabold uppercase"
        style={{ background: '#EBE4FD', color: '#6b4fc4', letterSpacing: '0.04em' }}
      >
        Owner
      </span>
    );
  }

  const label = myRole ? `Invited · ${roleLabel(myRole)}` : 'Invited';
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-pill border-[1.5px] bg-white px-2 py-[3px] text-[9.5px] font-extrabold uppercase"
      style={{ borderColor: '#DDDFE8', color: '#8A90A6', letterSpacing: '0.04em' }}
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc --noEmit 2>&1 | grep -E "ProjectCard|CardPackageRow" | head -20`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.ts components/home/ProjectCard.tsx components/home/CardPackageRow.tsx
git commit -m "feat: project card owning its packages"
```

---

### Task 7: Rewrite `app/page.tsx` to two states

This is the task that deletes things. After it, home has exactly two branches: first-run empty, and the grid.

**Files:**
- Create: `components/home/HomeStates.tsx`
- Modify: `app/page.tsx` (full rewrite)
- Delete: `components/home/PackageRow.tsx`

**Interfaces:**
- Consumes: `ProjectCard` (Task 6), `NewProjectModal` (Task 5), `groupProjects` / `filterGroups` / `showFilterRow` / `needsYou` / `HomeFilter` (Task 2), `ProjectSummary` (Task 4).
- Produces: `HomeSkeleton` and `HomeError` from `components/home/HomeStates.tsx`.

- [ ] **Step 1: Move the loading and error states out**

Create `components/home/HomeStates.tsx` containing `HomeError` copied **verbatim** from `app/page.tsx:361-404` (add `export` to it), and a reshaped `HomeSkeleton`:

```tsx
'use client';

import Button from '@/components/ui/Button';
import { Column, Shell, TopBar } from '@/components/ui/Shell';
import AvatarMenu from '@/components/shell/AvatarMenu';
import { SkeletonBar } from '@/components/ui/Primitives';

/** 3g — the error panel, moved unchanged from app/page.tsx. */
export function HomeError({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <Shell>
      <TopBar right={<AvatarMenu />} />
      <Column width={720}>
        <div className="mt-10 rounded-panel bg-white p-8 text-center shadow-stiko-panel">
          <span
            className="mx-auto flex h-[44px] w-[44px] items-center justify-center rounded-[13px]"
            style={{ background: '#FFE2E2' }}
          >
            <svg
              className="h-5 w-5"
              style={{ color: '#B23A52' }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </span>
          <h1 className="mt-4 text-[19px] font-extrabold text-stiko-ink">
            Couldn&apos;t load your packages
          </h1>
          <p className="mt-2 text-[13px] leading-[1.6] text-stiko-muted">
            {message ?? 'Something went wrong on our side.'}
          </p>
          <div className="mt-6">
            <Button onClick={onRetry}>Try again</Button>
          </div>
        </div>
      </Column>
    </Shell>
  );
}

/**
 * A skeleton in the shape of the answer, never a spinner: the bar, two cards,
 * and a rail with three tiles. An error must never render as one of these.
 */
export function HomeSkeleton() {
  return (
    <Shell>
      <TopBar right={<SkeletonBar width={200} height={30} />} />
      <div className="flex min-h-0 flex-1 gap-6 px-1">
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="mb-3 pt-1">
            <SkeletonBar width={180} height={22} />
          </div>
          <div className="flex flex-wrap items-start gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-panel border border-stiko-sheet bg-white p-4 shadow-stiko-card"
                style={{ flex: '1 1 420px', minWidth: 0 }}
              >
                <SkeletonBar width={200} height={18} />
                <div className="mt-3 flex flex-col gap-[6px]">
                  <SkeletonBar width="100%" height={46} />
                  <SkeletonBar width="100%" height={46} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <aside
          className="hidden shrink-0 rounded-panel bg-white p-3 shadow-stiko-panel lg:block"
          style={{ width: 344 }}
        >
          <SkeletonBar width={120} height={18} />
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <SkeletonBar key={i} width="100%" height={56} />
            ))}
          </div>
        </aside>
      </div>
    </Shell>
  );
}
```

`SkeletonBar` accepts `width?: number | string` (`components/ui/Primitives.tsx:388`), so the `"100%"` values above are valid.

- [ ] **Step 2: Rewrite `app/page.tsx`**

Replace the whole file:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { Column, Shell, TopBar } from '@/components/ui/Shell';
import ProjectCard from '@/components/home/ProjectCard';
import NewProjectModal from '@/components/home/NewProjectModal';
import { HomeError, HomeSkeleton } from '@/components/home/HomeStates';
import NotificationTray, {
  type NotificationRow,
} from '@/components/shell/NotificationTray';
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
 * Owner home. Two states: first run, and the project grid.
 *
 * The grid covers every populated case — one package or fifty, owned or
 * invited. The old guest-only screen and the flat one-package floor are gone:
 * an "Invited · Commenter" card says more than a separate screen did.
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
  const [newProjectOpen, setNewProjectOpen] = useState(false);

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

  const groups = useMemo(
    () => groupProjects(packages, projects),
    [packages, projects]
  );
  const visible = useMemo(() => filterGroups(groups, filter), [groups, filter]);

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
          className="hidden items-center gap-2 rounded-[10px] bg-stiko-app px-3 py-[7px] text-[12.5px] text-stiko-faint transition duration-150 hover:text-stiko-muted md:flex"
          style={{ width: 240 }}
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
        <NotificationTray notifications={notifications} onChanged={load} />
      )}
      {/* 3m: a guest home has no "New package" in the primary slot. */}
      {!isGuestOnly && <Button onClick={newPackage}>New package</Button>}
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
        <CommandPalette packages={packages} onNewPackage={newPackage} />
      </Shell>
    );
  }

  const needsYouCount = packages.filter(needsYou).length;
  const subline = [
    `${groups.length} ${groups.length === 1 ? 'project' : 'projects'}`,
    `${packages.length} ${packages.length === 1 ? 'package' : 'packages'}`,
    needsYouCount > 0 ? `${needsYouCount} need you` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Shell>
      <TopBar right={topBarRight} />

      <div className="flex min-h-0 flex-1 gap-6 px-1">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex items-end justify-between gap-4 px-[2px] pb-3 pt-[2px]">
            <div>
              <h1 className="text-[20px] font-extrabold tracking-title text-stiko-ink">
                Your projects
              </h1>
              <p className="mt-[3px] text-[12.5px] text-stiko-muted">
                {subline}
              </p>
            </div>

            <div className="flex items-center gap-[6px]">
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
                          : 'border-transparent bg-transparent text-stiko-muted'
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
                className="flex items-center gap-[6px] rounded-[10px] bg-gradient-to-br from-[#8094F5] to-[#5B60FF] px-[14px] py-2 text-[12.5px] font-bold text-white shadow-stiko-primary transition duration-150"
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

          <div className="flex flex-wrap items-start gap-3 pb-4">
            {visible.map((group) => (
              <ProjectCard
                key={group.project.id}
                group={group}
                onOpenPeople={setPeoplePanelProjectId}
              />
            ))}
          </div>
        </div>
      </div>

      <NewProjectModal
        isOpen={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreated={load}
      />
      <CommandPalette packages={packages} onNewPackage={newPackage} />
    </Shell>
  );
}
```

`peoplePanelProjectId` is set but nothing consumes it yet — the drawer arrives in Task 9. Leave the state in place; it is wired, not stubbed.

- [ ] **Step 3: Delete the dead row component**

`components/home/PackageRow.tsx` had exactly one consumer, the file just rewritten. `app/project/[id]/page.tsx` has its own `ProjectPackageRow` and is unaffected.

```bash
git rm components/home/PackageRow.tsx
```

- [ ] **Step 4: Verify nothing still imports it**

Run: `grep -rn "home/PackageRow" app components lib`
Expected: no output.

- [ ] **Step 5: Verify the whole project type-checks**

Run: `npx tsc --noEmit`
Expected: no errors. This is the first point in the plan where the tree is fully consistent.

- [ ] **Step 6: Run the test suite**

Run: `npm test 2>&1 | tail -6`
Expected: `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx components/home/HomeStates.tsx
git commit -m "feat: project card grid replaces the flat home list"
```

---

### Task 8: `ActivityRail`

**Files:**
- Create: `components/home/ActivityRail.tsx`
- Modify: `app/page.tsx` (render the rail in the content row)

**Interfaces:**
- Consumes: `groupActivity`, `activityAccent`, `homeStats` from `lib/home` (Tasks 2–3); `NotificationRow` from `components/shell/NotificationTray` (Task 4).
- Produces: `export default function ActivityRail({ notifications, packages, onChanged }: { notifications: NotificationRow[]; packages: PackageCard[]; onChanged: () => void })`

- [ ] **Step 1: Write the rail**

Create `components/home/ActivityRail.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/ui/Primitives';
import { activityAccent, groupActivity, homeStats } from '@/lib/home';
import { relativeTime } from '@/lib/design';
import type { NotificationRow } from '@/components/shell/NotificationTray';
import type { PackageCard } from '@/lib/queries';

const BADGE_COLOR: Record<string, { bg: string; fg: string }> = {
  MENTION: { bg: '#FFE2E2', fg: '#B23A52' },
  ACTION: { bg: '#FFE2E2', fg: '#B23A52' },
  NEW: { bg: '#FFFCCE', fg: '#7A5E00' },
};

/**
 * One chronological feed for everything, replacing the standalone "Needs you"
 * block that was the screen's biggest source of vertical dead space.
 *
 * Fed by `notifications`, which only carries what was addressed to this viewer.
 * The title overstates that knowingly — see the design spec.
 */
export default function ActivityRail({
  notifications,
  packages,
  onChanged,
}: {
  notifications: NotificationRow[];
  packages: PackageCard[];
  onChanged: () => void;
}) {
  const router = useRouter();
  const stats = homeStats(packages);
  const groups = groupActivity(notifications);
  const hasUnread = notifications.some((n) => !n.readAt);

  const open = async (row: NotificationRow) => {
    if (!row.readAt) {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      }).catch(() => {});
      onChanged();
    }
    router.push(row.href);
  };

  const markAll = async () => {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
    onChanged();
  };

  return (
    <aside
      className="flex shrink-0 flex-col overflow-hidden rounded-panel bg-white shadow-stiko-panel"
      style={{ width: 344 }}
    >
      <div className="flex items-center justify-between gap-[10px] border-b border-stiko-border px-4 py-[14px]">
        <div>
          <h2 className="text-[15px] font-extrabold text-stiko-ink">Activity</h2>
          <p className="mt-[2px] text-[11.5px] text-stiko-muted">
            Everything, newest first
          </p>
        </div>
        {hasUnread && (
          <button
            onClick={markAll}
            className="shrink-0 text-[11.5px] font-bold text-stiko-primary transition duration-150"
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 px-3 pb-[6px] pt-3">
        <StatTile value={stats.needsYou} label="need you" color="#B23A52" />
        <StatTile value={stats.openComments} label="open comments" color="#1C2030" />
        <StatTile value={stats.inReview} label="in review" color="#7A5E00" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[14px] pt-[6px]">
        {groups.map((group) => (
          <div key={group.label} className="pt-[10px]">
            <div className="px-1 pb-[6px] text-[10px] font-bold uppercase tracking-label text-stiko-faint">
              {group.label}
            </div>
            <div className="flex flex-col gap-1">
              {group.items.map((row) => {
                const accent = activityAccent(row.type);
                const badge = accent.badge ? BADGE_COLOR[accent.badge] : null;
                const meta = [
                  row.projectName,
                  row.packageName,
                  relativeTime(row.createdAt),
                ]
                  .filter(Boolean)
                  .join(' · ');

                return (
                  <button
                    key={row.id}
                    onClick={() => open(row)}
                    className="flex items-start gap-[10px] rounded-[11px] px-[10px] py-[9px] text-left transition duration-150 hover:bg-stiko-tint"
                    style={{
                      background: accent.bg ?? 'transparent',
                      // Transparent rather than absent, so text baselines line
                      // up across accented and plain rows.
                      borderLeft: `3px solid ${accent.border ?? 'transparent'}`,
                    }}
                  >
                    <Avatar
                      id={row.actorId ?? row.id}
                      name={row.actorName ?? 'Someone'}
                      size={28}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] leading-[1.45] text-stiko-ink">
                        {row.title}
                      </span>
                      <span className="mt-[2px] block truncate text-[10.5px] text-stiko-faint">
                        {meta}
                      </span>
                    </span>
                    {badge && (
                      <span
                        className="shrink-0 rounded-pill px-[7px] py-[2px] text-[9px] font-extrabold uppercase"
                        style={{ background: badge.bg, color: badge.fg }}
                      >
                        {accent.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function StatTile({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div className="rounded-inset bg-stiko-app px-[11px] py-[10px]">
      <div className="text-[19px] font-extrabold leading-none" style={{ color }}>
        {value}
      </div>
      <div
        className="mt-1 text-[10.5px] text-stiko-muted"
        style={{ lineHeight: 1.3 }}
      >
        {label}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render it in `app/page.tsx`**

Add the import:

```tsx
import ActivityRail from '@/components/home/ActivityRail';
```

and insert immediately after the closing `</div>` of the scrolling grid column, still inside `<div className="flex min-h-0 flex-1 gap-6 px-1">`:

```tsx
        {notifications.length > 0 && (
          <div className="hidden lg:block">
            <ActivityRail
              notifications={notifications}
              packages={packages}
              onChanged={load}
            />
          </div>
        )}
```

Gated on `notifications.length`, **not** on the unread count — a rail that vanishes once everything is read would be worse than one that was never there. The `hidden lg:block` wrapper is the responsive rule: below Tailwind's `lg` (1024px) the rail is not rendered and the grid takes the full width; the bell still carries the same notifications.

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/home/ActivityRail.tsx app/page.tsx
git commit -m "feat: activity rail replaces the needs-you block"
```

---

### Task 9: `ProjectPeopleDrawer` and the `RoleTag` primitive

**Files:**
- Modify: `components/ui/Primitives.tsx` (add `RoleTag` after `RolePill`)
- Create: `components/home/ProjectPeopleDrawer.tsx`
- Modify: `app/page.tsx` (render the drawer)

**Interfaces:**
- Consumes: `roleTagSpec`, `roleLabel` from `lib/roles` (Task 1); `ProjectGroup` from `lib/home` (Task 2); `Drawer`; `AddPeopleModal`.
- Produces:
  - `export function RoleTag({ role }: { role: string | null })` in `Primitives.tsx`
  - `export default function ProjectPeopleDrawer({ group, isOpen, onClose, onChanged }: { group: ProjectGroup | null; isOpen: boolean; onClose: () => void; onChanged: () => void })`

- [ ] **Step 1: Add `RoleTag`**

Append to `components/ui/Primitives.tsx`, after `RolePill`:

```tsx
/**
 * The full-word role pill. Distinct from RolePill, which is a fixed 30x24
 * single-letter tile for the access matrix and whose type excludes owner and
 * coordinator entirely.
 */
export function RoleTag({ role }: { role: string | null }) {
  const spec = roleTagSpec(role);
  if (!spec) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-chip px-[9px] py-1 text-[10px] font-extrabold uppercase"
      style={{ background: spec.bg, color: spec.fg }}
    >
      {roleLabel(role)}
    </span>
  );
}
```

with this import added at the top of the file:

```tsx
import { roleLabel, roleTagSpec } from '@/lib/roles';
```

- [ ] **Step 2: Write the drawer**

Create `components/home/ProjectPeopleDrawer.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import Drawer from '@/components/ui/Drawer';
import Button from '@/components/ui/Button';
import { Avatar, Note, RoleTag } from '@/components/ui/Primitives';
import { AddPeopleModal } from '@/components/people/AddPeopleModal';
import type { ProjectGroup } from '@/lib/home';

/**
 * Project people, read-only.
 *
 * Roles in Stiko are per-package (participants.portal_id), so what this shows
 * is a DERIVED summary: each person's highest role across the packages this
 * viewer can see. Editing here would mean either a migration or a project-level
 * write that silently fans out across per-package grants, so every actual
 * change routes to the per-package surfaces instead.
 */
export default function ProjectPeopleDrawer({
  group,
  isOpen,
  onClose,
  onChanged,
}: {
  group: ProjectGroup | null;
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  if (!group) return null;

  const { project, people, packages } = group;
  // A guest can neither invite nor open the matrix — /api/projects/[id]/overview
  // is member-gated and would 403.
  const canManage = project.ownedByMe || project.myRole === 'coordinator';

  const subtitle = project.ownedByMe
    ? `You own this project · ${people.length} ${people.length === 1 ? 'person' : 'people'}`
    : `Created by ${project.createdByName ?? 'someone else'} · ${people.length} ${people.length === 1 ? 'person' : 'people'}`;

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title={project.name}
        subtitle={subtitle}
        width={390}
        closeOnEscape={!addOpen}
        footer={
          canManage ? (
            <div className="flex items-center gap-2">
              <Button fullWidth onClick={() => setAddOpen(true)}>
                Add people
              </Button>
              <Link
                href={`/project/${project.id}`}
                className="shrink-0 rounded-[10px] border-[1.5px] border-stiko-border-strong px-[14px] py-2 text-[12.5px] font-bold text-stiko-secondary transition duration-150 hover:bg-stiko-app"
              >
                Access matrix
              </Link>
            </div>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-[2px]">
          {people.map((person) => (
            <div
              key={person.id}
              className="flex items-center justify-between gap-[10px] rounded-[11px] px-[10px] py-[9px] transition duration-150 hover:bg-stiko-app"
            >
              <div className="flex min-w-0 items-center gap-[10px]">
                <Avatar id={person.id} name={person.name} size={32} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold text-stiko-ink">
                    {person.name}
                  </div>
                  <div className="truncate text-[11px] text-stiko-muted">
                    On {person.packageCount}{' '}
                    {person.packageCount === 1 ? 'package' : 'packages'}
                  </div>
                </div>
              </div>
              <RoleTag role={person.role} />
            </div>
          ))}

          {people.length === 0 && (
            <p className="px-[10px] py-4 text-[12.5px] text-stiko-muted">
              Nobody else is on this project&apos;s packages yet.
            </p>
          )}

          <Note className="mt-3">
            Roles are set per package. Changing someone here updates every
            package in this project they are already on.
          </Note>
        </div>
      </Drawer>

      {canManage && (
        <AddPeopleModal
          isOpen={addOpen}
          onClose={() => setAddOpen(false)}
          projectName={project.name}
          packages={packages.map((p) => ({ id: p.id, name: p.name }))}
          onDone={onChanged}
        />
      )}
    </>
  );
}
```

Read `components/people/AddPeopleModal.tsx:1-40` for the exact `ProjectPackage` shape its `packages` prop wants. If it needs more fields than `{id, name}`, map them from `PackageCard` — do not widen `PackageCard`.

- [ ] **Step 3: Render it in `app/page.tsx`**

Add the import:

```tsx
import ProjectPeopleDrawer from '@/components/home/ProjectPeopleDrawer';
```

and add beside `<NewProjectModal …/>`:

```tsx
      <ProjectPeopleDrawer
        group={groups.find((g) => g.project.id === peoplePanelProjectId) ?? null}
        isOpen={peoplePanelProjectId !== null}
        onClose={() => setPeoplePanelProjectId(null)}
        onChanged={load}
      />
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full suite**

Run: `npm test 2>&1 | tail -6`
Expected: `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add components/ui/Primitives.tsx components/home/ProjectPeopleDrawer.tsx app/page.tsx
git commit -m "feat: read-only project people drawer"
```

---

### Task 10: Browser verification and production build

`main` deploys straight to production and there is no staging environment, so nothing merges before this passes. Components in this repo have no unit tests; this task **is** their test.

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Next loads `.env.local` itself. Do **not** source it from the shell — see the credential-rotation note in the project's memory.

- [ ] **Step 2: Verify the populated owner path**

Sign in as an account that owns ≥2 projects with ≥1 package each, at 1440px wide. Confirm, and record what you actually saw:

- Cards are two per row, top-aligned, and a card with 4 packages is taller than a card with 1 — they do not stretch to match.
- Owned projects show a solid purple `OWNER` chip.
- Each package row shows the correct status accent on its left edge and navigates to `/portal/{id}`.
- The card meta row totals match the packages listed beneath it.
- The rail's three tiles match: "need you" against the packages showing mentions or unseen versions, "open comments" against the sum of the card meta rows, "in review" against the `IN REVIEW` chips.
- "Mark all read" clears the unread state and the rail stays on screen.
- Clicking an activity row navigates to the right object.

- [ ] **Step 3: Verify the invited path**

Sign in as an account that is only a participant (no owned project). Confirm:

- The grid renders, with `INVITED · {ROLE}` chips carrying the viewer's real role.
- The filter row is **absent**.
- "New package" is **absent** from the top bar.
- Opening the people drawer shows no "Add people" or "Access matrix" footer.
- No package appears that this account is not a participant on. Cross-check one project against the database if there is any doubt — this is the permission boundary and it is the single most important check in this task.

- [ ] **Step 4: Verify the small and empty paths**

- An account with exactly one package: one card at half width, no filter row.
- An account with zero packages: the first-run `EmptyState` with its three explainers, unchanged.
- Click "New project", name it, confirm an empty card appears reading "0 packages" with only the dashed "Add a package" row, and that the row opens `/new` with that project preselected.

- [ ] **Step 5: Verify the narrow width**

Resize to ~1000px. Confirm the grid drops to one column, the rail is not rendered, and the page body does not scroll horizontally.

- [ ] **Step 6: Run the production build**

```bash
AUTH_SECRET=dev-only-local-harness DATABASE_URL='postgresql://u:p@127.0.0.1:5432/db' \
R2_ACCESS_KEY_ID=dev R2_SECRET_ACCESS_KEY=dev \
R2_ENDPOINT_URL='https://example.invalid' R2_BUCKET_NAME=dev npm run build
```

Expected: build completes. A bare `npm run build` failing at "Collect page data" is missing config, not a code defect — do not chase it.

- [ ] **Step 7: Run lint and the full suite**

```bash
npm run lint
npm test 2>&1 | tail -6
```

Expected: lint clean, `fail 0`.

- [ ] **Step 8: Report honestly, then commit any fixes**

State which of steps 2–5 were actually exercised and which were not. If an account for the invited path or the zero-package path was unavailable, say so plainly rather than implying the path passed.

```bash
git add <only the files you changed>
git commit -m "fix: <what the browser pass actually found>"
```
