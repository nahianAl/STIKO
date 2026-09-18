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
    -- Attachments are excluded deliberately, mirroring the note on
    -- storageKeysForFiles in lib/access.ts: their storage keys are minted flat
    -- (snapshots/{uuid}, comment-attachments/{uuid}) with no project or portal
    -- segment, so a byte count cannot be safely attributed to one portal.
    -- (getAccountUsage in lib/queries.ts, unlike this query, DOES count
    -- attachment bytes, via its own attachment_bytes CTE.)
    --
    -- Scoped through the "mine" CTE so an empty trash does not full-scan
    -- files joined to versions for every user's files: this CTE is
    -- referenced twice below, and Postgres 12+ materializes rather than
    -- pushing the filter down into a twice-referenced CTE.
    pkg_bytes AS (
      SELECT v.portal_id, SUM(f.file_size) AS bytes
      FROM files f
      JOIN versions v ON v.id = f.version_id
      JOIN portals po ON po.id = v.portal_id
      JOIN mine ON mine.id = po.project_id
      GROUP BY v.portal_id
    )
    SELECT * FROM (
      SELECT pr.id,
             'project' AS kind,
             pr.name,
             NULL::text AS "projectName",
             (SELECT COUNT(*) FROM portals po2
               WHERE po2.project_id = pr.id AND po2.deleted_with_project) AS "sweptPackageCount",
             -- Must describe the SAME set as sweptPackageCount above, or a
             -- package deleted independently before its project gets its
             -- bytes double-counted (once on its own card, once here) and,
             -- once past its own 28-day window, counted here with no card of
             -- its own to reconcile against.
             (SELECT COALESCE(SUM(b.bytes), 0) FROM portals po3
                LEFT JOIN pkg_bytes b ON b.portal_id = po3.id
               WHERE po3.project_id = pr.id AND po3.deleted_with_project) AS bytes,
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
        -- A swept package (flag TRUE) is normally hidden here and counted on
        -- its project's card instead. But if a DIFFERENT package deleted on
        -- its own is restored, its live project comes back too, live projects
        -- carry no trash card, and the swept sibling's flag is untouched by
        -- that restore. Without the "project no longer trashed" escape hatch
        -- that sibling would be invisible in trash AND gone from the
        -- dashboard — unrestorable until the purge job destroys it.
        AND (NOT po.deleted_with_project OR pr.deleted_at IS NULL)
        AND po.deleted_at > now() - ${cutoff}::interval
    ) t
    ORDER BY "deletedAt" DESC, id
  `;

  const now = new Date();
  return rows.map((r) => {
    // The Neon HTTP driver returns TIMESTAMPTZ as a Date object, not a
    // string (see toIso() in app/api/portals/[id]/activity/route.ts). Resolve
    // once and reuse for both fields below, so they describe the same instant.
    const at =
      r.deletedAt instanceof Date ? r.deletedAt : new Date(String(r.deletedAt));

    return {
      id: r.id as string,
      kind: r.kind as 'project' | 'package',
      name: r.name as string,
      projectName: (r.projectName as string | null) ?? null,
      // BIGINT and COUNT come back from the HTTP driver as strings. Without
      // Number() these concatenate instead of adding, which is how "10485760"
      // becomes "1048576010485760" downstream.
      sweptPackageCount: Number(r.sweptPackageCount ?? 0),
      bytes: Number(r.bytes ?? 0),
      deletedAt: at.toISOString(),
      deletedByName: (r.deletedByName as string | null) ?? null,
      daysLeft: daysRemaining(at, now),
    };
  });
}

/**
 * Put something back.
 *
 * Returns 'not-found' for a missing id, an id the caller does not control, and
 * an id past its window — all deliberately indistinguishable, so the endpoint
 * cannot be used to probe what exists.
 *
 * The window is re-checked here and not only in the panel: a trash panel left
 * open overnight must not resurrect something that expired while it sat there.
 */
export async function restoreFromTrash(
  userId: string,
  kind: 'project' | 'package',
  id: string
): Promise<'ok' | 'not-found'> {
  const cutoff = `${TRASH_RETENTION_DAYS} days`;

  if (kind === 'project') {
    const result = await sql`
      UPDATE projects
      SET deleted_at = NULL, deleted_by = NULL
      WHERE id = ${id}
        AND owner_id = ${userId}
        AND deleted_at IS NOT NULL
        AND deleted_at > now() - ${cutoff}::interval
      RETURNING id
    `;
    if (!result[0]) return 'not-found';

    // Only the packages this project swept up. One deleted deliberately before
    // the project was stays in the trash on its own clock — nobody asked for it
    // back, and reviving it would undo a decision nobody revisited.
    await sql`
      UPDATE portals
      SET deleted_at = NULL, deleted_by = NULL, deleted_with_project = FALSE
      WHERE project_id = ${id} AND deleted_with_project
    `;
    return 'ok';
  }

  // Restoring a package whose project is also trashed restores the project
  // too. A package cannot exist without one, every read path checks both, and
  // the intent is unambiguous — an empty restored project is harmless, an
  // unreachable restored package is a bug report.
  //
  // One transaction, and the project UPDATE is guarded on its own window: a
  // package inside a project that expired first must not drag a corpse back.
  const rows = await sql`
    SELECT po.id, po.project_id AS "projectId"
    FROM portals po
    JOIN projects pr ON pr.id = po.project_id
    LEFT JOIN project_members pm
      ON pm.project_id = pr.id AND pm.user_id = ${userId}
    WHERE po.id = ${id}
      AND po.deleted_at IS NOT NULL
      AND po.deleted_at > now() - ${cutoff}::interval
      AND (pr.deleted_at IS NULL OR pr.deleted_at > now() - ${cutoff}::interval)
      AND (pr.owner_id = ${userId}
           OR (pm.user_id IS NOT NULL AND pm.role = 'coordinator'))
  `;
  if (!rows[0]) return 'not-found';

  await sql.transaction([
    sql`
      UPDATE projects
      SET deleted_at = NULL, deleted_by = NULL
      WHERE id = ${rows[0].projectId} AND deleted_at IS NOT NULL
    `,
    sql`
      UPDATE portals
      SET deleted_at = NULL, deleted_by = NULL, deleted_with_project = FALSE
      WHERE id = ${id}
    `,
  ]);
  return 'ok';
}
