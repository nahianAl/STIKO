# Pricing page, plan limits and upgrade prompts — design

Date: 2026-11-13 · Status: approved in conversation, awaiting spec review

## Why

Stripe billing went live today (eea8465): a Free user can buy Standard from the avatar popover, and
that is the only place payment exists. There is no pricing page, no prompt to upgrade, no billing
section in Settings, and the Free limits in `lib/plans.ts` (2 projects, 2 GiB) are displayed but not
applied. The 15 "Pricing" links on www.stiko.design lead nowhere.

## Decisions already made

- The pricing page lives **in the app** at `app.stiko.design/pricing`, not on Webflow, so prices and
  limits come from the same code that charges people.
- **Both limits are enforced** on the Free plan. Every existing account belongs to a co-founder's
  testing, so existing accounts are moved to Standard (see §5) rather than grandfathered by date.
- Plans, prices and limits are unchanged: Free 2 projects / 2 GiB; Standard unlimited projects /
  100 GiB, $20/month or $216/year ("$18/mo"). Collaborators are free; the project owner's plan governs.

## 1. Pricing page — `/pricing`

- Public route: added to `lib/routeAccess.ts` as an **exact** match (`pathname === '/pricing'`), for
  the same prefix-trap reason as the webhook.
- Two cards, Free and Standard, and a Monthly / Yearly switch (default Yearly). Prices from
  `PRICE_DISPLAY` in `lib/billing.ts`; limits from `PLANS` in `lib/plans.ts`. No number is typed into
  the page.
- Buttons by viewer state:
  - Signed out: Free → `/signup?callbackUrl=/pricing`; Standard → the same (signup already honours
    `callbackUrl` via `safeCallbackUrl`). They land back on `/pricing`, signed in, and click Upgrade.
  - Signed in, Free: Standard → POST `/api/billing/checkout` with the selected interval → Stripe.
  - Signed in, paying Standard: "Current plan" + "Manage billing" (portal).
  - Signed in, hand-granted Standard (no subscription): "Current plan", no billing button.
  - Billing disabled (kill switch): Standard shows "Coming soon", no button.
- Viewer state comes from `/api/billing/status` (already returns `action` and `prices`), extended
  with `plan` so the page can mark the current one. Signed-out visitors skip the fetch.
- Three FAQ lines: collaborators are free; cancel anytime and keep Standard until the period ends;
  going over a limit never deletes anything (§3).
- Webflow: repoint the 15 dead Pricing links to `https://app.stiko.design/pricing` and publish.

## 2. Settings → Plan & billing — `/settings/billing`

- New rail entry "Plan & billing" in the Account settings rail (alongside Profile, Notifications).
- Shows: plan badge; the same storage and project meters as the avatar popover (shared component,
  not a copy); for a subscription, "Renews on <date> · Monthly/Yearly" or "Cancels on <date>";
  a red notice when status is `past_due` ("Your last payment failed — update your card").
- Buttons: Upgrade (Monthly / Yearly) or Manage billing, following `billingActionFor`.
- Renewal data comes live from Stripe, not the DB: `/api/billing/status` gains `renewsAt`,
  `cancelAtPeriodEnd` and `interval`, read from the subscription only when the user has one. A Stripe
  error degrades to omitting those fields, never to failing the page.
- Avatar popover keeps its meters and BillingActions, and gains a "Compare plans" link to `/pricing`.

## 3. Enforcement (server)

All rules live in one pure, tested module, `lib/planLimits.ts` (no `@/` imports; see the node --test
import rules):

- `limitsEnforced(env)` — true only when `billingEnabled(env)`. With billing off nobody could lift a
  limit by paying, so limits are off too.
- `canCreateProject(plan, activeProjectCount)` — false when `maxProjects !== null` and
  count ≥ max.
- `canAddBytes(plan, usedBytes, addBytes)` — false when used + add > `storageBytes`.

A refusal is HTTP **402** with `{ error, code: 'plan_limit', limit: 'projects' | 'storage',
isOwner, used, max }`, which the client turns into the upgrade dialog (§4).

