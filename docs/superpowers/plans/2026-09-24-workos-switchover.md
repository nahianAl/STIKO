# WorkOS Switch-over (Email + Password) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Stiko sign people in through WorkOS instead of NextAuth, behind an `AUTH_PROVIDER` switch that starts on `nextauth`, so the change can be deployed with no visible effect and flipped (or flipped back) with one environment variable and a redeploy.

**Architecture:** Phase 3 of `docs/superpowers/specs/2026-09-05-workos-auth-migration-design.md`, **email and password only**. Google sign-in is deferred until Stiko has a privacy-policy page (Google will not publish the OAuth app without one). Stiko keeps its own sign-in, sign-up and invite forms. Their server routes call the WorkOS User Management API directly (`authenticateWithPassword`, `createUser`, `authenticateWithEmailVerification`, `createPasswordReset`, `resetPassword`). `@workos-inc/authkit-nextjs` is used **only** for the session layer: `saveSession` after a successful authentication, `authkit()` + `handleAuthkitHeaders()` in middleware for verification and refresh, and `withAuth()` to read the session. The local `users` row stays the identity of record. `auth()` keeps its name and gains a stable return shape, so none of the 60 `await auth()` call sites change.

**Tech Stack:** Next.js 14.2.35 App Router, TypeScript, Neon Postgres (`sql` tagged template), NextAuth v5 beta (kept as the rollback path), `@workos-inc/authkit-nextjs` 4.3.2, `@workos-inc/node` ^10.14.0, Node's built-in test runner.

## Global Constraints

- **Node >= 22.11.0.** Both WorkOS packages require it. `package.json` gets `"engines": { "node": ">=22.11.0" }` from the foundation branch (Task 1). Vercel's project Node setting must be 22.x.
- **Pinned versions:** `@workos-inc/authkit-nextjs` exactly `4.3.2`; `@workos-inc/node` `^10.14.0`. `next` stays `14.2.35` (authkit-nextjs 4.3.2 peer range: `^14.2.26`).
- **`AUTH_PROVIDER`:** only the exact value `workos` (case-insensitive, trimmed) turns WorkOS on. Unset, empty or anything else means `nextauth`. With `nextauth`, behaviour must be identical to today apart from the fixes this plan names (public recovery pages, case-insensitive sign-in, lowercase stored emails, server-side 8-character minimum, validated `callbackUrl`).
- **Changing `AUTH_PROVIDER` requires a redeploy.** Vercel binds env vars at deploy time. The root layout, the middleware and the route handlers all read it, and they must agree.
- **Never use the hosted-AuthKit parts of authkit-nextjs:** no `withAuth({ ensureSignedIn: true })`, no `middlewareAuth`, no `handleAuth()`, no `getSignInUrl()`/`getSignUpUrl()`, no `authkitMiddleware()`, and never redirect to `authorizationUrl`. Each of these sends people to WorkOS's hosted login page, which Stiko does not use. Unauthenticated visitors go to Stiko's own `/login`.
- **`saveSession` only runs inside route handlers.** It writes cookies and cannot run in a React Server Component.
- **Import `@workos-inc/authkit-nextjs` lazily (`await import(...)`)** everywhere, so a deploy running NextAuth never loads WorkOS or needs its env vars.
- **Do not change any of the 60 `await auth()` call sites, and do not touch `lib/access.ts`.** Containing the blast radius is why `auth()` keeps its name.
- **Middleware rules carry over verbatim:** every `PUBLIC_PATHS` comment, the load-bearing trailing slash on `'/api/invite/'`, the exact-match cron exemption, and the matcher. Routes in `PUBLIC_PATHS` return their own JSON 401.
- **Test runner:** `npm test` runs `node --test scripts/tests/*.mjs`. Tests are `.mjs`, import `.ts` directly and use `node:test` + `node:assert/strict`. `lib/foo.ts` → `scripts/tests/foo.test.mjs`.
- **Tested modules must not have `@/` VALUE imports.** Node cannot resolve the alias. `import type { X } from '@/lib/…'` is fine because type-only imports are erased. Tested modules import siblings with relative `.ts` paths.
- **No DOM or React testing library, and none may be added.** Route handlers and components are not unit-tested. Policy is extracted into pure `lib/` modules that are.
- **UI copy:** say "package" and "submission", never "version" (`scripts/tests/copyTerms.test.mjs` fails the build on it). Code identifiers keep `portal`/`version`.
- **Comment style:** explain *why* a guard exists and which bug it prevents.
- **Secrets:** never read, print or `source` `.env.local` from a shell. The only sanctioned form is the `DATABASE_URL="$(grep …)"` prefix command given in Task 14, piped through the redaction `sed`. The production WorkOS API key is typed with `read -rs` and never echoed.
- **Local testing of WorkOS mode uses a Neon branch database, never production.** `.env.local` points at the live database. Signing in locally with Staging WorkOS keys would write Staging WorkOS ids into live `users.workos_user_id`, and every real account touched that way would then be refused in production as a `conflict`.
- **Email:** WorkOS's own emails are turned off in the dashboard (both environments). Stiko sends the verification-code and password-reset emails itself through `lib/email.ts`, from `stiko.design`. Never use `stiko.app`.
- **Out of scope:** Google or any OAuth, the `/auth/callback` route, MFA enrollment UI, rate limiting on Stiko's own API routes, changing an account's email, a change-password page, `InviteProblem`'s "Switch account" button, and Phase 4 cleanup (removing NextAuth and `password_hash`).
- **Git:** never `git add -A` or `git add .` (three long-lived untracked handoff directories get swept in). Add files by path. Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Rollback, stated up front

| Stage | What is live | Rollback | Cost |
|---|---|---|---|
| Merged with `AUTH_PROVIDER=nextauth` | NextAuth, plus the listed fixes | Revert the merge commit and push | One deploy |
| Flipped to `workos` | WorkOS sessions | Set `AUTH_PROVIDER=nextauth`, redeploy | One deploy. Everyone is signed out once. Passwords still work: accounts created or reset under WorkOS also write the bcrypt hash to `users.password_hash` (Tasks 8 and 9). |

The database needs no rollback. Migration 010 is additive and has been live since 2026-09-06.

---

### Task 1: Branch and merge the foundation

**Files:**
- Modify: `lib/schema.sql` (merge-conflict resolution only)

**Interfaces:**
- Consumes: branch `workos-foundation` (7 commits: migration `010-workos-auth.sql`, `lib/workosIdentity.ts` with `resolveLocalUser`, `scripts/importUsersToWorkos.mjs`, `npm run import-users`, `@workos-inc/node`, `engines`).
- Produces: a working branch `feature/workos-switchover` containing all of the above on top of current `main`.

- [ ] **Step 1: Create the branch**

```bash
git switch -c feature/workos-switchover main
```

(If executing in a worktree via superpowers:using-git-worktrees, create the worktree on this branch name instead.)

- [ ] **Step 2: Merge the foundation branch**

```bash
git merge --no-ff workos-foundation -m "merge: WorkOS foundation (migration 010, identity policy, user import)"
```

Expected: `CONFLICT (content): Merge conflict in lib/schema.sql`. No other file conflicts.

- [ ] **Step 3: Resolve the conflict by keeping both sides**

`main` added the `plan` column block after the `users` table. The branch added `workos_user_id` to the table and its own block after it. Both must survive. The top of `lib/schema.sql` must read exactly:

```sql
-- Auth.js managed tables
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE NOT NULL,
  email_verified TIMESTAMPTZ,
  image TEXT,
  password_hash TEXT,
  workos_user_id TEXT,
  job_title TEXT,
  company TEXT,
  email_paused_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- The column above is only created on a FRESH database. scripts/migrate.mjs
-- applies this file before any migration, so on an existing database the
-- CREATE TABLE above is a no-op and the indexes below would fail with
-- 42703 (column does not exist) — taking the whole migration run down before
-- 010 ever applies. Same mirror-the-migration pattern as
-- ai_summaries_enabled further down this file.
ALTER TABLE users ADD COLUMN IF NOT EXISTS workos_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_workos_user_id_key
  ON users (workos_user_id) WHERE workos_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
  ON users (lower(email));

-- The column above is only created on a FRESH database. scripts/migrate.mjs applies
-- this file before any migration, so on an existing database the CREATE TABLE above
-- is a no-op and a column listed only in it would never land. Mirrored in
-- lib/migrations/011-plans.sql — same pattern already used for ai_summaries_enabled
-- further down this file.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
```

Everything after that (`CREATE TABLE IF NOT EXISTS accounts …`) is unchanged. Confirm no conflict markers remain:

```bash
grep -n '^<<<<<<<\|^=======\|^>>>>>>>' lib/schema.sql
```

Expected: no output.

- [ ] **Step 4: Finish the merge, install and check**

```bash
git add lib/schema.sql
git commit --no-edit
npm install
npm test
npx tsc --noEmit -p .
```

Expected: `npm test` reports `fail 0` and includes the six `workosIdentity` tests. `tsc` exits 0 with no output.

- [ ] **Step 5: Confirm migration 010 is live (read-only)**

Migration 010 was applied to production on 2026-09-06. Nothing here writes. Run from the main checkout (`/Users/user/Desktop/STIKO-main`), which holds `.env.local`:

```bash
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`SELECT name FROM schema_migrations WHERE name LIKE '010%'\`.then(r => console.log(r.map(x => x.name)));
" 2>&1 | sed -E 's#postgres(ql)?://[^ ]*#<redacted-url>#g'
```

Expected: `[ '010-workos-auth.sql' ]`. If it prints `[]`, stop and report. The column and indexes the rest of this plan relies on would be missing.

---

### Task 2: Route policy module, and open the password-recovery pages

**This task fixes a live bug and can ship on its own.** `/forgot-password` and `/reset-password` are not in `PUBLIC_PATHS`, so a signed-out visitor, the only kind who needs them, is redirected to `/login`. That includes everyone who clicks the link in a reset email. Verified against production on 2026-09-24: both answer `307 → /login?callbackUrl=…`. This is the root cause of the "forgot password is broken" report.

**Files:**
- Create: `lib/routeAccess.ts`
- Create: `scripts/tests/routeAccess.test.mjs`
- Modify: `middleware.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PUBLIC_PATHS: string[]`, `routeDecision(pathname: string, isAuthenticated: boolean): 'pass' | 'login'`, `loginRedirectPath(pathname: string): string`.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/routeAccess.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeDecision, loginRedirectPath } from '../../lib/routeAccess.ts';

// The live bug this module was extracted to fix: the recovery pages were not
// public, so the people who need them — signed-out people — were bounced to
// /login, including everyone arriving from a reset email.
test('password recovery pages are reachable while signed out', () => {
  assert.equal(routeDecision('/forgot-password', false), 'pass');
  assert.equal(routeDecision('/reset-password/3f1c2a', false), 'pass');
});

test('the email-code page is reachable while signed out', () => {
  assert.equal(routeDecision('/verify-email', false), 'pass');
});

test('sign-in, sign-up and invitation pages are public', () => {
  for (const p of ['/login', '/signup', '/invite/abc', '/api/invite/abc', '/api/auth/workos/sign-in']) {
    assert.equal(routeDecision(p, false), 'pass', p);
  }
});

// The trailing slash on '/api/invite/' is load-bearing: '/api/invites' is the
// pending-invite roster and revoke endpoint, and startsWith('/api/invite')
// would open it to anyone.
test('the invite management API is NOT public', () => {
  assert.equal(routeDecision('/api/invites', false), 'login');
});

test('package views are public; their handlers check access themselves', () => {
  assert.equal(routeDecision('/portal/abc', false), 'pass');
});

test('the cron route is exempt by exact match only', () => {
  assert.equal(routeDecision('/api/cron/purge-trash', false), 'pass');
  assert.equal(routeDecision('/api/cron/purge-trash-everything', false), 'login');
});

test('everything else needs a session', () => {
  assert.equal(routeDecision('/', false), 'login');
  assert.equal(routeDecision('/settings/account', false), 'login');
  assert.equal(routeDecision('/api/projects', false), 'login');
});

test('a signed-in visitor passes everywhere', () => {
  for (const p of ['/', '/settings/account', '/api/invites', '/forgot-password']) {
    assert.equal(routeDecision(p, true), 'pass', p);
  }
});

