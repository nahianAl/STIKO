/**
 * Server side of UTM capture. public/stiko-tracking.js writes the cookies on
 * both sites; this reads them at signup. Pure.
 *
 * First touch (stiko_ft) is written once and never overwritten; last touch
 * (stiko_lt) on every visit that carries UTMs or click IDs.
 *
 * Relative import with the .ts extension: this module is run by node --test.
 */
import { scrubUrl } from './analytics/scrub.ts';

export const FIRST_TOUCH_COOKIE = 'stiko_ft';
export const LAST_TOUCH_COOKIE = 'stiko_lt';

const TOUCH_FIELDS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'fbclid', 'ttclid', 'landing_page', 'referrer', 'ts',
] as const;
const MAX_VALUE = 200;

export type Touch = Partial<Record<(typeof TOUCH_FIELDS)[number], string>>;

/**
 * landing_page and referrer are URLs, and a URL can carry a credential or
 * personal data: /invite/<token>, /reset-password/<token>, /verify-email?email=…,
 * /login?callbackUrl=%2Finvite%2F<token>. A shared invite link opened from a
 * social app (?fbclid=… appended) is recorded verbatim as the landing page, and
 * an app URL can show up as the referrer. Both go through the same allowlist
 * scrubber PostHog events use (lib/analytics/scrub.ts): token segments become
 * "[token]", only UTM / click-id / billing / tab query keys survive, fragments and
 * user:password@ are dropped. public/stiko-tracking.js applies the same rules
 * before it writes the cookie; this is the second line, for cookies written by
 * an older copy of that script or set by hand.
 */
const URL_FIELDS: ReadonlySet<string> = new Set(['landing_page', 'referrer']);

/**
 * Next's request.cookies hands over the value already decoded, so try it as
 * JSON first. Only a percent-encoded value (raw JSON fails to parse) is decoded.
 * Never throws.
 */
export function parseTouchCookie(raw: string | undefined): Touch | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      parsed = JSON.parse(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const out: Touch = {};
  for (const key of TOUCH_FIELDS) {
    const v = (parsed as Record<string, unknown>)[key];
    if (typeof v === 'string' && v) {
      // Scrub before the length cap, so a long URL cannot leave half a token behind.
      out[key] = (URL_FIELDS.has(key) ? scrubUrl(v) : v).slice(0, MAX_VALUE);
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Engineering plan: review-loop signups keep reviewer_invite even with UTMs. */
export function signupSource(inviteToken: string | null | undefined): 'reviewer_invite' | 'direct' {
  return inviteToken ? 'reviewer_invite' : 'direct';
}

/**
 * The KYC v2 signup type (spec §3). 'joined_teammate' is reserved for when Stiko
 * has teams; nothing writes it yet.
 */
export function signupTypeFor(source: 'reviewer_invite' | 'direct'): 'invited_reviewer' | 'new_workspace' {
  return source === 'reviewer_invite' ? 'invited_reviewer' : 'new_workspace';
}

/** /signup?callbackUrl=/invite/<token> → <token>. */
export function inviteTokenFromCallback(callbackUrl: string | null | undefined): string | null {
  const m = /^\/invite\/([^/?#]+)/.exec(callbackUrl ?? '');
  return m ? m[1] : null;
}

const CLICK_FIELDS = ['gclid', 'fbclid', 'ttclid'] as const;

/** Kept so the later GA4 / ad-conversion phases need no backfill. */
export function clickIds(input: {
  first: Touch | null;
  last: Touch | null;
  fbc?: string;
  fbp?: string;
  ga?: string;
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of CLICK_FIELDS) {
    const v = input.last?.[k] ?? input.first?.[k];
    if (v) out[k] = v;
  }
  if (input.fbc) out.fbc = input.fbc.slice(0, MAX_VALUE);
  if (input.fbp) out.fbp = input.fbp.slice(0, MAX_VALUE);
  if (input.ga) out.ga = input.ga.slice(0, MAX_VALUE);
  return out;
}
