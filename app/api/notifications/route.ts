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
           actor.id AS "actorId", actor.name AS "actorName"
    FROM notifications n
    LEFT JOIN portals po ON po.id = n.portal_id
    LEFT JOIN users actor ON actor.id = n.actor_id
    WHERE n.user_id = ${session.user.id}
    ORDER BY n.created_at DESC
    LIMIT 50
  `;

  return NextResponse.json(rows);
}

/** PATCH — mark one read, or all of them. */
export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, all } = await request.json();

  if (all) {
    await sql`
      UPDATE notifications SET read_at = NOW()
      WHERE user_id = ${session.user.id} AND read_at IS NULL
    `;
    return NextResponse.json({ ok: true });
  }

  if (!id) {
    return NextResponse.json({ error: 'id or all required' }, { status: 400 });
  }

  // Scoped to the session user so one person cannot mark another's read.
  await sql`
    UPDATE notifications SET read_at = NOW()
    WHERE id = ${id} AND user_id = ${session.user.id}
  `;
  return NextResponse.json({ ok: true });
}
