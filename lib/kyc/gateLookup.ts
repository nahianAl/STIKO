/**
 * One read for the middleware: has this person completed the business profile?
 * Neon's HTTP driver works in the edge runtime. Returns null on any failure so
 * a database hiccup lets people through instead of locking everyone out.
 *
 * Edge runtime: import nothing here but '@/lib/db'. lib/analytics/* and
 * lib/workspaces.ts pull in node:crypto and @vercel/functions, which do not
 * compile for the middleware.
 */
import { sql } from '@/lib/db';

export async function profileCompletedFor(
  subject: { workosUserId: string } | { userId: string }
): Promise<boolean | null> {
  try {
    const rows =
      'workosUserId' in subject
        ? await sql`SELECT profile_completed_at FROM users WHERE workos_user_id = ${subject.workosUserId} LIMIT 1`
        : await sql`SELECT profile_completed_at FROM users WHERE id = ${subject.userId} LIMIT 1`;
    if (!rows[0]) return null;
    return rows[0].profile_completed_at !== null;
  } catch (err) {
    console.error('[kyc] profile lookup failed; letting the request through', err);
    return null;
  }
}
