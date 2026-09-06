# WorkOS auth migration, entry routing and Google SSO

**Date:** 2026-09-05
**Status:** Design, approved for planning
**Trigger:** Stiko is opening to users outside the core group, which is the condition set in the 2026-08-27 auth audit for picking the deferred work back up.

---

## Why now

The 2026-08-27 audit found seven real gaps in Stiko's auth and the decision at the time was to defer them until there were users. That moment has arrived.

The move to a hosted provider is a **buy-vs-build decision, not a rescue**. NextAuth v5 with JWT sessions handles thousands of users without strain — sessions are verified from a signed cookie with no database round trip, and bcrypt at cost 12 only becomes a bottleneck under thousands of *simultaneous* sign-ins. Nothing in `lib/auth.ts` falls over at the target scale.

What does not survive contact with real users is everything around the login: no rate limiting on a public form, no email verification, no way to revoke a live session, no MFA. Each is a small project to build and own forever. WorkOS sells all of them as configuration.

The second reason is timing. Stiko has a handful of accounts today. Migrating six users is a script; migrating six thousand is a project with a password-rehashing dance and a support burden. This is the cheapest this migration will ever be.

## Provider decision: WorkOS AuthKit

Evaluated WorkOS, Clerk and Auth0.

At Stiko's current scale **cost is a wash** — WorkOS AuthKit is free to 1M MAU, and Clerk's free plan covers 50,000 monthly retained users and 100 organizations. Clerk is in fact cheaper for the first enterprise SSO connection ($75/mo vs $125/mo, with one included on Clerk's $25 Pro plan). Cost therefore did not decide this.

WorkOS was chosen on two grounds:

1. **Enterprise runway.** The Admin Portal lets a customer's own IT administrator configure their Okta or Entra connection without Stiko engineering involvement. At one enterprise customer that is an afternoon saved; at ten it is a recurring support job avoided. Directory Sync (SCIM) and Audit Logs are first-class rather than tier-gated.
2. **Cost at the scale being aimed for.** Free to 1M MAU versus $0.02/MRU past 50,000 means WorkOS pulls decisively ahead in the tens-of-thousands range. Not this year's problem, but the right direction.

Clerk's Next.js SDK is the stronger developer experience and would have been the faster migration. That was judged the lesser consideration.

Stiko will **not** use WorkOS Organizations. Stiko already has its own tenancy model in `projects`, `portals`, `participants` and `project_members`. Buying a second one would create two sources of truth about who can see what — the exact thing `lib/access.ts` exists to prevent.

## What WorkOS fixes, and what it does not

Mapping against the seven findings from the 2026-08-27 audit:

| # | Finding | Fixed by WorkOS? |
|---|---|---|
| 2 | Signup accepts any password server-side | **Yes** — WorkOS enforces password policy server-side |
| 3 | Inconsistent email casing | **Yes**, as a side effect of the migration normalising to lowercase |
| 4 | No rate limiting | **Partly** — auth endpoints only. Stiko's own API routes remain unprotected |
| 6 | Sessions cannot be revoked | **Yes** — server-side sessions, revocable |
| 7 | No email verification | **Yes** |
| 1 | `app/api/snapshots/route.ts` accepts uploads from anyone | **No** — Stiko's own middleware and route |
| 5 | Addressed invites are bearer tokens | **No** — Stiko's own authorization logic |

**Findings 1 and 5 are in scope for this work.** No provider fixes them, and both become materially more dangerous the moment strangers have accounts. Finding 4's residual — rate limiting on Stiko's own API routes — is explicitly deferred again and noted under Out of scope.

## Architecture

### Identity mapping

`users.id` is the spine of the schema. Roughly twenty tables carry a foreign key to it, including `participants`, `comments`, `verdicts`, `notifications`, `part_colors` and `project_members`.

**The local `users` row stays the identity of record.** WorkOS becomes the authenticator, not the source of user identity. A new nullable-then-backfilled column links the two:

```sql
-- lib/migrations/010-workos-auth.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS workos_user_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_workos_user_id_key
  ON users (workos_user_id) WHERE workos_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
  ON users (lower(email));
```

The `lower(email)` unique index is what permanently closes finding 3. It will fail to build if near-duplicate accounts already exist, which is the desired behaviour — that is a data problem to resolve deliberately, not to paper over.

A single resolver maps a WorkOS session to a local user id. Everything downstream — `lib/access.ts`, every route handler, every query — continues to work with `users.id` and is untouched:

```ts
// lib/auth.ts — replaces the NextAuth export surface
export async function auth(): Promise<{ user: { id: string; email: string } } | null>
```

Keeping the exported name and shape means route handlers calling `await auth()` do not change. This is the single most important decision for containing the blast radius.

### Session strategy

WorkOS sessions replace NextAuth JWTs. Cutover invalidates every existing session, so all current users are signed out once. At the present user count this is a non-event; it is called out because it is the kind of thing that is unpleasant to discover rather than to be told.

`sessions` and `verification_tokens` tables become dead once the migration completes. They are left in place — dropping them is cleanup that adds rollback risk for no benefit.

### The redirect problem

This is the hardest part of the migration and the most likely source of bugs.

Today every sign-in is same-page: `signIn('credentials', { redirect: false })` followed by `router.push(callbackUrl)`. Nothing leaves the tab, so intent cannot be lost. With WorkOS, Google sign-in becomes an external round trip, and **every flow carrying intent must survive a redirect through a third party**.

This is Bug 1 from the redesign spec — "signup discards the invitation" — with a longer fuse. The invite token must travel in WorkOS's `state` parameter and be reattached on return to the callback route.

A consequence worth stating plainly: **Google sign-in cannot be in-place.** OAuth always leaves the page. Screen `2a` keeps its embedded email+password form via AuthKit's headless User Management APIs, but a "Continue with Google" button on that same card round-trips. Returning from Google must land the user on the package's first file, exactly as `2a` requires — never the dashboard.

## Routing

### Root route

Today `/` is the authenticated app home and `middleware.ts` bounces logged-out visitors to `/login?callbackUrl=/`. A stranger's first impression of stiko.design is a bare sign-in form.

`/` becomes conditional: **marketing landing when logged out, packages home when logged in.** No routes move, no internal links change, and middleware stops forcing `/` to login. The cost is that `/` cannot be fully static, since it checks the session.

The landing page's **content and design are out of scope for this spec** — see Out of scope. This work ships a structural stub at the correct route with the correct session behaviour.

### Destinations

| Situation | Destination |
|---|---|
| Logged out at `/` | Marketing landing (stub) |
| Logged in at `/` | Packages home, unchanged |
| Sign in, no `callbackUrl` | `/` packages home |
| Sign in from an invite | Package's first file — never the dashboard, per spec `2a` |
| Sign in from a public `/portal/[id]` | Back to that same package view |
| Signed in, no access | Spec screen `3o`, naming the signed-in email |
| Invite expired or revoked | Spec screen `3n` |

The public paths in `middleware.ts` are unchanged in principle: `/portal/[id]` stays publicly viewable, `/invite/[token]` stays public. The load-bearing trailing slash on `'/api/invite/'` — which prevents `/api/invites` management endpoints from being opened to the world — must be preserved verbatim through the rewrite. It is already documented in the file and that comment must survive.

## Google SSO

Appears in three places: `/login`, `/signup`, and the auth panel of `/invite/[token]` (`2a`).

**Account linking policy: link on verified email match.** If `bob@co.com` registered with a password and later signs in with Google using the same address, they reach the same account. Google's email is verified, so this is safe, and it avoids a duplicate-account mess that is painful to unpick later.

This policy is why email normalisation is not optional. Addresses are lowercased on the way into WorkOS and the `lower(email)` unique index enforces it thereafter.

Screen `3o` already anticipates the failure mode this creates — a user signed in with the wrong Google identity — and names the signed-in address rather than showing a generic 403. That behaviour is required, not decorative.

## Email verification

- **Self-serve signups** at stiko.design must verify their address before accessing any package.
- **Invited reviewers are exempt.** Arriving via a tokenised link sent to their address already proves they control it. Adding an email round trip here would damage the flow the redesign deliberately made frictionless, and would buy nothing.
- **Google users** are verified by Google.

## MFA

Enabled in WorkOS, optional for users. This is a dashboard toggle and therefore reversible; there is no reason to add friction during a rollout. Revisit when an enterprise customer asks.

## The two gaps WorkOS does not close

### Finding 1 — open snapshot upload

`app/api/snapshots/route.ts` is listed public in `middleware.ts` *and* has no `auth()` call. Base64 data URL straight to R2, no size cap, and a content-type regex of `[\w/+-]+` that accepts `text/html`. Add an `auth()` call, a size cap, and an allow-list of image MIME types.

### Finding 5 — invites are bearer tokens

`app/api/invite/[token]/route.ts` POST never compares `invite.email` to the session's email, so whoever opens the link first joins the package. Compare them, and reject with screen `3o` when they differ.

Deliberately preserved: **share links remain exempt by design.** They are a different feature with different intent, and this change must not silently close them.

## Migration and rollback

There is no staging environment. Production is the only environment, so every phase must be independently reversible.

**Phase 1 — additive schema.** Apply `010-workos-auth.sql`. No behaviour change. Reversible by dropping the column and indexes. Note that `lower(email)` index creation will fail loudly if duplicate-by-case accounts exist; resolve that data before proceeding.

**Phase 2 — import users.** Idempotent script reading `users` and creating WorkOS users with their existing bcrypt hashes, writing `workos_user_id` back. WorkOS accepts bcrypt on user creation and via the Update User API, so **no user is forced to reset their password**. Re-runnable; no user-visible change.

**Phase 3 — cutover behind an environment flag.** `AUTH_PROVIDER` takes `workos` or `nextauth` and defaults to `nextauth`. The NextAuth code path stays in the repository, and `password_hash` is **not** dropped from `users`. This flag is the rollback: if the cutover misbehaves, set it back to `nextauth` and redeploy — existing passwords still work because the hashes never left. Rollback costs one environment-variable change and a redeploy, with no database work.

**Phase 4 — cleanup.** Remove the NextAuth path, the `AUTH_PROVIDER` flag and `password_hash` only after the new path has run for at least one full week of normal use with no auth incidents. Explicitly a separate change on a separate day.

Migrations in this project are applied manually and have been forgotten twice. Confirm `schema_migrations` before and after each phase.

## Out of scope

- **Marketing landing page content and design.** Routing and session behaviour only. The redesign spec also excluded it (`stiko_handoff/README.md`), so this remains a genuine open gap — it needs its own brainstorm.
- **Rate limiting on Stiko's own API routes.** WorkOS covers auth endpoints. The residual is deferred again, knowingly.
- **SAML, SCIM and audit logs.** Available on WorkOS and the reason it was chosen, but not configured until a customer asks. No speculative work.
- **WorkOS Organizations.** Stiko keeps its own tenancy model.
- **Mobile and responsive layouts.** Out of scope in the redesign spec and unchanged here.

## Risks

1. **The redirect round trip loses invite intent.** Highest-likelihood bug in this work. The invite flow is the highest-volume path in the product and its failure mode is silent — the user simply lands somewhere wrong. Needs explicit test coverage for the Google path, not just the password path.
2. **`lower(email)` index fails on existing duplicates.** Surfaces in Phase 1, before anything is user-visible. Good place for it to fail.
3. **`auth()` shape drift.** If the replacement's return shape diverges from NextAuth's, failures will be scattered across many route handlers rather than concentrated. Keeping the exported signature identical is the mitigation.
4. **Forgot-password root cause is still unconfirmed.** See below.

## Unresolved: the current forgot-password symptom

The one auth problem observed in practice. Three candidate causes, not yet distinguished, and this should be diagnosed rather than assumed fixed by the migration:

1. **Email casing.** `lib/auth.ts:26` matches `WHERE email = ${email}` exactly; `app/api/auth/forgot-password/route.ts:17` matches `lower(email)`. The reset genuinely succeeds and the subsequent sign-in still fails. Reads to a user as "password recovery is broken." **Leading suspect**, and closed by this migration.
2. **`EMAIL_FROM` defaults to `noreply@stiko.app`** (`lib/email.ts:31`) — a different domain from stiko.design. If Resend has stiko.design verified and not stiko.app, sends are rejected or land in spam.
3. **Silent failure.** `forgot-password/route.ts:47` discards `sendEmail`'s `delivered` flag and returns `{ok: true}` regardless. The invite path checks it and surfaces it to the UI (`api/participants/route.ts:207`), which is why broken invites would have been noticed and broken resets would not.

Cause 2 is independent of this migration and worth checking immediately. Cause 3 is worth fixing regardless, because without it there is no way to know how often this happens.
