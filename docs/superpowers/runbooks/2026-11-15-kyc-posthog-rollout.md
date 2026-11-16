# KYC onboarding + PostHog: rollout runbook

**Date:** 2026-11-15  **Branch:** `feature/kyc-posthog`  **For:** the founder (no coding needed, only copy and paste)
**Spec:** `docs/superpowers/specs/2026-11-15-kyc-and-posthog-design.md`

## What this ships

- Every signed-in person (owners and invited reviewers) answers five short questions on a new page, `/welcome`, before using the app. Existing accounts are asked on their next visit. **You will be sent there yourself right after the deploy.**
- PostHog analytics (US Cloud) in the app and on the Webflow marketing site, with a cookie banner for visitors in the EU, UK, EEA and Switzerland.
- First-touch and last-touch campaign tracking (UTM labels, ad click IDs).
- A privacy policy page at `www.stiko.design/privacy`.

## The order matters

There is no staging site: **production is the only environment**. Do the steps in this order and do not skip ahead.

| # | Step | Where |
|---|---|---|
| 1 | Create the PostHog account and project | Browser |
| 2 | Set the PostHog project settings | Browser |
| 3 | Add the environment variables | Vercel (browser) + Terminal |
| 4 | Publish the privacy page | Webflow (browser) |
| 5 | Apply the database migration | Terminal |
| 6 | Merge and push (this deploys) | Terminal |
| 7 | Check the deploy | Terminal + browser |
| 8 | Add the tracking scripts to Webflow | Webflow (browser) |
| 9 | Acceptance walk | Browser |
| 10 | Session replay check | Browser |

Why the migration is step 5 and not later: the new code reads new database columns on every page. If the code goes live before the migration, every signed-in page can break with no visible error. This has happened twice before in this project. Why the privacy page is step 4 and not later: the moment the code deploys, `/signup`, `/welcome` and the cookie banner all link to `https://www.stiko.design/privacy`. That link must not 404.

**Time:** about 1.5 hours, plus however long the lawyer review of the privacy policy takes (the only step you cannot do in one sitting).

---

## Step 1. PostHog account and project (Browser)

1. Open **https://posthog.com** and click **Get started - free**.
2. When asked for the region, choose **US Cloud**. You cannot change this later. The app is already set up for the US servers.
3. Create the organization (name it `stiko`) and a project named **`stiko`**.
4. Open **Settings** (bottom-left) then **Project**. Near the top is **Project API key**, a string starting with `phc_`. Click the copy button and paste it somewhere private (a note on your computer). You will use this one value three times: twice in Vercel, once in Webflow. It is designed to be public, but keep it tidy.

**You should see:** a `phc_...` key, and the PostHog URL starts with `https://us.posthog.com`. If the URL says `eu.posthog.com`, you picked the wrong region: delete the account and start again.

## Step 2. PostHog project settings (Browser)

Still in PostHog, in project **stiko**. Do all five.

