# KYC Onboarding + PostHog (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every signed-in Stiko user answers a required five-question business profile at `/welcome`; product, signup and billing activity flows to PostHog (US Cloud) with user, workspace, segment and track on every event; first/last-touch UTMs are captured across www.stiko.design and app.stiko.design; EU/UK visitors see a consent banner.

**Architecture:** Pure, unit-tested modules (`lib/kyc/*`, `lib/analytics/events.ts`, `lib/attribution.ts`, `lib/geo.ts`) hold every rule. Thin DB/route layers call them. Server events go through an `analytics_outbox` table, flushed to PostHog's `/batch/` endpoint after the response via `waitUntil`, with the daily cron as backstop. One vanilla script, `public/stiko-tracking.js`, handles consent, the banner and UTM cookies on both sites. The React `AnalyticsProvider` starts posthog-js only after that script reports that tracking is allowed.

**Tech Stack:** Next.js 14.2 App Router, TypeScript, Neon HTTP driver (`sql`, `sql.transaction`), WorkOS AuthKit, Stripe, `posthog-js`, `@vercel/functions`, `node --test` with native type stripping.

**Spec:** `docs/superpowers/specs/2026-11-15-kyc-and-posthog-design.md` (read it first).

## Global Constraints

- Branch: `feature/kyc-posthog`. Never `git add -A` / `git add .` — three untracked handoff dirs would be swept in. Add files by path.
- Migration number is **019** (`lib/migrations/019-kyc-analytics.sql`). Every new `users` column is ALSO added to `lib/schema.sql` as `ALTER TABLE users ADD COLUMN IF NOT EXISTS …` (schema.sql runs before migrations; a column only inside a CREATE never appears on the live DB).
- Tested `lib/` modules use **relative imports with `.ts` extensions** (e.g. `from './catalog.ts'`), never `@/`. Anything imported from `lib/queries.ts` into a tested module is `import type`.
- Tests: `npm test` runs `node --test scripts/tests/*.mjs`. New test files go in `scripts/tests/` and import `../../lib/....ts`.
- **Store IDs, not labels**: `pillar` (`ID` `PD` `AC` `GV`), `segment_id` (e.g. `PD-07`), size band, role code.
- **Every server event carries** `user_id`, `workspace_id`, `segment_id`, `track` (`'unknown'` for the last two before KYC) and `$groups: { workspace }` when a workspace exists.
- **Never send to PostHog:** file names, project/package names, comment text, email addresses, person names, invite tokens. IDs, codes, extensions, sizes and counts only.
- **Analytics must never fail, block or slow a user action.** Every server analytics call is wrapped so errors are logged only.
- No PostHog key set → everything no-ops (local dev, and the rollback).
- `KYC_GATE=off` → no redirect to `/welcome`.
- Consent countries: EU-27 + IS, LI, NO + GB + CH. Unknown country → consent required.
- PostHog region: US. Ingest host `https://us.i.posthog.com`, assets `https://us-assets.i.posthog.com`, UI `https://us.posthog.com`.
- Copy: the product name is written `stiko` in UI copy (lowercase), "Package" not "Portal" in UI copy.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/kyc/catalog.ts` (new) | Pillars, 44 business types, client models, size bands (+track), roles. Pure data. |
| `lib/kyc/profile.ts` (new) | `validateProfile`, `trackForSize`, `businessTypesFor`, `isOtherSegment`, `isBusinessEmail`. Pure. |
| `lib/kyc/profileCookie.ts` (new) | HMAC-signed `stiko_profile` cookie (Web Crypto, works in edge + node). Pure. |
| `lib/kyc/gate.ts` (new) | Which page requests the gate checks; welcome redirect path; `KYC_GATE`. Pure. |
| `lib/kyc/gateLookup.ts` (new) | One DB read: has this subject completed the profile? Edge-safe. |
| `lib/geo.ts` (new) | Consent countries, `consentRequired`, consent cookie parsing, consent at signup. Pure. |
| `lib/attribution.ts` (new) | Parse `stiko_ft`/`stiko_lt` cookies, `signupSource`, invite token from callbackUrl. Pure. |
| `lib/analytics/events.ts` (new) | Build capture / `$groupidentify` rows, strip forbidden keys, batch payload, billing transitions. Pure. |
| `lib/analytics/outbox.ts` (new) | `enqueue`, `flushOutbox`, `pruneOutbox` against `analytics_outbox`. |
| `lib/analytics/server.ts` (new) | Public server API: `track`, `identifyWorkspace`, `trackFileEvent`. |
| `lib/workspaces.ts` (new) | `ensureWorkspace`, `workspaceContext`, `markActivation`. |
| `lib/analytics/signup.ts` (new) | `recordSignup` — writes attribution to the user and fires signup events. |
| `lib/migrations/019-kyc-analytics.sql` (new) + `lib/schema.sql` | Tables and columns. |
| `public/stiko-tracking.js` (new) | Vanilla: consent decision, EU/UK banner, UTM cookies. Served to both sites. |
| `components/analytics/AnalyticsProvider.tsx` (new) | posthog-js init, pageviews, identify/group, replay on `/welcome`, consent sync. |
| `lib/analytics/client.ts` (new) | `captureClient` — safe client capture. |
| `app/welcome/page.tsx`, `app/api/welcome/route.ts` (new) | The KYC step. |
| `app/api/geo/route.ts`, `app/api/analytics/consent/route.ts` (new) | Consent support. |
| `middleware.ts`, `lib/routeAccess.ts`, `next.config.mjs`, `app/providers.tsx` | Wiring. |
| Event call sites (modify) | sign-up, verify-email, nextauth signup, projects, files/complete, uploads/rejected, conversions ×4, participants, invite GET, `lib/stripe.ts`, cron. |

---

### Task 1: KYC catalog and profile rules

**Files:**
- Create: `lib/kyc/catalog.ts`, `lib/kyc/profile.ts`
- Test: `scripts/tests/kycProfile.test.mjs`

**Interfaces:**
- Produces: `PILLARS`, `BUSINESS_TYPES`, `CLIENT_MODELS`, `SIZE_BANDS`, `ROLES`, `OTHER_TEXT_MAX`, types `PillarId`, `Track`, `Option`, `BusinessType`; `validateProfile(body: unknown): ProfileValidation`, `trackForSize(band: string): Track | null`, `businessTypesFor(pillar: string): BusinessType[]`, `isOtherSegment(id: string): boolean`, `isBusinessEmail(email: string): boolean`, type `ProfileAnswers`.

- [ ] **Step 1: Write the failing test** — `scripts/tests/kycProfile.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PILLARS, BUSINESS_TYPES, CLIENT_MODELS, SIZE_BANDS, ROLES } from '../../lib/kyc/catalog.ts';
import {
  validateProfile, trackForSize, businessTypesFor, isOtherSegment, isBusinessEmail,
} from '../../lib/kyc/profile.ts';

const VALID = {
  pillar: 'PD', segmentId: 'PD-07', clientModel: 'clients',
  companySizeBand: '25-49', role: 'engineer', marketingConsent: false,
};

test('every business type ID is unique and belongs to its pillar prefix', () => {
  const ids = BUSINESS_TYPES.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const b of BUSINESS_TYPES) assert.equal(b.id.slice(0, 2), b.pillar, b.id);
});

test('every pillar has exactly 10 business types plus one Other', () => {
  assert.deepEqual(PILLARS.map((p) => p.id), ['ID', 'PD', 'AC', 'GV']);
  for (const p of PILLARS) {
    const types = businessTypesFor(p.id);
    assert.equal(types.length, 11, p.id);
    assert.equal(types.filter((t) => isOtherSegment(t.id)).length, 1, p.id);
    assert.ok(types.some((t) => t.id === `${p.id}-99`), p.id);
  }
});

test('every option has a non-empty label', () => {
  for (const o of [...PILLARS, ...BUSINESS_TYPES, ...CLIENT_MODELS, ...SIZE_BANDS, ...ROLES]) {
    assert.ok(o.label.trim().length > 0, o.id);
  }
});

test('company size maps to the four tracks', () => {
  assert.equal(trackForSize('just_me'), 'prosumer');
  assert.equal(trackForSize('2-4'), 'small_team');
  for (const b of ['5-9', '10-24', '25-49']) assert.equal(trackForSize(b), 'mid_team', b);
  for (const b of ['50-99', '100-249', '250+']) assert.equal(trackForSize(b), 'large_team', b);
  assert.equal(trackForSize('1-4'), null);
  for (const b of SIZE_BANDS) assert.ok(trackForSize(b.id), b.id);
});

test('a complete, consistent answer set validates', () => {
  const r = validateProfile(VALID);
  assert.equal(r.ok, true);
  assert.deepEqual(r.answers, { ...VALID, businessTypeOther: null });
});

test('each field is checked against the catalog', () => {
  for (const [field, value] of [
    ['pillar', 'XX'], ['segmentId', 'PD-42'], ['clientModel', 'agency'],
    ['companySizeBand', '1-4'], ['role', 'ceo'],
  ]) {
    const r = validateProfile({ ...VALID, [field]: value });
    assert.deepEqual(r, { ok: false, field }, field);
  }
  assert.deepEqual(validateProfile(null), { ok: false, field: 'pillar' });
});

test('a business type from another pillar is refused', () => {
  assert.deepEqual(validateProfile({ ...VALID, segmentId: 'AC-06' }), { ok: false, field: 'segmentId' });
});

test('Other needs its free text, trimmed and at most 120 chars', () => {
  const other = { ...VALID, segmentId: 'PD-99' };
  assert.deepEqual(validateProfile(other), { ok: false, field: 'businessTypeOther' });
  assert.deepEqual(validateProfile({ ...other, businessTypeOther: '   ' }), { ok: false, field: 'businessTypeOther' });
  assert.deepEqual(validateProfile({ ...other, businessTypeOther: 'x'.repeat(121) }), { ok: false, field: 'businessTypeOther' });
  const ok = validateProfile({ ...other, businessTypeOther: '  Boat builder ' });
  assert.equal(ok.ok, true);
  assert.equal(ok.answers.businessTypeOther, 'Boat builder');
});

test('free text on a non-Other type is dropped', () => {
  const r = validateProfile({ ...VALID, businessTypeOther: 'ignored' });
  assert.equal(r.answers.businessTypeOther, null);
});

test('marketing consent is true only when explicitly true', () => {
  assert.equal(validateProfile({ ...VALID, marketingConsent: 'true' }).answers.marketingConsent, false);
  assert.equal(validateProfile({ ...VALID, marketingConsent: true }).answers.marketingConsent, true);
});

