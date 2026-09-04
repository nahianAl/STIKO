import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';

/**
 * Change or revoke a person's role on one package (4a, 2h) — gap #10, roles
 * could not be changed or revoked after an invite went out.
 *
 * `userId` may be a user id (an accepted guest) or an email (a pending invite),
 * which is what the matrix keys its rows on.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { userId, portalId, role } = await request.json();

  if (!userId || !portalId) {
    return NextResponse.json(
      { error: 'userId and portalId are required' },
      { status: 400 }
    );
  }
  if (role !== null && !['viewer', 'commenter', 'uploader'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  // Only someone who can manage people on this package may do this.
  const access = await getPackageAccess(session.user.id, portalId);
  if (!access?.canManagePeople) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isEmail = String(userId).includes('@');

  // An uploader is never scoped, so promoting someone clears whatever
  // narrowing they carried. Leaving it would be invisible state that nothing
  // in the UI can show or clear.
  const normalizeScope = role === 'uploader';

  if (isEmail) {
    // A pending invitation — adjust or revoke the token rather than a
    // participant row that does not exist yet.
    if (role === null) {
      await sql`
        UPDATE invite_tokens SET revoked_at = NOW()
        WHERE portal_id = ${portalId} AND email = ${userId} AND used_at IS NULL
      `;
    } else if (normalizeScope) {
      await sql.transaction([
        sql`
          UPDATE invite_tokens SET role = ${role}, all_versions = TRUE
          WHERE portal_id = ${portalId} AND email = ${userId} AND used_at IS NULL
        `,
        sql`
          DELETE FROM invite_token_versions
          WHERE token_id IN (
            SELECT id FROM invite_tokens
            WHERE portal_id = ${portalId} AND email = ${userId} AND used_at IS NULL
          )
        `,
      ]);
    } else {
      await sql`
        UPDATE invite_tokens SET role = ${role}
        WHERE portal_id = ${portalId} AND email = ${userId} AND used_at IS NULL
      `;
    }
    return NextResponse.json({ ok: true });
  }

  if (role === null) {
    await sql`
      DELETE FROM participants
      WHERE portal_id = ${portalId} AND user_id = ${userId}
    `;
  } else if (normalizeScope) {
    await sql.transaction([
      sql`
        UPDATE participants SET role = ${role}, all_versions = TRUE
        WHERE portal_id = ${portalId} AND user_id = ${userId}
      `,
      sql`
        DELETE FROM participant_versions
        WHERE participant_id IN (
          SELECT id FROM participants
          WHERE portal_id = ${portalId} AND user_id = ${userId}
        )
      `,
    ]);
  } else {
    await sql`
      UPDATE participants SET role = ${role}
      WHERE portal_id = ${portalId} AND user_id = ${userId}
    `;
  }

  return NextResponse.json({ ok: true });
}