test('the login redirect carries the requested path', () => {
  assert.equal(loginRedirectPath('/settings/account'), '/login?callbackUrl=%2Fsettings%2Faccount');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/routeAccess.test.mjs`
Expected: FAIL with `Cannot find module '…/lib/routeAccess.ts'`.

- [ ] **Step 3: Write the module**

Create `lib/routeAccess.ts`. The `PUBLIC_PATHS` comments move here **verbatim** from `middleware.ts`, and three entries are added at the end:

```ts
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
```

- [ ] **Step 4: Point the middleware at it**

Replace the whole of `middleware.ts` above `export const config` (lines 1-76) with the following. Keep `export const config` and its comment exactly as they are.

```ts
import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { loginRedirectPath, routeDecision } from '@/lib/routeAccess';

// There was a PROTECTED_PATHS list here. Nothing ever read it, and it claimed
// /api/invite was protected — which is exactly the bug above, written down and
// believed. Everything not matched below requires auth; that is the rule.
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
```

- [ ] **Step 5: Run the tests and the type check**

```bash
npm test
npx tsc --noEmit -p .
```

Expected: `fail 0`, including the nine new `routeAccess` tests; `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add lib/routeAccess.ts scripts/tests/routeAccess.test.mjs middleware.ts
git commit -m "fix(auth): let signed-out visitors reach password recovery" -m "/forgot-password and /reset-password were not in PUBLIC_PATHS, so the
people who need them - signed-out people - were redirected to /login,
including everyone clicking the link in a reset email. Verified against
production 2026-09-24: both 307 to /login. This is the root cause of the
'forgot password is broken' report.

The public-path policy moves to lib/routeAccess.ts, comments verbatim, so it
can be tested and so the NextAuth and WorkOS middleware share one rule.
Also opens /verify-email for the WorkOS email-code step." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The provider switch and the `auth()` seam

`auth()` is called 60 times across 42 route files. This task puts one function in front of NextAuth with a fixed return shape, so later tasks can add a WorkOS branch behind it without touching any caller. After this task, behaviour is unchanged.

Five callers read `session.user.name` (the comment author, the invite and publish emails, two notifications), so the shape keeps `name`. The design spec's `{ id, email }` omits it, and following the spec literally would break those five.

**Files:**
- Create: `lib/authProvider.ts`, `scripts/tests/authProvider.test.mjs`
- Create: `lib/appSession.ts`, `scripts/tests/appSession.test.mjs`
- Create: `lib/nextauth.ts` (the current `lib/auth.ts`, moved)
- Modify: `lib/auth.ts` (becomes the seam)
- Modify: `app/api/auth/[...nextauth]/route.ts`, `middleware.ts` (import from `@/lib/nextauth`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type AuthProviderName = 'nextauth' | 'workos'`; `authProvider(env?: Record<string, string | undefined>): AuthProviderName`
  - `interface AppSession { user: { id: string; name: string | null; email: string } }`; `toAppSession(user: { id?: string | null; name?: string | null; email?: string | null } | null | undefined): AppSession | null`
  - `lib/nextauth.ts` exports `handlers, signIn, signOut, auth` (unchanged NextAuth config)
  - `lib/auth.ts` exports `auth(): Promise<AppSession | null>` and re-exports `type AppSession`

- [ ] **Step 1: Write the failing tests**

Create `scripts/tests/authProvider.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authProvider } from '../../lib/authProvider.ts';

test('unset means NextAuth — the rollback path is the default', () => {
  assert.equal(authProvider({}), 'nextauth');
  assert.equal(authProvider({ AUTH_PROVIDER: '' }), 'nextauth');
});

test('only the exact word workos turns WorkOS on', () => {
  assert.equal(authProvider({ AUTH_PROVIDER: 'workos' }), 'workos');
  assert.equal(authProvider({ AUTH_PROVIDER: ' WorkOS ' }), 'workos');
});

// A typo must fail safe to the path that has worked for months, not to a
// half-configured one.
test('anything else falls back to NextAuth', () => {
  for (const v of ['nextauth', 'work-os', 'true', 'workos2']) {
    assert.equal(authProvider({ AUTH_PROVIDER: v }), 'nextauth', v);
  }
});
```

Create `scripts/tests/appSession.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAppSession } from '../../lib/appSession.ts';

test('a user with an id becomes a session', () => {
  assert.deepEqual(toAppSession({ id: 'u1', name: 'Dana Whitfield', email: 'dana@co.com' }), {
    user: { id: 'u1', name: 'Dana Whitfield', email: 'dana@co.com' },
  });
});

test('missing name and email are normalised, not undefined', () => {
  assert.deepEqual(toAppSession({ id: 'u1' }), { user: { id: 'u1', name: null, email: '' } });
});

// Every caller checks session?.user?.id. A session without one must read as
// signed out, never as a signed-in nobody.
test('no id means no session', () => {
  assert.equal(toAppSession({ name: 'x', email: 'x@y.z' }), null);
  assert.equal(toAppSession(null), null);
  assert.equal(toAppSession(undefined), null);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test scripts/tests/authProvider.test.mjs scripts/tests/appSession.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Write the two pure modules**

Create `lib/authProvider.ts`:

```ts
/**
 * Which sign-in system this deploy runs.
 *
 * AUTH_PROVIDER is the WorkOS cutover switch and also its rollback: set it
 * back to anything but "workos" and redeploy, and NextAuth is live again with
 * every password intact. Unset means NextAuth, so shipping the WorkOS code
 * changes nothing until someone deliberately flips it.
 *
 * Pure and client-safe: the root layout passes the result to the browser.
 */

export type AuthProviderName = 'nextauth' | 'workos';

export function authProvider(
  env: Record<string, string | undefined> = process.env
): AuthProviderName {
  return env.AUTH_PROVIDER?.trim().toLowerCase() === 'workos' ? 'workos' : 'nextauth';
}
```

Create `lib/appSession.ts`:

```ts
/**
 * The one session shape every route handler sees, whichever provider signed
 * the person in.
 *
 * `name` stays in the shape even though the design spec lists only id and
 * email: five handlers read session.user.name (comment author, invite and
 * publish emails, two notifications), and dropping it would quietly turn every
 * one of those into "Someone".
 */

export interface AppSession {
  user: { id: string; name: string | null; email: string };
}

export function toAppSession(
  user: { id?: string | null; name?: string | null; email?: string | null } | null | undefined
): AppSession | null {
  if (!user?.id) return null;
  return { user: { id: user.id, name: user.name ?? null, email: user.email ?? '' } };
}
```

- [ ] **Step 4: Move NextAuth to `lib/nextauth.ts`**

```bash
git mv lib/auth.ts lib/nextauth.ts
```

Add this comment at the very top of `lib/nextauth.ts`, above the imports. The rest of the file is unchanged in this task.

```ts
/**
 * NextAuth — the sign-in system Stiko has run since launch, and the rollback
 * path while WorkOS is introduced behind AUTH_PROVIDER.
 *
 * Nothing outside the auth layer imports this directly: route handlers call
 * auth() from lib/auth.ts, which chooses the provider.
 */
```

- [ ] **Step 5: Write the seam**

Create a new `lib/auth.ts`:

```ts
/**
 * auth() — who is making this request, as a local users row.
 *
 * Called from 60 places across the API. It keeps its name and a fixed return
 * shape so that swapping the sign-in provider underneath changes none of them;
 * that is the whole blast-radius strategy of the WorkOS migration.
 */
import { auth as nextAuth } from '@/lib/nextauth';
import { toAppSession, type AppSession } from '@/lib/appSession';

export type { AppSession };

export async function auth(): Promise<AppSession | null> {
  const session = await nextAuth();
  return toAppSession(session?.user);
}
```

- [ ] **Step 6: Repoint the two NextAuth-specific imports**

In `app/api/auth/[...nextauth]/route.ts`, change the import line to:

```ts
import { handlers } from '@/lib/nextauth';
```

In `middleware.ts`, change the first line to:

```ts
import { auth } from '@/lib/nextauth';
```

(The middleware needs NextAuth's wrapper form `auth((req) => …)`, which the seam deliberately does not offer.)

- [ ] **Step 7: Type-check every caller, then run the tests**

```bash
npx tsc --noEmit -p .
npm test
```

Expected: `tsc` exits 0. This is the check that the 60 call sites accept the new shape. Any error names a caller relying on a field outside `{ id, name, email }`. Fix it by reading that field from `users` in the handler; never widen `AppSession`. `npm test` reports `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add lib/authProvider.ts lib/appSession.ts lib/auth.ts lib/nextauth.ts \
  scripts/tests/authProvider.test.mjs scripts/tests/appSession.test.mjs \
  "app/api/auth/[...nextauth]/route.ts" middleware.ts
git commit -m "refactor(auth): put one auth() seam in front of NextAuth" -m "auth() keeps its name and gets a fixed shape { id, name, email } so a
second provider can sit behind it without touching the 60 call sites. name
stays because five handlers read it. NextAuth's config moves unchanged to
lib/nextauth.ts. AUTH_PROVIDER is parsed in one place and fails safe to
NextAuth. No behaviour change." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Sign-in hygiene on the NextAuth path

Four fixes that apply whichever provider is live:
- Sign-in matched email exactly while sign-up and forgot-password matched `lower(email)`. That was safe to fix once the `lower(email)` unique index existed, and it has existed since 2026-09-06.
- Sign-up stored the address as typed.
- Sign-up had no server-side password minimum.
- `callbackUrl` went straight into `router.push`, which is an open redirect.

**Files:**
- Create: `lib/callbackUrl.ts`, `scripts/tests/callbackUrl.test.mjs`
- Modify: `lib/nextauth.ts:25-27`
- Modify: `app/api/auth/signup/route.ts`

**Interfaces:**
- Produces: `safeCallbackUrl(raw: string | null | undefined): string`. Used by the pages in Tasks 11 and 12.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/callbackUrl.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeCallbackUrl } from '../../lib/callbackUrl.ts';

test('a path on this site is kept', () => {
  assert.equal(safeCallbackUrl('/invite/abc'), '/invite/abc');
  assert.equal(safeCallbackUrl('/portal/p1?file=f1'), '/portal/p1?file=f1');
});

test('nothing means home', () => {
  assert.equal(safeCallbackUrl(null), '/');
  assert.equal(safeCallbackUrl(undefined), '/');
  assert.equal(safeCallbackUrl(''), '/');
});

// callbackUrl ends up in router.push right after a successful sign-in. An
// unchecked value turns every login link into a redirect to wherever the
// link's author likes — the classic phishing follow-through.
test('anything that could leave the site means home', () => {
  for (const raw of [
    'https://evil.example/login',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'evil.example',
  ]) {
    assert.equal(safeCallbackUrl(raw), '/', raw);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test scripts/tests/callbackUrl.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Write the module**

Create `lib/callbackUrl.ts`:

```ts
/**
 * Where to go after signing in, if the link said.
 *
 * Only same-site paths are honoured. `//host` and `/\host` look like paths but
 * browsers treat them as another origin, so both are refused along with
 * anything carrying a scheme.
 */
export function safeCallbackUrl(raw: string | null | undefined): string {
  if (!raw) return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}
```

- [ ] **Step 4: Make NextAuth sign-in case-insensitive**

In `lib/nextauth.ts`, replace the query inside `authorize` (currently `WHERE email = ${email}`) with:

```ts
        // Case-insensitive, like sign-up and forgot-password. The exact match
        // here meant a reset for Dana@Co.com "succeeded" while signing in as
        // dana@co.com still failed. Safe since migration 010: the
        // lower(email) unique index guarantees this matches at most one row.
        const rows = await sql`
          SELECT id, name, email, password_hash FROM users
          WHERE lower(email) = lower(${email.trim()})
        `;
```

- [ ] **Step 5: Normalise and check on sign-up**

Replace the body of `POST` in `app/api/auth/signup/route.ts` with:

```ts
export async function POST(request: NextRequest) {
  const { name, email: rawEmail, password } = await request.json();

  if (!rawEmail || !password || !name) {
    return NextResponse.json({ error: 'Name, email and password are required' }, { status: 400 });
  }

  // The page enforces this too, but only the server's check counts: the form's
  // minLength was the only thing stopping a one-character password.
  if (typeof password !== 'string' || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  // Stored lowercased: WorkOS lowercases addresses too, and the import and
  // sign-in lookups compare against lower(email). One canonical form on both
  // sides is what keeps them matching.
  const email = String(rawEmail).trim().toLowerCase();

  // Case-insensitive, matching app/api/auth/forgot-password/route.ts. A
  // case-sensitive check let DANA@co.com be registered alongside dana@co.com as
  // a separate account — which, since lib/inviteBinding.ts compares addresses
  // case-insensitively, was enough to redeem an invitation addressed to the
  // other one. The lower(email) unique index from migration 010 now enforces
  // this in the database as well.
  const existing = await sql`SELECT id FROM users WHERE lower(email) = ${email}`;
  if (existing[0]) {
    return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
  }

  const id = uuidv4();
  const passwordHash = await hashPassword(password);

  await sql`
    INSERT INTO users (id, name, email, password_hash)
    VALUES (${id}, ${name}, ${email}, ${passwordHash})
  `;

  return NextResponse.json({ success: true }, { status: 201 });
}
```

- [ ] **Step 6: Test and type-check**

```bash
npm test
npx tsc --noEmit -p .
```

Expected: `fail 0`; `tsc` exits 0.

- [ ] **Step 7: Commit**

```bash
git add lib/callbackUrl.ts scripts/tests/callbackUrl.test.mjs lib/nextauth.ts app/api/auth/signup/route.ts
git commit -m "fix(auth): case-insensitive sign-in, lowercase sign-up, safe callbackUrl" -m "Sign-in matched email exactly while sign-up and forgot-password used
lower(email), so a reset could succeed and sign-in still fail. Safe to fix
now that migration 010's lower(email) unique index exists. Sign-up now stores
lowercase and enforces the 8-character minimum server-side. safeCallbackUrl
closes the open redirect; the pages adopt it in the WorkOS page tasks." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Error and message policy for WorkOS

WorkOS reports every failure as an exception whose class, `code` and `rawData` vary by case. This task turns them into a small set of outcomes that routes can return and pages can explain. It is written without importing the SDK, duck-typed on the fields the SDK sets, so it can be unit-tested.

The error shapes come from reading `@workos-inc/node` 10.14.0's `handleHttpError` source:
- Wrong password: a `GenericServerException` with `code: 'invalid_credentials'`.
- Email not verified: an `AuthenticationException` with `code: 'email_verification_required'` and `rawData.{pending_authentication_token, email, email_verification_id}`.
- Rate limit: a `RateLimitExceededException` with `retryAfter`.
- Duplicate email on `createUser`: a `BadRequestException` with `code: 'user_creation_error'` and `errors[].code === 'email_not_available'`.

**One shape is not verified:** a rejected weak password. The regex below is a best guess, and Task 13 Step 5 captures the real code and pins it in this test.

**Files:**
- Create: `lib/authMessages.ts`, `scripts/tests/authMessages.test.mjs`
- Create: `lib/workosErrors.ts`, `scripts/tests/workosErrors.test.mjs`

**Interfaces:**
- Produces (`lib/authMessages.ts`, client-safe):
  - `type AuthErrorCode = 'invalid_credentials' | 'email_verification_required' | 'email_taken' | 'account_conflict' | 'password_rejected' | 'invalid_code' | 'verification_expired' | 'rate_limited' | 'unsupported' | 'invalid_request' | 'unknown'`
  - `type AuthFailureResult = { ok: false; error: AuthErrorCode; email?: string; message?: string; retryAfterSeconds?: number | null }`
  - `type AuthResult = { ok: true } | AuthFailureResult`
  - `authErrorMessage(result: AuthFailureResult): string`
- Produces (`lib/workosErrors.ts`, server-side):
  - `type AuthFailure = AuthFailureResult & { pendingAuthenticationToken?: string; emailVerificationId?: string | null }`
  - `classifyWorkosError(err: unknown): AuthFailure`
  - `publicFailure(failure: AuthFailure): AuthFailureResult` (strips the pending token and verification id)
  - `failureStatus(failure: AuthFailureResult): number`

- [ ] **Step 1: Write the failing tests**

Create `scripts/tests/authMessages.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authErrorMessage } from '../../lib/authMessages.ts';

test('a wrong password keeps the existing wording', () => {
  assert.equal(authErrorMessage({ ok: false, error: 'invalid_credentials' }), 'Invalid email or password');
});

test('a taken address keeps the existing wording', () => {
  assert.equal(authErrorMessage({ ok: false, error: 'email_taken' }), 'Email already in use');
});

// WorkOS explains which rule a password broke; that explanation is the useful
// part and must reach the person choosing the password.
test('a rejected password shows the reason when there is one', () => {
  assert.equal(
    authErrorMessage({ ok: false, error: 'password_rejected', message: 'Password is too common.' }),
    'Password is too common.'
  );
  assert.match(authErrorMessage({ ok: false, error: 'password_rejected' }), /stronger password/);
});

test('every code has a sentence, never an empty string or a raw code', () => {
  for (const error of [
    'invalid_credentials', 'email_verification_required', 'email_taken', 'account_conflict',
    'password_rejected', 'invalid_code', 'verification_expired', 'rate_limited',
    'unsupported', 'invalid_request', 'unknown',
  ]) {
    const text = authErrorMessage({ ok: false, error });
    assert.ok(text.length > 10, error);
    assert.doesNotMatch(text, /_/, error);
  }
});
```

Create `scripts/tests/workosErrors.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWorkosError, publicFailure, failureStatus } from '../../lib/workosErrors.ts';

// Stand-ins shaped like @workos-inc/node 10.14 exceptions: the classifier reads
// fields, not classes, so these are all it needs.
function sdkError(fields) {
  return Object.assign(new Error(fields.message ?? 'WorkOS error'), fields);
}

test('a wrong password', () => {
  assert.deepEqual(
    classifyWorkosError(sdkError({ name: 'GenericServerException', status: 400, code: 'invalid_credentials' })),
    { ok: false, error: 'invalid_credentials' }
  );
});

test('an unverified address carries what the code step needs', () => {
  const failure = classifyWorkosError(
    sdkError({
      name: 'AuthenticationException',
      code: 'email_verification_required',
      rawData: {
        pending_authentication_token: 'pat_123',
        email: 'Dana@Co.com',
        email_verification_id: 'email_verification_9',
      },
    })
  );
  assert.deepEqual(failure, {
    ok: false,
    error: 'email_verification_required',
    email: 'dana@co.com',
    pendingAuthenticationToken: 'pat_123',
    emailVerificationId: 'email_verification_9',
  });
});

// Without the pending token there is no way to finish the sign-in, so saying
// "check your email" would strand the person on a form that cannot work.
test('an unverified address without a pending token is unknown, not a code step', () => {
  assert.deepEqual(
    classifyWorkosError(sdkError({ code: 'email_verification_required', rawData: { email: 'a@b.c' } })),
    { ok: false, error: 'unknown' }
  );
});

test('steps Stiko has no screen for are unsupported', () => {
  for (const code of [
    'mfa_enrollment', 'mfa_challenge', 'mfa_verification', 'radar_email_challenge',
    'radar_sms_challenge', 'sso_required', 'organization_selection_required',
  ]) {
    assert.deepEqual(classifyWorkosError(sdkError({ code })), { ok: false, error: 'unsupported' }, code);
  }
});

test('rate limits carry the wait when WorkOS gives one', () => {
  assert.deepEqual(
    classifyWorkosError(sdkError({ name: 'RateLimitExceededException', status: 429, retryAfter: 30 })),
    { ok: false, error: 'rate_limited', retryAfterSeconds: 30 }
  );
  assert.deepEqual(classifyWorkosError(sdkError({ status: 429 })), {
    ok: false, error: 'rate_limited', retryAfterSeconds: null,
  });
});

test('a duplicate address on createUser', () => {
  assert.deepEqual(
    classifyWorkosError(
      sdkError({ name: 'BadRequestException', code: 'user_creation_error', errors: [{ code: 'email_not_available' }] })
    ),
    { ok: false, error: 'email_taken' }
  );
});

test('a rejected password keeps WorkOS’s explanation', () => {
  assert.deepEqual(
    classifyWorkosError(
      sdkError({ code: 'password_strength_error', message: 'Password is too weak.' })
    ),
    { ok: false, error: 'password_rejected', message: 'Password is too weak.' }
  );
  assert.deepEqual(
    classifyWorkosError(
      sdkError({
        code: 'user_creation_error',
        message: 'Could not create user.',
        errors: [{ code: 'password_too_weak', message: 'Password has appeared in a data breach.' }],
      })
    ),
    { ok: false, error: 'password_rejected', message: 'Password has appeared in a data breach.' }
  );
});

test('anything unrecognised is unknown', () => {
  for (const err of [null, undefined, 'boom', new Error('network down'), sdkError({ code: 'something_new' })]) {
    assert.deepEqual(classifyWorkosError(err), { ok: false, error: 'unknown' });
  }
});

// The pending token authorises finishing someone's sign-in. It goes in an
// httpOnly cookie, never into a JSON body that page scripts can read.
test('the public form drops the pending token and verification id', () => {
  const pub = publicFailure({
    ok: false,
    error: 'email_verification_required',
    email: 'dana@co.com',
    pendingAuthenticationToken: 'pat_123',
    emailVerificationId: 'email_verification_9',
  });
  assert.deepEqual(pub, { ok: false, error: 'email_verification_required', email: 'dana@co.com' });
});

test('status codes', () => {
  const s = (error) => failureStatus({ ok: false, error });
  assert.equal(s('invalid_credentials'), 401);
  assert.equal(s('email_verification_required'), 403);
  assert.equal(s('unsupported'), 403);
  assert.equal(s('email_taken'), 409);
  assert.equal(s('account_conflict'), 409);
  assert.equal(s('password_rejected'), 400);
  assert.equal(s('invalid_code'), 400);
  assert.equal(s('verification_expired'), 400);
  assert.equal(s('invalid_request'), 400);
  assert.equal(s('rate_limited'), 429);
  assert.equal(s('unknown'), 502);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test scripts/tests/authMessages.test.mjs scripts/tests/workosErrors.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Write `lib/authMessages.ts`**

```ts
/**
 * What a sign-in, sign-up or code attempt can come back with, and what to
 * tell the person. Shared by the API routes (which return these shapes as
 * JSON) and the pages (which show the sentence). Pure and client-safe.
 */

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_verification_required'
  | 'email_taken'
  | 'account_conflict'
  | 'password_rejected'
  | 'invalid_code'
  | 'verification_expired'
  | 'rate_limited'
  | 'unsupported'
  | 'invalid_request'
  | 'unknown';

export type AuthFailureResult = {
  ok: false;
  error: AuthErrorCode;
  /** The address a code was sent to (email_verification_required). */
  email?: string;
  /** A human sentence from the server, where it has a better one than ours. */
  message?: string;
  retryAfterSeconds?: number | null;
};

export type AuthResult = { ok: true } | AuthFailureResult;

const HELP = 'Email hello@stiko.design and we’ll sort it out.';

export function authErrorMessage(result: AuthFailureResult): string {
  switch (result.error) {
    case 'invalid_credentials':
      return 'Invalid email or password';
    case 'email_verification_required':
      return 'Check your email for a code to finish signing in.';
    case 'email_taken':
      return 'Email already in use';
    case 'account_conflict':
      return `This account can’t be signed in to right now. ${HELP}`;
    case 'password_rejected':
      return result.message ?? 'Choose a stronger password: longer, and not one used on other sites.';
    case 'invalid_code':
      return 'That code didn’t work. Check it, or send a new one.';
    case 'verification_expired':
      return 'That code has expired. Sign in again to get a new one.';
    case 'rate_limited':
      return 'Too many attempts. Wait a minute and try again.';
    case 'unsupported':
      return `This account needs a sign-in step Stiko doesn’t support yet. ${HELP}`;
    case 'invalid_request':
      return result.message ?? 'Fill in every field and try again.';
    case 'unknown':
      return result.message ?? 'Something went wrong. Try again in a moment.';
  }
}
```

- [ ] **Step 4: Write `lib/workosErrors.ts`**

```ts
/**
 * Turning a WorkOS SDK exception into an outcome Stiko can act on.
 *
 * Duck-typed on the fields @workos-inc/node sets (code, rawData, errors,
 * retryAfter, status) rather than on its classes, so this stays pure and
 * testable, and a class rename in a minor SDK release degrades to 'unknown'
 * instead of crashing a sign-in.
 */
import type { AuthFailureResult } from '@/lib/authMessages';

export type AuthFailure = AuthFailureResult & {
  /** Server-only: finishes a sign-in paused for an email code. */
  pendingAuthenticationToken?: string;
  /** Server-only: used to fetch and re-send that code. */
  emailVerificationId?: string | null;
};

/** Pauses Stiko has no screen for. MFA stays optional and un-enrollable until one exists. */
const UNSUPPORTED = new Set([
  'mfa_enrollment',
  'mfa_challenge',
  'mfa_verification',
  'radar_email_challenge',
  'radar_sms_challenge',
  'sso_required',
  'organization_selection_required',
]);

// UNVERIFIED shape: the WorkOS docs name the password policy but not its error
// code. Task 13 captures the real one against Staging and pins it in the test.
const PASSWORD_POLICY = /password_(strength|policy|too|weak|breach|pwned|history|reuse|length)/;

type Fields = {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  message?: unknown;
  retryAfter?: unknown;
  rawData?: Record<string, unknown>;
  errors?: Array<{ code?: unknown; message?: unknown }>;
};

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

export function classifyWorkosError(err: unknown): AuthFailure {
  if (!err || typeof err !== 'object') return { ok: false, error: 'unknown' };
  const e = err as Fields;
  const code = str(e.code);
  const subErrors = Array.isArray(e.errors) ? e.errors : [];

  if (e.name === 'RateLimitExceededException' || e.status === 429) {
    return {
      ok: false,
      error: 'rate_limited',
      retryAfterSeconds: typeof e.retryAfter === 'number' ? e.retryAfter : null,
    };
  }

  if (code === 'invalid_credentials') return { ok: false, error: 'invalid_credentials' };

  if (code === 'email_verification_required') {
    const token = str(e.rawData?.pending_authentication_token);
    const email = str(e.rawData?.email);
    if (!token || !email) return { ok: false, error: 'unknown' };
    return {
      ok: false,
      error: 'email_verification_required',
      email: email.toLowerCase(),
      pendingAuthenticationToken: token,
      emailVerificationId: str(e.rawData?.email_verification_id) ?? null,
    };
  }

  if (code && UNSUPPORTED.has(code)) return { ok: false, error: 'unsupported' };

  if (subErrors.some((s) => s?.code === 'email_not_available')) {
    return { ok: false, error: 'email_taken' };
  }

  const policyError = subErrors.find((s) => typeof s?.code === 'string' && PASSWORD_POLICY.test(s.code));
  if (policyError) return passwordRejected(str(policyError.message) ?? str(e.message));
  if (code && PASSWORD_POLICY.test(code)) return passwordRejected(str(e.message));

  return { ok: false, error: 'unknown' };
}

// No `message: undefined` key when WorkOS gave no sentence: the page falls back
// to its own wording only if the key is absent.
function passwordRejected(message: string | undefined): AuthFailure {
  return message
    ? { ok: false, error: 'password_rejected', message }
    : { ok: false, error: 'password_rejected' };
}

/** Copies only the fields a browser may see. An allow-list, so a server-only
 *  field added to AuthFailure later cannot leak by default. */
export function publicFailure(failure: AuthFailure): AuthFailureResult {
  const out: AuthFailureResult = { ok: false, error: failure.error };
  if (failure.email !== undefined) out.email = failure.email;
  if (failure.message !== undefined) out.message = failure.message;
  if (failure.retryAfterSeconds !== undefined) out.retryAfterSeconds = failure.retryAfterSeconds;
  return out;
}

export function failureStatus(failure: AuthFailureResult): number {
  switch (failure.error) {
    case 'invalid_credentials':
      return 401;
    case 'email_verification_required':
    case 'unsupported':
      return 403;
    case 'email_taken':
    case 'account_conflict':
      return 409;
    case 'rate_limited':
      return 429;
    case 'unknown':
      return 502;
    default:
      return 400;
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: `fail 0`, including the new `authMessages` and `workosErrors` tests.

- [ ] **Step 6: Commit**

```bash
git add lib/authMessages.ts lib/workosErrors.ts scripts/tests/authMessages.test.mjs scripts/tests/workosErrors.test.mjs
git commit -m "feat(auth): classify WorkOS failures into outcomes Stiko can explain" -m "WorkOS reports wrong passwords, unverified addresses, rate limits and taken
addresses as differently-shaped exceptions. One pure classifier maps them to
a small set of codes; the pages turn codes into sentences. The pending
authentication token is server-only and publicFailure strips it before any
JSON response. The weak-password code is a best guess, pinned against
Staging in Task 13." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Small policies for the WorkOS flows

Five small pure pieces the routes in Task 8 need:
- carrying a paused sign-in in a cookie
- reading the caller's IP address and browser
- splitting a name into first and last
- deciding whether an invitation vouches for an address
- the verification-code email

**Files:**
- Create: `lib/pendingAuth.ts`, `scripts/tests/pendingAuth.test.mjs`
- Create: `lib/requestMeta.ts`, `scripts/tests/requestMeta.test.mjs`
- Modify: `lib/workosIdentity.ts` (add `splitName`), `scripts/tests/workosIdentity.test.mjs`
- Modify: `lib/inviteBinding.ts` (add `inviteVouchesForEmail`), `scripts/tests/inviteBinding.test.mjs`
- Modify: `lib/email.ts` (add `verificationCodeEmail`), `scripts/tests/email.test.mjs`

**Interfaces:**
- Produces:
  - `PENDING_AUTH_COOKIE = 'stiko-pending-auth'`; `interface PendingAuth { token: string; emailVerificationId: string | null; email: string }`; `encodePendingAuth(p: PendingAuth): string`; `decodePendingAuth(raw: string | undefined): PendingAuth | null`; `pendingAuthCookieOptions(secure: boolean): { httpOnly: true; secure: boolean; sameSite: 'lax'; path: '/api/auth/workos'; maxAge: 600 }`
  - `requestMeta(headers: { get(name: string): string | null }): { ipAddress?: string; userAgent?: string }`
  - `splitName(name: string | null | undefined): { firstName?: string; lastName?: string }`
  - `inviteVouchesForEmail(opts: { invite: { email: string | null; multiUse: boolean; expiresAt: string | Date; revokedAt: string | Date | null } | null; email: string; now: Date }): boolean`
  - `verificationCodeEmail(opts: { code: string }): Omit<EmailMessage, 'to'>`

- [ ] **Step 1: Write the failing tests**

Create `scripts/tests/pendingAuth.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodePendingAuth, decodePendingAuth, pendingAuthCookieOptions,
} from '../../lib/pendingAuth.ts';

test('round trip', () => {
  const p = { token: 'pat_1', emailVerificationId: 'ev_1', email: 'dana@co.com' };
  assert.deepEqual(decodePendingAuth(encodePendingAuth(p)), p);
});

test('a missing verification id survives as null', () => {
  const p = { token: 'pat_1', emailVerificationId: null, email: 'dana@co.com' };
  assert.deepEqual(decodePendingAuth(encodePendingAuth(p)), p);
});

// The cookie is the visitor's to edit. Garbage must read as "no pending
// sign-in", never throw and 500 the code form.
test('anything malformed is null', () => {
  for (const raw of [undefined, '', 'not-base64-json', Buffer.from('{"email":"x"}').toString('base64url'),
    Buffer.from('[1,2]').toString('base64url'), Buffer.from('{"token":5,"email":"x"}').toString('base64url')]) {
    assert.equal(decodePendingAuth(raw), null, String(raw));
  }
});

test('the cookie is httpOnly, short-lived and scoped to the WorkOS routes', () => {
  assert.deepEqual(pendingAuthCookieOptions(true), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth/workos', maxAge: 600,
  });
  assert.equal(pendingAuthCookieOptions(false).secure, false);
});
```

Create `scripts/tests/requestMeta.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestMeta } from '../../lib/requestMeta.ts';

test('the first forwarded address is the client', () => {
  const h = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'Safari' });
  assert.deepEqual(requestMeta(h), { ipAddress: '203.0.113.7', userAgent: 'Safari' });
});

test('x-real-ip is the fallback', () => {
  assert.deepEqual(requestMeta(new Headers({ 'x-real-ip': '203.0.113.8' })), { ipAddress: '203.0.113.8' });
});

test('nothing known means nothing sent', () => {
  assert.deepEqual(requestMeta(new Headers()), {});
});
```

Append to `scripts/tests/workosIdentity.test.mjs`. Change its import line to `import { resolveLocalUser, splitName } from '../../lib/workosIdentity.ts';` and add:

```js
test('a name splits into first and the rest', () => {
  assert.deepEqual(splitName('Dana Whitfield'), { firstName: 'Dana', lastName: 'Whitfield' });
  assert.deepEqual(splitName('  Mary Ann  de la Cruz '), { firstName: 'Mary', lastName: 'Ann de la Cruz' });
});

test('a single name has no last name', () => {
  assert.deepEqual(splitName('Cher'), { firstName: 'Cher', lastName: undefined });
});

test('no name is no name', () => {
  assert.deepEqual(splitName('   '), { firstName: undefined, lastName: undefined });
  assert.deepEqual(splitName(null), { firstName: undefined, lastName: undefined });
});
```

Append to `scripts/tests/inviteBinding.test.mjs`. Add `inviteVouchesForEmail` to its existing import from `../../lib/inviteBinding.ts`, then add:

```js
const NOW = new Date('2026-09-24T12:00:00Z');
const addressed = (over = {}) => ({
  email: 'Dana@Co.com', multiUse: false,
  expiresAt: '2026-10-01T00:00:00Z', revokedAt: null, ...over,
});

// Arriving through a link emailed to an address proves you read that inbox,
// so asking for a second emailed code would be friction with nothing bought.
test('an addressed invitation vouches for its own address', () => {
  assert.equal(inviteVouchesForEmail({ invite: addressed(), email: ' dana@co.com', now: NOW }), true);
});

// A share link is posted in chats and forwarded; holding it proves nothing
// about any inbox.
test('a share link vouches for nobody', () => {
  assert.equal(inviteVouchesForEmail({ invite: addressed({ multiUse: true }), email: 'dana@co.com', now: NOW }), false);
  assert.equal(inviteVouchesForEmail({ invite: addressed({ email: null }), email: 'dana@co.com', now: NOW }), false);
});

test('a different address is not vouched for', () => {
  assert.equal(inviteVouchesForEmail({ invite: addressed(), email: 'someone@else.com', now: NOW }), false);
});

test('a dead invitation vouches for nobody', () => {
  assert.equal(inviteVouchesForEmail({ invite: addressed({ expiresAt: '2026-09-01T00:00:00Z' }), email: 'dana@co.com', now: NOW }), false);
  assert.equal(inviteVouchesForEmail({ invite: addressed({ revokedAt: '2026-09-20T00:00:00Z' }), email: 'dana@co.com', now: NOW }), false);
  assert.equal(inviteVouchesForEmail({ invite: null, email: 'dana@co.com', now: NOW }), false);
});
```

Append to `scripts/tests/email.test.mjs`. Add `verificationCodeEmail` to its import from `../../lib/email.ts`, then add:

```js
test('the verification email carries the code and says what it is for', () => {
  const mail = verificationCodeEmail({ code: '482913' });
  assert.equal(mail.subject, 'Your Stiko sign-in code');
  assert.match(mail.body, /482913/);
  assert.match(mail.body, /ignore/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL. The new modules are missing, and `splitName`, `inviteVouchesForEmail` and `verificationCodeEmail` are not exported.

- [ ] **Step 3: Write `lib/pendingAuth.ts`**

```ts
/**
 * A sign-in paused for an emailed code.
 *
 * WorkOS answers an unverified sign-in with a pending authentication token that
 * finishes it once the code is entered. That token authorises completing
 * someone's sign-in, so it lives in an httpOnly cookie scoped to the WorkOS
 * routes, never in a JSON body page scripts could read. Ten minutes covers
 * finding the email; after that the person signs in again.
 */

export const PENDING_AUTH_COOKIE = 'stiko-pending-auth';

export interface PendingAuth {
  token: string;
  emailVerificationId: string | null;
  email: string;
}

export function encodePendingAuth(p: PendingAuth): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
}

export function decodePendingAuth(raw: string | undefined): PendingAuth | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    if (typeof v.token !== 'string' || !v.token) return null;
    if (typeof v.email !== 'string' || !v.email) return null;
    return {
      token: v.token,
      email: v.email,
      emailVerificationId: typeof v.emailVerificationId === 'string' ? v.emailVerificationId : null,
    };
  } catch {
    return null;
  }
}

export function pendingAuthCookieOptions(secure: boolean) {
  return {
    httpOnly: true as const,
    secure,
    sameSite: 'lax' as const,
    path: '/api/auth/workos' as const,
    maxAge: 600 as const,
  };
}
```

- [ ] **Step 4: Write `lib/requestMeta.ts`**

```ts
/**
 * The caller's IP address and browser, passed to WorkOS on every
 * authentication call. WorkOS rate-limits and scores sign-in attempts with
 * them; without them every attempt looks like it comes from Vercel.
 */
export function requestMeta(headers: { get(name: string): string | null }): {
  ipAddress?: string;
  userAgent?: string;
} {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ipAddress = forwarded || headers.get('x-real-ip')?.trim() || undefined;
  const userAgent = headers.get('user-agent') || undefined;
  return {
    ...(ipAddress ? { ipAddress } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
```

- [ ] **Step 5: Add `splitName` to `lib/workosIdentity.ts`**

Append:

```ts
/**
 * WorkOS stores first and last names; Stiko stores one name. The first word is
 * the first name and the rest is the last, which is wrong for some cultures
 * but only affects what WorkOS's dashboard shows. Stiko itself keeps reading
 * users.name.
 */
export function splitName(name: string | null | undefined): {
  firstName?: string;
  lastName?: string;
} {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: undefined, lastName: undefined };
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
  };
}
```

- [ ] **Step 6: Add `inviteVouchesForEmail` to `lib/inviteBinding.ts`**

Append:

```ts
/**
 * Does this invitation prove its holder reads `email`?
 *
 * The design spec exempts invited reviewers from email verification: arriving
 * through a link sent to an address already proves control of it. That holds
 * only for a live, addressed invitation whose address matches. A share link is
 * forwarded and posted by design, so it proves nothing about any inbox.
 */
export function inviteVouchesForEmail(opts: {
  invite: {
    email: string | null;
    multiUse: boolean;
    expiresAt: string | Date;
    revokedAt: string | Date | null;
  } | null;
  email: string;
  now: Date;
}): boolean {
  const { invite } = opts;
  if (!invite || invite.multiUse || !invite.email) return false;
  if (invite.revokedAt) return false;
  if (new Date(invite.expiresAt).getTime() <= opts.now.getTime()) return false;
  return invite.email.trim().toLowerCase() === opts.email.trim().toLowerCase();
}
```

- [ ] **Step 7: Add `verificationCodeEmail` to `lib/email.ts`**

Add after `passwordResetEmail`:

```ts
export function verificationCodeEmail(opts: {
  code: string;
}): Omit<EmailMessage, 'to'> {
  return {
    subject: 'Your Stiko sign-in code',
    body: [
      `Your code is: ${opts.code}`,
      ``,
      `Enter it on the Stiko page that asked for it. It expires in a few minutes.`,
      ``,
      `If you didn't just sign up or sign in to Stiko, you can ignore this email.`,
    ].join('\n'),
  };
}
```

- [ ] **Step 8: Run the tests**

Run: `npm test`
Expected: `fail 0`.

- [ ] **Step 9: Commit**

```bash
git add lib/pendingAuth.ts lib/requestMeta.ts lib/workosIdentity.ts lib/inviteBinding.ts lib/email.ts \
  scripts/tests/pendingAuth.test.mjs scripts/tests/requestMeta.test.mjs scripts/tests/workosIdentity.test.mjs \
  scripts/tests/inviteBinding.test.mjs scripts/tests/email.test.mjs
git commit -m "feat(auth): pure policies for the WorkOS sign-in flows" -m "The paused-sign-in cookie (httpOnly, 10 minutes, scoped to the WorkOS
routes), caller IP and browser for WorkOS's rate limiting, first/last name
splitting, the rule that a live addressed invitation vouches for its own
address (share links never do), and the verification-code email." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 7: WorkOS session core: client, local linking, `auth()` and middleware

This task makes `AUTH_PROVIDER=workos` do something:
- The middleware verifies and refreshes WorkOS sessions.
- `auth()` maps a WorkOS session to a local `users` row.
- One helper links or creates that row.

With the flag unset, nothing changes, and the WorkOS library is never even loaded.

**Files:**
- Modify: `package.json`, `package-lock.json` (install)
- Create: `lib/workos.ts`
- Create: `lib/workosLink.ts`
- Modify: `lib/auth.ts`
- Modify: `middleware.ts`
- Modify: `.env.local.example`

**Interfaces:**
- Consumes: `authProvider` (Task 3), `toAppSession`/`AppSession` (Task 3), `routeDecision`/`loginRedirectPath` (Task 2), `resolveLocalUser` (foundation).
- Produces:
  - `workos(): Promise<WorkOS>`; `workosClientId(): string`; `type WorkosAuthResponse`; `type WorkosUser = WorkosAuthResponse['user']`
  - `linkLocalUser(user: { id: string; email: string; firstName: string | null; lastName: string | null }, opts?: { name?: string | null; passwordHash?: string | null }): Promise<{ ok: true; userId: string } | { ok: false; error: 'account_conflict' }>`
  - `auth()` now branches on the provider

- [ ] **Step 1: Install**

```bash
npm install --save-exact @workos-inc/authkit-nextjs@4.3.2
npm install @workos-inc/node@^10.14.0
npm ls @workos-inc/node
```

Expected: `npm ls` shows **one** `@workos-inc/node` version, deduped under authkit-nextjs. Two copies would mean two incompatible `WorkOS` types, and Step 2 would fail to type-check.

- [ ] **Step 2: Write `lib/workos.ts`**

```ts
/**
 * The WorkOS API client, for the routes that call it directly.
 *
 * Taken from authkit-nextjs's getWorkOS() so the session layer and Stiko's own
 * calls share one configured client. Imported lazily: a deploy running
 * NextAuth never loads WorkOS or needs its environment variables.
 */
import type { WorkOS } from '@workos-inc/node';

export type WorkosAuthResponse = Awaited<
  ReturnType<WorkOS['userManagement']['authenticateWithPassword']>
>;
export type WorkosUser = WorkosAuthResponse['user'];

export async function workos(): Promise<WorkOS> {
  const { getWorkOS } = await import('@workos-inc/authkit-nextjs');
  return getWorkOS();
}

export function workosClientId(): string {
  const id = process.env.WORKOS_CLIENT_ID;
  if (!id) {
    throw new Error('WORKOS_CLIENT_ID must be set when AUTH_PROVIDER=workos.');
  }
  return id;
}
```

- [ ] **Step 3: Write `lib/workosLink.ts`**

```ts
/**
 * Make sure a WorkOS user has its local users row, and return that row's id.
 *
 * The rule itself (use, link, create or refuse) is lib/workosIdentity.ts and is
 * tested there. This is only the database half. It runs on every WorkOS
 * sign-in, before the session is saved, so a session never exists for someone
 * auth() cannot map to a row.
 */
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { resolveLocalUser } from '@/lib/workosIdentity';

export type LinkResult = { ok: true; userId: string } | { ok: false; error: 'account_conflict' };

export async function linkLocalUser(
  workosUser: { id: string; email: string; firstName: string | null; lastName: string | null },
  opts: { name?: string | null; passwordHash?: string | null } = {}
): Promise<LinkResult> {
  const email = workosUser.email.trim().toLowerCase();

  // Two passes at most. The second only runs when another request linked or
  // created this row between our read and our write; re-resolving then lands
  // on 'use' or 'conflict' instead of creating a duplicate.
  for (let attempt = 0; attempt < 2; attempt++) {
    const byWorkosId = await sql`SELECT id FROM users WHERE workos_user_id = ${workosUser.id} LIMIT 1`;
    const byEmail = await sql`SELECT id, workos_user_id FROM users WHERE lower(email) = ${email} LIMIT 1`;

    const resolution = resolveLocalUser({
      byWorkosId: byWorkosId[0] ? { id: byWorkosId[0].id as string } : null,
      byEmail: byEmail[0]
        ? { id: byEmail[0].id as string, workosUserId: (byEmail[0].workos_user_id as string | null) ?? null }
        : null,
    });

    switch (resolution.action) {
      case 'use':
        return { ok: true, userId: resolution.userId };

      case 'link': {
        const updated = await sql`
          UPDATE users SET workos_user_id = ${workosUser.id}
          WHERE id = ${resolution.userId} AND workos_user_id IS NULL
          RETURNING id
        `;
        if (updated[0]) return { ok: true, userId: resolution.userId };
        continue;
      }

      case 'create': {
        const name =
          opts.name?.trim() ||
          [workosUser.firstName, workosUser.lastName].filter(Boolean).join(' ') ||
          null;
        const id = uuidv4();
        try {
          // password_hash is written when the caller has the password (sign-up):
          // it is what lets AUTH_PROVIDER=nextauth roll back without locking
          // out accounts created under WorkOS.
          await sql`
            INSERT INTO users (id, name, email, password_hash, workos_user_id)
            VALUES (${id}, ${name}, ${email}, ${opts.passwordHash ?? null}, ${workosUser.id})
          `;
          return { ok: true, userId: id };
        } catch (err) {
          // 23505: a concurrent request inserted this address first.
          if ((err as { code?: string }).code === '23505') continue;
          throw err;
        }
      }

      case 'conflict':
        console.error(
          `[auth] ${email} is linked to WorkOS user ${resolution.existingWorkosUserId}, ` +
            `not ${workosUser.id}. Refusing to re-point it.`
        );
        return { ok: false, error: 'account_conflict' };
    }
  }

  console.error(`[auth] could not settle the local row for ${email} after a retry.`);
  return { ok: false, error: 'account_conflict' };
}
```

- [ ] **Step 4: Give `auth()` its WorkOS branch**

Replace `lib/auth.ts` with:

```ts
/**
 * auth() — who is making this request, as a local users row.
 *
 * Called from 60 places across the API. It keeps its name and a fixed return
 * shape so that swapping the sign-in provider underneath changes none of them;
 * that is the whole blast-radius strategy of the WorkOS migration.
 */
import { auth as nextAuth } from '@/lib/nextauth';
import { toAppSession, type AppSession } from '@/lib/appSession';
import { authProvider } from '@/lib/authProvider';
import { sql } from '@/lib/db';

export type { AppSession };

export async function auth(): Promise<AppSession | null> {
  if (authProvider() === 'workos') return workosAuth();
  const session = await nextAuth();
  return toAppSession(session?.user);
}

/**
 * A WorkOS session names a WorkOS user; everything in Stiko keys on the local
 * users.id. Map through workos_user_id on every call instead of trusting the
 * name or email sealed into the cookie: those are a snapshot from sign-in,
 * while the local row is the identity of record (and the only place a renamed
 * profile shows up).
 */
async function workosAuth(): Promise<AppSession | null> {
  const { withAuth } = await import('@workos-inc/authkit-nextjs');
  // Never { ensureSignedIn: true }: that redirects to WorkOS's hosted login
  // page, which Stiko does not use. A missing user simply means signed out.
  const { user } = await withAuth();
  if (!user) return null;

  const rows = await sql`
    SELECT id, name, email FROM users WHERE workos_user_id = ${user.id} LIMIT 1
  `;
  // A valid session with no linked row should be impossible (sign-in links
  // before it saves the session). If it happens, read it as signed out rather
  // than inventing an identity.
  return toAppSession(rows[0] as { id: string; name: string | null; email: string } | undefined);
}
```

- [ ] **Step 5: Make the middleware choose**

Replace `middleware.ts` above `export const config` with the following. Keep `export const config` and its comment exactly as they are.

```ts
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { auth as nextAuth } from '@/lib/nextauth';
import { authProvider } from '@/lib/authProvider';
import { loginRedirectPath, routeDecision } from '@/lib/routeAccess';

// There was a PROTECTED_PATHS list here. Nothing ever read it, and it claimed
// /api/invite was protected — which is exactly the bug above, written down and
// believed. Everything not matched below requires auth; that is the rule.
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
  const { authkit, handleAuthkitHeaders } = await import('@workos-inc/authkit-nextjs');

  // authkit() runs on EVERY matched request, public or not. It verifies and
  // refreshes the session and hands it to route handlers through request
  // headers; withAuth() in a handler only works if this ran. The WorkOS
  // sign-in routes live under the public /api/auth prefix and still need it.
  const { session, headers } = await authkit(request);

  if (routeDecision(request.nextUrl.pathname, !!session.user) === 'login') {
    // Stiko's own /login — never authkit's authorizationUrl, which is WorkOS's
    // hosted login page.
    return handleAuthkitHeaders(request, headers, {
      redirect: loginRedirectPath(request.nextUrl.pathname),
    });
  }

  // handleAuthkitHeaders, not NextResponse.next(): it forwards the session to
  // handlers, sends refreshed cookies to the browser, and strips any
  // x-workos-* headers a client tried to inject.
  return handleAuthkitHeaders(request, headers);
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
```

- [ ] **Step 6: Document the variables**

In `.env.local.example`, after the `NEXTAUTH_URL` block, add:

```bash
# Which sign-in system runs: "workos" or anything else (= NextAuth). Changing
# it needs a restart locally and a REDEPLOY on Vercel. It is also the rollback.
#
# NEVER set AUTH_PROVIDER=workos in a .env.local whose DATABASE_URL is the live
# database while using Staging WorkOS keys: signing in would write Staging
# WorkOS ids into real accounts. Test WorkOS mode against a Neon branch, in
# .env.development.local (which overrides this file) — see the switch-over plan.
AUTH_PROVIDER=nextauth

# WorkOS (only read when AUTH_PROVIDER=workos). Use the STAGING key and client
# id locally; Production values live only in Vercel.
# WORKOS_API_KEY=sk_test_...
# WORKOS_CLIENT_ID=client_...
# 32+ random characters: openssl rand -base64 32
# WORKOS_COOKIE_PASSWORD=
# Required by the WorkOS library even though Stiko has no OAuth callback yet.
# NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/auth/callback
```

- [ ] **Step 7: Test, type-check, and build with the flag unset**

```bash
npm test
npx tsc --noEmit -p .
AUTH_SECRET=build-check NEXTAUTH_SECRET=build-check DATABASE_URL=postgresql://build:check@localhost/db npm run build
```

Expected: `fail 0`; `tsc` exits 0; the build ends with `✓ Compiled successfully` and a route table, and no WorkOS env vars are set. If the build complains about a WorkOS variable, a module is importing authkit-nextjs eagerly. Find it and make it lazy.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json lib/workos.ts lib/workosLink.ts lib/auth.ts middleware.ts .env.local.example
git commit -m "feat(auth): WorkOS sessions behind AUTH_PROVIDER" -m "With AUTH_PROVIDER=workos, middleware runs authkit() on every matched
request (so withAuth() works in handlers) and sends signed-out visitors to
Stiko's own /login, never WorkOS's hosted page. auth() maps the WorkOS user
to the local row via workos_user_id on every call. linkLocalUser applies the
tested use/link/create/conflict rule. Unset, nothing changes and WorkOS is
never loaded." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The WorkOS sign-in routes

Six route handlers under `/api/auth/workos/`, all inert (404) unless `AUTH_PROVIDER=workos`:

| Route | Does |
|---|---|
| `POST sign-in` | `{ email, password }`: authenticates, links the local row, saves the session |
| `POST sign-up` | `{ name, email, password, inviteToken? }`: creates the WorkOS user and local row, then signs in |
| `POST verify-email` | `{ code }`: finishes a sign-in paused for an emailed code |
| `POST resend-code` | re-sends the code for the paused sign-in |
| `POST sign-out` | revokes the WorkOS session and clears the cookie |
| `GET session` | the current `AppSession` or `{ user: null }`, for the browser |

They sit under the public `/api/auth` prefix and handle their own authentication. Static segments take precedence over the `[...nextauth]` catch-all, so they do not collide with it.

**Files:**
- Create: `lib/workosFlow.ts`
- Create: `app/api/auth/workos/sign-in/route.ts`, `app/api/auth/workos/sign-up/route.ts`, `app/api/auth/workos/verify-email/route.ts`, `app/api/auth/workos/resend-code/route.ts`, `app/api/auth/workos/sign-out/route.ts`, `app/api/auth/workos/session/route.ts`

**Interfaces:**
- Consumes: everything from Tasks 3 and 5-7.
- Produces (HTTP): every POST answers `AuthResult` JSON. `{ ok: true }` has status 200. A failure has `failureStatus` as its status and never carries the pending token. `GET session` answers `{ user: { id, name, email } }` or `{ user: null }`.
- Produces (server): `workosDisabled()`, `failureResponse()`, `completeSignIn()`, `passwordSignIn()`, `handleAuthError()`, `sendVerificationCode()`, `clearPendingAuth()`, `readJson()`, `createWorkosPasswordReset()`, `resetWorkosPassword()` (the last two are used in Task 9).

- [ ] **Step 1: Write `lib/workosFlow.ts`**

```ts
/**
 * The steps every WorkOS sign-in path shares: finish a successful
 * authentication (link the local row, save the session), and pause one that
 * needs an emailed code. Server-only; route handlers call these.
 *
 * WorkOS's own emails are turned off in its dashboard, so every email here is
 * sent by Stiko, from stiko.design, through lib/email.ts.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { authProvider } from '@/lib/authProvider';
import { workos, workosClientId, type WorkosAuthResponse } from '@/lib/workos';
import { linkLocalUser } from '@/lib/workosLink';
import { sendEmail, verificationCodeEmail } from '@/lib/email';
import { requestMeta } from '@/lib/requestMeta';
import {
  classifyWorkosError,
  failureStatus,
  publicFailure,
  type AuthFailure,
} from '@/lib/workosErrors';
import {
  PENDING_AUTH_COOKIE,
  encodePendingAuth,
  pendingAuthCookieOptions,
  type PendingAuth,
} from '@/lib/pendingAuth';
import type { AuthFailureResult } from '@/lib/authMessages';

const secureCookies = () => process.env.NODE_ENV === 'production';

/** These routes exist only while WorkOS is the provider. */
export function workosDisabled(): NextResponse | null {
  return authProvider() === 'workos'
    ? null
    : NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function failureResponse(failure: AuthFailureResult): NextResponse {
  return NextResponse.json(failure, { status: failureStatus(failure) });
}

/**
 * Link the local row, then write the session cookie — in that order. A session
 * for a WorkOS user with no local row would make auth() return null on every
 * request: a sign-in that "worked" and changed nothing.
 */
export async function completeSignIn(
  request: NextRequest,
  response: WorkosAuthResponse
): Promise<NextResponse> {
  const linked = await linkLocalUser(response.user);
  if (!linked.ok) return failureResponse({ ok: false, error: 'account_conflict' });

  const { saveSession } = await import('@workos-inc/authkit-nextjs');
  await saveSession(response, request);
  return NextResponse.json({ ok: true });
}

export async function passwordSignIn(
  request: NextRequest,
  email: string,
  password: string
): Promise<NextResponse> {
  let response: WorkosAuthResponse;
  try {
    response = await (await workos()).userManagement.authenticateWithPassword({
      clientId: workosClientId(),
      email,
      password,
      ...requestMeta(request.headers),
    });
  } catch (err) {
    return handleAuthError(err);
  }
  return completeSignIn(request, response);
}

export async function handleAuthError(err: unknown): Promise<NextResponse> {
  const failure = classifyWorkosError(err);
  if (failure.error === 'email_verification_required') {
    await beginEmailVerification(failure);
  } else if (failure.error === 'unknown') {
    console.error('[auth] WorkOS call failed', err);
  }
  return failureResponse(publicFailure(failure));
}

async function beginEmailVerification(failure: AuthFailure): Promise<void> {
  const pending: PendingAuth = {
    token: failure.pendingAuthenticationToken as string,
    emailVerificationId: failure.emailVerificationId ?? null,
    email: failure.email as string,
  };
  cookies().set(PENDING_AUTH_COOKIE, encodePendingAuth(pending), pendingAuthCookieOptions(secureCookies()));
  // Not awaited for its result: whether or not delivery worked, the page must
  // move to the code step, which offers Resend. Failures are logged inside.
  await sendVerificationCode(pending);
}

export type CodeDelivery = 'sent' | 'expired' | 'failed';

/** WorkOS creates the code; Stiko emails it. */
export async function sendVerificationCode(pending: PendingAuth): Promise<CodeDelivery> {
  if (!pending.emailVerificationId) {
    console.error('[auth] WorkOS gave no email verification id; cannot send a code.');
    return 'failed';
  }
  try {
    const verification = await (await workos()).userManagement.getEmailVerification(
      pending.emailVerificationId
    );
    if (new Date(verification.expiresAt).getTime() <= Date.now()) return 'expired';

    const result = await sendEmail({
      to: pending.email,
      ...verificationCodeEmail({ code: verification.code }),
    });
    if (!result.delivered) {
      console.error(`[auth] verification code not delivered: ${result.reason}`);
      return 'failed';
    }
    return 'sent';
  } catch (err) {
    console.error('[auth] could not fetch the email verification', err);
    return 'failed';
  }
}

export function clearPendingAuth(): void {
  cookies().set(PENDING_AUTH_COOKIE, '', { ...pendingAuthCookieOptions(secureCookies()), maxAge: 0 });
}

/** For Task 9's forgot-password route. Null means log-and-say-nothing. */
export async function createWorkosPasswordReset(
  email: string
): Promise<{ token: string; expiresAt: Date } | null> {
  try {
    const reset = await (await workos()).userManagement.createPasswordReset({ email });
    return { token: reset.passwordResetToken, expiresAt: new Date(reset.expiresAt) };
  } catch (err) {
    console.error('[forgot-password] WorkOS could not create a reset', err);
    return null;
  }
}

/** For Task 9's reset-password route. */
export async function resetWorkosPassword(
  token: string,
  newPassword: string
): Promise<{ ok: true } | AuthFailure> {
  try {
    await (await workos()).userManagement.resetPassword({ token, newPassword });
    return { ok: true };
  } catch (err) {
    const failure = classifyWorkosError(err);
    if (failure.error === 'unknown') console.error('[reset-password] WorkOS refused the reset', err);
    return failure;
  }
}
```

- [ ] **Step 2: Write the sign-in route**

Create `app/api/auth/workos/sign-in/route.ts`:

```ts
import type { NextRequest } from 'next/server';
import { failureResponse, passwordSignIn, readJson, workosDisabled } from '@/lib/workosFlow';

export async function POST(request: NextRequest) {
  const disabled = workosDisabled();
  if (disabled) return disabled;

  const { email, password } = await readJson(request);
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    return failureResponse({ ok: false, error: 'invalid_request', message: 'Enter your email and password.' });
  }

  return passwordSignIn(request, email.trim().toLowerCase(), password);
}
```

- [ ] **Step 3: Write the sign-up route**

Create `app/api/auth/workos/sign-up/route.ts`:

```ts
import type { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { inviteVouchesForEmail } from '@/lib/inviteBinding';
import { splitName } from '@/lib/workosIdentity';
import { workos, type WorkosUser } from '@/lib/workos';
import { linkLocalUser } from '@/lib/workosLink';
import {
  failureResponse,
  handleAuthError,
  passwordSignIn,
  readJson,
  workosDisabled,
} from '@/lib/workosFlow';

export async function POST(request: NextRequest) {
  const disabled = workosDisabled();
  if (disabled) return disabled;

  const { name, email: rawEmail, password, inviteToken } = await readJson(request);
  if (
    typeof name !== 'string' || !name.trim() ||
    typeof rawEmail !== 'string' || !rawEmail.trim() ||
    typeof password !== 'string' || !password
  ) {
    return failureResponse({ ok: false, error: 'invalid_request', message: 'Name, email and password are required' });
  }
  // WorkOS enforces its own, stronger policy; this keeps the floor Stiko has
  // always had even if that policy is loosened in the dashboard.
  if (password.length < 8) {
    return failureResponse({ ok: false, error: 'password_rejected', message: 'Password must be at least 8 characters' });
  }
  const email = rawEmail.trim().toLowerCase();

  const existing = await sql`SELECT id FROM users WHERE lower(email) = ${email} LIMIT 1`;
  if (existing[0]) return failureResponse({ ok: false, error: 'email_taken' });

  // Invited reviewers skip the emailed code: a live invitation addressed to
  // this exact address already proves they read that inbox (design spec,
  // "Email verification"). Share links never qualify.
  let emailVerified = false;
  if (typeof inviteToken === 'string' && inviteToken) {
    const rows = await sql`
      SELECT email, multi_use, expires_at, revoked_at FROM invite_tokens
      WHERE token = ${inviteToken} LIMIT 1
    `;
    const row = rows[0];
    emailVerified = inviteVouchesForEmail({
      invite: row
        ? {
            email: (row.email as string | null) ?? null,
            multiUse: Boolean(row.multi_use),
            expiresAt: row.expires_at as string,
            revokedAt: (row.revoked_at as string | null) ?? null,
          }
        : null,
      email,
      now: new Date(),
    });
  }

  const { firstName, lastName } = splitName(name);
  let created: WorkosUser;
  try {
    created = await (await workos()).userManagement.createUser({
      email,
      password,
      firstName,
      lastName,
      emailVerified,
    });
  } catch (err) {
    return handleAuthError(err);
  }

  // The local row is created now, not at first sign-in, so the bcrypt hash can
  // be written while the password is in hand. That hash is what lets
  // AUTH_PROVIDER=nextauth roll back without locking this account out.
  const linked = await linkLocalUser(created, {
    name: name.trim(),
    passwordHash: await hashPassword(password),
  });
  if (!linked.ok) return failureResponse({ ok: false, error: 'account_conflict' });

  return passwordSignIn(request, email, password);
}
```

- [ ] **Step 4: Write the verify-email route**

Create `app/api/auth/workos/verify-email/route.ts`:

```ts
import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { sql } from '@/lib/db';
import { workos, workosClientId, type WorkosAuthResponse } from '@/lib/workos';
import { requestMeta } from '@/lib/requestMeta';
import { classifyWorkosError } from '@/lib/workosErrors';
import { PENDING_AUTH_COOKIE, decodePendingAuth } from '@/lib/pendingAuth';
import {
  clearPendingAuth,
  completeSignIn,
  failureResponse,
  readJson,
  workosDisabled,
} from '@/lib/workosFlow';

export async function POST(request: NextRequest) {
  const disabled = workosDisabled();
  if (disabled) return disabled;

  const { code } = await readJson(request);
  if (typeof code !== 'string' || !code.trim() || code.trim().length > 20) {
    return failureResponse({ ok: false, error: 'invalid_code' });
  }

  const pending = decodePendingAuth(cookies().get(PENDING_AUTH_COOKIE)?.value);
  if (!pending) return failureResponse({ ok: false, error: 'verification_expired' });

  let response: WorkosAuthResponse;
  try {
    response = await (await workos()).userManagement.authenticateWithEmailVerification({
      clientId: workosClientId(),
      code: code.trim(),
      pendingAuthenticationToken: pending.token,
      ...requestMeta(request.headers),
    });
  } catch (err) {
    const failure = classifyWorkosError(err);
    if (failure.error === 'rate_limited') return failureResponse(failure);
    // WorkOS's wrong-code and expired-code errors are not documented
    // precisely; either way the useful answer is "check it or resend".
    console.error('[auth] email code refused', err);
    return failureResponse({ ok: false, error: 'invalid_code' });
  }

  const done = await completeSignIn(request, response);
  if (done.status === 200) {
    clearPendingAuth();
    await sql`
      UPDATE users SET email_verified = COALESCE(email_verified, NOW())
      WHERE workos_user_id = ${response.user.id}
    `;
  }
  return done;
}
```

- [ ] **Step 5: Write the resend-code route**

Create `app/api/auth/workos/resend-code/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { PENDING_AUTH_COOKIE, decodePendingAuth } from '@/lib/pendingAuth';
import { failureResponse, sendVerificationCode, workosDisabled } from '@/lib/workosFlow';

export async function POST() {
  const disabled = workosDisabled();
  if (disabled) return disabled;

  const pending = decodePendingAuth(cookies().get(PENDING_AUTH_COOKIE)?.value);
  if (!pending) return failureResponse({ ok: false, error: 'verification_expired' });

  const delivery = await sendVerificationCode(pending);
  if (delivery === 'sent') return NextResponse.json({ ok: true });
  if (delivery === 'expired') return failureResponse({ ok: false, error: 'verification_expired' });
  return failureResponse({
    ok: false,
    error: 'unknown',
    message: 'We couldn’t send the code just now. Try again in a minute.',
  });
}
```

- [ ] **Step 6: Write the sign-out route**

Create `app/api/auth/workos/sign-out/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { workos } from '@/lib/workos';
import { workosDisabled } from '@/lib/workosFlow';

export async function POST() {
  const disabled = workosDisabled();
  if (disabled) return disabled;

  const { withAuth } = await import('@workos-inc/authkit-nextjs');
  const info = await withAuth();
  const sessionId = info.user ? info.sessionId : undefined;

  // Revoke server-side, not just delete the cookie: a copied cookie must stop
  // working too. That is one of the audit findings WorkOS was bought to close.
  // A failure here still clears the cookie below; the person asked to leave.
  if (sessionId) {
    try {
      await (await workos()).userManagement.revokeSession({ sessionId });
    } catch (err) {
      console.error('[auth] could not revoke the WorkOS session', err);
    }
  }

  cookies().delete(process.env.WORKOS_COOKIE_NAME || 'wos-session');
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 7: Write the session route**

Create `app/api/auth/workos/session/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { workosDisabled } from '@/lib/workosFlow';

// Read on every request; a cached answer would show one person's session to
// the next.
export const dynamic = 'force-dynamic';

export async function GET() {
  const disabled = workosDisabled();
  if (disabled) return disabled;

  const session = await auth();
  return NextResponse.json(session ?? { user: null }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
```

- [ ] **Step 8: Close the NextAuth sign-up route under WorkOS**

`POST /api/auth/signup` creates a local row with no WorkOS user. Under WorkOS that account could never sign in, but it would *squat the address*: the real owner's WorkOS sign-up would then be refused as `email_taken`. At the top of `POST` in `app/api/auth/signup/route.ts`, add:

```ts
  // Under WorkOS, accounts are created by /api/auth/workos/sign-up. A local
  // row made here would have no WorkOS user, could never sign in, and would
  // block its address's real owner from signing up.
  if (authProvider() === 'workos') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
```

and the import `import { authProvider } from '@/lib/authProvider';`.

- [ ] **Step 9: Type-check, test and build**

```bash
npx tsc --noEmit -p .
npm test
AUTH_SECRET=build-check NEXTAUTH_SECRET=build-check DATABASE_URL=postgresql://build:check@localhost/db npm run build
```

Expected: `tsc` exits 0; `fail 0`; the build succeeds and lists the six `/api/auth/workos/*` routes as `ƒ` (dynamic).

If `tsc` rejects a WorkOS call's parameter or return field (for example `passwordResetToken`, `expiresAt`, `code` or `sessionId`), check the installed type:

```bash
grep -rn "passwordResetToken\|interface EmailVerification\b\|expiresAt" node_modules/@workos-inc/node/lib/**/*.d.* | head
```

Use the name it declares. Do not cast around it.

- [ ] **Step 10: Commit**

```bash
git add lib/workosFlow.ts app/api/auth/workos app/api/auth/signup/route.ts
git commit -m "feat(auth): WorkOS sign-in, sign-up, email code and sign-out routes" -m "Stiko keeps its own forms; these routes call the WorkOS User Management API
and save the session with authkit-nextjs. Every route 404s unless
AUTH_PROVIDER=workos. Sign-up creates the local row immediately and writes
the bcrypt hash too, so a rollback to NextAuth keeps the account working.
Invited reviewers skip the emailed code; share-link and self-serve sign-ups
do not. The pending authentication token only ever travels in an httpOnly
cookie. Sign-out revokes the session server-side." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Password reset under WorkOS

Password reset keeps its pages, its `password_reset_tokens` table and its emailed link. What changes in WorkOS mode:

- **Who issues the token:** WorkOS's `createPasswordReset` does, and Stiko records it in `password_reset_tokens` so the existing page can validate it and show the address.
- **Who sets the password:** WorkOS's `resetPassword` does, and Stiko still writes the bcrypt hash locally, so a rollback keeps the new password working.
- **A token is only marked used after WorkOS accepts the new password.** If WorkOS rejects it as too weak, the same link still works for another try.

It also stops discarding the send result: a failed reset email is now logged. The response stays identical either way, so it never reveals whether an address is registered.

**Files:**
- Modify: `app/api/auth/forgot-password/route.ts`
- Modify: `app/api/auth/reset-password/route.ts` (POST only; GET is unchanged)

**Interfaces:**
- Consumes: `createWorkosPasswordReset`, `resetWorkosPassword` (Task 8), `authProvider` (Task 3), `authErrorMessage` (Task 5).

- [ ] **Step 1: Rewrite the forgot-password route**

Replace `app/api/auth/forgot-password/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { sendEmail, passwordResetEmail } from '@/lib/email';
import { appBaseUrlOrNull } from '@/lib/appUrl';
import { authProvider } from '@/lib/authProvider';
import { createWorkosPasswordReset } from '@/lib/workosFlow';

const ONE_HOUR_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  const { email } = await request.json();

  if (typeof email !== 'string' || !email.trim()) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }
  const address = email.trim().toLowerCase();

  const rows = await sql`
    SELECT id FROM users WHERE lower(email) = ${address} LIMIT 1
  `;

  // 3c: always report the sent state, even for an unregistered address — never
  // confirm whether an account exists. The work below is skipped, but the
  // response is identical.
  if (rows.length > 0) {
    // The link host comes from configuration, never from the request. Deriving
    // it from the Host header would let an attacker request a reset for someone
    // else's address and have the victim receive a working token pointed at the
    // attacker's host.
    const base = appBaseUrlOrNull();

    if (!base) {
      // Refuse to mint a token we cannot send safely. Still fall through to the
      // same generic response below, so this does not become an oracle for
      // whether the address is registered.
      console.error(
        '[forgot-password] NEXTAUTH_URL is not configured — reset email not sent.'
      );
    } else {
      // Under WorkOS the password lives there, so WorkOS must issue the token
      // its resetPassword call will accept. It is still recorded locally so the
      // reset page can check it and show whose account it is.
      const issued =
        authProvider() === 'workos'
          ? await createWorkosPasswordReset(address)
          : { token: uuidv4(), expiresAt: new Date(Date.now() + ONE_HOUR_MS) };

      if (issued) {
        await sql`
          INSERT INTO password_reset_tokens (id, token, user_id, expires_at)
          VALUES (${uuidv4()}, ${issued.token}, ${rows[0].id}, ${issued.expiresAt.toISOString()})
        `;

        const result = await sendEmail({
          to: address,
          ...passwordResetEmail({ link: `${base}/reset-password/${issued.token}` }),
        });
        // Logged, never returned: the response must stay the same for
        // registered and unregistered addresses. Before this line the result
        // was discarded, which is how broken resets went unnoticed.
        if (!result.delivered) {
          console.error(`[forgot-password] reset email not delivered: ${result.reason}`);
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Rewrite the reset-password POST**

In `app/api/auth/reset-password/route.ts`, add these imports at the top:

```ts
import { authProvider } from '@/lib/authProvider';
import { authErrorMessage } from '@/lib/authMessages';
import { resetWorkosPassword } from '@/lib/workosFlow';
```

Replace the entire `POST` function (from `/** POST — consume the token and set the new password. */` to the end of the file) with:

```ts
/** POST — consume the token and set the new password. */
export async function POST(request: NextRequest) {
  const { token, password } = await request.json();

  if (typeof token !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'Missing token or password' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 }
    );
  }

  const userId =
    authProvider() === 'workos'
      ? await consumeWithWorkos(token, password)
      : await claimLocally(token);
  if (typeof userId !== 'string') return userId;

  // Written under WorkOS too. This local hash is what lets
  // AUTH_PROVIDER=nextauth roll back without locking out anyone who reset
  // their password while WorkOS was live.
  const hash = await hashPassword(password);
  await sql`
    UPDATE users SET password_hash = ${hash} WHERE id = ${userId}
  `;

  const emailRows = await sql`
    SELECT email FROM users WHERE id = ${userId}
  `;

  return NextResponse.json({ ok: true, email: emailRows[0]?.email ?? null });
}

function linkGone() {
  return NextResponse.json({ error: 'This link is no longer valid' }, { status: 410 });
}

async function claimLocally(token: string): Promise<string | NextResponse> {
  // Claim the token first. The `used_at IS NULL` guard makes this atomic: two
  // concurrent submissions cannot both consume the same single-use link.
  const claimed = await sql`
    UPDATE password_reset_tokens
    SET used_at = NOW()
    WHERE token = ${token}
      AND used_at IS NULL
      AND expires_at > NOW()
    RETURNING user_id
  `;
  return claimed[0] ? (claimed[0].user_id as string) : linkGone();
}

async function consumeWithWorkos(token: string, password: string): Promise<string | NextResponse> {
  // Checked, not claimed, before calling WorkOS: if WorkOS refuses the
  // password as too weak, the person must be able to try again with the same
  // link. WorkOS's own token is single-use, so it guards the race instead.
  const rows = await sql`
    SELECT user_id FROM password_reset_tokens
    WHERE token = ${token} AND used_at IS NULL AND expires_at > NOW()
    LIMIT 1
  `;
  if (!rows[0]) return linkGone();

  const result = await resetWorkosPassword(token, password);
  if (!result.ok) {
    if (result.error === 'password_rejected' || result.error === 'rate_limited') {
      return NextResponse.json(
        { error: authErrorMessage(result) },
        { status: result.error === 'rate_limited' ? 429 : 400 }
      );
    }
    return linkGone();
  }

  await sql`
    UPDATE password_reset_tokens SET used_at = NOW()
    WHERE token = ${token} AND used_at IS NULL
  `;
  return rows[0].user_id as string;
}
```

- [ ] **Step 3: Type-check and test**

```bash
npx tsc --noEmit -p .
npm test
```

Expected: `tsc` exits 0; `fail 0`.

- [ ] **Step 4: Commit**

```bash
git add app/api/auth/forgot-password/route.ts app/api/auth/reset-password/route.ts
git commit -m "feat(auth): password reset through WorkOS, recorded locally" -m "Under AUTH_PROVIDER=workos, WorkOS issues the reset token and sets the
password; the token is still recorded in password_reset_tokens so the reset
page works unchanged, and only marked used once WorkOS accepts the password,
so a too-weak password can be retried on the same link. The bcrypt hash is
still written locally, keeping the NextAuth rollback intact. A failed reset
email is now logged instead of discarded." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 10: The browser's auth layer

Ten files import `next-auth/react` directly. Under WorkOS, `useSession()` would always report "signed out" and `signIn`/`signOut` would hit NextAuth. This task adds one client module that offers the same things for whichever provider the deploy runs. It also swaps the four files that only *read* the session. The pages that sign people in come in Tasks 11 and 12.

The provider reaches the browser as a prop from the root layout (a server component). A client component cannot read a server-only env var, and duplicating it as `NEXT_PUBLIC_…` would create two switches that can disagree.

**Files:**
- Create: `lib/authClient.tsx`
- Modify: `app/providers.tsx`, `app/layout.tsx`
- Modify: `app/page.tsx:28,40`, `app/settings/account/page.tsx:4,32`, `components/shell/AvatarMenu.tsx:5,14,107`, `components/portal/CommentsPanel.tsx:4,488-489`

**Interfaces:**
- Consumes: `AuthProviderName` (Task 3), `AppSession` and `toAppSession` (Task 3), `AuthResult` (Task 5), the `/api/auth/workos/*` routes (Task 8).
- Produces:
  - `AuthClientProvider({ provider, children })`
  - `useAuthSession(): { data: AppSession | null; status: 'loading' | 'authenticated' | 'unauthenticated'; update(): Promise<void> }`
  - `useAuthActions(): { signInWithPassword(email, password): Promise<AuthResult>; signUp({ name, email, password, inviteToken? }): Promise<AuthResult>; verifyEmail(code): Promise<AuthResult>; resendCode(): Promise<AuthResult>; signOutTo(callbackUrl): Promise<void> }`

- [ ] **Step 1: Write `lib/authClient.tsx`**

```tsx
'use client';

/**
 * Sign-in as the browser sees it, for whichever provider this deploy runs.
 *
 * Pages call useAuthSession() and useAuthActions() and never import
 * next-auth/react themselves. Under NextAuth these delegate to it, so
 * behaviour is exactly what it was; under WorkOS they talk to
 * /api/auth/workos/*. The provider arrives as a prop from the root layout,
 * the same env var the server reads, so the two cannot disagree.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  SessionProvider,
  signIn as nextAuthSignIn,
  signOut as nextAuthSignOut,
  useSession as useNextAuthSession,
} from 'next-auth/react';
import type { AuthProviderName } from '@/lib/authProvider';
import { toAppSession, type AppSession } from '@/lib/appSession';
import type { AuthResult } from '@/lib/authMessages';

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthSessionState {
  data: AppSession | null;
  status: SessionStatus;
  /** Re-read the session, e.g. after the profile name changed. */
  update: () => Promise<void>;
}

const ProviderContext = createContext<AuthProviderName>('nextauth');
const WorkosSessionContext = createContext<AuthSessionState | null>(null);

async function postAuth(url: string, body?: unknown): Promise<AuthResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => null)) as AuthResult | null;
    return data && data.ok === false ? data : { ok: false, error: 'unknown' };
  } catch {
    return { ok: false, error: 'unknown' };
  }
}

function WorkosSessionProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppSession | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');

  const update = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/workos/session', { cache: 'no-store' });
      const body = res.ok ? ((await res.json()) as { user: AppSession['user'] | null }) : null;
      const session = toAppSession(body?.user);
      setData(session);
      setStatus(session ? 'authenticated' : 'unauthenticated');
    } catch {
      setData(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    void update();
  }, [update]);

  const value = useMemo(() => ({ data, status, update }), [data, status, update]);
  return <WorkosSessionContext.Provider value={value}>{children}</WorkosSessionContext.Provider>;
}

export function AuthClientProvider({
  provider,
  children,
}: {
  provider: AuthProviderName;
  children: React.ReactNode;
}) {
  // NextAuth's SessionProvider stays mounted under WorkOS too: useAuthSession
  // calls useNextAuthSession unconditionally (hooks cannot be conditional),
  // and that hook throws without its provider. Under WorkOS it simply reports
  // no session.
  return (
    <ProviderContext.Provider value={provider}>
      <SessionProvider>
        {provider === 'workos' ? <WorkosSessionProvider>{children}</WorkosSessionProvider> : children}
      </SessionProvider>
    </ProviderContext.Provider>
  );
}

export function useAuthSession(): AuthSessionState {
  const provider = useContext(ProviderContext);
  const workos = useContext(WorkosSessionContext);
  const nextAuth = useNextAuthSession();
  const nextAuthUpdate = nextAuth.update;

  const nextAuthState = useMemo<AuthSessionState>(
    () => ({
      data: toAppSession(nextAuth.data?.user as { id?: string; name?: string | null; email?: string | null } | undefined),
      status: nextAuth.status,
      update: async () => {
        await nextAuthUpdate();
      },
    }),
    [nextAuth.data, nextAuth.status, nextAuthUpdate]
  );

  return provider === 'workos' && workos ? workos : nextAuthState;
}

export function useAuthActions() {
  const provider = useContext(ProviderContext);
  const refresh = useContext(WorkosSessionContext)?.update;

  const signInWithPassword = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (provider !== 'workos') {
        const result = await nextAuthSignIn('credentials', { email, password, redirect: false });
        return result?.error ? { ok: false, error: 'invalid_credentials' } : { ok: true };
      }
      const result = await postAuth('/api/auth/workos/sign-in', { email, password });
      if (result.ok) await refresh?.();
      return result;
    },
    [provider, refresh]
  );

  const signUp = useCallback(
    async (input: { name: string; email: string; password: string; inviteToken?: string }): Promise<AuthResult> => {
      if (provider !== 'workos') {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: input.name, email: input.email, password: input.password }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return {
            ok: false,
            error: res.status === 409 ? 'email_taken' : 'invalid_request',
            message: data.error,
          };
        }
        const result = await nextAuthSignIn('credentials', {
          email: input.email,
          password: input.password,
          redirect: false,
        });
        return result?.error
          ? { ok: false, error: 'unknown', message: 'Account created, but sign-in failed. Try signing in.' }
          : { ok: true };
      }
      const result = await postAuth('/api/auth/workos/sign-up', input);
      if (result.ok) await refresh?.();
      return result;
    },
    [provider, refresh]
  );

  const verifyEmail = useCallback(
    async (code: string): Promise<AuthResult> => {
      const result = await postAuth('/api/auth/workos/verify-email', { code });
      if (result.ok) await refresh?.();
      return result;
    },
    [refresh]
  );

  const resendCode = useCallback(() => postAuth('/api/auth/workos/resend-code'), []);

  const signOutTo = useCallback(
    async (callbackUrl: string) => {
      if (provider !== 'workos') {
        await nextAuthSignOut({ callbackUrl });
        return;
      }
      await postAuth('/api/auth/workos/sign-out');
      // A full navigation, not router.push: every component still holding the
      // old session is torn down rather than left showing it.
      window.location.assign(callbackUrl);
    },
    [provider]
  );

  return { signInWithPassword, signUp, verifyEmail, resendCode, signOutTo };
}
```

- [ ] **Step 2: Pass the provider from the layout**

Replace `app/providers.tsx` with:

```tsx
'use client';

import { AuthClientProvider } from '@/lib/authClient';
import type { AuthProviderName } from '@/lib/authProvider';

export default function Providers({
  provider,
  children,
}: {
  provider: AuthProviderName;
  children: React.ReactNode;
}) {
  return <AuthClientProvider provider={provider}>{children}</AuthClientProvider>;
}
```

In `app/layout.tsx`, add `import { authProvider } from "@/lib/authProvider";` after the other imports, and change `<Providers>` to `<Providers provider={authProvider()}>`.

- [ ] **Step 3: Swap the four session readers**

`app/page.tsx`: replace `import { useSession } from 'next-auth/react';` with `import { useAuthSession } from '@/lib/authClient';`, and line 40 `const { data: session } = useSession();` with `const { data: session } = useAuthSession();`. Line 255 (`session?.user?.name ?? ''`) is unchanged.

`app/settings/account/page.tsx`: replace the `next-auth/react` import with `import { useAuthSession } from '@/lib/authClient';`, and line 32 with `const { data: session, update } = useAuthSession();`. Every other use is unchanged. Under WorkOS, `update()` re-reads the session from the database, so a renamed profile shows immediately. Under NextAuth it behaves as before.

`components/portal/CommentsPanel.tsx`: replace the `next-auth/react` import with `import { useAuthSession } from '@/lib/authClient';`, and lines 488-489 with:

```tsx
  const { data: session } = useAuthSession();
  const currentUserId = session?.user.id ?? null;
```

`components/shell/AvatarMenu.tsx`: replace line 5 with `import { useAuthActions, useAuthSession } from '@/lib/authClient';`. Replace line 14 with:

```tsx
  const { data: session } = useAuthSession();
  const { signOutTo } = useAuthActions();
```

Change the Sign out button's handler (line 107) to `onClick={() => void signOutTo('/login')}`.

- [ ] **Step 4: Confirm no reader is left behind**

```bash
grep -rln "next-auth/react" app components lib
```

Expected, exactly these files. They are still pending for Tasks 11 and 12, plus the client module itself:

```
app/invite/[token]/page.tsx
app/login/page.tsx
app/reset-password/[token]/page.tsx
app/signup/page.tsx
lib/authClient.tsx
```

- [ ] **Step 5: Type-check, test, build**

```bash
npx tsc --noEmit -p .
npm test
AUTH_SECRET=build-check NEXTAUTH_SECRET=build-check DATABASE_URL=postgresql://build:check@localhost/db npm run build
```

Expected: `tsc` exits 0; `fail 0`; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add lib/authClient.tsx app/providers.tsx app/layout.tsx app/page.tsx app/settings/account/page.tsx \
  components/shell/AvatarMenu.tsx components/portal/CommentsPanel.tsx
git commit -m "feat(auth): one browser auth layer for either provider" -m "useAuthSession and useAuthActions replace direct next-auth/react use. Under
NextAuth they delegate to it unchanged; under WorkOS they call
/api/auth/workos/*. The root layout passes AUTH_PROVIDER down so browser and
server read the same switch. This commit moves the four session readers;
the sign-in pages follow." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Sign-in, sign-up, reset and the email-code page

**Files:**
- Create: `components/auth/EmailCodeForm.tsx`
- Create: `app/verify-email/page.tsx`
- Modify: `app/login/page.tsx`, `app/signup/page.tsx`, `app/reset-password/[token]/page.tsx`

**Interfaces:**
- Consumes: `useAuthActions` (Task 10), `authErrorMessage` (Task 5), `safeCallbackUrl` (Task 4).
- Produces: `EmailCodeForm({ email: string; onVerified: () => void; submitLabel?: string })`, which is reused by the invite page in Task 12. Also the `/verify-email?email=…&callbackUrl=…` page.

- [ ] **Step 1: Write `components/auth/EmailCodeForm.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { ErrorBanner, Field, Input } from '@/components/ui/Primitives';
import { useAuthActions } from '@/lib/authClient';
import { authErrorMessage } from '@/lib/authMessages';

const RESEND_SECONDS = 60;

/**
 * The emailed-code step of a WorkOS sign-in. Used on /verify-email and inside
 * the invitation panel, so an invited person never leaves the invitation to
 * confirm their address.
 */
export default function EmailCodeForm({
  email,
  onVerified,
  submitLabel = 'Verify and continue',
}: {
  email: string;
  onVerified: () => void;
  submitLabel?: string;
}) {
  const { verifyEmail, resendCode } = useAuthActions();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(RESEND_SECONDS);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (countdown === 0) return;
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await verifyEmail(code.trim());
    if (result.ok) {
      onVerified();
      return;
    }
    setLoading(false);
    setError(authErrorMessage(result));
  };

  const resend = async () => {
    setCountdown(RESEND_SECONDS);
    setError(null);
    const result = await resendCode();
    if (result.ok) setResent(true);
    else setError(authErrorMessage(result));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-[15px]">
      <p className="text-[13px] leading-[1.6] text-stiko-muted">
        We sent a code to <b className="text-stiko-ink">{email}</b>. Enter it to finish.
      </p>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <Field label="Code">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
        />
      </Field>

      <Button type="submit" fullWidth disabled={loading || !code.trim()} className="!py-3">
        {loading ? 'Checking…' : submitLabel}
      </Button>

      <p className="text-center text-[12.5px] text-stiko-faint">
        Didn&apos;t arrive?{' '}
        {countdown > 0 ? (
          <span>
            {resent ? 'Sent. ' : ''}Resend in 0:{String(countdown).padStart(2, '0')}
          </span>
        ) : (
          <button
            type="button"
            onClick={resend}
            className="font-bold text-stiko-primary hover:text-stiko-primary-hover"
          >
            Resend
          </button>
        )}
      </p>
    </form>
  );
}
```

- [ ] **Step 2: Write `app/verify-email/page.tsx`**

```tsx
'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import EmailCodeForm from '@/components/auth/EmailCodeForm';
import { safeCallbackUrl } from '@/lib/callbackUrl';

