/**
 * The only analytics API route handlers call. Every function here swallows its
 * own errors: analytics must never fail, block or slow a user action.
 *
 * track(), identifyWorkspace() and trackFileEvent() are fire-and-forget: each
 * starts its work (workspace lookup, outbox INSERT, flush) in the background,
 * handed to waitUntil so Vercel keeps the invocation alive after the response,
 * and returns at once. They stay `Promise<void>` so `await track(...)` call
 * sites compile unchanged, but the await no longer waits for any database
 * round trip.
 *
 * trackNow() and identifyWorkspaceNow() are the same work as awaitable
 * functions, flush included. A route that already runs its analytics inside ONE
 * runInBackground job (several lookups feeding an event) awaits these instead of
 * the wrappers, so that one waitUntil covers everything: a wrapper called from
 * inside a background job would register a second, nested waitUntil after the
 * response is out, which the platform need not honour.
 *
 * Ordering: because the work is not awaited, a caller whose event depends on a
 * database write (a consent flag, a row the event reads) must complete that
 * write BEFORE calling track(). All current callers already do.
 */
import { randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { sql } from '@/lib/db';
import { ANONYMOUS_CONTEXT, buildCapture, buildGroupIdentify, extensionOf } from '@/lib/analytics/events';
import { enqueue, flushOutbox } from '@/lib/analytics/outbox';
import { workspaceContext } from '@/lib/workspaces';

export function serverAnalyticsEnabled(): boolean {
  return Boolean(process.env.POSTHOG_PROJECT_KEY);
}

/** Sends what is waiting. Awaited by the caller's background job; never throws. */
async function flushQuietly(): Promise<void> {
  try {
    await flushOutbox();
  } catch (err) {
    console.error('[analytics] flush threw', err);
  }
}

/**
 * Starts `work` without making the caller wait: waitUntil keeps the invocation
 * alive after the response; outside a request context (tests, scripts) the
 * promise simply runs. The *Now functions already swallow their own errors, so
 * the catch is a backstop that keeps a stray rejection from ever surfacing.
 *
 * Exported for a route whose analytics needs more than one call (several
 * lookups feeding an event): it wraps them in one async function and hands that
 * to this. Anything read from the request (cookies, session) must be read
 * BEFORE calling it, because the request is not usable once the response is out.
 */
export function runInBackground(work: Promise<void>): void {
  const p = work.catch((err) => console.error('[analytics] background task failed', err));
  try {
    waitUntil(p);
  } catch {
    // Outside a Vercel request context the promise still runs.
  }
}

type TrackOptions = {
  userId?: string | null;
  anonymousId?: string | null;
  properties?: Record<string, unknown>;
  set?: Record<string, unknown>;
  setOnce?: Record<string, unknown>;
};

/** Fire-and-forget: returns immediately; the outbox INSERT happens in the background. */
export async function track(event: string, opts: TrackOptions): Promise<void> {
  runInBackground(trackNow(event, opts));
}

/**
 * track() as an awaitable: resolves after the outbox INSERT and the flush.
 * Swallows its own errors. For code already inside runInBackground.
 */
export async function trackNow(event: string, opts: TrackOptions): Promise<void> {
  try {
    if (!serverAnalyticsEnabled()) return;
    const userId = opts.userId ?? null;
    const distinctId = userId ?? opts.anonymousId ?? null;
    if (!distinctId) return;
    const context = userId ? await workspaceContext(userId) : ANONYMOUS_CONTEXT;
    const row = buildCapture(
      { event, distinctId, userId, context, properties: opts.properties, set: opts.set, setOnce: opts.setOnce },
      randomUUID()
    );
    if (!row) return;
    await enqueue([row]);
    await flushQuietly();
  } catch (err) {
    console.error(`[analytics] track(${event}) failed`, err);
  }
}

/** Sends the workspace's firm properties as a PostHog group. Fire-and-forget. */
export async function identifyWorkspace(userId: string): Promise<void> {
  runInBackground(identifyWorkspaceNow(userId));
}

/** identifyWorkspace() as an awaitable, flush included. Swallows its own errors. For code already inside runInBackground. */
export async function identifyWorkspaceNow(userId: string): Promise<void> {
  try {
    if (!serverAnalyticsEnabled()) return;
    const context = await workspaceContext(userId);
    if (!context.workspaceId || context.analyticsConsent === 'denied' || context.analyticsConsent === 'pending') return;
    const rows = await sql`
      SELECT cp.industry, cp.parent_segment, cp.primary_market, cp.client_model, cp.company_size,
             cp.size_min, cp.size_max, cp.review_team_size, cp.rt_min, cp.rt_max, cp.icp_size_fit,
             cp.company_domain, cp.website_source, cp.onboarding_version,
             w.country, w.region, w.is_business_email, w.activated_at, w.utm_first,
             ARRAY(SELECT market_code FROM company_profile_markets m WHERE m.profile_id = cp.id ORDER BY pick_order) AS markets,
             ARRAY(SELECT reviewer_code FROM company_profile_reviewers r WHERE r.profile_id = cp.id ORDER BY reviewer_code) AS reviewers,
             ARRAY(SELECT file_type_code FROM company_profile_file_types f WHERE f.profile_id = cp.id ORDER BY file_type_code) AS file_types
      FROM workspaces w LEFT JOIN company_profiles cp ON cp.id = w.current_profile_id
      WHERE w.id = ${context.workspaceId}
    `;
    const w = rows[0] as Record<string, unknown> | undefined;
    if (!w) return;
    const utm = (w.utm_first ?? {}) as Record<string, string>;
    // Codes only; "Other" free text never leaves Postgres.
    const groupSet: Record<string, unknown> = {
      industry: w.industry, parent_segment: w.parent_segment, primary_market: w.primary_market,
      markets: w.markets, client_model: w.client_model, company_size: w.company_size,
      size_min: w.size_min, size_max: w.size_max, review_team_size: w.review_team_size,
      rt_min: w.rt_min, rt_max: w.rt_max, reviewers: w.reviewers, file_types: w.file_types,
      icp_size_fit: w.icp_size_fit, company_domain: w.company_domain, website_source: w.website_source,
      onboarding_version: w.onboarding_version, track: context.track,
      country: w.country, region: w.region,
      is_business_email: w.is_business_email,
      is_free_email: w.is_business_email === null ? null : !w.is_business_email,
      activated_at: w.activated_at ? new Date(w.activated_at as string).toISOString() : null,
      first_utm_source: utm.utm_source ?? null, first_utm_medium: utm.utm_medium ?? null,
      first_utm_campaign: utm.utm_campaign ?? null,
    };
    await enqueue([buildGroupIdentify(context.workspaceId, userId, groupSet, randomUUID())]);
    await flushQuietly();
  } catch (err) {
    console.error('[analytics] identifyWorkspace failed', err);
  }
}

/** For routes with no session (conversion callbacks): the uploader is the actor. Fire-and-forget. */
export async function trackFileEvent(
  event: string,
  fileId: string,
  properties: Record<string, unknown> = {}
): Promise<void> {
  runInBackground(trackFileEventNow(event, fileId, properties));
}

async function trackFileEventNow(
  event: string,
  fileId: string,
  properties: Record<string, unknown>
): Promise<void> {
  try {
    if (!serverAnalyticsEnabled()) return;
    const rows = await sql`SELECT uploaded_by AS "userId", filename FROM files WHERE id = ${fileId}`;
    const r = rows[0] as { userId: string | null; filename: string } | undefined;
    if (!r?.userId) return;
    await trackNow(event, {
      userId: r.userId,
      properties: { file_id: fileId, extension: extensionOf(r.filename), ...properties },
    });
  } catch (err) {
    console.error(`[analytics] trackFileEvent(${event}) failed`, err);
  }
}

/** The distinct_id out of a parsed posthog-js cookie, or null. */
function distinctIdOf(json: string): string | null {
  const parsed = JSON.parse(json) as { distinct_id?: unknown } | null;
  const id = parsed?.distinct_id;
  return typeof id === 'string' && id ? id : null;
}

/**
 * posthog-js stores {"distinct_id": …} in the ph_<key>_posthog cookie. Reading
 * it lets an anonymous server event join the visitor's browser history.
 * Absent (declined, blocked, first request) → no anonymous event.
 *
 * Next.js's request.cookies.get() hands back the value ALREADY percent-decoded,
 * while a raw Cookie header is still encoded. Try the value as-is first and
 * decode only on failure, so both shapes work (and a distinct_id containing a
 * literal '%' is never decoded twice). Never throws.
 */
export function posthogAnonymousId(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  try {
    return distinctIdOf(cookieValue);
  } catch {
    // Not raw JSON: it is probably still percent-encoded.
  }
  try {
    return distinctIdOf(decodeURIComponent(cookieValue));
  } catch {
    return null;
  }
}

export function posthogCookieName(): string | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  return key ? `ph_${key}_posthog` : null;
}
