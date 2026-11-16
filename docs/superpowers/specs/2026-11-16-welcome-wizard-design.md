# /welcome as a one-question-per-screen wizard — design

**Date:** 2026-11-16 · **Status:** approved · **Branch:** `feature/welcome-wizard`
**Replaces the UI of:** `app/welcome/page.tsx` (shipped 55c681a as one long form). The route, the
`POST /api/welcome` contract, the gate and the catalog are unchanged.

## Why

The founder did not like the single long form. Approved direction (visual companion, option **B**):
Typeform-style, one question per screen, lettered rows, explicit Continue.

## The flow

Five steps, in this order, all on `/welcome` (no per-step URLs; `?callbackUrl=` kept as today):

| # | `step_name` | Question | Options | Layout |
|---|---|---|---|---|
| 1 | `pillar` | What best describes your work? | 4 pillars | 1 column |
| 2 | `business_type` | Which best describes your business? | the chosen pillar's 10 types + Other, each with helper text; subtitle = the chosen pillar's label | 1 column |
| 3 | `client_model` | Who do you design or build for? | 3 | 1 column |
| 4 | `company_size` | How many people work at your company? | 8 | 2 columns |
| 5 | `role` | What's your role? | 11 | 2 columns; then the product-news checkbox; button reads **Finish** |

Labels come from `lib/kyc/catalog.ts` unchanged.

## Screen anatomy (every step)

- Full page on `bg-stiko-app`, content column max ~440px, centred; works at 375px wide.
- Top: stiko logo mark + wordmark (existing components) left; `n / 5` right.
- A 5px progress bar (gradient `#8094F5 → #5B60FF`) at `n/5` width.
- The question as the page heading (~22–24px, extra-bold). Step 1 also shows a one-line "why":
  "So we can set stiko up for the files you review."
- Options: lettered rows (A, B, C…). Row = white, 1.5px `stiko-divider` border, 11–12px radius; letter in a
  small outlined square. Selected = `stiko-primary` border, `stiko-tint` fill, filled letter square.
- Footer: `← Back` left (hidden on step 1), primary button right (`Continue ↵`, step 5 `Finish ↵`,
  `Saving…` while submitting).
- Under the footer, small text: step 5 shows "How we use your answers: Privacy policy · Not you? Sign out";
  steps 1–4 show "Not you? Sign out". Sign-out behaviour is the current one (keeps callbackUrl).

## Behaviour

- Picking an option selects it (does not auto-advance). Continue is disabled until the step is answered.
- **Keyboard:** letter keys select the matching option on the current step (A = first). Enter = Continue /
  Finish when enabled. While the Other text input has focus, letter keys type text (only Enter is handled).
  Keys with modifiers (Ctrl/Cmd/Alt) are ignored.
- **Back** keeps all answers. Changing the pillar clears the business type and the Other text.
- **Other (`xx-99`)**: selecting it reveals a text input directly under that row (max 120 chars, autofocus);
  Continue needs non-blank text.
- **Finish** posts exactly today's body to `POST /api/welcome`. Success → `window.location.assign(redirectPath)`
  (full navigation, unchanged). 401 → login round-trip (unchanged). 400 `{field}` → jump to that field's step
  and show its message there. Other failures → error banner above Finish, answers kept.
- Step change: short fade/slide (≤200ms), none under `prefers-reduced-motion`. Focus moves to the new
  step's heading.
- **Accessibility:** each option list is `role="radiogroup"` labelled by the heading; rows are
  `role="radio"` with `aria-checked`; roving focus with arrow keys is not required (letters + Tab suffice).
  An `aria-live="polite"` region announces "Step n of 5".

## Analytics

New client event via `captureClient` (lib/analytics/client.ts — consent-gated, buffered):
`onboarding_step_completed` `{ step: 1–5, step_name, value }` fired when Continue/Finish is pressed with a
valid answer. `value` is the stored ID (pillar ID, Segment ID, client-model ID, size band, role ID) — codes
only, never the Other free text. Combined with the `/welcome` `$pageview` and the server's
`company_profile_completed`, this gives a per-step drop-off funnel.

## Units

- `lib/kyc/wizard.ts` (pure, tested): `STEPS` (order + step_name), `canContinue(step, answers)`,
  `stepForField(field)`, `letterFor(index)`, `indexForKey(key, optionCount)`, `stepValue(step, answers)`.
- `components/welcome/StepFrame.tsx`: logo, counter, progress bar, heading, footer, small print.
- `components/welcome/LetteredChoices.tsx`: the radiogroup of lettered rows (1 or 2 columns, optional helper
  line per row, optional slot under a given row for the Other input).
- `app/welcome/page.tsx`: answers state, current step, keyboard handler, submit.

## Testing

- `node --test` for `lib/kyc/wizard.ts`.
- `npm test`, `tsc`, `lint`, `build`.
- Headless browser click-through on a production build with `/api/welcome` stubbed: all five steps, Back,
  pillar change clears type, Other text, keyboard letters + Enter, 400 field jump, 375px width with no
  horizontal scroll.

## Out of scope

Changing questions, labels, the API, the gate or the catalog.