function VerifyEmail() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'));
  // Display only. The code is checked against the paused sign-in held in an
  // httpOnly cookie, never against this parameter.
  const email = searchParams.get('email') ?? 'your email';

  return (
    <AuthShell
      title="Check your email"
      subtitle="One more step to finish signing in."
      below={
        <Link href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`} className="font-bold">
          Back to sign in
        </Link>
      }
    >
      <EmailCodeForm email={email} onVerified={() => router.push(callbackUrl)} />
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
```

- [ ] **Step 3: Rewrite the login form's logic**

In `app/login/page.tsx`:

Replace `import { signIn } from 'next-auth/react';` with:

```tsx
import { useAuthActions } from '@/lib/authClient';
import { authErrorMessage } from '@/lib/authMessages';
import { safeCallbackUrl } from '@/lib/callbackUrl';
```

Replace line 14 (`const callbackUrl = …`) with:

```tsx
  // Validated: this lands in router.push right after sign-in, and an unchecked
  // value sends a freshly signed-in person wherever the link's author chose.
  const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'));
  const { signInWithPassword } = useAuthActions();
```

Replace the whole `handleSubmit` function with:

```tsx
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signInWithPassword(email, password);

    if (result.ok) {
      router.push(callbackUrl);
      return;
    }

    setLoading(false);

    // An account that has never confirmed its address (WorkOS only).
    if (result.error === 'email_verification_required') {
      router.push(
        `/verify-email?${new URLSearchParams({ email: result.email ?? email, callbackUrl }).toString()}`
      );
      return;
    }

    setError(authErrorMessage(result));
  };
```

The JSX is unchanged. Wrong passwords still read "Invalid email or password", because `authErrorMessage` keeps that wording.

- [ ] **Step 4: Rewrite the sign-up form's logic**

In `app/signup/page.tsx`:

Replace `import { signIn } from 'next-auth/react';` with the same three imports as Step 3.

Replace line 18 (`const callbackUrl = …`) with:

```tsx
  const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'));
  const { signUp } = useAuthActions();
```

Replace the whole `handleSubmit` function with:

```tsx
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signUp({ name, email, password });

    if (result.ok) {
      router.push(callbackUrl);
      return;
    }

    setLoading(false);

    // Self-serve sign-ups confirm their address before using Stiko (design
    // spec, "Email verification"). WorkOS only.
    if (result.error === 'email_verification_required') {
      router.push(
        `/verify-email?${new URLSearchParams({ email: result.email ?? email, callbackUrl }).toString()}`
      );
      return;
    }

    setError(authErrorMessage(result));
  };
```

- [ ] **Step 5: Rewrite the reset page's sign-in**

In `app/reset-password/[token]/page.tsx`:

Replace `import { signIn } from 'next-auth/react';` with:

```tsx
import { useAuthActions } from '@/lib/authClient';
import { safeCallbackUrl } from '@/lib/callbackUrl';
```

Replace line 17 (`const callbackUrl = …`) with:

```tsx
  const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'));
  const { signInWithPassword } = useAuthActions();
```

Replace the block from `// "Save and sign in"` to the end of `submit` (the `signIn(...)` call and `router.push(callbackUrl);`) with:

```tsx
    // "Save and sign in" — signs you in and returns you wherever you were
    // headed, including a pending invite. If signing in fails anyway, the
    // password is still saved; send them to sign in by hand rather than to a
    // page that will bounce them.
    const signedIn = await signInWithPassword(data.email, password);
    router.push(
      signedIn.ok ? callbackUrl : `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
    );
  };