1. **Session replay on.** Open **https://us.posthog.com/settings/project-replay#replay** (or Settings, Project, Session replay). Switch **Record user sessions** ON. The app starts and stops recording itself and only ever records `/welcome`, but PostHog ignores recordings unless this switch is on. While you are on this page, make sure **Canvas capture** is OFF (the 3D viewer is a canvas and shows customers' confidential models), and leave console logs and network capture OFF. The app also forces these off in its own code; this is the second lock.
2. **Discard client IP data (recommended).** Settings, Project, General, **IP data capture configuration**: switch on **Discard client IP data**. PostHog then does not store visitors' IP addresses. Trade-off: it still works out a visitor's country from the IP before discarding it, so you lose nothing you need, because stiko records the country itself on the onboarding page. If you turn this on, tell the lawyer, because the privacy policy can then say IP addresses are discarded.
3. **Autocapture:** leave at its default. The app switches it off in its own code; only the marketing site uses it.
4. **Group analytics add-on.** Click your organization name (top-left), then **Billing**. Find **Group analytics** under Product analytics add-ons. **Read the price shown there before you click anything.** It is a paid add-on. It is what lets PostHog break funnels down by company (segment, track) and not just by person. If the price is not acceptable, skip it: all events still flow and only the company breakdowns are unavailable. You can add it later without redoing anything.
5. **Authorized URLs.** Settings, Project, **Authorized URLs for Toolbar**: add `https://app.stiko.design` and `https://www.stiko.design`. (This is for PostHog's toolbar; the analytics itself does not need it.)

## Step 3. Environment variables (Vercel, then Terminal)

### 3a. Make the secret (Terminal)

Open the **Terminal** app (any folder is fine for this one) and paste:

```bash
openssl rand -base64 32
```

**You should see:** one line of 44 characters ending in `=`. Copy it. This is `PROFILE_COOKIE_SECRET`. Keep it private; it is not shown again by Vercel if you mark it Sensitive.

### 3b. Add three variables (Vercel, browser)

Open **https://vercel.com**, open your main **stiko** project (not `stiko-xgdc`, which is the DWG/DXF converter), then **Settings**, **Environment Variables**. Add these three. For each, tick **Production only** (untick Preview and Development, or test deploys would send fake events into your real PostHog):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | the `phc_...` key from Step 1 |
| `POSTHOG_PROJECT_KEY` | the **same** `phc_...` key |
| `PROFILE_COOKIE_SECRET` | the line from 3a (tick **Sensitive**) |

Do **not** add `KYC_GATE`. Leave it unset (that means the gate is on). Do not add `POSTHOG_HOST`; the default is US Cloud.

**Why `PROFILE_COOKIE_SECRET` matters:** without it the app still works, but every page view makes a database lookup to check whether you have done the onboarding questions.

**You should see:** three new rows in the list. Nothing deploys yet; these values are picked up by the deploy in Step 6.

## Step 4. Publish the privacy page (Webflow, browser)

Do this before the deploy. If you have not had the lawyer review yet, decide now whether to wait, because the app will link to this page from the moment it deploys.

1. Get the final text. The draft is `docs/legal/privacy-policy-draft.md` in the project. Replace `[contact email]` with your real contact address everywhere it appears, delete the "DRAFT" banner at the top and the "Drafting notes" section at the bottom, and use the lawyer's corrected version if you have one.
2. Open **Webflow**, the site **Stiko's Sublime Site**. In the **Designer**, open the **Pages** panel (left), click **+** for a new page, name it **Privacy**, and set the slug to exactly **`privacy`**. Paste the policy text into the page (headings as headings, the two tables as tables or lists). Easier alternative: send the final text to Claude and ask it to build the page in Webflow for you.
3. Optional but sensible: add a **Privacy** link to the footer.
4. Click **Publish**, tick the `www.stiko.design` domain, publish.

**You should see:** `https://www.stiko.design/privacy` opens in your browser and shows the policy. Check it on your phone too.

## Step 5. Database migration (Terminal)

This applies `lib/migrations/019-kyc-analytics.sql` to the production database. It only adds: a `workspaces` table, an `analytics_outbox` table, and new columns on `users`. Nothing is removed or changed. These commands read the database address from your `.env.local` file without printing it; do not edit them.

### 5a. See what is applied now (before)

Open **Terminal** and paste (all of it, as one block):

```bash
cd ~/Desktop/STIKO-main
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" node --input-type=module -e 'import { neon } from "@neondatabase/serverless"; neon(process.env.DATABASE_URL).query("SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 4").then((r) => console.log(r.map((x) => x.name).join("\n")), (e) => { console.error("Failed:", String(e.message).replace(/postgres[^ ]*/g, "<redacted-url>")); process.exit(1); })'
```

**You should see:** four file names, newest first, starting with `018-stripe-billing.sql`. **If the first line is not `018-stripe-billing.sql` (or it is already `019-...`), stop and tell Claude before going on.**

### 5b. Dry run

```bash
cd ~/Desktop/STIKO-main
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" npm run migrate -- --dry 2>&1 | sed -E 's#postgres(ql)?://[^ ]*#<redacted-url>#g'
```

**You should see:** a long list of `would run: ...` lines, including a block headed `lib/migrations/019-kyc-analytics.sql`, ending with `Dry run — nothing was changed.` The dry run never connects to the database. (It lists every migration, including old ones, because it cannot tell which are applied; the real run skips those.)

### 5c. Apply it

```bash
cd ~/Desktop/STIKO-main
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" npm run migrate 2>&1 | sed -E 's#postgres(ql)?://[^ ]*#<redacted-url>#g'
```

**You should see:** green check marks, then older migrations reported as `already applied, skipping`, then `lib/migrations/019-kyc-analytics.sql` with check marks, ending `Done. Database is up to date.` If you see a `✗` or `Migration failed`, stop and tell Claude the message. The statements are all safe to run twice.

### 5d. Confirm (after)

Paste the same block as 5a again.

**You should see:** `019-kyc-analytics.sql` as the **first** line. That is the confirmation. Do not go to Step 6 without it.

## Step 6. Merge and push (Terminal): this deploys to production

`main` deploys to production automatically the moment it is pushed. Paste in **Terminal** (one block):

```bash
cd ~/Desktop/STIKO-main
git fetch origin && git checkout main && git pull --ff-only && git merge --no-ff feature/kyc-posthog -m "merge: KYC onboarding + PostHog phase 1" && npm test && git push origin main
```

**You should see:** the merge summary, the test run finishing with `fail 0`, and a final line like `main -> main`. If `npm test` shows any failure, the push does **not** happen (the chain stops); tell Claude. If `git pull --ff-only` complains, someone else pushed to `main`; tell Claude, do not force anything.

Then open Vercel, your stiko project, **Deployments**. The newest deployment builds for a few minutes and turns **Ready**.

## Step 7. Check the deploy (Terminal, then browser)

1. In **Terminal**:

   ```bash
   curl -s https://app.stiko.design/api/geo; echo; curl -sI https://app.stiko.design/stiko-tracking.js | head -1
   ```

   **You should see:** `{"consentRequired":false}` (you are in North America) and `HTTP/2 200`. If the second line says `307` or `404`, the deploy is not Ready yet or something is wrong: wait a minute, try again, then tell Claude.
2. In your browser open **https://app.stiko.design**, signed in as yourself. **You will be sent to the "tell us about your work" page. This is expected**: answer the five questions, leave the product-news box as you like, and submit. You should land on your dashboard, and reloading the dashboard must **not** send you back to the questions.

If the app is broken for everyone, go straight to **Rollback** at the bottom.

## Step 8. Tracking scripts on Webflow (browser)

The privacy page is already live (Step 4), which the banner links to.

1. In PostHog (US) open **Settings**, **Project**, and find the panel called **Web snippet** (use the search box on the Settings page for "snippet" if you cannot see it). It shows a block of code in a box starting with `<script>`. Click copy.
2. Open the text file you will paste into (any text editor) and build the code as in the next box. Take the copied PostHog code and **delete its final statement**, which looks like this and is always at the very end of the `<script>`:

   ```js
   posthog.init('phc_...', {
       api_host: 'https://us.i.posthog.com',
       ...
   })
   ```

   Delete from `posthog.init(` through the closing `})` and nothing else. Everything above it (the long compact line starting `!function(t,e)`) stays. We start PostHog ourselves, later, once a visitor's cookie choice allows it.
3. Assemble the final code like this. Replace `phc_REPLACE_WITH_YOUR_KEY` with your key from Step 1. The `PASTE ... HERE` line is where the PostHog code (minus its final `posthog.init`) goes, inside the same `<script>`:

```html
<script src="https://app.stiko.design/stiko-tracking.js" defer></script>
<script>
  /* PASTE THE POSTHOG CODE HERE (everything inside PostHog's <script>,
     with its final posthog.init(...) statement deleted). Keep what follows. */

  (function () {
    var started = false;
    function start(state) {
      if (started) return;
      if (state !== 'granted' && state !== 'not_required') return;
      if (!window.posthog) return;
      started = true;
      window.posthog.init('phc_REPLACE_WITH_YOUR_KEY', {
        api_host: 'https://app.stiko.design/ingest',
        ui_host: 'https://us.posthog.com',
        autocapture: true,
        cross_subdomain_cookie: true,
        persistence: 'localStorage+cookie',
        disable_session_recording: true
      });
    }
    // A saved cookie answer can already be known when this runs...
    start(window.stikoTracking && window.stikoTracking.state);
    // ...and a fresh or just-given answer arrives as an event.
    window.addEventListener('stiko:tracking', function (e) {
      start(e.detail && e.detail.state);
    });
  })();
</script>
```

   Do not change the first line: it must be exactly a plain `<script src="..." defer></script>` tag (the script finds its own address from it). Do not add the stiko script a second time anywhere else on the site.
4. In Webflow open **Site settings** (the gear), then **Custom code**, and paste the whole assembled block into **Head code**. Click **Save**. (Custom code needs a paid Webflow site plan, which a site on its own domain already has.)
5. Click **Publish** and publish to `www.stiko.design`.

**You should see (non-EU visitor):** open `https://www.stiko.design` in a private/incognito window, open the browser's developer tools (right-click, Inspect), **Network** tab, type `ingest` in the filter, reload. Requests to `app.stiko.design/ingest/...` appear, and `stiko-tracking.js` shows status 200. No banner appears for you in North America.

## Step 9. Acceptance walk (browser)

Do this on production, with two real email addresses you can read (`A` = the owner, `B` = a reviewer; use a work-domain address for at least one, because free mail like Gmail is recorded as "not a business email"). Use a private/incognito window for each person so the sessions stay separate. For campaign tracking, start A's journey at this address, which carries test labels:
`https://www.stiko.design/?utm_source=runbook&utm_medium=test&utm_campaign=rollout`

**A (owner):**
1. On the marketing site click **Sign up**, create the account, verify the email code.
2. Land on `/welcome`, answer the five questions (tick the product-news box), submit, land on the dashboard.
3. Create a project, create a package, upload a PDF or an image.
4. Invite B by email to the package.

**B (reviewer):**
5. Open the invite email link in a separate private window (not signed in). You should see the sign-up prompt. Click **Create account**.
6. Sign up, verify the email code, answer `/welcome`, and you should land on the package.

**Now check PostHog** (https://us.posthog.com, project stiko). Events take up to a minute or two; server events can lag a little longer.

1. **Activity** (left sidebar): you should find each of these. Click one to open it and look at its properties.
   - From A: `signup_completed` (with `first_utm_source` = `runbook`), `email_verified`, `company_profile_completed`, `project_created`, `file_uploaded`, `file_processed`, `sent_for_review`.
   - From B: `review_link_opened`, `reviewer_signup_prompt_shown`, `reviewer_signup_prompt_clicked`, `reviewer_signup_completed`, then B's own `email_verified` and `company_profile_completed`.
   - `file_upload_failed` appears if you try to upload a file type stiko rejects. Optional.
   - `trial_started` and `subscription_started` need a real Stripe purchase. They will show on the first real customer (or after one real purchase you refund). Not part of this walk.
2. Every server event should carry `user_id`, `workspace_id`, `segment_id` and `track`. Before a person finishes `/welcome` the last two read `unknown`; after, they carry the real codes (for example `PD-07` and `small_team`).
3. **People** (or Persons & groups): A and B each appear once, identified by their internal user ID. Not their email: no email or name is ever sent.
4. **Groups**, type `workspace` (needs the Group analytics add-on): A's workspace and B's workspace appear with `pillar`, `segment_id`, `client_model`, `company_size_band`, `track`, `country`. **A's workspace has `activated_at` set** (it is set when B opened A's invite).
5. **Campaign tracking:** while signed out on `app.stiko.design`, browser developer tools, **Application** tab, **Cookies**: a `stiko_ft` and a `stiko_lt` cookie exist for `.stiko.design`. This proves the labels survived the jump from Webflow to the app.
6. **One visitor across both sites:** in PostHog, A's person shows pageviews from both `www.stiko.design` and `app.stiko.design` under one ID.

**Consent banner check.**
- From North America, `https://app.stiko.design/api/geo` (open it in the browser) shows `{"consentRequired":false}`. That is the "no banner" case. You cannot fake Germany with a header in production.
- Turn on a **VPN set to Germany**, open a private window, and visit `https://www.stiko.design`: the banner "We use analytics cookies to improve stiko" appears with **Decline** and **Accept**. With the developer tools Network tab open (filter `ingest`), nothing is sent until you click **Accept**. After you answer, open `https://app.stiko.design` in the same window: **no second banner** (one cookie covers both sites).

## Step 10. Session replay check (browser)

Open `https://app.stiko.design/welcome` (as a signed-in user, or run a fresh signup) and then visit one other page, for example your dashboard. Wait a few minutes, then in PostHog open **Replay** (left sidebar).

- **Only `/welcome` recordings should exist.** Every recording's start page is `/welcome`. If you ever see one that includes the dashboard or a package, **stop and use the rollback below the same minute**; those pages show customers' confidential work.
- Open a `/welcome` recording: all text and anything typed should appear masked (blocks or asterisks instead of readable words). Clicks and the cursor are visible.
- Nothing readable from the 3D viewer should appear anywhere in Replay.

## If events are missing from PostHog

Events from the app are saved to a table first and then sent, so an outage at PostHog does not lose them. To see whether any are waiting, open **Terminal** and paste:

```bash
cd ~/Desktop/STIKO-main
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" node --input-type=module -e 'import { neon } from "@neondatabase/serverless"; neon(process.env.DATABASE_URL).query("SELECT count(*) FILTER (WHERE sent_at IS NULL)::int AS unsent, count(*)::int AS total, max(last_error) AS last_error FROM analytics_outbox").then((r) => console.log(r[0]), (e) => { console.error("Failed:", String(e.message).replace(/postgres[^ ]*/g, "<redacted-url>")); process.exit(1); })'
```

`unsent: 0` means everything was delivered, so look at PostHog's filters (date range, project). A growing `unsent` with a `last_error` means PostHog is rejecting the key: check `POSTHOG_PROJECT_KEY` in Vercel (no spaces, the same value as the public key) and that the deploy happened **after** you added it. The daily 04:00 UTC job also retries unsent events.

Two things that are normal, not bugs: server events show a United States data-centre as their "location" in PostHog (use the `country` property from the onboarding answers instead), and the browser events from a visitor who declined cookies simply do not exist.

## Rollback

No code revert is needed for any of these. The migration is additive and **stays in place**.

**A. The onboarding page is causing trouble (gate only).** Vercel, stiko project, Settings, Environment Variables: add `KYC_GATE` with value `off` (Production). Then **Deployments**, the latest one, the **...** menu, **Redeploy**. Nobody is sent to `/welcome` any more. Analytics keeps running. To turn the gate back on, delete `KYC_GATE` and redeploy.

**B. Stop all analytics.** Vercel, Environment Variables: **delete** `NEXT_PUBLIC_POSTHOG_KEY` and `POSTHOG_PROJECT_KEY`. Then Deployments, latest, **...**, **Redeploy**, and **untick "Use existing Build Cache"** (the public key is baked in at build time). With no key, the app sends nothing and PostHog code does not start. On **Webflow**: Site settings, Custom code, Head code: delete the two `<script>` blocks (the stiko-tracking line and the PostHog block), Save, **Publish**.

**C. Last resort, undo the whole merge.** In Terminal:

```bash
cd ~/Desktop/STIKO-main
git checkout main && git pull --ff-only && git revert -m 1 HEAD && git push origin main
```

(Only if the very last commit on `main` is the merge from Step 6. Check with `git log --oneline -3` first.) Rolling back leaves the database columns and tables in place; the old code ignores them. Answers people already gave on `/welcome` are kept.

The environment variables, in short: `NEXT_PUBLIC_POSTHOG_KEY` + `POSTHOG_PROJECT_KEY` (analytics on/off), `PROFILE_COOKIE_SECRET` (a cache secret; keep it set), `KYC_GATE=off` (the gate's kill switch), `POSTHOG_HOST` (optional, default US Cloud).
