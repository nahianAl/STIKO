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