test('free-mail domains are not business email, case-insensitively', () => {
  for (const e of ['a@gmail.com', 'A@GMAIL.COM', 'b@outlook.com', 'c@icloud.com', 'd@yahoo.ca', 'e@shaw.ca', 'f@proton.me']) {
    assert.equal(isBusinessEmail(e), false, e);
  }
  assert.equal(isBusinessEmail('dana@acme-design.com'), true);
  assert.equal(isBusinessEmail('not-an-email'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/kycProfile.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `lib/kyc/catalog.ts`.

- [ ] **Step 3: Write `lib/kyc/catalog.ts`**

```ts
/**
 * The KYC questionnaire's options, from the marketing co-founder's sheet
 * (stiko-kyc-business-types-v3.xlsx: Business Types + KYC Fields tabs).
 *
 * IDs are what gets stored, in Postgres and in PostHog. Labels are display only
 * and may be reworded freely. To retire an option, delete it here and never
 * reuse its ID. Review "Other" answers monthly (sheet, "How to use" step 4).
 *
 * Pure data, no imports: loaded by node --test and by the client bundle.
 */

export type PillarId = 'ID' | 'PD' | 'AC' | 'GV';
export type Track = 'prosumer' | 'small_team' | 'mid_team' | 'large_team';

export interface Option<T extends string = string> {
  id: T;
  label: string;
}
export interface Pillar extends Option<PillarId> {
  priority: 'priority' | 'secondary';
}
export interface BusinessType {
  id: string;
  pillar: PillarId;
  label: string;
  helper: string;
}
export interface SizeBand extends Option {
  track: Track;
}

export const PILLARS: readonly Pillar[] = [
  { id: 'ID', label: 'Industrial Design & Concept Development', priority: 'priority' },
  { id: 'PD', label: 'Product Development & Manufacturing', priority: 'priority' },
  { id: 'AC', label: 'Architecture, Interior & Construction', priority: 'priority' },
  { id: 'GV', label: 'Graphic Design, Video & Photography', priority: 'secondary' },
];

export const BUSINESS_TYPES: readonly BusinessType[] = [
  { id: "ID-01", pillar: "ID", label: "Industrial design studio or agency", helper: "We design products for client brands" },
  { id: "ID-02", pillar: "ID", label: "Product design and engineering firm", helper: "We take client products from concept to production-ready CAD" },
  { id: "ID-03", pillar: "ID", label: "Consumer electronics company", helper: "Audio, wearables, smart home, accessories, small appliances" },
  { id: "ID-04", pillar: "ID", label: "Furniture, lighting or home goods brand", helper: "Residential or contract furniture, lighting, housewares, decor" },
  { id: "ID-05", pillar: "ID", label: "Sporting goods, outdoor or toy company", helper: "Fitness, outdoor gear, bikes, toys, juvenile products" },
  { id: "ID-06", pillar: "ID", label: "Medical device company", helper: "Diagnostic, surgical, patient-facing or wellness devices" },
  { id: "ID-07", pillar: "ID", label: "Vehicle, e-bike or mobility company", helper: "Vehicle accessories and interiors, e-bikes, scooters, marine, RV" },
  { id: "ID-08", pillar: "ID", label: "Tools or industrial products company", helper: "Power tools, equipment housings, robotics, cleantech hardware" },
  { id: "ID-09", pillar: "ID", label: "Hardware startup", helper: "We are designing our first physical product" },
  { id: "ID-10", pillar: "ID", label: "3D rendering or product visualization studio", helper: "We create product renders and animations for brands" },
  { id: "ID-99", pillar: "ID", label: "Other (please specify)", helper: "Tell us what your business does" },
  { id: "PD-01", pillar: "PD", label: "Product development firm", helper: "We develop products for clients, from concept to manufacturing" },
  { id: "PD-02", pillar: "PD", label: "Engineering or DFM consultancy", helper: "Mechanical design, DFM/DFA, design reviews for clients" },
  { id: "PD-03", pillar: "PD", label: "Machinery or equipment manufacturer", helper: "Industrial, process, packaging, agricultural or food equipment" },
  { id: "PD-04", pillar: "PD", label: "Consumer product manufacturer", helper: "We design and make our own consumer products" },
  { id: "PD-05", pillar: "PD", label: "Medical device manufacturer", helper: "We manufacture regulated medical devices" },
  { id: "PD-06", pillar: "PD", label: "Automotive or aerospace parts supplier", helper: "Tier 1 / Tier 2 parts, aerospace components, specialty vehicles" },
  { id: "PD-07", pillar: "PD", label: "Machine shop or metal fabricator", helper: "CNC machining, sheet metal, welding, fabrication" },
  { id: "PD-08", pillar: "PD", label: "Injection moulding or tooling company", helper: "Injection moulding, mould making, die casting" },
  { id: "PD-09", pillar: "PD", label: "Automation or custom machine builder", helper: "Robotic cells, special-purpose machines, fixtures and tooling" },
  { id: "PD-10", pillar: "PD", label: "Hardware startup moving into production", helper: "We are working with factories to manufacture our product" },
  { id: "PD-99", pillar: "PD", label: "Other (please specify)", helper: "Tell us what your business does" },
  { id: "AC-01", pillar: "AC", label: "Residential architecture firm", helper: "Custom homes, renovations, additions" },
  { id: "AC-02", pillar: "AC", label: "Commercial architecture firm", helper: "Office, multi-family, mixed-use, hospitality, retail" },
  { id: "AC-03", pillar: "AC", label: "Residential interior design studio", helper: "Homes, condos, kitchens and baths" },
  { id: "AC-04", pillar: "AC", label: "Commercial interior design firm", helper: "Offices, hotels, restaurants, retail spaces" },
  { id: "AC-05", pillar: "AC", label: "Design-build company", helper: "We design and build projects for our clients" },
  { id: "AC-06", pillar: "AC", label: "General contractor or construction manager", helper: "Commercial and institutional construction" },
  { id: "AC-07", pillar: "AC", label: "Home builder or renovation company", helper: "Custom homes, renovations, remodelling" },
  { id: "AC-08", pillar: "AC", label: "Millwork, cabinetry or custom fabrication shop", helper: "Architectural millwork, cabinets, fixtures, steel, glass" },
  { id: "AC-09", pillar: "AC", label: "Structural or MEP engineering firm", helper: "Structural, mechanical, electrical, plumbing engineering" },
  { id: "AC-10", pillar: "AC", label: "Architectural rendering or 3D visualization studio", helper: "Renders, walkthroughs and 3D presentations for projects" },
  { id: "AC-99", pillar: "AC", label: "Other (please specify)", helper: "Tell us what your business does" },
  { id: "GV-01", pillar: "GV", label: "Branding or graphic design agency", helper: "Brand identity, graphic design, print and digital design" },
  { id: "GV-02", pillar: "GV", label: "Advertising agency", helper: "Campaign creative across print, digital and video" },
  { id: "GV-03", pillar: "GV", label: "Video production company", helper: "Commercial, corporate and branded video" },
  { id: "GV-04", pillar: "GV", label: "Post-production or editing studio", helper: "Editing, colour grading, finishing" },
  { id: "GV-05", pillar: "GV", label: "Animation or motion graphics studio", helper: "2D/3D animation, motion design, explainer videos" },
  { id: "GV-06", pillar: "GV", label: "Photography studio", helper: "Product, lifestyle, e-commerce or commercial photography" },
  { id: "GV-07", pillar: "GV", label: "Packaging design agency", helper: "Packaging graphics, labels, dielines" },
  { id: "GV-08", pillar: "GV", label: "Social media or content agency", helper: "Social content and campaigns at volume" },
  { id: "GV-09", pillar: "GV", label: "Web and digital design agency", helper: "Websites, landing pages, digital campaigns" },
  { id: "GV-10", pillar: "GV", label: "3D or AR studio for e-commerce", helper: "3D product models, configurators, AR experiences" },
  { id: "GV-99", pillar: "GV", label: "Other (please specify)", helper: "Tell us what your business does" },
];

export const CLIENT_MODELS: readonly Option[] = [
  { id: 'clients', label: 'Clients (we are a service provider)' },
  { id: 'own', label: 'Our own products or projects' },
  { id: 'both', label: 'Both' },
];

/** The sheet's "1-4" is split into "Just me" and "2-4" (engineering plan, Four segments). */
export const SIZE_BANDS: readonly SizeBand[] = [
  { id: 'just_me', label: 'Just me', track: 'prosumer' },
  { id: '2-4', label: '2-4', track: 'small_team' },
  { id: '5-9', label: '5-9', track: 'mid_team' },
  { id: '10-24', label: '10-24', track: 'mid_team' },
  { id: '25-49', label: '25-49', track: 'mid_team' },
  { id: '50-99', label: '50-99', track: 'large_team' },
  { id: '100-249', label: '100-249', track: 'large_team' },
  { id: '250+', label: '250+', track: 'large_team' },
];

export const ROLES: readonly Option[] = [
  { id: 'owner', label: 'Owner / Principal / Founder' },
  { id: 'design_lead', label: 'Design lead / Creative director' },
  { id: 'designer', label: 'Designer' },
  { id: 'engineer', label: 'Engineer' },
  { id: 'architect', label: 'Architect' },
  { id: 'interior_designer', label: 'Interior designer' },
  { id: 'project_manager', label: 'Project manager' },
  { id: 'operations', label: 'Operations / Production' },
  { id: 'procurement', label: 'Procurement / Sourcing' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'other', label: 'Other' },
];

/** Business types whose ID ends in this suffix are "Other (please specify)". */
export const OTHER_SUFFIX = '-99';
export const OTHER_TEXT_MAX = 120;
```

- [ ] **Step 4: Write `lib/kyc/profile.ts`**

```ts
/**
 * The KYC rules: validation, size → track, business-email detection.
 * Pure. Shared by POST /api/welcome (authoritative) and the /welcome page.
 */
import {
  BUSINESS_TYPES, CLIENT_MODELS, OTHER_SUFFIX, OTHER_TEXT_MAX, PILLARS, ROLES, SIZE_BANDS,
  type BusinessType, type PillarId, type Track,
} from './catalog.ts';

export interface ProfileAnswers {
  pillar: PillarId;
  segmentId: string;
  businessTypeOther: string | null;
  clientModel: string;
  companySizeBand: string;
  role: string;
  marketingConsent: boolean;
}

export type ProfileValidation =
  | { ok: true; answers: ProfileAnswers }
  | { ok: false; field: keyof ProfileAnswers };

export function trackForSize(band: string): Track | null {
  return SIZE_BANDS.find((b) => b.id === band)?.track ?? null;
}

export function businessTypesFor(pillar: string): BusinessType[] {
  return BUSINESS_TYPES.filter((b) => b.pillar === pillar);
}

export function isOtherSegment(id: string): boolean {
  return id.endsWith(OTHER_SUFFIX);
}

/** Checks every value against the catalog. The first bad field is reported. */
export function validateProfile(body: unknown): ProfileValidation {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');

  const pillar = str(b.pillar);
  if (!PILLARS.some((p) => p.id === pillar)) return { ok: false, field: 'pillar' };

  const segmentId = str(b.segmentId);
  const type = BUSINESS_TYPES.find((t) => t.id === segmentId);
  if (!type || type.pillar !== pillar) return { ok: false, field: 'segmentId' };

  let businessTypeOther: string | null = null;
  if (isOtherSegment(segmentId)) {
    const text = str(b.businessTypeOther).trim();
    if (!text || text.length > OTHER_TEXT_MAX) return { ok: false, field: 'businessTypeOther' };
    businessTypeOther = text;
  }

  const clientModel = str(b.clientModel);
  if (!CLIENT_MODELS.some((c) => c.id === clientModel)) return { ok: false, field: 'clientModel' };

  const companySizeBand = str(b.companySizeBand);
  if (!SIZE_BANDS.some((s) => s.id === companySizeBand)) return { ok: false, field: 'companySizeBand' };

  const role = str(b.role);
  if (!ROLES.some((r) => r.id === role)) return { ok: false, field: 'role' };

  return {
    ok: true,
    answers: {
      pillar: pillar as PillarId,
      segmentId,
      businessTypeOther,
      clientModel,
      companySizeBand,
      role,
      marketingConsent: b.marketingConsent === true,
    },
  };
}

/**
 * Personal mailbox providers. High-value logic and domain enrichment (later
 * phases) only run on business email. Includes the big Canadian ISPs because
 * the ICP is North America.
 */
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.ca', 'hotmail.co.uk',
  'live.com', 'live.ca', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'yahoo.com', 'yahoo.ca', 'yahoo.co.uk', 'ymail.com', 'aol.com',
  'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'zoho.com', 'yandex.com',
  'mail.com', 'hey.com', 'fastmail.com',
  'shaw.ca', 'rogers.com', 'sympatico.ca', 'bell.net', 'telus.net', 'videotron.ca',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net',
]);

export function isBusinessEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 1) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain.includes('.')) return false;
  return !FREE_EMAIL_DOMAINS.has(domain);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test scripts/tests/kycProfile.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/kyc/catalog.ts lib/kyc/profile.ts scripts/tests/kycProfile.test.mjs
git commit -m "feat(kyc): business-type catalog and profile validation"
```

---

### Task 2: Migration 019

**Files:**
- Create: `lib/migrations/019-kyc-analytics.sql`
- Modify: `lib/schema.sql` (append at the end of the file)

**Interfaces:**
- Produces tables `workspaces`, `analytics_outbox`; `users` columns `role`, `profile_completed_at`, `signup_source`, `inviter_workspace_id`, `invite_id`, `is_business_email`, `marketing_consent`, `marketing_consent_at`, `marketing_consent_method`, `analytics_consent`, `utm_first`, `utm_last`, `click_ids`.

- [ ] **Step 1: Write `lib/migrations/019-kyc-analytics.sql`**

```sql
-- lib/migrations/019-kyc-analytics.sql
--
-- KYC onboarding + PostHog Phase 1 (2026-11-15). Mirrored in lib/schema.sql.
-- Spec: docs/superpowers/specs/2026-11-15-kyc-and-posthog-design.md
--
-- Additive only, so it is safe to apply before the code that uses it ships.
-- Apply BEFORE the deploy: middleware reads users.profile_completed_at.

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  pillar TEXT,
  segment_id TEXT,
  business_type_other TEXT,
  client_model TEXT,
  company_size_band TEXT,
  track TEXT,
  country TEXT,
  region TEXT,
  is_business_email BOOLEAN,
  utm_first JSONB,
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_source TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS inviter_workspace_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_business_email BOOLEAN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_consent_method TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS analytics_consent TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_first JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_last JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS click_ids JSONB;

CREATE TABLE IF NOT EXISTS analytics_outbox (
  id BIGSERIAL PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  event TEXT NOT NULL,
  distinct_id TEXT NOT NULL,
  properties JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS analytics_outbox_unsent_idx
  ON analytics_outbox (id) WHERE sent_at IS NULL;
```

- [ ] **Step 2: Append the same statements to the end of `lib/schema.sql`**, under a header comment `-- KYC + analytics (migration 019). users columns MUST stay as ALTERs: see the note on workos_user_id above.` Copy the CREATE TABLE workspaces, the 13 `ALTER TABLE users …` lines, CREATE TABLE analytics_outbox and the index verbatim from Step 1.

- [ ] **Step 3: Verify the SQL executes (PGlite harness)**

There is no staging DB. Build the throwaway harness in the session scratchpad (recipe: memory note `stiko-pglite-sql-harness`), then run:

```js
// scratch/check-019.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const repo = process.argv[2];
const db = new PGlite();
await db.exec(readFileSync(`${repo}/lib/schema.sql`, 'utf8'));
const mig = readFileSync(`${repo}/lib/migrations/019-kyc-analytics.sql`, 'utf8');
await db.exec(mig);
await db.exec(mig); // idempotent
await db.exec(readFileSync(`${repo}/lib/schema.sql`, 'utf8')); // schema.sql re-run after 019
const cols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name IN ('role','profile_completed_at','utm_first','click_ids','analytics_consent')`);
console.log(cols.rows.length === 5 ? 'OK users columns' : 'MISSING', cols.rows);
```

Run: `node scratch/check-019.mjs /Users/user/Desktop/STIKO-main`
Expected: `OK users columns`, no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/migrations/019-kyc-analytics.sql lib/schema.sql
git commit -m "feat(db): migration 019 — workspaces, analytics outbox, KYC user columns"
```

---

### Task 3: Consent rules and attribution parsing (pure)

**Files:**
- Create: `lib/geo.ts`, `lib/attribution.ts`
- Test: `scripts/tests/geoAttribution.test.mjs`

**Interfaces:**
- Produces (`lib/geo.ts`): `CONSENT_COOKIE = 'stiko_consent'`, `consentRequired(country: string | null | undefined): boolean`, `consentValue(raw: string | undefined): 'granted' | 'denied' | null`, `analyticsConsentAtSignup(cookie: string | undefined, country: string | null): 'granted' | 'denied' | 'pending' | null`, `analyticsAllowed(consent: string | null): boolean`.
- Produces (`lib/attribution.ts`): `FIRST_TOUCH_COOKIE = 'stiko_ft'`, `LAST_TOUCH_COOKIE = 'stiko_lt'`, type `Touch`, `parseTouchCookie(raw: string | undefined): Touch | null`, `signupSource(inviteToken: string | null | undefined): 'reviewer_invite' | 'direct'`, `inviteTokenFromCallback(callbackUrl: string | null | undefined): string | null`, `clickIds(input: { first: Touch | null; last: Touch | null; fbc?: string; fbp?: string; ga?: string }): Record<string, string>`.

- [ ] **Step 1: Write the failing test** — `scripts/tests/geoAttribution.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consentRequired, consentValue, analyticsConsentAtSignup, analyticsAllowed } from '../../lib/geo.ts';
import { parseTouchCookie, signupSource, inviteTokenFromCallback, clickIds } from '../../lib/attribution.ts';

test('EU, EEA, UK and Switzerland need consent; North America does not', () => {
  for (const c of ['DE', 'FR', 'IE', 'IS', 'NO', 'LI', 'GB', 'CH', 'de']) assert.equal(consentRequired(c), true, c);
  for (const c of ['US', 'CA', 'MX', 'AU', 'IN']) assert.equal(consentRequired(c), false, c);
});

test('an unknown country fails closed', () => {
  assert.equal(consentRequired(null), true);
  assert.equal(consentRequired(''), true);
  assert.equal(consentRequired(undefined), true);
});

test('only the two known consent values are read', () => {
  assert.equal(consentValue('granted'), 'granted');
  assert.equal(consentValue('denied'), 'denied');
  assert.equal(consentValue('yes'), null);
  assert.equal(consentValue(undefined), null);
});

test('consent at signup: cookie wins, else pending in consent countries, else null', () => {
  assert.equal(analyticsConsentAtSignup('granted', 'DE'), 'granted');
  assert.equal(analyticsConsentAtSignup('denied', 'US'), 'denied');
  assert.equal(analyticsConsentAtSignup(undefined, 'DE'), 'pending');
  assert.equal(analyticsConsentAtSignup(undefined, 'US'), null);
});

test('server events are allowed only for granted or never-asked users', () => {
  assert.equal(analyticsAllowed(null), true);
  assert.equal(analyticsAllowed('granted'), true);
  assert.equal(analyticsAllowed('denied'), false);
  assert.equal(analyticsAllowed('pending'), false);
});

test('a touch cookie is parsed, whitelisted and capped', () => {
  const raw = encodeURIComponent(JSON.stringify({
    utm_source: 'meta', utm_campaign: '2026-11_meta_pd_trial', gclid: 'AbC',
    landing_page: '/solutions', referrer: 'https://l.facebook.com/', ts: '2026-11-15T10:00:00.000Z',
    evil: 'x', utm_term: 'y'.repeat(500),
  }));
  const t = parseTouchCookie(raw);
  assert.equal(t.utm_source, 'meta');
  assert.equal(t.gclid, 'AbC');
  assert.equal(t.evil, undefined);
  assert.equal(t.utm_term.length, 200);
  assert.equal(parseTouchCookie('not json'), null);
  assert.equal(parseTouchCookie(undefined), null);
  assert.equal(parseTouchCookie(encodeURIComponent('[1,2]')), null);
});

test('an invite token makes the signup a reviewer_invite, whatever the UTMs', () => {
  assert.equal(signupSource('abc'), 'reviewer_invite');
  assert.equal(signupSource(''), 'direct');
  assert.equal(signupSource(null), 'direct');
});

test('the invite token is recovered from a /signup callbackUrl', () => {
  assert.equal(inviteTokenFromCallback('/invite/7c9e6679-7425-40de-944b-e07fc1f90ae7'), '7c9e6679-7425-40de-944b-e07fc1f90ae7');
  assert.equal(inviteTokenFromCallback('/invite/abc?x=1'), 'abc');
  assert.equal(inviteTokenFromCallback('/portal/abc'), null);
  assert.equal(inviteTokenFromCallback(null), null);
});

test('click ids merge last touch over first touch, plus Meta and GA cookies', () => {
  const ids = clickIds({
    first: { gclid: 'g1', fbclid: 'f1' }, last: { gclid: 'g2' },
    fbc: 'fb.1.123.f1', fbp: 'fb.1.456', ga: 'GA1.1.111.222',
  });
  assert.deepEqual(ids, { gclid: 'g2', fbclid: 'f1', fbc: 'fb.1.123.f1', fbp: 'fb.1.456', ga: 'GA1.1.111.222' });
  assert.deepEqual(clickIds({ first: null, last: null }), {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/geoAttribution.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `lib/geo.ts`**

```ts
/**
 * Who sees the cookie banner, and what consent means for server events.
 * Pure. Used by /api/geo, signup, /api/welcome and lib/analytics/server.ts.
 * public/stiko-tracking.js does not import this; it asks /api/geo.
 */

export const CONSENT_COOKIE = 'stiko_consent';

/** EU-27 + EEA (IS, LI, NO) + UK + Switzerland. ISO 3166-1 alpha-2. */
const CONSENT_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO', 'GB', 'CH',
]);

/** Unknown country fails closed: better a banner too many than tracking without consent. */
export function consentRequired(country: string | null | undefined): boolean {
  if (!country) return true;
  return CONSENT_COUNTRIES.has(country.toUpperCase());
}

export function consentValue(raw: string | undefined): 'granted' | 'denied' | null {
  return raw === 'granted' || raw === 'denied' ? raw : null;
}

/**
 * users.analytics_consent at account creation. 'pending' = a consent-country
 * visitor who has not answered the banner: no server events until they accept.
 */
export function analyticsConsentAtSignup(
  cookie: string | undefined,
  country: string | null
): 'granted' | 'denied' | 'pending' | null {
  const v = consentValue(cookie);
  if (v) return v;
  return consentRequired(country) ? 'pending' : null;
}

/** null = never asked (outside consent countries), which the privacy policy covers. */
export function analyticsAllowed(consent: string | null): boolean {
  return consent === null || consent === 'granted';
}
```

- [ ] **Step 4: Write `lib/attribution.ts`**

```ts
/**
 * Server side of UTM capture. public/stiko-tracking.js writes the cookies on
 * both sites; this reads them at signup. Pure.
 *
 * First touch (stiko_ft) is written once and never overwritten; last touch
 * (stiko_lt) on every visit that carries UTMs or click IDs.
 */

export const FIRST_TOUCH_COOKIE = 'stiko_ft';
export const LAST_TOUCH_COOKIE = 'stiko_lt';

const TOUCH_FIELDS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'fbclid', 'ttclid', 'landing_page', 'referrer', 'ts',
] as const;
const MAX_VALUE = 200;

