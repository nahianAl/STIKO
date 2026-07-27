import { sql } from '@/lib/db';
import { deriveStatus, type VersionStatus, type Verdict } from '@/lib/status';
import type { DisclosureState } from '@/lib/disclosure';

/**
 * Aggregate reads for the redesigned screens.
 *
 * Everything here is scoped to what the caller may actually see — a package is a
 * permission boundary (01), so counts, names and avatars from a package the
 * viewer isn't on must never appear, not even as a number.
 */

export interface PackageCard {
  id: string;
  name: string;
  tag: string | null;
  projectId: string;
  projectName: string;
  status: VersionStatus;
  versionNumber: number | null;
  changelog: string | null;
  fileCount: number;
  openComments: number;
  updatedAt: string | null;
  updatedByName: string | null;
  people: { id: string; name: string; pending?: boolean }[];
  /** Personal: has this viewer seen the latest version? */
  seenLatest: boolean;
  mentions: number;
}

/** Everything home (5a / 5b / 2f / 3m) needs, in one pass. */
export async function getHomeData(userId: string): Promise<{
  packages: PackageCard[];
  disclosure: DisclosureState;
  isGuestOnly: boolean;
}> {
  const rows = await sql`
    WITH visible AS (
      SELECT DISTINCT po.id, po.name, po.tag, po.project_id,
             pr.name AS project_name,
             (pr.owner_id = ${userId} OR pm.user_id IS NOT NULL) AS is_member
      FROM portals po
      JOIN projects pr ON pr.id = po.project_id
      LEFT JOIN project_members pm
        ON pm.project_id = pr.id AND pm.user_id = ${userId}
      LEFT JOIN participants pa
        ON pa.portal_id = po.id AND pa.user_id = ${userId}
      WHERE po.archived_at IS NULL
        AND (pr.owner_id = ${userId} OR pm.user_id IS NOT NULL OR pa.user_id IS NOT NULL)
    ),
    latest AS (
      SELECT DISTINCT ON (v.portal_id)
             v.portal_id, v.id AS version_id, v.version_number, v.changelog,
             v.published_at, v.created_by
      FROM versions v
      JOIN visible ON visible.id = v.portal_id
      WHERE v.published_at IS NOT NULL
      ORDER BY v.portal_id, v.version_number DESC
    )
    SELECT visible.id, visible.name, visible.tag, visible.project_id AS "projectId",
           visible.project_name AS "projectName", visible.is_member AS "isMember",
           latest.version_id AS "versionId",
           latest.version_number AS "versionNumber",
           latest.changelog,
           latest.published_at AS "publishedAt",
           updater.name AS "updatedByName",
           (SELECT COUNT(*) FROM files f WHERE f.version_id = latest.version_id) AS "fileCount",
           (SELECT COUNT(*) FROM comments c
              JOIN files f ON f.id = c.file_id
             WHERE f.version_id = latest.version_id
               AND c.parent_comment_id IS NULL) AS "openComments",
           (SELECT COUNT(*) FROM version_views vv
             WHERE vv.version_id = latest.version_id AND vv.user_id = ${userId}) AS "seen",
           (SELECT COUNT(*) FROM participants pp WHERE pp.portal_id = visible.id) AS "reviewerCount"
    FROM visible
    LEFT JOIN latest ON latest.portal_id = visible.id
    LEFT JOIN users updater ON updater.id = latest.created_by
    ORDER BY latest.published_at DESC NULLS LAST, visible.name ASC
  `;

  const packageIds = rows.map((r) => r.id as string);

  // Verdicts and people, fetched per-package but only for packages already
  // filtered to the visible set above.
  const verdictRows = packageIds.length
    ? await sql`
        SELECT v.portal_id AS "portalId", vd.verdict
        FROM verdicts vd
        JOIN versions v ON v.id = vd.version_id
        WHERE v.portal_id = ANY(${packageIds})
          AND v.published_at IS NOT NULL
      `
    : [];

  const peopleRows = packageIds.length
    ? await sql`
        SELECT p.portal_id AS "portalId", u.id, u.name
        FROM participants p
        JOIN users u ON u.id = p.user_id
        WHERE p.portal_id = ANY(${packageIds})
      `
    : [];

  const mentionRows = await sql`
    SELECT portal_id AS "portalId", COUNT(*) AS n
    FROM notifications
    WHERE user_id = ${userId} AND type = 'mention' AND read_at IS NULL
    GROUP BY portal_id
  `;

  const verdictsBy = new Map<string, Verdict[]>();
  for (const v of verdictRows) {
    const list = verdictsBy.get(v.portalId as string) ?? [];
    list.push(v.verdict as Verdict);
    verdictsBy.set(v.portalId as string, list);
  }

  const peopleBy = new Map<string, { id: string; name: string }[]>();
  for (const p of peopleRows) {
    const list = peopleBy.get(p.portalId as string) ?? [];
    list.push({ id: p.id as string, name: (p.name as string) ?? 'Someone' });
    peopleBy.set(p.portalId as string, list);
  }

  const mentionsBy = new Map<string, number>();
  for (const m of mentionRows) {
    mentionsBy.set(m.portalId as string, Number(m.n));
  }

  const packages: PackageCard[] = rows.map((r) => {
    const verdicts = verdictsBy.get(r.id as string) ?? [];
    const people = peopleBy.get(r.id as string) ?? [];
    return {
      id: r.id as string,
      name: r.name as string,
      tag: (r.tag as string) ?? null,
      projectId: r.projectId as string,
      projectName: r.projectName as string,
      status: deriveStatus({
        hasVersion: r.versionId != null,
        isPublished: r.publishedAt != null,
        verdicts,
        requiredReviewers: Number(r.reviewerCount ?? 0),
      }),
      versionNumber: r.versionNumber != null ? Number(r.versionNumber) : null,
      changelog: (r.changelog as string) ?? null,
      fileCount: Number(r.fileCount ?? 0),
      openComments: Number(r.openComments ?? 0),
      updatedAt: (r.publishedAt as string) ?? null,
      updatedByName: (r.updatedByName as string) ?? null,
      people,
      seenLatest: Number(r.seen ?? 0) > 0,
      mentions: mentionsBy.get(r.id as string) ?? 0,
    };
  });

  const notificationCount = Number(
    (
      await sql`
        SELECT COUNT(*) AS n FROM notifications
        WHERE user_id = ${userId} AND read_at IS NULL
      `
    )[0]?.n ?? 0
  );

  const needsYouCount = packages.filter(
    (p) => p.mentions > 0 || (p.versionNumber != null && !p.seenLatest)
  ).length;

  const isGuestOnly = rows.length > 0 && rows.every((r) => !r.isMember);

  const disclosure: DisclosureState = {
    packageCount: packages.length,
    fileCount: packages.reduce((n, p) => n + p.fileCount, 0),
    notificationCount,
    needsYouCount,
    packagesInProject: 0,
    peopleCount: 0,
    reviewerCount: 0,
    hasPublishedVersion: packages.some((p) => p.versionNumber != null),
    versionCount: 0,
  };

  return { packages, disclosure, isGuestOnly };
}
