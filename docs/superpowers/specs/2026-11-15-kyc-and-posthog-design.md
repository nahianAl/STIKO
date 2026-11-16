# KYC onboarding + PostHog tracking (Phase 1) — design

**Date:** 2026-11-15
**Status:** design approved, not implemented
**Branch:** `feature/kyc-posthog`
**Source documents (from the marketing co-founder, not in the repo):**
`Stiko CRM & Data Architecture_ Engineering Plan.md` ("the plan") and
`stiko-kyc-business-types-v3.xlsx` ("the sheet"). The sheet's Business Types tab is reproduced in
the Appendix so this spec stands alone.

## 1. Scope

This is **Phase 1 of the plan plus its UTM section**: a required "tell us about your work" step,
PostHog identity, the 14 P0 events, Stripe-driven billing events, and first/last-touch UTM capture
on both the Webflow marketing site and the app.

**KYC means a marketing questionnaire, not identity verification.** No ID documents, selfies or
registry lookups. (The plan's own open question on identity verification is answered: dropped.)

**Out of scope, each a later project with its own spec:** HubSpot sync and the Tier A
high-value handler (plan Phase 2), Slack alerts and the morning brief, lifecycle email via PostHog
Workflows (Phase 3), GA4 Measurement Protocol, ad-platform conversion APIs, progressive-profiling
questions after first upload, P1/P2 events, PQL alerts, track reclassification, a real teams /
seats feature, and a free trial.

### Decisions taken during brainstorming

| Question | Decision |
|---|---|
| What is "KYC-KYB"? | Onboarding profile for segmentation |
| Who sees it | **Everyone**, owners and invited reviewers |
| Skippable? | **No, required** |
| Existing accounts | Asked on their next signed-in visit |
| Scope | Plan Phase 1 + UTM capture |
| Workspace | One hidden workspace per account, new `workspaces` table |
| Trial | None. KPI is **free-to-paid**; `trial_started` fires only if Stripe ever reports `trialing` |
| PostHog region | **US Cloud** (ICP is North America; a project cannot change region) |
| Cookie consent | **Banner for EU/EEA/UK/CH visitors only**; everyone else tracked with a privacy-policy notice |

## 2. How the plan maps onto Stiko

Three of the plan's assumptions do not hold in Stiko, and this design adapts to each:

1. **No workspaces exist.** Tenancy is projects / portals / participants. → A `workspaces` table,
   one row per account, invisible in the UI. A future teams feature adds members to it; analytics
   IDs never change.
2. **No trial exists.** Checkout goes straight to paid. → Free-to-paid is the day-one KPI.
3. **No anonymous reviewers exist.** Viewing a package requires an account, so `/invite/[token]`
   already *is* the reviewer signup prompt. → The plan's `reviewer_id` is unnecessary: PostHog's
   anonymous `distinct_id` merges into the account on `identify()`, which is the same merge.
   Stiko's invite tokens are random and DB-backed, so the plan's "signed review-link tokens" need
   no change — the server resolves the inviter, and a token cannot be forged.

The tracking plan spreadsheet (35 events, the 11-step Funnel Tracker) was **not** supplied. The
14 P0 events below follow the plan's own definitions; reconcile with the tracking plan if it
arrives.

## 3. The KYC step (`/welcome`)

### 3.1 Flow

Signed-in visitor without a completed profile → any gated page → redirect to
`/welcome?callbackUrl=<where they were going>` → five questions → submit → `callbackUrl`
(validated with the existing `safeCallbackUrl`). Owners land on the dashboard; invited reviewers
land on the invite they were accepting. The invite token must survive this hop — it rides in
`callbackUrl` exactly as it already does through `/signup` and `/verify-email`.

Order for a new self-serve signup: `/signup` → `/verify-email` → `/welcome` → dashboard.
Order for an invited reviewer: `/invite/[token]` → `/signup?callbackUrl=/invite/…` →
`/verify-email` → `/welcome` → `/invite/[token]` (accepts) → the package.

### 3.2 Questions (all required)

Taken from the sheet's KYC Fields tab, fields 1, 2, 3, 4 and 6, with the plan's company-size split.

| # | Question as shown | Input | Stored value |
|---|---|---|---|
| 1 | What best describes your work? | 4 tiles | `pillar`: `ID` `PD` `AC` `GV` |
| 2 | Which best describes your business? | Single select, only the chosen pillar's 10 types + "Other (please specify)", each with its helper text | `segment_id` e.g. `PD-07`; `xx-99` also stores `business_type_other` (free text, ≤120 chars, required when Other is picked) |
| 3 | Who do you design or build for? | Single select | `client_model`: `clients` `own` `both` |
| 4 | How many people work at your company? | Single select | `company_size_band`: `just_me` `2-4` `5-9` `10-24` `25-49` `50-99` `100-249` `250+` |
| 6 | What is your role? | Single select | `role`: `owner` `design_lead` `designer` `engineer` `architect` `interior_designer` `project_manager` `operations` `procurement` `marketing` `other` |

Labels: "Clients (we are a service provider)", "Our own products or projects", "Both"; sizes
"Just me", "2-4" …; roles as in the sheet ("Owner / Principal / Founder", "Design lead / Creative
director", …).

Below the questions: an **unticked** checkbox, "Send me product news and tips from stiko" (exact
CASL wording to be confirmed by a lawyer). Account emails go to everyone; this governs promotional
mail only.

Changing the pillar clears the business type. Submit is disabled until all five are answered.

**Captured automatically, not asked:**
- `country`, `region` from Vercel's `x-vercel-ip-country` / `x-vercel-ip-country-region`
  (ISO codes; null when absent, e.g. locally).
- `is_business_email`: false for a fixed list of free-mail domains (gmail, googlemail, outlook,
  hotmail, live, msn, icloud, me, mac, yahoo, aol, proton, protonmail, gmx, zoho, yandex, mail.com,
  and similar), true otherwise.
- `track` from company size: `just_me` → `prosumer`; `2-4` → `small_team`;
  `5-9`/`10-24`/`25-49` → `mid_team`; `50-99`/`100-249`/`250+` → `large_team`.

### 3.3 The catalog

One code module, `lib/kyc/catalog.ts`, holds pillars, business types (ID, label, helper text,
ICP priority), client models, size bands, roles and the size→track map, keyed by ID. **IDs are
stored; labels are display only** and may be reworded freely. The module is a pure data file with
no `@/` imports, so `node --test` can load it.

### 3.4 The gate

Middleware decides, for **page** requests only (never `/api/*`, never public paths, never
`/welcome` itself, never static assets):

1. Not signed in → existing behaviour.
2. Signed in, and a valid signed `stiko_profile` cookie names this user → continue.
3. Otherwise → one Neon query (edge-compatible HTTP driver) for `users.profile_completed_at`. If
   set → re-issue the cookie and continue. If null → redirect to `/welcome?callbackUrl=…`.

The cookie is an HMAC (secret `PROFILE_COOKIE_SECRET`) over the user ID, httpOnly, 1 year, set by
the `/welcome` submit. In practice the DB is checked about once per browser. The cookie is a
cache, not an authorization: bypassing the gate only skips a marketing form, so a forged or stale
cookie is harmless.

The redirect rule is a pure function (`lib/kyc/gate.ts`) beside `lib/routeAccess.ts` so it is
unit-tested like the existing public-path rules, and both auth providers share it.

**Kill switch:** `KYC_GATE=off` disables step 3's redirect without a code revert.

### 3.5 Submit

`POST /api/welcome` (signed-in). Validates every value against the catalog (unknown IDs → 400).
In one SQL transaction: upsert the user's workspace with the firm answers + computed fields,
set the user's `role`, consent fields and `profile_completed_at`. Then sets the cookie, records
`company_profile_completed`, and returns `{ redirectPath }`. Idempotent: resubmitting overwrites
answers and fires the event again with `resubmitted: true`.

## 4. Data model — migration `019-kyc-analytics.sql`

**`workspaces`**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Same ID style as other tables |
| `owner_user_id` | TEXT UNIQUE NOT NULL → `users.id` ON DELETE CASCADE | One per account for now |
| `pillar`, `segment_id`, `business_type_other`, `client_model`, `company_size_band`, `track` | TEXT | Null until KYC |
| `country`, `region` | TEXT | From the IP headers at KYC |
| `is_business_email` | BOOLEAN | From the owner's email |
| `utm_first` | JSONB | Creator's first touch, copied at KYC |
| `activated_at` | TIMESTAMPTZ | First external `review_link_opened` within 7 days of workspace creation |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |

A workspace is created by `ensureWorkspace(userId)` — at signup for new accounts, lazily (first
event or KYC submit) for existing ones. So `signup_completed` already carries a `workspace_id`.

**`users` — new columns** (each also mirrored as `ALTER TABLE users ADD COLUMN IF NOT EXISTS` in
`lib/schema.sql`; see the schema.sql-before-migrations trap in project memory):
`role`, `profile_completed_at`, `signup_source` (`reviewer_invite` | `direct`),
`inviter_workspace_id`, `invite_id`, `is_business_email`, `marketing_consent` (bool),
`marketing_consent_at`, `marketing_consent_method`, `analytics_consent` (`granted` | `denied` |
null = not asked), `utm_first` JSONB, `utm_last` JSONB, `click_ids` JSONB (`gclid`, `fbclid`,
`ttclid`, `fbc`, `fbp`, `ga`).

**`analytics_outbox`**

| Column | Type |
|---|---|
| `id` | BIGSERIAL PK |
| `event` | TEXT NOT NULL |
| `distinct_id` | TEXT NOT NULL |
| `properties` | JSONB NOT NULL |
| `created_at` | TIMESTAMPTZ DEFAULT now() |
| `sent_at` | TIMESTAMPTZ |
| `attempts` | INT DEFAULT 0 |
| `last_error` | TEXT |

Partial index on `created_at WHERE sent_at IS NULL`. Sent rows are deleted after 30 days by the
existing daily cron.

**Applied to production before the deploy that reads it**, and checked in `schema_migrations`.

## 5. PostHog

### 5.1 Browser (app)

- `posthog-js`, initialised in `app/providers.tsx` only when `NEXT_PUBLIC_POSTHOG_KEY` is set.
- `api_host: '/ingest'`, `ui_host: 'https://us.posthog.com'`. `next.config` rewrites `/ingest/*`
  → `https://us.i.posthog.com/*` and `/ingest/static/*` → `https://us-assets.i.posthog.com/static/*`.
  `/ingest` is added to the middleware matcher exclusion (it must never 307 to `/login`).
- `cross_subdomain_cookie: true` so `.stiko.design` is shared with the marketing site.
- `autocapture: false`. `$pageview` sent manually on App Router route changes.
- **Session replay on `/welcome` only**, all inputs masked. Never on the dashboard or a package
  view — those pages show customers' confidential drawings and models.
- After sign-in: `identify(user_id)` and `group('workspace', workspace_id)`; on sign-out `reset()`.
- Client events: `reviewer_signup_prompt_shown` (invite page rendered to a signed-out visitor) and
  `reviewer_signup_prompt_clicked` (its Create account button).

### 5.2 Server — outbox, no SDK

`lib/analytics/` exposes one call, `track(event, { userId | anonymousId, properties })`:

1. Builds standard properties: `user_id`, `workspace_id`, `segment_id`, `track`
   (`'unknown'` for both until KYC), plus `$groups: { workspace: workspace_id }`.
2. Inserts an outbox row.
3. Schedules a flush with `waitUntil` (`@vercel/functions`, new dependency) — runs after the
   response is sent.
4. A flush sends every unsent row (oldest first, capped at 100) to PostHog's `/batch` endpoint with
   `fetch`, marks them sent, or increments `attempts` / `last_error`. Rows with `attempts >= 20`
   are left for inspection. The daily cron also flushes, as a backstop.

**Analytics never fails, blocks or slows a user action.** `track` catches and logs every error,
including a failed outbox insert. With no `POSTHOG_PROJECT_KEY` server env, `track` is a no-op.

**Consent on the server:** a user whose `analytics_consent = 'denied'` gets no server events. An
anonymous server event (an invite opened while signed out) needs the visitor's PostHog
`distinct_id`, read from the `ph_<key>_posthog` cookie; no cookie (declined, blocked, or first
request) → no event.

**Never sent to PostHog:** file names, project or package names, comment text, email addresses,
person names. Properties are IDs, codes, file extensions, sizes and counts.

### 5.3 The 14 P0 events

| Event | Fired from | Key properties |
|---|---|---|
| `signup_completed` | Account creation (both providers' signup paths, one shared function) | `signup_source`, `inviter_workspace_id`, `invite_id`, `is_business_email`, first + last touch UTMs |
| `email_verified` | WorkOS verify-email route | |
| `company_profile_completed` | `POST /api/welcome` | `pillar`, `segment_id`, `client_model`, `company_size_band`, `role`, `country`, `region`, `track`, `marketing_consent`, `resubmitted` |
| `project_created` | Project create route | `project_id` |
| `file_uploaded` | Upload completion | `file_id`, `extension`, `size_bytes` |
| `file_processed` | Conversion webhook / CAD callback success | `file_id`, `extension`, `converter` |
| `file_upload_failed` | Rejected-uploads route, conversion failure | `extension`, `reason_code` |
| `sent_for_review` | Invite created / share link created | `invite_id`, `kind` (`invite` \| `share_link`) |
| `review_link_opened` | `GET /api/invite/[token]` | `invite_id`, `inviter_workspace_id`, `signed_in` |
| `reviewer_signup_prompt_shown` | Client, invite page | `invite_id` |
| `reviewer_signup_prompt_clicked` | Client, invite page | `invite_id` |
| `reviewer_signup_completed` | Account creation when `signup_source = reviewer_invite` | `invite_id`, `inviter_workspace_id` |
| `trial_started` | Stripe webhook, subscription status `trialing` | `plan` |
| `subscription_started` | Stripe webhook, first transition to `active` | `plan`, `interval`, `amount` |

`review_link_opened` also sets the inviter workspace's `activated_at` when it is the first open
by someone other than the inviter within 7 days of the workspace's `created_at`.

Billing events come **only** from the Stripe webhook, never the browser, and are idempotent on
the Stripe event ID.

### 5.4 Person and group properties

- Person (`$set`): `role`, `signup_source`, `inviter_workspace_id`, `marketing_consent`,
  `is_business_email`. `$set_once`: first-touch UTMs.
- Group `workspace` (`$groupidentify`): `pillar`, `segment_id`, `client_model`,
  `company_size_band`, `track`, `country`, `region`, `is_business_email`, `activated_at`,
  first-touch UTMs. Sent on KYC submit and when `activated_at` is set.

Group breakdowns need PostHog's **Group Analytics add-on** (paid; price to be checked before it is
enabled). Without it events still flow, but funnels break down by person only.

## 6. UTM capture

A small, dependency-free script, `public/stiko-attribution.js`, runs on every page of both sites.
The app serves it; Webflow's site-wide custom code loads it from
`https://app.stiko.design/stiko-attribution.js`, so there is one copy. It must be added to the
middleware matcher exclusion (like `icon.svg`), and `/api/geo` to `PUBLIC_PATHS`, or a signed-out
visitor gets a 307 to `/login` instead of the script.

- If the URL has any of `utm_source` `utm_medium` `utm_campaign` `utm_content` `utm_term`
  `gclid` `fbclid` `ttclid`: write `stiko_lt` (last touch) and, if absent, `stiko_ft` (first
  touch — never overwritten). Each is JSON: those fields + `landing_page`, `referrer`, `ts`.
- Cookies: `Domain=.stiko.design`, `Path=/`, `Max-Age` 90 days, `SameSite=Lax`, `Secure`.
- Values are lowercased and each capped at 200 chars; the cookie is capped at 2 KB.
- Does nothing until consent is granted for EU/UK visitors (§7).

At signup the **server reads these cookies directly** — same domain, so no hidden form fields, and
nothing is lost on the WorkOS round trip. It stores `utm_first`/`utm_last` on the user, and
`_fbc`, `_fbp`, `_ga` into `click_ids` if present (so later GA4 and ad-conversion phases need no
backfill). KYC copies the creator's `utm_first` onto the workspace.

**Rule:** a signup arriving through an invite or share link has `signup_source = reviewer_invite`
even when it carries UTMs, so paid ads are not credited with signups the review loop produced.

## 7. EU/UK consent banner

- `GET /api/geo` (public, no auth, `Cache-Control: private, no-store`) returns
  `{ consentRequired: boolean }` from `x-vercel-ip-country` ∈ EU-27 + EEA (IS, LI, NO) + GB + CH.
  Both sites call it; Webflow cannot read Vercel's header itself.
- Consent required and no choice yet → a small bottom banner, "We use analytics cookies to improve
  stiko", **Accept** / **Decline**, link to the privacy policy. Until Accept: PostHog initialises
  with `persistence: 'memory'` and `opt_out_capturing_by_default: true`, and no `stiko_ft`/`stiko_lt`
  are written.
- The choice is a `stiko_consent=granted|denied` cookie on `.stiko.design`, 12 months, so one
  answer covers both sites. At signup and KYC the server copies it to `users.analytics_consent`.
- Consent not required → tracked by default; the privacy policy discloses it.
- `/api/geo` failing → treat as consent required (fail closed).

## 8. Privacy policy

Published at **www.stiko.design/privacy** (Webflow), linked from the app footer, `/welcome`,
`/signup` and the banner. Drafted by Claude for **lawyer review before ads launch**, together with
the CASL consent wording. Lists the processors: WorkOS, Stripe, PostHog (US), Resend, AWS S3,
Neon, Vercel, CloudConvert, Atlas Cloud, and the CAD-converter host. The page also unblocks the
pending Google sign-in setup, which needs a privacy URL on the homepage domain.

## 9. Testing

`node --test` units, following the repo's import rules (no `@/` in tested lib modules,
`import type` for `lib/queries`):

- Catalog integrity: unique IDs; every pillar has exactly 10 types + one `-99`; every size band
  maps to a track; every role/client model has a label.
- `trackForSize`, `isBusinessEmail`.
- Attribution: first touch never overwritten, last touch always updated, lowercasing, caps,
  `reviewer_invite` override.
- Gate decision: public paths, `/api`, `/welcome`, valid/invalid/other-user cookie, `KYC_GATE=off`.
- `/api/welcome` validation: unknown IDs, Other without text, pillar/type mismatch.
- Outbox: standard properties, consent-denied suppression, flush marks sent, failure increments
  attempts, a thrown error never escapes `track`.
- PGlite harness: migration 019 applies cleanly on top of `schema.sql` (twice, to prove
  idempotence); `/api/welcome` writes workspace + user in one transaction.

**Browser acceptance** (real build, production-like): fresh account A signs up → verifies →
`/welcome` → creates project → uploads → invites account B. B opens the invite signed out
(prompt shown/clicked) → signs up → verifies → `/welcome` → lands on the package. In PostHog:
both persons identified, both workspaces grouped with correct `segment_id` and `track`, A's
workspace `activated_at` set, every event in §5.3 except billing present. Plus: an EU-geolocated
request shows the banner and sends nothing before Accept; Webflow → app keeps one `distinct_id`
and the UTM cookie. `subscription_started` needs one real purchase (live Stripe only, no staging)
refunded afterwards — or is confirmed on the first real customer.

## 10. Rollout and rollback

1. Feature branch `feature/kyc-posthog`; the user merges and pushes (one paste block).
2. Apply migration 019 to production **first**; confirm in `schema_migrations`.
3. Vercel env: `NEXT_PUBLIC_POSTHOG_KEY`, `POSTHOG_PROJECT_KEY`, `PROFILE_COOKIE_SECRET`.
4. Deploy. Then Webflow: paste the attribution script + PostHog snippet (autocapture **on** for the
   marketing site, `api_host: 'https://app.stiko.design/ingest'`) + banner, publish.
5. Walk the acceptance test.

**Rollback, no code revert needed:** `KYC_GATE=off` stops the redirect; removing the PostHog keys
stops all analytics. Both take a redeploy. The migration is additive and is left in place.

**User-side setup:** PostHog account on US Cloud, Group Analytics add-on, keys into Vercel.

## 11. Open items

- The tracking plan spreadsheet (event spec + Funnel Tracker) — not yet received.
- Lawyer review: privacy policy, CASL consent wording.
- Group Analytics add-on price — check before enabling.

## Appendix — business types (sheet v3, Business Types tab)

Pillar IDs: `ID` Industrial Design & Concept Development · `PD` Product Development &
Manufacturing · `AC` Architecture, Interior & Construction · `GV` Graphic Design, Video &
Photography. ICP priority shown in brackets.

**Industrial Design & Concept Development** (Priority)

| ID | Label | Helper text |
|---|---|---|
| ID-01 | Industrial design studio or agency | We design products for client brands |
| ID-02 | Product design and engineering firm | We take client products from concept to production-ready CAD |
| ID-03 | Consumer electronics company | Audio, wearables, smart home, accessories, small appliances |
| ID-04 | Furniture, lighting or home goods brand | Residential or contract furniture, lighting, housewares, decor |
| ID-05 | Sporting goods, outdoor or toy company | Fitness, outdoor gear, bikes, toys, juvenile products |
| ID-06 | Medical device company | Diagnostic, surgical, patient-facing or wellness devices |
| ID-07 | Vehicle, e-bike or mobility company | Vehicle accessories and interiors, e-bikes, scooters, marine, RV |
| ID-08 | Tools or industrial products company | Power tools, equipment housings, robotics, cleantech hardware |
| ID-09 | Hardware startup | We are designing our first physical product |
| ID-10 | 3D rendering or product visualization studio | We create product renders and animations for brands |
| ID-99 | Other (please specify) | Tell us what your business does |

**Product Development & Manufacturing** (Priority)

| ID | Label | Helper text |
|---|---|---|
| PD-01 | Product development firm | We develop products for clients, from concept to manufacturing |
| PD-02 | Engineering or DFM consultancy | Mechanical design, DFM/DFA, design reviews for clients |
| PD-03 | Machinery or equipment manufacturer | Industrial, process, packaging, agricultural or food equipment |
| PD-04 | Consumer product manufacturer | We design and make our own consumer products |
| PD-05 | Medical device manufacturer | We manufacture regulated medical devices |
| PD-06 | Automotive or aerospace parts supplier | Tier 1 / Tier 2 parts, aerospace components, specialty vehicles |
| PD-07 | Machine shop or metal fabricator | CNC machining, sheet metal, welding, fabrication |
| PD-08 | Injection moulding or tooling company | Injection moulding, mould making, die casting |
| PD-09 | Automation or custom machine builder | Robotic cells, special-purpose machines, fixtures and tooling |
| PD-10 | Hardware startup moving into production | We are working with factories to manufacture our product |
| PD-99 | Other (please specify) | Tell us what your business does |

**Architecture, Interior & Construction** (Priority)

| ID | Label | Helper text |
|---|---|---|
| AC-01 | Residential architecture firm | Custom homes, renovations, additions |
| AC-02 | Commercial architecture firm | Office, multi-family, mixed-use, hospitality, retail |
| AC-03 | Residential interior design studio | Homes, condos, kitchens and baths |
| AC-04 | Commercial interior design firm | Offices, hotels, restaurants, retail spaces |
| AC-05 | Design-build company | We design and build projects for our clients |
| AC-06 | General contractor or construction manager | Commercial and institutional construction |
| AC-07 | Home builder or renovation company | Custom homes, renovations, remodelling |
| AC-08 | Millwork, cabinetry or custom fabrication shop | Architectural millwork, cabinets, fixtures, steel, glass |
| AC-09 | Structural or MEP engineering firm | Structural, mechanical, electrical, plumbing engineering |
| AC-10 | Architectural rendering or 3D visualization studio | Renders, walkthroughs and 3D presentations for projects |
| AC-99 | Other (please specify) | Tell us what your business does |

**Graphic Design, Video & Photography** (Secondary)

| ID | Label | Helper text |
|---|---|---|
| GV-01 | Branding or graphic design agency | Brand identity, graphic design, print and digital design |
| GV-02 | Advertising agency | Campaign creative across print, digital and video |
| GV-03 | Video production company | Commercial, corporate and branded video |
| GV-04 | Post-production or editing studio | Editing, colour grading, finishing |
| GV-05 | Animation or motion graphics studio | 2D/3D animation, motion design, explainer videos |
| GV-06 | Photography studio | Product, lifestyle, e-commerce or commercial photography |
| GV-07 | Packaging design agency | Packaging graphics, labels, dielines |
| GV-08 | Social media or content agency | Social content and campaigns at volume |
| GV-09 | Web and digital design agency | Websites, landing pages, digital campaigns |
| GV-10 | 3D or AR studio for e-commerce | 3D product models, configurators, AR experiences |
| GV-99 | Other (please specify) | Tell us what your business does |