export type Touch = Partial<Record<(typeof TOUCH_FIELDS)[number], string>>;

export function parseTouchCookie(raw: string | undefined): Touch | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const out: Touch = {};
  for (const key of TOUCH_FIELDS) {
    const v = (parsed as Record<string, unknown>)[key];
    if (typeof v === 'string' && v) out[key] = v.slice(0, MAX_VALUE);
  }
  return Object.keys(out).length ? out : null;
}

/** Engineering plan: review-loop signups keep reviewer_invite even with UTMs. */
export function signupSource(inviteToken: string | null | undefined): 'reviewer_invite' | 'direct' {
  return inviteToken ? 'reviewer_invite' : 'direct';
}

/** /signup?callbackUrl=/invite/<token> → <token>. */
export function inviteTokenFromCallback(callbackUrl: string | null | undefined): string | null {
  const m = /^\/invite\/([^/?#]+)/.exec(callbackUrl ?? '');
  return m ? m[1] : null;
}

const CLICK_FIELDS = ['gclid', 'fbclid', 'ttclid'] as const;

/** Kept so the later GA4 / ad-conversion phases need no backfill. */
export function clickIds(input: {
  first: Touch | null;
  last: Touch | null;
  fbc?: string;
  fbp?: string;
  ga?: string;
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of CLICK_FIELDS) {
    const v = input.last?.[k] ?? input.first?.[k];
    if (v) out[k] = v;
  }
  if (input.fbc) out.fbc = input.fbc.slice(0, MAX_VALUE);
  if (input.fbp) out.fbp = input.fbp.slice(0, MAX_VALUE);
  if (input.ga) out.ga = input.ga.slice(0, MAX_VALUE);
  return out;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test scripts/tests/geoAttribution.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/geo.ts lib/attribution.ts scripts/tests/geoAttribution.test.mjs
git commit -m "feat(analytics): consent-country and attribution-cookie rules"
```

---

### Task 4: Event building (pure)

**Files:**
- Create: `lib/analytics/events.ts`
- Test: `scripts/tests/analyticsEvents.test.mjs`

**Interfaces:**
- Consumes: `analyticsAllowed` from `lib/geo.ts`.
- Produces: types `WorkspaceContext { workspaceId: string | null; segmentId: string; track: string; analyticsConsent: string | null }`, `CaptureRow { uuid: string; event: string; distinctId: string; properties: Record<string, unknown> }`; `ANONYMOUS_CONTEXT`; `buildCapture(input: { event: string; distinctId: string; userId: string | null; context: WorkspaceContext; properties?: Record<string, unknown>; set?: Record<string, unknown>; setOnce?: Record<string, unknown> }, uuid: string): CaptureRow | null`; `buildGroupIdentify(workspaceId: string, distinctId: string, groupSet: Record<string, unknown>, uuid: string): CaptureRow`; `stripForbidden(props: Record<string, unknown>): Record<string, unknown>`; `toBatchPayload(apiKey: string, rows: Array<CaptureRow & { createdAt: string }>)`; `billingTransitionEvents(prev: string | null, next: string | null): Array<'trial_started' | 'subscription_started'>`; `extensionOf(filename: string): string`.

- [ ] **Step 1: Write the failing test** — `scripts/tests/analyticsEvents.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCapture, buildGroupIdentify, stripForbidden, toBatchPayload, billingTransitionEvents,
  ANONYMOUS_CONTEXT, extensionOf,
} from '../../lib/analytics/events.ts';

const CTX = { workspaceId: 'ws_1', segmentId: 'PD-07', track: 'mid_team', analyticsConsent: null };

test('every event carries the four standard properties and the workspace group', () => {
  const row = buildCapture({ event: 'project_created', distinctId: 'u1', userId: 'u1', context: CTX, properties: { project_id: 'p1' } }, 'uuid-1');
  assert.deepEqual(row, {
    uuid: 'uuid-1', event: 'project_created', distinctId: 'u1',
    properties: {
      project_id: 'p1', user_id: 'u1', workspace_id: 'ws_1', segment_id: 'PD-07', track: 'mid_team',
      $groups: { workspace: 'ws_1' }, $lib: 'stiko-server',
    },
  });
});

test('standard properties cannot be overridden by the caller', () => {
  const row = buildCapture({ event: 'x', distinctId: 'u1', userId: 'u1', context: CTX, properties: { segment_id: 'GV-01', user_id: 'other' } }, 'u');
  assert.equal(row.properties.segment_id, 'PD-07');
  assert.equal(row.properties.user_id, 'u1');
});

test('before KYC the segment and track read unknown, and no group is sent without a workspace', () => {
  const row = buildCapture({ event: 'review_link_opened', distinctId: 'anon-1', userId: null, context: ANONYMOUS_CONTEXT }, 'u');
  assert.equal(row.properties.segment_id, 'unknown');
  assert.equal(row.properties.track, 'unknown');
  assert.equal(row.properties.workspace_id, null);
  assert.equal('$groups' in row.properties, false);
});

test('denied or pending consent suppresses the event entirely', () => {
  for (const analyticsConsent of ['denied', 'pending']) {
    assert.equal(buildCapture({ event: 'x', distinctId: 'u1', userId: 'u1', context: { ...CTX, analyticsConsent } }, 'u'), null);
  }
});

test('person properties ride along as $set and $set_once', () => {
  const row = buildCapture({ event: 'x', distinctId: 'u1', userId: 'u1', context: CTX, set: { role: 'engineer' }, setOnce: { first_utm_source: 'meta' } }, 'u');
  assert.deepEqual(row.properties.$set, { role: 'engineer' });
  assert.deepEqual(row.properties.$set_once, { first_utm_source: 'meta' });
});

test('names, emails, filenames and tokens are stripped from properties', () => {
  assert.deepEqual(
    stripForbidden({ file_id: 'f', filename: 'secret.step', email: 'a@b.c', name: 'Dana', project_name: 'X', package_name: 'Y', token: 't', body: 'c', extension: 'step' }),
    { file_id: 'f', extension: 'step' }
  );
  const row = buildCapture({ event: 'x', distinctId: 'u1', userId: 'u1', context: CTX, properties: { filename: 'a.pdf' }, set: { email: 'a@b.c', role: 'engineer' } }, 'u');
  assert.equal(row.properties.filename, undefined);
  assert.deepEqual(row.properties.$set, { role: 'engineer' });
});

test('$groupidentify names the workspace group and its properties', () => {
  assert.deepEqual(buildGroupIdentify('ws_1', 'u1', { pillar: 'PD' }, 'u'), {
    uuid: 'u', event: '$groupidentify', distinctId: 'u1',
    properties: { $group_type: 'workspace', $group_key: 'ws_1', $group_set: { pillar: 'PD' }, $lib: 'stiko-server' },
  });
});

test('the batch payload carries uuid and timestamp for dedupe', () => {
  const p = toBatchPayload('phc_x', [{ uuid: 'u', event: 'e', distinctId: 'd', properties: { a: 1 }, createdAt: '2026-11-15T00:00:00.000Z' }]);
  assert.deepEqual(p, { api_key: 'phc_x', batch: [{ uuid: 'u', event: 'e', distinct_id: 'd', properties: { a: 1 }, timestamp: '2026-11-15T00:00:00.000Z' }] });
});

test('billing events fire on entering trialing or active, never on repeats', () => {
  assert.deepEqual(billingTransitionEvents(null, 'active'), ['subscription_started']);
  assert.deepEqual(billingTransitionEvents('canceled', 'active'), ['subscription_started']);
  assert.deepEqual(billingTransitionEvents(null, 'trialing'), ['trial_started']);
  assert.deepEqual(billingTransitionEvents('trialing', 'active'), ['subscription_started']);
  assert.deepEqual(billingTransitionEvents('active', 'active'), []);
  assert.deepEqual(billingTransitionEvents('past_due', 'active'), []);
  assert.deepEqual(billingTransitionEvents('active', 'canceled'), []);
});

test('extension is lowercased and dotless', () => {
  assert.equal(extensionOf('Part.STEP'), 'step');
  assert.equal(extensionOf('noext'), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/analyticsEvents.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `lib/analytics/events.ts`**

```ts
/**
 * How a Stiko server event becomes a PostHog capture. Pure.
 *
 * The plan's rule 3: every event carries user_id, workspace_id, segment_id and
 * track. The spec's rule: no names, emails, filenames, comment text or tokens.
 */
import { analyticsAllowed } from '../geo.ts';

export interface WorkspaceContext {
  workspaceId: string | null;
  segmentId: string;
  track: string;
  analyticsConsent: string | null;
}

export interface CaptureRow {
  uuid: string;
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
}

export const ANONYMOUS_CONTEXT: WorkspaceContext = {
  workspaceId: null,
  segmentId: 'unknown',
  track: 'unknown',
  analyticsConsent: null,
};

const FORBIDDEN_KEYS = new Set([
  'filename', 'file_name', 'name', 'email', 'project_name', 'package_name',
  'token', 'invite_token', 'body', 'comment', 'note',
]);

export function stripForbidden(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) if (!FORBIDDEN_KEYS.has(k)) out[k] = v;
  return out;
}

export function buildCapture(
  input: {
    event: string;
    distinctId: string;
    userId: string | null;
    context: WorkspaceContext;
    properties?: Record<string, unknown>;
    set?: Record<string, unknown>;
    setOnce?: Record<string, unknown>;
  },
  uuid: string
): CaptureRow | null {
  const { context } = input;
  if (!analyticsAllowed(context.analyticsConsent)) return null;

  const properties: Record<string, unknown> = {
    ...stripForbidden(input.properties ?? {}),
    user_id: input.userId,
    workspace_id: context.workspaceId,
    segment_id: context.segmentId,
    track: context.track,
  };
  if (context.workspaceId) properties.$groups = { workspace: context.workspaceId };
  if (input.set) properties.$set = stripForbidden(input.set);
  if (input.setOnce) properties.$set_once = stripForbidden(input.setOnce);
  properties.$lib = 'stiko-server';

  return { uuid, event: input.event, distinctId: input.distinctId, properties };
}

export function buildGroupIdentify(
  workspaceId: string,
  distinctId: string,
  groupSet: Record<string, unknown>,
  uuid: string
): CaptureRow {
  return {
    uuid,
    event: '$groupidentify',
    distinctId,
    properties: {
      $group_type: 'workspace',
      $group_key: workspaceId,
      $group_set: stripForbidden(groupSet),
      $lib: 'stiko-server',
    },
  };
}

export function toBatchPayload(apiKey: string, rows: Array<CaptureRow & { createdAt: string }>) {
  return {
    api_key: apiKey,
    batch: rows.map((r) => ({
      uuid: r.uuid,
      event: r.event,
      distinct_id: r.distinctId,
      properties: r.properties,
      timestamp: r.createdAt,
    })),
  };
}

/**
 * Stripe status transitions that are funnel events. Stripe redelivers and
 * reorders webhooks; firing only on ENTERING a state is what makes it safe.
 * past_due → active is a recovered payment, not a new subscription.
 */
export function billingTransitionEvents(
  prev: string | null,
  next: string | null
): Array<'trial_started' | 'subscription_started'> {
  if (next === prev) return [];
  if (next === 'trialing') return ['trial_started'];
  if (next === 'active' && prev !== 'past_due') return ['subscription_started'];
  return [];
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tests/analyticsEvents.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/analytics/events.ts scripts/tests/analyticsEvents.test.mjs
git commit -m "feat(analytics): pure capture builder, PII stripping, billing transitions"
```

---

### Task 5: Outbox, workspaces and the server `track` API

**Files:**
- Create: `lib/analytics/outbox.ts`, `lib/workspaces.ts`, `lib/analytics/server.ts`
- Modify: `package.json` (dependency)
- Test: PGlite harness script (scratchpad, not committed)

**Interfaces:**
- Consumes: `buildCapture`, `buildGroupIdentify`, `toBatchPayload`, `ANONYMOUS_CONTEXT`, `extensionOf`, `CaptureRow`, `WorkspaceContext` (Task 4).
- Produces:
  - `lib/analytics/outbox.ts`: `enqueue(rows: CaptureRow[]): Promise<void>`, `flushOutbox(limit?: number): Promise<{ sent: number; failed: number }>`, `pruneOutbox(): Promise<number>`.
  - `lib/workspaces.ts`: `ensureWorkspace(userId: string): Promise<string>`, `workspaceContext(userId: string): Promise<WorkspaceContext>`, `markActivation(inviterUserId: string, openerUserId: string | null): Promise<boolean>`.
  - `lib/analytics/server.ts`: `serverAnalyticsEnabled(): boolean`, `track(event: string, opts: { userId?: string | null; anonymousId?: string | null; properties?: Record<string, unknown>; set?: Record<string, unknown>; setOnce?: Record<string, unknown> }): Promise<void>`, `identifyWorkspace(userId: string): Promise<void>`, `trackFileEvent(event: string, fileId: string, properties?: Record<string, unknown>): Promise<void>`, `posthogAnonymousId(cookieValue: string | undefined): string | null`.

- [ ] **Step 1: Install the dependency**

Run: `npm install @vercel/functions@latest --save-exact`
Expected: `package.json` gains `"@vercel/functions": "<exact version>"`; `package-lock.json` updated.

- [ ] **Step 2: Write `lib/analytics/outbox.ts`**

```ts
/**
 * The analytics outbox: every server event is written here first, then sent
 * to PostHog's /batch/ endpoint. A PostHog outage costs latency, not events.
 *
 * Claiming is one UPDATE … RETURNING, so two concurrent flushes never send the
 * same row within a minute; PostHog also dedupes on uuid.
 */
import { sql } from '@/lib/db';
import { toBatchPayload, type CaptureRow } from '@/lib/analytics/events';

const MAX_ATTEMPTS = 20;

export async function enqueue(rows: CaptureRow[]): Promise<void> {
  for (const r of rows) {
    await sql`
      INSERT INTO analytics_outbox (uuid, event, distinct_id, properties)
      VALUES (${r.uuid}, ${r.event}, ${r.distinctId}, ${JSON.stringify(r.properties)}::jsonb)
      ON CONFLICT (uuid) DO NOTHING
    `;
  }
}

export async function flushOutbox(limit = 100): Promise<{ sent: number; failed: number }> {
  const apiKey = process.env.POSTHOG_PROJECT_KEY;
  if (!apiKey) return { sent: 0, failed: 0 };
  const host = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com';

  const claimed = (await sql`
    UPDATE analytics_outbox
    SET attempts = attempts + 1, last_attempt_at = now()
    WHERE id IN (
      SELECT id FROM analytics_outbox
      WHERE sent_at IS NULL AND attempts < ${MAX_ATTEMPTS}
        AND (last_attempt_at IS NULL OR last_attempt_at < now() - interval '1 minute')
      ORDER BY id
      LIMIT ${limit}
    )
    RETURNING id, uuid, event, distinct_id AS "distinctId", properties,
              created_at AS "createdAt"
  `) as Array<CaptureRow & { id: number; createdAt: string | Date }>;
  if (claimed.length === 0) return { sent: 0, failed: 0 };

  const ids = claimed.map((r) => r.id);
  const payload = toBatchPayload(
    apiKey,
    claimed.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }))
  );

  try {
    const res = await fetch(`${host}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`PostHog /batch/ answered ${res.status}`);
    await sql`UPDATE analytics_outbox SET sent_at = now(), last_error = NULL WHERE id = ANY(${ids})`;
    return { sent: ids.length, failed: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`UPDATE analytics_outbox SET last_error = ${message.slice(0, 500)} WHERE id = ANY(${ids})`;
    console.error('[analytics] flush failed; rows kept for retry:', message);
    return { sent: 0, failed: ids.length };
  }
}

/** Sent rows are kept 30 days for debugging, then dropped by the daily cron. */
export async function pruneOutbox(): Promise<number> {
  const rows = await sql`
    DELETE FROM analytics_outbox WHERE sent_at < now() - interval '30 days' RETURNING id
  `;
  return rows.length;
}
```

- [ ] **Step 3: Write `lib/workspaces.ts`**

```ts
/**
 * One hidden workspace per account (spec §4). It holds the firm's KYC answers
 * and is the PostHog group. A future teams feature adds members to it; its id
 * never changes, so analytics history survives.
 */
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { ANONYMOUS_CONTEXT, type WorkspaceContext } from '@/lib/analytics/events';

/** Idempotent; safe under concurrent calls thanks to the UNIQUE owner_user_id. */
export async function ensureWorkspace(userId: string): Promise<string> {
  const rows = await sql`
    INSERT INTO workspaces (id, owner_user_id) VALUES (${uuidv4()}, ${userId})
    ON CONFLICT (owner_user_id) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id
    RETURNING id
  `;
  return rows[0].id as string;
}

export async function workspaceContext(userId: string): Promise<WorkspaceContext> {
  const rows = await sql`
    SELECT w.id AS "workspaceId", w.segment_id AS "segmentId", w.track,
           u.analytics_consent AS "analyticsConsent"
    FROM users u LEFT JOIN workspaces w ON w.owner_user_id = u.id
    WHERE u.id = ${userId}
  `;
  const r = rows[0] as
    | { workspaceId: string | null; segmentId: string | null; track: string | null; analyticsConsent: string | null }
    | undefined;
  if (!r) return ANONYMOUS_CONTEXT;
  return {
    workspaceId: r.workspaceId ?? (await ensureWorkspace(userId)),
    segmentId: r.segmentId ?? 'unknown',
    track: r.track ?? 'unknown',
    analyticsConsent: r.analyticsConsent,
  };
}

/**
 * Activation (plan): an external reviewer opens a review link within 7 days of
 * signup. Returns true only the first time, so the caller re-sends the group.
 */
export async function markActivation(inviterUserId: string, openerUserId: string | null): Promise<boolean> {
  if (openerUserId === inviterUserId) return false;
  const rows = await sql`
    UPDATE workspaces SET activated_at = now()
    WHERE owner_user_id = ${inviterUserId}
      AND activated_at IS NULL
      AND created_at > now() - interval '7 days'
    RETURNING id
  `;
  return rows.length > 0;
}
```

- [ ] **Step 4: Write `lib/analytics/server.ts`**

```ts
/**
 * The only analytics API route handlers call. Every function here swallows its
 * own errors: analytics must never fail, block or slow a user action.
 */
import { randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { sql } from '@/lib/db';
import { ANONYMOUS_CONTEXT, buildCapture, buildGroupIdentify, extensionOf } from '@/lib/analytics/events';
import { enqueue, flushOutbox } from '@/lib/analytics/outbox';
import { workspaceContext } from '@/lib/workspaces';

export function serverAnalyticsEnabled(): boolean {
  return Boolean(process.env.POSTHOG_PROJECT_KEY);
}

function scheduleFlush(): void {
  const p = flushOutbox().catch((err) => console.error('[analytics] flush threw', err));
  try {
    waitUntil(p);
  } catch {
    // Outside a Vercel request context (tests, scripts) the promise still runs.
  }
}

export async function track(
  event: string,
  opts: {
    userId?: string | null;
    anonymousId?: string | null;
    properties?: Record<string, unknown>;
    set?: Record<string, unknown>;
    setOnce?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    if (!serverAnalyticsEnabled()) return;
    const userId = opts.userId ?? null;
    const distinctId = userId ?? opts.anonymousId ?? null;
    if (!distinctId) return;
    const context = userId ? await workspaceContext(userId) : ANONYMOUS_CONTEXT;
    const row = buildCapture(
      { event, distinctId, userId, context, properties: opts.properties, set: opts.set, setOnce: opts.setOnce },
      randomUUID()
    );
    if (!row) return;
    await enqueue([row]);
    scheduleFlush();
  } catch (err) {
    console.error(`[analytics] track(${event}) failed`, err);
  }
}

/** Sends the workspace's firm properties as a PostHog group. */
export async function identifyWorkspace(userId: string): Promise<void> {
  try {
    if (!serverAnalyticsEnabled()) return;
    const context = await workspaceContext(userId);
    if (!context.workspaceId || context.analyticsConsent === 'denied' || context.analyticsConsent === 'pending') return;
    const rows = await sql`
      SELECT pillar, segment_id, client_model, company_size_band, track, country, region,
             is_business_email, activated_at, utm_first
      FROM workspaces WHERE id = ${context.workspaceId}
    `;
    const w = rows[0] as Record<string, unknown> | undefined;
    if (!w) return;
    const utm = (w.utm_first ?? {}) as Record<string, string>;
    const groupSet: Record<string, unknown> = {
      pillar: w.pillar, segment_id: w.segment_id, client_model: w.client_model,
      company_size_band: w.company_size_band, track: w.track, country: w.country, region: w.region,
      is_business_email: w.is_business_email,
      activated_at: w.activated_at ? new Date(w.activated_at as string).toISOString() : null,
      first_utm_source: utm.utm_source ?? null, first_utm_medium: utm.utm_medium ?? null,
      first_utm_campaign: utm.utm_campaign ?? null,
    };
    await enqueue([buildGroupIdentify(context.workspaceId, userId, groupSet, randomUUID())]);
    scheduleFlush();
  } catch (err) {
    console.error('[analytics] identifyWorkspace failed', err);
  }
}

/** For routes with no session (conversion callbacks): the uploader is the actor. */
export async function trackFileEvent(
  event: string,
  fileId: string,
  properties: Record<string, unknown> = {}
): Promise<void> {
  try {
    if (!serverAnalyticsEnabled()) return;
    const rows = await sql`SELECT uploaded_by AS "userId", filename FROM files WHERE id = ${fileId}`;
    const r = rows[0] as { userId: string | null; filename: string } | undefined;
    if (!r?.userId) return;
    await track(event, {
      userId: r.userId,
      properties: { file_id: fileId, extension: extensionOf(r.filename), ...properties },
    });
  } catch (err) {
    console.error(`[analytics] trackFileEvent(${event}) failed`, err);
  }
}

/**
 * posthog-js stores {"distinct_id": …} in the ph_<key>_posthog cookie. Reading
 * it lets an anonymous server event join the visitor's browser history.
 * Absent (declined, blocked, first request) → no anonymous event.
 */
export function posthogAnonymousId(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(cookieValue)) as { distinct_id?: unknown };
    return typeof parsed.distinct_id === 'string' && parsed.distinct_id ? parsed.distinct_id : null;
  } catch {
    return null;
  }
}

export function posthogCookieName(): string | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  return key ? `ph_${key}_posthog` : null;
}
```

- [ ] **Step 5: Verify against PGlite.** In the scratchpad harness (stubs `@/lib/db` → PGlite, schema.sql + 019 loaded), run a script that:
  1. Inserts a user `u1`, calls `ensureWorkspace('u1')` twice → same id both times.
  2. Calls `workspaceContext('u1')` → `{ segmentId: 'unknown', track: 'unknown', analyticsConsent: null }` with a workspace id.
  3. Sets `POSTHOG_PROJECT_KEY=phc_test`, stubs `globalThis.fetch` to record calls and return `{ ok: true, status: 200 }`, calls `track('project_created', { userId: 'u1', properties: { project_id: 'p1', filename: 'x.step' } })`, awaits `flushOutbox()` → one fetch to `https://us.i.posthog.com/batch/`, body has `segment_id: 'unknown'` and no `filename`; the row has `sent_at` set.
  4. Stubs fetch to return `{ ok: false, status: 503 }`, enqueues another event, flushes → row unsent, `attempts = 1`, `last_error` contains `503`; immediate second flush claims nothing (1-minute backoff).
  5. Makes the `sql` stub throw for `INSERT INTO analytics_outbox` and calls `track(...)` → resolves without throwing, logs `[analytics] track(...) failed`.
  6. `UPDATE users SET analytics_consent = 'denied'` → `track` inserts nothing.

Expected: all six checks print OK.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/analytics/outbox.ts lib/workspaces.ts lib/analytics/server.ts
git commit -m "feat(analytics): server track API with outbox, workspaces and activation"
```

---

### Task 6: Profile cookie and gate rules (pure)

**Files:**
- Create: `lib/kyc/profileCookie.ts`, `lib/kyc/gate.ts`
- Test: `scripts/tests/kycGate.test.mjs`

**Interfaces:**
- Produces:
  - `profileCookie.ts`: `PROFILE_COOKIE = 'stiko_profile'`, `PROFILE_COOKIE_MAX_AGE` (seconds, 1 year), `signProfileCookie(subject: string, secret: string): Promise<string>`, `profileCookieValid(value: string | undefined, subject: string, secret: string | undefined): Promise<boolean>`.
  - `gate.ts`: `kycGateEnabled(value?: string): boolean`, `isGatedPage(pathname: string): boolean`, `welcomeRedirectPath(pathname: string, search: string): string`.

- [ ] **Step 1: Write the failing test** — `scripts/tests/kycGate.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signProfileCookie, profileCookieValid } from '../../lib/kyc/profileCookie.ts';
import { kycGateEnabled, isGatedPage, welcomeRedirectPath } from '../../lib/kyc/gate.ts';

