import { sql } from '@/lib/db';
import { TRASH_RETENTION_DAYS, daysRemaining } from '@/lib/trash';

export interface TrashItem {
  id: string;
  kind: 'project' | 'package';
  name: string;
  /** The parent project, for packages. Null for projects. */
  projectName: string | null;
  /** Packages that come back with this one. Always 0 for a package. */
  sweptPackageCount: number;
  bytes: number;
  deletedAt: string;
  /** Null when the deleting account has since been removed. */
  deletedByName: string | null;
  daysLeft: number;
}

/**
 * Everything in this user's trash, newest first.
 *
 * Scoped to CONTENT, not to actor: you see anything deleted from a project you
 * own or coordinate, whoever deleted it. The alternative — only what you
 * personally deleted — means an owner cannot undo a coordinator's mistake
 * without asking them to log in, which is the one job a trash exists for.
 *
 * Guests see nothing, because a guest can delete no container. Their panel is
 * legitimately empty rather than broken.
 *
 * Only DIRECT deletions get a row. A package swept up by its project is
 * reported as a count on the project's card, or the panel floods on any real
 * project.
 */
export async function getTrash(userId: string): Promise<TrashItem[]> {
  const cutoff = `${TRASH_RETENTION_DAYS} days`;

  const rows = await sql`
    WITH mine AS (
      SELECT pr.id
      FROM projects pr
      LEFT JOIN project_members pm
        ON pm.project_id = pr.id AND pm.user_id = ${userId}
      WHERE pr.owner_id = ${userId}
         OR (pm.user_id IS NOT NULL AND pm.role = 'coordinator')
    ),
    -- Bytes per package, counted once and reused by both halves below.
    -- Attachments are excluded deliberately, matching getAccountUsage's note:
    -- their keys carry no portal segment, so they are not safely attributable.
    pkg_bytes AS (
      SELECT v.portal_id, COALESCE(SUM(f.file_size), 0) AS bytes
      FROM files f
      JOIN versions v ON v.id = f.version_id
      GROUP BY v.portal_id
    )
    SELECT * FROM (
      SELECT pr.id,
             'project' AS kind,
             pr.name,
             NULL::text AS "projectName",
             (SELECT COUNT(*) FROM portals po2
               WHERE po2.project_id = pr.id AND po2.deleted_with_project) AS "sweptPackageCount",
             (SELECT COALESCE(SUM(b.bytes), 0) FROM portals po3
                LEFT JOIN pkg_bytes b ON b.portal_id = po3.id
               WHERE po3.project_id = pr.id) AS bytes,
             pr.deleted_at AS "deletedAt",
             u.name AS "deletedByName"
      FROM projects pr
      JOIN mine ON mine.id = pr.id
      LEFT JOIN users u ON u.id = pr.deleted_by
      WHERE pr.deleted_at IS NOT NULL
        AND pr.deleted_at > now() - ${cutoff}::interval

      UNION ALL

      -- Packages deleted on their own. Swept ones are excluded here and
      -- counted on their project's card instead.
      SELECT po.id,
             'package' AS kind,
             po.name,
             pr.name AS "projectName",
             0 AS "sweptPackageCount",
             COALESCE(b.bytes, 0) AS bytes,
             po.deleted_at AS "deletedAt",
             u.name AS "deletedByName"
      FROM portals po
      JOIN projects pr ON pr.id = po.project_id
      JOIN mine ON mine.id = pr.id
      LEFT JOIN users u ON u.id = po.deleted_by
      LEFT JOIN pkg_bytes b ON b.portal_id = po.id
      WHERE po.deleted_at IS NOT NULL
        AND NOT po.deleted_with_project
        AND po.deleted_at > now() - ${cutoff}::interval
    ) t
    ORDER BY "deletedAt" DESC
  `;

  const now = new Date();
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as 'project' | 'package',
    name: r.name as string,
    projectName: (r.projectName as string | null) ?? null,
    // BIGINT and COUNT come back from the HTTP driver as strings. Without
    // Number() these concatenate instead of adding, which is how "10485760"
    // becomes "1048576010485760" downstream.
    sweptPackageCount: Number(r.sweptPackageCount ?? 0),
    bytes: Number(r.bytes ?? 0),
    deletedAt: String(r.deletedAt),
    deletedByName: (r.deletedByName as string | null) ?? null,
    daysLeft: daysRemaining(String(r.deletedAt), now),
  }));
}
