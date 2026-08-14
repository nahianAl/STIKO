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
           t.multi_use AS "multiUse",
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
  // A consumed invite stops describing the package. Closing only the POST would
  // leave the preview open: this route is public (it has to be — being invited
  // happens before you have an account), and it hands back the package and
  // project names, the inviter's name AND email, the changelog, every filename
  // in the latest version, and the display name of everyone already on it. A
  // forwarded or leaked link would keep serving all of that for the rest of the
  // 14 days, and by then the token is in neither the pending list nor the
  // email-keyed revoke, so there is nothing left to switch off.
  //
  // Same exemption as the POST, for the same reason: the person who already
  // accepted may click their own link again, and they can see all of this
  // inside the package anyway. A share link is exempt by design.
  if (invite.usedAt && !invite.multiUse) {
    const session = await auth();
    const already = session?.user?.id
      ? await sql`
          SELECT 1 FROM participants
          WHERE portal_id = ${invite.portalId} AND user_id = ${session.user.id}
        `
      : [];
    if (already.length === 0) {
      return NextResponse.json({ error: 'used' }, { status: 410 });
    }
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
    // Null for a share link — the page then asks the visitor for their own
    // address instead of showing a fixed one they cannot change.
    email: invite.email,
    multiUse: Boolean(invite.multiUse),
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

  // Single use has to be enforced HERE, not just recorded. used_at was written
  // on acceptance but never read as a gate, so an addressed invite could be
  // forwarded and redeemed by anyone — and once used it vanished from the
  // pending list and from the email-keyed revoke, leaving a live link with no
  // handle to kill it. A multi_use token is a share link and is exempt by
  // design; it ends by expiring or being revoked.
  //
  // The person who already accepted is let through rather than shown an error:
  // they are a participant, and the page they are standing on has no other way
  // forward.
  if (invite.used_at && !invite.multi_use) {
    const already = await sql`
      SELECT 1 FROM participants
      WHERE portal_id = ${invite.portal_id} AND user_id = ${session.user.id}
    `;
    if (already.length === 0) {
      return NextResponse.json({ error: 'used' }, { status: 410 });
    }
  }

  const joined = await sql`
    INSERT INTO participants (id, portal_id, user_id, role)
    VALUES (${uuidv4()}, ${invite.portal_id}, ${session.user.id}, ${invite.role})
    ON CONFLICT (portal_id, user_id) DO NOTHING
    RETURNING id
  `;

  // A share link is not consumed by the person who walks through it — stamping
  // used_at would retire the link for everyone behind them, since every
  // "still pending" query filters on it. It still expires and can still be
  // revoked; those are the ways it ends.
  if (!invite.multi_use) {
    await sql`UPDATE invite_tokens SET used_at = NOW() WHERE token = ${params.token}`;
  }

  // Tell the inviter it landed — but only for someone who actually joined.
  // Re-opening a share link you are already on must not ping them again.
  if (joined.length > 0 && invite.invited_by && invite.invited_by !== session.user.id) {
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