```

- [ ] **Step 6: Type-check, test and build**

```bash
npx tsc --noEmit -p .
npm test
AUTH_SECRET=build-check NEXTAUTH_SECRET=build-check DATABASE_URL=postgresql://build:check@localhost/db npm run build
```

Expected: `tsc` exits 0; `fail 0` (including `copyTerms`, which scans the new copy); the build lists `/verify-email`.

- [ ] **Step 7: Commit**

```bash
git add components/auth/EmailCodeForm.tsx app/verify-email/page.tsx app/login/page.tsx app/signup/page.tsx "app/reset-password/[token]/page.tsx"
git commit -m "feat(auth): sign-in pages use the provider-neutral auth layer" -m "Login, sign-up and reset go through useAuthActions, validate callbackUrl,
and route an unconfirmed address to the new /verify-email code page. Under
NextAuth nothing visible changes." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: The invitation page

The invitation page signs people in *inside* the invitation (spec screen 2a), so acceptance cannot be lost to a redirect. The code step must follow the same rule:
- **Share link:** the visitor proves their address with the emailed code inside the panel, and acceptance happens straight after.
- **Addressed invitation:** the code is skipped (Task 8).

**Files:**
- Modify: `app/invite/[token]/page.tsx`

**Interfaces:**
- Consumes: `useAuthSession`, `useAuthActions` (Task 10); `EmailCodeForm` (Task 11); `authErrorMessage` (Task 5). The invitation token comes from `invite.token`, which `GET /api/invite/[token]` already returns.

