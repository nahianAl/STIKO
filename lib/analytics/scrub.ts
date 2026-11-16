/**
 * An invite token is a credential and must never reach PostHog (spec §5.2).
 * posthog-js puts the page URL on every event it sends ($current_url, $pathname,
 * $referrer, the $initial_* and $session_entry_* copies, replay metadata), and
 * /invite/<token>, /login?callbackUrl=%2Finvite%2F<token> and
 * /signup?callbackUrl=/invite/<token> are all real app URLs. Run as the
 * `before_send` hook, this swaps the token segment for "[token]" in every string
 * the event carries. Pure; no posthog-js import, so it can be tested.
 */
import { redactInviteTokens } from '../attribution.ts';

const MAX_DEPTH = 8;

function scrub(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return redactInviteTokens(value);
  if (value === null || typeof value !== 'object' || depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = scrub(value[i], depth + 1);
    return value;
  }
  // Plain objects only: leave Dates, typed arrays and the like untouched.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) record[key] = scrub(record[key], depth + 1);
  return value;
}

/** Edits the event in place (posthog-js hands it over for exactly that) and returns it. */
export function scrubInviteTokens<T extends { properties?: unknown; $set?: unknown; $set_once?: unknown }>(
  event: T
): T {
  scrub(event.properties, 0);
  scrub(event.$set, 0);
  scrub(event.$set_once, 0);
  return event;
}
