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
| 7 | Check the deploy and the replay masking | Terminal + browser |
| 8 | Add the tracking scripts to Webflow | Webflow (browser) |
| 9 | Acceptance walk and clean-up | Browser |

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

**Safety net in every command:** if the address in `.env.local` is ever mistyped or quoted, the commands print `Could not connect (details hidden)` or `<redacted-url>` instead of the address. That is on purpose. If you ever do see a password on your screen anyway, stop and tell Claude straight away so it can be changed.

**Do not follow a hint that says `set -a && . .env.local`.** If a command prints `DATABASE_URL is not set` followed by that advice (the migration tool prints it), ignore the advice: loading the whole file into your Terminal is how the database password was exposed before. Tell Claude instead.

### 5a. See what is applied now (before)

Open **Terminal** and paste (all of it, as one block):

```bash
cd ~/Desktop/STIKO-main
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" node --input-type=module -e 'import { neon } from "@neondatabase/serverless"; let db; try { db = neon(process.env.DATABASE_URL); } catch { console.error("Could not connect (details hidden)"); process.exit(1); } db.query("SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 4").then((r) => console.log(r.map((x) => x.name).join("\n")), (e) => { console.error("Failed:", String(e.message).replace(/postgres[^ ]*/g, "<redacted-url>")); process.exit(1); })' 2>&1 | sed -E 's#postgres(ql)?://[^ "]*#<redacted-url>#g'
```

**You should see:** four file names, newest first, starting with `018-stripe-billing.sql`. **If the first line is not `018-stripe-billing.sql` (or it is already `019-...`), stop and tell Claude before going on.** If you see `Could not connect (details hidden)` or `Failed:` instead, stop and tell Claude; nothing has been changed.

### 5b. Dry run

```bash
cd ~/Desktop/STIKO-main
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" npm run migrate -- --dry 2>&1 | sed -E 's#postgres(ql)?://[^ "]*#<redacted-url>#g; s#(Connection string:).*#\1 <redacted>#'
```

**You should see:** a long list of `would run: ...` lines, including a block headed `lib/migrations/019-kyc-analytics.sql`, ending with `Dry run — nothing was changed.` The dry run never connects to the database. (It lists every migration, including old ones, because it cannot tell which are applied; the real run skips those.)

### 5c. Apply it

```bash
cd ~/Desktop/STIKO-main
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" npm run migrate 2>&1 | sed -E 's#postgres(ql)?://[^ "]*#<redacted-url>#g; s#(Connection string:).*#\1 <redacted>#'
```

**The output is long (well over a hundred lines). That is normal.** The command first re-applies the base schema, `lib/schema.sql` (about 60 check marks); every statement in it is written to be safe to run again, so this changes nothing that already exists. Then it goes through the migrations one by one.

**Success looks like this:** green check marks (`✓`) in the first part, then most migrations reported as `already applied, skipping`, then a block headed `lib/migrations/019-kyc-analytics.sql` with a check mark on each of its lines, and as the very last line `Done. Database is up to date.` There must be no `✗` and no `Migration failed` anywhere. If you see either, stop and copy the message to Claude. The statements are all safe to run twice.

### 5d. Confirm (after)

Paste the same block as 5a again.

**You should see:** `019-kyc-analytics.sql` as the **first** line. That is the confirmation. Do not go to Step 6 without it.

## Step 6. Merge and push (Terminal): this deploys to production

`main` deploys to production automatically the moment it is pushed.

### 6a. Check your folder first

In **Terminal**:

```bash
cd ~/Desktop/STIKO-main
git status
```

**You should see:** `On branch feature/kyc-posthog`, then a list of **untracked** folders, exactly these five and nothing else: `design_handoff_brief_section/`, `design_handoff_dashboard_redesign/`, `design_handoff_portal_view/`, `logo/` and `stiko_handoff/`, ending with `nothing added to commit but untracked files present`. (A line saying the branch is up to date with, or ahead of, `origin` is fine.) **If you see anything else, especially a line with `modified:` or a heading `Changes not staged`, stop and tell Claude.** Do not go on: the merge would take that unsaved work along.

### 6b. Merge, test, push

Paste in **Terminal** (one block):