- [ ] **Step 1: Swap the imports and the session hook**

Replace line 5 (`import { signIn, useSession, signOut } from 'next-auth/react';`) with:

```tsx
import { useAuthActions, useAuthSession } from '@/lib/authClient';
import { authErrorMessage } from '@/lib/authMessages';
import EmailCodeForm from '@/components/auth/EmailCodeForm';
```

In `InvitePage`, replace `const { status, data: session } = useSession();` with:

```tsx
  const { status, data: session } = useAuthSession();
  const { signOutTo } = useAuthActions();
```

Change the Switch button's `onClick` to:

```tsx
              onClick={() => void signOutTo(`/invite/${token}`)}
```

- [ ] **Step 2: Replace the sign-in logic in `InviteAuth`**

In `InviteAuth`, directly after `const [loading, setLoading] = useState(false);`, add:

```tsx
  const { signInWithPassword, signUp } = useAuthActions();
  // Set when WorkOS asks for the emailed code: the address it went to.
  const [codeFor, setCodeFor] = useState<string | null>(null);
```

Replace the whole `submit` function with:

```tsx
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // The token rides along so the server can see this is an addressed
    // invitation to this exact address, and skip the emailed code.
    const result =
      tab === 'create'
        ? await signUp({ name, email, password, inviteToken: invite.token })
        : await signInWithPassword(email, password);

    if (result.ok) {
      onAccepted();
      return;
    }

    setLoading(false);

    // A share link proves nothing about the visitor's inbox, so an account
    // made through one confirms its address first — here, inside the
    // invitation, so acceptance still cannot be dropped by a redirect.
    if (result.error === 'email_verification_required') {
      setCodeFor(result.email ?? email);
      return;
    }

    setError(
      tab === 'signin' && result.error === 'invalid_credentials'
        ? 'Invalid password'
        : authErrorMessage(result)
    );
  };
```

