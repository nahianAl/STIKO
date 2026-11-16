/**
 * PostHog reverse proxy (US Cloud), so ad blockers do not drop events.
 * /ingest/static/* and /ingest/array/* -> us-assets.i.posthog.com, everything
 * else -> us.i.posthog.com, path and query string as sent.
 *
 * A route handler, not a next.config.mjs rewrite: an external rewrite forwards
 * every browser header, including the Cookie header with the sign-in session
 * and the Referer (the full page URL). Here only an allowlist of headers goes
 * out (lib/analytics/ingestProxy.ts) and no set-cookie comes back.
 *
 * posthog-js calls slash-ended paths (/ingest/e/, /ingest/flags/); that they
 * reach this handler instead of a 308 depends on skipTrailingSlashRedirect in
 * next.config.mjs. middleware.ts excludes /ingest from its matcher.
 */
import type { NextRequest } from 'next/server';
import { clientIp, proxyRequestHeaders, proxyResponseHeaders, upstreamUrl } from '@/lib/analytics/ingestProxy';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

async function proxy(request: NextRequest): Promise<Response> {
  const target = upstreamUrl(request.nextUrl.pathname, request.nextUrl.search);
  if (!target) return new Response(null, { status: 404 });

  const method = request.method;
  // Only POST carries a body (events, replay, flags); a preflight has none.
  const body = method === 'POST' ? await request.arrayBuffer() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers: proxyRequestHeaders(request.headers, clientIp(request.headers, request.ip)),
      body,
      cache: 'no-store',
    });
  } catch (err) {
    console.error('[ingest] upstream fetch failed', method, (err as Error)?.message);
    return new Response(null, { status: 502 });
  }

  // A null-body status (a preflight's 204) must not be given a body.
  const noBody = method === 'HEAD' || upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
  return new Response(noBody ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: proxyResponseHeaders(upstream.headers),
  });
}

export { proxy as GET, proxy as POST, proxy as OPTIONS };
