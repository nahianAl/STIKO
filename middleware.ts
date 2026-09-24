import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { auth as nextAuth } from '@/lib/nextauth';
import { authProvider } from '@/lib/authProvider';
import { loginRedirectPath, routeDecision } from '@/lib/routeAccess';

// There was a PROTECTED_PATHS list here. Nothing ever read it, and it claimed
// /api/invite was protected — exactly the invite bug documented in
// lib/routeAccess.ts, written down and believed. Everything not matched
// below requires auth; that is the rule.
//
// The public-path rules themselves live in lib/routeAccess.ts, with their
// history, so they can be tested and both providers share them.

const nextAuthMiddleware = nextAuth((req) => {
  const { pathname } = req.nextUrl;
  if (routeDecision(pathname, !!req.auth) === 'login') {
    return NextResponse.redirect(new URL(loginRedirectPath(pathname), req.nextUrl.origin));
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
  return handleAuthkitProxy(request, headers);
}

export default function middleware(request: NextRequest, event: NextFetchEvent) {
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|uploads|occt-import-js.wasm).*)'],
};
