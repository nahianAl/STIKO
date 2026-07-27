# Frontend redesign — implementing `stiko_handoff/`

Executing the full 32-screen handoff autonomously. This doc records scope, the
decisions taken without asking, and progress.

## Where the spec outruns the codebase

The handoff is written as if the product already has infrastructure it does not.
Everything below has to be built before the screens that depend on it work:

| Spec needs | Exists today | Where it's required |
|---|---|---|
| Version "what changed" note | no column | `2e`, `2g`, `01` — required field |
| Draft vs published version | no state | `2e` (`Save as draft`), version rail |
| Reviewer **verdicts** | nothing | `01` — status is *derived* from these |
| Notifications | nothing at all | `3i`, `3k`, gap #11 |
| Password reset | nothing at all | `3c`, `3d` |
| Email delivery | no provider | invites, notifications, reset |
| Tags on packages | no column | `01`, `2g`, `4a` |
| Archive | no state | `3l` danger card |
| Project members / Coordinator | only `projects.owner_id` | `01` two-tier access, `4a` |
| View tracking (opened / viewed / commented) | nothing | `4b` "Waiting on" |

## Decisions taken without asking

1. **Email** — add `lib/email.ts` with a pluggable transport. No provider
   credentials exist, so the default transport logs the message and returns
   success; if `RESEND_API_KEY` is present it posts to Resend's HTTP API (no new
   npm dependency, just `fetch`). Invitations, notifications and password resets
   all go through this one seam, so wiring a real provider later is a one-file
   change. **Nothing silently pretends to have sent mail** — the dev transport
   logs loudly and the UI never claims delivery it can't verify.

2. **Verdicts — implemented as specced**, not the manual-status fallback. The
   README flags this as an open question; derived status is the version the rest
   of the spec is built on ("Needs you", "3 of 4 approved", `4b`), and the
   fallback would undermine all of it. New `verdicts` table, status computed in
   `lib/status.ts`.

   The handoff specifies derived status but **never designs the control that
   records a verdict** — no screen has an approve / request-changes button. I'm
   adding one to the review view's comments panel header, built from the existing
   design-system primitives.

3. **Migrations** — no migration tool in the project, so schema changes land as
   numbered additive files in `lib/migrations/` plus an updated `lib/schema.sql`.
   All additive; nothing drops or rewrites existing data.

4. **Terminology** — `Portal` stays everywhere in code, routes and filenames;
   only rendered strings say "Package". Per `01`, and already applied to
   `app/project/[id]/page.tsx`.

5. **Tests** — the project runs `node --test scripts/tests/*.mjs` (pure logic, no
   DOM). Pure-logic modules get tests: disclosure thresholds, status derivation,
   tag colour hashing, filename-prefix derivation. Presentation does not — no
   React testing library is installed and adding one is out of scope.

6. **Invite expiry** — spec says 14 days, code says 7. Going with the spec (14),
   since `3n` renders that number as user-facing copy.

## Order

Following the handoff's own suggested sequence: foundations → the two bugs →
auth/invite → review view → home/project → new package + drawer → people &
access → settings/states.
