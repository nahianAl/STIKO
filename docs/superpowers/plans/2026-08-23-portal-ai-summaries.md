# Portal AI Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every package version an AI-written brief that summarises its comments and cites the pins behind each claim, and roll those briefs up into a per-project status summary.

**Architecture:** SQL computes every fact (open threads, verdict tallies, counts); the LLM only clusters comments into themes and phrases them. Results cache in two tables with a coverage watermark, so staleness is *computed* on read rather than flagged on write. One narrow provider seam (`lib/ai/provider.ts`) talks to Atlas Cloud's OpenAI-compatible endpoint with plain `fetch`, mirroring `lib/email.ts`. A dependency-free validator drops any citation the model invented, which makes a hallucinated pin structurally impossible.

**Tech Stack:** Next.js 14 App Router, TypeScript, Neon serverless Postgres (`lib/db.ts`), Atlas Cloud inference, `node --test` with `.mjs` test files.

**Design spec:** `docs/superpowers/specs/2026-08-23-portal-ai-summaries-design.md`

## Global Constraints

- **No new npm dependencies.** Use plain `fetch`, exactly as `lib/cloudconvert.ts` and `lib/email.ts` do.
- **Tests are `.mjs` in `scripts/tests/`** and import `.ts` modules directly (e.g. `from '../../lib/ai/validate.ts'`). Run with `npm test`.
- **No live inference in any test.** `summarize.ts` takes an injectable provider; tests pass canned responses.
- **UI copy says "Package", code says "Portal".** Never surface the word "portal" to a user.
- **Migrations run before the reading code deploys.** `npm run migrate` applies `lib/schema.sql` then `lib/migrations/*.sql` in name order; every statement must be safe to re-run.
- **No database is available in this workspace.** There is no `.env.local`, `DATABASE_URL` is unset, and `psql` is not installed, so `npm run migrate` and every browser check are impossible here. SQL and UI go unexercised end to end; that is a known, recorded limitation, not something to work around by inventing a database. **Never write a `.env.local`** — it would shadow real config later.
- **The gate set is `npm test`, `npx tsc --noEmit`, `npx next lint`, and compilation.** For the last one: `npm run build` **cannot complete in this workspace and never could** — it reaches `✓ Compiled successfully`, then dies at "Collecting page data" with `DATABASE_URL environment variable is not set`, because route modules import `lib/db.ts`, which has thrown on a missing `DATABASE_URL` since the repo's first production commit. Verified: the pre-branch baseline (`5fc332b`) fails identically. **The gate is `✓ Compiled successfully`.** A compilation error is a real failure; the page-data error is not, and must not be reported as one.
- **`lib/schema.sql` and `lib/migrations/` are kept in step** — the schema file states this explicitly.
- Model is `ATLAS_MODEL`, defaulting to DeepSeek V4 Flash. Endpoint is `ATLAS_BASE_URL`, defaulting to `https://api.atlascloud.ai/v1`. Key is `ATLAS_API_KEY`.
- Comment cap per brief: **150**, most recent first, with the omitted count stated in the brief.
- Auto-generate the first brief once a version has **3** comments.
- Provider timeout: **20000 ms** via `AbortSignal.timeout`.
- Authors are pseudonymised (`Reviewer A`) before the request. Real names are never sent.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/migrations/004-ai-summaries.sql` | New tables + `projects.ai_summaries_enabled` |
| `lib/ai/types.ts` | Shared interfaces. No logic. |
| `lib/ai/validate.ts` | Citation guard. Pure, zero dependencies. |
| `lib/ai/prompt.ts` | Pure prompt construction: capping, pseudonymising, message text. |
| `lib/ai/provider.ts` | The Atlas Cloud seam. Plain `fetch`, honest failure. |
| `lib/ai/staleness.ts` | `isStale` — pure staleness comparison. Dependency-free so a test can import it without `@/lib/db`. |
| `lib/ai/facts.ts` | Deterministic fact strip + coverage queries. |
| `lib/ai/compose.ts` | The pure half of orchestration: prompt → provider → validate. Database-free so tests can import it. |
| `lib/ai/summarize.ts` | The database half: load → compose → upsert, plus cached reads. Imports `@/lib/db`, so no test may import it. |
| `app/api/versions/[id]/summary/route.ts` | Version brief read/refresh |
| `app/api/projects/[id]/summary/route.ts` | Project brief read/refresh |
| `app/api/versions/[id]/changelog-draft/route.ts` | Changelog suggestion (returns text, writes nothing) |
| `components/portal/VersionBrief.tsx` | The brief panel, rendered inside `CommentsPanel` |
| `components/project/ProjectBrief.tsx` | The project brief on the project page |

---

## Task 1: Database migration

**Files:**
- Create: `lib/migrations/004-ai-summaries.sql`
- Modify: `lib/schema.sql` (append the same DDL)

**Interfaces:**
- Consumes: nothing
- Produces: tables `version_summaries`, `project_summaries`; column `projects.ai_summaries_enabled`

- [ ] **Step 1: Write the migration**

Create `lib/migrations/004-ai-summaries.sql`:

```sql
-- AI summaries (2026-08-23).
--
-- Two caches and a switch.
--
-- Staleness is deliberately NOT a column. It is computed at read time because a
-- flag would need invalidating from every route that writes a comment, and would
-- silently drift the first time one forgot.
--
-- A version brief is stale when its `covered_count` falls below the live COUNT of
-- comments. A project brief is stale when its `covered_through` is older than the
-- newest `generated_at` from its constituent version_summaries.
--
-- `covered_through` is written from the same query that built the payload, not
-- from a fresh clock. A comment that lands while the model is thinking must not
-- be stamped as covered by a brief that never saw it — because staleness is
-- computed, such a comment would be invisible for good rather than merely late.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ai_summaries_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS version_summaries (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL UNIQUE REFERENCES versions(id) ON DELETE CASCADE,
  headline TEXT NOT NULL,
  themes JSONB NOT NULL DEFAULT '[]',
  covered_count INT NOT NULL,
  covered_through TIMESTAMPTZ NOT NULL,
  model TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_summaries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  headline TEXT NOT NULL,
  sections JSONB NOT NULL DEFAULT '[]',
  covered_through TIMESTAMPTZ NOT NULL,
  model TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS comments_file_created_idx ON comments(file_id, created_at);
CREATE INDEX IF NOT EXISTS files_version_idx ON files(version_id);
```

- [ ] **Step 2: Append the same DDL to `lib/schema.sql`**

Copy the three `ALTER`/`CREATE TABLE` statements and both `CREATE INDEX` statements to the end of `lib/schema.sql`, without the comment block. The file's own header says the two must be kept in step.

- [ ] **Step 3: Verify the file splits into the statements the runner expects**

`scripts/migrate.mjs` requires `DATABASE_URL` even for `--dry`, so it cannot run here. Reproduce its splitter instead — this is the only thing about the file that can be got wrong without a database (an unterminated statement or a stray semicolon inside a comment).

Run:

```bash
node -e "
const fs=require('fs');
const t=fs.readFileSync('lib/migrations/004-ai-summaries.sql','utf8');
const parts=t.split('\n').map(l=>l.replace(/--.*\$/,'')).join('\n').split(';').map(s=>s.trim()).filter(Boolean);
console.log(parts.length+' statement(s)');
parts.forEach(p=>console.log('  '+p.split('\n')[0].slice(0,70)));
"
```

Expected: `5 statement(s)`, listing the `ALTER TABLE projects`, two `CREATE TABLE`, and two `CREATE INDEX` openers. No fragment that is only a comment.

- [ ] **Step 4: Confirm the same DDL reached `lib/schema.sql`**

Run: `grep -c "ai_summaries_enabled\|version_summaries\|project_summaries\|comments_file_created_idx\|files_version_idx" lib/schema.sql`
Expected: `5` — one line per statement. (`grep -c` counts matching lines, not matches, and the two index statements name neither table, so a keyword list covering only the tables would report 3.)

The migration is **not applied here** — no database exists in this workspace. Applying it is a deploy step, and it must run before any code that reads these tables serves traffic.

- [ ] **Step 5: Commit**

```bash
git add lib/migrations/004-ai-summaries.sql lib/schema.sql
git commit -m "feat(ai): add version_summaries and project_summaries tables"
```

---

## Task 2: Shared types

**Files:**
- Create: `lib/ai/types.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `BriefTheme`, `VersionBrief`, `ProjectSection`, `ProjectBrief`, `VersionFacts`, `RawComment`, `PayloadComment`, `PriorTheme`, `CompleteOptions`, `CompleteResult`, `Provider` (11 exports; the Step 1 code block is authoritative)

- [ ] **Step 1: Write the file**

Create `lib/ai/types.ts`:

```ts
/**
 * Shapes shared across lib/ai. No logic lives here — every module below
 * depends on this file, so anything with behaviour would make the graph cyclic.
 */

/** One clustered theme, with the comments that justify it. */
export interface BriefTheme {
  title: string;
  body: string;
  /** Comment ids. Guaranteed real: validate.ts drops anything unrecognised. */
  commentIds: string[];
  /** Set when this concern first appeared in an earlier version. */
  firstSeenVersionId: string | null;
}

export interface VersionBrief {
  headline: string;
  themes: BriefTheme[];
}

export interface ProjectSection {
  portalId: string;
  body: string;
  versionIds: string[];
}

export interface ProjectBrief {
  headline: string;
  sections: ProjectSection[];
}

/** Everything SQL knows. Rendered even when inference is unavailable. */
export interface VersionFacts {
  commentCount: number;
  openThreadCount: number;
  approvedCount: number;
  changesRequestedCount: number;
  participantCount: number;
  mostAnnotatedFile: string | null;
}

/** A comment as it comes out of SQL, with the real author name still on it. */
export interface RawComment {
  id: string;
  /** Stable identity for labelling. user_id, or the author string for guests. */
  authorKey: string;
  author: string;
  text: string;
  file: string;
  isReply: boolean;
}

/** A comment as it is sent to the provider — pseudonymous by construction. */
export interface PayloadComment {
  id: string;
  /** "Reviewer A". Never a real name. */
  author: string;
  text: string;
  file: string;
  isReply: boolean;
  /**
   * Brand. `RawComment` has every field above plus `authorKey`, which makes it
   * structurally assignable to this interface — TypeScript's structural typing
   * cannot otherwise tell "real name" from "pseudonym", so a caller could skip
   * `labelAuthors()` entirely and the compiler would accept it. This field
   * exists only so `labelAuthors()` is the sole producer of a `PayloadComment`:
   * it is not optional, because an optional field would restore assignability
   * and undo the guarantee.
   */
  readonly pseudonymised: true;
}

/** A theme from an earlier version, supplied as context for recurrence. */
export interface PriorTheme {
  versionId: string;
  title: string;
  body: string;
}

export interface CompleteOptions {
  system: string;
  user: string;
  timeoutMs?: number;
}

export type CompleteResult =
  | { ok: true; data: unknown; model: string }
  | { ok: false; reason: string };

/** Injectable so tests never make a network call. */
export type Provider = (opts: CompleteOptions) => Promise<CompleteResult>;
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `lib/ai/types.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/types.ts
git commit -m "feat(ai): add shared types for summaries"
```

---

## Task 3: The citation validator

This is the module that makes a fabricated pin impossible. It is pure and has no imports beyond types, so it is fully testable without a database or network.

**Files:**
- Create: `lib/ai/validate.ts`
- Test: `scripts/tests/aiValidate.test.mjs`

**Interfaces:**
- Consumes: `BriefTheme`, `VersionBrief`, `ProjectBrief` from `lib/ai/types.ts`
- Produces: `validateVersionBrief(raw, sentIds, priorVersionIds) => ValidationResult`, `validateProjectBrief(raw, portalIds, versionIds) => ProjectValidationResult`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/aiValidate.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateVersionBrief, validateProjectBrief } from '../../lib/ai/validate.ts';

const SENT = new Set(['c1', 'c2', 'c3']);
const PRIOR = new Set(['v1', 'v2']);

const theme = (over = {}) => ({
  title: 'Clearance at the pump housing',
  body: 'Three reviewers flagged the same gap.',
  commentIds: ['c1', 'c2'],
  firstSeenVersionId: null,
  ...over,
});

test('a clean brief passes through unchanged', () => {
  const out = validateVersionBrief(
    { headline: 'Converging', themes: [theme()] },
    SENT,
    PRIOR
  );
  assert.equal(out.brief.headline, 'Converging');
  assert.deepEqual(out.brief.themes[0].commentIds, ['c1', 'c2']);
  assert.equal(out.droppedIds, 0);
});

test('a fabricated comment id is dropped, the theme survives', () => {
  // The whole point of the guard: the model invents "c99", a chip pointing at
  // it would 404, so it never reaches the client.
  const out = validateVersionBrief(
    { headline: 'H', themes: [theme({ commentIds: ['c1', 'c99'] })] },
    SENT,
    PRIOR
  );
  assert.deepEqual(out.brief.themes[0].commentIds, ['c1']);
  assert.equal(out.droppedIds, 1);
});

test('a theme left citing nothing is dropped entirely', () => {
  const out = validateVersionBrief(
    { headline: 'H', themes: [theme({ commentIds: ['c98', 'c99'] }), theme()] },
    SENT,
    PRIOR
  );
  assert.equal(out.brief.themes.length, 1);
  assert.equal(out.droppedThemes, 1);
});

test('a brief whose themes all die returns no brief at all', () => {
  // A headline with nothing under it is worse than showing no brief: it looks
  // authoritative and says nothing.
  const out = validateVersionBrief(
    { headline: 'H', themes: [theme({ commentIds: ['c99'] })] },
    SENT,
    PRIOR
  );
  assert.equal(out.brief, null);
});

test('firstSeenVersionId is kept only when it names a real earlier version', () => {
  const good = validateVersionBrief(
    { headline: 'H', themes: [theme({ firstSeenVersionId: 'v2' })] },
    SENT,
    PRIOR
  );
  assert.equal(good.brief.themes[0].firstSeenVersionId, 'v2');

  const bad = validateVersionBrief(
    { headline: 'H', themes: [theme({ firstSeenVersionId: 'v42' })] },
    SENT,
    PRIOR
  );
  assert.equal(bad.brief.themes[0].firstSeenVersionId, null);
});

test('duplicate ids within a theme are collapsed', () => {
  const out = validateVersionBrief(
    { headline: 'H', themes: [theme({ commentIds: ['c1', 'c1', 'c2'] })] },
    SENT,
    PRIOR
  );
  assert.deepEqual(out.brief.themes[0].commentIds, ['c1', 'c2']);
});

test('themes are capped at six', () => {
  const many = Array.from({ length: 9 }, () => theme());
  const out = validateVersionBrief({ headline: 'H', themes: many }, SENT, PRIOR);
  assert.equal(out.brief.themes.length, 6);
});

test('garbage in returns no brief rather than throwing', () => {
  // The provider can return anything. Every one of these must be a null brief,
  // never an exception escaping into a route handler.
  for (const raw of [null, undefined, 42, 'text', {}, { headline: 'H' }, { themes: [] }]) {
    const out = validateVersionBrief(raw, SENT, PRIOR);
    assert.equal(out.brief, null, `input ${JSON.stringify(raw)}`);
  }
});

test('a blank headline is rejected', () => {
  const out = validateVersionBrief({ headline: '   ', themes: [theme()] }, SENT, PRIOR);
  assert.equal(out.brief, null);
});

const PORTAL_IDS = new Set(['p1', 'p2']);
const VERSION_IDS = new Set(['v1', 'v2', 'v3']);

const section = (over = {}) => ({
  portalId: 'p1',
  body: 'Reviewers converged on tolerance for the housing seal.',
  versionIds: ['v1', 'v2'],
  ...over,
});

test('a clean project brief passes through unchanged', () => {
  const out = validateProjectBrief(
    { headline: 'Portfolio update', sections: [section()] },
    PORTAL_IDS,
    VERSION_IDS
  );
  assert.equal(out.brief.headline, 'Portfolio update');
  assert.deepEqual(out.brief.sections, [
    {
      portalId: 'p1',
      body: 'Reviewers converged on tolerance for the housing seal.',
      versionIds: ['v1', 'v2'],
    },
  ]);
  assert.equal(out.droppedSections, 0);
});

test('a section naming an unknown portalId is dropped', () => {
  // A section citing a portal the caller never sent would deep-link to a
  // package the viewer has no access to, or that does not exist at all.
  const out = validateProjectBrief(
    { headline: 'H', sections: [section({ portalId: 'p99' }), section()] },
    PORTAL_IDS,
    VERSION_IDS
  );
  assert.equal(out.brief.sections.length, 1);
  assert.equal(out.brief.sections[0].portalId, 'p1');
  assert.equal(out.droppedSections, 1);
});

test('a fabricated versionId is dropped, the section survives', () => {
  // The project-tier analogue of the version tier's "fabricated id dropped,
  // theme survives": unlike a theme, a section is not dropped for running
  // out of citations, so it survives losing the invented one.
  const out = validateProjectBrief(
    { headline: 'H', sections: [section({ versionIds: ['v1', 'v99'] })] },
    PORTAL_IDS,
    VERSION_IDS
  );
  assert.equal(out.brief.sections.length, 1);
  assert.deepEqual(out.brief.sections[0].versionIds, ['v1']);
  assert.equal(out.droppedSections, 0);
});

test('a brief whose sections all get dropped returns no brief at all', () => {
  // A headline with nothing under it is worse than showing no brief: it looks
  // authoritative about the whole portfolio and says nothing.
  const out = validateProjectBrief(
    { headline: 'H', sections: [section({ portalId: 'p99' }), section({ portalId: 'p98' })] },
    PORTAL_IDS,
    VERSION_IDS
  );
  assert.equal(out.brief, null);
  assert.equal(out.droppedSections, 2);
});

test('duplicate versionIds within a section are collapsed', () => {
  const out = validateProjectBrief(
    { headline: 'H', sections: [section({ versionIds: ['v1', 'v1', 'v2'] })] },
    PORTAL_IDS,
    VERSION_IDS
  );
  assert.deepEqual(out.brief.sections[0].versionIds, ['v1', 'v2']);
});

test('garbage in returns no brief rather than throwing', () => {
  // The provider can return anything. Every one of these must be a null
  // brief, never an exception escaping into a route handler.
  for (const raw of [null, undefined, 42, 'text', {}, { headline: 'H' }, { sections: [] }]) {
    const out = validateProjectBrief(raw, PORTAL_IDS, VERSION_IDS);
    assert.equal(out.brief, null, `input ${JSON.stringify(raw)}`);
  }
});

test('a blank project headline is rejected', () => {
  const out = validateProjectBrief(
    { headline: '   ', sections: [section()] },
    PORTAL_IDS,
    VERSION_IDS
  );
  assert.equal(out.brief, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/aiValidate.test.mjs`
Expected: FAIL — `Cannot find module '../../lib/ai/validate.ts'`

- [ ] **Step 3: Write the implementation**

Create `lib/ai/validate.ts`:

```ts
import type { BriefTheme, VersionBrief, ProjectBrief, ProjectSection } from './types';

/**
 * The anti-hallucination guard.
 *
 * Everything a brief asserts is anchored to ids the server itself sent. Any id
 * the model invented is removed here, and a theme that has nothing left to
 * point at is removed with it. That is what lets the UI render a citation chip
 * as a link without checking first: it cannot reference a comment that does not
 * exist.
 *
 * Deliberately dependency-free — no database, no network — so the guarantee can
 * be tested directly.
 */

const MAX_THEMES = 6;

export interface ValidationResult {
  /** Null when nothing survived. Callers must not persist a null brief. */
  brief: VersionBrief | null;
  droppedIds: number;
  droppedThemes: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function validateVersionBrief(
  raw: unknown,
  sentIds: Set<string>,
  priorVersionIds: Set<string>
): ValidationResult {
  let droppedIds = 0;
  let droppedThemes = 0;

  if (!isRecord(raw)) return { brief: null, droppedIds, droppedThemes };

  const headline = text(raw.headline);
  if (!headline || !Array.isArray(raw.themes)) {
    return { brief: null, droppedIds, droppedThemes };
  }

  const themes: BriefTheme[] = [];

  for (const candidate of raw.themes) {
    if (!isRecord(candidate)) {
      droppedThemes += 1;
      continue;
    }

    const title = text(candidate.title);
    const body = text(candidate.body);
    const ids = Array.isArray(candidate.commentIds) ? candidate.commentIds : [];

    const kept: string[] = [];
    for (const id of ids) {
      if (typeof id === 'string' && sentIds.has(id)) {
        if (!kept.includes(id)) kept.push(id);
      } else {
        droppedIds += 1;
      }
    }

    if (!title || !body || kept.length === 0) {
      droppedThemes += 1;
      continue;
    }

    const first = typeof candidate.firstSeenVersionId === 'string'
      ? candidate.firstSeenVersionId
      : null;

    themes.push({
      title,
      body,
      commentIds: kept,
      // Only trust a recurrence claim that names a version we actually
      // supplied as prior context.
      firstSeenVersionId: first && priorVersionIds.has(first) ? first : null,
    });
  }

  if (themes.length === 0) return { brief: null, droppedIds, droppedThemes };

  return {
    brief: { headline, themes: themes.slice(0, MAX_THEMES) },
    droppedIds,
    droppedThemes,
  };
}

export interface ProjectValidationResult {
  brief: ProjectBrief | null;
  droppedSections: number;
}

export function validateProjectBrief(
  raw: unknown,
  portalIds: Set<string>,
  versionIds: Set<string>
): ProjectValidationResult {
  let droppedSections = 0;
  if (!isRecord(raw)) return { brief: null, droppedSections };

  const headline = text(raw.headline);
  if (!headline || !Array.isArray(raw.sections)) {
    return { brief: null, droppedSections };
  }

  const sections: ProjectSection[] = [];

  for (const candidate of raw.sections) {
    if (!isRecord(candidate)) {
      droppedSections += 1;
      continue;
    }
    const portalId = typeof candidate.portalId === 'string' ? candidate.portalId : null;
    const body = text(candidate.body);
    const cited = Array.isArray(candidate.versionIds) ? candidate.versionIds : [];
    const kept = cited.filter(
      (v): v is string => typeof v === 'string' && versionIds.has(v)
    );

    if (!portalId || !portalIds.has(portalId) || !body) {
      droppedSections += 1;
      continue;
    }

    // Array.from, not [...set] — tsconfig.json sets no "target", so it
    // defaults to ES5 and spreading an iterator is a TS2802.
    sections.push({ portalId, body, versionIds: Array.from(new Set(kept)) });
  }

  if (sections.length === 0) return { brief: null, droppedSections };
  return { brief: { headline, sections }, droppedSections };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/tests/aiValidate.test.mjs`
Expected: PASS — 16 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/validate.ts scripts/tests/aiValidate.test.mjs
git commit -m "feat(ai): add citation validator that drops fabricated ids"
```

---

## Task 4: Prompt construction

Pure functions: capping, pseudonymising, and building the two message strings. Testable without a database, and the place where "no real names leave the building" is proved.

**Files:**
- Create: `lib/ai/prompt.ts`
- Test: `scripts/tests/aiPrompt.test.mjs`

**Interfaces:**
- Consumes: `PayloadComment`, `VersionFacts`, `BriefTheme` from `lib/ai/types.ts`
- Produces: `capComments(rows, limit)`, `labelAuthors(rows)`, `buildVersionPrompt(input)`, `buildProjectPrompt(input)`, `buildChangelogPrompt(input)`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/aiPrompt.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capComments,
  labelAuthors,
  buildVersionPrompt,
} from '../../lib/ai/prompt.ts';

const raw = (over = {}) => ({
  id: 'c1',
  author: 'Dana Whitfield',
  authorKey: 'user-1',
  text: 'The clearance here is too tight.',
  file: 'level3.step',
  isReply: false,
  ...over,
});

test('capComments keeps the newest and reports what it dropped', () => {
  const rows = Array.from({ length: 170 }, (_, i) => raw({ id: `c${i}` }));
  const { kept, omittedCount } = capComments(rows, 150);

  assert.equal(kept.length, 150);
  assert.equal(omittedCount, 20);
  // Input arrives newest-first, so the cap takes from the front.
  assert.equal(kept[0].id, 'c0');
});

test('capComments reports nothing omitted when under the limit', () => {
  const { kept, omittedCount } = capComments([raw(), raw({ id: 'c2' })], 150);
  assert.equal(kept.length, 2);
  assert.equal(omittedCount, 0);
});

test('labelAuthors replaces every real name with a stable pseudonym', () => {
  const { labelled, labels } = labelAuthors([
    raw({ id: 'c1', authorKey: 'user-1', author: 'Dana Whitfield' }),
    raw({ id: 'c2', authorKey: 'user-2', author: 'Ravi Chandra' }),
    raw({ id: 'c3', authorKey: 'user-1', author: 'Dana Whitfield' }),
  ]);

  assert.equal(labelled[0].author, 'Reviewer A');
  assert.equal(labelled[1].author, 'Reviewer B');
  // Same person, same label — the model can count distinct voices.
  assert.equal(labelled[2].author, 'Reviewer A');
  assert.equal(labels.get('Reviewer A'), 'user-1');
});

test('labelFor is bijective past 26 authors: no collisions, and AA lands at index 26', () => {
  // labelFor is a bijective base-26 ("Excel column") encoder. Two authors is
  // not enough to catch an off-by-one in its carry logic, and a collision
  // here would silently merge two distinct reviewers into one apparent voice.
  const rows = Array.from({ length: 60 }, (_, i) =>
    raw({ id: `c${i}`, authorKey: `user-${i}`, author: `Author ${i}` })
  );
  const { labelled } = labelAuthors(rows);

  assert.equal(labelled.length, 60);
  assert.equal(labelled[26].author, 'Reviewer AA');

  const distinctLabels = new Set(labelled.map((c) => c.author));
  assert.equal(distinctLabels.size, 60);
});

test('no real name or email survives into the prompt body', () => {
  // This is the privacy guarantee. If it regresses, personal data starts
  // leaving the building on every generation.
  const { labelled } = labelAuthors([
    raw({ author: 'Dana Whitfield', text: 'looks fine to me' }),
  ]);
  const { system, user } = buildVersionPrompt({
    versionNumber: 3,
    comments: labelled,
    facts: {
      commentCount: 1,
      openThreadCount: 1,
      approvedCount: 0,
      changesRequestedCount: 0,
      participantCount: 2,
      mostAnnotatedFile: 'level3.step',
    },
    priorThemes: [],
    omittedCount: 0,
  });

  assert.doesNotMatch(system + user, /Dana/);
  assert.doesNotMatch(system + user, /Whitfield/);
  assert.match(user, /Reviewer A/);
});

test('the prompt states an omitted count when comments were capped', () => {
  const { labelled } = labelAuthors([raw()]);
  const { user } = buildVersionPrompt({
    versionNumber: 3,
    comments: labelled,
    facts: {
      commentCount: 312,
      openThreadCount: 4,
      approvedCount: 1,
      changesRequestedCount: 2,
      participantCount: 5,
      mostAnnotatedFile: 'level3.step',
    },
    priorThemes: [],
    omittedCount: 162,
  });

  assert.match(user, /162/);
});

test('prior themes are supplied so recurrence can be detected', () => {
  const { labelled } = labelAuthors([raw()]);
  const { user } = buildVersionPrompt({
    versionNumber: 4,
    comments: labelled,
    facts: {
      commentCount: 1,
      openThreadCount: 0,
      approvedCount: 0,
      changesRequestedCount: 0,
      participantCount: 1,
      mostAnnotatedFile: null,
    },
    priorThemes: [
      { versionId: 'v3', title: 'Clearance at the pump housing', body: 'Raised by two reviewers.' },
    ],
    omittedCount: 0,
  });

  assert.match(user, /Clearance at the pump housing/);
  assert.match(user, /v3/);
});

test('the system prompt demands ids only from the supplied set', () => {
  const { labelled } = labelAuthors([raw()]);
  const { system } = buildVersionPrompt({
    versionNumber: 1,
    comments: labelled,
    facts: {
      commentCount: 1,
      openThreadCount: 0,
      approvedCount: 0,
      changesRequestedCount: 0,
      participantCount: 1,
      mostAnnotatedFile: null,
    },
    priorThemes: [],
    omittedCount: 0,
  });

  assert.match(system, /commentIds/);
  assert.match(system, /JSON/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/aiPrompt.test.mjs`
Expected: FAIL — `Cannot find module '../../lib/ai/prompt.ts'`

- [ ] **Step 3: Write the implementation**

Create `lib/ai/prompt.ts`:

```ts
import type { PayloadComment, VersionFacts, RawComment, PriorTheme } from './types';

/**
 * Pure prompt construction.
 *
 * Two jobs beyond string building, both of which are guarantees rather than
 * conveniences:
 *
 *   * pseudonymisation — real names never reach a third party. Labels are
 *     stable within a request so the model can still say "three reviewers",
 *     and the caller rehydrates names client-side from the cited ids.
 *   * capping — a version with 300 comments is truncated, and the prompt says
 *     so. Silent truncation would produce a brief that is quietly wrong.
 */

export function capComments<T>(
  rows: T[],
  limit = 150
): { kept: T[]; omittedCount: number } {
  if (rows.length <= limit) return { kept: rows, omittedCount: 0 };
  return { kept: rows.slice(0, limit), omittedCount: rows.length - limit };
}

/** A, B, ... Z, AA, AB — enough for any realistic reviewer count. */
function labelFor(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Reviewer ${out}`;
}