const SECRET = 'test-secret-0123456789';

test('a signed cookie validates only for its own subject and secret', async () => {
  const v = await signProfileCookie('user_01ABC', SECRET);
  assert.equal(await profileCookieValid(v, 'user_01ABC', SECRET), true);
  assert.equal(await profileCookieValid(v, 'user_02XYZ', SECRET), false);
  assert.equal(await profileCookieValid(v, 'user_01ABC', 'other-secret'), false);
  assert.equal(await profileCookieValid(v.slice(0, -2) + 'xx', 'user_01ABC', SECRET), false);
  assert.equal(await profileCookieValid(undefined, 'user_01ABC', SECRET), false);
  assert.equal(await profileCookieValid(v, 'user_01ABC', undefined), false);
});

test('the gate is on unless KYC_GATE is exactly off', () => {
  assert.equal(kycGateEnabled(undefined), true);
  assert.equal(kycGateEnabled('on'), true);
  assert.equal(kycGateEnabled('off'), false);
});

test('signed-in app pages are gated', () => {
  for (const p of ['/', '/new', '/settings', '/settings/billing', '/portal/abc', '/portal/abc/submit']) {
    assert.equal(isGatedPage(p), true, p);
  }
});

test('the welcome page, APIs, auth pages, invites, pricing and static files are not', () => {
  for (const p of [
    '/welcome', '/api/welcome', '/api/me', '/ingest/e/', '/login', '/signup', '/invite/tok',
    '/forgot-password', '/reset-password', '/verify-email', '/pricing',
    '/stiko-tracking.js', '/icon.svg', '/_next/static/x.js',
  ]) {
    assert.equal(isGatedPage(p), false, p);
  }
});

