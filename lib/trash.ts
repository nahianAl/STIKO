/**
 * The trash window.
 *
 * Deliberately import-free. This module is unit-tested by `node --test`, which
 * runs the TypeScript directly with no bundler, so a `@/` import here would not
 * resolve — and every other rule in this file is arithmetic that wants testing.
 *
 * Expiry is COMPUTED, never stored. The purge job is cleanup only: a row past
 * its window is invisible and unrestorable whether or not the job has run.
 * Migrations here have been forgotten twice and there is no staging
 * environment, so a missed schedule must cost storage, not correctness.
 */

export const TRASH_RETENTION_DAYS = 28;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days left before purge, rounded up and clamped at zero.
 *
 * Display only. The authoritative window lives in SQL as
 * `now() - '28 days'::interval`, so that whether a row is restorable is decided
 * by the database's clock rather than by whichever serverless instance answered
 * the request. Re-deciding it here as well would be two sources of truth that
 * can disagree by exactly the amount of the skew.
 *
 * Rounded UP: a row with six hours left reads "1 day left", never "0", which
 * would look purged while it is still perfectly restorable.
 */
export function daysRemaining(
  deletedAt: Date | string | null,
  now: Date
): number {
  if (deletedAt === null || deletedAt === undefined) return 0;
  // Neon's HTTP driver may hand back TIMESTAMPTZ as a Date or as a string,
  // depending on the call site; this check normalises either into a Date.
  const at = deletedAt instanceof Date ? deletedAt : new Date(deletedAt);
  // Fails closed rather than propagating NaN into the UI as "NaN days left".
  if (Number.isNaN(at.getTime())) return 0;

  const left = at.getTime() + TRASH_RETENTION_DAYS * DAY_MS - now.getTime();
  if (left <= 0) return 0;
  return Math.ceil(left / DAY_MS);
}