```bash
cd ~/Desktop/STIKO-main
git fetch origin && git checkout main && git pull --ff-only && git merge --no-ff feature/kyc-posthog -m "merge: KYC onboarding + PostHog phase 1" && npm test && git push origin main
```

**You should see:** the merge summary, the test run finishing with `fail 0`, and a final line like `main -> main`. The chain stops at the first thing that fails, and the push is the last link, so **a failure before the push means production is untouched.**

- **`git pull --ff-only` complains:** someone else pushed to `main`. Tell Claude; do not force anything.
- **The merge reports a `CONFLICT`, or `npm test` shows any failure:** nothing has been pushed. Put your folder back the way it was with this block, then tell Claude what the screen said (or just ask Claude to take it from here):

  ```bash
  cd ~/Desktop/STIKO-main
  git merge --abort 2>/dev/null; git reset --hard origin/main && git status
  ```

  `git merge --abort` only does something if the merge stopped half-way (a conflict); `git reset --hard origin/main` then sets your local `main` back to exactly what is on the server. The five untracked folders are not touched. You should see `On branch main` and `Your branch is up to date with 'origin/main'`.
- **The final `git push` is rejected:** tell Claude; do not force it.

Then open Vercel, your stiko project, **Deployments**. The newest deployment builds for a few minutes and turns **Ready**. **If it shows Error or Build Failed instead, visitors are not affected:** Vercel keeps serving the previous production deployment until a new build succeeds, and the migration only added things, so the old version is happy with the new database. Do not roll anything back; copy the red error message from the build log to Claude.

## Step 7. Check the deploy and the replay masking (Terminal, then browser)

1. In **Terminal**:

   ```bash
   curl -s https://app.stiko.design/api/geo; echo; curl -sI https://app.stiko.design/stiko-tracking.js | head -1
   ```

   **You should see:** `{"consentRequired":false}` (you are in North America) and `HTTP/2 200`. If the second line says `307` or `404`, the deploy is not Ready yet or something is wrong: wait a minute, try again, then tell Claude.
