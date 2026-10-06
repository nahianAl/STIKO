import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';

/** GET — the tray (3i). Grouped by package on the client. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await sql`
    SELECT n.id, n.type, n.title, n.excerpt, n.href, n.created_at AS "createdAt",
           n.read_at AS "readAt", n.portal_id AS "portalId",
           po.name AS "packageName",
           pr.id AS "projectId", pr.name AS "projectName",
           actor.id AS "actorId", actor.name AS "actorName"
    FROM notifications n
    LEFT JOIN portals po ON po.id = n.portal_id
    LEFT JOIN projects pr ON pr.id = po.project_id
    LEFT JOIN users actor ON actor.id = n.actor_id
    WHERE n.user_id = ${session.user.id}
    ORDER BY n.created_at DESC
    LIMIT 50
  `;

  return NextResponse.json(rows);
}

/** PATCH — mark one read, a package's mentions, or all of them. */
export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, all, portalId } = await request.json();

  if (all) {
    await sql`
      UPDATE notifications SET read_at = NOW()
      WHERE user_id = ${session.user.id} AND read_at IS NULL
    `;
    return NextResponse.json({ ok: true });
  }

  // Opening a package is reading its mentions. Without this the dashboard's
  // mention badge could only be cleared from the Activity rail's own row, so
  // someone who arrived by the package card or the email link kept a badge
  // for a mention they had already read. Mentions only: the other types on a
  // package are things to act on, not things opening it settles.
  if (typeof portalId === 'string' && portalId) {
    await sql`
      UPDATE notifications SET read_at = NOW()
      WHERE user_id = ${session.user.id}
        AND portal_id = ${portalId}
        AND type = 'mention'
        AND read_at IS NULL
    `;
    return NextResponse.json({ ok: true });
  }

  if (!id) {
    return NextResponse.json({ error: 'id, portalId or all required' }, { status: 400 });
  }

  // Scoped to the session user so one person cannot mark another's read.
  await sql`
    UPDATE notifications SET read_at = NOW()
    WHERE id = ${id} AND user_id = ${session.user.id}
  `;
  return NextResponse.json({ ok: true });
}
