# /welcome Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single long `/welcome` form with a one-question-per-screen, lettered-row wizard (spec option B).

**Architecture:** A pure, tested rules module (`lib/kyc/wizard.ts`) decides step order, when Continue is allowed and key→option mapping. Two presentational components render the frame and the lettered radiogroup. The page holds answers + current step and submits to the unchanged `POST /api/welcome`.

**Tech Stack:** Next.js 14.2 App Router client component, Tailwind (stiko tokens in tailwind.config.ts), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-16-welcome-wizard-design.md` (read it first — it is the UI/behaviour contract).

## Global Constraints

- Branch `feature/welcome-wizard`. Never `git add -A` / `git add .`; add files by path.
- `POST /api/welcome` request body, `safeCallbackUrl` use, full-navigation redirect, 401 handling and sign-out behaviour stay exactly as in the current `app/welcome/page.tsx`.
- Option labels come from `lib/kyc/catalog.ts`; do not edit the catalog.
- Tested lib modules use relative `.ts` imports, never `@/`.
- UI copy writes the product name lowercase: `stiko`.
- Analytics: only `captureClient('onboarding_step_completed', { step, step_name, value })`, codes only — never the Other free text.
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Wizard rules (pure)

**Files:** Create `lib/kyc/wizard.ts`; Test `scripts/tests/kycWizard.test.mjs`

**Interfaces — Produces:** `STEPS`, `StepName`, `WizardAnswers`, `canContinue`, `stepForField`, `letterFor`, `indexForKey`, `stepValue`.

- [ ] **Step 1: Failing test** — `scripts/tests/kycWizard.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, canContinue, stepForField, letterFor, indexForKey, stepValue } from '../../lib/kyc/wizard.ts';

const EMPTY = { pillar: '', segmentId: '', businessTypeOther: '', clientModel: '', companySizeBand: '', role: '' };
const FULL = { pillar: 'PD', segmentId: 'PD-07', businessTypeOther: '', clientModel: 'clients', companySizeBand: '5-9', role: 'engineer' };

test('five steps in the approved order', () => {
  assert.deepEqual(STEPS, ['pillar', 'business_type', 'client_model', 'company_size', 'role']);
});

test('each step needs its own answer', () => {
  for (let i = 0; i < 5; i++) assert.equal(canContinue(i, EMPTY), false, String(i));
  for (let i = 0; i < 5; i++) assert.equal(canContinue(i, FULL), true, String(i));
});

test('a business type from another pillar does not count', () => {
  assert.equal(canContinue(1, { ...FULL, segmentId: 'AC-06' }), false);
});

test('Other needs non-blank text', () => {
  const other = { ...FULL, segmentId: 'PD-99' };
  assert.equal(canContinue(1, other), false);
  assert.equal(canContinue(1, { ...other, businessTypeOther: '   ' }), false);
  assert.equal(canContinue(1, { ...other, businessTypeOther: 'Boat builder' }), true);
});

test('unknown codes never count', () => {
  assert.equal(canContinue(0, { ...FULL, pillar: 'XX' }), false);
  assert.equal(canContinue(3, { ...FULL, companySizeBand: '1-4' }), false);
  assert.equal(canContinue(4, { ...FULL, role: 'ceo' }), false);
});

test('server field errors map to their step', () => {
  assert.equal(stepForField('pillar'), 0);
  assert.equal(stepForField('segmentId'), 1);
  assert.equal(stepForField('businessTypeOther'), 1);
  assert.equal(stepForField('clientModel'), 2);
  assert.equal(stepForField('companySizeBand'), 3);
  assert.equal(stepForField('role'), 4);
  assert.equal(stepForField('nope'), null);
});

test('letters A.. and key lookup within the option count', () => {
  assert.equal(letterFor(0), 'A');
  assert.equal(letterFor(10), 'K');
  assert.equal(indexForKey('a', 4), 0);
  assert.equal(indexForKey('D', 4), 3);
  assert.equal(indexForKey('e', 4), null);
  assert.equal(indexForKey('Enter', 4), null);
  assert.equal(indexForKey('1', 4), null);
});

test('the analytics value is the stored code for that step', () => {
  assert.deepEqual(STEPS.map((_, i) => stepValue(i, FULL)), ['PD', 'PD-07', 'clients', '5-9', 'engineer']);
});
```

- [ ] **Step 2:** `node --test scripts/tests/kycWizard.test.mjs` → FAIL (module not found).

- [ ] **Step 3: Implement** — `lib/kyc/wizard.ts`

```ts
/**
 * Rules for the /welcome wizard (spec 2026-11-16-welcome-wizard-design.md).
 * Pure: no React, no I/O. The server's validateProfile stays the authority on
 * submit; this only decides what the UI lets you continue past.
 */
import { CLIENT_MODELS, PILLARS, ROLES, SIZE_BANDS } from './catalog.ts';
import { businessTypesFor, isOtherSegment } from './profile.ts';

export const STEPS = ['pillar', 'business_type', 'client_model', 'company_size', 'role'] as const;
export type StepName = (typeof STEPS)[number];

export interface WizardAnswers {
  pillar: string;
  segmentId: string;
  businessTypeOther: string;
  clientModel: string;
  companySizeBand: string;
  role: string;
}

export function canContinue(step: number, a: WizardAnswers): boolean {
  switch (STEPS[step]) {
    case 'pillar':
      return PILLARS.some((p) => p.id === a.pillar);
    case 'business_type':
      if (!businessTypesFor(a.pillar).some((t) => t.id === a.segmentId)) return false;
      return !isOtherSegment(a.segmentId) || a.businessTypeOther.trim().length > 0;
    case 'client_model':
      return CLIENT_MODELS.some((c) => c.id === a.clientModel);
    case 'company_size':
      return SIZE_BANDS.some((s) => s.id === a.companySizeBand);
    case 'role':
      return ROLES.some((r) => r.id === a.role);
    default:
      return false;
  }
}

