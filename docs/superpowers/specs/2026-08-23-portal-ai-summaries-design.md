# Portal AI Summaries — Design

**Date:** 2026-08-23
**Status:** Approved (design), pending implementation plan
**Scope:** LLM-generated briefs in the portal — one per version, summarising its comments; one per project, rolling those up. Plus unaddressed-feedback detection and an auto-drafted changelog. Third-party inference via Atlas Cloud.

---

## Why

A package under review accumulates dozens of positioned comments across several files and versions. Everyone who opens it pays the same tax: read everything, or guess. The uploader can't tell which of forty pins block the next version; the owner can't tell whether a package is converging or stuck; a returning reviewer re-raises a point three people already made.

The raw material is unusually good for this. Comments aren't flat chat — each carries a position (`x/y` or `world_x/y/z`), a thread via `parent_comment_id`, an optional `snapshot_url`, and page or timestamp anchors. Alongside them sit `verdicts`, `versions.changelog` and `version_views`. So a brief here can do what a generic thread summariser cannot: **cite its claims back to specific pins**, and let a reader click a line and land on that annotation in the model or drawing.

---

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Audience | **One neutral brief for everyone.** No per-role variants. The citations do the tailoring — an uploader clicks into blockers, an owner reads the headline and moves on. |
| 2 | Generation trigger | **Cached, stale-aware.** A `version_summaries` row carries a coverage watermark. Reads are instant; staleness is shown, never silently tolerated. First brief auto-generates once a version crosses 3 comments. |
| 3 | Brief shape | **Headline + 3–6 themed bullets**, each citing its pins as clickable chips, over a deterministic fact strip. |
| 4 | Project roll-up | **Two tiers only.** Version briefs feed the project brief, packages as sections. It summarises summaries, so cost stays flat as comment volume grows. |
| 5 | Visibility | **Signed-in participants.** Anonymous link viewers (`portals.link_access`) do not see briefs. |
| 6 | What leaves the building | **Text only, authors pseudonymised.** Comment bodies, thread structure, filenames, changelogs, verdict notes. No snapshots, no attachments, no emails, no real names. |
| 7 | Opt-out | **Per project**, owner-controlled, default on, with the provider named in the UI. |
| 8 | Extras in scope | **Unaddressed-feedback detection** and **auto-drafted changelog.** |
| 9 | Extras parked | Duplicate-comment nudge (needs embeddings), weekly digest email. |
| 10 | Architecture | **One seam, synchronous route, cached rows.** Mirrors `lib/email.ts`, not `lib/cloudconvert.ts`. |
| 11 | Model | **DeepSeek V4 Flash** via Atlas Cloud, as `ATLAS_MODEL`. |

### Why SQL computes the facts and the model only writes prose

Open threads (`parent_comment_id IS NULL` with no replies), verdict tallies, participant counts, which file drew the most pins, comments since last publish — all deterministic, all free, all impossible to hallucinate. The model is given exactly one job that is genuinely language work: clustering scattered pins into themes and phrasing them.

This makes the feature cheaper, faster, more trustworthy, and — critically — **degradable**. If Atlas is down or unconfigured, the fact strip still renders. The feature loses its prose, not its presence.

The fact strip is fixed, and is the contract between SQL and the UI:

| Fact | Source |
|---|---|
| Open threads | Root comments (`parent_comment_id IS NULL`) with no replies |
| Verdict tally | `verdicts` for this version, grouped |
| Comment and participant counts | `comments` joined through `files`; `participants` |
| Most-annotated file | `files.filename` with the highest comment count |
| Comments since last publish | `comments.created_at` against `versions.published_at` |

### Why the model choice is not a cost decision

At roughly 4k input and 600 output tokens per brief, a version brief costs about **$0.0007** on DeepSeek V4 Flash and about **$0.007** on Claude Haiku 4.5. At 3,000 briefs a month that is $2 against $21 — a spread of nineteen dollars. Per customer it is fractions of a cent.

