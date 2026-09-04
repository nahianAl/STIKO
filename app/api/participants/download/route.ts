import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';

/**
 * Grant or withdraw download on one package, after the invitation went out.
 *
 * `userId` may be a user id (an accepted guest) or an email (a pending
 * invitation), which is what the people matrix keys its rows on — the same
 * split /api/participants/role handles. A pending invitation has no
 * participants row at all, so the grant is written to the token instead and is
 * already correct whenever they accept.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { userId, portalId, canDownload } = await request.json();

  if (!userId || !portalId) {
    return NextResponse.json(
      { error: 'userId and portalId are required' },
      { status: 400 }
    );
  }
  if (typeof canDownload !== 'boolean') {
    return NextResponse.json(
      { error: 'canDownload must be a boolean' },
      { status: 400 }
    );
  }

  const access = await getPackageAccess(session.user.id, portalId);
  if (!access?.canManagePeople) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isEmail = String(userId).includes('@');

  if (isEmail) {
    await sql`
      UPDATE invite_tokens SET can_download = ${canDownload}
      WHERE portal_id = ${portalId} AND email = ${userId}
        AND used_at IS NULL AND revoked_at IS NULL
    `;
  } else {
    await sql`
      UPDATE participants SET can_download = ${canDownload}
      WHERE portal_id = ${portalId} AND user_id = ${userId}
    `;
  }

  return NextResponse.json({ ok: true });
}
