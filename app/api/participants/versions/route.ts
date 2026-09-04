import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';

/**
 * Widen or narrow which versions one person may see, after the invitation.
 *
 * `userId` may be a user id (an accepted guest) or an email (a pending
 * invitation), the same split /api/participants/role and
 * /api/participants/download handle — a pending invitation has no participants
 * row, so its scope lives on the token instead.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { userId, portalId, allVersions, versionIds } = await request.json();

  if (!userId || !portalId) {
    return NextResponse.json(
      { error: 'userId and portalId are required' },
      { status: 400 }
    );
  }
  if (typeof allVersions !== 'boolean') {
    return NextResponse.json(
      { error: 'allVersions must be a boolean' },
      { status: 400 }
    );
  }
  const ids: string[] = Array.isArray(versionIds)
    ? versionIds.filter((v) => typeof v === 'string')
    : [];

  const access = await getPackageAccess(session.user.id, portalId);
  if (!access?.canManagePeople) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isEmail = String(userId).includes('@');

  if (isEmail) {
    const tokens = await sql`
      UPDATE invite_tokens SET all_versions = ${allVersions}
      WHERE portal_id = ${portalId} AND email = ${userId}
        AND used_at IS NULL AND revoked_at IS NULL
      RETURNING id
    `;
    for (const t of tokens) {
      await sql`DELETE FROM invite_token_versions WHERE token_id = ${t.id}`;
      if (!allVersions) {
        for (const vId of ids) {
          await sql`
            INSERT INTO invite_token_versions (id, token_id, version_id)
            SELECT ${uuidv4()}, ${t.id}, ${vId}
            WHERE EXISTS (
              SELECT 1 FROM versions WHERE id = ${vId} AND portal_id = ${portalId}
            )
            ON CONFLICT (token_id, version_id) DO NOTHING
          `;
        }
      }
    }
    return NextResponse.json({ ok: true, updated: tokens.length });
  }

  const rows = await sql`
    UPDATE participants SET all_versions = ${allVersions}
    WHERE portal_id = ${portalId} AND user_id = ${userId}
    RETURNING id
  `;
  if (!rows[0]) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await sql`DELETE FROM participant_versions WHERE participant_id = ${rows[0].id}`;
  if (!allVersions) {
    for (const vId of ids) {
      // Checked against the package, so a caller cannot grant sight of a
      // version belonging to somewhere else entirely.
      await sql`
        INSERT INTO participant_versions (id, participant_id, version_id)
        SELECT ${uuidv4()}, ${rows[0].id}, ${vId}
        WHERE EXISTS (
          SELECT 1 FROM versions WHERE id = ${vId} AND portal_id = ${portalId}
        )
        ON CONFLICT (participant_id, version_id) DO NOTHING
      `;
    }
  }

  return NextResponse.json({ ok: true });
}
