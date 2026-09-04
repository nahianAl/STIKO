import { sql } from '@/lib/db';
import { capabilitiesFor, canDeleteContent, canDownloadFile, canSeeVersion, type Capabilities, type DeleteContext, type DownloadContext, type EffectiveRole, type PackageRole, type ProjectRole, type VersionScope } from '@/lib/capabilities';

export { capabilitiesFor, canDeleteContent, canDownloadFile, canSeeVersion };
export type { Capabilities, DeleteContext, DownloadContext, EffectiveRole, PackageRole, ProjectRole, VersionScope };

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
  /** Whether this person may take copies of files away. Always true for members. */
  mayDownload: boolean;
  /** Which versions this person may see. Always 'all' for members and uploaders. */
  versionScope: VersionScope;
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
      pa.role     AS "guestRole",
      pa.can_download AS "guestCanDownload",
      pa.id           AS "participantId",
      pa.all_versions AS "guestAllVersions"
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
    return { role: 'owner', isProjectMember: true, mayDownload: true, versionScope: 'all', ...capabilitiesFor('owner') };
  }

  if (row.memberRole === 'coordinator') {
    return { role: 'coordinator', isProjectMember: true, mayDownload: true, versionScope: 'all', ...capabilitiesFor('coordinator') };
  }

  const guest = row.guestRole as PackageRole | null;
  if (!guest) return null;

  // An uploader's work builds on what came before, so scoping one would break
  // the thing they are there to do. Only commenters and viewers are narrowed.
  let versionScope: VersionScope = 'all';
  if (guest !== 'uploader' && row.guestAllVersions === false) {
    const scoped = await sql`
      SELECT version_id AS "versionId"
      FROM participant_versions
      WHERE participant_id = ${row.participantId}
    `;
    versionScope = scoped.map((r) => r.versionId as string);
  }

  return {
    role: guest,
    isProjectMember: false,
    mayDownload: Boolean(row.guestCanDownload),
    versionScope,
    ...capabilitiesFor(guest),
  };
}

/**
 * The caller's access to one version, or null if they may not see it.
 *
 * Null covers three cases deliberately made indistinguishable: no such
 * version, no access to its package, and not in your scope. A version you were
 * not given must look exactly like one that never existed, or the id becomes a
 * way to learn what a package contains.
 */
export async function getVersionAccess(
  userId: string,
  versionId: string
): Promise<Access | null> {
  const rows = await sql`
    SELECT portal_id AS "portalId" FROM versions WHERE id = ${versionId}
  `;
  if (!rows[0]) return null;

  const access = await getPackageAccess(userId, rows[0].portalId as string);
  if (!access) return null;
  if (!canSeeVersion(access.versionScope, versionId)) return null;

  return access;
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
 * The package and version a file belongs to, or null if there is no such file.
 *
 * Anything keyed by fileId — comments, markups, downloads — must resolve
 * through here before answering, or the fileId itself becomes the capability.
 */
export async function portalForFile(
  fileId: string
): Promise<{ portalId: string; versionId: string } | null> {
  const rows = await sql`
    SELECT v.portal_id AS "portalId", v.id AS "versionId"
    FROM files f JOIN versions v ON v.id = f.version_id
    WHERE f.id = ${fileId}
    LIMIT 1
  `;
  return rows[0]
    ? { portalId: rows[0].portalId as string, versionId: rows[0].versionId as string }
    : null;
}

/**
 * The caller's access to the package a file lives in, or null if they may not
 * see it — including when the file's version is outside their scope.
 */
export async function getFileAccess(
  userId: string,
  fileId: string
): Promise<Access | null> {
  const location = await portalForFile(fileId);
  if (!location) return null;

  const access = await getPackageAccess(userId, location.portalId);
  if (!access) return null;
  if (!canSeeVersion(access.versionScope, location.versionId)) return null;

  return access;
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
 * The R2 objects belonging to these files.
 *
 * Deliberately limited to the uploads themselves and their optimized variants.
 * Comment snapshots and attachments also hang off these files and are also
 * orphaned when the comments cascade — but their keys are minted flat, as
 * `snapshots/{uuid}` and `comment-attachments/{uuid}`, with no project or
 * portal segment, and /api/comments stores whichever key the caller supplies.
 * Collecting them here would therefore let a commenter name another package's
 * snapshot on their own comment, delete their own file, and destroy an object
 * they never had access to.
 *
 * So those two kinds leak on delete, as they did before deletion existed.
 * Restore them here once the two namespaces carry a portal segment and the
 * routes that mint them require a session — not before.
 */
export async function storageKeysForFiles(fileIds: string[]): Promise<string[]> {
  if (fileIds.length === 0) return [];

  const fileRows = await sql`
    SELECT storage_key AS "storageKey",
           converted_storage_key AS "convertedStorageKey"
    FROM files WHERE id = ANY(${fileIds})
  `;

  const keys = fileRows.flatMap((r) => [r.storageKey, r.convertedStorageKey]);

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

export interface DownloadDecision {
  allowed: boolean;
  /** The ORIGINAL object, never the viewer's optimized variant. */
  storageKey: string;
  filename: string;
}

/**
 * May this user take a copy of this file, and which object is the copy?
 *
 * Returns null when the file does not exist OR the caller cannot see its
 * package — the caller must not be able to tell those apart, or the id becomes
 * an existence oracle.
 *
 * The key returned is storage_key and never converted_storage_key: a download
 * is the file the uploader supplied, not the copy the viewer prefers.
 */
export async function getFileDownloadDecision(
  userId: string,
  fileId: string
): Promise<DownloadDecision | null> {
  const rows = await sql`
    SELECT v.portal_id     AS "portalId",
           f.uploaded_by   AS "uploadedBy",
           f.storage_key   AS "storageKey",
           f.filename      AS "filename"
    FROM files f
    JOIN versions v ON v.id = f.version_id
    WHERE f.id = ${fileId}
  `;
  const row = rows[0];
  if (!row) return null;

  const access = await getPackageAccess(userId, row.portalId as string);
  if (!access) return null;

  return {
    allowed: canDownloadFile({
      role: access.role,
      isOwnUpload: row.uploadedBy === userId,
      mayDownload: access.mayDownload,
    }),
    storageKey: row.storageKey as string,
    filename: row.filename as string,
  };
}
