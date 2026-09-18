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
  /**
   * How many packages this count is over depends on which half of the roster
   * the entry is in. For an accepted entry, it counts packages they have
   * ACCEPTED on — not packages they are merely invited to. Someone who has
   * accepted on one package and has a separate, still-open invite on another
   * is one entry with packageCount 1, because that second invite is folded
   * into their accepted row (see the `continue` guard below) rather than
   * counted here. Do not read this number as "involved with N packages."
   */
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
      // An invitation the person has already accepted on ANY package is not
      // pending, even if this particular invite is to a different package
      // they have not yet accepted. This list answers "who is involved in
      // this project" — someone who has accepted is involved, full stop; she
      // is not a pending person, and showing her a second time as pending
      // (or flagging her as not-accepted) would both be lies. pendingCount
      // drives a "n not accepted" chip that counts PEOPLE who haven't turned
      // up, not outstanding invitations, and she has turned up. The
      // per-package truth — that this package still has an open invite to
      // her address — is not lost, just not this list's job: the package
      // rows and the cross-package matrix read pkg.pending directly, and
      // that is where it belongs. The cost is real and worth stating
      // plainly: packageCount below counts packages she has accepted, not
      // packages she is involved with, so it can undercount someone with an
      // outstanding invite elsewhere.
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