So the model was chosen for reliable schema-valid JSON and honest citation ids, not price. Because `provider.ts` targets an OpenAI-compatible endpoint, the choice is one environment variable; if the validator starts dropping a high share of themes in testing, changing model is a config edit with no code impact.

The real cost control is decision #2. Because briefs regenerate only when a reader opens a stale one, spend scales with **reader attention**, not comment volume. Live-debounced regeneration would have cost 10–50× the same workload for nobody's benefit.

---

## Data model

`lib/migrations/004-ai-summaries.sql`, with `lib/schema.sql` kept in step. Migration ships and runs **before** the reading code deploys.

```sql
ALTER TABLE projects ADD COLUMN ai_summaries_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE version_summaries (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL UNIQUE REFERENCES versions(id) ON DELETE CASCADE,
  headline TEXT NOT NULL,
  themes JSONB NOT NULL,          -- [{ title, body, commentIds[], firstSeenVersionId }]
  covered_count INT NOT NULL,
  covered_through TIMESTAMPTZ NOT NULL,
  model TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE project_summaries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  headline TEXT NOT NULL,
  sections JSONB NOT NULL,        -- [{ portalId, body, versionIds[] }]
  covered_through TIMESTAMPTZ NOT NULL,
  model TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Staleness is computed, never stored

A version brief is stale when the live `COUNT(*)` of its comments exceeds `covered_count` — one indexed join, `comments → files → version_id`, run on read. A project brief is stale when any constituent `version_summaries.generated_at` is newer than its `covered_through`.

Nothing to invalidate, no cache-busting hooks scattered through the comment routes, and no way for a flag and reality to drift apart.

### `firstSeenVersionId` is the whole unaddressed-feedback feature

Generating v4's brief puts v3's themes in the prompt as prior context. The model marks a theme as recurring; the server verifies the referenced version actually precedes this one before trusting it. No extra table, no extra call — it falls out of already having a brief per version.

---

## Architecture

Six modules below, each independently understandable, plus `lib/ai/facts.ts` — the deterministic fact-strip and coverage queries, already covered above under "Why SQL computes the facts" — and `lib/ai/types.ts`, which is shapes only. (This section was originally scoped around five modules, with a single `lib/ai/payload.ts` covering both prompt construction and orchestration. Implementation split that in two — `lib/ai/prompt.ts` for the pure half, `lib/ai/compose.ts` for the half that calls the provider — so the interesting behaviour stays testable without a database.)

### `lib/ai/provider.ts`

One function: `complete({ system, user, schema })`. Plain `fetch` against Atlas Cloud's OpenAI-compatible `/v1/chat/completions`. Reads `ATLAS_API_KEY`, `ATLAS_MODEL`, `ATLAS_BASE_URL`. No new npm dependency.

Missing key returns `{ ok: false, reason }` — it never throws and never pretends. This is `lib/email.ts`'s dev transport, applied to inference: callers get an honest flag so the UI can say what is actually true.

### `lib/ai/prompt.ts`

Pure prompt construction — no database, no network, so it is the piece under the heaviest test coverage. `capComments` caps at 150 comments, most recent first, and reports `omittedCount`; a capped brief **says** it was capped in the prompt text — silent truncation would make it quietly wrong. `labelAuthors` pseudonymises authors to stable labels (`Reviewer A`) before the request; real names are rehydrated client-side from the cited comment ids. `buildVersionPrompt`, `buildProjectPrompt` and `buildChangelogPrompt` build the system/user message pair for each of the three prompts.

### `lib/ai/compose.ts`

The half of orchestration that is still database-free: `composeVersionBrief` and `composeProjectBrief` each run prompt → `provider.complete()` → `validate*`, and hand back either the validated brief plus its coverage watermark, or `{ ok: false, reason }`. Kept apart from `lib/ai/summarize.ts` (which does the SQL load and the upsert) specifically so this — the part with actual branching logic — can be tested by injecting a canned provider, with no `@/lib/db` import anywhere in the chain.

### `lib/ai/validate.ts`

The anti-hallucination guard, and deliberately dependency-free so it is testable without a database or a network:

- drops any `commentId` not in `sentIds`
- drops any theme left citing nothing
- rejects a `firstSeenVersionId` that does not precede this version
- returns the cleaned themes plus a dropped-count for logging

A citation chip therefore cannot point at a comment the model invented.

### `lib/ai/summarize.ts`

The database half: load via `lib/ai/facts.ts` → `composeVersionBrief`/`composeProjectBrief` (`lib/ai/compose.ts`) → upsert, plus the cached reads (`readVersionBrief`, `readProjectBrief`). Exports `summarizeVersion(id)` and `summarizeProject(id)`. Imports `@/lib/db`, so — unlike `compose.ts` — nothing here can be imported by a test.

### `lib/ai/staleness.ts`

The single query comparing `covered_count` to the live count, shared by the read and write paths so they can't disagree.

---

## Data flow

### Read — the common path, and it never calls the model

```
GET /api/versions/[id]/summary
  auth() → getPackageAccess(userId, portalId) → projects.ai_summaries_enabled
  → SELECT cached row + live comment count   (one round trip)
  → { facts, brief | null, commentFiles, newSinceBrief: N, enabled }
