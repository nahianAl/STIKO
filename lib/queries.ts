import { sql } from '@/lib/db';
import { deriveStatus, type VersionStatus, type Verdict } from '@/lib/status';
import type { DisclosureState } from '@/lib/disclosure';
import { planFor, type Plan } from '@/lib/plans';
import { deriveMyRole } from '@/lib/home';
import type { ProjectRole } from '@/lib/roles';

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
  people: { id: string; name: string; role?: string; pending?: boolean }[];
  /** Personal: has this viewer seen the latest version? */
  seenLatest: boolean;
  mentions: number;
}

/**
 * A project as the dashboard needs it. Deliberately additive to the flat
 * PackageCard[] payload rather than nesting packages inside projects: the flat
 * array is consumed by CommandPalette and mirrored on the project page, and
 * every roll-up the grid needs derives from it.
 */
export interface ProjectSummary {
  id: string;
  name: string;
  /** projects.owner_id = the viewer. */
  ownedByMe: boolean;
  /** The owner's name. Rendered as "you" client-side when ownedByMe. */
  createdByName: string | null;
  /**
   * DISPLAY ONLY — never an authorization input.
   *
   * This is derived: for a guest it is their strongest role across the packages
   * of this project they can see, so `uploader` here can mean "uploader on one
   * package out of ten". Gate any actual permission on getPackageAccess /
   * capabilitiesFor for the specific package instead. (`owner` and
   * `coordinator` are the exception — participants.role is CHECK-constrained to
   * viewer|commenter|uploader, so those two can only come from project_members
   * or ownership, and are genuinely project-level.)
   */
  myRole: ProjectRole | null;
}

