/**
 * One hidden workspace per account (spec §4). It holds the firm's KYC answers
 * and is the PostHog group. A future teams feature adds members to it; its id
 * never changes, so analytics history survives.
 */
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { ANONYMOUS_CONTEXT, type WorkspaceContext } from '@/lib/analytics/events';

/** Idempotent; safe under concurrent calls thanks to the UNIQUE owner_user_id. */
export async function ensureWorkspace(userId: string): Promise<string> {
  const rows = await sql`
    INSERT INTO workspaces (id, owner_user_id) VALUES (${uuidv4()}, ${userId})
    ON CONFLICT (owner_user_id) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id
    RETURNING id
  `;
  return rows[0].id as string;
}

export async function workspaceContext(userId: string): Promise<WorkspaceContext> {
  const rows = await sql`
    SELECT w.id AS "workspaceId", w.segment_id AS "segmentId", w.track,
           u.analytics_consent AS "analyticsConsent"
    FROM users u LEFT JOIN workspaces w ON w.owner_user_id = u.id
    WHERE u.id = ${userId}
  `;
  const r = rows[0] as
    | { workspaceId: string | null; segmentId: string | null; track: string | null; analyticsConsent: string | null }
    | undefined;
  if (!r) return ANONYMOUS_CONTEXT;
  return {
    workspaceId: r.workspaceId ?? (await ensureWorkspace(userId)),
    segmentId: r.segmentId ?? 'unknown',
    track: r.track ?? 'unknown',
    analyticsConsent: r.analyticsConsent,
  };
}

/**
 * Activation (plan): an external reviewer opens a review link within 7 days of
 * signup. Returns true only the first time, so the caller re-sends the group.
 */
export async function markActivation(inviterUserId: string, openerUserId: string | null): Promise<boolean> {
  if (openerUserId === inviterUserId) return false;
  const rows = await sql`
    UPDATE workspaces SET activated_at = now()
    WHERE owner_user_id = ${inviterUserId}
      AND activated_at IS NULL
      AND created_at > now() - interval '7 days'
    RETURNING id
  `;
  return rows.length > 0;
}
