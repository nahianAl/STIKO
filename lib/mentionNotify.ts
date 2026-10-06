import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { portalForFile } from '@/lib/access';
import { sendEmail, mentionEmail } from '@/lib/email';
import { appBaseUrlOrNull } from '@/lib/appUrl';
import { NOTIFICATION_EVENTS } from '@/lib/notificationEvents';
import { portalDeepLinkPath } from '@/lib/portalDeepLink';
import { mentionChannels, mentionExcerpt } from '@/lib/mentions';

/**
 * Tell people they were mentioned.
 *
 * Called after the comment is already saved, so it never throws: a failure to
 * notify must not turn a saved comment into an error response. Each recipient
 * is handled on their own for the same reason — one bad address must not cost
 * everyone after it their notification.
 *
 * Per recipient:
 *   - a muted package means nothing at all (the mute copy promises "even for
 *     @mentions");
 *   - the in-app row and the email each follow their `mention` preference,
 *     where a missing row means the default in NOTIFICATION_EVENTS;
 *   - a paused inbox skips the email only.
 */
export async function notifyMentions(opts: {
  actorId: string;
  actorName: string;
  recipientIds: string[];
  fileId: string;
  commentId: string;
  content: string;
}): Promise<void> {
  const recipientIds = opts.recipientIds.filter((id) => id !== opts.actorId);
  if (recipientIds.length === 0) return;

  try {
    const location = await portalForFile(opts.fileId);
    if (!location) return;

    const context = await sql`
      SELECT f.filename AS "fileName", po.name AS "packageName"
      FROM files f
      JOIN versions v ON v.id = f.version_id
      JOIN portals po ON po.id = v.portal_id
      WHERE f.id = ${opts.fileId}
    `;
    const fileName = (context[0]?.fileName as string | undefined) ?? 'a file';
    const packageName = (context[0]?.packageName as string | undefined) ?? 'a package';

    const path = portalDeepLinkPath(location.portalId, {
      versionId: location.versionId,
      fileId: opts.fileId,
      commentId: opts.commentId,
    });
    const excerpt = mentionExcerpt(opts.content);
    const title = `${opts.actorName} mentioned you on ${fileName}`;

    const defaults = NOTIFICATION_EVENTS.find((e) => e.key === 'mention');
    const defaultInApp = defaults?.inApp ?? true;
    const defaultEmail = defaults?.email ?? true;
    // Configured host only — never the request's. See lib/appUrl.ts.
    const base = appBaseUrlOrNull();
    if (!base) {
      // Said once, not per recipient. Without it mention email would stop
      // silently the day the base URL setting is renamed or removed.
      console.error('[mentions] no base URL configured; mention emails are skipped');
    }

    for (const userId of recipientIds) {
      let row;
      try {
        const rows = await sql`
          SELECT u.email,
                 (u.email_paused_until IS NOT NULL AND u.email_paused_until > NOW()) AS paused,
                 EXISTS (
                   SELECT 1 FROM portal_mutes m
                   WHERE m.portal_id = ${location.portalId} AND m.user_id = u.id
                 ) AS muted,
                 np.in_app AS "inApp",
                 np.email AS "wantsEmail"
          FROM users u
          LEFT JOIN notification_prefs np
            ON np.user_id = u.id AND np.event = 'mention'
          WHERE u.id = ${userId}
        `;
        row = rows[0];
      } catch (err) {
        console.error('[mentions] could not look up', userId, err);
        continue;
      }
      if (!row) continue;

      const channels = mentionChannels(
        {
          muted: Boolean(row.muted),
          paused: Boolean(row.paused),
          inApp: row.inApp == null ? null : Boolean(row.inApp),
          email: row.wantsEmail == null ? null : Boolean(row.wantsEmail),
        },
        { inApp: defaultInApp, email: defaultEmail }
      );

      if (channels.inApp) {
        try {
          await sql`
            INSERT INTO notifications
              (id, user_id, type, portal_id, actor_id, title, excerpt, href)
            VALUES (
              ${uuidv4()}, ${userId}, 'mention', ${location.portalId},
              ${opts.actorId}, ${title}, ${excerpt}, ${path}
            )
          `;
        } catch (err) {
          console.error('[mentions] could not record notification for', userId, err);
        }
      }

      if (channels.email && base) {
        try {
          await sendEmail({
            to: row.email as string,
            ...mentionEmail({
              actorName: opts.actorName,
              fileName,
              packageName,
              excerpt,
              link: `${base}${path}`,
            }),
          });
        } catch (err) {
          console.error('[mentions] could not email', userId, err);
        }
      }
    }
  } catch (err) {
    console.error('[mentions] notify failed', err);
  }
}
