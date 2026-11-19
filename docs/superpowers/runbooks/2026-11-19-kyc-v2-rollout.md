# KYC v2 one-page onboarding: rollout runbook

**Date:** 2026-11-19  **Branch:** `feature/kyc-v2`  **For:** the founder (no coding needed, only copy and paste)
**Spec:** `docs/superpowers/specs/2026-11-19-kyc-v2-design.md`

## What this ships

- `/welcome` becomes one page of short questions (website, industry, markets, who you work for, company size, review team, role, reviewers, file types). Answers are saved as codes, and every change is kept as history.
- **Everyone is asked again**, including you and every co-founder, on their next page load. Workspace owners get the full page; people invited as reviewers get only the role question.
- **Settings → Company** lets the owner change the company answers later.
- A reviewer who later creates their own first project is asked the company questions once, first.

## Where to paste

Every block below goes into the **VS Code terminal** (in VS Code: menu **Terminal**, then **New Terminal**). Every block starts with `cd ~/Desktop/STIKO-main`, so it does not matter which folder the terminal opened in. Paste one block at a time, press Enter, and compare with the **You should see:** line before going on.

## The order matters

There is no staging site: **production is the only environment**. Do the steps in this order and do not skip ahead.

| # | Step | Where |
|---|---|---|
| 1 | See which migrations are applied (before) | VS Code terminal |
| 2 | Dry run of the migration | VS Code terminal |
| 3 | Apply the migration, then confirm | VS Code terminal |
| 4 | Check two things before the merge | Vercel (browser) + VS Code terminal |
| 5 | Merge and push (this deploys) | VS Code terminal |
| 6 | Check the deploy | Browser |
| 7 | Re-run the backfill once | VS Code terminal |

Why the migration comes first: the new code reads the new tables on every signed-in page. If the code goes live before the migration, pages can break with no visible error. This has happened before in this project. The migration only adds tables and columns, so it is safe to apply while the old code is still live.

**Time:** about 30 minutes.

**Never run `set -a && . .env.local`**, even if a message on screen suggests it. Loading the whole file into the terminal is how the database password was exposed before. The commands below read only the database address, without printing it.

**Safety net in every database command:** if the address in `.env.local` is ever mistyped or quoted, the commands print `Could not connect (details hidden)` or `<redacted-url>` instead of the address. That is on purpose. If you ever do see a password on your screen anyway, stop and tell Claude straight away so it can be changed.

---

## Step 1. See which migrations are applied (before)

This only reads. In the **VS Code terminal**, paste (all of it, as one block):

```bash
cd ~/Desktop/STIKO-main
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" node --input-type=module -e 'import { neon } from "@neondatabase/serverless"; let db; try { db = neon(process.env.DATABASE_URL); } catch { console.error("Could not connect (details hidden)"); process.exit(1); } db.query("SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 4").then((r) => console.log(r.map((x) => x.name).join("\n")), (e) => { console.error("Failed:", String(e.message).replace(/postgres[^ ]*/g, "<redacted-url>")); process.exit(1); })' 2>&1 | sed -E 's#postgres(ql)?://[^ "]*#<redacted-url>#g'
```

**You should see:** four file names, newest first, starting with `019-kyc-analytics.sql`. **If the first line is not `019-kyc-analytics.sql` (or it is already `020-kyc-v2.sql`), stop and tell Claude before going on.** If you see `Could not connect (details hidden)` or `Failed:` instead, stop and tell Claude; nothing has been changed.

## Step 2. Dry run

This touches nothing. Paste:

```bash
cd ~/Desktop/STIKO-main
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" npm run migrate -- --dry 2>&1 | sed -E 's#postgres(ql)?://[^ "]*#<redacted-url>#g; s#(Connection string:).*#\1 <redacted>#'
```

**You should see:** a long list of `would run: ...` lines, including a block headed `lib/migrations/020-kyc-v2.sql`, ending with `Dry run — nothing was changed.` The dry run never connects to the database. (It lists every migration, including old ones, because it cannot tell which are applied; the real run skips those.)

## Step 3. Apply the migration, then confirm

### 3a. Apply it

Paste:

