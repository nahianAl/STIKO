import type { VersionFacts, RawComment, PriorTheme } from './types';

/**
 * Everything the model is NOT asked to work out.
 *
 * Counts, tallies and thread state are cheap in SQL and impossible to
 * hallucinate, so they are computed here and rendered whether or not inference
 * is available. The model is left with the one genuinely linguistic job.
 */

/**
 * `sql` is loaded lazily, inside each function, rather than as a top-level
 * import.
 *
 * `lib/db` throws at import time when `DATABASE_URL` is unset, and resolving
 * its `@/` alias requires a bundler — neither is available to the plain `node
 * --test` runner this module's unit test (`isStale` only, per the brief) runs
 * under. Every other query-touching module in this codebase (`lib/access.ts`,
 * `lib/queries.ts`) is kept out of the test suite's import graph for the same
 * reason. A dynamic import defers both costs to call time, so importing this
 * file for `isStale` alone never touches the database layer, while Next.js —
 * which resolves `@/` for dynamic imports exactly as it does for static ones
 * — sees no behavioural difference at runtime.
 */
async function loadSql() {
  return (await import('@/lib/db')).sql;
}

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

export async function versionFacts(versionId: string): Promise<VersionFacts> {
  const sql = await loadSql();
  const rows = await sql`
    WITH v_comments AS (
      SELECT c.id, c.parent_comment_id, c.user_id, c.author, f.filename
      FROM comments c
      JOIN files f ON f.id = c.file_id
      WHERE f.version_id = ${versionId}
    )
    SELECT
      (SELECT COUNT(*) FROM v_comments)::int AS "commentCount",
      (SELECT COUNT(*) FROM v_comments root
        WHERE root.parent_comment_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM v_comments reply WHERE reply.parent_comment_id = root.id
          ))::int AS "openThreadCount",
      (SELECT COUNT(*) FROM verdicts
        WHERE version_id = ${versionId} AND verdict = 'approved')::int AS "approvedCount",
      (SELECT COUNT(*) FROM verdicts
        WHERE version_id = ${versionId} AND verdict = 'changes_requested')::int
        AS "changesRequestedCount",
      (SELECT COUNT(DISTINCT COALESCE(user_id, author)) FROM v_comments)::int
        AS "participantCount",
      (SELECT filename FROM v_comments
        GROUP BY filename ORDER BY COUNT(*) DESC, filename ASC LIMIT 1)
        AS "mostAnnotatedFile"
  `;

  const row = rows[0] ?? {};
  return {
    commentCount: row.commentCount ?? 0,
    openThreadCount: row.openThreadCount ?? 0,
    approvedCount: row.approvedCount ?? 0,
    changesRequestedCount: row.changesRequestedCount ?? 0,
    participantCount: row.participantCount ?? 0,
    mostAnnotatedFile: row.mostAnnotatedFile ?? null,
  };
}

/**
 * The count and high-water mark that become the brief's watermark.
 *
 * Both come from one query so they describe the same snapshot. Taking the count
 * here and the timestamp later would let a comment slip between them and be
 * marked covered by a brief that never saw it.
 */
export async function versionCoverage(
  versionId: string
): Promise<{ count: number; maxCreatedAt: string }> {
  const sql = await loadSql();
  const rows = await sql`
    SELECT COUNT(*)::int AS count,
           COALESCE(MAX(c.created_at), NOW()) AS "maxCreatedAt"
    FROM comments c
    JOIN files f ON f.id = c.file_id
    WHERE f.version_id = ${versionId}
  `;
  return {
    count: rows[0]?.count ?? 0,
    maxCreatedAt: rows[0]?.maxCreatedAt ?? new Date().toISOString(),
  };
}

/** Newest first — capComments takes from the front. */
export async function versionComments(versionId: string): Promise<RawComment[]> {
  const sql = await loadSql();
  const rows = await sql`
    SELECT c.id,
           COALESCE(c.user_id, c.author) AS "authorKey",
           c.author,
           c.content AS text,
           f.filename AS file,
           (c.parent_comment_id IS NOT NULL) AS "isReply"
    FROM comments c
    JOIN files f ON f.id = c.file_id
    WHERE f.version_id = ${versionId}
    ORDER BY c.created_at DESC
  `;
  return rows as RawComment[];
}

/** Themes from the immediately preceding version, for recurrence detection. */
export async function priorThemes(versionId: string): Promise<PriorTheme[]> {
  const sql = await loadSql();
  const rows = await sql`
    SELECT vs.version_id AS "versionId", vs.themes
    FROM versions cur
    JOIN versions prev
      ON prev.portal_id = cur.portal_id
     AND prev.version_number < cur.version_number
    JOIN version_summaries vs ON vs.version_id = prev.id
    WHERE cur.id = ${versionId}
    ORDER BY prev.version_number DESC
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return [];

  const themes = Array.isArray(row.themes) ? row.themes : [];
  return themes.map((t: { title?: string; body?: string }) => ({
    versionId: row.versionId as string,
    title: String(t?.title ?? ''),
    body: String(t?.body ?? ''),
  }));
}
