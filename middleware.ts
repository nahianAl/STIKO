import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/invite',
  // The invite PAGE was public but the route it reads was not, so a logged-out
  // visitor's fetch was redirected to /login, came back as HTML, failed to
  // parse, and every invite rendered as "nothing here". Being invited is by
  // definition something you do before you have an account.
  //
  // Safe to open: the token is an unguessable UUID and is the only credential
  // the GET accepts, and the POST that actually joins you to the package calls
  // auth() itself and 401s without a session.
  //
  // The trailing slash is load-bearing. These are prefix matches, and
  // '/api/invites' — the pending-invite roster and the revoke endpoint —
  // startsWith('/api/invite'). Without it, opening the token route also opens
  // package management to anyone.
  '/api/invite/',
  '/api/auth',
  '/api/conversions/webhook',
  '/api/files',
  '/api/comments',
  '/api/snapshots',
  // Every handler under here — GET/POST /api/versions, and the [id], publish,
  // changelog-draft and summary routes — calls auth() itself and returns a
  // JSON 401. Without this exemption, an expired session made DELETE
  // /api/versions/[id] 307 to /login; fetch follows redirects, so the client
  // received a 200 HTML page, `res.ok` was true, and the toast claimed the
  // version was deleted when nothing had happened.
  '/api/versions',
];

// There was a PROTECTED_PATHS list here. Nothing ever read it, and it claimed
// /api/invite was protected — which is exactly the bug above, written down and
// believed. Everything not matched below requires auth; that is the rule.

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthenticated = !!req.auth;

  // Allow public paths through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // /portal/[id] is public (viewer access) — no auth needed
  // /portal/[id]/submit requires auth (checked in the route handler itself)
  if (pathname.startsWith('/portal')) {
    return NextResponse.next();
  }

  // Everything else requires auth
  if (!isAuthenticated) {
    const loginUrl = new URL('/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
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