const FIELD_STEP: Record<string, number> = {
  pillar: 0, segmentId: 1, businessTypeOther: 1, clientModel: 2, companySizeBand: 3, role: 4,
};

export function stepForField(field: string): number | null {
  return field in FIELD_STEP ? FIELD_STEP[field] : null;
}

export function letterFor(index: number): string {
  return String.fromCharCode(65 + index);
}

/** 'a'/'A' → 0 … ; null for anything that is not a single letter within range. */
export function indexForKey(key: string, optionCount: number): number | null {
  if (key.length !== 1) return null;
  const i = key.toUpperCase().charCodeAt(0) - 65;
  return i >= 0 && i < optionCount && i < 26 ? i : null;
}

/** The stored code for a step — what the analytics event carries. Never free text. */
export function stepValue(step: number, a: WizardAnswers): string {
  return [a.pillar, a.segmentId, a.clientModel, a.companySizeBand, a.role][step] ?? '';
}
```

- [ ] **Step 4:** test → PASS (8 tests). `npm test` all green.
- [ ] **Step 5: Commit** `lib/kyc/wizard.ts scripts/tests/kycWizard.test.mjs` — `feat(kyc): wizard rules for the step-by-step /welcome`.

---

### Task 2: Frame, lettered choices and the page

**Files:** Create `components/welcome/StepFrame.tsx`, `components/welcome/LetteredChoices.tsx`; Rewrite `app/welcome/page.tsx`.

**Interfaces — Consumes:** Task 1 exports; `captureClient` from `@/lib/analytics/client`; `useAuthActions().signOutTo`; `safeCallbackUrl`; `LogoMark`/`Wordmark` (find where the invite page imports them); `ErrorBanner` from `@/components/ui/Primitives`; `Button` from `@/components/ui/Button`; catalog arrays; `businessTypesFor`, `isOtherSegment`, `OTHER_TEXT_MAX`.

**Requirements (all from the spec's "Screen anatomy" and "Behaviour" sections — implement every bullet):**

- `StepFrame` props: `step` (0-based), `total`, `title`, `subtitle?`, `onBack?` (omit on step 0), `primaryLabel`, `primaryDisabled`, `onPrimary`, `error?`, `smallPrint` (ReactNode), `children`, plus a heading ref so the page can focus it on step change. Renders the logo + `n / 5`, the progress bar, the heading (`tabIndex={-1}`), children, error banner above the footer, footer (Back left, primary right), small print centred under. Includes an `aria-live="polite"` visually-hidden "Step n of 5".
- `LetteredChoices` props: `labelledBy` (heading id), `options: { id, label, helper? }[]`, `value`, `onChange(id)`, `columns: 1 | 2`, `renderAfter?: (id) => ReactNode` (used for the Other input under the Other row). `role="radiogroup"`; each row a `<button type="button" role="radio" aria-checked>` with the letter square (`letterFor(i)`), label, optional helper line. Selected and rest styles per spec; visible focus ring (`shadow-stiko-focus`). 2-column grid collapses to 1 column below 360px.
- Page: state `answers: WizardAnswers`, `marketingConsent`, `step`, `saving`, `error`. Changing pillar clears `segmentId` and `businessTypeOther`. Primary on steps 0–3: if `canContinue`, fire `captureClient('onboarding_step_completed', { step: step + 1, step_name: STEPS[step], value: stepValue(step, answers) })`, then go to the next step. Step 4 primary: fire the event, then submit with the exact body/handling of the current page; on 400 `{field}`, `setStep(stepForField(field) ?? step)` and show the field's message (keep the current `FIELD_ERRORS` copy).
- Keyboard (`useEffect` keydown on `window`): ignore when `e.metaKey || e.ctrlKey || e.altKey`; if the event target is the Other input (or any input/textarea/select), only handle `Enter`; letter → `indexForKey(key, options.length)` → select; `Enter` → primary if enabled (and not saving). Clean up the listener.
- Step change: focus the heading; a ≤200ms opacity/translate transition keyed on `step`, disabled via `motion-reduce:` Tailwind variants.
- Step 1 subtitle "So we can set stiko up for the files you review."; step 2 subtitle = the chosen pillar's label; step 5 adds the checkbox ("Send me product news and tips from stiko. You can unsubscribe at any time.") between the options and the footer; button label `Finish`.
- Small print: steps 1–4 "Not you? Sign out"; step 5 "How we use your answers: Privacy policy · Not you? Sign out" (privacy link `https://www.stiko.design/privacy`, new tab). Sign-out button disabled while saving; same `signedOutLanding` logic as today.
- Keep the `Suspense` wrapper for `useSearchParams`.

- [ ] Steps: implement → `npx tsc --noEmit` → `npm run lint` → `npm run build` → commit the three files — `feat(kyc): /welcome as a one-question-per-screen wizard`.

---

### Task 3: Browser verification (no commit unless fixes)

- [ ] Production build + `next start` with dummy env, a temporary way to render `/welcome` signed-out (e.g. temporarily bypass the gate route-wise in a throwaway worktree copy, never committed) and `/api/welcome` stubbed via request interception (Playwright/CDP). Check: all five steps; Back keeps answers; pillar change clears type; Other text gates Continue; letters + Enter drive the whole flow; 400 `{field:'role'}` jumps to step 5 with its message; success navigates to the callbackUrl; 375px width has no horizontal scroll; screenshots of each step at 1280px and 375px saved in the scratchpad. Report what was and wasn't observed.