```

`commentFiles` is a comment id → file id map (**added 2026-08-24**, whole-branch review — see "Citation chips" below), populated only when a brief exists. A brief's themes can cite pins from any file in the version, but the comments panel only ever has one file's comments loaded; a citation chip needs to know which file to switch to before it can jump to the comment it names.

`getPackageAccess` is keyed on a user id, so anonymous link viewers fall out of decision #5 naturally rather than needing a separate check.

**Anyone who can read a brief can refresh it.** No separate capability: the people best placed to notice a brief has gone stale are the ones reading it, and gating refresh behind ownership would leave commenters staring at text they can see is out of date. Spend is bounded by the design rather than by permissions — `POST` on a brief that is not stale returns the cached row without calling the model, so repeated clicking costs nothing.

The client renders the fact strip from `facts` regardless. If `brief` is null and the version has crossed the threshold, it fires one `POST`. If `newSinceBrief > 0`, it shows the cached brief with the count and a Refresh.

### Write

```
POST /api/versions/[id]/summary
  same gates
  → load: versionFacts + versionCoverage + versionComments + priorThemes  (lib/ai/facts.ts)
  → composeVersionBrief: capComments → labelAuthors → buildVersionPrompt (lib/ai/prompt.ts)
    → provider.complete()
    → validateVersionBrief(json, sentIds, priorVersionIds)               (lib/ai/validate.ts)
  → upsert covered_count = count, covered_through = maxCreatedAt
