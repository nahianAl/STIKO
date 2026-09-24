import { auth } from '@/lib/nextauth';
import { NextResponse } from 'next/server';
import { loginRedirectPath, routeDecision } from '@/lib/routeAccess';

// There was a PROTECTED_PATHS list here. Nothing ever read it, and it claimed
// /api/invite was protected — exactly the invite bug documented in
// lib/routeAccess.ts, written down and believed. Everything not matched
// below requires auth; that is the rule.
//
// The public-path rules themselves live in lib/routeAccess.ts, with their
// history, so they can be tested.

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (routeDecision(pathname, !!req.auth) === 'login') {
    return NextResponse.redirect(new URL(loginRedirectPath(pathname), req.nextUrl.origin));
  }

  return NextResponse.next();
});

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
