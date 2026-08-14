import { sql } from '@/lib/db';
import { capabilitiesFor, type Capabilities, type EffectiveRole, type PackageRole, type ProjectRole } from '@/lib/capabilities';

export { capabilitiesFor };
export type { Capabilities, EffectiveRole, PackageRole, ProjectRole };

/**
 * Access control — stiko_handoff/01.
 *
 * "A package is not a folder for tidiness — it is a wall." Anything that leaks
 * package contents across that boundary is a bug, so every read path that
 * touches package data goes through these helpers rather than trusting an id
 * from the client.
 *
 * Two tiers:
 *   - Project members (owner, coordinator) see every package in the project.
 *   - Package guests (viewer, commenter, uploader) see only the packages they
 *     are explicitly on — not the project, not its other packages, and not the
 *     existence of anyone on them.
 */

export interface Access extends Capabilities {
  role: EffectiveRole;
  /** Project members can see the project and all its packages. */
  isProjectMember: boolean;
}

/**
 * What, if anything, this user may do with this package. Returns null when they
 * have no access at all — callers must treat that as 404/403, never as "empty".
 */
export async function getPackageAccess(
  userId: string,
  portalId: string
): Promise<Access | null> {
  const rows = await sql`
    SELECT
      pr.owner_id AS "ownerId",
      pm.role     AS "memberRole",
      pa.role     AS "guestRole"
    FROM portals po
    JOIN projects pr ON pr.id = po.project_id
    LEFT JOIN project_members pm
      ON pm.project_id = pr.id AND pm.user_id = ${userId}
    LEFT JOIN participants pa
      ON pa.portal_id = po.id AND pa.user_id = ${userId}
    WHERE po.id = ${portalId}
  `;

  const row = rows[0];
  if (!row) return null;

  if (row.ownerId === userId) {
    return { role: 'owner', isProjectMember: true, ...capabilitiesFor('owner') };
  }

  if (row.memberRole === 'coordinator') {
    return { role: 'coordinator', isProjectMember: true, ...capabilitiesFor('coordinator') };
  }

  const guest = row.guestRole as PackageRole | null;
  if (!guest) return null;

  return { role: guest, isProjectMember: false, ...capabilitiesFor(guest) };
}

/** Whether this user can see the project itself (members only, never guests). */
export async function isProjectMember(
  userId: string,
  projectId: string
): Promise<boolean> {
  const rows = await sql`
    SELECT 1
    FROM projects pr
    LEFT JOIN project_members pm
      ON pm.project_id = pr.id AND pm.user_id = ${userId}
    WHERE pr.id = ${projectId}
      AND (pr.owner_id = ${userId} OR pm.user_id IS NOT NULL)
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * The package a file belongs to, or null if there is no such file.
 *
 * Anything keyed by fileId — comments, markups, downloads — must resolve
 * through here before answering, or the fileId itself becomes the capability.
 */
export async function portalForFile(fileId: string): Promise<string | null> {
  const rows = await sql`
    SELECT v.portal_id AS "portalId"
    FROM files f JOIN versions v ON v.id = f.version_id
    WHERE f.id = ${fileId}
    LIMIT 1
  `;
  return rows[0] ? (rows[0].portalId as string) : null;
}

/** Convenience: the caller's access to the package a file lives in. */
export async function getFileAccess(
  userId: string,
  fileId: string
): Promise<Access | null> {
  const portalId = await portalForFile(fileId);
  if (!portalId) return null;
  return getPackageAccess(userId, portalId);
}

/** Every package id this user may see, across everything. */
export async function visiblePackageIds(userId: string): Promise<string[]> {
  const rows = await sql`
    SELECT DISTINCT po.id
    FROM portals po
    JOIN projects pr ON pr.id = po.project_id
    LEFT JOIN project_members pm
      ON pm.project_id = pr.id AND pm.user_id = ${userId}
    LEFT JOIN participants pa
      ON pa.portal_id = po.id AND pa.user_id = ${userId}
    WHERE po.archived_at IS NULL
      AND (pr.owner_id = ${userId} OR pm.user_id IS NOT NULL OR pa.user_id IS NOT NULL)
  `;
  return rows.map((r) => r.id as string);
}
