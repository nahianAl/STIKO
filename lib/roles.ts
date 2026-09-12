import { NOTES } from './design.ts';

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
