'use client';

import type { PostHog, PostHogConfig } from 'posthog-js';

/**
 * posthog-js is ~120 KB gzipped. It is loaded with a dynamic import only once
 * tracking is allowed and a key is set (AnalyticsProvider), so a visitor who
 * declines, a deploy with no key, and every page before consent never download
 * it. Nothing here may import it statically: a type import only.
 */
let instance: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;

/** Loads and starts PostHog once; later calls get the same instance. Null if it cannot load. */
export function loadPostHog(key: string, config: Partial<PostHogConfig>): Promise<PostHog | null> {
  if (!loading) {
    loading = import('posthog-js')
      .then(({ default: posthog }) => {
        posthog.init(key, config);
        instance = posthog;
        return posthog;
      })
      .catch(() => {
        // A failed chunk load may be retried by a later call.
        loading = null;
        return null;
      });
  }
  return loading;
}

/**
 * Client events raised before PostHog may send them: the visitor has not yet
 * answered the consent banner, the geo check is in flight, PostHog is still
 * loading, or it has started but does not yet know who is signed in. Held in
 * memory only, never stored or sent; AnalyticsProvider releases them once
 * identity is settled (identify() of the current user, or reset() of a stale
 * one), so they are never filed under the previous person, and a declined or
 * unanswered banner sends nothing.
 */
const MAX_PENDING = 20;
const pending: { event: string; properties: Record<string, unknown>; at: Date }[] = [];
let released = false;

/**
 * Client capture. While PostHog may not send yet (consent, key, loading,
 * identity), the event waits in memory and is sent if and when it may.
 */
export function captureClient(event: string, properties: Record<string, unknown> = {}): void {
  try {
    if (released && instance) instance.capture(event, properties);
    else if (pending.length < MAX_PENDING) pending.push({ event, properties, at: new Date() });
  } catch {
    // analytics never breaks the page
  }
}

/**
 * Called once PostHog has loaded AND knows who is (or is not) signed in.
 * Sends what was held, with the time it really happened; later events go
 * straight out.
 */
export function releasePendingCaptures(): void {
  if (!instance) return;
  released = true;
  for (const { event, properties, at } of pending.splice(0)) {
    try {
      instance.capture(event, properties, { timestamp: at });
    } catch {
      // analytics never breaks the page
    }
  }
}
