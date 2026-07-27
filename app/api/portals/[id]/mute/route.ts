import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';

/** Mute a single package (3l) — no emails or badges, even for @mentions. */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await getPackageAccess(session.user.id, params.id);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { muted } = await request.json();

  if (muted) {
    await sql`
      INSERT INTO portal_mutes (id, portal_id, user_id)
      VALUES (${uuidv4()}, ${params.id}, ${session.user.id})
      ON CONFLICT (portal_id, user_id) DO NOTHING
    `;
  } else {
    await sql`
      DELETE FROM portal_mutes
      WHERE portal_id = ${params.id} AND user_id = ${session.user.id}
    `;
  }

  return NextResponse.json({ ok: true });
}