export function labelAuthors(
  rows: RawComment[]
): { labelled: PayloadComment[]; labels: Map<string, string> } {
  const byKey = new Map<string, string>();
  const labels = new Map<string, string>();

  const labelled = rows.map((row) => {
    let label = byKey.get(row.authorKey);
    if (!label) {
      label = labelFor(byKey.size);
      byKey.set(row.authorKey, label);
      labels.set(label, row.authorKey);
    }
    return {
      id: row.id,
      author: label,
      text: row.text,
      file: row.file,
      isReply: row.isReply,
      pseudonymised: true as const,
    };
  });

  return { labelled, labels };
}

const SYSTEM = `You summarise design-review feedback on engineering and architectural files.

Return ONLY a JSON object with this shape:
{
  "headline": "one sentence on where this version stands",
  "themes": [
    {
      "title": "short label",
      "body": "one or two sentences",
      "commentIds": ["<ids of the comments this theme is built from>"],
      "firstSeenVersionId": "<a version id from PRIOR THEMES, or null>"
    }
  ]
}

Rules:
- Every id in commentIds MUST come from the comments supplied below. Never invent one.
- Produce between one and six themes. Group related pins; do not restate each comment.
- Set firstSeenVersionId only when a theme clearly repeats a prior theme supplied below.
- Be neutral and factual. The people being summarised will read this.
- Do not name individuals beyond the reviewer labels given.`;