test('the redirect keeps the full destination, query included', () => {
  assert.equal(welcomeRedirectPath('/portal/abc', '?file=f1'), '/welcome?callbackUrl=%2Fportal%2Fabc%3Ffile%3Df1');
  assert.equal(welcomeRedirectPath('/', ''), '/welcome?callbackUrl=%2F');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/kycGate.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `lib/kyc/profileCookie.ts`**

```ts
/**
 * stiko_profile: "this browser's user has completed the KYC step", so the
 * middleware does not query the database on every page.
 *
 * A cache, not an authorization: forging it only skips a marketing form.
 * Web Crypto, so it runs in the edge middleware and in node --test alike.
 * The subject is the identity the middleware can see without a DB call: the
 * WorkOS user id under AUTH_PROVIDER=workos, the local users.id under nextauth.
 */

export const PROFILE_COOKIE = 'stiko_profile';
export const PROFILE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

async function hmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signProfileCookie(subject: string, secret: string): Promise<string> {
  return `${subject}.${await hmac(secret, `stiko-profile:${subject}`)}`;
}

export async function profileCookieValid(
  value: string | undefined,
  subject: string,
  secret: string | undefined
): Promise<boolean> {
  if (!value || !secret || !subject) return false;
  const expected = await signProfileCookie(subject, secret);
  if (value.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < value.length; i++) diff |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
```

- [ ] **Step 4: Write `lib/kyc/gate.ts`**

```ts
/**
 * Which page requests send a signed-in visitor without a business profile to
 * /welcome. Pure, tested, shared by both auth providers' middleware.
 *
 * Never gated: /welcome itself, every API route (the form must be able to
 * submit, and invite acceptance is an API call), auth and invite pages (an
 * invite is accepted BEFORE the gate, so it cannot be lost), /pricing, and any
 * path with a dot (static files).
 */

const UNGATED_PREFIXES = [
  '/welcome', '/api/', '/ingest', '/_next/', '/login', '/signup', '/invite',
  '/forgot-password', '/reset-password', '/verify-email', '/pricing',
];

export function kycGateEnabled(value: string | undefined = process.env.KYC_GATE): boolean {
  return value !== 'off';
}

export function isGatedPage(pathname: string): boolean {
  if (pathname.includes('.')) return false;
  // '/api/' already ends in a slash; '/welcome' must match '/welcome' and
  // '/welcome/…' but not '/welcomes'.
  return !UNGATED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`)
  );
}

export function welcomeRedirectPath(pathname: string, search: string): string {
  return `/welcome?${new URLSearchParams({ callbackUrl: `${pathname}${search}` }).toString()}`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test scripts/tests/kycGate.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/kyc/profileCookie.ts lib/kyc/gate.ts scripts/tests/kycGate.test.mjs
git commit -m "feat(kyc): signed profile cookie and gate rules"
```

---

### Task 7: Wire the gate into middleware, and the proxy/static exemptions

**Files:**
- Create: `lib/kyc/gateLookup.ts`
- Modify: `middleware.ts`, `lib/routeAccess.ts`, `next.config.mjs`
- Test: `scripts/tests/routeAccess.test.mjs` (exists; imports `routeDecision` from `../../lib/routeAccess.ts`)

**Interfaces:**
- Consumes: `isGatedPage`, `kycGateEnabled`, `welcomeRedirectPath` (Task 6), `PROFILE_COOKIE`, `PROFILE_COOKIE_MAX_AGE`, `profileCookieValid`, `signProfileCookie` (Task 6).
- Produces: `profileCompletedFor(subject: { workosUserId: string } | { userId: string }): Promise<boolean | null>` (null = lookup failed → let them through). `routeDecision('/api/geo', false) === 'pass'`.

- [ ] **Step 1: Add the routeAccess test** (append to `scripts/tests/routeAccess.test.mjs`):

```js
test('/api/geo is public, exactly', () => {
  assert.equal(routeDecision('/api/geo', false), 'pass');
  assert.equal(routeDecision('/api/geography', false), 'login');
});
```

Run: `npm test` → Expected: the new test FAILS.

- [ ] **Step 2: Edit `lib/routeAccess.ts`** — add after the `/pricing` exact match:

```ts
  // The consent banner asks this before anyone has an account, from both the
  // app and the Webflow marketing site. Returns one boolean. Exact match.
  if (pathname === '/api/geo') return 'pass';
```

Run: `npm test` → Expected: PASS.

- [ ] **Step 3: Write `lib/kyc/gateLookup.ts`**

```ts
/**
 * One read for the middleware: has this person completed the business profile?
 * Neon's HTTP driver works in the edge runtime. Returns null on any failure so
 * a database hiccup lets people through instead of locking everyone out.
 */
import { sql } from '@/lib/db';

export async function profileCompletedFor(
  subject: { workosUserId: string } | { userId: string }
): Promise<boolean | null> {
  try {
    const rows =
      'workosUserId' in subject
        ? await sql`SELECT profile_completed_at FROM users WHERE workos_user_id = ${subject.workosUserId} LIMIT 1`
        : await sql`SELECT profile_completed_at FROM users WHERE id = ${subject.userId} LIMIT 1`;
    if (!rows[0]) return null;
    return rows[0].profile_completed_at !== null;
  } catch (err) {
    console.error('[kyc] profile lookup failed; letting the request through', err);
    return null;
  }
}
```

- [ ] **Step 4: Edit `middleware.ts`.** Add imports:

```ts
import { isGatedPage, kycGateEnabled, welcomeRedirectPath } from '@/lib/kyc/gate';
import { PROFILE_COOKIE, PROFILE_COOKIE_MAX_AGE, profileCookieValid, signProfileCookie } from '@/lib/kyc/profileCookie';
import { profileCompletedFor } from '@/lib/kyc/gateLookup';
```

Add this helper above `nextAuthMiddleware`:

```ts
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
  // NextResponse in both branches below; .cookies is available on it.
  (response as NextResponse).cookies.set(PROFILE_COOKIE, value, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
    path: '/', maxAge: PROFILE_COOKIE_MAX_AGE,
  });
}
```

Replace `nextAuthMiddleware` body with:

```ts
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
```

In `workosMiddleware`, replace the final `return handleAuthkitProxy(request, headers);` with:

```ts
  if (session.user) {
    const gate = await kycGate(request, { workosUserId: session.user.id });
    if (gate.kind === 'welcome') {
      return handleAuthkitProxy(request, headers, { redirect: gate.path });
    }
    const res = await handleAuthkitProxy(request, headers);
    if (gate.kind === 'pass+cookie') setProfileCookie(res, gate.value);
    return res;
  }

  return handleAuthkitProxy(request, headers);
```

Change the matcher to also exclude the PostHog proxy and the tracking script:

```ts
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|uploads|occt-import-js.wasm|rhino3dm/|ingest|stiko-tracking.js).*)'],
```

and add one line to the comment above it: `// ingest: the PostHog reverse proxy (next.config.mjs rewrites). stiko-tracking.js: the consent + UTM script, loaded signed-out by www.stiko.design.`

Before relying on `handleAuthkitProxy`'s return type, open `node_modules/@workos-inc/authkit-nextjs/dist/esm/types/*.d.ts` (or the package's `index.d.ts`) and confirm `handleAuthkitProxy` returns `NextResponse | Promise<NextResponse>`; if it returns `Promise`, the `await` above is correct; if not, `await` on a non-promise is harmless.

- [ ] **Step 5: Edit `next.config.mjs`** — add `rewrites` (order matters: static and array before the catch-all). Do NOT add `skipTrailingSlashRedirect`: it changes trailing-slash handling for the whole app; without it PostHog requests cost one extra 308 round trip, which is acceptable.

```js
const nextConfig = {
  async rewrites() {
    // PostHog reverse proxy, so ad blockers do not drop events. US Cloud.
    return [
      { source: '/ingest/static/:path*', destination: 'https://us-assets.i.posthog.com/static/:path*' },
      { source: '/ingest/array/:path*', destination: 'https://us-assets.i.posthog.com/array/:path*' },
      { source: '/ingest/:path*', destination: 'https://us.i.posthog.com/:path*' },
    ];
  },
  webpack: (config, { isServer, webpack }) => {
    // …unchanged…
  },
};
```

- [ ] **Step 6: Verify**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all pass; build succeeds (middleware compiles for edge — if the build reports `node:crypto` or another Node built-in pulled into middleware, the culprit is an import chain from `lib/kyc/gateLookup.ts`; it must only import `@/lib/db`).

- [ ] **Step 7: Commit**

```bash
git add lib/kyc/gateLookup.ts middleware.ts lib/routeAccess.ts next.config.mjs scripts/tests/
git commit -m "feat(kyc): middleware gate to /welcome, PostHog proxy rewrites, /api/geo public"
```

---

### Task 8: The `/welcome` step (route + page) and `/api/me` additions

**Files:**
- Create: `app/api/welcome/route.ts`, `app/welcome/page.tsx`
- Modify: `app/api/me/route.ts`

**Interfaces:**
- Consumes: `validateProfile`, `trackForSize`, `isBusinessEmail`, `businessTypesFor`, `isOtherSegment` (Task 1); catalog arrays; `ensureWorkspace` (Task 5); `track`, `identifyWorkspace` (Task 5); `CONSENT_COOKIE`, `consentValue` (Task 3); `PROFILE_COOKIE`, `PROFILE_COOKIE_MAX_AGE`, `signProfileCookie` (Task 6); `safeCallbackUrl` (`lib/callbackUrl.ts`); `authProvider()` (`lib/authProvider.ts`).
- Produces: `POST /api/welcome` body `{ pillar, segmentId, businessTypeOther?, clientModel, companySizeBand, role, marketingConsent, callbackUrl }` → `200 { redirectPath }` | `400 { error: 'invalid', field }` | `401`. `GET /api/me` additionally returns `workspaceId: string | null`, `profileCompleted: boolean`.

- [ ] **Step 1: Write `app/api/welcome/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { authProvider } from '@/lib/authProvider';
import { safeCallbackUrl } from '@/lib/callbackUrl';
import { isBusinessEmail, trackForSize, validateProfile } from '@/lib/kyc/profile';
import { PROFILE_COOKIE, PROFILE_COOKIE_MAX_AGE, signProfileCookie } from '@/lib/kyc/profileCookie';
import { CONSENT_COOKIE, consentValue } from '@/lib/geo';
import { ensureWorkspace } from '@/lib/workspaces';
import { identifyWorkspace, track } from '@/lib/analytics/server';

/** POST — save the business profile (spec §3.5). Idempotent. */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  const result = validateProfile(body);
  if (!result.ok) return NextResponse.json({ error: 'invalid', field: result.field }, { status: 400 });
  const a = result.answers;

  const country = request.headers.get('x-vercel-ip-country');
  const region = request.headers.get('x-vercel-ip-country-region');
  const consent = consentValue(cookies().get(CONSENT_COOKIE)?.value);

  const workspaceId = await ensureWorkspace(userId);
  const users = await sql`
    SELECT email, utm_first, workos_user_id, profile_completed_at FROM users WHERE id = ${userId}
  `;
  const user = users[0] as
    | { email: string; utm_first: unknown; workos_user_id: string | null; profile_completed_at: string | null }
    | undefined;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const resubmitted = user.profile_completed_at !== null;
  const trackValue = trackForSize(a.companySizeBand);
  const businessEmail = isBusinessEmail(user.email);
  const utmFirst = user.utm_first ? JSON.stringify(user.utm_first) : null;

  await sql.transaction([
    sql`
      UPDATE workspaces SET
        pillar = ${a.pillar}, segment_id = ${a.segmentId},
        business_type_other = ${a.businessTypeOther}, client_model = ${a.clientModel},
        company_size_band = ${a.companySizeBand}, track = ${trackValue},
        country = COALESCE(${country}, country), region = COALESCE(${region}, region),
        is_business_email = ${businessEmail},
        utm_first = COALESCE(utm_first, ${utmFirst}::jsonb)
      WHERE id = ${workspaceId}
    `,
    sql`
      UPDATE users SET
        role = ${a.role},
        profile_completed_at = COALESCE(profile_completed_at, now()),
        is_business_email = ${businessEmail},
        marketing_consent = ${a.marketingConsent},
        marketing_consent_at = CASE WHEN ${a.marketingConsent} THEN now() ELSE NULL END,
        marketing_consent_method = CASE WHEN ${a.marketingConsent} THEN 'welcome_checkbox' ELSE NULL END,
        analytics_consent = COALESCE(${consent}, analytics_consent)
      WHERE id = ${userId}
    `,
  ]);

  await track('company_profile_completed', {
    userId,
    properties: {
      pillar: a.pillar, segment_id: a.segmentId, client_model: a.clientModel,
      company_size_band: a.companySizeBand, role: a.role, country, region,
      track: trackValue, marketing_consent: a.marketingConsent, resubmitted,
    },
    set: { role: a.role, marketing_consent: a.marketingConsent, is_business_email: businessEmail },
  });
  await identifyWorkspace(userId);

  const redirectPath = safeCallbackUrl(typeof body?.callbackUrl === 'string' ? body.callbackUrl : null);
  const res = NextResponse.json({ redirectPath });

  const secret = process.env.PROFILE_COOKIE_SECRET;
  const subject = authProvider() === 'workos' ? user.workos_user_id : userId;
  if (secret && subject) {
    res.cookies.set(PROFILE_COOKIE, await signProfileCookie(subject, secret), {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
      path: '/', maxAge: PROFILE_COOKIE_MAX_AGE,
    });
  }
  return res;
}
```

Note: `track` in `company_profile_completed` reads `workspaceContext` AFTER the transaction, so the event already carries the new `segment_id` and `track`. The explicit `track: trackValue` property is overwritten by the standard property with the same value — that is intended.

- [ ] **Step 2: Edit `app/api/me/route.ts` GET** — replace the SELECT with:

```ts
  const rows = await sql`
    SELECT u.id, u.name, u.email, u.job_title AS "jobTitle", u.company,
           u.email_paused_until AS "emailPausedUntil",
           w.id AS "workspaceId",
           (u.profile_completed_at IS NOT NULL) AS "profileCompleted"
    FROM users u LEFT JOIN workspaces w ON w.owner_user_id = u.id
    WHERE u.id = ${session.user.id}
  `;
```

- [ ] **Step 3: Write `app/welcome/page.tsx`**

