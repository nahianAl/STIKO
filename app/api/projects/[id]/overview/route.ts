import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { isProjectMember } from '@/lib/access';
import { deriveStatus, type Verdict } from '@/lib/status';

/**
 * Everything the project screens need: packages with signal (2g), the people
 * matrix (4a), and the per-person review state behind "Waiting on" (4b).
 *
 * Project-member only. A package guest has no business seeing the project or
 * the existence of its other packages (01).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await isProjectMember(session.user.id, params.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const projectRows = await sql`
    SELECT id, name, description, created_at AS "createdAt", owner_id AS "ownerId"
    FROM projects WHERE id = ${params.id}
  `;
  const project = projectRows[0];
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const packageRows = await sql`
    SELECT po.id, po.name, po.tag,
           v.id AS "versionId", v.version_number AS "versionNumber",
           v.changelog, v.published_at AS "publishedAt",
           u.name AS "updatedByName"
    FROM portals po
    LEFT JOIN LATERAL (
      SELECT id, version_number, changelog, published_at, created_by
      FROM versions
      WHERE portal_id = po.id AND published_at IS NOT NULL
      ORDER BY version_number DESC LIMIT 1
    ) v ON TRUE
    LEFT JOIN users u ON u.id = v.created_by
    WHERE po.project_id = ${params.id} AND po.archived_at IS NULL
    ORDER BY po.created_at ASC
  `;

  const packageIds = packageRows.map((p) => p.id as string);

  const participantRows = packageIds.length
    ? await sql`
        SELECT p.portal_id AS "portalId", p.role, u.id, u.name, u.email, u.company
        FROM participants p
        JOIN users u ON u.id = p.user_id
        WHERE p.portal_id = ANY(${packageIds})
      `
    : [];

  const pendingRows = packageIds.length
    ? await sql`
        SELECT portal_id AS "portalId", email, role, created_at AS "createdAt",
               expires_at AS "expiresAt"
        FROM invite_tokens
        WHERE portal_id = ANY(${packageIds})
          AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
      `
    : [];

  const verdictRows = packageIds.length
    ? await sql`
        SELECT v.portal_id AS "portalId", vd.user_id AS "userId", vd.verdict
        FROM verdicts vd
        JOIN versions v ON v.id = vd.version_id
        WHERE v.portal_id = ANY(${packageIds}) AND v.published_at IS NOT NULL
      `
    : [];

  // 4b needs three states per person: not opened, viewed but silent, commented.
  const viewRows = packageIds.length
    ? await sql`
        SELECT v.portal_id AS "portalId", vv.user_id AS "userId",
               vv.viewed_at AS "viewedAt"
        FROM version_views vv
        JOIN versions v ON v.id = vv.version_id
        WHERE v.portal_id = ANY(${packageIds})
      `
    : [];

  const commentRows = packageIds.length
    ? await sql`
        SELECT v.portal_id AS "portalId", c.user_id AS "userId",
               MAX(c.created_at) AS "lastAt", COUNT(*) AS n
        FROM comments c
        JOIN files f ON f.id = c.file_id
        JOIN versions v ON v.id = f.version_id
        WHERE v.portal_id = ANY(${packageIds})
        GROUP BY v.portal_id, c.user_id
      `
    : [];

  const fileCountRows = packageIds.length
    ? await sql`
        SELECT v.portal_id AS "portalId", COUNT(f.id) AS n
        FROM versions v LEFT JOIN files f ON f.version_id = v.id
        WHERE v.portal_id = ANY(${packageIds}) AND v.published_at IS NOT NULL
        GROUP BY v.portal_id
      `
    : [];

  const openCommentRows = packageIds.length
    ? await sql`
        SELECT v.portal_id AS "portalId", COUNT(c.id) AS n
        FROM comments c
        JOIN files f ON f.id = c.file_id
        JOIN versions v ON v.id = f.version_id
        WHERE v.portal_id = ANY(${packageIds}) AND c.parent_comment_id IS NULL
        GROUP BY v.portal_id
      `
    : [];

  const memberRows = await sql`
    SELECT u.id, u.name, u.email, u.company,
           CASE WHEN pr.owner_id = u.id THEN 'owner' ELSE pm.role END AS role
    FROM projects pr
    LEFT JOIN project_members pm ON pm.project_id = pr.id
    LEFT JOIN users u ON u.id = COALESCE(pm.user_id, pr.owner_id)
    WHERE pr.id = ${params.id} AND u.id IS NOT NULL
  `;

  const num = (rows: Record<string, unknown>[], id: string) =>
    Number(rows.find((r) => r.portalId === id)?.n ?? 0);

  const packages = packageRows.map((p) => {
    const id = p.id as string;
    const participants = participantRows.filter((r) => r.portalId === id);
    const verdicts = verdictRows
      .filter((r) => r.portalId === id)
      .map((r) => r.verdict as Verdict);

    return {
      id,
      name: p.name as string,
      tag: (p.tag as string) ?? null,
      versionNumber: p.versionNumber != null ? Number(p.versionNumber) : null,
      changelog: (p.changelog as string) ?? null,
      publishedAt: (p.publishedAt as string) ?? null,
      updatedByName: (p.updatedByName as string) ?? null,
      fileCount: num(fileCountRows, id),
      openComments: num(openCommentRows, id),
      status: deriveStatus({
        hasVersion: p.versionId != null,
        isPublished: p.publishedAt != null,
        verdicts,
        requiredReviewers: participants.length,
      }),
      people: participants.map((r) => ({
        id: r.id as string,
        name: (r.name as string) ?? (r.email as string),
        email: r.email as string,
        company: (r.company as string) ?? null,
        role: r.role as string,
        verdict:
          (verdictRows.find((v) => v.portalId === id && v.userId === r.id)
            ?.verdict as string) ?? null,
        viewedAt:
          (viewRows.find((v) => v.portalId === id && v.userId === r.id)
            ?.viewedAt as string) ?? null,
        commentCount: Number(
          commentRows.find((c) => c.portalId === id && c.userId === r.id)?.n ?? 0
        ),
        lastCommentAt:
          (commentRows.find((c) => c.portalId === id && c.userId === r.id)
            ?.lastAt as string) ?? null,
      })),
      pending: pendingRows
        .filter((r) => r.portalId === id)
        .map((r) => ({
          email: r.email as string,
          role: r.role as string,
          createdAt: r.createdAt as string,
          expiresAt: r.expiresAt as string,
        })),
    };
  });

  const uniquePeople = new Set(
    participantRows.map((r) => r.id as string).concat(memberRows.map((m) => m.id as string))
  );

  return NextResponse.json({
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      createdAt: project.createdAt,
    },
    members: memberRows.map((m) => ({
      id: m.id as string,
      name: (m.name as string) ?? (m.email as string),
      email: m.email as string,
      company: (m.company as string) ?? null,
      role: m.role as string,
      isYou: m.id === session.user!.id,
    })),
    packages,
    disclosure: {
      packagesInProject: packages.length,
      peopleCount: uniquePeople.size,
      hasPublishedVersion: packages.some((p) => p.versionNumber != null),
    },
  });
}
