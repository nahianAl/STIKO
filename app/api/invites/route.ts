import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';

/**
 * Pending invitations for a package (2h) — the list with resend and revoke.
 * Expiry is visible here before it happens, so nobody discovers it by having a
 * link fail.
 */
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
  if (!access?.canManagePeople) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = await sql`
    SELECT email, role, created_at AS "createdAt", expires_at AS "expiresAt"
    FROM invite_tokens
    WHERE portal_id = ${portalId}
      AND used_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > NOW()
    ORDER BY created_at DESC
  `;

  return NextResponse.json(rows);
}
