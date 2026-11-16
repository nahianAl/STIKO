/**
 * The /ingest reverse proxy to PostHog US (app/ingest/[...path]/route.ts), so
 * ad blockers do not drop events. Pure, so it can be tested.
 *
 * It replaced three next.config.mjs rewrites, which forwarded every browser
 * header to PostHog: the Cookie header with the sign-in session (wos-session /
 * authjs.session-token) and the Referer, which is the full page URL. Requests
 * are now built from an allowlist; nothing else leaves.
 */

const INGEST_HOST = 'https://us.i.posthog.com';
const ASSETS_HOST = 'https://us-assets.i.posthog.com';

/** The PostHog URL for an /ingest request, or null if the path is not ours. */
export function upstreamUrl(pathname: string, search: string): string | null {
  if (pathname !== '/ingest' && !pathname.startsWith('/ingest/')) return null;
  // Collapse leading slashes so the rest can never read as `//host`; it is
  // appended to the host as a string, never resolved against it.
  const rest = pathname.slice('/ingest'.length).replace(/^\/+/, '/') || '/';
  const host = /^\/(static|array)(\/|$)/.test(rest) ? ASSETS_HOST : INGEST_HOST;
  return `${host}${rest}${search}`;
}

/** Headers PostHog needs to read the body and answer CORS. Nothing else. */
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'access-control-request-headers',
  'access-control-request-method',
  'content-encoding',
  'content-type',
  'origin',
  'user-agent',
] as const;

/**
 * The visitor's IP, for PostHog's GeoIP. On Vercel the platform value comes
 * first; it and x-real-ip are set by Vercel, not by the client.
 */
export function clientIp(headers: Headers, platformIp: string | undefined): string | null {
  if (platformIp) return platformIp;
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first || null;
}

export function proxyRequestHeaders(incoming: Headers, ip: string | null): Headers {
  const out = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value !== null) out.set(name, value);
  }
  if (ip) out.set('x-forwarded-for', ip);
  return out;
}

/**
 * Response headers handed back to the browser. No set-cookie. No
 * content-encoding / content-length: fetch has already decoded the body.
 */
const RETURNED_RESPONSE_HEADERS = [
  'access-control-allow-credentials',
  'access-control-allow-headers',
  'access-control-allow-methods',
  'access-control-allow-origin',
  'access-control-expose-headers',
  'access-control-max-age',
  'cache-control',
  'content-type',
  'etag',
  'expires',
  'last-modified',
  'retry-after',
  'vary',
] as const;

export function proxyResponseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  for (const name of RETURNED_RESPONSE_HEADERS) {
    const value = upstream.get(name);
    if (value !== null) out.set(name, value);
  }
  return out;
}