/** Everything home (5a / 5b / 2f / 3m) needs, in one pass. */
export async function getHomeData(userId: string): Promise<{
  packages: PackageCard[];
  projects: ProjectSummary[];
  disclosure: DisclosureState;
  isGuestOnly: boolean;
}> {
  const rows = await sql`
    WITH visible AS (
      SELECT DISTINCT po.id, po.name, po.tag, po.project_id,
             pr.name AS project_name, pr.owner_id,
             pm.role AS member_role,
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
        -- "Latest" must mean latest the viewer may see (mirrors getPackageAccess),
        -- or a scoped commenter/viewer would have the contents of a version they
        -- were deliberately not given surfaced on the first screen they land on.
        AND (
          EXISTS (
            SELECT 1 FROM participants pa
            WHERE pa.portal_id = v.portal_id AND pa.user_id = ${userId}
              AND (pa.all_versions OR pa.role = 'uploader')
          )
          OR EXISTS (
            SELECT 1 FROM participant_versions pv
            JOIN participants pa2 ON pa2.id = pv.participant_id
            WHERE pa2.portal_id = v.portal_id AND pa2.user_id = ${userId}
              AND pv.version_id = v.id
          )
          -- Project members see every version; the visible CTE already derived
          -- this exact membership boolean via the same owner/project_members
          -- join, so reuse it rather than re-deriving it here.
          OR visible.is_member
        )
      ORDER BY v.portal_id, v.version_number DESC
    )
    SELECT visible.id, visible.name, visible.tag, visible.project_id AS "projectId",
           visible.project_name AS "projectName", visible.is_member AS "isMember",
           (visible.owner_id = ${userId}) AS "ownedByMe",
           visible.member_role AS "memberRole",
           owner.name AS "ownerName",
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
    LEFT JOIN users owner ON owner.id = visible.owner_id
    LEFT JOIN latest ON latest.portal_id = visible.id
    LEFT JOIN users updater ON updater.id = latest.created_by
    ORDER BY latest.published_at DESC NULLS LAST, visible.name ASC
  `;

  const packageIds = rows.map((r) => r.id as string);
  // visible.is_member was already computed above, per portal, for this exact
  // user — reused here rather than re-derived through a second join.
  const memberPortalIds = rows
    .filter((r) => r.isMember)
    .map((r) => r.id as string);

  // Verdicts and people, fetched per-package but only for packages already
  // filtered to the visible set above.
  //
  // The status badge must not reflect verdict signal from a version a scoped
  // commenter or viewer cannot see, so eligibility here mirrors the `latest`
  // CTE above exactly: an unscoped-or-uploader participant, an explicit
  // participant_versions row for that version, or project membership.
  const verdictRows = packageIds.length
    ? await sql`
        SELECT v.portal_id AS "portalId", vd.verdict
        FROM verdicts vd
        JOIN versions v ON v.id = vd.version_id
        WHERE v.portal_id = ANY(${packageIds})
          AND v.published_at IS NOT NULL
          AND (
            EXISTS (
              SELECT 1 FROM participants pa
              WHERE pa.portal_id = v.portal_id AND pa.user_id = ${userId}
                AND (pa.all_versions OR pa.role = 'uploader')
            )
            OR EXISTS (
              SELECT 1 FROM participant_versions pv
              JOIN participants pa2 ON pa2.id = pv.participant_id
              WHERE pa2.portal_id = v.portal_id AND pa2.user_id = ${userId}
                AND pv.version_id = v.id
            )
            OR v.portal_id = ANY(${memberPortalIds})
          )
      `
    : [];

  const peopleRows = packageIds.length
    ? await sql`
        SELECT p.portal_id AS "portalId", p.role, u.id, u.name
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

  const peopleBy = new Map<
    string,
    { id: string; name: string; role?: string }[]
  >();
  for (const p of peopleRows) {
    const list = peopleBy.get(p.portalId as string) ?? [];
    list.push({
      id: p.id as string,
      name: (p.name as string) ?? 'Someone',
      role: (p.role as string) ?? undefined,
    });
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

  // One entry per distinct project, in the order its packages appear (the
  // query already sorts by recency). The viewer's own role is DERIVED — there
  // is no project-level role column, and inventing one would need a migration.
  const projectsById = new Map<string, ProjectSummary>();
  const viewerRoles = new Map<string, string[]>();

  for (const pkg of packages) {
    const mine = pkg.people.find((p) => p.id === userId)?.role;
    if (mine) {
      viewerRoles.set(pkg.projectId, [
        ...(viewerRoles.get(pkg.projectId) ?? []),
        mine,
      ]);
    }
  }

  for (const r of rows) {
    const id = r.projectId as string;
    if (projectsById.has(id)) continue;
    projectsById.set(id, {
      id,
      name: r.projectName as string,
      ownedByMe: Boolean(r.ownedByMe),
      createdByName: (r.ownerName as string) ?? null,
      myRole: deriveMyRole({
        ownedByMe: Boolean(r.ownedByMe),
        memberRole: (r.memberRole as string) ?? null,
        participantRoles: viewerRoles.get(id) ?? [],
      }),
    });
  }

  const projects = Array.from(projectsById.values());

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

  return { packages, projects, disclosure, isGuestOnly };
}

export interface AccountUsage {
  plan: Plan;
  storage: {
    projectBytes: number;
    trashBytes: number;
    totalBytes: number;
  };
  projects: {
    count: number;
    max: number | null;
  };
}

/**
 * What this account is using, against what its plan allows.
 *
 * Scoped throughout to projects the user OWNS. Projects they were invited into
 * belong to whoever owns them, and counting those here would bill two
 * coordinators for the same bytes.
 *
 * What counts, and why:
 *   - Files in archived packages DO count. The bytes are still in S3, and
 *     archiving is not deleting.
 *   - Files in unpublished drafts DO count, for the same reason.
 *   - Converted derivatives (files.converted_storage_key) do NOT. No byte size
 *     is recorded for them anywhere, and they are bytes the product generated
 *     rather than bytes the user uploaded.
 *   - Markup snapshots (comments.snapshot_url) do NOT, same reason.
 *
 * So the figure is smaller than the true S3 footprint, on purpose: the number
 * on screen should be one the user can act on by deleting their own content.
 *
 * The project COUNT excludes archived projects while the byte total includes
 * archived packages. That asymmetry is intentional — "how much space am I
 * using" and "how many of my projects are in the way" are different questions.
 * Nothing writes projects.archived_at today; the filter is there so the count
 * stays right when project archiving arrives.
 *
 * Every byte counted here is client-asserted, not verified. files.file_size
 * is written straight from the request body in app/api/files/complete/route.ts,
 * and comments.attachments[].size is written straight from the POST body in
 * app/api/comments/route.ts (that route validates storageKey, not size). A
 * client can report any figure it likes for either. Harmless for a readout —
 * a user can only mislead themselves — but if this ever feeds ENFORCEMENT
 * (blocking an upload, gating a plan) rather than just a display, whatever
 * does that must verify the bytes against R2 first, or a caller can mint
 * unlimited quota by lying about `size`.
 */
export async function getAccountUsage(userId: string): Promise<AccountUsage> {
  const rows = await sql`
    WITH owned_files AS (
      SELECT f.id, f.file_size
      FROM files f
      JOIN versions v ON v.id = f.version_id
      JOIN portals po ON po.id = v.portal_id
      JOIN projects pr ON pr.id = po.project_id
      WHERE pr.owner_id = ${userId}
    ),
    file_bytes AS (
      SELECT COALESCE(SUM(file_size), 0) AS bytes FROM owned_files
    ),
    attachment_bytes AS (
      -- Two hazards here, both of which raise rather than return NULL:
      --   jsonb_array_elements() throws on a non-array, and comments.attachments
      --   is nullable with a '[]' default, so a NULL or a scalar is possible.
      --   The CASE normalises those to an empty array before the function sees
      --   them; a WHERE would be applied too late to help.
      --   ::numeric, not ::bigint, because a JSONB number need not be an
      --   integer and '1234.5'::bigint is an error.
      SELECT COALESCE(SUM(
        CASE WHEN jsonb_typeof(att->'size') = 'number'
             THEN (att->>'size')::numeric
             ELSE 0 END
      ), 0) AS bytes
      FROM comments c
      JOIN owned_files f ON f.id = c.file_id
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(c.attachments) = 'array'
             THEN c.attachments
             ELSE '[]'::jsonb END
      ) AS att
    )
    SELECT (SELECT bytes FROM file_bytes) AS "fileBytes",
           (SELECT bytes FROM attachment_bytes) AS "attachmentBytes",
           (SELECT COUNT(*) FROM projects
             WHERE owner_id = ${userId} AND archived_at IS NULL) AS "projectCount",
           (SELECT plan FROM users WHERE id = ${userId}) AS "planId"
  `;

  const row = rows[0] ?? {};

  // The HTTP driver returns BIGINT and NUMERIC aggregates as strings. Without
  // Number() these concatenate instead of adding.
  const projectBytes =
    Number(row.fileBytes ?? 0) + Number(row.attachmentBytes ?? 0);

  // Trash does not exist yet, so this is a real zero rather than a placeholder.
  // When it ships, this becomes the same sum over soft-deleted rows and nothing
  // downstream changes.
  const trashBytes = 0;

  const plan = planFor(row.planId ?? null);

  return {
    plan,
    storage: {
      projectBytes,
      trashBytes,
      totalBytes: projectBytes + trashBytes,
    },
    projects: {
      count: Number(row.projectCount ?? 0),
      max: plan.maxProjects,
    },
  };
}
