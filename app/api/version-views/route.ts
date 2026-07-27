import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';

/**
 * Record that someone opened a version. This is what lets "Waiting on" (4b)
 * distinguish not-opened from viewed-no-comment, and what makes the personal
 * "NEW VERSION" pill accurate.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { versionId } = await request.json();
  if (!versionId) {
    return NextResponse.json({ error: 'versionId required' }, { status: 400 });
  }

  const rows = await sql`
    SELECT portal_id AS "portalId" FROM versions WHERE id = ${versionId}
  `;
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const access = await getPackageAccess(session.user.id, rows[0].portalId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // First open is the one that matters; re-opening does not reset the clock.
  await sql`
    INSERT INTO version_views (id, version_id, user_id)
    VALUES (${uuidv4()}, ${versionId}, ${session.user.id})
    ON CONFLICT (version_id, user_id) DO NOTHING
  `;

  return NextResponse.json({ ok: true });
}
