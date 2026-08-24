import { sql } from '@/lib/db';
import type { VersionFacts, RawComment, PriorTheme } from './types';

/**
 * Everything the model is NOT asked to work out.
 *
 * Counts, tallies and thread state are cheap in SQL and impossible to
 * hallucinate, so they are computed here and rendered whether or not inference
 * is available. The model is left with the one genuinely linguistic job.
 */

// The pure half lives in ./staleness, not here, because a test can import
// isStale without ever loading this module's top-level `@/lib/db` import —
// which throws when DATABASE_URL is unset. Keep it split; do not fold it
// back in.
export { isStale } from './staleness';

export async function versionFacts(versionId: string): Promise<VersionFacts> {
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

/**
 * Comment id → file id, for the whole version.
 *
 * A brief's themes can cite pins from any file in the version (versionComments
 * gathers across all of them), but the comment panel only ever has one file's
 * comments loaded at a time. This is what lets a citation chip know which file
 * to switch to before it can jump to the comment — a dedicated query rather
 * than reusing versionComments, which also drags in bodies/authors this does
 * not need.
 */
export async function versionCommentFiles(versionId: string): Promise<Record<string, string>> {
  const rows = await sql`
    SELECT c.id, c.file_id AS "fileId"
    FROM comments c
    JOIN files f ON f.id = c.file_id
    WHERE f.version_id = ${versionId}
  `;
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.id as string] = row.fileId as string;
  }
  return map;
}

/** Newest first — capComments takes from the front. */
export async function versionComments(versionId: string): Promise<RawComment[]> {
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
