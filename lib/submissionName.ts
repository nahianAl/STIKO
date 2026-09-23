/**
 * What a submission is called, in one place.
 *
 * "Submission" is the user-facing word only. The table is still `versions` and
 * the code still says version throughout, the same split as portal/package.
 * Every rendered title and badge goes through here so the word cannot drift
 * between screens.
 *
 * Imports nothing, so node --test loads it without a database.
 */

/** Longest name the API accepts, after trimming. The rename input's maxLength matches. */
export const SUBMISSION_NAME_MAX = 80;

/**
 * The name someone gave it, or "Submission N" when nobody has.
 *
 * `name` is optional because not every payload carries it (the `/api/home`
 * package cards and the invite page don't), and a missing name means the
 * same as a null one.
 */
export function submissionTitle(v: { name?: string | null; versionNumber: number }): string {
  const name = v.name?.trim();
  return name ? name : `Submission ${v.versionNumber}`;
}

/** The compact form for badges, chips and meta lines: "S5". */
export function submissionBadge(versionNumber: number): string {
  return `S${versionNumber}`;
}

export type NormalizedSubmissionName =
  | { ok: true; name: string | null }
  | { ok: false; error: string };

/**
 * What the rename endpoint stores for a request's `name` value.
 *
 * Blank means "go back to the default", so it becomes null rather than an
 * empty string: the default is computed at render time and never written down.
 * Runs of whitespace, newlines included, collapse to one space, so a pasted
 * name cannot break the title across lines.
 */
export function normalizeSubmissionName(input: unknown): NormalizedSubmissionName {
  if (input === null) return { ok: true, name: null };
  if (typeof input !== 'string') return { ok: false, error: 'Name must be text' };
  const name = input.replace(/\s+/g, ' ').trim();
  if (!name) return { ok: true, name: null };
  if (name.length > SUBMISSION_NAME_MAX) {
    return { ok: false, error: `Keep the name to ${SUBMISSION_NAME_MAX} characters or fewer` };
  }
  return { ok: true, name };
}
