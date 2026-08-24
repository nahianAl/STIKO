# Portal AI Summaries — Handover

**Date:** 2026-08-24
**Branch:** `ai-summaries` (35 commits off `5fc332b`, unpushed, not merged)
**Status:** Feature complete. Blocking review finding fixed. **Held pending verification against a real database.**
**Spec:** `docs/superpowers/specs/2026-08-23-portal-ai-summaries-design.md`
**Plan:** `docs/superpowers/plans/2026-08-23-portal-ai-summaries.md`

---

## The one thing that must happen at deploy

**`npm run migrate` must run before any of this code serves traffic.** Route modules read `version_summaries`, `project_summaries` and `projects.ai_summaries_enabled`. Un-migrated, the summary routes 500 and every package page renders empty.

## What is required to run it at all

| | |
|---|---|
| `DATABASE_URL` | Required. Already required by the app generally. |
| `ATLAS_API_KEY` | Optional. Without it the feature degrades honestly — the SQL-computed fact strip still renders and the UI says summarising is not configured. It never pretends. |
| `ATLAS_MODEL` | Defaults to `deepseek-v4-flash`. One env var swaps the model; the provider targets an OpenAI-compatible endpoint. |

Cost at a few thousand generations a month is roughly **$2**. Cost was never the constraint; reliable schema-valid JSON was.

---

## Verification state — read this before trusting anything

Built with no database in the workspace. Consequences:

- **No SQL on this branch has ever executed.** Eleven queries across `lib/ai/facts.ts`, `lib/ai/summarize.ts` and three routes are verified only by reading against `lib/schema.sql`. A whole-branch review re-checked every column, join and cast independently and found no mismatch — but reading is not running.
- **No React component has ever rendered.** There is no React testing library in this project and adding one was out of scope. Three real bugs were nonetheless found in `VersionBrief.tsx` by reading, across three review rounds.
- `npm run build` cannot complete in a workspace without `DATABASE_URL`. It reaches `✓ Compiled successfully` and then fails collecting page data — **identically on the pre-branch baseline `5fc332b`**. Compilation success was the gate used throughout.

**Well verified:** everything in `lib/ai` that does not touch the database — 151 passing tests, including a mutation-tested citation validator and a watermark assertion proven to fail against unfixed code before being accepted. The pseudonymisation guarantee is enforced by the type system, which is stronger than a test.

### Exercise in this order once a database exists

1. `npm run migrate` on a copy. Confirm the two new tables and that `ai_summaries_enabled` defaults `TRUE` on existing rows. Everything depends on this.
2. Every query in `lib/ai/facts.ts` and `lib/ai/summarize.ts`, by hand with real ids — particularly that `readProjectBrief`'s staleness subquery and `summarizeProject`'s roll-up agree on the archived-package predicate, as their comments claim.
3. **The version-brief panel**, with a stubbed provider, through all four states — and specifically the A→B→A version-switch race, which took three review rounds to get right. Weakest-verified code on the branch.
4. **The opt-out**, both directions, with two projects present. Confirm project B's summaries survive disabling A; confirm the flag and rows move together; confirm a forced failure inside the transaction rolls back both.
5. The changelog draft's no-write property, observed rather than inferred: count rows in `version_summaries` and check `versions.changelog` before and after a Suggest click.
6. Only then a real Atlas key against one real package — watching the `[ai] validation dropped …` log line, which exists to tell you the model choice is wrong.

---

## Outstanding work

None of this blocks. All of it was accepted knowingly.

### Should not be forgotten

1. **The disclosure text is inaccurate.** `app/project/[id]/page.tsx` tells owners "comment text is sent to Atlas Cloud". The payload also carries the project name, every package name and filenames. This is the one string whose only job is to be truthful to a client.
2. **The fact strip is 4/5.** The spec fixes five facts; **"comments since last publish"** (`comments.created_at` against `versions.published_at`) was never implemented — absent from `VersionFacts` and from `facts.ts`.
3. **The project tier is a weaker copy of the version tier.** Three gaps, one root cause, fix together:
   - `POST /api/projects/[id]/summary` calls the model unconditionally — no freshness short-circuit, so every Refresh click is a paid call rewriting current text. The version route has this.
   - The `project_summaries` upsert has no concurrency guard, unlike the version upsert's `WHERE EXCLUDED.covered_count >= …`.
   - `summarizeProject`'s query is uncapped — twenty packages × fifteen versions is 300 headlines in one request. The version tier caps at 150 comments.
4. **Prompt injection is unmitigated and unlisted.** Comment text is interpolated raw into a newline-delimited record format in `lib/ai/prompt.ts`. The validator means a commenter *cannot* fabricate a citation — that holds — but they can steer the prose everyone reads. Strip newlines and fence the block; add it to the spec's Risks.
5. **The 150-comment cap runs in JavaScript after SQL returns everything.** A 5,000-comment version transfers 5,000 rows to build a 150-comment prompt. Push `LIMIT` into the query; keep `capComments` for the `omittedCount` arithmetic.
6. **`suggestChangelog` has no `catch`** (`components/portal/NewVersionDrawer.tsx`). Every sibling on this branch has one; a network failure here fails silently.
7. **Provider HTTP branches are untested.** Non-2xx, timeout and the success path have no coverage — the success path is the one that would catch a response-shape drift.
8. **`buildChangelogPrompt` has no test** and exactly one caller. Its contract is correct today by hand-verification only.
9. **Opening a package fires ~5 SQL round trips per version, concurrently**, to populate one line of sidebar text each. Thirty versions is ~150 requests per page open. One endpoint returning `version_id → headline` would replace all of it.
10. **The opt-out toggle can render "on" against an unknown server state** if its loading `GET` fails — including because the migration has not run. The lie points in the safe direction, but it should render unknown-and-disabled until confirmed.

### Pre-existing, found while sweeping — not this branch's work

Three optimistic-update handlers never check `res.ok` and revert nothing: `app/settings/notifications/page.tsx` (twice) and `app/portal/[id]/settings/page.tsx`. The `confirmedAiEnabledRef` pattern in `app/project/[id]/page.tsx` is the right template.

### Known and accepted

- **Version-level citation in the project roll-up was reduced to package-level.** The portal page reads no version from the URL, so no per-version link exists; building one meant a fifth pass through a 1,050-line file. `versionIds` is carried and annotated for when that changes.
- `tsconfig.json` now sets `allowImportingTsExtensions` repo-wide to serve one file. `lib/ai/compose.ts` needs explicit `.ts` extensions because it is the only module with *runtime* sibling imports that a test loads directly; every other module's sibling imports are `import type`, which Node erases before resolution.
- `labelAuthors` returns a `labels` map no production caller consumes.

---

## Why the review load was what it was

Twenty-seven findings were raised and closed. **Every one was a defect in the plan, not in the implementations** — the workers were transcribing plan code, so that is where the bugs lived. Four would have shipped as real problems:

- an **unbounded retry loop against a paid API** — a failed generation left its own trigger condition true
- a summary **landing in the wrong version's panel**, citation chips and all, if you navigated while one was generating
- a project brief **pinned permanently stale** by an archived package, unclearable by any user action
- a compliance switch that could report **"off" while the generated text survived**

None would have been caught by types, lint, or a passing test suite.