- [ ] **Step 3: Show the code step in place of the form**

In the right-hand panel (`{/* Right — auth */}`), wrap the tab switcher and the form so they give way to the code step. Replace the opening `<div className="flex rounded-[11px] bg-stiko-app p-1">` line with:

```tsx
          {codeFor ? (
            <div className="flex flex-col gap-4">
              <h2 className="text-[16px] font-extrabold text-stiko-ink">Confirm your email</h2>
              <EmailCodeForm
                email={codeFor}
                onVerified={onAccepted}
                submitLabel="Verify & start reviewing"
              />
            </div>
          ) : (
          <>
          <div className="flex rounded-[11px] bg-stiko-app p-1">
```

Then replace the `</form>` that closes the auth form (the only `</form>` in the file) with:

```tsx
          </form>
          </>
          )}
```

- [ ] **Step 4: Confirm nothing imports next-auth/react outside the auth layer**

```bash
grep -rln "next-auth/react" app components lib
```

Expected: only `lib/authClient.tsx`.

- [ ] **Step 5: Type-check, test and build**

```bash
npx tsc --noEmit -p .
npm test
AUTH_SECRET=build-check NEXTAUTH_SECRET=build-check DATABASE_URL=postgresql://build:check@localhost/db npm run build
```

Expected: `tsc` exits 0; `fail 0`; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add "app/invite/[token]/page.tsx"
git commit -m "feat(auth): invitation sign-in works under either provider" -m "The embedded create/sign-in form goes through useAuthActions and passes
the invitation token, so addressed invitations skip the emailed code. A
share-link sign-up confirms its address inside the invitation panel and is
accepted straight after, so acceptance still never depends on a redirect.
Switch signs out through the provider-neutral layer." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Run WorkOS mode end to end locally, against a Neon branch