```tsx
'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import Button from '@/components/ui/Button';
import { ErrorBanner, Field, Input } from '@/components/ui/Primitives';
import { CLIENT_MODELS, OTHER_TEXT_MAX, PILLARS, ROLES, SIZE_BANDS, type PillarId } from '@/lib/kyc/catalog';
import { businessTypesFor, isOtherSegment } from '@/lib/kyc/profile';
import { safeCallbackUrl } from '@/lib/callbackUrl';

const PRIVACY_URL = 'https://www.stiko.design/privacy';

const FIELD_ERRORS: Record<string, string> = {
  pillar: 'Pick what best describes your work.',
  segmentId: 'Pick your type of business.',
  businessTypeOther: 'Tell us what your business does (up to 120 characters).',
  clientModel: 'Tell us who you design or build for.',
  companySizeBand: 'Pick your company size.',
  role: 'Pick your role.',
};

function chip(selected: boolean) {
  return `rounded-[10px] border-[1.5px] px-3 py-[9px] text-left text-[13px] transition ${
    selected
      ? 'border-stiko-primary bg-stiko-tint font-bold text-stiko-ink'
      : 'border-stiko-divider bg-white text-stiko-secondary hover:border-stiko-primary'
  }`;
}

function WelcomeForm() {
  const router = useRouter();
  const callbackUrl = safeCallbackUrl(useSearchParams().get('callbackUrl'));

  const [pillar, setPillar] = useState<PillarId | ''>('');
  const [segmentId, setSegmentId] = useState('');
  const [other, setOther] = useState('');
  const [clientModel, setClientModel] = useState('');
  const [size, setSize] = useState('');
  const [role, setRole] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const types = useMemo(() => (pillar ? businessTypesFor(pillar) : []), [pillar]);
  const needsOther = isOtherSegment(segmentId);
  const complete =
    pillar && segmentId && clientModel && size && role && (!needsOther || other.trim().length > 0);

  const choosePillar = (id: PillarId) => {
    if (id !== pillar) {
      setPillar(id);
      setSegmentId('');
      setOther('');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complete) return;
    setSaving(true);
    setError(null);
    const res = await fetch('/api/welcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pillar, segmentId, businessTypeOther: needsOther ? other : undefined,
        clientModel, companySizeBand: size, role, marketingConsent, callbackUrl,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      // A full navigation, not router.push: the middleware must see the new
      // stiko_profile cookie on the next request.
      window.location.assign(data.redirectPath ?? '/');
      return;
    }
    setSaving(false);
    if (res.status === 401) {
      router.push(`/login?callbackUrl=${encodeURIComponent(`/welcome?callbackUrl=${encodeURIComponent(callbackUrl)}`)}`);
      return;
    }
    setError(FIELD_ERRORS[data.field] ?? 'Could not save your answers. Try again.');
  };

  return (
    <AuthShell title="Tell us about your work" subtitle="Five quick questions so stiko fits how you review." width={560}>
      <form onSubmit={submit} className="flex flex-col gap-[22px]">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        <fieldset>
          <legend className="mb-[8px] text-[12px] font-bold text-stiko-secondary">What best describes your work?</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PILLARS.map((p) => (
              <button key={p.id} type="button" aria-pressed={pillar === p.id} onClick={() => choosePillar(p.id)} className={chip(pillar === p.id)}>
                {p.label}
              </button>
            ))}
          </div>
        </fieldset>

        {pillar && (
          <fieldset>
            <legend className="mb-[8px] text-[12px] font-bold text-stiko-secondary">Which best describes your business?</legend>
            <div className="flex max-h-[300px] flex-col gap-[6px] overflow-y-auto pr-1">
              {types.map((t) => (
                <button key={t.id} type="button" aria-pressed={segmentId === t.id} onClick={() => setSegmentId(t.id)} className={chip(segmentId === t.id)}>
                  <span className="block">{t.label}</span>
                  <span className="block text-[11.5px] font-medium text-stiko-faint">{t.helper}</span>
                </button>
              ))}
            </div>
            {needsOther && (
              <div className="mt-[10px]">
                <Field label="What does your business do?">
                  <Input value={other} maxLength={OTHER_TEXT_MAX} onChange={(e) => setOther(e.target.value)} autoFocus />
                </Field>
              </div>
            )}
          </fieldset>
        )}

        <fieldset>
          <legend className="mb-[8px] text-[12px] font-bold text-stiko-secondary">Who do you design or build for?</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {CLIENT_MODELS.map((c) => (
              <button key={c.id} type="button" aria-pressed={clientModel === c.id} onClick={() => setClientModel(c.id)} className={chip(clientModel === c.id)}>
                {c.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-[8px] text-[12px] font-bold text-stiko-secondary">How many people work at your company?</legend>
          <div className="flex flex-wrap gap-2">
            {SIZE_BANDS.map((s) => (
              <button key={s.id} type="button" aria-pressed={size === s.id} onClick={() => setSize(s.id)} className={chip(size === s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </fieldset>

        <Field label="What is your role?">
          <select value={role} onChange={(e) => setRole(e.target.value)} required
            className="w-full rounded-[10px] border-[1.5px] border-stiko-divider bg-white px-[13px] py-[11px] text-[13.5px] text-stiko-ink outline-none focus:border-stiko-primary">
            <option value="" disabled>Choose…</option>
            {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </Field>

        <label className="flex items-start gap-[10px] text-[12.5px] text-stiko-secondary">
          <input type="checkbox" checked={marketingConsent} onChange={(e) => setMarketingConsent(e.target.checked)} className="mt-[2px]" />
          <span>Send me product news and tips from stiko. You can unsubscribe at any time.</span>
        </label>

        <Button type="submit" fullWidth disabled={!complete || saving} className="!py-3">
          {saving ? 'Saving…' : 'Continue'}
        </Button>

        <p className="text-center text-[11.5px] text-stiko-faint">
          We use your answers to tailor stiko and our emails.{' '}
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="font-bold underline">Privacy policy</a>
        </p>
      </form>
    </AuthShell>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={null}>
      <WelcomeForm />
    </Suspense>
  );
}
```

Check: `Button` accepts `fullWidth`, `disabled`, `className`, `type` (it does in `app/signup/page.tsx` and the invite page). If `bg-stiko-tint` is not a defined Tailwind token, use the class the invite page's left panel uses (`bg-stiko-tint` appears there, so it exists).

- [ ] **Step 4: Verify locally**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors. Then boot the app per memory note `stiko-local-visual-verification` and open `/welcome?callbackUrl=/` while signed in: picking a pillar shows 11 types with helper text; switching pillar clears the type; "Other" shows the text field; Continue stays disabled until all five are answered.

- [ ] **Step 5: Commit**

```bash
git add app/api/welcome/route.ts app/welcome/page.tsx app/api/me/route.ts
git commit -m "feat(kyc): required /welcome business profile and its API"
```

---

### Task 9: Signup, verification and attribution capture

**Files:**
- Create: `lib/analytics/signup.ts`
- Modify: `app/api/auth/workos/sign-up/route.ts`, `app/api/auth/workos/verify-email/route.ts`, `app/api/auth/signup/route.ts`, `app/signup/page.tsx`

**Interfaces:**
- Consumes: `parseTouchCookie`, `FIRST_TOUCH_COOKIE`, `LAST_TOUCH_COOKIE`, `signupSource`, `clickIds`, `inviteTokenFromCallback` (Task 3); `CONSENT_COOKIE`, `analyticsConsentAtSignup` (Task 3); `isBusinessEmail` (Task 1); `ensureWorkspace` (Task 5); `track` (Task 5).
- Produces: `recordSignup(request: NextRequest, userId: string, email: string, inviteToken: string | null | undefined): Promise<void>`.

- [ ] **Step 1: Write `lib/analytics/signup.ts`**

```ts
/**
 * Everything Stiko learns at account creation: signup source, the inviter's
 * workspace, first/last-touch UTMs, ad click IDs and consent. Saved on the
 * user (the permanent copy), then sent as signup_completed.
 *
 * Never throws: a signup must succeed even if this fails.
 */
import type { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { clickIds, FIRST_TOUCH_COOKIE, LAST_TOUCH_COOKIE, parseTouchCookie, signupSource } from '@/lib/attribution';
import { analyticsConsentAtSignup, CONSENT_COOKIE } from '@/lib/geo';
import { isBusinessEmail } from '@/lib/kyc/profile';
import { ensureWorkspace } from '@/lib/workspaces';
import { track } from '@/lib/analytics/server';

function prefixed(prefix: string, touch: Record<string, string> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(touch ?? {})) out[`${prefix}${k}`] = v;
  return out;
}

export async function recordSignup(
  request: NextRequest,
  userId: string,
  email: string,
  inviteToken: string | null | undefined
): Promise<void> {
  try {
    const c = request.cookies;
    const first = parseTouchCookie(c.get(FIRST_TOUCH_COOKIE)?.value);
    const last = parseTouchCookie(c.get(LAST_TOUCH_COOKIE)?.value);
    const ids = clickIds({
      first, last,
      fbc: c.get('_fbc')?.value, fbp: c.get('_fbp')?.value, ga: c.get('_ga')?.value,
    });
    const source = signupSource(inviteToken);
    const consent = analyticsConsentAtSignup(c.get(CONSENT_COOKIE)?.value, request.headers.get('x-vercel-ip-country'));
    const businessEmail = isBusinessEmail(email);

    let inviteId: string | null = null;
    let inviterWorkspaceId: string | null = null;
    if (inviteToken) {
      const rows = await sql`SELECT id, invited_by FROM invite_tokens WHERE token = ${inviteToken} LIMIT 1`;
      if (rows[0]) {
        inviteId = rows[0].id as string;
        if (rows[0].invited_by) inviterWorkspaceId = await ensureWorkspace(rows[0].invited_by as string);
      }
    }

    await ensureWorkspace(userId);
    await sql`
      UPDATE users SET
        signup_source = ${source}, invite_id = ${inviteId}, inviter_workspace_id = ${inviterWorkspaceId},
        is_business_email = ${businessEmail},
        utm_first = ${first ? JSON.stringify(first) : null}::jsonb,
        utm_last = ${last ? JSON.stringify(last) : null}::jsonb,
        click_ids = ${JSON.stringify(ids)}::jsonb,
        analytics_consent = ${consent}
      WHERE id = ${userId}
    `;

    const props = {
      signup_source: source, invite_id: inviteId, inviter_workspace_id: inviterWorkspaceId,
      is_business_email: businessEmail, ...prefixed('first_', first), ...prefixed('last_', last),
    };
    await track('signup_completed', {
      userId,
      properties: props,
      set: { signup_source: source, inviter_workspace_id: inviterWorkspaceId, is_business_email: businessEmail },
      setOnce: prefixed('first_', first),
    });
    if (source === 'reviewer_invite') {
      await track('reviewer_signup_completed', {
        userId, properties: { invite_id: inviteId, inviter_workspace_id: inviterWorkspaceId },
      });
    }
  } catch (err) {
    console.error('[analytics] recordSignup failed', err);
  }
}
```

- [ ] **Step 2: Edit `app/api/auth/workos/sign-up/route.ts`.** Add `import { recordSignup } from '@/lib/analytics/signup';`. After `if (!linked.ok) return failureResponse(...)` and before `return passwordSignIn(...)`, insert:

```ts
  await recordSignup(request, linked.userId, email, typeof inviteToken === 'string' ? inviteToken : null);
```

- [ ] **Step 3: Edit `app/api/auth/workos/verify-email/route.ts`.** Add `import { track } from '@/lib/analytics/server';`. Replace the `UPDATE users SET email_verified …` block with:

```ts
    const verified = await sql`
      UPDATE users SET email_verified = COALESCE(email_verified, NOW())
      WHERE workos_user_id = ${response.user.id}
      RETURNING id
    `;
    if (verified[0]) await track('email_verified', { userId: verified[0].id as string });
```

- [ ] **Step 4: Edit `app/api/auth/signup/route.ts`** (NextAuth rollback path). Add `import { recordSignup } from '@/lib/analytics/signup';`; after the `INSERT INTO users` statement insert `await recordSignup(request, id, email, null);`.

- [ ] **Step 5: Edit `app/signup/page.tsx`** so a reviewer who reaches `/signup?callbackUrl=/invite/<token>` is attributed. Add `import { inviteTokenFromCallback } from '@/lib/attribution';` and change the call to:

```tsx
    const inviteToken = inviteTokenFromCallback(callbackUrl) ?? undefined;
    const result = await signUp({ name, email, password, inviteToken });
```

Also add a privacy link to the `below` prop, after the "Sign in" link:

```tsx
          <span className="mt-2 block text-[11.5px]">
            <a href="https://www.stiko.design/privacy" target="_blank" rel="noreferrer" className="underline">Privacy policy</a>
          </span>
```

