import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getVersionAccess } from '@/lib/access';

/**
 * Reviewer verdicts. Version status is derived from these (01) — there is no
 * endpoint that sets a status directly, by design.
 */

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const versionId = request.nextUrl.searchParams.get('versionId');
  if (!versionId) {
    return NextResponse.json({ error: 'versionId required' }, { status: 400 });
  }

  // 404 rather than 403: a version outside the caller's scope must look
  // exactly like one that does not exist.
  const access = await getVersionAccess(session.user.id, versionId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = await sql`
    SELECT vd.id, vd.verdict, vd.note, vd.created_at AS "createdAt",
           u.id AS "userId", u.name
    FROM verdicts vd
    JOIN users u ON u.id = vd.user_id
    WHERE vd.version_id = ${versionId}
  `;

  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { versionId, verdict, note } = await request.json();

  if (verdict !== 'approved' && verdict !== 'changes_requested') {
    return NextResponse.json({ error: 'Invalid verdict' }, { status: 400 });
  }

  const versionRows = await sql`
    SELECT portal_id AS "portalId", version_number AS "versionNumber",
           published_at AS "publishedAt"
    FROM versions WHERE id = ${versionId}
  `;
  const version = versionRows[0];
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Access is checked before the draft check, not after: answering "not
  // published yet" for a version outside the caller's scope would let anyone
  // signed in distinguish a real draft from one that doesn't exist — the same
  // oracle this branch exists to close.
  //
  // 404 rather than 403: a version outside the caller's scope must look
  // exactly like one that does not exist.
  const access = await getVersionAccess(session.user.id, versionId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // A draft has not been sent to anyone, so there is nothing to have an opinion
  // about yet.
  if (!version.publishedAt) {
    return NextResponse.json(
      { error: 'This version has not been published yet' },
      { status: 409 }
    );
  }
  // A viewer can look but not weigh in — a verdict is a review action.
  if (!access.canComment) {
    return NextResponse.json(
      { error: 'Your role on this package is view-only' },
      { status: 403 }
    );
  }

  // Changing your mind overwrites your previous verdict rather than stacking.
  await sql`
    INSERT INTO verdicts (id, version_id, user_id, verdict, note)
    VALUES (${uuidv4()}, ${versionId}, ${session.user.id}, ${verdict}, ${note ?? null})
    ON CONFLICT (version_id, user_id)
    DO UPDATE SET verdict = EXCLUDED.verdict, note = EXCLUDED.note, created_at = NOW()
  `;

  // Tell the people who need to know. Changes requested is the one that moves
  // work, so it notifies; an approval is quieter.
  if (verdict === 'changes_requested') {
    const uploaders = await sql`
      SELECT DISTINCT user_id FROM participants
      WHERE portal_id = ${version.portalId} AND role = 'uploader'
        AND user_id <> ${session.user.id}
      UNION
      SELECT owner_id FROM projects pr
      JOIN portals po ON po.project_id = pr.id
      WHERE po.id = ${version.portalId} AND pr.owner_id <> ${session.user.id}
    `;
    const portalName = await sql`
      SELECT name FROM portals WHERE id = ${version.portalId}
    `;
    for (const u of uploaders) {
      await sql`
        INSERT INTO notifications (id, user_id, type, portal_id, actor_id, title, href)
        VALUES (
          ${uuidv4()}, ${u.user_id ?? u.owner_id}, 'changes_requested',
          ${version.portalId}, ${session.user.id},
          ${`${session.user.name ?? 'Someone'} requested changes on V${version.versionNumber} of ${portalName[0]?.name ?? 'a package'}`},
          ${`/portal/${version.portalId}`}
        )
      `;
    }
  }

  return NextResponse.json({ ok: true });
}
