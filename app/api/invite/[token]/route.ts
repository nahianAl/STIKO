import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';

/**
 * GET — validate a token and return everything screen 2a needs to show the
 * invitee what is waiting for them: who invited them, the package, the current
 * version and its files, the "what changed" note, and who else is reviewing.
 *
 * Distinguishes expired from revoked so 3n can adjust its copy.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string } }
) {
  const rows = await sql`
    SELECT t.id, t.token, t.portal_id AS "portalId", t.role, t.email,
           t.expires_at AS "expiresAt", t.used_at AS "usedAt",
           t.revoked_at AS "revokedAt",
           po.name AS "packageName", pr.name AS "projectName",
           inviter.name AS "inviterName", inviter.email AS "inviterEmail",
           inviter.id AS "inviterId"
    FROM invite_tokens t
    JOIN portals po ON po.id = t.portal_id
    JOIN projects pr ON pr.id = po.project_id
    LEFT JOIN users inviter ON inviter.id = t.invited_by
    WHERE t.token = ${params.token}
  `;

  const invite = rows[0];
  if (!invite) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (invite.revokedAt) {
    return NextResponse.json({ error: 'revoked' }, { status: 410 });
  }
  if (new Date(invite.expiresAt as string) < new Date()) {
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }

  // The latest published version, and the files inside it.
  const versionRows = await sql`
    SELECT id, version_number AS "versionNumber", changelog,
           published_at AS "publishedAt"
    FROM versions
    WHERE portal_id = ${invite.portalId} AND published_at IS NOT NULL
    ORDER BY version_number DESC
    LIMIT 1
  `;
  const version = versionRows[0] ?? null;

  const files = version
    ? await sql`
        SELECT id, filename FROM files
        WHERE version_id = ${version.id}
        ORDER BY filename ASC
      `
    : [];

  // Who else is already on this package. Only a count and names — a pending
  // invitee has no business seeing the full roster before they accept.
  const others = await sql`
    SELECT u.id, u.name
    FROM participants p
    JOIN users u ON u.id = p.user_id
    WHERE p.portal_id = ${invite.portalId}
  `;

  return NextResponse.json({
    token: invite.token,
    portalId: invite.portalId,
    role: invite.role,
    email: invite.email,
    packageName: invite.packageName,
    projectName: invite.projectName,
    inviterName: invite.inviterName ?? 'Someone',
    inviterEmail: invite.inviterEmail,
    inviterId: invite.inviterId ?? 'unknown',
    alreadyAccepted: Boolean(invite.usedAt),
    version: version
      ? {
          versionNumber: version.versionNumber,
          changelog: version.changelog,
          publishedAt: version.publishedAt,
        }
      : null,
    files: files.map((f) => ({ id: f.id, filename: f.filename })),
    others: others.map((o) => ({ id: o.id, name: o.name ?? 'Someone' })),
  });
}

/** POST — consume the token and add the signed-in user to the package. */
export async function POST(
  _request: NextRequest,
  { params }: { params: { token: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await sql`
    SELECT * FROM invite_tokens WHERE token = ${params.token}
  `;
  const invite = rows[0];
  if (!invite) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (invite.revoked_at) {
    return NextResponse.json({ error: 'revoked' }, { status: 410 });
  }
  if (new Date(invite.expires_at as string) < new Date()) {
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }

  await sql`
    INSERT INTO participants (id, portal_id, user_id, role)
    VALUES (${uuidv4()}, ${invite.portal_id}, ${session.user.id}, ${invite.role})
    ON CONFLICT (portal_id, user_id) DO NOTHING
  `;

  await sql`UPDATE invite_tokens SET used_at = NOW() WHERE token = ${params.token}`;

  // Tell the inviter it landed.
  if (invite.invited_by && invite.invited_by !== session.user.id) {
    const portalRows = await sql`
      SELECT name FROM portals WHERE id = ${invite.portal_id}
    `;
    await sql`
      INSERT INTO notifications (id, user_id, type, portal_id, actor_id, title, href)
      VALUES (
        ${uuidv4()}, ${invite.invited_by}, 'invite_accepted', ${invite.portal_id},
        ${session.user.id},
        ${`${session.user.name ?? session.user.email} accepted your invitation to ${portalRows[0]?.name ?? 'a package'}`},
        ${`/portal/${invite.portal_id}`}
      )
    `;
  }

  // 04: land on the package's first file, never on the dashboard. Every role
  // goes to the same place — the old uploader-to-/submit split is gone now that
  // submitting is a drawer over the package (2e).
  const firstFile = await sql`
    SELECT f.id
    FROM files f
    JOIN versions v ON v.id = f.version_id
    WHERE v.portal_id = ${invite.portal_id} AND v.published_at IS NOT NULL
    ORDER BY v.version_number DESC, f.filename ASC
    LIMIT 1
  `;

  const redirectPath = firstFile[0]
    ? `/portal/${invite.portal_id}?file=${firstFile[0].id}`
    : `/portal/${invite.portal_id}`;

  return NextResponse.json({ redirectPath });
}