```bash
cd ~/Desktop/STIKO-main
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" npm run migrate 2>&1 | sed -E 's#postgres(ql)?://[^ "]*#<redacted-url>#g; s#(Connection string:).*#\1 <redacted>#'
```

**The output is long (well over a hundred lines). That is normal.** The command first re-applies the base schema, `lib/schema.sql` (many check marks); every statement in it is written to be safe to run again, so this changes nothing that already exists. Then it goes through the migrations one by one.

**You should see:** green check marks (`✓`) in the first part, then most migrations reported as `already applied, skipping`, then a block headed `lib/migrations/020-kyc-v2.sql` with a check mark on each of its lines, and as the very last line `Done. Database is up to date.` There must be no `✗` and no `Migration failed` anywhere. If you see either, stop and copy the message to Claude. Every statement is safe to run twice.

What it does: adds five new tables (company answers, their markets, reviewers and file types, and roles), and a few new columns on `users` and `workspaces`. Nothing is removed. The old answers are copied in as history, and nobody's current answers are set, which is why everyone is asked again.

### 3b. Confirm

Paste the same block as Step 1 again:

```bash
cd ~/Desktop/STIKO-main
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" node --input-type=module -e 'import { neon } from "@neondatabase/serverless"; let db; try { db = neon(process.env.DATABASE_URL); } catch { console.error("Could not connect (details hidden)"); process.exit(1); } db.query("SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 4").then((r) => console.log(r.map((x) => x.name).join("\n")), (e) => { console.error("Failed:", String(e.message).replace(/postgres[^ ]*/g, "<redacted-url>")); process.exit(1); })' 2>&1 | sed -E 's#postgres(ql)?://[^ "]*#<redacted-url>#g'
```

**You should see:** `020-kyc-v2.sql` as the **first** line, then `019-kyc-analytics.sql`. That is the confirmation. Do not go to Step 4 without it.

## Step 4. Check two things before the merge

### 4a. Tell everyone they will be asked (no command)

The moment Step 5 deploys, **everyone, including all co-founders, is sent to the new questions on their next page load.** Nothing is lost: their projects are all there once they submit, and it takes about a minute. Send your co-founders a short heads-up now so nobody thinks the app is broken.

### 4b. The kill switch is not already on (Vercel, browser)

Open **https://vercel.com**, your main **stiko** project (not `stiko-xgdc`, which is the DWG/DXF converter), **Settings**, **Environment Variables**. Type `KYC_GATE` in the search box.

**You should see:** no `KYC_GATE` row (that means the gate is on, which is what you want). If there is a `KYC_GATE` row with the value `off`, the new questions will not be asked after the deploy: delete the row now (the deploy in Step 5 picks that up).

### 4c. Check your folder

Paste:

```bash
cd ~/Desktop/STIKO-main
git status
```

**You should see:** `On branch feature/kyc-v2`, then a list of **untracked** folders, exactly these five and nothing else: `design_handoff_brief_section/`, `design_handoff_dashboard_redesign/`, `design_handoff_portal_view/`, `logo/` and `stiko_handoff/`, ending with `nothing added to commit but untracked files present`. **If you see anything else, especially a line with `modified:` or a heading `Changes not staged`, stop and tell Claude.** The merge would take that unsaved work along.

## Step 5. Merge and push: this deploys to production

`main` deploys to production automatically the moment it is pushed. Paste (one block):

```bash
cd ~/Desktop/STIKO-main
git checkout main && git pull --ff-only && git merge --no-ff feature/kyc-v2 -m "merge: KYC v2 one-page onboarding" && git push origin main && git branch -d feature/kyc-v2
```

**You should see:** `Switched to branch 'main'`, a merge summary listing changed files, a line like `main -> main` from the push, and finally `Deleted branch feature/kyc-v2`. The chain stops at the first thing that fails, and the push comes after the merge, so **a failure before the push means production is untouched.**

- **`git pull --ff-only` complains:** someone else pushed to `main`. Tell Claude; do not force anything.
- **The merge reports a `CONFLICT`:** nothing has been pushed. Tell Claude what the screen said and do not run anything else.
- **The push is rejected:** tell Claude; do not force it.

