/**
 * What a URL may carry to PostHog (spec §5.2). posthog-js puts the page URL on
 * every event it sends ($current_url, $pathname, $referrer, the $initial_* and
 * $session_entry_* copies, replay meta and custom-event hrefs), and real app URLs
 * carry credentials and personal data:
 *   /invite/<token>, /reset-password/<token>      a credential in the path
 *   /verify-email?email=<address>                  an email address in the query
 *   /login?callbackUrl=%2Finvite%2F<token>         a credential, encoded, in the query
 * Any future route may add another, so this is an allowlist, not a denylist:
 *   - path: kept, except the segment after `invite` or `reset-password`, which
 *     becomes "[token]" (portal/project/file IDs are fine and stay);
 *   - query: only the keys in ALLOWED_QUERY_KEYS survive;
 *   - fragment and user:password@: dropped.
 * A token route left in any other string (plain or percent-encoded, once or
 * twice) is redacted too. Run as the `before_send` hook; pure, no posthog-js
 * import, so it can be tested.
 */

const MAX_DEPTH = 8;

export const ALLOWED_QUERY_KEYS: ReadonlySet<string> = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'fbclid', 'ttclid',
  'billing', 'tab',
]);

/** A path segment named like this is followed by a credential. */
const TOKEN_SEGMENTS: ReadonlySet<string> = new Set(['invite', 'reset-password']);

const PLACEHOLDER = '[token]';

// `/invite/<x>` or `%2Finvite%2F<x>` (also `%252F…`, i.e. encoded twice), anywhere.
const TOKEN_ROUTE = /((?:^|\/|%(?:25)*2F)(?:invite|reset-password)(?:\/|%(?:25)*2F))(?:(?!%(?:25)*2F)[^/?#&\s])+/gi;

const ABSOLUTE = /^https?:\/\/\S*$/i;
const PROTOCOL_RELATIVE = /^\/\/\S*$/;
const PATH = /^\/\S*$/;

/** Replaces the credential after every token route in a string. */
function redactTokenRoutes(value: string): string {
  return value.replace(TOKEN_ROUTE, `$1${PLACEHOLDER}`);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function scrubPath(pathname: string): string {
  const segments = pathname.split('/');
  for (let i = 1; i < segments.length; i++) {
    if (segments[i] && TOKEN_SEGMENTS.has(decodeSegment(segments[i - 1]).toLowerCase())) segments[i] = PLACEHOLDER;
  }
  return redactTokenRoutes(segments.join('/'));
}

function scrubQuery(params: URLSearchParams): string {
  const kept = new URLSearchParams();
  params.forEach((value, key) => {
    if (ALLOWED_QUERY_KEYS.has(key)) kept.append(key, redactTokenRoutes(value));
  });
  const query = kept.toString();
  return query ? `?${query}` : '';
}

/**
 * A URL or path reduced to what may reach PostHog. Any other string comes back
 * unchanged, apart from a token route inside it.
 */
export function scrubUrl(value: string): string {
  const absolute = ABSOLUTE.test(value);
  const protocolRelative = !absolute && PROTOCOL_RELATIVE.test(value);
  if (!absolute && !protocolRelative && !PATH.test(value)) return redactTokenRoutes(value);
  try {
    const url = protocolRelative
      ? new URL(`https:${value}`)
      : absolute
        ? new URL(value)
        : new URL(value, 'https://placeholder.invalid');
    const origin = absolute ? `${url.protocol}//${url.host}` : protocolRelative ? `//${url.host}` : '';
    return `${origin}${scrubPath(url.pathname)}${scrubQuery(url.searchParams)}`;
  } catch {
    // Unparseable: keep only what precedes the query and the fragment.
    return redactTokenRoutes(value.split(/[?#]/)[0]);
  }
}

// rrweb full snapshots and mutations reach before_send already gzipped into a
// binary string; rewriting bytes in one would corrupt the recording.
const GZIP_MAGIC = '\x1f\x8b';

function scrub(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return value.startsWith(GZIP_MAGIC) ? value : scrubUrl(value);
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
export function scrubEvent<T extends { properties?: unknown; $set?: unknown; $set_once?: unknown }>(event: T): T {
  scrub(event.properties, 0);
  scrub(event.$set, 0);
  scrub(event.$set_once, 0);
  return event;
}

/**
 * posthog-js puts document.title on every $pageview as `title`. Stiko's titles
 * are static today; the day a page sets a dynamic one (a package or project
 * name) it would ride along on every pageview. Nothing in analytics needs it
 * (the path says where the person is), so it is removed at the source.
 * Edits the event in place and returns it.
 */
export function dropPageTitle<T extends { properties?: unknown }>(event: T): T {
  const props = event.properties;
  if (props !== null && typeof props === 'object' && !Array.isArray(props)) {
    const record = props as Record<string, unknown>;
    delete record.title;
    delete record.$title;
  }
  return event;
}

/** The before_send hook: no page title, no credentials or personal data in any URL. */
export function sanitizeEvent<T extends { properties?: unknown; $set?: unknown; $set_once?: unknown }>(event: T): T {
  return scrubEvent(dropPageTitle(event));
}