(Sending `inviteToken` from `/signup` also lets an addressed invitee skip the emailed code, exactly as signing up on the invite page already does — the server's `inviteVouchesForEmail` check is unchanged.)

- [ ] **Step 6: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: PASS. In the PGlite harness: call `recordSignup` with a fake `NextRequest` carrying `stiko_ft` / `stiko_lt` / `_fbp` cookies and an invite token whose `invited_by` is `u0` → user row has `signup_source='reviewer_invite'`, `utm_first.utm_source` set, `click_ids.fbp` set, `inviter_workspace_id` = u0's workspace; with the `sql` stub throwing, `recordSignup` resolves.

- [ ] **Step 7: Commit**

```bash
git add lib/analytics/signup.ts app/api/auth/workos/sign-up/route.ts app/api/auth/workos/verify-email/route.ts app/api/auth/signup/route.ts app/signup/page.tsx
git commit -m "feat(analytics): signup attribution, signup and verification events"
```

---

### Task 10: Product, review-loop and billing events

**Files:**
- Modify: `app/api/projects/route.ts`, `app/api/files/complete/route.ts`, `app/api/uploads/rejected/route.ts`, `app/api/conversions/cad-callback/route.ts`, `app/api/conversions/webhook/route.ts`, `app/api/files/[id]/convert-drawing/route.ts`, `app/api/files/[id]/convert-cad/route.ts`, `app/api/participants/route.ts`, `app/api/invite/[token]/route.ts`, `lib/stripe.ts`

**Interfaces:**
- Consumes: `track`, `trackFileEvent`, `identifyWorkspace`, `posthogAnonymousId`, `posthogCookieName` (Task 5); `markActivation`, `ensureWorkspace` (Task 5); `extensionOf`, `billingTransitionEvents` (Task 4); `isDrawingFilename` (`lib/drawingConversion.ts`), `isPendingCad` (`lib/cadConversion.ts`).
- Produces: `GET /api/invite/[token]` response gains `inviteId: string`.

- [ ] **Step 1: `app/api/projects/route.ts` POST** — add `import { track } from '@/lib/analytics/server';`; replace the final return with:

```ts
  await track('project_created', { userId: session.user.id, properties: { project_id: id } });
  return NextResponse.json(rows[0], { status: 201 });
```

- [ ] **Step 2: `app/api/files/complete/route.ts`** — add imports:

```ts
import { track } from '@/lib/analytics/server';
import { extensionOf } from '@/lib/analytics/events';
import { isDrawingFilename } from '@/lib/drawingConversion';
import { isPendingCad } from '@/lib/cadConversion';
```

Inside `if (refusal) { … }`, immediately before `return planLimitResponse(refusal);`:

```ts
    await track('file_upload_failed', {
      userId: session.user.id,
      properties: { extension: extensionOf(filename), reason_code: 'storage_limit' },
    });
```

Replace the final `return NextResponse.json({ ...file, fileSize: … }, { status: 201 });` with:

```ts
  const ext = extensionOf(filename);
  await track('file_uploaded', {
    userId: session.user.id,
    properties: { file_id: file.id, extension: ext, size_bytes: Number(file.fileSize) },
  });
  // Viewable now unless a server conversion still has to run (DWG/DXF → PDF,
  // SolidWorks → GLB); those fire file_processed when the conversion lands.
  // STEP converts in the viewer, so it counts as processed here.
  if (!isDrawingFilename(filename) && !isPendingCad(filename, convertedStorageKey)) {
    await track('file_processed', {
      userId: session.user.id,
      properties: { file_id: file.id, extension: ext, conversion: 'none' },
    });
  }
  return NextResponse.json({ ...file, fileSize: Number(file.fileSize) }, { status: 201 });
```

- [ ] **Step 3: `app/api/uploads/rejected/route.ts`** — add `import { track } from '@/lib/analytics/server';`; before the final `return new NextResponse(null, { status: 204 });`:

```ts
  for (const extension of extensions) {
    await track('file_upload_failed', {
      userId: session.user.id,
      properties: { extension, reason_code: 'unsupported_format' },
    });
  }
```

- [ ] **Step 4: Conversion routes** — add `import { trackFileEvent } from '@/lib/analytics/server';` to each, then:
  - `app/api/conversions/cad-callback/route.ts`: in the `callbackOutcome(body) === 'failed'` branch, before its `return`, add `await trackFileEvent('file_upload_failed', body.fileId, { reason_code: 'conversion_failed', converter: 'cad' });`. Before the final `return NextResponse.json({ ok: true });` add `await trackFileEvent('file_processed', body.fileId, { conversion: 'cad' });`.
  - `app/api/conversions/webhook/route.ts`: in the `event === 'job.failed'` branch before its return, and in the `catch (err)` after its UPDATE, add `await trackFileEvent('file_upload_failed', fileId, { reason_code: 'conversion_failed', converter: 'cloudconvert' });`. After the `UPDATE files SET conversion_status = 'completed' …` statement add `await trackFileEvent('file_processed', fileId, { conversion: 'cloudconvert' });`.
  - `app/api/files/[id]/convert-drawing/route.ts`: in `if (outcome === 'failed')` before its return add `await trackFileEvent('file_upload_failed', params.id, { reason_code: 'conversion_failed', converter: 'drawing' });`. After the `UPDATE files SET conversion_status = 'completed', converted_storage_key = ${targetKey}` statement add `await trackFileEvent('file_processed', params.id, { conversion: 'drawing' });`.
  - `app/api/files/[id]/convert-cad/route.ts`: in the `decision.kind === 'give-up'` branch, right after the `gaveUp` UPDATE, add `if (gaveUp.length > 0) await trackFileEvent('file_upload_failed', params.id, { reason_code: 'conversion_failed', converter: 'cad' });`.

- [ ] **Step 5: `app/api/participants/route.ts`** — add `import { track } from '@/lib/analytics/server';`; directly after the `invite_token_versions` loop (`if (!scopeAll && scopeIds.length > 0) { … }`):

```ts
  await track('sent_for_review', {
    userId: session.user.id,
    properties: { invite_id: rows[0].id, kind: isShareLink ? 'share_link' : 'invite', role },
  });
```

- [ ] **Step 6: `app/api/invite/[token]/route.ts` GET** — rename the unused `_request` parameter to `request`; add imports:

```ts
import { identifyWorkspace, posthogAnonymousId, posthogCookieName, track } from '@/lib/analytics/server';
import { ensureWorkspace, markActivation } from '@/lib/workspaces';
```

Immediately before the success `return NextResponse.json({ token: invite.token, …` add:

```ts
  try {
    const viewer = await auth();
    const viewerId = viewer?.user?.id ?? null;
    const cookieName = posthogCookieName();
    const anonymousId = cookieName ? posthogAnonymousId(request.cookies.get(cookieName)?.value) : null;
    const inviterWorkspaceId = invite.inviterId ? await ensureWorkspace(invite.inviterId as string) : null;
    await track('review_link_opened', {
      userId: viewerId,
      anonymousId,
      properties: { invite_id: invite.id, inviter_workspace_id: inviterWorkspaceId, signed_in: Boolean(viewerId) },
    });
    if (invite.inviterId && (await markActivation(invite.inviterId as string, viewerId))) {
      await identifyWorkspace(invite.inviterId as string);
    }
  } catch (err) {
    console.error('[analytics] review_link_opened failed', err);
  }
```

and add `inviteId: invite.id,` as the first property of that response object (the invite ID is not a credential; the token is, and must never reach PostHog).

- [ ] **Step 7: `lib/stripe.ts` `syncSubscription`** — add `import { track } from '@/lib/analytics/server';` and `import { billingTransitionEvents } from '@/lib/analytics/events';`. Change both SELECT/RETURNING lists in the function to also return `stripe_subscription_status AS "prevStatus"`, widen the `user` type to `{ id: string; subscriptionId: string | null; prevStatus: string | null }`, and after the final `UPDATE users …` statement (before `console.info`) add:

```ts
  for (const event of billingTransitionEvents(user.prevStatus, decision.status)) {
    const price = sub.items?.data?.[0]?.price;
    await track(event, {
      userId: user.id,
      properties: {
        plan: decision.plan,
        interval: price?.recurring?.interval ?? null,
        amount: typeof price?.unit_amount === 'number' ? price.unit_amount / 100 : null,
        currency: price?.currency ?? null,
        stripe_subscription_id: sub.id,
      },
      set: { plan: decision.plan, subscription_status: decision.status },
    });
  }
```

Check `decision.status` exists on the `apply` branch (it does: `{ kind: 'apply', plan, subscriptionId, status }` per `scripts/tests/billing.test.mjs`).

- [ ] **Step 8: Verify**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: PASS. Then grep that no event property carries a name or token: `git diff main -- app lib | grep -nE "track\(|trackFileEvent\(" ` and read each call's properties.

- [ ] **Step 9: Commit**

```bash
git add app/api/projects/route.ts app/api/files/complete/route.ts app/api/uploads/rejected/route.ts \
  app/api/conversions/cad-callback/route.ts app/api/conversions/webhook/route.ts \
  "app/api/files/[id]/convert-drawing/route.ts" "app/api/files/[id]/convert-cad/route.ts" \
  app/api/participants/route.ts "app/api/invite/[token]/route.ts" lib/stripe.ts
git commit -m "feat(analytics): P0 product, review-loop and billing events"
```

---

### Task 11: The consent + UTM script, `/api/geo` and `/api/analytics/consent`

**Files:**
- Create: `public/stiko-tracking.js`, `app/api/geo/route.ts`, `app/api/analytics/consent/route.ts`
- Test: `scripts/tests/stikoTracking.test.mjs`

**Interfaces:**
- Consumes: `consentRequired`, `consentValue` (Task 3).
- Produces: `window.stikoTracking = { state: 'pending' | 'granted' | 'denied' | 'not_required' | 'loading', accept(), decline() }`; a `stiko:tracking` `CustomEvent` on `window` with `detail.state` whenever the state settles; cookies `stiko_consent`, `stiko_ft`, `stiko_lt`. `GET /api/geo` → `{ consentRequired: boolean }`. `POST /api/analytics/consent` `{ consent: 'granted' | 'denied' }` → `204`.

- [ ] **Step 1: Write the failing test** — `scripts/tests/stikoTracking.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../public/stiko-tracking.js', import.meta.url), 'utf8');

function run({ href, cookies = {}, geo = { consentRequired: false }, referrer = '' }) {
  const jar = { ...cookies };
  const events = [];
  const appended = [];
  const document = {
    referrer,
    currentScript: { src: 'https://app.stiko.design/stiko-tracking.js' },
    get cookie() { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); },
    set cookie(str) { const [pair] = str.split(';'); const i = pair.indexOf('='); jar[pair.slice(0, i)] = pair.slice(i + 1); },
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {} }),
    body: { appendChild: (el) => appended.push(el) },
    readyState: 'complete',
    addEventListener() {},
  };
  const window = {
    location: new URL(href),
    dispatchEvent: (e) => events.push(e.detail.state),
  };
  const ctx = {
    window, document, URL, URLSearchParams, JSON, Date, encodeURIComponent, decodeURIComponent,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    fetch: async () => {
      if (geo === null) throw new Error('down');
      return { ok: true, json: async () => geo };
    },
  };
  vm.runInNewContext(SRC, ctx);
  return { jar, events, appended, window, flush: () => new Promise((r) => setTimeout(r, 0)) };
}

const decode = (v) => JSON.parse(decodeURIComponent(v));

test('outside consent countries, UTMs are written as first and last touch', async () => {
  const r = run({ href: 'https://www.stiko.design/?utm_source=Meta&utm_campaign=2026-11_meta_pd_trial&gclid=AbC' });
  await r.flush();
  assert.deepEqual(r.events, ['not_required']);
  const ft = decode(r.jar.stiko_ft);
  assert.equal(ft.utm_source, 'meta');
  assert.equal(ft.gclid, 'AbC');
  assert.equal(ft.landing_page, '/');
  assert.equal(decode(r.jar.stiko_lt).utm_campaign, '2026-11_meta_pd_trial');
});

test('first touch is never overwritten; last touch is', async () => {
  const first = encodeURIComponent(JSON.stringify({ utm_source: 'google' }));
  const r = run({ href: 'https://www.stiko.design/?utm_source=linkedin', cookies: { stiko_ft: first } });
  await r.flush();
  assert.equal(decode(r.jar.stiko_ft).utm_source, 'google');
  assert.equal(decode(r.jar.stiko_lt).utm_source, 'linkedin');
});

test('a visit without UTMs writes nothing', async () => {
  const r = run({ href: 'https://www.stiko.design/pricing' });
  await r.flush();
  assert.equal(r.jar.stiko_ft, undefined);
  assert.equal(r.jar.stiko_lt, undefined);
});

test('in a consent country nothing is written and the banner shows until Accept', async () => {
  const r = run({ href: 'https://www.stiko.design/?utm_source=meta', geo: { consentRequired: true } });
  await r.flush();
  assert.deepEqual(r.events, ['pending']);
  assert.equal(r.jar.stiko_ft, undefined);
  assert.equal(r.appended.length, 1);
  r.window.stikoTracking.accept();
  assert.equal(r.jar.stiko_consent, 'granted');
  assert.equal(decode(r.jar.stiko_ft).utm_source, 'meta');
  assert.deepEqual(r.events, ['pending', 'granted']);
});

test('decline is remembered and writes no attribution', async () => {
  const r = run({ href: 'https://www.stiko.design/?utm_source=meta', geo: { consentRequired: true } });
  await r.flush();
  r.window.stikoTracking.decline();
  assert.equal(r.jar.stiko_consent, 'denied');
  assert.equal(r.jar.stiko_ft, undefined);
  assert.deepEqual(r.events, ['pending', 'denied']);
});

test('a stored answer skips the geo call and the banner', async () => {
  const r = run({ href: 'https://app.stiko.design/?utm_source=x', cookies: { stiko_consent: 'denied' }, geo: { consentRequired: true } });
  await r.flush();
  assert.deepEqual(r.events, ['denied']);
  assert.equal(r.appended.length, 0);
});

test('a failed geo call fails closed (banner)', async () => {
  const r = run({ href: 'https://www.stiko.design/', geo: null });
  await r.flush();
  assert.deepEqual(r.events, ['pending']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tests/stikoTracking.test.mjs`
Expected: FAIL — ENOENT `public/stiko-tracking.js`.

- [ ] **Step 3: Write `public/stiko-tracking.js`**

```js
/*
 * stiko-tracking.js — consent, the EU/UK banner, and UTM capture.
 * Served by app.stiko.design and loaded by BOTH the app and the Webflow
 * marketing site (www.stiko.design), so one copy governs both.
 * Spec: docs/superpowers/specs/2026-11-15-kyc-and-posthog-design.md §6–7.
 *
 * It never loads PostHog itself. It announces the decision on window as a
 * 'stiko:tracking' CustomEvent (and window.stikoTracking.state); PostHog is
 * started by whoever listens, only for 'granted' or 'not_required'.
 */
(function () {
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'ttclid'];
  var MAX = 200;
  var DAY = 86400;
  var PRIVACY_URL = 'https://www.stiko.design/privacy';
  var scriptSrc = (document.currentScript && document.currentScript.src) || '';
  var GEO_URL = (scriptSrc ? new URL(scriptSrc).origin : '') + '/api/geo';
  var host = window.location.hostname;
  var domain = /(^|\.)stiko\.design$/.test(host) ? '; Domain=.stiko.design' : '';
  var secure = window.location.protocol === 'https:' ? '; Secure' : '';

  function readCookie(name) {
    var parts = document.cookie ? document.cookie.split('; ') : [];
    for (var i = 0; i < parts.length; i++) {
      var j = parts[i].indexOf('=');
      if (parts[i].slice(0, j) === name) return parts[i].slice(j + 1);
    }
    return undefined;
  }
  function writeCookie(name, value, days) {
    document.cookie = name + '=' + value + '; Path=/; Max-Age=' + days * DAY + '; SameSite=Lax' + domain + secure;
  }

  function captureTouch() {
    var params = new URLSearchParams(window.location.search);
    var touch = {};
    var found = false;
    for (var i = 0; i < KEYS.length; i++) {
      var v = params.get(KEYS[i]);
      if (v) {
        v = v.slice(0, MAX);
        // utm_* lowercased (naming rule); click IDs are case-sensitive.
        touch[KEYS[i]] = KEYS[i].indexOf('utm_') === 0 ? v.toLowerCase() : v;
        found = true;
      }
    }
    if (!found) return;
    touch.landing_page = window.location.pathname.slice(0, MAX);
    touch.referrer = (document.referrer || '').slice(0, MAX);
    touch.ts = new Date().toISOString();
    var value = encodeURIComponent(JSON.stringify(touch));
    if (value.length > 2000) return;
    if (!readCookie('stiko_ft')) writeCookie('stiko_ft', value, 90);
    writeCookie('stiko_lt', value, 90);
  }

  var api = { state: 'loading', accept: accept, decline: decline };
  window.stikoTracking = api;
  var banner = null;

  function settle(state) {
    api.state = state;
    if (state === 'granted' || state === 'not_required') captureTouch();
    window.dispatchEvent(new CustomEvent('stiko:tracking', { detail: { state: state } }));
  }
  function accept() {
    writeCookie('stiko_consent', 'granted', 365);
    if (banner) banner.remove();
    settle('granted');
  }
  function decline() {
    writeCookie('stiko_consent', 'denied', 365);
    if (banner) banner.remove();
    settle('denied');
  }

  function button(label, primary, onClick) {
    var b = document.createElement('button');
    b.setAttribute('type', 'button');
    b.textContent = label;
    b.style.cssText = 'font:inherit;font-weight:700;border-radius:9px;padding:8px 14px;cursor:pointer;' +
      (primary ? 'background:#111;color:#fff;border:0;' : 'background:#fff;color:#111;border:1.5px solid #ddd;');
    b.addEventListener('click', onClick);
    return b;
  }
  function showBanner() {
    banner = document.createElement('div');
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;max-width:560px;margin:0 auto;' +
      'background:#fff;color:#111;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:14px 16px;' +
      'font:13px/1.45 system-ui,-apple-system,sans-serif;display:flex;flex-wrap:wrap;gap:10px;align-items:center;';
    var text = document.createElement('span');
    text.style.cssText = 'flex:1 1 260px;';
    text.textContent = 'We use analytics cookies to improve stiko. ';
    var link = document.createElement('a');
    link.setAttribute('href', PRIVACY_URL);
    link.textContent = 'Privacy policy';
    link.style.cssText = 'color:inherit;text-decoration:underline;';
    text.appendChild(link);
    banner.appendChild(text);
    banner.appendChild(button('Decline', false, decline));
    banner.appendChild(button('Accept', true, accept));
    document.body.appendChild(banner);
  }

  function pending() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showBanner);
    } else {
      showBanner();
    }
    settle('pending');
  }

  var stored = readCookie('stiko_consent');
  if (stored === 'granted' || stored === 'denied') {
    settle(stored);
    return;
  }
  fetch(GEO_URL, { credentials: 'omit' })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d.consentRequired === false) settle('not_required'); else pending(); })
    .catch(pending);
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/tests/stikoTracking.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write `app/api/geo/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { consentRequired } from '@/lib/geo';

export const dynamic = 'force-dynamic';

/** The marketing site calls this cross-origin; nothing else may read it from a browser. */
const ALLOWED_ORIGINS = new Set(['https://www.stiko.design', 'https://stiko.design']);

/** GET — does this visitor's country need a cookie banner? Public (lib/routeAccess.ts). */
export async function GET(request: NextRequest) {
  const res = NextResponse.json({
    consentRequired: consentRequired(request.headers.get('x-vercel-ip-country')),
  });
  res.headers.set('Cache-Control', 'private, no-store');
  const origin = request.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Vary', 'Origin');
  }
  return res;
}
```

- [ ] **Step 6: Write `app/api/analytics/consent/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { consentValue } from '@/lib/geo';

