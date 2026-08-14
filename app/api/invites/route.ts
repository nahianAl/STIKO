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
    SELECT token, email, role, multi_use AS "multiUse",
           created_at AS "createdAt", expires_at AS "expiresAt"
    FROM invite_tokens
    WHERE portal_id = ${portalId}
      AND used_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > NOW()
    ORDER BY created_at DESC
  `;

  return NextResponse.json(rows);
}

/**
 * DELETE — revoke one invitation by its token.
 *
 * Roles and revocation are otherwise keyed on the invitee's email
 * (`/api/participants/role`, which the people matrix uses). A share link has no
 * email, so it needs the token as its handle. Revoking is what ends a share
 * link early; otherwise it dies with its 14-day expiry.
 */
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { portalId, token } = await request.json();
  if (!portalId || !token) {
    return NextResponse.json(
      { error: 'portalId and token are required' },
      { status: 400 }
    );
  }

  const access = await getPackageAccess(session.user.id, portalId);
  if (!access?.canManagePeople) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Scoped to the package the caller was authorised against, so a token from
  // somewhere else cannot be revoked by borrowing this package's permission.
  const revoked = await sql`
    UPDATE invite_tokens SET revoked_at = NOW()
    WHERE token = ${token} AND portal_id = ${portalId} AND revoked_at IS NULL
    RETURNING id
  `;

  if (revoked.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
