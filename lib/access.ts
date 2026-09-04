import { sql } from '@/lib/db';
import { capabilitiesFor, canDeleteContent, type Capabilities, type DeleteContext, type EffectiveRole, type PackageRole, type ProjectRole } from '@/lib/capabilities';

export { capabilitiesFor, canDeleteContent };
export type { Capabilities, DeleteContext, EffectiveRole, PackageRole, ProjectRole };

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

export interface DeleteDecision {
  allowed: boolean;
  portalId: string;
  /** R2 keys to clean up once the rows are gone. Nulls are filtered out. */
  storageKeys: string[];
}

/**
 * Every R2 object belonging to these files — the uploads themselves and
 * everything hanging off their comments.
 *
 * Comments cascade when a file is deleted, so their snapshots and attachments
 * become unreachable the moment the rows go: nothing left names those keys, and
 * no later sweep can find them from the database. They have to be collected
 * before the delete, alongside the files' own keys.
 *
 * snapshot_url holds a storage key only when it is not an external URL or an
 * inline data URI — the same test app/api/comments/route.ts applies when
 * deciding whether to presign it.
 */
export async function storageKeysForFiles(fileIds: string[]): Promise<string[]> {
  if (fileIds.length === 0) return [];

  const fileRows = await sql`
    SELECT storage_key AS "storageKey",
           converted_storage_key AS "convertedStorageKey"
    FROM files WHERE id = ANY(${fileIds})
  `;

  const snapshotRows = await sql`
    SELECT snapshot_url AS "snapshotUrl"
    FROM comments
    WHERE file_id = ANY(${fileIds})
      AND snapshot_url IS NOT NULL
      AND snapshot_url NOT LIKE 'http%'
      AND snapshot_url NOT LIKE 'data:%'
  `;

  // The attachments column is a JSONB array of {storageKey, ...} objects. The
  // jsonb_typeof guard is the same one app/api/files/url/route.ts uses: a row
  // holding anything other than an array would otherwise abort the query.
  const attachmentRows = await sql`
    SELECT att->>'storageKey' AS "storageKey"
    FROM comments c,
         jsonb_array_elements(
           CASE jsonb_typeof(c.attachments)
             WHEN 'array' THEN c.attachments
             ELSE '[]'::jsonb
           END
         ) AS att
    WHERE c.file_id = ANY(${fileIds})
  `;

  const keys = [
    ...fileRows.flatMap((r) => [r.storageKey, r.convertedStorageKey]),
    ...snapshotRows.map((r) => r.snapshotUrl),
    ...attachmentRows.map((r) => r.storageKey),
  ];

  // Deduplicated because a key deleted twice logs a spurious failure on the
  // second attempt, and nothing guarantees two rows cannot name one object.
  return Array.from(
    new Set(
      keys.filter((k): k is string => typeof k === 'string' && k.length > 0)
    )
  );
}

/**
 * May this user delete this file, and what does deleting it strand in storage?
 *
 * Returns null when the file does not exist OR the caller cannot see its
 * package — the caller must not be able to tell those apart, or the id becomes
 * an existence oracle.
 *
 * The storage keys come back with the verdict because the rows are gone by the
 * time cleanup runs; re-querying afterwards would find nothing.
 */
export async function getFileDeleteDecision(
  userId: string,
  fileId: string
): Promise<DeleteDecision | null> {
  const rows = await sql`
    SELECT v.portal_id       AS "portalId",
           f.uploaded_by     AS "uploadedBy",
           v.published_at    AS "publishedAt"
    FROM files f
    JOIN versions v ON v.id = f.version_id
    WHERE f.id = ${fileId}
  `;
  const row = rows[0];
  if (!row) return null;

  const access = await getPackageAccess(userId, row.portalId as string);
  if (!access) return null;

  return {
    allowed: canDeleteContent({
      role: access.role,
      isOwnUpload: row.uploadedBy === userId,
      isPublished: row.publishedAt !== null,
    }),
    portalId: row.portalId as string,
    storageKeys: await storageKeysForFiles([fileId]),
  };
}

/**
 * May this user delete this whole version, and what does it strand in storage?
 *
 * isOwnUpload is always false — see the note on canDeleteContent. In practice
 * that restricts version deletion to owners and coordinators.
 */
export async function getVersionDeleteDecision(
  userId: string,
  versionId: string
): Promise<DeleteDecision | null> {
  const rows = await sql`
    SELECT portal_id AS "portalId", published_at AS "publishedAt"
    FROM versions WHERE id = ${versionId}
  `;
  const row = rows[0];
  if (!row) return null;

  const access = await getPackageAccess(userId, row.portalId as string);
  if (!access) return null;

  const fileRows = await sql`
    SELECT id FROM files WHERE version_id = ${versionId}
  `;

  return {
    allowed: canDeleteContent({
      role: access.role,
      isOwnUpload: false,
      isPublished: row.publishedAt !== null,
    }),
    portalId: row.portalId as string,
    storageKeys: await storageKeysForFiles(fileRows.map((f) => f.id as string)),
  };
}
