'use client';

import posthog from 'posthog-js';

/**
 * Client events raised before PostHog may send them: the visitor has not yet
 * answered the consent banner, the geo check is in flight, PostHog is starting,
 * or it has started but does not yet know who is signed in. Held in memory
 * only, never stored or sent; AnalyticsProvider releases them once identity is
 * settled (identify() of the current user, or reset() of a stale one), so they
 * are never filed under the previous person, and a declined or unanswered
 * banner sends nothing.
 */
const MAX_PENDING = 20;
const pending: { event: string; properties: Record<string, unknown>; at: Date }[] = [];
let released = false;

/**
 * Client capture. While PostHog may not send yet (consent, key, identity), the
 * event waits in memory and is sent if and when it may.
 */
export function captureClient(event: string, properties: Record<string, unknown> = {}): void {
  try {
    if (released && posthog.__loaded) posthog.capture(event, properties);
    else if (pending.length < MAX_PENDING) pending.push({ event, properties, at: new Date() });
  } catch {
    // analytics never breaks the page
  }
}

/**
 * Called once PostHog has started AND knows who is (or is not) signed in.
 * Sends what was held, with the time it really happened; later events go
 * straight out.
 */
export function releasePendingCaptures(): void {
  released = true;
  for (const { event, properties, at } of pending.splice(0)) {
    try {
      posthog.capture(event, properties, { timestamp: at });
    } catch {
      // analytics never breaks the page
    }
  }
}
