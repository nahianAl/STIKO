# KYC v2: one-page onboarding, coded answers, answer history

Date: 2026-11-19 · Branch: `feature/kyc-v2`
Source: the marketing co-founder's doc, saved verbatim as
[`2026-11-19-kyc-v2-source.md`](2026-11-19-kyc-v2-source.md). **That file is the source of truth
for every question's wording, option list, helper text and code.** This spec says how to build it and
records the decisions made where the doc is silent or conflicts with the codebase.

Supersedes the question set and layout of `2026-11-15-kyc-and-posthog-design.md` and
`2026-11-16-welcome-wizard-design.md`. Everything else in those specs (consent, UTMs, outbox,
PostHog proxy, gate cookie) still stands.

## 1. Goal

From day 1 of launch, every account has structured, comparable data: who the company is
(industry, markets, size, review team, client model, website), who each person is (role,
seniority), and how they arrived (signed up themselves vs invited, by whom, from which campaign).
Answers are stored as codes and never overwritten, so lists can change without breaking history.

## 2. Decisions made with the user (2026-11-19)

| # | Decision |
|---|---|
| D1 | **Single page** of 9 fields, as the doc says. Replaces the one-question-per-screen wizard shipped 2026-11-16. |
| D2 | **Invited reviewers answer Role only.** The first time a reviewer creates their own project, they get the company page once, before the project is created. |
| D3 | **Everyone re-does onboarding** on their next visit, owners and reviewers alike. No prefill from v1 answers. v1 answers are kept as history. |
| D4 | Storage approach A: an **append-only `company_profiles` table** (one row per submission) with child tables for the multi-selects, and an append-only `user_roles` table. |

## 3. Decisions made without asking (flag if wrong)

- **Signup types.** `new_workspace` and `invited_reviewer` only. Stiko has no teams, so
  `joined_teammate` is reserved in the type but never written. Backfill from `signup_source`:
  `direct` → `new_workspace`, `reviewer_invite` → `invited_reviewer`.
- **Who gets the full page** (D2 made precise): the full page if the user signed up directly OR owns
  at least one project (trashed included); otherwise Role only. So a co-founder who signed up
  through an invite but has projects gets the full page.
- **Codes.** Where the doc gives explicit codes they are used as given: industry `IND`…`PHO`, `OTH`;
  markets `MK-01`…`MK-30`, `MK-99`; client model `CM-1`…`CM-5`; reviewers `ER-*`; file types
  `FT-<FORMAT>`; size `CS-01`…`CS-08`; review team `RT-01`…`RT-06`. Every other "Other" ends in 99
  (`RL-99`, `FT-99`). Roles get `RL-01`…, one code per unique label across all lists, assigned in
  the catalog. **The role → `role_family` and `seniority` mapping is drafted by engineering from the
  doc's value lists and must be checked by marketing** (it is one table in `lib/kyc/catalog.ts`).
- **"Other" always asks for text.** Picking Other in any field opens a required text box
  (max 120 characters, the existing `OTHER_TEXT_MAX`).
- **File-type support comes from the code, not the doc.** `supported_at_signup` is computed from
  `lib/fileFormats.ts`. The doc's column is wrong in two places: **WEBP and MOV are supported
  today**; **USDZ/USD are not** (the uploader tells people to export GLB).
- **Old wizard parts are deleted**, not kept behind a flag: `lib/kyc/wizard.ts`,
  `components/welcome/LetteredChoices.tsx`, `components/welcome/StepFrame.tsx`, and their tests.
  Rollback is a git revert.