This is the only rehearsal there is. Production is the only other environment. Everything here uses the **Staging** WorkOS keys and a **Neon branch** of the database, never the live one (see Global Constraints for why).

**Operator prerequisites (the user does these; they cannot be scripted from here):**

1. Neon console → the Stiko project → **Branches** → **Create branch** from `main`, named `workos-test`. Copy its connection string.
2. WorkOS dashboard, **Staging**:
   - **Redirects:** `http://localhost:3000/auth/callback` is listed (runbook Part 2 stage F).
   - **Emails → Configuration:** turn **off** WorkOS's default emails. Stiko sends its own. If they stay on, every code and reset arrives twice, from two senders.
   - **API Keys:** copy the Staging API key and Client ID.
3. In the worktree (or checkout) running this branch, create `.env.development.local`. Next loads it *over* `.env.local`, so the live `DATABASE_URL` is overridden only here:

```bash
DATABASE_URL=<the workos-test branch connection string>
AUTH_PROVIDER=workos
WORKOS_API_KEY=<Staging sk_test_ key>
WORKOS_CLIENT_ID=<Staging client_ id>
WORKOS_COOKIE_PASSWORD=<output of: openssl rand -base64 32>
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/auth/callback
```

Confirm git ignores it:

```bash
git check-ignore -v .env.development.local
```

