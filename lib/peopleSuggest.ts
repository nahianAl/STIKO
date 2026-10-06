/**
 * Invite autocomplete — the pure parts. No imports, so `node --test` can load
 * it.
 */

/** Fewer characters than this would list a whole address book one letter at a time. */
export const MIN_SUGGEST_QUERY = 2;
export const MAX_SUGGESTIONS = 8;

/** Escape what ILIKE treats specially, so typed text only ever matches itself. */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The two ILIKE patterns a query is searched with: a prefix of the whole
 * value (an email, or a name from its start) and a prefix of any later word in
 * a name. Null when the query is too short to search.
 */
export function suggestPatterns(raw: string): { prefix: string; word: string } | null {
  const q = raw.trim();
  if (q.length < MIN_SUGGEST_QUERY) return null;
  const escaped = escapeLike(q);
  return { prefix: `${escaped}%`, word: `% ${escaped}%` };
}

/** Shaped like an address. Stops a half-typed name being sent as an invite. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