export function buildVersionPrompt(input: {
  versionNumber: number;
  comments: PayloadComment[];
  facts: VersionFacts;
  priorThemes: PriorTheme[];
  omittedCount: number;
}): { system: string; user: string } {
  const lines: string[] = [];

  lines.push(`VERSION ${input.versionNumber}`);
  lines.push(
    `Facts: ${input.facts.commentCount} comments, ${input.facts.openThreadCount} unanswered threads, ` +
      `${input.facts.approvedCount} approved, ${input.facts.changesRequestedCount} requested changes, ` +
      `${input.facts.participantCount} participants.`
  );
  if (input.facts.mostAnnotatedFile) {
    lines.push(`Most annotated file: ${input.facts.mostAnnotatedFile}`);
  }
  if (input.omittedCount > 0) {
    lines.push(
      `NOTE: only the ${input.comments.length} most recent comments are shown; ` +
        `${input.omittedCount} older ones were omitted. Say so in the headline.`
    );
  }

  if (input.priorThemes.length > 0) {
    lines.push('', 'PRIOR THEMES (from earlier versions):');
    for (const t of input.priorThemes) {
      lines.push(`- [${t.versionId}] ${t.title}: ${t.body}`);
    }
  }

  lines.push('', 'COMMENTS:');
  for (const c of input.comments) {
    const kind = c.isReply ? 'reply' : 'comment';
    lines.push(`- id=${c.id} (${kind}, ${c.author}, on ${c.file}): ${c.text}`);
  }

  return { system: SYSTEM, user: lines.join('\n') };
}

const PROJECT_SYSTEM = `You write a short status brief for a design project, from per-version summaries.

Return ONLY a JSON object with this shape:
{
  "headline": "one sentence on where the project stands",
  "sections": [
    { "portalId": "<a package id supplied below>", "body": "one or two sentences", "versionIds": ["<version ids supplied below>"] }
  ]
}

Rules:
- Use only the package and version ids supplied below. Never invent one.
- One section per package that has activity. Say whether it is converging or stuck, and what is blocking.
- Be neutral and factual.`;

export function buildProjectPrompt(input: {
  projectName: string;
  packages: Array<{
    portalId: string;
    name: string;
    versions: Array<{ versionId: string; versionNumber: number; headline: string }>;
  }>;
}): { system: string; user: string } {
  const lines: string[] = [`PROJECT: ${input.projectName}`, ''];

  for (const pkg of input.packages) {
    lines.push(`PACKAGE ${pkg.name} (portalId=${pkg.portalId}):`);
    for (const v of pkg.versions) {
      lines.push(`  - [${v.versionId}] v${v.versionNumber}: ${v.headline}`);
    }
    lines.push('');
  }

  return { system: PROJECT_SYSTEM, user: lines.join('\n') };
}

const CHANGELOG_SYSTEM = `You draft a short changelog entry for a new version of a design package.

Return ONLY a JSON object: { "changelog": "one or two sentences" }

Write what the new version addresses, based on the open concerns from the previous
version. Be concrete and plain. No preamble, no bullet points, no marketing tone.`;