Then open Vercel, your stiko project, **Deployments**. The newest deployment builds for a few minutes and turns **Ready**. **If it shows Error or Build Failed instead, visitors are not affected:** Vercel keeps serving the previous version until a new build succeeds, and the migration only added things, so the old version is happy with the new database. Copy the red error message from the build log to Claude.

## Step 6. Check the deploy (browser)

Wait until the deployment is **Ready**, then:

1. Open **https://app.stiko.design** signed in as yourself. **You should see:** you are sent to the new one-page questions ("Set up your workspace"). This is expected: everyone is re-asked.
2. Answer the questions and press **Create workspace**. **You should see:** your dashboard, with all your projects. Reload the dashboard: it must **not** send you back to the questions.
3. Open **https://app.stiko.design/settings/company** (or the avatar menu, **Settings**, **Company**). **You should see:** the answers you just gave, filled in.

If the questions page shows "Could not load this page" or the app is broken for everyone, go to **Rollback** below.

## Step 7. Re-run the backfill once

Anyone who signed up between Step 3 (the migration) and Step 5 (the deploy) answered the **old** questions, so their old answers were not yet copied into history. This re-runs only the four copy statements at the bottom of the migration file to catch them. It never overwrites anything: each statement only fills gaps, so **it is safe to run twice.**

Paste (one block):

```bash
cd ~/Desktop/STIKO-main
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" node --input-type=module -e 'import { neon } from "@neondatabase/serverless"; import { readFileSync } from "node:fs"; const text = readFileSync("lib/migrations/020-kyc-v2.sql", "utf8"); const at = text.indexOf("-- Backfill:"); const parts = at < 0 ? [] : text.slice(at).split("\n").map((l) => l.replace(/--.*$/, "")).join("\n").split(";").map((s) => s.trim()).filter(Boolean); if (parts.length !== 4) { console.error("Unexpected migration file, nothing was run. Tell Claude."); process.exit(1); } let db; try { db = neon(process.env.DATABASE_URL); } catch { console.error("Could not connect (details hidden)"); process.exit(1); } for (const [n, s] of parts.entries()) { try { const r = await db.query(s, [], { fullResults: true }); console.log(`Backfill ${n + 1} of 4: ${r.rowCount} row(s) changed`); } catch (e) { console.error(`Backfill ${n + 1} of 4 failed:`, String(e.message).replace(/postgres[^ ]*/g, "<redacted-url>")); process.exit(1); } } console.log("Backfill done. Nothing else was changed.");' 2>&1 | sed -E 's#postgres(ql)?://[^ "]*#<redacted-url>#g'
```

**You should see:** four lines `Backfill 1 of 4: … row(s) changed` to `Backfill 4 of 4: … row(s) changed`, then `Backfill done. Nothing else was changed.` The numbers are usually `0` (nobody signed up in between); any number is fine. If you see `Unexpected migration file`, `failed:` or `Could not connect (details hidden)`, stop and tell Claude; the statements that did run are safe and nothing needs undoing.

That is the end of the rollout.

---

## Rollback

The migration **needs no rollback**: it only added tables and columns, and the old code ignores them. Pick by what is wrong, fastest first.

**Fastest: switch the questions off (no terminal).** Vercel, stiko project, **Settings**, **Environment Variables**: add `KYC_GATE` with value `off` (Production). Then **Deployments**, the latest one, the **...** menu, **Redeploy**. This turns off both the `/welcome` questions and the company check before a reviewer's first project. Everything else keeps working. To turn them back on, delete `KYC_GATE` and redeploy.

**Undo the code.** Only if the very last commit on `main` is the merge from Step 5 (check with `git log --oneline -3` first: the top line should say `merge: KYC v2 one-page onboarding`). Paste:

```bash
cd ~/Desktop/STIKO-main
git checkout main && git revert --no-edit -m 1 HEAD && git push origin main
```

**You should see:** a line starting `[main` with `Revert "merge: KYC v2 one-page onboarding"`, then `main -> main`. Vercel deploys the previous version within a few minutes. Answers people already gave are kept in the database.
