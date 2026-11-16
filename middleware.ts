import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { auth as nextAuth } from '@/lib/nextauth';
import { authProvider } from '@/lib/authProvider';
import { loginRedirectPath, routeDecision } from '@/lib/routeAccess';
import { isGatedPage, kycGateEnabled, welcomeRedirectPath } from '@/lib/kyc/gate';
import { PROFILE_COOKIE, profileCookieHeader, profileCookieValid, signProfileCookie } from '@/lib/kyc/profileCookie';
import { profileCompletedFor } from '@/lib/kyc/gateLookup';
import { trailingSlashRedirectTarget } from '@/lib/trailingSlash';

// There was a PROTECTED_PATHS list here. Nothing ever read it, and it claimed
// /api/invite was protected — exactly the invite bug documented in
// lib/routeAccess.ts, written down and believed. Everything not matched
// below requires auth; that is the rule.
//
// The public-path rules themselves live in lib/routeAccess.ts, with their
// history, so they can be tested and both providers share them.

/**
 * The KYC gate (spec §3.4). 'pass' → continue; 'pass+cookie' → continue and
 * cache the answer; 'welcome' → redirect. Only for signed-in page requests.
 */
async function kycGate(
  request: NextRequest,
  subject: { workosUserId: string } | { userId: string }
): Promise<{ kind: 'pass' } | { kind: 'pass+cookie'; value: string } | { kind: 'welcome'; path: string }> {
  const { pathname, search } = request.nextUrl;
  if (!kycGateEnabled() || !isGatedPage(pathname)) return { kind: 'pass' };

  const id = 'workosUserId' in subject ? subject.workosUserId : subject.userId;
  const secret = process.env.PROFILE_COOKIE_SECRET;
  if (await profileCookieValid(request.cookies.get(PROFILE_COOKIE)?.value, id, secret)) {
    return { kind: 'pass' };
  }

  const done = await profileCompletedFor(subject);
  if (done === false) return { kind: 'welcome', path: welcomeRedirectPath(pathname, search) };
  if (done === true && secret) return { kind: 'pass+cookie', value: await signProfileCookie(id, secret) };
  return { kind: 'pass' };
}

function setProfileCookie(response: Response, value: string) {
  // A raw Set-Cookie append, NOT response.cookies.set(). On the WorkOS branch the
  // response comes from handleAuthkitProxy, which appends the refreshed session
  // cookie to the headers after the NextResponse is built; .cookies.set() rewrites
  // Set-Cookie from a construction-time snapshot and would drop that session
  // cookie, logging the user out at the next token refresh. Appending leaves every
  // existing Set-Cookie alone. See profileCookieHeader.
  response.headers.append('set-cookie', profileCookieHeader(value, process.env.NODE_ENV === 'production'));
}

const nextAuthMiddleware = nextAuth(async (req) => {
  const { pathname } = req.nextUrl;
  if (routeDecision(pathname, !!req.auth) === 'login') {
    return NextResponse.redirect(new URL(loginRedirectPath(pathname), req.nextUrl.origin));
  }
  const userId = req.auth?.user?.id;
  if (userId) {
    const gate = await kycGate(req as unknown as NextRequest, { userId });
    if (gate.kind === 'welcome') return NextResponse.redirect(new URL(gate.path, req.nextUrl.origin));
    const res = NextResponse.next();
    if (gate.kind === 'pass+cookie') setProfileCookie(res, gate.value);
    return res;
  }
  return NextResponse.next();
});

async function workosMiddleware(request: NextRequest) {
  // Lazily imported: a NextAuth deploy never loads WorkOS or needs its env.
  const { authkit, handleAuthkitProxy } = await import('@workos-inc/authkit-nextjs');

  // authkit() runs on EVERY matched request, public or not. It verifies and
  // refreshes the session and hands it to route handlers through request
  // headers; withAuth() in a handler only works if this ran. The WorkOS
  // sign-in routes live under the public /api/auth prefix and still need it.
  const { session, headers } = await authkit(request);

  if (routeDecision(request.nextUrl.pathname, !!session.user) === 'login') {
    // Stiko's own /login — never authkit's authorizationUrl, which is WorkOS's
    // hosted login page.
    return handleAuthkitProxy(request, headers, {
      redirect: loginRedirectPath(request.nextUrl.pathname),
    });
  }

  // handleAuthkitProxy, not NextResponse.next(): it forwards the session to
  // handlers, sends refreshed cookies to the browser, and strips any
  // x-workos-* headers a client tried to inject.
  if (session.user) {
    const gate = await kycGate(request, { workosUserId: session.user.id });
    if (gate.kind === 'welcome') {
      return handleAuthkitProxy(request, headers, { redirect: gate.path });
    }
    const res = handleAuthkitProxy(request, headers);
    if (gate.kind === 'pass+cookie') setProfileCookie(res, gate.value);
    return res;
  }

  return handleAuthkitProxy(request, headers);
}

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  // next.config.mjs sets skipTrailingSlashRedirect (so PostHog's slash-ended
  // /ingest/e/ is proxied, not 308'd without CORS headers), which also turns off
  // Next's own `/x/` -> `/x`. Keep that for app paths here, before any auth work.
  // Paths outside the matcher (/ingest, static files, _next) never get here.
  const slashless = trailingSlashRedirectTarget(request.url);
  if (slashless !== null) return NextResponse.redirect(slashless, 308);

  if (authProvider() === 'workos') return workosMiddleware(request);
  // NextAuth's wrapper is typed for its own request shape; at runtime it is a
  // standard (request, event) middleware.
  return (nextAuthMiddleware as unknown as (req: NextRequest, ev: NextFetchEvent) => Promise<Response | undefined>)(
    request,
    event
  );
}

export const config = {
  // occt-import-js.wasm: static asset fetched by the STEP tessellation worker
  // (lib/model/stepToGlb.ts) when a viewed file has no converted GLB variant. It is
  // generated, identical for everyone, and carries no user data — the same category as
  // the already-exempt uploads and favicon.ico — so it must never be auth-gated. Without
  // this exemption it 307s to /login and the worker tries to WebAssembly-compile the
  // login page's HTML.
  //
  // Today every caller happens to be authenticated anyway: /api/files/url 401s without a
  // session and 403s without package access, so a logged-out viewer can't obtain a file
  // URL to trigger this fetch in the first place. This exemption is therefore defensive
  // rather than load-bearing right now — but it is also what keeps this correct if
  // unauthenticated package viewing ships, per ARCHITECTURE.md.
  //
  // rhino3dm/: the same category for Rhino files. three's 3DMLoader fetches rhino3dm.js and
  // rhino3dm.wasm from here (ModelViewerInner sets its library path), copied from three's own
  // bundled copy by the postinstall script. Without the exemption both 307 to /login.
  //
  // icon.svg and apple-icon.png: the same category again, and these two ARE
  // load-bearing. Every page links them, including /login and /invite, where
  // nobody is signed in yet. Without the exemption they 307 to /login and the
  // browser is handed the login page's HTML where it asked for an icon.
  //
  // ingest: the PostHog reverse proxy (next.config.mjs rewrites). stiko-tracking.js: the consent + UTM script, loaded signed-out by www.stiko.design.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|uploads|occt-import-js.wasm|rhino3dm/|ingest|stiko-tracking.js).*)'],
};