```

**The watermark comes from the coverage query taken alongside the load, not from a fresh count after generation.** A comment landing during the seconds the model is thinking would otherwise be stamped as covered by a brief that never saw it — and because staleness is computed rather than flagged, that comment would be invisible forever rather than merely late.

### Concurrency needs no locking

```sql
ON CONFLICT (version_id) DO UPDATE SET ...
WHERE excluded.covered_count >= version_summaries.covered_count
```

Two simultaneous refreshes both generate; the more complete brief wins, the staler is discarded, neither request errors. Worst case is $0.0014 instead of $0.0007.

### Project briefs

Same shape one level up. `summarizeProject` (`lib/ai/summarize.ts`) reads `version_summaries` rather than comments, `covered_through` is the max `generated_at` consumed, `composeProjectBrief` (`lib/ai/compose.ts`) builds the prompt and calls the provider, and the validator checks every cited `versionId` belongs to that project.

---

## Routes

| Route | Purpose |
|---|---|
| `GET /api/versions/[id]/summary` | Cached brief + facts + staleness |
| `POST /api/versions/[id]/summary` | Generate or refresh |
| `GET /api/projects/[id]/summary` | Cached project brief + staleness |
| `POST /api/projects/[id]/summary` | Generate or refresh |
| `POST /api/versions/[id]/changelog-draft` | Draft text for the new-version drawer; returns text, writes nothing |
| `PATCH /api/projects/[id]` | New verb on an existing route (has `GET` and `DELETE` today) — writes `ai_summaries_enabled` |

---

## UI

| Surface | What lands there |
|---|---|
| `components/portal/CommentsPanel.tsx` | The version brief, above the comment list. Collapsible, collapse state persisted. A citation chip switches to the pin's file if it isn't already selected, then scrolls to and highlights it — a chip that cannot resolve to a file (`commentFiles`, above) is not rendered at all rather than shown dead. |
| `components/portal/FileTreeSidebar.tsx` | The headline only, one line under each version bar. Free — the text already exists — and it is what makes the feature discoverable without a nav entry. |
| `app/project/[id]/page.tsx` | The project brief above the package rows, each section citing down to the version whose brief made the claim. |
| `components/portal/NewVersionDrawer.tsx` | A **Suggest** control beside the existing changelog textarea. One call, on click, into an editable field — not auto-filled on open, which would spend a call every time the drawer opens and pre-commit text nobody asked for. |
| Project page header | The `ai_summaries_enabled` toggle plus a one-line disclosure naming the provider. |

### Delete `components/portal/VersionTimeline.tsx`

It is defined, exported, and imported nowhere; the version list lives inside `FileTreeSidebar`. It matters to this work specifically because it is exactly where a reasonable person would put a per-version headline, where it would render nothing. Removing the decoy is in scope.

---

## Failure modes

The rule: **a failure never destroys a good brief.**

| Condition | Behaviour |
|---|---|
| No `ATLAS_API_KEY` | Fact strip renders; brief area says summarisation is not configured. |
| Provider 5xx or timeout | `POST` returns 503 with a reason. Any cached brief stays on screen, marked "couldn't refresh". |
| Malformed JSON | Treated as provider failure. Logged, not upserted. |
| Validator drops every theme | Also not upserted. A headline with no themes is worse than no brief, and a rising drop rate is the signal the model choice is wrong. |
| Toggle switched off | Rows for that project are **deleted**, not hidden. If this is switched off for a client, the honest reading is that the summaries go away — not that they wait in the database for a re-enable. |

Provider calls carry a ~20s `AbortSignal` and the routes an explicit `maxDuration`, so a hung upstream fails as a 503 rather than a platform timeout.

---

## Testing

Existing pattern: `node --test scripts/tests/*.mjs`. **No live inference in tests** — the provider is injected and driven with canned responses.

- **`validate.ts`** carries the heaviest coverage and is pure: a fabricated comment id is dropped; a theme left citing nothing is dropped; a `firstSeenVersionId` that does not precede the version is rejected. These are the tests that prove a citation chip cannot point at a comment that does not exist.
- **`prompt.ts`**: no real name or email appears in the outgoing body; the 150-comment cap sets `omittedCount`.
- **Staleness arithmetic**: insert comments after a brief, assert the flag flips and the count is right.
- **`provider.ts`**: no key returns `{ ok: false }` rather than throwing.
- **Access**: an anonymous link viewer gets no brief from either summary route.

---

## Risks

**Summary quality is unmeasured until real data runs through it.** The design mitigates the dangerous half — fabricated citations are structurally impossible — but bland or unhelpful themes are still possible and only visible on real packages. The drop-rate log is the instrument; a high rate means change `ATLAS_MODEL`.

**Pseudonymisation is only as good as the comment bodies.** People sign their names and quote emails inside comment text. Author fields are handled; text is not scrubbed. Worth stating plainly rather than implying the payload is anonymous.

**The project brief compounds summarisation error** — it reads briefs, not comments, so a wrong version brief propagates upward. Citations down to the version make it traceable, not prevented.

**`ai_summaries_enabled` is enforced server-side in the summary routes**, not only hidden in the UI. Any new surface reading these tables must check it too.