**Projects** (owner = the caller):
- `POST /api/projects` — check before INSERT.
- `POST /api/trash/restore` when it restores a project — check before restoring (trashed projects do
  not count, so restore is otherwise a bypass). Restoring a package or file inside a project is not a
  project-count change and is not checked.

**Storage** (owner = the project's owner, not the caller; usage = `getAccountUsage(owner)` total,
which counts trash, matching the meter):
- `POST /api/files/upload` — the client now sends `fileSize`. Missing or non-positive → 400. If the
  owner cannot add it → 402. Otherwise the original's presigned PUT is signed **with
  `contentLength = fileSize`**, so the PUT must match the approved size.
- `POST /api/files/complete` — records the size from a **HeadObject** on the stored object, not the
  client's claim. Object missing → 400 (nothing to register).
- `POST /api/comments/attachments` — same storage check against the file's project owner (size is
  already validated and signed there).
- Not counted, unchanged: optimized GLB variants and converter outputs (PDF, CAD GLB). The usage
  query never counted them.

**Over the limit** (e.g. after cancelling with 5 projects and 40 GB): nothing is deleted or hidden.
Viewing, commenting (text), downloading and deleting all keep working. Creating or restoring
projects and uploading are refused until under the limit or upgraded.

**Known gap, accepted:** the upload pool runs 4 files at once, and each presign checks usage before
the others have completed, so a batch can overshoot by at most the files in flight. Not worth a
reservation system now.

## 4. Upgrade prompts (client)

- One `UpgradeDialog` component, opened from any 402 `plan_limit`:
  - Owner: headline per limit ("You've used your 2 Free projects" / "This upload needs 340 MB — you
    have 120 MB left of 2 GB"), Monthly and Yearly buttons (checkout), "See plans" → `/pricing`.
  - Not the owner (`isOwner: false`): "This project's owner is out of storage on the Free plan. Ask
    them to upgrade." No payment buttons.
- Where it opens:
  - New project (the dashboard's create flow and `/new`): on a 402 from `POST /api/projects`.
  - Restore from trash: on a 402.
  - Uploads (`lib/useUpload.ts`): the first 402 stops the batch; files not yet started are marked
    "Not uploaded — storage full" (a new terminal state, distinct from a failure, so no retry offer);
    the dialog opens once per batch.
  - Comment attachments: on a 402, the attachment is dropped with the dialog; the comment text stays.
- Dashboard banner (Free only, enforcement on): slim, dismissible for the session, shown when at the
  project limit or above 80% storage. Links to the dialog's actions.
- After checkout (`/?billing=success`): toast "You're on Standard", then strip the query param.
  `?billing=cancelled`: no message.

## 5. Existing accounts

Before the deploy that turns enforcement on, the user runs one statement against production:

```sql
UPDATE users SET plan = 'standard' WHERE plan = 'free' AND stripe_subscription_id IS NULL;
```

Those accounts become hand-granted Standard: no limits, and (per `billingActionFor`) no billing
buttons. Anyone wanting to see the Free experience signs up with a new email. Rollback for a single
account: `UPDATE users SET plan = 'free' WHERE email = '…'`.

## 6. Testing

- `scripts/tests/planLimits.test.mjs`: limits on/off with the kill switch, boundary counts (1, 2, 3
  projects), bytes exactly at / one over the limit, unlimited projects on Standard.
- `routeAccess` test: `/pricing` passes signed out; `/pricing-anything` does not.
- PGlite harness (rebuilt per session): 402 on the 3rd project, on restoring a 3rd project, on an
  upload that would exceed 2 GiB (owner and collaborator variants, `isOwner` correct), on an
  attachment; complete records the HeadObject size, not the claimed one; Standard and billing-off
  never refuse.
- Browser pass on `npm run build && npm run start` (the dev server cannot load pdf.js): `/pricing`
  signed out and signed in, `/settings/billing`, the dialog from a 3rd project.

## Out of scope

Team plans or per-seat pricing, usage-based billing, a trial, coupons beyond Stripe's own promotion
codes (already allowed at checkout), emails about limits, and a reservation system for in-flight
uploads.

## Rollback

Delete `BILLING_ENABLED` in Vercel and redeploy: buttons hide **and** limits switch off together.
Code: `git revert -m 1 <merge>`. The §5 grant needs no rollback; it only removes limits.