Expected: a line naming the matching `.gitignore` rule. **If there is no output, stop.** The file would be committable. Add `.env*.local` to `.gitignore` first.

**Files:** none changed, unless Step 5 or Step 6 find something to pin.

- [ ] **Step 1: Rehearse the import against the branch**

```bash
set -a; . ./.env.development.local; set +a
npm run import-users -- --dry 2>&1 | sed -E 's#postgres(ql)?://[^ ]*#<redacted-url>#g'
npm run import-users 2>&1 | sed -E 's#postgres(ql)?://[^ ]*#<redacted-url>#g'
npm run import-users 2>&1 | sed -E 's#postgres(ql)?://[^ ]*#<redacted-url>#g'
```

(Sourcing `.env.development.local` is allowed. It holds only the branch database and Staging keys, which are the whole point of this rehearsal. The rule against sourcing covers `.env.local`.)

Expected:
- The dry run lists every local user, each `with existing password`.
- The first real run ends `created N, adopted 0, failed 0`.
- The second run ends `N local user(s), 0 not yet linked.` and `created 0, adopted 0, failed 0`.

Any failure line: stop and report it.

- [ ] **Step 2: Start the app in WorkOS mode**

```bash
npm run dev
```

Open `http://localhost:3000/`. Expected: redirected to `/login?callbackUrl=%2F`.

- [ ] **Step 3: Existing account: sign in, stay in, sign out**

Sign in with an imported account and its existing password. Expected, in order:
1. You land on `/`, and the avatar menu shows the account's name.
2. Reloading keeps you signed in.
3. After waiting **6 minutes** (the access token lives 5), clicking into a package still works. This proves the middleware refreshes the session.
4. Avatar → Sign out lands on `/login`, and opening `/` again redirects to login.

- [ ] **Step 4: New account: the emailed code**

At `/signup`, create `yourname+workos1@stiko.design` with a strong password. Expected:
1. You are taken to `/verify-email`.
2. The `npm run dev` terminal shows `[email] NOT DELIVERED …` with a body containing `Your code is: ######`. That is correct: there is no `RESEND_API_KEY` locally.
3. Entering that code lands you on `/` signed in.

Then check **Resend** after 60 seconds: a second log line appears.

- [ ] **Step 5: Capture the weak-password error and pin it**

At `/signup`, try `yourname+workos2@stiko.design` with password `password1`. Expected: a sentence about the password under the form, not "Something went wrong".

- **If it says "Something went wrong":** the terminal shows `[auth] WorkOS call failed` with the real error. Note its `code` and any `errors[].code`. In `lib/workosErrors.ts`, extend `PASSWORD_POLICY` to match it. In `scripts/tests/workosErrors.test.mjs`, add a case using that exact shape and replace the `UNVERIFIED shape` comment with the verified one.
- **If the sentence appeared:** still record the code the classifier matched, by temporarily logging `err` in `handleAuthError`, and replace the `UNVERIFIED shape` comment with it.

Run `npm test` either way.

- [ ] **Step 6: Password reset**

Sign out. Use **Forgot?** with the Step 4 address. Expected:
1. The terminal shows the reset email with a `/reset-password/<token>` link.
2. Opening it while signed out shows the reset form, not `/login`. This is Task 2's fix.
3. Setting a new password signs you in.

Then check the recorded expiry:

```bash
node -e "
const { neon } = require('@neondatabase/serverless');
neon(process.env.DATABASE_URL)\`SELECT expires_at - created_at AS lifetime FROM password_reset_tokens ORDER BY created_at DESC LIMIT 1\`.then(r => console.log(r[0]));
"
```

(`DATABASE_URL` is the branch's, still exported from Step 1.) Expected: about one hour.
- **If it is one hour:** keep the email and page copy ("expires in an hour").
- **If it is not:** change `passwordResetEmail` in `lib/email.ts` and the two sentences in `app/forgot-password/page.tsx` to the real figure, and update the matching test.

- [ ] **Step 7: Invitations**

Signed in as the imported account, open a package and invite `yourname+invited@stiko.design` by email. Copy the invite link from the terminal log, or from the package's pending invitations. In a private window:
1. **Addressed invite:** open the link, choose Create account, then submit. Expected: **no code step**, and you land on the package's first file (`/portal/<id>?file=…`).
2. **Share link:** create one for the same package and open it in a new private window. Create `yourname+shared@stiko.design`. Expected: the panel switches to "Confirm your email". The code is in the terminal. Entering it lands you on the package.
3. **Wrong account:** while signed in as the Step 4 account, open the addressed link. Expected: the "sent to a different address" message names the signed-in address. **Switch** signs you out and returns you to the same invitation.

- [ ] **Step 8: Rehearse the rollback**

Stop the dev server. In `.env.development.local`, set `AUTH_PROVIDER=nextauth`, then run `npm run dev` again.

Sign in as `yourname+workos1@stiko.design` with the password set in Step 6. Expected: it works. This proves accounts created or reset under WorkOS survive a rollback. Then set `AUTH_PROVIDER=workos` again.

- [ ] **Step 9: Commit anything Steps 5 or 6 pinned**

```bash
git add lib/workosErrors.ts scripts/tests/workosErrors.test.mjs
git commit -m "test(auth): pin the WorkOS weak-password error shape seen in Staging" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(Add `lib/email.ts`, `app/forgot-password/page.tsx` and `scripts/tests/email.test.mjs` too if Step 6 changed the expiry copy.) Skip this step if nothing changed.

- [ ] **Step 10: Clean up**

Delete `.env.development.local`. Keep the Neon branch until the production cutover has run clean for a week; it is the place to reproduce anything that goes wrong.

---

### Task 14: Cutover in production (operator runbook)

Run top to bottom. Each stage is reversible as described in *Rollback, stated up front*. Commands run in **Terminal**, in `/Users/user/Desktop/STIKO-main`, on `main` after the merge. That checkout's `.env.local` points at the live database.

**Before starting:**
- The go-live runbook's Parts 2 and 3 are done. Vercel Production has `WORKOS_API_KEY` (`sk_live_…`), `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, `NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://app.stiko.design/auth/callback`, and `AUTH_PROVIDER=nextauth`.
- Vercel → Settings → General → Node.js Version is **22.x**.
- WorkOS **Production** → Emails → Configuration: default emails **off**.
- Task 13 passed in full.

- [ ] **Stage 1: Ship with the switch off**

Merge `feature/workos-switchover` into `main` and push. Wait for the Vercel deploy to go green. Then, on `https://app.stiko.design`:
1. Sign in and out with your own account. Nothing should look different.
2. In a private window, open `https://app.stiko.design/forgot-password`. It must show the form, not the login page. This is the live bug fixed in Task 2.

**Rollback:** `git revert -m 1 <merge commit>` and push.

- [ ] **Stage 2: Copy accounts into WorkOS Production**

The production key is typed, not pasted into a file, and never echoed:

```bash
read -rs "WORKOS_API_KEY?Production WorkOS API key (sk_live_…): "; echo
export WORKOS_API_KEY
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" npm run import-users -- --dry 2>&1 | sed -E 's#postgres(ql)?://[^ ]*#<redacted-url>#g'
```

Expected: one `would create … with existing password` line per account. Then run it for real, and a second time to prove nothing is left:

```bash
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" npm run import-users 2>&1 | sed -E 's#postgres(ql)?://[^ ]*#<redacted-url>#g'
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" npm run import-users 2>&1 | sed -E 's#postgres(ql)?://[^ ]*#<redacted-url>#g'
```

Expected: the first run ends `failed 0`; the second ends `0 not yet linked`. **Keep this terminal open** with `WORKOS_API_KEY` exported for Stage 3.

Nothing user-visible has changed: NextAuth is still live, and the WorkOS users simply exist.

- [ ] **Stage 3: Flip**

1. Vercel → Settings → Environment Variables → `AUTH_PROVIDER` (Production) → `workos` → Save.
2. **Re-run the import once more** (same command as above). This catches any account created since Stage 2. Expected: `0 not yet linked`, or a `created 1` line for someone who just signed up.
3. Vercel → Deployments → latest → **⋯** → **Redeploy**. Wait for green.
4. `unset WORKOS_API_KEY`

Everyone is signed out once, because NextAuth sessions do not carry over.

- [ ] **Stage 4: Verify in production**

On `https://app.stiko.design`:
1. **Sign in:** your existing password works. You land on the dashboard, and your name is in the avatar menu.
2. **Sign out**, then **Forgot?**, using your own address: the email arrives from `noreply@stiko.design`, the link opens the reset form, and saving signs you in.
3. **Invitations:** invite a co-founder to a package by email. They accept from the email, with no code step, and land on the package's first file.
4. **Vercel → Logs:** no `[auth]` errors.

- [ ] **Stage 5: If anything is wrong, roll back**

Vercel → `AUTH_PROVIDER` → `nextauth` → Save → Redeploy. Everyone is signed out once more, and every password still works (Tasks 8 and 9 write the local hash). Nothing in the database needs undoing.

---

## Verification before calling this plan done

- [ ] `npm test` passes in full, including the new `routeAccess`, `authProvider`, `appSession`, `callbackUrl`, `authMessages`, `workosErrors`, `pendingAuth` and `requestMeta` suites and the extended `workosIdentity`, `inviteBinding` and `email` suites.
- [ ] `npx tsc --noEmit -p .` exits 0.
- [ ] `npm run build` succeeds with **no** WorkOS env vars set (the NextAuth deploy never needs them).
- [ ] `grep -rln "next-auth/react" app components lib` prints only `lib/authClient.tsx`.
- [ ] `grep -rn "ensureSignedIn\|authkitMiddleware\|handleAuth\b\|getSignInUrl\|authorizationUrl" app lib middleware.ts` prints nothing outside comments.
- [ ] Task 13 passed end to end, including the rollback rehearsal.
- [ ] With `AUTH_PROVIDER=nextauth` locally (plain `npm run dev`, no `.env.development.local`), sign-in, sign-up, sign-out, forgot/reset and invite acceptance behave as before. Confirm this in a browser on your own account, not assumed from the tests.

## Afterwards (not this plan)

- **Google sign-in**, once the privacy-policy page exists: the `/auth/callback` route, the Google button on login, signup and the invite panel, and carrying the invite token through OAuth `state`. See the design spec, "The redirect problem".
- **Phase 4 cleanup** after a clean week under WorkOS: remove NextAuth, `AUTH_PROVIDER`, `lib/authClient.tsx`'s NextAuth branch and `password_hash`, on a separate day.
- `InviteProblem`'s "Switch account" only navigates to `/login` without signing out. The bug predates this plan and is unchanged by it.
- The design spec's "`/login` gains a link back to `https://stiko.design`" is unrelated to WorkOS and left for a copy pass.
