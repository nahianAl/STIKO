import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { canDeleteContent, canSeeVersion, getPackageAccess } from '@/lib/access';

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

  // A scoped reviewer sees only their versions — no row, no count, nothing
  // about the rest. The version number still reveals that a history exists,
  // which is accepted; the content of it does not.
  const visible = rows.filter((r) =>
    canSeeVersion(access.versionScope, r.id as string)
  );

  // Counts come back with the rows so the delete confirm can state what dies
  // without a second round trip.
  const counts = visible.length
    ? await sql`
        SELECT v.id,
               COUNT(DISTINCT f.id) AS "fileCount",
               COUNT(DISTINCT c.id) AS "commentCount"
        FROM versions v
        LEFT JOIN files f ON f.version_id = v.id
        LEFT JOIN comments c ON c.file_id = f.id
        WHERE v.id = ANY(${visible.map((r) => r.id as string)})
        GROUP BY v.id
      `
    : [];
  const countsById = new Map(
    counts.map((c) => [
      c.id as string,
      {
        fileCount: Number(c.fileCount),
        commentCount: Number(c.commentCount),
      },
    ])
  );

  return NextResponse.json(
    visible.map((row) => ({
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

  // Taken from the package's own counter, not from MAX over live rows: the
  // latter hands the number back when the newest version is deleted, letting a
  // new version inherit the identity of one that emails and notifications
  // already named. UPDATE ... RETURNING is atomic, so two concurrent creates
  // cannot collide either.
  const claimed = await sql`
    UPDATE portals SET last_version_number = last_version_number + 1
    WHERE id = ${portalId}
    RETURNING last_version_number AS "versionNumber"
  `;
  if (!claimed[0]) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const nextVersion = Number(claimed[0].versionNumber);

  const rows = await sql`
    INSERT INTO versions (id, portal_id, version_number, created_by)
    VALUES (${uuidv4()}, ${portalId}, ${nextVersion}, ${session.user.id})
    RETURNING id, portal_id AS "portalId", version_number AS "versionNumber",
              published_at AS "publishedAt", created_at AS "createdAt"
  `;
  return NextResponse.json(rows[0], { status: 201 });
}