2. In your browser open **https://app.stiko.design**, signed in as yourself. **You will be sent to the "tell us about your work" page. This is expected**: answer the five questions, leave the product-news box as you like, and submit. You should land on your dashboard, and reloading the dashboard must **not** send you back to the questions.
3. **Replay masking check. Do it now, before anyone else uses stiko.** Every existing user is sent to `/welcome` on their next visit, so from this moment real people can be recorded on that page. Your own visit is the first recording; check it before the others pile up. Wait about five minutes after you submitted, then open PostHog (https://us.posthog.com, project stiko) and click **Replay** in the left sidebar. The newest recording is yours. Open it and check:
   - It starts on `/welcome`, and it **ends when you reached the dashboard**: nothing from the dashboard or any package appears in it.
   - All words on the page, and anything you typed, appear masked (blocks or asterisks instead of readable text). Clicks and the cursor are visible.

   If a recording shows readable text, or any page other than `/welcome`, **stop and use the PostHog switch under "Replay or privacy problem" in the Rollback section the same minute**, then tell Claude. If no recording shows up after ten minutes, check that **Record user sessions** is ON (Step 2, item 1) and tell Claude; do not carry on without having seen one.

If the app is broken for everyone, go straight to **Rollback** at the bottom and use **Instant Rollback**.

## Step 8. Tracking scripts on Webflow (browser)

The privacy page is already live (Step 4), which the banner links to.

0. **Before you touch Webflow, check that the proxy is up.** In **Terminal**:

   ```bash
   curl -sI https://app.stiko.design/ingest/static/array.js | head -1
   ```

   **You should see:** `HTTP/2 200`. If it says anything else (`404`, `307`, `502`), **do not continue**: the marketing site would load a broken tracking script. Tell Claude.
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

  ;(function () {
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
        disable_session_recording: true,
        disable_surveys: true,
        advanced_disable_feature_flags: true,
        save_referrer: false
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

   Do not change the first line: it must be exactly a plain `<script src="..." defer></script>` tag (the script finds its own address from it). Do not add the stiko script a second time anywhere else on the site. Keep the semicolon at the start of `;(function () {`: it stops the PostHog code above and this block from running together as one statement. The last three options (`disable_surveys`, `advanced_disable_feature_flags`, `save_referrer`) are the same settings the app uses: no survey pop-ups, no feature-flag request, and no saved referrer.
4. In Webflow open **Site settings** (the gear), then **Custom code**, and paste the whole assembled block into **Head code**. Click **Save**. (Custom code needs a paid Webflow site plan, which a site on its own domain already has.)
5. Click **Publish** and publish to `www.stiko.design`.

**You should see (non-EU visitor):** open `https://www.stiko.design` in a private/incognito window, open the browser's developer tools (right-click, Inspect), **Network** tab, type `ingest` in the filter, reload. Requests to `app.stiko.design/ingest/...` appear, none of them with `flags` in its name, and `stiko-tracking.js` shows status 200. No banner appears for you in North America.

## Step 9. Acceptance walk and clean-up (browser)

Do this on production, with two **throwaway** email addresses you can read (`A` = the owner, `B` = a reviewer). Never use a customer's address or your main one, because the walk creates real accounts that you will clean up at the end. Easy ways to get throwaways: `yourname+stiko-a@gmail.com` and `yourname+stiko-b@gmail.com` (Gmail delivers both to your normal inbox), or two aliases at your own company domain. Use a work-domain alias for at least one, because free mail like Gmail is recorded as "not a business email". Use a private/incognito window for each person so the sessions stay separate. For campaign tracking, start A's journey at this address, which carries test labels:
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
7. **Web addresses are scrubbed (no email, no invite link).** In a private window, signed out, open this address (the email in it is made up):
   `https://app.stiko.design/verify-email?email=someone@example.com`
   Wait a minute or two, then in PostHog **Activity** open the newest `$pageview` and look at `$current_url`. It must end in `/verify-email` and contain **no `email=`** and no address. Do the same check on B's `$pageview` for the invite link: its `$current_url` must read `/invite/[token]` (the literal word `[token]`), never the real long code. **If you see `email=` or a real token anywhere, stop and tell Claude.**
8. **Replay:** A's and B's `/welcome` visits appear in **Replay** too. They should look like yours from Step 7 (masked text, ending when they reach the dashboard).

**Consent banner check.**
- From North America, `https://app.stiko.design/api/geo` (open it in the browser) shows `{"consentRequired":false}`. That is the "no banner" case. You cannot fake Germany with a header in production.
- Turn on a **VPN set to Germany**, open a private window, and visit `https://www.stiko.design`: the banner "We use analytics cookies to improve stiko" appears with **Decline** and **Accept**. With the developer tools Network tab open (filter `ingest`), no request appears until you click **Accept**. After you answer, open `https://app.stiko.design` in the same window: **no second banner** (one cookie covers both sites).

**Clean up the test accounts.** The walk leaves two accounts, a project and some rows in PostHog. Tidy them so they never count as customers:
1. **Mark them as internal in PostHog.** Open **People**, click A, and copy the long ID at the top of the page (it is stiko's internal user ID); do the same for B. Then open **Settings**, **Project**, **Filter out internal and test users** (use the search box on the Settings page if you cannot see it) and add a filter: property `user_id`, operator *is not*, and the two IDs. (If PostHog offers a `Distinct ID` property, use that instead; it also covers browser events.) From now on, when you build an insight or dashboard, tick **Filter out internal and test users**. If you would rather remove them entirely: **People**, open the person, **Delete person**, and choose to delete their events too if PostHog offers it.
2. **In the app:** as A, put the test project in the Trash (the Trash button on the dashboard). It is removed for good after 28 days.
3. **The accounts themselves:** stiko has no delete-account button yet. Send Claude the two throwaway addresses and ask it to remove them (and their workspaces) from the database and from the sign-in service. Until then they are harmless, but they show up in user totals.

## If events are missing from PostHog

Events from the app are saved to a table first and then sent, so an outage at PostHog does not lose them. To see whether any are waiting, open **Terminal** and paste:

```bash
cd ~/Desktop/STIKO-main
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" node --input-type=module -e 'import { neon } from "@neondatabase/serverless"; let db; try { db = neon(process.env.DATABASE_URL); } catch { console.error("Could not connect (details hidden)"); process.exit(1); } db.query("SELECT count(*) FILTER (WHERE sent_at IS NULL)::int AS unsent, count(*)::int AS total, max(last_error) AS last_error FROM analytics_outbox").then((r) => console.log(r[0]), (e) => { console.error("Failed:", String(e.message).replace(/postgres[^ ]*/g, "<redacted-url>")); process.exit(1); })' 2>&1 | sed -E 's#postgres(ql)?://[^ "]*#<redacted-url>#g'
```

`unsent: 0` means everything was delivered, so look at PostHog's filters (date range, project). A growing `unsent` with a `last_error` means PostHog is rejecting the key: check `POSTHOG_PROJECT_KEY` in Vercel (no spaces, the same value as the public key) and that the deploy happened **after** you added it. The daily 04:00 UTC job also retries unsent events. If you see `Could not connect (details hidden)`, the database address in `.env.local` is not in the usual form; tell Claude (do not paste the file anywhere).

Two things that are normal, not bugs: server events show a United States data-centre as their "location" in PostHog (use the `country` property from the onboarding answers instead), and the browser events from a visitor who declined cookies simply do not exist.

## Rollback

No code revert is needed for most of these. The migration is additive and **stays in place**; the old code ignores the new columns and tables, so every option below is safe for the database. Pick by what is wrong, fastest first.

**First lever, the app is broken for everyone: Vercel Instant Rollback (seconds, no Terminal).** In Vercel, open the stiko project, **Deployments**, and find the **previous production deployment**: the newest one from *before* the merge (check the time and commit message; it is not the one named "merge: KYC onboarding + PostHog phase 1"). Click the **...** on its row, then **Instant Rollback**, and confirm. Within seconds the live site is the old version again. It is safe because migration 019 only added things. **Side effect to know about:** Instant Rollback pauses automatic promotion, so later pushes to `main` build but do **not** go live until you promote a deployment yourself (Deployments, the one you want, **...**, **Promote to Production**). Vercel shows a banner saying so. Because the old version of the app has no `stiko-tracking.js` and no `/ingest`, also remove the two Webflow scripts (the Webflow part of B) after rolling back.

**First lever, a replay or privacy problem (recordings that show more than they should): switch replay off in PostHog.** In PostHog open **Settings**, **Project**, **Session replay** (https://us.posthog.com/settings/project-replay#replay) and switch **Record user sessions** OFF. It is instant and needs no deploy; new recordings stop at once. Then delete the offending recordings: **Replay**, open the recording, the **...** menu, **Delete recording** (tick several in the list to delete in bulk). Then tell Claude. If the cause is in the code, continue with B.

**A. The onboarding page is causing trouble (gate only).** Vercel, stiko project, Settings, Environment Variables: add `KYC_GATE` with value `off` (Production). Then **Deployments**, the latest one, the **...** menu, **Redeploy**. Nobody is sent to `/welcome` any more. Analytics keeps running. To turn the gate back on, delete `KYC_GATE` and redeploy.

**B. Stop all analytics.** Vercel, Environment Variables: **delete** `NEXT_PUBLIC_POSTHOG_KEY` and `POSTHOG_PROJECT_KEY`. Then Deployments, latest, **...**, **Redeploy**, and **untick "Use existing Build Cache"** (the public key is baked in at build time). With no key, the app sends nothing and the PostHog code is never even downloaded. On **Webflow**: Site settings, Custom code, Head code: delete the two `<script>` blocks (the stiko-tracking line and the PostHog block), Save, **Publish**.

**C. Last resort, undo the whole merge.** In Terminal:

```bash
cd ~/Desktop/STIKO-main
git checkout main && git pull --ff-only && git revert -m 1 HEAD && git push origin main
```

(Only if the very last commit on `main` is the merge from Step 6. Check with `git log --oneline -3` first.) Rolling back leaves the database columns and tables in place; the old code ignores them. Answers people already gave on `/welcome` are kept. **Also remove the Webflow scripts, exactly as in B** (Site settings, Custom code, Head code: delete the two `<script>` blocks, Save, **Publish**): after the revert the app no longer serves `stiko-tracking.js` or `/ingest`, and the marketing site would keep asking for them.

The environment variables, in short: `NEXT_PUBLIC_POSTHOG_KEY` + `POSTHOG_PROJECT_KEY` (analytics on/off), `PROFILE_COOKIE_SECRET` (a cache secret; keep it set), `KYC_GATE=off` (the gate's kill switch), `POSTHOG_HOST` (optional, default US Cloud).