- **`onboarding_step_completed` (the wizard's per-step event) is removed.** A one-page form has no
  steps. `company_profile_completed` stays and carries the new codes.
- **The marketing checkbox is grant-only (never revokes).** It starts unticked for everyone re-asked,
  so ticking it records consent (keeping the first timestamp and method) and leaving it unticked
  changes nothing; unsubscribe is the revoke path. Events report the box as `marketing_checkbox`,
  and the person property `marketing_consent` is only ever `$set` to true.
- **PostHog property names change freely.** PostHog keys are not set in production yet, so no
  dashboards depend on `segment_id`. Events now carry `industry` and `primary_market` instead of
  `segment_id`; `track` stays (it still derives from company size).

## 4. Left out (YAGNI)

- **One company record across workspaces from the same domain.** `company_domain` is stored on
  every profile, so this is a `GROUP BY` later, not a feature now.
- **The every-two-weeks review of Other answers.** A marketing process; the text is stored for it.
- **Process detail** (CNC vs molding etc.). The doc defers it to in-app questions after signup.

## 5. Who sees what

| User | /welcome shows | Gate passes when |
|---|---|---|
| Signed up directly, or owns any project | Full page (9 fields + marketing checkbox) | `users.onboarding_version >= 2` |
| Invited reviewer with no projects | Role only (combined role list) + marketing checkbox | same |
| Reviewer creating their first project | `/new` sends them to `/welcome` (company variant: 8 fields; Role already known) and back | n/a: this is a project-creation check, not the page gate |

**Re-ask mechanism (D3).** The middleware gate today checks `users.profile_completed_at`. It switches
to `users.onboarding_version >= CURRENT_ONBOARDING_VERSION` (constant `2` in `lib/kyc/gate.ts`).
Existing users have `onboarding_version` NULL, so everyone is re-asked.

**Trap: the gate cookie.** The signed `stiko_profile` cookie caches "this person has a profile" for
the middleware. Old cookies would let v1 users skip the re-ask. The HMAC message changes from
`stiko-profile:<subject>` to `stiko-profile:v2:<subject>`, so every old cookie fails verification
and the next request falls back to the database. Future versions bump the same string.

**Reviewer → project (D2).** `POST /api/projects` refuses with `409 {code:'company_profile_required'}`
when the caller's workspace has no v2 company profile (skipped when `KYC_GATE=off`, so the kill switch
also unblocks project creation). The two callers, `app/new/page.tsx` and
`components/home/NewProjectModal.tsx`, send the person to `/welcome?callbackUrl=<where they were>` on
that 409; `/new` also checks on load (`GET /api/welcome` → `companyRequired`, acted on only while still composing) so nobody fills in a package
and loses it. `/welcome` then shows the company variant and returns them. The API check is what makes
it unbypassable; the load check is what makes it pleasant. `app/api/projects/route.ts` is the only
place that inserts into `projects`.

**Which variant /welcome shows** is one pure function, `decideOnboarding({roleDone, companyDone,
needsCompany})`: not role-done and needs company and no company → `full`; not role-done → `role`;
no company → `company`; otherwise `done` (the page redirects to the callback). `needsCompany` =
`signup_type <> 'invited_reviewer'` OR owns a project. The middleware gate only checks role-done
(`users.onboarding_version`), so a reviewer reaches `company` only by being sent there.

## 6. The page

One page, fields in the doc's order, one **Create workspace** button (Role-only variant: **Continue**).
Built to the doc's "The single page" and "Dropdown rules" sections. The specifics engineering must
not miss:

- **Website.** Prefilled with the email domain when `isBusinessEmail(email)`. Accepts `acme.com` or a
  full URL; stored as the bare domain: lowercase, no protocol, no `www.`, no path, no port. A
  "We don't have a website yet" checkbox disables the input and satisfies the requirement.
  `website_source` = `prefilled` (submitted unchanged from the prefill), `typed`, or `none`.
  Validation: after normalising, must contain a dot and only hostname characters.
- **Industry** changes clear Role and External reviewers, and re-filter Client model (CM-3 only for
  `PRD`, `MFG`, `CST`) and the File types group order. A picked CM-3 is cleared if the new industry
  doesn't show it.
- **Markets.** Up to 3; tags in pick order; first tag labelled "Primary"; tags reorderable by drag
  and by keyboard (focused tag + arrow keys), because drag alone is not accessible.
