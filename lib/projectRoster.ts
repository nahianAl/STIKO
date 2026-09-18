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