export function buildChangelogPrompt(input: {
  previousVersionNumber: number;
  openThemes: Array<{ title: string; body: string }>;
}): { system: string; user: string } {
  const lines = [`Open concerns from version ${input.previousVersionNumber}:`];
  for (const t of input.openThemes) {
    lines.push(`- ${t.title}: ${t.body}`);
  }
  return { system: CHANGELOG_SYSTEM, user: lines.join('\n') };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/tests/aiPrompt.test.mjs`
Expected: PASS — 8 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/prompt.ts scripts/tests/aiPrompt.test.mjs
git commit -m "feat(ai): add pure prompt construction with author pseudonymisation"
```

---

## Task 5: The provider seam

**Files:**
- Create: `lib/ai/provider.ts`
- Modify: `.env.local.example`
- Test: `scripts/tests/aiProvider.test.mjs`

**Interfaces:**
- Consumes: `CompleteOptions`, `CompleteResult` from `lib/ai/types.ts`
- Produces: `complete(opts) => Promise<CompleteResult>`, `isConfigured() => boolean`, `activeModel() => string`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/aiProvider.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { complete, isConfigured, activeModel } from '../../lib/ai/provider.ts';

test('with no API key the provider reports failure instead of throwing', async () => {
  // Mirrors lib/email.ts: never pretend the third party was reached. The UI
  // shows facts and says summarisation is unconfigured.
  delete process.env.ATLAS_API_KEY;

  assert.equal(isConfigured(), false);

  const result = await complete({ system: 's', user: 'u' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not configured/i);
});

test('activeModel falls back to the documented default', () => {
  delete process.env.ATLAS_MODEL;
  assert.equal(activeModel(), 'deepseek-v4-flash');

  process.env.ATLAS_MODEL = 'something-else';
  assert.equal(activeModel(), 'something-else');
  delete process.env.ATLAS_MODEL;
});

test('a 2xx response with an unreadable body is reported honestly, not as unreachable', async () => {
  // If res.json() were caught by the outer transport try/catch, this would
  // regress to "Could not reach the summarisation provider" — untrue, since
  // the provider was reached and answered 200. That would send an operator
  // hunting for a DNS/TLS/timeout problem that does not exist.
  const originalFetch = globalThis.fetch;
  process.env.ATLAS_API_KEY = 'dummy-key';

  try {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    const result = await complete({ system: 's', user: 'u' });
    assert.equal(result.ok, false);
    assert.match(result.reason, /unreadable response body/i);
    assert.doesNotMatch(result.reason, /could not reach/i);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.ATLAS_API_KEY;
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/aiProvider.test.mjs`
Expected: FAIL — `Cannot find module '../../lib/ai/provider.ts'`

- [ ] **Step 3: Write the implementation**

Create `lib/ai/provider.ts`:

```ts
import type { CompleteOptions, CompleteResult } from './types';

/**
 * The single seam to third-party inference.
 *
 * Shaped after lib/email.ts rather than lib/cloudconvert.ts: one function,
 * plain fetch, no new dependency, and an honest failure flag instead of a
 * thrown error. Callers can then degrade — the fact strip renders even when
 * there is no key and no network.
 *
 * The endpoint is OpenAI-compatible, so switching provider is a base-URL and
 * model-name change, not a code change.
 */

const DEFAULT_BASE_URL = 'https://api.atlascloud.ai/v1';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_TIMEOUT_MS = 20_000;

export function isConfigured(): boolean {
  return Boolean(process.env.ATLAS_API_KEY);
}

export function activeModel(): string {
  return process.env.ATLAS_MODEL || DEFAULT_MODEL;
}

export async function complete(opts: CompleteOptions): Promise<CompleteResult> {
  const apiKey = process.env.ATLAS_API_KEY;
  if (!apiKey) {
    console.info('[ai] skipped — ATLAS_API_KEY is not configured');
    return { ok: false, reason: 'Summarisation is not configured' };
  }

  const baseUrl = process.env.ATLAS_BASE_URL || DEFAULT_BASE_URL;
  const model = activeModel();

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1200,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error(`[ai] provider rejected the request: ${res.status} ${detail}`);
      return { ok: false, reason: 'The summarisation provider rejected the request' };
    }

    let payload;
    try {
      payload = await res.json();
    } catch {
      console.error('[ai] provider returned an unreadable response body');
      return { ok: false, reason: 'The summarisation provider returned an unreadable response body' };
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      console.error('[ai] provider returned no message content');
      return { ok: false, reason: 'The summarisation provider returned nothing usable' };
    }

    try {
      return { ok: true, data: JSON.parse(content), model };
    } catch {
      // Not a crash: a model that ignores json_object is a provider failure
      // like any other, and the caller keeps whatever brief it already had.
      console.error('[ai] provider returned non-JSON content');
      return { ok: false, reason: 'The summarisation provider returned malformed output' };
    }
  } catch (err) {
    console.error('[ai] transport error', err);
    return { ok: false, reason: 'Could not reach the summarisation provider' };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/tests/aiProvider.test.mjs`
Expected: PASS — 3 tests, 0 failures.

- [ ] **Step 5: Document the environment variables**

Append to `.env.local.example`:

```
# AI summaries (optional). Without ATLAS_API_KEY the package and project pages
# still show the computed fact strip, and the brief area says summarisation is
# not configured rather than pretending. See lib/ai/provider.ts.
# ATLAS_API_KEY=your-atlas-cloud-key
# ATLAS_MODEL=deepseek-v4-flash
# ATLAS_BASE_URL=https://api.atlascloud.ai/v1
```

- [ ] **Step 6: Commit**

```bash
git add lib/ai/provider.ts scripts/tests/aiProvider.test.mjs .env.local.example
git commit -m "feat(ai): add Atlas Cloud provider seam with honest degradation"
```

---

## Task 6: Facts and coverage queries

**Files:**
- Create: `lib/ai/staleness.ts`
- Create: `lib/ai/facts.ts`
- Test: `scripts/tests/aiFacts.test.mjs`

**Interfaces:**
- Consumes: `VersionFacts` from `lib/ai/types.ts`, `sql` from `lib/db`
- Produces: `isStale(coveredCount, liveCount)` (from `lib/ai/staleness.ts`, re-exported by `lib/ai/facts.ts`), `versionFacts(versionId)`, `versionCoverage(versionId)`, `versionComments(versionId)`, `priorThemes(versionId)`

`isStale` lives in its own module, `lib/ai/staleness.ts`, with zero imports. `facts.ts` imports `@/lib/db` at the top of the file, and `lib/db` throws at import time when `DATABASE_URL` is unset — which it always is in this workspace, which must never get a `.env.local`. A test that imports `isStale` would drag that whole import graph in with it, so the pure comparison is split into a dependency-free module the test can import on its own, exactly as `lib/capabilities.ts` is split out of `lib/access.ts`. `facts.ts` then re-exports `isStale` so every other consumer keeps importing it from one place.

- [ ] **Step 1: Write the failing test**

Only `isStale` is pure, and it is the piece with the subtle rule, so it is the piece under test. The query functions are exercised through the route in Task 7.

Create `scripts/tests/aiFacts.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStale } from '../../lib/ai/staleness.ts';

test('a brief is stale when comments have been added since it was built', () => {
  assert.equal(isStale(10, 14), true);
});

test('a brief covering every comment is fresh', () => {
  assert.equal(isStale(10, 10), false);
});

test('a deleted comment does not make a brief stale', () => {
  // Live count below covered_count means comments were removed. The brief is
  // now over-complete, not under-complete — regenerating costs money and
  // changes nothing a reader cares about.
  assert.equal(isStale(10, 7), false);
});

test('a version with no brief yet is not described as stale', () => {
  // Absent and stale are different states in the UI: one offers "Summarise",
  // the other "Refresh". Passing null must not collapse them.
  assert.equal(isStale(null, 5), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/aiFacts.test.mjs`
Expected: FAIL — `Cannot find module '../../lib/ai/staleness.ts'`

- [ ] **Step 3: Write the implementation**

Create `lib/ai/staleness.ts`:

```ts
/**
 * Staleness is a comparison, never a stored flag — a flag would have to be
 * invalidated from every route that writes a comment.
 *
 * `coveredCount` is null when no brief exists: that is "absent", not "stale",
 * and the UI offers a different affordance for each.
 */
export function isStale(coveredCount: number | null, liveCount: number): boolean {
  if (coveredCount === null) return false;
  return liveCount > coveredCount;
}
```

Create `lib/ai/facts.ts`:

```ts
import { sql } from '@/lib/db';
import type { VersionFacts, RawComment, PriorTheme } from './types';

/**
 * Everything the model is NOT asked to work out.
 *
 * Counts, tallies and thread state are cheap in SQL and impossible to
 * hallucinate, so they are computed here and rendered whether or not inference
 * is available. The model is left with the one genuinely linguistic job.
 */

// The pure half lives in ./staleness, not here, because a test can import
// isStale without ever loading this module's top-level `@/lib/db` import —
// which throws when DATABASE_URL is unset. Keep it split; do not fold it
// back in.
export { isStale } from './staleness';

export async function versionFacts(versionId: string): Promise<VersionFacts> {
  const rows = await sql`
    WITH v_comments AS (
      SELECT c.id, c.parent_comment_id, c.user_id, c.author, f.filename
      FROM comments c
      JOIN files f ON f.id = c.file_id
      WHERE f.version_id = ${versionId}
    )
    SELECT
      (SELECT COUNT(*) FROM v_comments)::int AS "commentCount",
      (SELECT COUNT(*) FROM v_comments root
        WHERE root.parent_comment_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM v_comments reply WHERE reply.parent_comment_id = root.id
          ))::int AS "openThreadCount",
      (SELECT COUNT(*) FROM verdicts
        WHERE version_id = ${versionId} AND verdict = 'approved')::int AS "approvedCount",
      (SELECT COUNT(*) FROM verdicts
        WHERE version_id = ${versionId} AND verdict = 'changes_requested')::int
        AS "changesRequestedCount",
      (SELECT COUNT(DISTINCT COALESCE(user_id, author)) FROM v_comments)::int
        AS "participantCount",
      (SELECT filename FROM v_comments
        GROUP BY filename ORDER BY COUNT(*) DESC, filename ASC LIMIT 1)
        AS "mostAnnotatedFile"
  `;

  const row = rows[0] ?? {};
  return {
    commentCount: row.commentCount ?? 0,
    openThreadCount: row.openThreadCount ?? 0,
    approvedCount: row.approvedCount ?? 0,
    changesRequestedCount: row.changesRequestedCount ?? 0,
    participantCount: row.participantCount ?? 0,
    mostAnnotatedFile: row.mostAnnotatedFile ?? null,
  };
}

/**
 * The count and high-water mark that become the brief's watermark.
 *
 * Both come from one query so they describe the same snapshot. Taking the count
 * here and the timestamp later would let a comment slip between them and be
 * marked covered by a brief that never saw it.
 */
export async function versionCoverage(
  versionId: string
): Promise<{ count: number; maxCreatedAt: string }> {
  const rows = await sql`
    SELECT COUNT(*)::int AS count,
           COALESCE(MAX(c.created_at), NOW()) AS "maxCreatedAt"
    FROM comments c
    JOIN files f ON f.id = c.file_id
    WHERE f.version_id = ${versionId}
  `;
  return {
    count: rows[0]?.count ?? 0,
    maxCreatedAt: rows[0]?.maxCreatedAt ?? new Date().toISOString(),
  };
}

/** Newest first — capComments takes from the front. */
export async function versionComments(versionId: string): Promise<RawComment[]> {
  const rows = await sql`
    SELECT c.id,
           COALESCE(c.user_id, c.author) AS "authorKey",
           c.author,
           c.content AS text,
           f.filename AS file,
           (c.parent_comment_id IS NOT NULL) AS "isReply"
    FROM comments c
    JOIN files f ON f.id = c.file_id
    WHERE f.version_id = ${versionId}
    ORDER BY c.created_at DESC
  `;
  return rows as RawComment[];
}

/** Themes from the immediately preceding version, for recurrence detection. */
export async function priorThemes(versionId: string): Promise<PriorTheme[]> {
  const rows = await sql`
    SELECT vs.version_id AS "versionId", vs.themes
    FROM versions cur
    JOIN versions prev
      ON prev.portal_id = cur.portal_id
     AND prev.version_number < cur.version_number
    JOIN version_summaries vs ON vs.version_id = prev.id
    WHERE cur.id = ${versionId}
    ORDER BY prev.version_number DESC
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return [];

  const themes = Array.isArray(row.themes) ? row.themes : [];
  return themes.map((t: { title?: string; body?: string }) => ({
    versionId: row.versionId as string,
    title: String(t?.title ?? ''),
    body: String(t?.body ?? ''),
  }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/tests/aiFacts.test.mjs`
Expected: PASS — 4 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/staleness.ts lib/ai/facts.ts scripts/tests/aiFacts.test.mjs
git commit -m "feat(ai): add deterministic facts and coverage queries"
```

---

## Task 7: Version summarisation

**Files:**
- Create: `lib/ai/compose.ts`
- Create: `lib/ai/summarize.ts`
- Test: `scripts/tests/aiSummarize.test.mjs`

**Interfaces:**
- Consumes: `complete` (Task 5), `validateVersionBrief` (Task 3), `buildVersionPrompt`/`capComments`/`labelAuthors` (Task 4), `versionFacts`/`versionCoverage`/`versionComments`/`priorThemes` (Task 6)
- Produces: `composeVersionBrief(load, provider?)` and the `VersionLoad`/`ComposeOutcome` types (from `lib/ai/compose.ts`, re-exported by `lib/ai/summarize.ts`); `summarizeVersion(versionId, provider?)`, `readVersionBrief(versionId)`

### Why this splits into two modules

Same reason `isStale` lives in `lib/ai/staleness.ts` rather than `lib/ai/facts.ts`, and `capabilitiesFor` lives in `lib/capabilities.ts` rather than `lib/access.ts`.

`summarizeVersion` needs `@/lib/db`, and `lib/db` throws at import time when `DATABASE_URL` is unset — which it always is in this workspace, and a `.env.local` must never be created here. A test importing `composeVersionBrief` from a module that also imports `@/lib/db` would drag that whole graph in and crash before a single assertion ran.

So the pure half — `composeVersionBrief`, which takes its data as an argument and its provider by injection — goes in `lib/ai/compose.ts`, whose imports (`provider`, `validate`, `prompt`, `types`) are all database-free. The database half stays in `lib/ai/summarize.ts` and re-exports the compose functions so production code has one import surface.

**Tests must import from `lib/ai/compose.ts` directly.** Importing the re-export from `summarize.ts` reintroduces exactly the crash this split exists to prevent.

- [ ] **Step 1: Write the failing test**

`composeVersionBrief` takes its loaded data as a plain argument and its provider by injection, so it is testable with no Neon connection and no network.

Create `scripts/tests/aiSummarize.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeVersionBrief } from '../../lib/ai/compose.ts';

const LOAD = {
  versionNumber: 3,
  facts: {
    commentCount: 2,
    openThreadCount: 1,
    approvedCount: 0,
    changesRequestedCount: 1,
    participantCount: 2,
    mostAnnotatedFile: 'level3.step',
  },
  comments: [
    { id: 'c1', authorKey: 'u1', author: 'Dana', text: 'Too tight', file: 'level3.step', isReply: false },
    { id: 'c2', authorKey: 'u2', author: 'Ravi', text: 'Agreed', file: 'level3.step', isReply: true },
  ],
  priorThemes: [{ versionId: 'v2', title: 'Clearance', body: 'Raised before.' }],
  // Deliberately disagrees with comments.length (2): coverage.count is the
  // watermark taken by the query that built the payload, and a third comment
  // can land while the model is thinking — present in the live count but
  // never sent. Do not "fix" this back to 2; that would make the assertion
  // below pass even if composeVersionBrief re-derived the count from what it
  // sent instead of reading the snapshot.
  coverage: { count: 3, maxCreatedAt: '2026-08-23T10:00:00Z' },
};

const goodProvider = async () => ({
  ok: true,
  model: 'test-model',
  data: {
    headline: 'Converging',
    themes: [
      { title: 'Clearance', body: 'Still open.', commentIds: ['c1', 'c2'], firstSeenVersionId: 'v2' },
    ],
  },
});

test('a good response becomes a brief carrying the payload watermark', async () => {
  const out = await composeVersionBrief(LOAD, goodProvider);

  assert.equal(out.ok, true);
  assert.equal(out.brief.headline, 'Converging');
  assert.equal(out.brief.themes[0].firstSeenVersionId, 'v2');
  // The watermark must be the snapshot the payload was built from, not a
  // fresh count taken after the model finished.
  assert.equal(out.coveredCount, 3);
  assert.equal(out.coveredThrough, '2026-08-23T10:00:00Z');
  assert.equal(out.model, 'test-model');
});

test('a provider failure yields no brief and an explaining reason', async () => {
  const out = await composeVersionBrief(LOAD, async () => ({
    ok: false,
    reason: 'Could not reach the summarisation provider',
  }));

  assert.equal(out.ok, false);
  assert.match(out.reason, /Could not reach/);
});

test('a response citing only invented ids yields no brief', async () => {
  // Rather than persisting a headline with nothing under it.
  const out = await composeVersionBrief(LOAD, async () => ({
    ok: true,
    model: 'test-model',
    data: { headline: 'H', themes: [{ title: 't', body: 'b', commentIds: ['nope'] }] },
  }));

  assert.equal(out.ok, false);
  assert.match(out.reason, /citation/i);
});

test('malformed provider output is a failure, not an exception', async () => {
  const out = await composeVersionBrief(LOAD, async () => ({
    ok: true,
    model: 'test-model',
    data: 'not an object',
  }));

  assert.equal(out.ok, false);
});

test('real author names never reach the provider', async () => {
  let seen = '';
  await composeVersionBrief(LOAD, async (opts) => {
    seen = opts.system + opts.user;
    return goodProvider();
  });

  assert.doesNotMatch(seen, /Dana/);
  assert.doesNotMatch(seen, /Ravi/);
  assert.match(seen, /Reviewer A/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/aiSummarize.test.mjs`
Expected: FAIL — `Cannot find module '../../lib/ai/compose.ts'`

- [ ] **Step 3: Write the pure half**

Create `lib/ai/compose.ts`. Every import here is database-free, which is what lets the test above run.

**Note the explicit `.ts` extensions**, and that they are required only here. Every earlier `lib/ai` module imports its siblings with `import type`, which Node's type stripping erases before resolution ever happens. `compose.ts` is the first to need real *runtime* sibling imports, and Node's ESM resolver requires an explicit extension for a relative specifier — no flag waives it. The extensions are paired with `"allowImportingTsExtensions": true` in `tsconfig.json` (valid alongside the existing `"noEmit": true`), and `next build` reports `✓ Compiled successfully` with them, so webpack resolves them too.

```ts
import { complete } from './provider.ts';
import { validateVersionBrief } from './validate.ts';
import { buildVersionPrompt, capComments, labelAuthors } from './prompt.ts';
import type {
  Provider,
  VersionBrief,
  VersionFacts,
  RawComment,
  PriorTheme,
} from './types';

/**
 * Orchestration: load → prompt → provider → validate → upsert.
 *
 * `composeVersionBrief` is separated from the database so the interesting
 * behaviour — watermarking, validation, pseudonymisation — is testable without
 * Neon or a network.
 */

export interface VersionLoad {
  versionNumber: number;
  facts: VersionFacts;
  comments: RawComment[];
  priorThemes: PriorTheme[];
  coverage: { count: number; maxCreatedAt: string };
}

export type ComposeOutcome =
  | {
      ok: true;
      brief: VersionBrief;
      coveredCount: number;
      coveredThrough: string;
      model: string;
    }
  | { ok: false; reason: string };

export async function composeVersionBrief(
  load: VersionLoad,
  provider: Provider = complete
): Promise<ComposeOutcome> {
  const { kept, omittedCount } = capComments(load.comments, 150);
  const { labelled } = labelAuthors(kept);

  const { system, user } = buildVersionPrompt({
    versionNumber: load.versionNumber,
    comments: labelled,
    facts: load.facts,
    priorThemes: load.priorThemes,
    omittedCount,
  });

  const result = await provider({ system, user });
  if (!result.ok) return { ok: false, reason: result.reason };

  const sentIds = new Set(labelled.map((c) => c.id));
  const priorIds = new Set(load.priorThemes.map((t) => t.versionId));
  const { brief, droppedIds, droppedThemes } = validateVersionBrief(
    result.data,
    sentIds,
    priorIds
  );

  if (droppedIds > 0 || droppedThemes > 0) {
    // The signal that ATLAS_MODEL is the wrong choice. Watch this in logs.
    console.warn(
      `[ai] validation dropped ${droppedIds} citation(s) and ${droppedThemes} theme(s)`
    );
  }

  if (!brief) {
    return { ok: false, reason: 'No theme survived citation validation' };
  }

  return {
    ok: true,
    brief,
    coveredCount: load.coverage.count,
    coveredThrough: load.coverage.maxCreatedAt,
    model: result.model,
  };
}
```

- [ ] **Step 4: Write the database half**

Create `lib/ai/summarize.ts`. This is the module that touches Neon, so nothing in `scripts/tests/` may import it:

```ts
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { complete } from './provider';
import { composeVersionBrief } from './compose';
import { versionFacts, versionCoverage, versionComments, priorThemes } from './facts';
import type { Provider, VersionBrief } from './types';
// `export ... from` does not bind locally, so ComposeOutcome is imported too —
// summarizeVersion's return type needs it in scope.
import type { ComposeOutcome } from './compose';

/**
 * The database half of summarisation.
 *
 * `composeVersionBrief` is re-exported so production code has one import
 * surface — but tests must import it from './compose' directly, because this
 * module's `@/lib/db` import throws when DATABASE_URL is unset.
 */
export { composeVersionBrief } from './compose';
export type { VersionLoad, ComposeOutcome } from './compose';

export async function summarizeVersion(
  versionId: string,
  provider: Provider = complete
): Promise<ComposeOutcome> {
  const meta = await sql`
    SELECT version_number AS "versionNumber" FROM versions WHERE id = ${versionId}
  `;
  if (!meta[0]) return { ok: false, reason: 'Version not found' };

  // Coverage is read alongside the comments so the watermark describes the
  // same snapshot the prompt was built from.
  const [facts, coverage, comments, prior] = await Promise.all([
    versionFacts(versionId),
    versionCoverage(versionId),
    versionComments(versionId),
    priorThemes(versionId),
  ]);

  const outcome = await composeVersionBrief(
    {
      versionNumber: meta[0].versionNumber,
      facts,
      comments,
      priorThemes: prior,
      coverage,
    },
    provider
  );

  if (!outcome.ok) return outcome;

  // Last-most-complete-wins. Two concurrent refreshes both generate; the
  // staler result is discarded and neither request errors.
  await sql`
    INSERT INTO version_summaries
      (id, version_id, headline, themes, covered_count, covered_through, model)
    VALUES (
      ${uuidv4()}, ${versionId}, ${outcome.brief.headline},
      ${JSON.stringify(outcome.brief.themes)}::jsonb,
      ${outcome.coveredCount}, ${outcome.coveredThrough}, ${outcome.model}
    )
    ON CONFLICT (version_id) DO UPDATE SET
      headline = EXCLUDED.headline,
      themes = EXCLUDED.themes,
      covered_count = EXCLUDED.covered_count,
      covered_through = EXCLUDED.covered_through,
      model = EXCLUDED.model,
      generated_at = NOW()
    WHERE EXCLUDED.covered_count >= version_summaries.covered_count
  `;

  return outcome;
}

export async function readVersionBrief(versionId: string): Promise<{
  brief: VersionBrief | null;
  coveredCount: number | null;
  generatedAt: string | null;
}> {
  const rows = await sql`
    SELECT headline, themes, covered_count AS "coveredCount",
           generated_at AS "generatedAt"
    FROM version_summaries WHERE version_id = ${versionId}
  `;
  const row = rows[0];
  if (!row) return { brief: null, coveredCount: null, generatedAt: null };

  return {
    brief: { headline: row.headline, themes: row.themes ?? [] },
    coveredCount: row.coveredCount,
    generatedAt: row.generatedAt,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test scripts/tests/aiSummarize.test.mjs`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: all existing tests plus the four new files pass.

- [ ] **Step 7: Commit**

```bash
git add lib/ai/compose.ts lib/ai/summarize.ts scripts/tests/aiSummarize.test.mjs
git commit -m "feat(ai): add version brief composition and upsert"
```

---

## Task 8: Version summary route

**Files:**
- Create: `app/api/versions/[id]/summary/route.ts`

**Interfaces:**
- Consumes: `summarizeVersion`, `readVersionBrief` (Task 7); `versionFacts`, `versionCoverage`, `isStale` (Task 6); `isConfigured` (Task 5); `getPackageAccess` from `lib/access`
- Produces: `GET` returning `{ enabled, configured, facts, brief, generatedAt, newSinceBrief }`; `POST` returning the same shape on success, or `{ error }` with status 403 (summaries switched off) or 503 (generation failed)

- [ ] **Step 1: Write the route**

Create `app/api/versions/[id]/summary/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';
import { versionFacts, versionCoverage, isStale } from '@/lib/ai/facts';
import { summarizeVersion, readVersionBrief } from '@/lib/ai/summarize';
import { isConfigured } from '@/lib/ai/provider';

/**
 * The AI brief for one version.
 *
 * GET never calls the model — it returns the cached row plus the computed facts
 * and how many comments have landed since the brief was built. POST generates.
 *
 * Anyone who can read the brief may refresh it: the people best placed to
 * notice staleness are the ones reading it. Spend is bounded by the design
 * rather than by permissions — a POST on a fresh brief returns the cache
 * without calling the model.
 */

export const maxDuration = 30;

async function gate(versionId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const rows = await sql`
    SELECT v.portal_id AS "portalId",
           p.id AS "projectId",
           p.ai_summaries_enabled AS "enabled"
    FROM versions v
    JOIN portals po ON po.id = v.portal_id
    JOIN projects p ON p.id = po.project_id
    WHERE v.id = ${versionId}
  `;
  if (!rows[0]) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }

  // Keyed on a user id, so anonymous link viewers have no access here at all.
  const access = await getPackageAccess(session.user.id, rows[0].portalId);
  if (!access) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { enabled: Boolean(rows[0].enabled) };
}

async function payload(versionId: string, enabled: boolean) {
  const facts = await versionFacts(versionId);

  if (!enabled) {
    return {
      enabled: false,
      configured: isConfigured(),
      facts,
      brief: null,
      generatedAt: null,
      newSinceBrief: 0,
    };
  }

  const [{ brief, coveredCount, generatedAt }, coverage] = await Promise.all([
    readVersionBrief(versionId),
    versionCoverage(versionId),
  ]);

  return {
    enabled: true,
    configured: isConfigured(),
    facts,
    brief,
    generatedAt,
    newSinceBrief: isStale(coveredCount, coverage.count)
      ? coverage.count - (coveredCount ?? 0)
      : 0,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const gated = await gate(params.id);
  if (gated.error) return gated.error;

  return NextResponse.json(await payload(params.id, gated.enabled!));
}

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const gated = await gate(params.id);
  if (gated.error) return gated.error;

  if (!gated.enabled) {
    return NextResponse.json(
      { error: 'AI summaries are switched off for this project' },
      { status: 403 }
    );
  }

  // A refresh of an already-current brief must not spend anything.
  const [{ coveredCount }, coverage] = await Promise.all([
    readVersionBrief(params.id),
    versionCoverage(params.id),
  ]);
  if (coveredCount !== null && !isStale(coveredCount, coverage.count)) {
    return NextResponse.json(await payload(params.id, true));
  }

  const outcome = await summarizeVersion(params.id);
  if (!outcome.ok) {
    // 503, and the client keeps whatever brief it already had on screen.
    return NextResponse.json({ error: outcome.reason }, { status: 503 });
  }

  return NextResponse.json(await payload(params.id, true));
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors in `app/api/versions/[id]/summary/route.ts`.

- [ ] **Step 3: Verify the gate runs before any work, by reading the code**

No database exists here, so the 401/403 paths cannot be exercised. Check the property that matters statically instead: **every exported handler calls `gate()` and returns on `gated.error` before touching `sql` or the provider.** A route that queries first and authorises second leaks data even when the status code is eventually right.

Run: `grep -n "export async function\|await gate\|gated.error\|versionFacts\|summarizeVersion" "app/api/versions/[id]/summary/route.ts"`

Expected: for both `GET` and `POST`, the `await gate` and `if (gated.error)` lines appear before any `versionFacts`/`summarizeVersion` line.

- [ ] **Step 4: Run the full gate set**

Run: `npm test && npx tsc --noEmit && npx next lint`
Expected: all pass.

Then run `npm run build` and check for `✓ Compiled successfully`. It will then fail at "Collecting page data" with `DATABASE_URL environment variable is not set` — that failure is pre-existing (it happens on the baseline commit too) and is **not** a result of this task. Compilation success is the gate.
Expected: tests pass, no type errors, no new lint errors, build succeeds.

The build is the meaningful check for a route file — it compiles every handler and would catch a bad `params` signature or a bad import that `tsc` alone can miss in App Router files.

- [ ] **Step 5: Commit**

```bash
git add "app/api/versions/[id]/summary/route.ts"
git commit -m "feat(ai): add version summary route"
```

---

## Task 9: The brief panel

**Files:**
- Create: `components/portal/VersionBrief.tsx`
- Modify: `components/portal/CommentsPanel.tsx` (render `<VersionBrief>` above the comment list)

**Interfaces:**
- Consumes: `GET`/`POST /api/versions/[id]/summary` (Task 8)
- Produces: `<VersionBrief versionId onSelectComment />`

- [ ] **Step 1: Write the component**

Create `components/portal/VersionBrief.tsx`:

```tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The AI brief above the comment list.
 *
 * Four states, deliberately distinct: not configured (an honest line instead
 * of a brief), configured with no brief yet (offer to summarise), brief
 * current, and brief present-but-stale (show it, say how far behind it is).
 * The fact strip renders in all four.
 */

interface Theme {
  title: string;
  body: string;
  commentIds: string[];
  firstSeenVersionId: string | null;
}

interface Summary {
  enabled: boolean;
  configured: boolean;
  facts: {
    commentCount: number;
    openThreadCount: number;
    approvedCount: number;
    changesRequestedCount: number;
    participantCount: number;
    mostAnnotatedFile: string | null;
  };
  brief: { headline: string; themes: Theme[] } | null;
  generatedAt: string | null;
  newSinceBrief: number;
}

const AUTO_GENERATE_THRESHOLD = 3;

export default function VersionBrief({
  versionId,
  onSelectComment,
}: {
  versionId: string;
  onSelectComment: (commentId: string) => void;
}) {
  const [data, setData] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // generate() leaves data.brief null on failure, so without this the effect
  // re-fires on every busy transition and loops against a paid API. Records
  // the versionId an auto-attempt has already been made for, capping it to
  // one automatic attempt per version per mount.
  const autoAttempted = useRef<string | null>(null);
  // Which version the `data` in state was loaded for. setData is queued, so on a
  // versionId change the auto-generate effect would otherwise still see the
  // PREVIOUS version's data while already bound to the new versionId — and fire
  // a POST for the new version on the strength of the old one's facts.
  const loadedFor = useRef<string | null>(null);
  // Always the version currently on screen. Both load() and generate() capture
  // the version they were started for and compare against this after awaiting —
  // a response that arrives after the user has moved on must be discarded, not
  // applied. Without it a slow generate() for one version lands its brief, and
  // its citation ids, into a different version's panel.
  const currentVersion = useRef(versionId);
  currentVersion.current = versionId;

  const load = useCallback(async () => {
    const target = versionId;
    const res = await fetch(`/api/versions/${target}/summary`);
    if (target !== currentVersion.current) return;
    if (!res.ok) return;
    const body = await res.json();
    if (target !== currentVersion.current) return;
    loadedFor.current = target;
    setData(body);
  }, [versionId]);

  const generate = useCallback(async () => {
    const target = versionId;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/versions/${target}/summary`, { method: 'POST' });
      if (target !== currentVersion.current) return;
      const body = await res.json();
      if (target !== currentVersion.current) return;
      // On failure the existing brief stays on screen; only the notice changes.
      if (!res.ok) {
        setError(body.error ?? 'Could not refresh the summary');
      } else {
        loadedFor.current = target;
        setData(body);
      }
    } catch {
      if (target !== currentVersion.current) return;
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }, [versionId]);

  useEffect(() => {
    setData(null);
    setError(null);
    setBusy(false);
    autoAttempted.current = null;
    loadedFor.current = null;
    load();
  }, [load]);

  useEffect(() => {
    if (loadedFor.current !== versionId) return;
    if (
      data?.enabled &&
      data.configured &&
      !data.brief &&
      data.facts.commentCount >= AUTO_GENERATE_THRESHOLD &&
      !busy
    ) {
      if (autoAttempted.current === versionId) return;
      autoAttempted.current = versionId;
      generate();
    }
  }, [data, busy, generate, versionId]);

  if (!data || !data.enabled) return null;

  const f = data.facts;

  return (
    <section className="border-b border-gray-200 bg-gray-50/60 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Summary
        </h3>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="text-xs text-gray-500 hover:text-gray-900"
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>

      {!collapsed && (
        <>
          {data.brief ? (
            <>
              <p className="mt-2 text-sm font-medium text-gray-900">
                {data.brief.headline}
              </p>
              <ul className="mt-2 space-y-2">
                {data.brief.themes.map((theme, i) => (
                  <li key={i} className="text-sm text-gray-700">
                    <span className="font-medium text-gray-900">{theme.title}</span>
                    {theme.firstSeenVersionId && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        Raised earlier, still open
                      </span>
                    )}
                    <span className="block">{theme.body}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {theme.commentIds.map((id) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => onSelectComment(id)}
                          className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-600 hover:border-gray-500"
                        >
                          pin
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-500">
              {data.configured
                ? 'No summary yet.'
                : 'Summarising is not configured for this deployment.'}
              {data.configured && !data.brief && f.commentCount > 0 && (
                <button
                  type="button"
                  onClick={generate}
                  disabled={busy}
                  className="ml-2 font-medium text-gray-900 underline disabled:opacity-50"
                >
                  {busy ? 'Summarising…' : 'Summarise'}
                </button>
              )}
            </p>
          )}

          {data.newSinceBrief > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              {data.newSinceBrief} new comment{data.newSinceBrief === 1 ? '' : 's'} since
              this summary.{' '}
              <button
                type="button"
                onClick={generate}
                disabled={busy}
                className="font-medium text-gray-900 underline disabled:opacity-50"
              >
                {busy ? 'Refreshing…' : 'Refresh'}
              </button>
            </p>
          )}

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

          <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>{f.openThreadCount} unanswered</span>
            <span>{f.commentCount} comments</span>
            <span>{f.participantCount} people</span>
            {f.changesRequestedCount > 0 && (
              <span>{f.changesRequestedCount} requested changes</span>
            )}
            {f.approvedCount > 0 && <span>{f.approvedCount} approved</span>}
            {f.mostAnnotatedFile && <span>most pins on {f.mostAnnotatedFile}</span>}
          </dl>
        </>
      )}
    </section>
  );
}
```

The `autoAttempted` ref caps auto-generation to one attempt per version per mount: `generate()` leaves `data.brief` null on failure, so `busy` cycling back to `false` alone would satisfy the effect's condition again and re-POST forever against a paid inference API on every provider outage — the ref, set before `generate()` runs and compared against the current `versionId`, breaks that loop while still letting the manual "Summarise" button (rendered whenever `configured && !brief && commentCount > 0`) retry on demand.

The `loadedFor` ref exists because `setData(null)` in the versionId-reset effect only *queues* a state update — it has not applied within that same commit. Both effects run in the same commit when `versionId` changes: the reset effect clears `autoAttempted.current` synchronously and calls `load()`, but the auto-generate effect, gated on `autoAttempted.current !== versionId`, still sees the *previous* version's `data` in that commit (since `data` hasn't actually become `null` yet) while `versionId` and the `generate` closure are already bound to the *new* version — and the guard that would normally stop it was just cleared. Without `loadedFor`, this fires an automatic POST against the new version, justified by facts belonging to the version just left. `loadedFor.current` is set to `versionId` only inside `load()`, immediately before `setData(body)`, so it is only ever set for a version whose response has actually arrived; the auto-generate effect returns immediately, before evaluating any other condition, whenever `loadedFor.current !== versionId` — i.e. whenever the `data` currently in state cannot yet be trusted to belong to the version the effect is now bound to.

`currentVersion` exists because `loadedFor` and `autoAttempted` only guard which version's `data` the auto-generate *effect* trusts — neither one protects `load()` or `generate()` themselves from applying a response that outlives the version it was requested for. Both functions `await` a network round trip; `versionId` can change (and the reset effect can fire) while that `await` is pending. `generate()` in particular is LLM-backed and can take seconds, long enough for the user to navigate to a different version, whose own `load()` completes first and legitimately sets `loadedFor.current` and `data` for the new version — after which the stale POST resolves and, without a guard, would overwrite them with the old version's brief (and citation `commentIds` that point at comments the new panel never mentions). `currentVersion` is a ref, not a second piece of state, so it updates synchronously in the render body (`currentVersion.current = versionId`) on every render — including the render that changes `versionId` — rather than waiting for an effect to commit; by the time any pending `await` inside `load()` or `generate()` resumes, it is guaranteed to already reflect whichever version is on screen. Each function captures `const target = versionId` as its first statement and, after every `await`, checks `target !== currentVersion.current` and returns before touching any state — `setData`, `setError`, or the `loadedFor.current` write all wait behind that check. `setBusy(false)` is the one exception: it stays unconditional in `generate()`'s `finally`, and the reset effect also sets `busy` back to `false` on a version change, so a discarded in-flight call can never leave `busy` stuck `true` on a version that never asked for it.

- [ ] **Step 2: Render it inside the comments panel**

In `components/portal/CommentsPanel.tsx`, add the import at the top:

```tsx
import VersionBrief from '@/components/portal/VersionBrief';
```

Add a `versionId: string | null` prop to the component's props interface, thread it through from `app/portal/[id]/page.tsx` (the page already tracks the selected version), and render it as the first child of the panel's scrolling container, above the comment list:

```tsx
{versionId && (
  <VersionBrief
    versionId={versionId}
    onSelectComment={(id) => {
      document.getElementById(`comment-${id}`)?.scrollIntoView({ behavior: 'smooth' });
    }}
  />
)}
```

If comment list items do not already carry `id={`comment-${comment.id}`}`, add it to the list item wrapper so the citation chips have a scroll target.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the gate set**

No database exists here, so the panel cannot be driven in a browser.

Run: `npm test && npx tsc --noEmit && npx next lint`
Expected: all pass.

Then run `npm run build` and check for `✓ Compiled successfully`. It will then fail at "Collecting page data" with `DATABASE_URL environment variable is not set` — that failure is pre-existing (it happens on the baseline commit too) and is **not** a result of this task. Compilation success is the gate.
Expected: all pass.

Then confirm by reading `VersionBrief.tsx` that the three states are each reachable and distinct: `!data.brief && data.configured` renders "No summary yet", `!data.configured` renders the not-configured line, and `newSinceBrief > 0` renders the Refresh affordance. A single collapsed branch here would ship a panel that silently never offers to generate.

- [ ] **Step 5: Commit**

```bash
git add components/portal/VersionBrief.tsx components/portal/CommentsPanel.tsx "app/portal/[id]/page.tsx"
git commit -m "feat(ai): show the version brief above the comment list"
```

---

## Task 10: Headline in the version list

**Files:**
- Modify: `components/portal/FileTreeSidebar.tsx`
- Delete: `components/portal/VersionTimeline.tsx`

**Interfaces:**
- Consumes: the `headline` field from the version summary payload
- Produces: nothing new

- [ ] **Step 1: Delete the dead component**

`components/portal/VersionTimeline.tsx` is defined, exported and imported nowhere — the version list lives in `FileTreeSidebar`. It is removed here because it is exactly where someone would add a per-version headline, where it would render nothing.

```bash
git rm components/portal/VersionTimeline.tsx
```

- [ ] **Step 2: Confirm nothing referenced it**

Run: `grep -rn "VersionTimeline" --include="*.tsx" --include="*.ts" . | grep -v node_modules`
Expected: no output.

- [ ] **Step 3: Add headlines to the sidebar**

In `app/portal/[id]/page.tsx`, fetch headlines once per portal alongside the existing version fetch and pass them down:

```tsx
const [headlines, setHeadlines] = useState<Record<string, string>>({});

useEffect(() => {
  let cancelled = false;
  (async () => {
    const entries = await Promise.all(
      versions.map(async (v) => {
        const res = await fetch(`/api/versions/${v.id}/summary`);
        if (!res.ok) return [v.id, ''] as const;
        const body = await res.json();
        return [v.id, body.brief?.headline ?? ''] as const;
      })
    );
    if (!cancelled) setHeadlines(Object.fromEntries(entries.filter(([, h]) => h)));
  })();
  return () => {
    cancelled = true;
  };
}, [versions]);
```

Pass `headlines` into `FileTreeSidebar`, add `headlines?: Record<string, string>` to its props, and render under each version bar's label:

```tsx
{headlines?.[version.id] && (
  <span className="mt-0.5 block truncate text-xs font-normal text-gray-500">
    {headlines[version.id]}
  </span>
)}
```

- [ ] **Step 4: Run the gate set**

Run: `npm test && npx tsc --noEmit && npx next lint`
Expected: all pass.

Then run `npm run build` and check for `✓ Compiled successfully`. It will then fail at "Collecting page data" with `DATABASE_URL environment variable is not set` — that failure is pre-existing (it happens on the baseline commit too) and is **not** a result of this task. Compilation success is the gate.
Expected: all pass. The `grep` in Step 2 is what proves the deletion was safe; the build is what proves nothing else imported it.

- [ ] **Step 5: Commit**

```bash
git add components/portal/FileTreeSidebar.tsx "app/portal/[id]/page.tsx"
git commit -m "feat(ai): show version headlines in the sidebar, drop dead VersionTimeline"
```

---

## Task 11: Project roll-up

**Files:**
- Modify: `lib/ai/compose.ts` (add `composeProjectBrief` — the pure, testable half)
- Modify: `lib/ai/summarize.ts` (add `summarizeProject` and `readProjectBrief` — the database half)
- Create: `app/api/projects/[id]/summary/route.ts`
- Test: `scripts/tests/aiProjectSummarize.test.mjs`

The same split as Task 7, for the same reason: the test imports `composeProjectBrief`, so that function must live in the module that never reaches `@/lib/db`.

**Interfaces:**
- Consumes: `buildProjectPrompt` (Task 4), `validateProjectBrief` (Task 3)
- Produces: `composeProjectBrief(load, provider)`, `summarizeProject(projectId, provider?)`, `readProjectBrief(projectId)`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/aiProjectSummarize.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeProjectBrief } from '../../lib/ai/compose.ts';

const LOAD = {
  projectName: 'Riverside Depot',
  packages: [
    {
      portalId: 'p1',
      name: 'Facade',
      versions: [{ versionId: 'v3', versionNumber: 3, headline: 'Approved at v3.' }],
    },
    {
      portalId: 'p2',
      name: 'Structural',
      versions: [{ versionId: 'v9', versionNumber: 2, headline: 'Four threads open.' }],
    },
  ],
  coveredThrough: '2026-08-23T12:00:00Z',
};

test('a good response becomes a project brief', async () => {
  const out = await composeProjectBrief(LOAD, async () => ({
    ok: true,
    model: 'test-model',
    data: {
      headline: 'Facade is done, Structural is stuck.',
      sections: [
        { portalId: 'p1', body: 'Approved at v3.', versionIds: ['v3'] },
        { portalId: 'p2', body: 'Four threads open since 8 Aug.', versionIds: ['v9'] },
      ],
    },
  }));

  assert.equal(out.ok, true);
  assert.equal(out.brief.sections.length, 2);
  assert.equal(out.coveredThrough, '2026-08-23T12:00:00Z');
});

test('a section naming a package outside this project is dropped', async () => {
  // The same guard as comment ids, one tier up: a citation must resolve.
  const out = await composeProjectBrief(LOAD, async () => ({
    ok: true,
    model: 'test-model',
    data: {
      headline: 'H',
      sections: [
        { portalId: 'p1', body: 'Fine.', versionIds: ['v3'] },
        { portalId: 'p-elsewhere', body: 'Invented.', versionIds: [] },
      ],
    },
  }));

  assert.equal(out.brief.sections.length, 1);
  assert.equal(out.brief.sections[0].portalId, 'p1');
});

test('a provider failure yields no brief', async () => {
  const out = await composeProjectBrief(LOAD, async () => ({
    ok: false,
    reason: 'Could not reach the summarisation provider',
  }));

  assert.equal(out.ok, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/aiProjectSummarize.test.mjs`
Expected: FAIL — `composeProjectBrief is not a function`

- [ ] **Step 3: Add the pure half to `lib/ai/compose.ts`**

Append to `lib/ai/compose.ts`, extending its existing imports with `buildProjectPrompt` from `./prompt`, `validateProjectBrief` from `./validate`, and `ProjectBrief` from `./types`:

```ts
export interface ProjectLoad {
  projectName: string;
  packages: Array<{
    portalId: string;
    name: string;
    versions: Array<{ versionId: string; versionNumber: number; headline: string }>;
  }>;
  coveredThrough: string;
}

export type ProjectComposeOutcome =
  | { ok: true; brief: ProjectBrief; coveredThrough: string; model: string }
  | { ok: false; reason: string };

export async function composeProjectBrief(
  load: ProjectLoad,
  provider: Provider = complete
): Promise<ProjectComposeOutcome> {
  const { system, user } = buildProjectPrompt({
    projectName: load.projectName,
    packages: load.packages,
  });

  const result = await provider({ system, user });
  if (!result.ok) return { ok: false, reason: result.reason };

  const portalIds = new Set(load.packages.map((p) => p.portalId));
  const versionIds = new Set(
    load.packages.flatMap((p) => p.versions.map((v) => v.versionId))
  );

  const { brief, droppedSections } = validateProjectBrief(
    result.data,
    portalIds,
    versionIds
  );

  if (droppedSections > 0) {
    console.warn(`[ai] project validation dropped ${droppedSections} section(s)`);
  }
  if (!brief) return { ok: false, reason: 'No section survived citation validation' };

  return { ok: true, brief, coveredThrough: load.coveredThrough, model: result.model };
}
```

- [ ] **Step 4: Add the database half to `lib/ai/summarize.ts`**

Append to `lib/ai/summarize.ts`, extending its imports with `composeProjectBrief` from `./compose`, the `ProjectComposeOutcome` type from `./compose`, and `ProjectBrief` from `./types`. Also add `composeProjectBrief` and the two project types to the existing re-export block, so production code keeps one import surface:

```ts
export { composeProjectBrief } from './compose';
export type { ProjectLoad, ProjectComposeOutcome } from './compose';

export async function summarizeProject(
  projectId: string,
  provider: Provider = complete
): Promise<ProjectComposeOutcome> {
  const rows = await sql`
    SELECT p.name AS "projectName",
           po.id AS "portalId", po.name AS "packageName",
           v.id AS "versionId", v.version_number AS "versionNumber",
           vs.headline, vs.generated_at AS "generatedAt"
    FROM projects p
    JOIN portals po ON po.project_id = p.id AND po.archived_at IS NULL
    JOIN versions v ON v.portal_id = po.id
    JOIN version_summaries vs ON vs.version_id = v.id
    WHERE p.id = ${projectId}
    ORDER BY po.name ASC, v.version_number ASC
  `;

  if (rows.length === 0) {
    return { ok: false, reason: 'No package summaries to roll up yet' };
  }

  const byPortal = new Map<
    string,
    { portalId: string; name: string; versions: ProjectLoad['packages'][number]['versions'] }
  >();
  let coveredThrough = rows[0].generatedAt as string;

  for (const row of rows) {
    if (row.generatedAt > coveredThrough) coveredThrough = row.generatedAt;
    const existing = byPortal.get(row.portalId) ?? {
      portalId: row.portalId,
      name: row.packageName,
      versions: [],
    };
    existing.versions.push({
      versionId: row.versionId,
      versionNumber: row.versionNumber,
      headline: row.headline,
    });
    byPortal.set(row.portalId, existing);
  }

  const outcome = await composeProjectBrief(
    {
      projectName: rows[0].projectName,
      // Array.from, not [...map.values()] — tsconfig.json sets no "target",
      // so it defaults to ES5 and spreading an iterator is a TS2802.
      packages: Array.from(byPortal.values()),
      coveredThrough,
    },
    provider
  );

  if (!outcome.ok) return outcome;

  await sql`
    INSERT INTO project_summaries
      (id, project_id, headline, sections, covered_through, model)
    VALUES (
      ${uuidv4()}, ${projectId}, ${outcome.brief.headline},
      ${JSON.stringify(outcome.brief.sections)}::jsonb,
      ${outcome.coveredThrough}, ${outcome.model}
    )
    ON CONFLICT (project_id) DO UPDATE SET
      headline = EXCLUDED.headline,
      sections = EXCLUDED.sections,
      covered_through = EXCLUDED.covered_through,
      model = EXCLUDED.model,
      generated_at = NOW()
  `;

  return outcome;
}

export async function readProjectBrief(projectId: string): Promise<{
  brief: ProjectBrief | null;
  coveredThrough: string | null;
  generatedAt: string | null;
  stale: boolean;
}> {
  const rows = await sql`
    SELECT ps.headline, ps.sections,
           ps.covered_through AS "coveredThrough",
           ps.generated_at AS "generatedAt",
           (SELECT MAX(vs.generated_at)
              FROM version_summaries vs
              JOIN versions v ON v.id = vs.version_id
              JOIN portals po ON po.id = v.portal_id
             WHERE po.project_id = ${projectId}) AS "newestVersionBrief"
    FROM project_summaries ps
    WHERE ps.project_id = ${projectId}
  `;
  const row = rows[0];
  if (!row) {
    return { brief: null, coveredThrough: null, generatedAt: null, stale: false };
  }

  return {
    brief: { headline: row.headline, sections: row.sections ?? [] },
    coveredThrough: row.coveredThrough,
    generatedAt: row.generatedAt,
    // Stale when any constituent version brief is newer than what this consumed.
    stale: Boolean(
      row.newestVersionBrief && row.newestVersionBrief > row.coveredThrough
    ),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test scripts/tests/aiProjectSummarize.test.mjs`
Expected: PASS — 3 tests, 0 failures.

- [ ] **Step 6: Write the route**

Create `app/api/projects/[id]/summary/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { isProjectMember } from '@/lib/access';
import { summarizeProject, readProjectBrief } from '@/lib/ai/summarize';
import { isConfigured } from '@/lib/ai/provider';

/** Project roll-up. Members only — a package guest cannot see the project. */

export const maxDuration = 30;

async function gate(projectId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!(await isProjectMember(session.user.id, projectId))) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }

  const rows = await sql`
    SELECT ai_summaries_enabled AS "enabled" FROM projects WHERE id = ${projectId}
  `;
  return { enabled: Boolean(rows[0]?.enabled) };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const gated = await gate(params.id);
  if (gated.error) return gated.error;

  if (!gated.enabled) {
    return NextResponse.json({ enabled: false, configured: isConfigured(), brief: null });
  }

  const read = await readProjectBrief(params.id);
  return NextResponse.json({ enabled: true, configured: isConfigured(), ...read });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const gated = await gate(params.id);
  if (gated.error) return gated.error;
  if (!gated.enabled) {
    return NextResponse.json(
      { error: 'AI summaries are switched off for this project' },
      { status: 403 }
    );
  }

  const outcome = await summarizeProject(params.id);
  if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: 503 });

  const read = await readProjectBrief(params.id);
  return NextResponse.json({ enabled: true, configured: isConfigured(), ...read });
}
```

- [ ] **Step 7: Verify and commit**

Run: `npx tsc --noEmit` — expected: no errors.
Run: `npm test` — expected: all pass.

```bash
git add lib/ai/compose.ts lib/ai/summarize.ts scripts/tests/aiProjectSummarize.test.mjs "app/api/projects/[id]/summary/route.ts"
git commit -m "feat(ai): add project roll-up summarisation and route"
```

---

## Task 12: Project brief on the project page

**Files:**
- Create: `components/project/ProjectBrief.tsx`
- Modify: `app/project/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET`/`POST /api/projects/[id]/summary` (Task 11)
- Produces: `<ProjectBrief projectId packageNames />`

- [ ] **Step 1: Write the component**

Create `components/project/ProjectBrief.tsx`:

```tsx
'use client';

import React, { useCallback, useEffect, useState } from 'react';

/**
 * The project roll-up above the package list. Sections cite down to the
 * version brief that made each claim, so a reader can always get to the
 * evidence in one click.
 */

interface Section {
  portalId: string;
  body: string;
  versionIds: string[];
}

interface ProjectSummary {
  enabled: boolean;
  configured: boolean;
  brief: { headline: string; sections: Section[] } | null;
  stale?: boolean;
}

export default function ProjectBrief({
  projectId,
  packageNames,
}: {
  projectId: string;
  packageNames: Record<string, string>;
}) {
  const [data, setData] = useState<ProjectSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/summary`);
    if (res.ok) setData(await res.json());
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/summary`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? 'Could not refresh the summary');
      else setData(body);
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  if (!data?.enabled) return null;

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Where this project stands
        </h2>
        <button
          type="button"
          onClick={generate}
          disabled={busy || !data.configured}
          className="text-xs font-medium text-gray-900 underline disabled:opacity-40"
        >
          {busy ? 'Updating…' : data.brief ? 'Refresh' : 'Summarise'}
        </button>
      </div>

      {data.brief ? (
        <>
          <p className="mt-2 text-sm font-medium text-gray-900">{data.brief.headline}</p>
          <ul className="mt-3 space-y-2">
            {data.brief.sections.map((section) => (
              <li key={section.portalId} className="text-sm text-gray-700">
                <span className="font-medium text-gray-900">
                  {packageNames[section.portalId] ?? 'Package'}
                </span>{' '}
                — {section.body}
              </li>
            ))}
          </ul>
          {data.stale && (
            <p className="mt-2 text-xs text-gray-500">
              Package summaries have changed since this was written.
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-gray-500">
          {data.configured
            ? 'No summary yet — package summaries are rolled up here once versions have been reviewed.'
            : 'Summarising is not configured for this deployment.'}
        </p>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}
```

- [ ] **Step 2: Render it on the project page**

In `app/project/[id]/page.tsx`, import the component and render it above the package rows, building `packageNames` from the packages the page already loads:

```tsx
import ProjectBrief from '@/components/project/ProjectBrief';

// inside the render, above the package list:
<ProjectBrief
  projectId={projectId}
  packageNames={Object.fromEntries(packages.map((p) => [p.id, p.name]))}
/>
```

- [ ] **Step 3: Run the gate set**

Run: `npm test && npx tsc --noEmit && npx next lint`
Expected: all pass.

Then run `npm run build` and check for `✓ Compiled successfully`. It will then fail at "Collecting page data" with `DATABASE_URL environment variable is not set` — that failure is pre-existing (it happens on the baseline commit too) and is **not** a result of this task. Compilation success is the gate.
Expected: all pass. No database exists here, so the rendered states cannot be driven in a browser.

- [ ] **Step 4: Commit**

```bash
git add components/project/ProjectBrief.tsx "app/project/[id]/page.tsx"
git commit -m "feat(ai): show the project roll-up on the project page"
```

---

## Task 13: Changelog draft

**Files:**
- Create: `app/api/versions/[id]/changelog-draft/route.ts`
- Modify: `components/portal/NewVersionDrawer.tsx`

**Interfaces:**
- Consumes: `buildChangelogPrompt` (Task 4), `readVersionBrief` (Task 7), `complete` (Task 5)
- Produces: `POST /api/versions/[id]/changelog-draft` returning `{ changelog }`

- [ ] **Step 1: Write the route**

Create `app/api/versions/[id]/changelog-draft/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';
import { buildChangelogPrompt } from '@/lib/ai/prompt';
import { readVersionBrief } from '@/lib/ai/summarize';
import { complete } from '@/lib/ai/provider';

/**
 * Suggested changelog text for a new version, from the previous version's open
 * themes. Returns text and writes nothing — the uploader edits it before it is
 * ever persisted, so this route has no side effects at all.
 */

export const maxDuration = 30;

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await sql`
    SELECT v.portal_id AS "portalId",
           v.version_number AS "versionNumber",
           p.ai_summaries_enabled AS "enabled"
    FROM versions v
    JOIN portals po ON po.id = v.portal_id
    JOIN projects p ON p.id = po.project_id
    WHERE v.id = ${params.id}
  `;
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const access = await getPackageAccess(session.user.id, rows[0].portalId);
  if (!access?.canUpload) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!rows[0].enabled) {
    return NextResponse.json({ error: 'AI summaries are switched off' }, { status: 403 });
  }

  const { brief } = await readVersionBrief(params.id);
  if (!brief || brief.themes.length === 0) {
    return NextResponse.json(
      { error: 'The previous version has no summary to draw from' },
      { status: 409 }
    );
  }

  const { system, user } = buildChangelogPrompt({
    previousVersionNumber: rows[0].versionNumber,
    openThemes: brief.themes.map((t) => ({ title: t.title, body: t.body })),
  });

  const result = await complete({ system, user });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 503 });

  const data = result.data as { changelog?: unknown };
  const text = typeof data?.changelog === 'string' ? data.changelog.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'No draft was produced' }, { status: 503 });
  }

  return NextResponse.json({ changelog: text });
}
```

- [ ] **Step 2: Add the Suggest control to the drawer**

In `components/portal/NewVersionDrawer.tsx`, add a `latestVersionId: string | null` prop (passed from `app/portal/[id]/page.tsx`), add state and a handler:

```tsx
const [drafting, setDrafting] = useState(false);
const [draftError, setDraftError] = useState<string | null>(null);

async function suggestChangelog() {
  if (!latestVersionId) return;
  setDrafting(true);
  setDraftError(null);
  try {
    const res = await fetch(`/api/versions/${latestVersionId}/changelog-draft`, {
      method: 'POST',
    });
    const body = await res.json();
    if (!res.ok) setDraftError(body.error ?? 'Could not draft a changelog');
    else setChangelog(body.changelog);
  } finally {
    setDrafting(false);
  }
}
```

Render the control immediately above the existing changelog textarea (around line 203):

```tsx
{latestVersionId && (
  <div className="mb-1 flex items-center justify-end gap-2">
    {draftError && <span className="text-xs text-red-600">{draftError}</span>}
    <button
      type="button"
      onClick={suggestChangelog}
      disabled={drafting}
      className="text-xs font-medium text-gray-600 underline hover:text-gray-900 disabled:opacity-50"
    >
      {drafting ? 'Drafting…' : 'Suggest from open comments'}
    </button>
  </div>
)}
```

- [ ] **Step 3: Run the gate set, and confirm the route writes nothing**

Run: `npm test && npx tsc --noEmit && npx next lint`
Expected: all pass.

Then run `npm run build` and check for `✓ Compiled successfully`. It will then fail at "Collecting page data" with `DATABASE_URL environment variable is not set` — that failure is pre-existing (it happens on the baseline commit too) and is **not** a result of this task. Compilation success is the gate.
Expected: all pass.

Then confirm the no-side-effects claim statically — this route is documented as read-only, and a stray write would persist text the uploader never approved:

Run: `grep -nE "INSERT|UPDATE|DELETE" "app/api/versions/[id]/changelog-draft/route.ts"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add "app/api/versions/[id]/changelog-draft/route.ts" components/portal/NewVersionDrawer.tsx "app/portal/[id]/page.tsx"
git commit -m "feat(ai): add changelog draft suggestion to the new-version drawer"
```

---

## Task 14: Per-project opt-out

**Files:**
- Modify: `app/api/projects/[id]/route.ts` (add `PATCH`)
- Modify: `app/project/[id]/page.tsx` (add the toggle)

**Interfaces:**
- Consumes: `isProjectMember` from `lib/access`
- Produces: `PATCH /api/projects/[id]` accepting `{ aiSummariesEnabled: boolean }`

- [ ] **Step 1: Add the PATCH handler**

Append to `app/api/projects/[id]/route.ts`:

```ts
/**
 * Switch AI summaries on or off for this project.
 *
 * Switching off DELETES the stored summaries rather than hiding them. If an
 * owner turns this off for a client, the honest reading is that the summaries
 * go away — not that they sit in the database awaiting a re-enable.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const owns = await sql`
    SELECT 1 FROM projects WHERE id = ${params.id} AND owner_id = ${session.user.id}
  `;
  if (owns.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  if (typeof body.aiSummariesEnabled !== 'boolean') {
    return NextResponse.json({ error: 'aiSummariesEnabled required' }, { status: 400 });
  }

  await sql`
    UPDATE projects SET ai_summaries_enabled = ${body.aiSummariesEnabled}
    WHERE id = ${params.id}
  `;

  if (!body.aiSummariesEnabled) {
    await sql`DELETE FROM project_summaries WHERE project_id = ${params.id}`;
    await sql`
      DELETE FROM version_summaries
      WHERE version_id IN (
        SELECT v.id FROM versions v
        JOIN portals po ON po.id = v.portal_id
        WHERE po.project_id = ${params.id}
      )
    `;
  }

  return NextResponse.json({ aiSummariesEnabled: body.aiSummariesEnabled });
}
```

Ensure `NextRequest` is imported in that file's import list.

- [ ] **Step 2: Add the toggle to the project page**

In `app/project/[id]/page.tsx`, render near the project header, visible only to the owner:

```tsx
<label className="flex items-center gap-2 text-xs text-gray-500">
  <input
    type="checkbox"
    checked={aiEnabled}
    onChange={async (e) => {
      const next = e.target.checked;
      setAiEnabled(next);
      await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiSummariesEnabled: next }),
      });
    }}
  />
  AI summaries — comment text is sent to Atlas Cloud to generate them. Turning
  this off deletes the summaries already generated for this project.
</label>
```

Extend the project `GET` response in `app/api/projects/[id]/route.ts` to include `ai_summaries_enabled AS "aiSummariesEnabled"` so the page can initialise `aiEnabled`.

- [ ] **Step 3: Verify the delete-on-off behaviour by reading the code**

`psql` is not installed and no database exists, so this cannot be exercised. Check the two properties statically instead:

Run: `grep -n "DELETE FROM\|aiSummariesEnabled" "app/api/projects/[id]/route.ts"`

Expected:
1. Both `DELETE FROM project_summaries` and `DELETE FROM version_summaries` appear, and both sit inside the `if (!body.aiSummariesEnabled)` branch — deleting on enable would wipe briefs every time someone switched the feature back on.
2. The `version_summaries` delete is scoped by a subquery joining `versions → portals` on **this** `project_id`. An unscoped delete would destroy every project's briefs.

- [ ] **Step 4: Run the whole suite and commit**

Run: `npm test` — expected: all pass.
Run: `npx tsc --noEmit` — expected: no errors.

```bash
git add "app/api/projects/[id]/route.ts" "app/project/[id]/page.tsx"
git commit -m "feat(ai): add per-project AI summaries opt-out"
```

---

## Self-review notes

**Spec coverage.** Every locked decision maps to a task: #1 one neutral brief (Task 7 prompt), #2 cached stale-aware (Tasks 1, 6, 8), #3 headline + themes (Tasks 3, 9), #4 two-tier roll-up (Task 11), #5 signed-in participants (Task 8 gate), #6 text-only pseudonymised (Task 4), #7 per-project opt-out (Task 14), #8 unaddressed-feedback (Tasks 3, 4, 6 `priorThemes`) and changelog (Task 13), #10 one seam (Task 5), #11 model (Task 5). The fact strip's five facts are all in `versionFacts` (Task 6). Deleting `VersionTimeline.tsx` is Task 10.

**Naming consistency.** `composeVersionBrief`/`summarizeVersion`/`readVersionBrief` and their project equivalents are used identically in Tasks 7, 8, 11, 12, 13. `isStale(coveredCount, liveCount)` has the same argument order in Tasks 6 and 8. `PayloadComment.author` is the pseudonym everywhere; `RawComment.author` is the real name and never leaves `prompt.ts`.

**Known gap, carried from the spec.** Comment *bodies* are not scrubbed — people sign their names inside comment text. Pseudonymisation covers author fields only. This is a stated risk, not an oversight, and closing it is separate work.
