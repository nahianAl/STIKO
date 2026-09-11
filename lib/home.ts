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

/** 03's ladder: never render a control with nothing to control. */
export function showFilterRow(groups: ProjectGroup[]): boolean {
  if (groups.length >= 2) return true;
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
