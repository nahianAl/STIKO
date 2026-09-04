import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { canDeleteContent, getPackageAccess } from '@/lib/access';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const portalId = request.nextUrl.searchParams.get('portalId');
  if (!portalId) {
    return NextResponse.json({ error: 'portalId required' }, { status: 400 });
  }

  const access = await getPackageAccess(session.user.id, portalId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // A draft is only visible to whoever can publish — reviewers see published
  // versions only, so an in-progress version never appears in their rail.
  const rows = access.canUpload
    ? await sql`
        SELECT v.id, v.portal_id AS "portalId",
               v.version_number AS "versionNumber",
               v.changelog, v.published_at AS "publishedAt",
               v.created_at AS "createdAt", u.name AS "createdByName"
        FROM versions v
        LEFT JOIN users u ON u.id = v.created_by
        WHERE v.portal_id = ${portalId}
        ORDER BY v.version_number DESC
      `
    : await sql`
        SELECT v.id, v.portal_id AS "portalId",
               v.version_number AS "versionNumber",
               v.changelog, v.published_at AS "publishedAt",
               v.created_at AS "createdAt", u.name AS "createdByName"
        FROM versions v
        LEFT JOIN users u ON u.id = v.created_by
        WHERE v.portal_id = ${portalId} AND v.published_at IS NOT NULL
        ORDER BY v.version_number DESC
      `;

  // Counts come back with the rows so the delete confirm can state what dies
  // without a second round trip. Only versions the caller can delete need them.
  const counts = await sql`
    SELECT v.id,
           COUNT(DISTINCT f.id) AS "fileCount",
           COUNT(DISTINCT c.id) AS "commentCount"
    FROM versions v
    LEFT JOIN files f ON f.version_id = v.id
    LEFT JOIN comments c ON c.file_id = f.id
    WHERE v.portal_id = ${portalId}
    GROUP BY v.id
  `;
  const countsById = new Map(
    counts.map((c) => [
      c.id as string,
      { fileCount: Number(c.fileCount), commentCount: Number(c.commentCount) },
    ])
  );

  return NextResponse.json(
    rows.map((row) => ({
      ...row,
      canDelete: canDeleteContent({
        role: access.role,
        isOwnUpload: false,
        isPublished: row.publishedAt !== null,
      }),
      fileCount: countsById.get(row.id as string)?.fileCount ?? 0,
      commentCount: countsById.get(row.id as string)?.commentCount ?? 0,
    }))
  );
}

/**
 * POST — start a new version as a DRAFT.
 *
 * 2d: "The version is published only when every file lands — a failure here
 * never leaves a half-empty V1 for your reviewers." So creation and publication
 * are two steps, and nothing reaches reviewers until /publish succeeds.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { portalId } = await request.json();
  if (!portalId) {
    return NextResponse.json({ error: 'portalId required' }, { status: 400 });
  }

  const access = await getPackageAccess(session.user.id, portalId);
  if (!access?.canUpload) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const existing = await sql`
    SELECT COALESCE(MAX(version_number), 0) AS max
    FROM versions WHERE portal_id = ${portalId}
  `;
  const nextVersion = Number(existing[0].max) + 1;

  const rows = await sql`
    INSERT INTO versions (id, portal_id, version_number, created_by)
    VALUES (${uuidv4()}, ${portalId}, ${nextVersion}, ${session.user.id})
    RETURNING id, portal_id AS "portalId", version_number AS "versionNumber",
              published_at AS "publishedAt", created_at AS "createdAt"
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
