/**
 * Staleness is a comparison, never a stored flag — a flag would have to be
 * invalidated from every route that writes a comment.
 *
 * `coveredCount` is null when no brief exists: that is "absent", not "stale",
 * and the UI offers a different affordance for each.
 */
export function isStale(coveredCount: number | null, liveCount: number): boolean {
  if (coveredCount === null) return false;
  return liveCount > coveredCount;
}
