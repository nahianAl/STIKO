/**
 * Which requests the middleware lets through without a session.
 *
 * Extracted from middleware.ts so the rule can be tested, and so the NextAuth
 * and WorkOS middleware paths share one definition instead of two that drift.
 * Pure: no imports, no I/O.
 */

export const PUBLIC_PATHS = [
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
  // PREFIX MATCH — this also exempts /api/comments/attachments, which mints
  // presigned R2 write URLs. That subroute had no auth() call of its own for a
  // long time precisely because this line silently covered it. Anything added
  // under /api/comments/ inherits this exemption and must call auth() itself and
  // return a JSON 401, never rely on middleware.
  '/api/comments',
  // Every handler under here — GET/POST /api/versions, and the [id], publish,
  // changelog-draft and summary routes — calls auth() itself and returns a
  // JSON 401. Without this exemption, an expired session made DELETE
  // /api/versions/[id] 307 to /login; fetch follows redirects, so the client
  // received a 200 HTML page, `res.ok` was true, and the toast claimed the
  // version was deleted when nothing had happened.
  '/api/versions',
  // Password recovery is for people who cannot sign in. These were missing, so
  // a signed-out visitor — including everyone clicking the link in a reset
  // email — was redirected to /login and the reset flow could never complete.
  '/forgot-password',
  '/reset-password',
  // Where a new account enters the code emailed to it. The visitor has no
  // session yet by definition.
  '/verify-email',
];

export type RouteDecision = 'pass' | 'login';

export function routeDecision(pathname: string, isAuthenticated: boolean): RouteDecision {
  // Vercel Cron carries no session. This route authenticates itself with
  // CRON_SECRET and refuses to run without it, so session auth here would only
  // block the scheduler. Matched exactly, not by prefix: PUBLIC_PATHS uses
  // startsWith, and a '/api/cron' entry there would also exempt any future
  // '/api/cron-something' nobody remembered to check.
  if (pathname === '/api/cron/purge-trash') return 'pass';

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return 'pass';

  // /portal/[id] is public (viewer access) — no auth needed
  // /portal/[id]/submit requires auth (checked in the route handler itself)
  if (pathname.startsWith('/portal')) return 'pass';

  // Everything else requires auth
  return isAuthenticated ? 'pass' : 'login';
}

/** Where to send a signed-out visitor, remembering where they were going. */
export function loginRedirectPath(pathname: string): string {
  return `/login?${new URLSearchParams({ callbackUrl: pathname }).toString()}`;
}