/** POST — a signed-in user answered the banner; server events follow their answer. */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const consent = consentValue(body?.consent);
  if (!consent) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  await sql`UPDATE users SET analytics_consent = ${consent} WHERE id = ${session.user.id}`;
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 7: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add public/stiko-tracking.js app/api/geo/route.ts app/api/analytics/consent/route.ts scripts/tests/stikoTracking.test.mjs
git commit -m "feat(analytics): shared consent banner + UTM script, geo and consent endpoints"
```

---

### Task 12: posthog-js in the app

**Files:**
- Create: `components/analytics/AnalyticsProvider.tsx`, `lib/analytics/client.ts`
- Modify: `app/providers.tsx`, `app/invite/[token]/page.tsx`, `package.json`

**Interfaces:**
- Consumes: `window.stikoTracking` and the `stiko:tracking` event (Task 11); `GET /api/me` `{ id, workspaceId }` (Task 8); `POST /api/analytics/consent` (Task 11); `useAuthSession` (`lib/authClient.tsx`); `inviteId` on the invite GET response (Task 10).
- Produces: `captureClient(event: string, properties?: Record<string, unknown>): void`.

- [ ] **Step 1: Install posthog-js**

Run: `npm install posthog-js@latest --save-exact`
Expected: exact version pinned in `package.json`.

- [ ] **Step 2: Write `lib/analytics/client.ts`**

```ts
'use client';

import posthog from 'posthog-js';

/** Client capture that is a no-op until PostHog has started (consent, key). */
export function captureClient(event: string, properties: Record<string, unknown> = {}): void {
  try {
    if (posthog.__loaded) posthog.capture(event, properties);
  } catch {
    // analytics never breaks the page
  }
}
```

- [ ] **Step 3: Write `components/analytics/AnalyticsProvider.tsx`**

```tsx
'use client';

/**
 * posthog-js for the app (spec §5.1).
 * - Starts only after public/stiko-tracking.js reports 'granted' or 'not_required'.
 * - Autocapture off; $pageview sent on route changes.
 * - Session replay ONLY on /welcome, all inputs and text masked: the rest of the
 *   app shows customers' confidential drawings and models.
 * - identify(user id) + group('workspace', id) once signed in; reset() on sign-out.
 */
import { Suspense, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import { useAuthSession } from '@/lib/authClient';

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

type TrackingState = 'loading' | 'pending' | 'granted' | 'denied' | 'not_required';

function useTrackingState(): TrackingState {
  const [state, setState] = useState<TrackingState>('loading');
  useEffect(() => {
    const w = window as unknown as { stikoTracking?: { state: TrackingState } };
    if (w.stikoTracking && w.stikoTracking.state !== 'loading') setState(w.stikoTracking.state);
    const onChange = (e: Event) => setState((e as CustomEvent<{ state: TrackingState }>).detail.state);
    window.addEventListener('stiko:tracking', onChange);
    return () => window.removeEventListener('stiko:tracking', onChange);
  }, []);
  return state;
}

function Pageviews({ ready }: { ready: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    if (!ready) return;
    posthog.capture('$pageview');
    if (pathname === '/welcome') posthog.startSessionRecording();
    else posthog.stopSessionRecording();
  }, [ready, pathname, search]);
  return null;
}

export default function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const tracking = useTrackingState();
  const { status } = useAuthSession();
  const [ready, setReady] = useState(false);
  const identified = useRef<string | null>(null);

  // Start PostHog once tracking is allowed.
  useEffect(() => {
    if (!KEY || ready) return;
    if (tracking !== 'granted' && tracking !== 'not_required') return;
    posthog.init(KEY, {
      api_host: '/ingest',
      ui_host: 'https://us.posthog.com',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: true,
      cross_subdomain_cookie: true,
      persistence: 'localStorage+cookie',
      disable_session_recording: true,
      session_recording: { maskAllInputs: true, maskTextSelector: '*' },
    });
    setReady(true);
  }, [tracking, ready]);

  // A signed-in user who answers the banner: server events follow the answer.
  useEffect(() => {
    if (status !== 'authenticated') return;
    if (tracking !== 'granted' && tracking !== 'denied') return;
    fetch('/api/analytics/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: tracking }),
    }).catch(() => {});
  }, [status, tracking]);

  // identify + group once signed in; reset on sign-out.
  useEffect(() => {
    if (!ready) return;
    if (status === 'unauthenticated' && identified.current) {
      posthog.reset();
      identified.current = null;
      return;
    }
    if (status !== 'authenticated' || identified.current) return;
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me: { id: string; workspaceId: string | null } | null) => {
        if (!me) return;
        posthog.identify(me.id);
        if (me.workspaceId) posthog.group('workspace', me.workspaceId);
        identified.current = me.id;
      })
      .catch(() => {});
  }, [ready, status]);

  return (
    <>
      <Script src="/stiko-tracking.js" strategy="afterInteractive" />
      <Suspense fallback={null}>
        <Pageviews ready={ready} />
      </Suspense>
      {children}
    </>
  );
}
```

- [ ] **Step 4: Edit `app/providers.tsx`**

```tsx
'use client';

import { AuthClientProvider } from '@/lib/authClient';
import type { AuthProviderName } from '@/lib/authProvider';
import AnalyticsProvider from '@/components/analytics/AnalyticsProvider';

export default function Providers({
  provider,
  children,
}: {
  provider: AuthProviderName;
  children: React.ReactNode;
}) {
  return (
    <AuthClientProvider provider={provider}>
      <AnalyticsProvider>{children}</AnalyticsProvider>
    </AuthClientProvider>
  );
}
```

- [ ] **Step 5: Edit `app/invite/[token]/page.tsx`** — add `inviteId: string;` to `interface InviteInfo`; add `import { captureClient } from '@/lib/analytics/client';`; inside `InviteAuth`, after the `useState` lines, add:

```tsx
  useEffect(() => {
    captureClient('reviewer_signup_prompt_shown', { invite_id: invite.inviteId });
  }, [invite.inviteId]);
```

and at the top of `submit`, after `e.preventDefault();`:

```tsx
    if (tab === 'create') captureClient('reviewer_signup_prompt_clicked', { invite_id: invite.inviteId });
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: PASS. Boot locally with `NEXT_PUBLIC_POSTHOG_KEY` unset → no PostHog network calls, `/stiko-tracking.js` loads (200, not a 307 to /login), banner shows (local has no country header → fail closed). Click Accept → `stiko_consent=granted` cookie set on localhost.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json components/analytics/AnalyticsProvider.tsx lib/analytics/client.ts app/providers.tsx "app/invite/[token]/page.tsx"
git commit -m "feat(analytics): posthog-js gated on consent, identify/group, replay on /welcome only"
```

---

### Task 13: Cron backstop

**Files:**
- Modify: `app/api/cron/purge-trash/route.ts`

**Interfaces:**
- Consumes: `flushOutbox`, `pruneOutbox` (Task 5).

- [ ] **Step 1: Edit the cron route** — add `import { flushOutbox, pruneOutbox } from '@/lib/analytics/outbox';`. Directly after the `Authorization` check (before `const cutoff = …`), add:

```ts
  // Analytics backstop: events whose post-response flush failed. Independent of
  // the purge, and never allowed to stop it.
  let analytics: { sent: number; failed: number; pruned: number } | { error: string };
  try {
    const flushed = await flushOutbox(500);
    analytics = { ...flushed, pruned: await pruneOutbox() };
  } catch (err) {
    analytics = { error: err instanceof Error ? err.message : String(err) };
  }
```

and add `analytics,` as a field of the `summary` object.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/purge-trash/route.ts
git commit -m "feat(analytics): daily cron flushes and prunes the outbox"
```

---

### Task 14: Privacy policy draft, Webflow install, rollout runbook

**Files:**
- Create: `docs/legal/privacy-policy-draft.md`, `docs/superpowers/runbooks/2026-11-15-kyc-posthog-rollout.md`

- [ ] **Step 1: Draft `docs/legal/privacy-policy-draft.md`.** Plain language, marked at the top "DRAFT — requires lawyer review before publication (PIPEDA/CASL for Canada, US state laws, GDPR/UK GDPR for EU/UK visitors)". Sections, each with real prose:
  1. Who we are (stiko, contact address placeholder the user fills: the one bracketed field allowed, `[contact email]`).
  2. What we collect: account data (name, email, password hash via WorkOS); business profile (the five KYC answers, country/region from IP); files and comments customers upload; usage analytics (pages, product events; session recordings only on the onboarding page, with all text and inputs masked); marketing attribution (UTM parameters, ad click IDs, referrer, landing page); billing (via Stripe — Stiko never sees card numbers).
  3. Why (contract performance, legitimate interest in improving the product, consent for marketing email and — in the EU/EEA/UK/CH — for analytics cookies).
  4. Cookies: `stiko_consent`, `stiko_ft`, `stiko_lt` (90 days), `stiko_profile`, PostHog `ph_*`, auth session cookies; EU/UK visitors are asked first; how to withdraw (clear cookies / decline).
  5. Processors: WorkOS (auth), Stripe (payments), PostHog (analytics, US), Resend (email), Amazon Web Services S3 (file storage), Neon (database), Vercel (hosting), CloudConvert (file conversion), Atlas Cloud (AI summaries), the CAD-conversion host (Modal).
  6. Retention, international transfers (US), your rights (access, correction, deletion, objection), marketing unsubscribe, children, changes, contact.

- [ ] **Step 2: Write the rollout runbook** `docs/superpowers/runbooks/2026-11-15-kyc-posthog-rollout.md` with these literal steps (user-facing: say which terminal, which folder, one paste block each):
  1. **PostHog setup (browser):** sign up at posthog.com → choose **US Cloud** → create project "stiko" → Settings → Project → copy the **Project API key** (`phc_…`). Billing → enable **Group Analytics** add-on (check the current price on that page first). Settings → Project → Authorized URLs: add `https://app.stiko.design`, `https://www.stiko.design`.
  2. **Vercel env (Production):** `NEXT_PUBLIC_POSTHOG_KEY=phc_…`, `POSTHOG_PROJECT_KEY=phc_…` (same value), `PROFILE_COOKIE_SECRET=` output of `openssl rand -base64 32`. Leave `KYC_GATE` unset.
  3. **Migration first** (Terminal, in `~/Desktop/STIKO-main`, using the DATABASE_URL prefix command from memory note `stiko-credential-rotation-due` — never `source .env.local`): `npm run migrate -- --dry` then `npm run migrate`; confirm `019-kyc-analytics.sql` is in `schema_migrations`.
  4. **Merge and push** (one paste block): `git fetch origin && git checkout main && git pull --ff-only && git merge --no-ff feature/kyc-posthog -m "merge: KYC onboarding + PostHog phase 1" && npm test && git push origin main`.
  5. **Webflow** (Site settings → Custom code → Head, then Publish). Paste:

```html
<script src="https://app.stiko.design/stiko-tracking.js" defer></script>
<script>
  /* PostHog loader: paste the "Web snippet" from PostHog → Settings → Project
     here, then DELETE its final posthog.init(...) line and keep the block below. */
  window.addEventListener('stiko:tracking', function (e) {
    var s = e.detail.state;
    if ((s === 'granted' || s === 'not_required') && window.posthog && !window.posthog.__loaded) {
      window.posthog.init('phc_REPLACE_WITH_KEY', {
        api_host: 'https://app.stiko.design/ingest',
        ui_host: 'https://us.posthog.com',
        autocapture: true,
        cross_subdomain_cookie: true,
        persistence: 'localStorage+cookie'
      });
    }
  });
</script>
```

  Also publish `docs/legal/privacy-policy-draft.md` (after lawyer review) as the Webflow page `/privacy`.
  6. **Acceptance walk** (spec §9): accounts A and B, every P0 event visible in PostHog → Activity, workspace groups with `segment_id`/`track`, A's `activated_at` set; EU check by setting a request header is not possible in production — instead verify `GET https://app.stiko.design/api/geo` returns `{"consentRequired":false}` from North America, and that a VPN to Germany shows the banner on both sites.
  7. **Rollback:** gate only → set `KYC_GATE=off` and redeploy. All analytics → remove both PostHog keys and redeploy; on Webflow remove the two script tags and publish. The migration stays.

- [ ] **Step 3: Commit**

```bash
git add docs/legal/privacy-policy-draft.md docs/superpowers/runbooks/2026-11-15-kyc-posthog-rollout.md
git commit -m "docs: privacy policy draft and KYC/PostHog rollout runbook"
```

---

## Final verification (before handing back)

- [ ] `npm test` — all suites pass (existing 95 files + 5 new).
- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run build` — succeeds, middleware compiles for edge.
- [ ] Local browser pass with no PostHog key: signup → verify → `/welcome` → dashboard; reload dashboard does NOT return to `/welcome`; invite flow lands on the package after `/welcome`; `/stiko-tracking.js` and `/api/geo` load signed-out.
- [ ] Whole-branch review (superpowers:requesting-code-review) focused on: the middleware gate under both providers, PII in event properties, and the schema.sql mirror.