- **Review team size** hides bands whose minimum exceeds the company size's maximum (company "Just me"
  → only "1 (just me)"). Changing company size clears an incompatible pick.
- **Role and External reviewers** use the chosen industry's list; `OTH` industry and the Role-only
  page use the combined, de-duplicated list (the doc's rule for Other).
- **Search** with synonyms for Market, Role and File types (the doc's examples: "CNC", "molding",
  "millwork"). Synonyms live next to each option in the catalog.
- **Button disabled** until every required field is valid (doc: keep from current build).
- **Marketing opt-in** unchecked by default (unchanged).
- **Keyboard:** Tab between fields; arrows + Enter inside a dropdown; Escape closes the open
  dropdown only (not the page).

Visual style follows the current /welcome (Manrope, ink, gradient button) so it looks like the
Webflow site and /pricing.

## 7. Data model (migration `020-kyc-v2.sql`, additive only)

```
company_profiles            one row per submission, never updated
  id TEXT PK
  workspace_id TEXT NOT NULL → workspaces
  submitted_by_user_id TEXT → users ON DELETE SET NULL   nullable: history outlives a deleted submitter
  onboarding_version INT NOT NULL          1 = migrated old answers, 2 = this page
  source TEXT NOT NULL                     'onboarding' | 'project_gate' | 'settings' | 'migrated_v1'
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now()
  company_domain TEXT, website_source TEXT
  industry TEXT, industry_other_text TEXT, parent_segment TEXT
  client_model TEXT
  company_size TEXT, size_min INT, size_max INT        size_max NULL for 250+
  review_team_size TEXT, rt_min INT, rt_max INT        rt_max NULL for 50+
  primary_market TEXT, market_other_text TEXT
  file_type_other_text TEXT
  icp_size_fit BOOLEAN
  legacy JSONB                              v1 rows only: the old pillar/segment/client/size values

company_profile_markets     (profile_id, market_code, pick_order)   PK (profile_id, market_code)
company_profile_reviewers   (profile_id, reviewer_code)             PK (profile_id, reviewer_code)
company_profile_file_types  (profile_id, file_type_code, supported_at_signup BOOLEAN)

user_roles                  one row per answer, never updated
  id, user_id, onboarding_version, source, answered_at,
  role_code, role_other_text, role_family, seniority, decision_maker BOOLEAN, non_buyer BOOLEAN

workspaces  + current_profile_id TEXT, + company_domain TEXT
users       + onboarding_version INT, + signup_type TEXT, + invited_by_user_id TEXT,
            + signup_country TEXT, + signup_region TEXT
```

- **Current values** = `workspaces.current_profile_id` and `users.role` (now holding the v2 role code).
  Both are moved in the same transaction that inserts the history row, so the pointer and the
  history never disagree.
- **Migration backfill:** one `company_profiles` v1 row per workspace that has old answers (`legacy`
  holds them, new columns NULL); one `user_roles` v1 row per user with a `role`; `signup_type` from
  `signup_source`; `invited_by_user_id` from `invite_tokens.invited_by` via `users.invite_id`. Old
  `workspaces` and `users` columns are **not dropped** (rollback safety); nothing reads them after
  this ships except the backfill.
- **Derived values are computed server-side** in pure functions and stored on the row:
  `parent_segment` (industry → its parent), `primary_market` (first pick), `icp_size_fit`
  (`size_min >= 5`), `decision_maker` (seniority is Owner/executive or Director), `non_buyer`
  (Student or educator), `size_*`/`rt_*` from the band.
- **Signup:** `recordSignup` also writes `signup_type`, `invited_by_user_id`, `signup_country` and
  `signup_region` (from Vercel's IP headers). UTMs, referrer, landing page and click ids are already
  captured there.
- **Stripe:** `users.stripe_customer_id` already exists and is the billing key; the doc's
  `billing_customer_id` is that column. No change.

## 8. Code layout

| Unit | Does | Depends on |
|---|---|---|
| `lib/kyc/catalog.ts` (rewritten) | All v2 lists: industries (+parent, helper, synonyms), markets (+group), client models (+which industries), size and RT bands (+min/max), roles per industry (+code, family, seniority), reviewers per industry (+ER code), file types (+group, FT code, extensions). Pure data. | nothing |
| `lib/kyc/profile.ts` (rewritten) | `validateCompanyProfile`, `validateRole`, `normaliseDomain`, `deriveProfile`, `deriveRole`, filters (`rolesFor`, `reviewersFor`, `clientModelsFor`, `reviewTeamBandsFor`, `fileTypeGroupsFor`). Pure, shared by page and API. | catalog, `lib/fileFormats.ts` |
| `lib/kyc/store.ts` (new) | `saveCompanyProfile`, `saveRole`, `currentCompanyProfile`: the transactions in §7. | db |
| `lib/kyc/gate.ts`, `gateLookup.ts`, `profileCookie.ts` | Version check (§5), cookie v2 message. | db (edge-safe) |
| `app/api/welcome/route.ts` | Accepts `{kind:'full'|'role'|'company', …}`. The posted kind must equal the kind the user is expected to answer (`full`, `role` or `company`, from §5), or be `company` once they are done (Settings → Company); anything else is a 409 `{error:'wrong_kind', kind}` naming the expected kind. An unknown kind is a 400. | profile, store |
| `app/welcome/page.tsx` + `components/welcome/*` | The page: `ComboSelect` (single/multi, search, groups, tags, reorder) used by every field. | profile |
| `app/new/page.tsx`, `components/home/NewProjectModal.tsx`, `app/api/projects/route.ts` | Company-profile check (§5). | store |
| `app/settings/company/page.tsx` | Same form, prefilled from the current profile, saves a `settings` row. Every user owns exactly one workspace, so it edits their own; a reviewer filling it here also satisfies the project check. | profile, store |
| `lib/analytics/*` | Event context + group properties use v2 fields (§3). | store |

## 9. Error handling

- API validation returns `400 {error:'invalid', field}` with the first bad field, as today; the page
  scrolls to and focuses that field.
- Server re-derives everything; client-sent derived values are ignored.
- A filtered value that doesn't fit (a Role not in the industry's list, CM-3 for Interior, an RT band
  above company size) is a 400, not silently dropped.
- Gate lookup failure still lets the request through (existing rule: a DB hiccup must not lock
  everyone out).
- Analytics stays in `waitUntil`; a PostHog failure never fails a submit.

## 10. Testing

- **Unit (node --test):** every validator branch; each filter for every industry incl. `OTH`;
  domain normalising (`https://www.Acme.com/about` → `acme.com`); derivations; catalog integrity
  (codes unique, every reviewer label maps to one ER code, every role has family + seniority, no
  reused codes, file-type support matches `lib/fileFormats.ts`).
- **PGlite** (the local SQL harness used for 019): migration 020 on a copy of the schema with v1 data →
  backfill rows correct; submit full / role / company flows; history rows appended not overwritten;
  pointer moves; reviewer gets 409 on project create, then succeeds after the company form; owner
  posting `role` is refused.
- **Playwright on a production build:** full page keyboard-only; Role-only page; re-ask of a v1 user
  with a stale v1 cookie; `/new` company step for a reviewer.

## 11. Rollout and rollback

1. Apply migration `020` to production **before** merge (additive; old code ignores it).
2. Merge + push → deploy. Every signed-in user is sent to /welcome on their next page load.
3. Check: a v1 user is re-asked; a submit writes one v2 `company_profiles` row and one `user_roles` row; a reviewer is asked Role only.

Rollback: `KYC_GATE=off` in Vercel stops all gating once redeployed (about 2 minutes); then, if needed,
`git revert -m 1 <merge>` restores the wizard. The migration needs no rollback: new tables are unused
by old code and old columns were never dropped.
