import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';
import { sendEmail, newVersionEmail } from '@/lib/email';
import { appBaseUrl } from '@/lib/appUrl';

/**
 * Publish a draft version.
 *
 * This is the atomic step from 2d — the version becomes visible to reviewers
 * only once, with every file already registered. A partial upload never
 * publishes, because the client only calls this after all files land.
 *
 * The changelog was required until 2026-08-14 and is now optional. What is
 * still enforced is that the version has files: a note is a courtesy, an empty
 * version is a bug reviewers have to chase.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { versionId, changelog, notify = true } = await request.json();

  // One representation of "no note" — NULL. Every display site already guards
  // on null, so an empty string would be a second, unguarded one.
  const note =
    typeof changelog === 'string' && changelog.trim() ? changelog.trim() : null;

  const versionRows = await sql`
    SELECT portal_id AS "portalId", version_number AS "versionNumber",
           published_at AS "publishedAt"
    FROM versions WHERE id = ${versionId}
  `;
  const version = versionRows[0];
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const access = await getPackageAccess(session.user.id, version.portalId);
  if (!access?.canUpload) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (version.publishedAt) {
    return NextResponse.json(
      { error: 'This version is already published' },
      { status: 409 }
    );
  }

  // Refuse to publish an empty version — that is exactly the half-version the
  // spec says must never reach reviewers.
  const fileCount = await sql`
    SELECT COUNT(*) AS n FROM files WHERE version_id = ${versionId}
  `;
  if (Number(fileCount[0].n) === 0) {
    return NextResponse.json(
      { error: 'This version has no files yet' },
      { status: 409 }
    );
  }

  await sql`
    UPDATE versions
    SET published_at = NOW(), changelog = ${note}
    WHERE id = ${versionId}
  `;

  const context = await sql`
    SELECT po.name AS "packageName" FROM portals po WHERE po.id = ${version.portalId}
  `;
  const packageName = context[0]?.packageName ?? 'a package';
  // Configured host only — never the request's. A Host-derived link in an
  // outbound email is a phishing link wearing our sender.
  const link = `${appBaseUrl()}/portal/${version.portalId}`;

  if (notify) {
    // Everyone on the package except the publisher, minus anyone who muted it.
    const recipients = await sql`
      SELECT u.id, u.email, u.name
      FROM participants p
      JOIN users u ON u.id = p.user_id
      WHERE p.portal_id = ${version.portalId}
        AND p.user_id <> ${session.user.id}
        -- A version published seconds ago cannot be in anyone's explicit
        -- scope, so only the unscoped can see it. Telling a scoped reviewer
        -- would leak by email exactly what the scope hides in the UI.
        AND p.all_versions = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM portal_mutes m
          WHERE m.portal_id = p.portal_id AND m.user_id = p.user_id
        )
    `;

    for (const r of recipients) {
      await sql`
        INSERT INTO notifications
          (id, user_id, type, portal_id, actor_id, title, excerpt, href)
        VALUES (
          ${uuidv4()}, ${r.id}, 'new_version', ${version.portalId},
          ${session.user.id},
          ${`Version ${version.versionNumber} published in ${packageName}`},
          ${note}, ${link}
        )
      `;

      // Respect the per-event email preference; a missing row means the
      // default, which for a new version is on.
      const pref = await sql`
        SELECT email FROM notification_prefs
        WHERE user_id = ${r.id} AND event = 'new_version'
      `;
      const wantsEmail = pref[0] ? Boolean(pref[0].email) : true;

      const paused = await sql`
        SELECT 1 FROM users
        WHERE id = ${r.id} AND email_paused_until > NOW()
      `;

      if (wantsEmail && paused.length === 0) {
        await sendEmail({
          to: r.email as string,
          ...newVersionEmail({
            publisherName: session.user.name ?? 'Someone',
            packageName,
            versionNumber: Number(version.versionNumber),
            changelog: note,
            link,
          }),
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
