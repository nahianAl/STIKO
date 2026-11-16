'use client';

import posthog from 'posthog-js';

/**
 * Client events raised before PostHog has started (the visitor has not yet
 * answered the consent banner, or the geo check is still in flight). Held in
 * memory only, never stored or sent; AnalyticsProvider releases them once
 * PostHog starts, so a declined or unanswered banner sends nothing.
 */
const MAX_PENDING = 20;
const pending: { event: string; properties: Record<string, unknown>; at: Date }[] = [];

/**
 * Client capture. A no-op while PostHog has not started (consent, key); an event
 * raised in that window waits in memory and is sent if PostHog does start.
 */
export function captureClient(event: string, properties: Record<string, unknown> = {}): void {
  try {
    if (posthog.__loaded) posthog.capture(event, properties);
    else if (pending.length < MAX_PENDING) pending.push({ event, properties, at: new Date() });
  } catch {
    // analytics never breaks the page
  }
}

/** Sends what was raised before PostHog started, with the time it really happened. */
export function flushPendingCaptures(): void {
  for (const { event, properties, at } of pending.splice(0)) {
    try {
      posthog.capture(event, properties, { timestamp: at });
    } catch {
      // analytics never breaks the page
    }
  }
}
