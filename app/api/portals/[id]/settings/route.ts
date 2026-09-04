import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';
import { deriveStatus, type Verdict } from '@/lib/status';

/**
 * The package settings screen (3l), including the real counts the destructive
 * confirm needs — 3q requires counting exactly what dies, not placeholders.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await getPackageAccess(session.user.id, params.id);
  // The payload is package-wide — counts across every version, the true latest
  // version and its status. A scoped reviewer must not learn any of that, and
  // both consumers of this route are manager screens.
  if (!access?.canManagePeople) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const portalRows = await sql`
    SELECT po.id, po.name, po.tag, po.link_access AS "linkAccess",
           po.project_id AS "projectId", pr.name AS "projectName"
    FROM portals po JOIN projects pr ON pr.id = po.project_id
    WHERE po.id = ${params.id}
  `;
  const portal = portalRows[0];
  if (!portal) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const counts = await sql`
    SELECT
      (SELECT COUNT(*) FROM versions WHERE portal_id = ${params.id}) AS versions,
      (SELECT COUNT(*) FROM files f JOIN versions v ON v.id = f.version_id
        WHERE v.portal_id = ${params.id}) AS files,
      (SELECT COUNT(*) FROM comments c JOIN files f ON f.id = c.file_id
        JOIN versions v ON v.id = f.version_id
        WHERE v.portal_id = ${params.id}) AS comments,
      (SELECT COUNT(*) FROM comments c JOIN files f ON f.id = c.file_id
        JOIN versions v ON v.id = f.version_id
        WHERE v.portal_id = ${params.id} AND c.parent_comment_id IS NULL) AS "openComments",
      (SELECT COUNT(*) FROM participants WHERE portal_id = ${params.id}) AS people
  `;

  const latest = await sql`
    SELECT id, version_number AS "versionNumber", published_at AS "publishedAt"
    FROM versions
    WHERE portal_id = ${params.id} AND published_at IS NOT NULL
    ORDER BY version_number DESC LIMIT 1
  `;

  const verdicts = latest[0]
    ? await sql`SELECT verdict FROM verdicts WHERE version_id = ${latest[0].id}`
    : [];

  const muted = await sql`
    SELECT 1 FROM portal_mutes
    WHERE portal_id = ${params.id} AND user_id = ${session.user.id}
  `;

  return NextResponse.json({
    package: {
      id: portal.id,
      name: portal.name,
      tag: portal.tag,
      linkAccess: portal.linkAccess,
      projectId: portal.projectId,
      projectName: portal.projectName,
    },
    access,
    counts: {
      versions: Number(counts[0].versions),
      files: Number(counts[0].files),
      comments: Number(counts[0].comments),
      openComments: Number(counts[0].openComments),
      people: Number(counts[0].people),
    },
    status: deriveStatus({
      hasVersion: latest.length > 0,
      isPublished: Boolean(latest[0]?.publishedAt),
      verdicts: verdicts.map((v) => v.verdict as Verdict),
      requiredReviewers: Number(counts[0].people),
    }),
    latestVersionNumber: latest[0] ? Number(latest[0].versionNumber) : null,
    muted: muted.length > 0,
  });
}
