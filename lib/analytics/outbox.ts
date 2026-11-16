/**
 * The analytics outbox: every server event is written here first, then sent
 * to PostHog's /batch/ endpoint. A PostHog outage costs latency, not events.
 *
 * Claiming is one UPDATE … RETURNING, so two concurrent flushes never send the
 * same row within a minute; PostHog also dedupes on uuid.
 */
import { sql } from '@/lib/db';
import { toBatchPayload, type CaptureRow } from '@/lib/analytics/events';

const MAX_ATTEMPTS = 20;

export async function enqueue(rows: CaptureRow[]): Promise<void> {
  for (const r of rows) {
    await sql`
      INSERT INTO analytics_outbox (uuid, event, distinct_id, properties)
      VALUES (${r.uuid}, ${r.event}, ${r.distinctId}, ${JSON.stringify(r.properties)}::jsonb)
      ON CONFLICT (uuid) DO NOTHING
    `;
  }
}

export async function flushOutbox(limit = 100): Promise<{ sent: number; failed: number }> {
  const apiKey = process.env.POSTHOG_PROJECT_KEY;
  if (!apiKey) return { sent: 0, failed: 0 };
  const host = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com';

  const claimed = (await sql`
    UPDATE analytics_outbox
    SET attempts = attempts + 1, last_attempt_at = now()
    WHERE id IN (
      SELECT id FROM analytics_outbox
      WHERE sent_at IS NULL AND attempts < ${MAX_ATTEMPTS}
        AND (last_attempt_at IS NULL OR last_attempt_at < now() - interval '1 minute')
      ORDER BY id
      LIMIT ${limit}
    )
    RETURNING id, uuid, event, distinct_id AS "distinctId", properties,
              created_at AS "createdAt"
  `) as Array<CaptureRow & { id: number; createdAt: string | Date }>;
  if (claimed.length === 0) return { sent: 0, failed: 0 };

  const ids = claimed.map((r) => r.id);
  const payload = toBatchPayload(
    apiKey,
    claimed.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }))
  );

  try {
    const res = await fetch(`${host}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`PostHog /batch/ answered ${res.status}`);
    await sql`UPDATE analytics_outbox SET sent_at = now(), last_error = NULL WHERE id = ANY(${ids})`;
    return { sent: ids.length, failed: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`UPDATE analytics_outbox SET last_error = ${message.slice(0, 500)} WHERE id = ANY(${ids})`;
    console.error('[analytics] flush failed; rows kept for retry:', message);
    return { sent: 0, failed: ids.length };
  }
}

/** Sent rows are kept 30 days for debugging, then dropped by the daily cron. */
export async function pruneOutbox(): Promise<number> {
  const rows = await sql`
    DELETE FROM analytics_outbox WHERE sent_at < now() - interval '30 days' RETURNING id
  `;
  return rows.length;
}
