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
           t.multi_use AS "multiUse", t.all_versions AS "allVersions",
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

  // The latest published version, and the files inside it — except for a
  // scoped invitation, where showing the package's actual latest would leak
  // exactly what the scope is meant to hide. In that case, the newest
  // published version among the ones this token grants stands in for it.
  const versionRows =
    invite.allVersions === false
      ? await sql`
          SELECT v.id, v.version_number AS "versionNumber", v.changelog,
                 v.published_at AS "publishedAt"
          FROM versions v
          JOIN invite_token_versions itv ON itv.version_id = v.id
          WHERE itv.token_id = ${invite.id} AND v.published_at IS NOT NULL
          ORDER BY v.version_number DESC
          LIMIT 1
        `
      : await sql`
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

  // DO UPDATE only for an addressed invite: a share link is walked by many
  // people and always carries can_download = false, so without the WHERE
  // guard, anyone re-opening a link they already accepted would have an
  // existing grant silently revoked. role is deliberately not touched here —
  // that is /api/participants/role's job, and re-sending an invitation should
  // not quietly demote someone whose role was raised afterwards.
  //
  // xmax = 0 is the standard way to tell an INSERT from a DO UPDATE in the
  // same RETURNING: a freshly inserted row's xmax is still 0, while a row
  // touched by the UPDATE arm carries the current transaction's xmax. Without
  // this, joined.length > 0 would also be true for a re-accepted addressed
  // invite that only changed the grant, and the notification below would fire
  // "accepted your invitation" a second time for someone who already had.
  // role is deliberately not touched by this UPDATE (see the comment above),
  // which means an existing uploader accepting a fresh commenter/viewer
  // invitation must not pick up that invitation's scope either — an uploader
  // with all_versions = false and scope rows is a state the spec says must
  // never exist. So all_versions only ever takes the invitation's value when
  // the row's role (after the conflict resolves) is one that can carry scope;
  // otherwise it is forced back to TRUE.
  //
  // The INSERT arm needs the same rule applied to the invitation's own role:
  // a role can be reassigned on a still-pending invite (POST
  // /api/participants/role updates invite_tokens.role without touching
  // all_versions), so a token can reach here as role='uploader' with
  // all_versions still false from when it was issued scoped. Without this, a
  // brand-new participant row would be created in that state — the same
  // uploader-with-a-stale-scope the DO UPDATE arm above is guarding against.
  const inviteScopable = invite.role === 'commenter' || invite.role === 'viewer';
  const joined = await sql`
    INSERT INTO participants (id, portal_id, user_id, role, can_download, all_versions)
    VALUES (${uuidv4()}, ${invite.portal_id}, ${session.user.id}, ${invite.role},
            ${invite.can_download === true},
            ${inviteScopable ? invite.all_versions !== false : true})
    ON CONFLICT (portal_id, user_id) DO UPDATE
      SET can_download = EXCLUDED.can_download,
          all_versions = CASE
            WHEN participants.role IN ('commenter', 'viewer')
            THEN EXCLUDED.all_versions
            ELSE TRUE
          END
      WHERE ${!invite.multi_use}
    RETURNING id, role, (xmax = 0) AS "isNew"
  `;

  const participantId = joined[0]?.id;
  const resultingRole = joined[0]?.role as string | undefined;
  const scopable = resultingRole === 'commenter' || resultingRole === 'viewer';
  if (participantId && scopable && invite.all_versions === false) {
    // Replace rather than add: the invitation the owner just sent is the
    // intended scope, not an increment on whatever was there before. Scope
    // ids are minted with uuidv4() like everywhere else in the tree — the
    // set-based SELECT-INSERT this replaced could not take a single
    // pre-generated id, so the versions are fetched first and inserted one at
    // a time instead.
    const scopedVersions = await sql`
      SELECT version_id AS "versionId"
      FROM invite_token_versions WHERE token_id = ${invite.id}
    `;
    // Delete and insert run in one transaction: lib/db.ts's neon() client has
    // no ambient transaction, so without this, an insert failing after the
    // delete committed would leave the person with all_versions = false and no
    // scope rows — seeing nothing at all until someone replays the same
    // change. Same pattern as app/api/projects/[id]/route.ts.
    await sql.transaction([
      sql`DELETE FROM participant_versions WHERE participant_id = ${participantId}`,
      ...scopedVersions.map(
        (v) => sql`
          INSERT INTO participant_versions (id, participant_id, version_id)
          VALUES (${uuidv4()}, ${participantId}, ${v.versionId})
          ON CONFLICT (participant_id, version_id) DO NOTHING
        `
      ),
    ]);
  }

  // A share link is not consumed by the person who walks through it — stamping
  // used_at would retire the link for everyone behind them, since every
  // "still pending" query filters on it. It still expires and can still be
  // revoked; those are the ways it ends.
  if (!invite.multi_use) {
    await sql`UPDATE invite_tokens SET used_at = NOW() WHERE token = ${params.token}`;
  }

  // Tell the inviter it landed — but only for someone who actually joined.
  // Re-opening a share link you are already on must not ping them again, and
  // nor should re-accepting an addressed invite that only updated an existing
  // grant: they already got this notification the first time.
  if (joined[0]?.isNew && invite.invited_by && invite.invited_by !== session.user.id) {
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
  //
  // Scoped the same way the GET preview above is: a scoped invitee must not be
  // redirected into a version outside their scope, so the candidate files come
  // from the versions this token actually grants rather than the package's
  // true latest.
  const firstFile =
    invite.all_versions === false
      ? await sql`
          SELECT f.id
          FROM files f
          JOIN versions v ON v.id = f.version_id
          JOIN invite_token_versions itv ON itv.version_id = v.id
          WHERE itv.token_id = ${invite.id} AND v.published_at IS NOT NULL
          ORDER BY v.version_number DESC, f.filename ASC
          LIMIT 1
        `
      : await sql`
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
