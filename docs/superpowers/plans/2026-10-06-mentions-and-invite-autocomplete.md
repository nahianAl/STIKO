# @mentions and Invite Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone who can comment `@`-mention a person who can open that file (and notify them), and let an inviter pick an existing Stiko connection from a dropdown instead of retyping an email.

**Architecture:** Mentions are plain text in `comments.content` (`@Jane Doe`) plus a new `comments.mentions` JSONB column recording who. The server alone decides who is mentionable and re-validates every save; pure rules live in `lib/mentions.ts` and are shared by the server, the picker and the renderer. Invite autocomplete is one read-only endpoint gated like sending an invite, plus a combobox in the Share package window.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind, Neon serverless Postgres (`sql` tagged template from `@/lib/db`), `node --test` with native type stripping.

**Spec:** `docs/superpowers/specs/2026-10-06-mentions-and-invite-autocomplete-design.md`

## Global Constraints

- **Branch:** all work is on `feature/mentions-and-invite-autocomplete`. Do not push; `main` auto-deploys on push and migration 016 must be applied first (Task 9).
- **Never `git add -A` or `git add .`** Four untracked handoff directories live in the repo root and get swept in. Add files by path.
- **Commit trailer:** every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Naming:** in code this feature is `mention`, never `tag`. `tagging`, `hasTag` and `pendingTag` already mean placing a pin.
- **Tested `lib/` modules use no `@/` alias and import nothing that opens a database.** `node --test` cannot resolve `@/`, and `lib/db` throws at load without `DATABASE_URL`. `lib/mentions.ts`, `lib/portalDeepLink.ts` and `lib/peopleSuggest.ts` have no imports at all.
- **The word "version" must not appear in any string literal, template chunk or JSX text** under `app/`, `components/` or `lib/` (`scripts/tests/copyTerms.test.mjs` fails the suite). Identifiers, comments, `sql` template text and strings starting with `/` are exempt. This is why the deep-link parameter is `submission`, not `version`.
- **UI copy:** "Package" and "Submission", never "Portal" or "Version".
- **Escape inside a modal or drawer:** React is hydrated onto `document`, so `e.stopPropagation()` does not stop a `document.addEventListener('keydown')` handler. Use `e.nativeEvent.stopImmediatePropagation()`.
- **Checks after every task:** `npx tsc --noEmit`, `npm run lint`, `npm test`. All three must be clean before committing.
- **Do not change `tsconfig.json`, `package.json`, lint config or any other project configuration.** `tsconfig.json` sets no `target`, so `tsc` rejects the regex `u` flag and `\p{...}` escapes; write the code so it does not need them.

## Corrections made during execution

The code blocks below are the plan as first written. Review during execution changed the following; the committed code and the spec are authoritative where they differ.

- **Task 1:** the name-boundary rule is `NAME_BOUNDARY` / `continuesName` (already reflected below). `lib/mentions.ts` also gained two pure, tested helpers used by `lib/mentionNotify.ts`: `mentionChannels(recipient, defaults)` (mute, preference and pause rules) and `mentionExcerpt(content, max = 140)` (trims by character, never inside an emoji).
- **Task 2:** in `lib/mentionable.ts`, coordinators are `project_members` rows with `role = 'coordinator'` only, and commenters and viewers are mentionable only when the file's submission is published (the participants branch joins `versions` and requires `published_at IS NOT NULL` for anyone who is not an uploader). A draft is visible only to whoever can upload, and a mention must never email someone a draft they are not shown.
- **Task 3:** in `lib/mentionNotify.ts`, the recipient lookup, the notification insert and the email each have their own `try`, so one channel failing does not cost the other; a missing base URL is logged once. In both comment routes the `mentionableUsers` lookup is wrapped: if it throws, the comment is saved with no new mentions.
- **Tasks 4 and 8:** both inputs ignore keys that belong to an input-method composition (`isComposing` / keyCode 229); `MentionInput` sets `focused` on mount when it was auto-focused and has `autoComplete="off"`; `InviteeInput` has an `aria-label`.
- **Final review (commit 8692df7):**
  - `reconcileMentions` gives each `@` to the longest label that fits it.
  - Opening a package marks its mentions read: `PATCH /api/notifications` accepts `{ portalId }`, fired once by the package page.
  - A mention inside a reply is highlighted (`CommentItem` passes `isActive` to replies).
  - `/api/people/suggest` no longer suggests the owner or coordinators of a project the caller is only a guest on, and answers `Cache-Control: no-store`.
- **Verification by execution:** the new SQL and the comment, suggest and notification route handlers were run against a real Postgres engine (PGlite loaded with `lib/schema.sql`) from a throwaway harness outside the repo. It is not part of the repo and not a substitute for the checks in Task 9.

## File Structure

| File | Responsibility |
|---|---|
| `lib/mentions.ts` (new) | Pure mention rules: label, query detection, insertion, reconcile, render segments |
| `lib/portalDeepLink.ts` (new) | Build and parse `/portal/<id>?submission=&file=&comment=` |
| `lib/peopleSuggest.ts` (new) | `ILIKE` escaping, search patterns, email-shape check |
| `lib/commentColumns.ts` (new) | The lazy `ADD COLUMN IF NOT EXISTS` guard, shared by both comment routes |
| `lib/mentionable.ts` (new) | Who can open a file (DB) |
| `lib/mentionNotify.ts` (new) | Write `mention` notifications and send the email |
| `lib/useMentionable.ts` (new) | Client hook that fetches the mentionable list for a file |
| `lib/migrations/016-comment-mentions.sql` (new) | The `mentions` column |
| `app/api/mentionable/route.ts` (new) | `GET` the mentionable list |
| `app/api/people/suggest/route.ts` (new) | `GET` invite suggestions |
| `components/portal/MentionInput.tsx` (new) | Text input with the `@` picker |
| `components/portal/MentionText.tsx` (new) | Comment body with mention pills |
| `components/portal/InviteeInput.tsx` (new) | Invite field with the suggestion dropdown |
| `lib/schema.sql`, `lib/types.ts` | Mirror the column; `Comment.mentions` |
| `app/api/comments/route.ts`, `app/api/comments/[id]/route.ts` | Store, return, reconcile, notify |
| `components/portal/CommentsPanel.tsx`, `components/portal/CommentComposer.tsx`, `app/portal/[id]/page.tsx` | Wire the input, the pills and the deep link |
| `components/portal/ShareModal.tsx` | Use `InviteeInput` |

---

### Task 1: Pure helpers (`lib/mentions.ts`, `lib/portalDeepLink.ts`)

**Files:**
- Create: `lib/mentions.ts`
- Create: `lib/portalDeepLink.ts`
- Test: `scripts/tests/mentions.test.mjs`
- Test: `scripts/tests/portalDeepLink.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (from `lib/mentions.ts`):
  - `interface Mention { userId: string; name: string }`
  - `interface MentionablePerson { userId: string; label: string; company: string | null; role: string }`
  - `type MentionSegment = { type: 'text'; text: string } | { type: 'mention'; text: string; userId: string }`
  - `MAX_MENTION_QUERY: 30`
  - `mentionLabel(name: string | null | undefined, email: string): string`
  - `hasMention(content: string, label: string): boolean`
  - `activeMentionQuery(text: string, caret: number): { start: number; query: string } | null`
  - `filterMentionable<T extends { label: string }>(people: T[], query: string, limit?: number): T[]`
  - `insertMention(text: string, start: number, caret: number, label: string): { text: string; caret: number }`
  - `reconcileMentions(content: string, ids: readonly unknown[], allowed: ReadonlyMap<string, string>, stored?: Mention[]): Mention[]`
  - `newlyMentioned(before: Mention[], after: Mention[]): string[]`
  - `parseMentions(raw: unknown): Mention[]`
  - `splitMentions(content: string, mentions: Mention[]): MentionSegment[]`
- Produces (from `lib/portalDeepLink.ts`):
  - `interface PortalDeepLink { versionId: string; fileId: string; commentId: string | null }`
  - `portalDeepLinkPath(portalId: string, link: PortalDeepLink): string`
  - `parsePortalDeepLink(search: string): PortalDeepLink | null`

- [ ] **Step 1: Write the failing tests**

Create `scripts/tests/mentions.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mentionLabel,
  hasMention,
  activeMentionQuery,
  filterMentionable,
  insertMention,
  reconcileMentions,
  newlyMentioned,
  parseMentions,
  splitMentions,
} from '../../lib/mentions.ts';

test('a label is the tidied name, or the email local part when there is none', () => {
  assert.equal(mentionLabel('  Jane   Doe ', 'j@x.com'), 'Jane Doe');
  assert.equal(mentionLabel(null, 'dana@consultant.com'), 'dana');
  assert.equal(mentionLabel('   ', 'dana@consultant.com'), 'dana');
});

test('hasMention finds a whole @label and nothing shorter or glued on', () => {
  assert.equal(hasMention('@Jane Doe hi', 'Jane Doe'), true);
  assert.equal(hasMention('hello @Jane', 'Jane'), true);
  assert.equal(hasMention('@Jane, look', 'Jane'), true);
  // "@Janet" is somebody else.
  assert.equal(hasMention('@Janet', 'Jane'), false);
  // An email address is not a mention.
  assert.equal(hasMention('x@Jane', 'Jane'), false);
  assert.equal(hasMention('no mention here', 'Jane'), false);
  assert.equal(hasMention('@ nobody', ''), false);
});

// What may follow a name. Anything that could be more of a name is not a
// boundary; whitespace and punctuation are.
test('a mention ends at whitespace or punctuation, in any script', () => {
  // More name: accents, digits, underscores, and scripts with no letter case.
  assert.equal(hasMention('@Janée', 'Jane'), false);
  assert.equal(hasMention('@Jane2', 'Jane'), false);
  assert.equal(hasMention('@Jane_2', 'Jane'), false);
  assert.equal(hasMention('@李明', '李'), false);
  // Halfwidth katakana and fullwidth letters are name characters, not punctuation.
  assert.equal(hasMention('@ｶﾅ', 'ｶ'), false);
  assert.equal(hasMention('@ＡＢ', 'Ａ'), false);
  // Punctuation ends it — including the curly apostrophe phones and Macs type.
  assert.equal(hasMention("@Jane's idea", 'Jane'), true);
  assert.equal(hasMention('@Jane’s idea', 'Jane'), true);
  assert.equal(hasMention('@Jane…', 'Jane'), true);
  assert.equal(hasMention('@李，你好', '李'), true);
  assert.equal(hasMention('(@Jane)', 'Jane'), false);
  assert.equal(hasMention('see @Jane)', 'Jane'), true);
});

test('activeMentionQuery opens on an @ at the start or after whitespace', () => {
  assert.deepEqual(activeMentionQuery('@', 1), { start: 0, query: '' });
  assert.deepEqual(activeMentionQuery('hi @ja', 6), { start: 3, query: 'ja' });
  // Names contain spaces, so the query may too.
  assert.deepEqual(activeMentionQuery('@Jane Do', 8), { start: 0, query: 'Jane Do' });
  // Only the text before the caret counts.
  assert.deepEqual(activeMentionQuery('@ja and more', 3), { start: 0, query: 'ja' });
});

test('activeMentionQuery ignores an @ inside a word, a bare "@ ", and anything too long', () => {
  assert.equal(activeMentionQuery('mail a@b', 8), null);
  assert.equal(activeMentionQuery('@ hello', 7), null);
  assert.equal(activeMentionQuery('no at sign', 5), null);
  assert.deepEqual(activeMentionQuery('@' + 'a'.repeat(30), 31), { start: 0, query: 'a'.repeat(30) });
  assert.equal(activeMentionQuery('@' + 'a'.repeat(31), 32), null);
});

test('an @ inside a word is skipped in favour of an earlier real one', () => {
  assert.deepEqual(activeMentionQuery('@Jane a@b', 9), { start: 0, query: 'Jane a@b' });
});

test('filterMentionable matches the start of the label or of any word in it', () => {
  const people = [{ label: 'Jane Doe' }, { label: 'Sam Lee' }, { label: 'Dana' }];
  assert.deepEqual(filterMentionable(people, ''), people);
  assert.deepEqual(filterMentionable(people, 'do'), [{ label: 'Jane Doe' }]);
  assert.deepEqual(filterMentionable(people, 'SA'), [{ label: 'Sam Lee' }]);
  assert.deepEqual(filterMentionable(people, 'jane d'), [{ label: 'Jane Doe' }]);
  assert.deepEqual(filterMentionable(people, 'x'), []);
  assert.deepEqual(filterMentionable(people, '', 2), [{ label: 'Jane Doe' }, { label: 'Sam Lee' }]);
});

test('insertMention replaces the typed query and leaves the caret after one space', () => {
  assert.deepEqual(insertMention('@ja', 0, 3, 'Jane Doe'), { text: '@Jane Doe ', caret: 10 });
  // No doubled space when one already follows.
  assert.deepEqual(insertMention('hi @ja there', 3, 6, 'Jane Doe'), {
    text: 'hi @Jane Doe there',
    caret: 13,
  });
});

const allowed = new Map([
  ['u1', 'Jane Doe'],
  ['u2', 'Sam'],
]);

test('reconcileMentions keeps an allowed id whose label is still in the text', () => {
  assert.deepEqual(reconcileMentions('hi @Jane Doe', ['u1'], allowed), [
    { userId: 'u1', name: 'Jane Doe' },
  ]);
});

// The forged-id case: a client names someone who cannot open the file.
test('reconcileMentions drops an id that is not allowed', () => {
  assert.deepEqual(reconcileMentions('hi @Jane Doe', ['u9'], allowed), []);
});

test('reconcileMentions drops an id whose label was deleted from the text', () => {
  assert.deepEqual(reconcileMentions('hi Jane', ['u1'], allowed), []);
});

test('reconcileMentions ignores duplicates and non-string ids', () => {
  assert.deepEqual(reconcileMentions('@Sam @Sam', ['u2', 'u2', 42, null], allowed), [
    { userId: 'u2', name: 'Sam' },
  ]);
});

// Someone removed from the package after being mentioned: an unrelated edit of
// that comment must not strip their pill.
test('reconcileMentions keeps a stored mention even when the person is no longer allowed', () => {
  const stored = [{ userId: 'u7', name: 'Old Name' }];
  assert.deepEqual(reconcileMentions('ping @Old Name', ['u7'], new Map(), stored), stored);
  assert.deepEqual(reconcileMentions('ping nobody', ['u7'], new Map(), stored), []);
});

test('reconcileMentions prefers the current label over a stored one when both are in the text', () => {
  const stored = [{ userId: 'u1', name: 'Jane' }];
  assert.deepEqual(reconcileMentions('@Jane Doe', ['u1'], allowed, stored), [
    { userId: 'u1', name: 'Jane Doe' },
  ]);
});

test('newlyMentioned is the ids in the new list that were not in the old one', () => {
  const before = [{ userId: 'u1', name: 'Jane Doe' }];
  const after = [
    { userId: 'u1', name: 'Jane Doe' },
    { userId: 'u2', name: 'Sam' },
  ];
  assert.deepEqual(newlyMentioned(before, after), ['u2']);
  assert.deepEqual(newlyMentioned(after, before), []);
});

test('parseMentions accepts an array or its JSON text and survives garbage', () => {
  const list = [{ userId: 'u1', name: 'Jane Doe' }];
  assert.deepEqual(parseMentions(list), list);
  assert.deepEqual(parseMentions(JSON.stringify(list)), list);
  assert.deepEqual(parseMentions('not json'), []);
  assert.deepEqual(parseMentions(null), []);
  assert.deepEqual(parseMentions([{ userId: 1 }, 'x', null, { userId: 'u2', name: 'Sam', extra: true }]), [
    { userId: 'u2', name: 'Sam' },
  ]);
});

test('splitMentions matches the longer label first', () => {
  const mentions = [
    { userId: 'u1', name: 'Jane' },
    { userId: 'u2', name: 'Jane Doe' },
  ];
  assert.deepEqual(splitMentions('@Jane Doe and @Jane ok', mentions), [
    { type: 'mention', text: '@Jane Doe', userId: 'u2' },
    { type: 'text', text: ' and ' },
    { type: 'mention', text: '@Jane', userId: 'u1' },
    { type: 'text', text: ' ok' },
  ]);
});

test('splitMentions handles repeats, near-misses and no mentions at all', () => {
  const sam = [{ userId: 'u2', name: 'Sam' }];
  assert.deepEqual(splitMentions('@Sam and @Sam', sam), [
    { type: 'mention', text: '@Sam', userId: 'u2' },
    { type: 'text', text: ' and ' },
    { type: 'mention', text: '@Sam', userId: 'u2' },
  ]);
  assert.deepEqual(splitMentions('@Samantha', sam), [{ type: 'text', text: '@Samantha' }]);
  assert.deepEqual(splitMentions('plain @words', []), [{ type: 'text', text: 'plain @words' }]);
  assert.deepEqual(splitMentions('', sam), []);
});
```

Create `scripts/tests/portalDeepLink.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalDeepLinkPath, parsePortalDeepLink } from '../../lib/portalDeepLink.ts';

test('a built link parses back to what it was built from', () => {
  const link = { versionId: 'v-1', fileId: 'f-1', commentId: 'c-1' };
  const path = portalDeepLinkPath('p-1', link);
  assert.equal(path, '/portal/p-1?submission=v-1&file=f-1&comment=c-1');
  assert.deepEqual(parsePortalDeepLink(path.slice(path.indexOf('?'))), link);
});

test('the comment is optional', () => {
  const link = { versionId: 'v-1', fileId: 'f-1', commentId: null };
  assert.equal(portalDeepLinkPath('p-1', link), '/portal/p-1?submission=v-1&file=f-1');
  assert.deepEqual(parsePortalDeepLink('?submission=v-1&file=f-1'), link);
});

test('a link missing its submission or its file is no link at all', () => {
  assert.equal(parsePortalDeepLink(''), null);
  assert.equal(parsePortalDeepLink('?file=f-1&comment=c-1'), null);
  assert.equal(parsePortalDeepLink('?submission=v-1'), null);
  assert.equal(parsePortalDeepLink('?submission=&file=f-1'), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/tests/mentions.test.mjs scripts/tests/portalDeepLink.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/mentions.ts` and `lib/portalDeepLink.ts`.

- [ ] **Step 3: Write `lib/mentions.ts`**

```ts
/**
 * @mentions in comments — the pure rules.
 *
 * Kept free of imports so `node --test` can load it directly: this project's
 * runner cannot resolve the `@/` alias or open a database. The server uses
 * these to decide who a comment really mentions; the client uses the same
 * functions to drive the picker and draw the pills, so the two cannot disagree
 * about what counts as a mention.
 *
 * In this codebase "tag" already means a pin on the file (`tagging`, `hasTag`,
 * `pendingTag`). Addressing a person is always "mention" in code.
 */

/** One stored mention. `name` is the label as it was written into the text. */
export interface Mention {
  userId: string;
  name: string;
}

/** Someone who can open the file, as the picker shows them. */
export interface MentionablePerson {
  userId: string;
  label: string;
  company: string | null;
  role: string;
}

export type MentionSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; text: string; userId: string };

/** A query longer than this is prose that happens to follow an `@`, not a name. */
export const MAX_MENTION_QUERY = 30;

/**
 * Whether a character could be more of a name. Everything could, except
 * whitespace and punctuation: `@Jane,` and `@Jane’s` end the name, while
 * `@Janet`, `@Jane_2` and `@李明` (for someone called `李`) do not.
 *
 * Written as "not a boundary" rather than "is a letter" on purpose. A letter
 * test needs a Unicode-property regex (`\p{L}`), which this project's compile
 * target does not accept, and a test based on letter case misses every script
 * that has none. The ranges are ASCII punctuation except `_`, Latin-1
 * punctuation, General Punctuation (curly quotes, dashes, the ellipsis), CJK
 * punctuation and the fullwidth forms.
 */
const NAME_BOUNDARY =
  /[\s!-\/:-@\[-^`{-~ -¿ -⁯　-〿＀-／：-＠]/;

function continuesName(ch: string): boolean {
  return !NAME_BOUNDARY.test(ch);
}

/** What a person is called in a mention: their name, or failing that their email's local part. */
export function mentionLabel(name: string | null | undefined, email: string): string {
  const cleaned = (name ?? '').trim().replace(/\s+/g, ' ');
  return cleaned || email.split('@')[0];
}

/**
 * Whether `@label` sits at index `at` as a whole mention: the `@` starts the
 * text or follows whitespace, and the label is not the front of a longer word
 * (`@Janet` does not mention Jane).
 */
function mentionAt(content: string, at: number, label: string): boolean {
  if (!label || content[at] !== '@') return false;
  if (at > 0 && !/\s/.test(content[at - 1])) return false;
  if (!content.startsWith(label, at + 1)) return false;
  const after = content[at + 1 + label.length];
  return after === undefined || !continuesName(after);
}

export function hasMention(content: string, label: string): boolean {
  if (!label) return false;
  for (let at = content.indexOf('@'); at !== -1; at = content.indexOf('@', at + 1)) {
    if (mentionAt(content, at, label)) return true;
  }
  return false;
}

/**
 * The mention being typed at the caret, if any.
 *
 * Walks back from the caret to the nearest `@` that starts the text or follows
 * whitespace. The query may contain spaces, because names do; it is the
 * caller's job to close the list when nobody matches.
 */
export function activeMentionQuery(
  text: string,
  caret: number
): { start: number; query: string } | null {
  const upTo = text.slice(0, caret);
  let at = upTo.lastIndexOf('@');
  while (at !== -1) {
    if (caret - at - 1 > MAX_MENTION_QUERY) return null;
    if (at === 0 || /\s/.test(upTo[at - 1])) {
      const query = upTo.slice(at + 1);
      return /^\s/.test(query) ? null : { start: at, query };
    }
    // lastIndexOf with a negative index searches from 0 again, so stop here.
    at = at === 0 ? -1 : upTo.lastIndexOf('@', at - 1);
  }
  return null;
}

/** People whose label, or any word in it, starts with the query. */
export function filterMentionable<T extends { label: string }>(
  people: T[],
  query: string,
  limit = 6
): T[] {
  const q = query.toLowerCase();
  const matches = people.filter((p) => {
    if (!q) return true;
    const label = p.label.toLowerCase();
    return label.startsWith(q) || label.split(' ').some((word) => word.startsWith(q));
  });
  return matches.slice(0, limit);
}

/** Replace the typed `@query` with `@label`, leaving the caret after one space. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  label: string
): { text: string; caret: number } {
  const rest = text.slice(caret);
  const spacer = rest.startsWith(' ') ? '' : ' ';
  return {
    text: `${text.slice(0, start)}@${label}${spacer}${rest}`,
    caret: start + 1 + label.length + 1,
  };
}

/**
 * Who a comment really mentions.
 *
 * `ids` comes from the client and is never trusted: an id survives only if the
 * server's own list (`allowed`, userId -> label) contains it AND `@label` is
 * still in the text. `stored` is what the comment already held, for an edit: a
 * mention made earlier is kept while its text is still there, even if that
 * person can no longer open the file, so an unrelated edit does not strip it.
 */
export function reconcileMentions(
  content: string,
  ids: readonly unknown[],
  allowed: ReadonlyMap<string, string>,
  stored: Mention[] = []
): Mention[] {
  const storedById = new Map(stored.map((m) => [m.userId, m]));
  const seen = new Set<string>();
  const out: Mention[] = [];
  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const label = allowed.get(id);
    if (label && hasMention(content, label)) {
      out.push({ userId: id, name: label });
      continue;
    }
    const kept = storedById.get(id);
    if (kept && hasMention(content, kept.name)) {
      out.push({ userId: kept.userId, name: kept.name });
    }
  }
  return out;
}

/** The ids in `after` that were not in `before` — who an edit should notify. */
export function newlyMentioned(before: Mention[], after: Mention[]): string[] {
  const had = new Set(before.map((m) => m.userId));
  return after.filter((m) => !had.has(m.userId)).map((m) => m.userId);
}

/** Read the `mentions` column, which the driver may hand back as JSON text. */
export function parseMentions(raw: unknown): Mention[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: Mention[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const m = item as { userId?: unknown; name?: unknown };
    if (typeof m.userId === 'string' && typeof m.name === 'string') {
      out.push({ userId: m.userId, name: m.name });
    }
  }
  return out;
}

/** Cut a comment into plain text and mention pills, longest label first. */
export function splitMentions(content: string, mentions: Mention[]): MentionSegment[] {
  if (!content) return [];
  if (mentions.length === 0) return [{ type: 'text', text: content }];
  const byLength = [...mentions].sort((a, b) => b.name.length - a.name.length);
  const out: MentionSegment[] = [];
  let buffer = '';
  let i = 0;
  while (i < content.length) {
    const hit =
      content[i] === '@' ? byLength.find((m) => mentionAt(content, i, m.name)) : undefined;
    if (hit) {
      if (buffer) {
        out.push({ type: 'text', text: buffer });
        buffer = '';
      }
      out.push({ type: 'mention', text: `@${hit.name}`, userId: hit.userId });
      i += 1 + hit.name.length;
    } else {
      buffer += content[i];
      i += 1;
    }
  }
  if (buffer) out.push({ type: 'text', text: buffer });
  return out;
}
```

- [ ] **Step 4: Write `lib/portalDeepLink.ts`**

```ts
/**
 * A link that opens a package on one file, with one comment highlighted.
 *
 * Both ends live here so they cannot drift: the notification that builds the
 * link and the package page that reads it. No imports, so `node --test` can
 * load it.
 *
 * The parameter is `submission` because that is the word people see; in code
 * the id it carries is still a versionId.
 */
export interface PortalDeepLink {
  versionId: string;
  fileId: string;
  commentId: string | null;
}

export function portalDeepLinkPath(portalId: string, link: PortalDeepLink): string {
  const params = new URLSearchParams({ submission: link.versionId, file: link.fileId });
  if (link.commentId) params.set('comment', link.commentId);
  return `/portal/${portalId}?${params.toString()}`;
}

/** Null unless both the submission and the file are named; the comment is optional. */
export function parsePortalDeepLink(search: string): PortalDeepLink | null {
  const params = new URLSearchParams(search);
  const versionId = params.get('submission');
  const fileId = params.get('file');
  if (!versionId || !fileId) return null;
  return { versionId, fileId, commentId: params.get('comment') || null };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test scripts/tests/mentions.test.mjs scripts/tests/portalDeepLink.test.mjs`
Expected: PASS, 0 failures.

- [ ] **Step 6: Run the project checks**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no type errors, no lint errors, all tests pass (including `copyTerms`).

- [ ] **Step 7: Commit**

```bash
git add lib/mentions.ts lib/portalDeepLink.ts scripts/tests/mentions.test.mjs scripts/tests/portalDeepLink.test.mjs
git commit -m "feat(mentions): pure mention and deep-link rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Data model and the mentionable list

**Files:**
- Create: `lib/migrations/016-comment-mentions.sql`
- Create: `lib/commentColumns.ts`
- Create: `lib/mentionable.ts`
- Create: `app/api/mentionable/route.ts`
- Modify: `lib/schema.sql` (the `comments` table, ends near line 193)
- Modify: `lib/types.ts` (`Comment`, near line 97)
- Modify: `app/api/comments/route.ts:9-20` (remove the local guard, import the shared one)

**Interfaces:**
- Consumes: `mentionLabel`, `MentionablePerson`, `Mention` from `lib/mentions.ts`; `portalForFile`, `getFileAccess` from `@/lib/access`.
- Produces:
  - `ensureCommentColumns(): Promise<void>` from `@/lib/commentColumns`
  - `mentionableUsers(fileId: string): Promise<MentionablePerson[]>` from `@/lib/mentionable` (includes the caller; callers filter)
  - `GET /api/mentionable?fileId=` → `MentionablePerson[]` without the caller; 401 / 400 / 404 / 403
  - `Comment.mentions?: Mention[]`

- [ ] **Step 1: Write the migration**

Create `lib/migrations/016-comment-mentions.sql`:

```sql
-- Who a comment mentions. Mirrored in lib/schema.sql.
--
-- [{ "userId": "...", "name": "Jane Doe" }]. The comment text itself stays
-- plain ("@Jane Doe"), so everything that already reads `content` as text —
-- AI summaries, the Brief, notification excerpts — is untouched. `name` is the
-- label as it was written into the text, so a mention still renders after the
-- person renames themselves or leaves the package.
--
-- Additive and defaulted: every existing row is '[]', nothing to backfill, and
-- code that predates this ignores the column.
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]';
```

- [ ] **Step 2: Mirror it in `lib/schema.sql`**

In the `comments` table, replace:

```sql
  edited_at TIMESTAMPTZ DEFAULT NULL
);
```

with:

```sql
  edited_at TIMESTAMPTZ DEFAULT NULL,
  -- Who the comment mentions: [{ "userId", "name" }]. The text stays plain.
  -- See lib/migrations/016-comment-mentions.sql.
  mentions JSONB NOT NULL DEFAULT '[]'
);
```

- [ ] **Step 3: Add `mentions` to the `Comment` type**

In `lib/types.ts`, add below the existing `import type { LengthUnit } from './measure/units.ts';` line, matching its relative-path-with-extension form:

```ts
import type { Mention } from './mentions.ts';
```

and in `interface Comment`, after `attachments?: CommentAttachment[];`:

```ts
  /** Who the comment mentions. Absent on rows fetched before migration 016. */
  mentions?: Mention[];
```

The import is relative and type-only on purpose: `lib/types.ts` is imported by modules that `node --test` loads.

- [ ] **Step 4: Move the lazy column guard to `lib/commentColumns.ts`**

Create `lib/commentColumns.ts`:

```ts
import { sql } from '@/lib/db';

/**
 * Add the comment columns that arrived after the table did, once per cold
 * start.
 *
 * Migrations here are applied by hand and have been forgotten before. The
 * comment list query names these columns, so a missed migration would put
 * every comment in production behind a 500. This bounds that damage; the
 * migration files remain the real mechanism.
 *
 * Shared because both comment routes name `mentions`.
 */
let attempted = false;

export async function ensureCommentColumns(): Promise<void> {
  if (attempted) return;
  attempted = true;
  try {
    await sql`ALTER TABLE comments ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'`;
    await sql`ALTER TABLE comments ADD COLUMN IF NOT EXISTS timestamp DOUBLE PRECISION DEFAULT NULL`;
    await sql`ALTER TABLE comments ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]'`;
  } catch {
    // columns may already exist or insufficient permissions — either way, proceed
  }
}
```

In `app/api/comments/route.ts`, delete this whole block:

```ts
// Ensure new columns exist (runs once per cold start)
let migrationAttempted = false;
async function ensureCommentColumns() {
  if (migrationAttempted) return;
  migrationAttempted = true;
  try {
    await sql`ALTER TABLE comments ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'`;
    await sql`ALTER TABLE comments ADD COLUMN IF NOT EXISTS timestamp DOUBLE PRECISION DEFAULT NULL`;
  } catch {
    // columns may already exist or insufficient permissions — either way, proceed
  }
}
```

and add to its imports:

```ts
import { ensureCommentColumns } from '@/lib/commentColumns';
```

- [ ] **Step 5: Write `lib/mentionable.ts`**

```ts
import { sql } from '@/lib/db';
import { portalForFile } from '@/lib/access';
import { mentionLabel, type MentionablePerson } from '@/lib/mentions';

/**
 * Everyone who can open this file: the project owner, its coordinators, and
 * the package's participants whose scope covers the file's submission.
 *
 * The participant rule is the same predicate the publish route uses to pick
 * its recipients, and it matches canSeeVersion: unscoped, or an uploader (never
 * scoped), or explicitly given this one. A mention can therefore never reach
 * someone who would get a 404 from its link.
 *
 * Includes the caller. Whoever asks decides whether to drop themselves.
 */
export async function mentionableUsers(fileId: string): Promise<MentionablePerson[]> {
  const location = await portalForFile(fileId);
  if (!location) return [];

  const rows = await sql`
    SELECT u.id AS "userId", u.name, u.email, u.company, 'owner' AS role, 0 AS sort_order
    FROM portals po
    JOIN projects pr ON pr.id = po.project_id
    JOIN users u ON u.id = pr.owner_id
    WHERE po.id = ${location.portalId}
    UNION ALL
    SELECT u.id, u.name, u.email, u.company, pm.role, 1
    FROM portals po
    JOIN project_members pm ON pm.project_id = po.project_id
    JOIN users u ON u.id = pm.user_id
    WHERE po.id = ${location.portalId}
    UNION ALL
    SELECT u.id, u.name, u.email, u.company, pa.role, 2
    FROM participants pa
    JOIN users u ON u.id = pa.user_id
    WHERE pa.portal_id = ${location.portalId}
      AND (
        pa.all_versions = TRUE
        OR pa.role = 'uploader'
        OR EXISTS (
          SELECT 1 FROM participant_versions pv
          WHERE pv.participant_id = pa.id AND pv.version_id = ${location.versionId}
        )
      )
    ORDER BY sort_order, name NULLS LAST
  `;

  // One person can arrive by more than one route (an owner who is also listed
  // as a member). The first row wins, and the ordering above puts their
  // strongest role first.
  const seen = new Set<string>();
  const people: MentionablePerson[] = [];
  for (const r of rows) {
    const userId = r.userId as string;
    if (seen.has(userId)) continue;
    seen.add(userId);
    people.push({
      userId,
      label: mentionLabel(r.name as string | null, r.email as string),
      company: (r.company as string | null) ?? null,
      role: r.role as string,
    });
  }
  return people;
}
```

- [ ] **Step 6: Write `app/api/mentionable/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getFileAccess } from '@/lib/access';
import { mentionableUsers } from '@/lib/mentionable';

/**
 * Who the caller may @mention on this file.
 *
 * Built on the server because only the server knows each person's scope: the
 * roster endpoint deliberately withholds it, and filtering in the browser
 * would mean shipping it. Emails are not returned; the picker shows a name and
 * a company.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const fileId = request.nextUrl.searchParams.get('fileId');
  if (!fileId) {
    return NextResponse.json({ error: 'fileId required' }, { status: 400 });
  }

  const access = await getFileAccess(userId, fileId);
  // Not an oracle: a nonexistent file and an out-of-scope one both answer 404.
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Only someone composing a comment needs this list.
  if (!access.canComment) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const people = await mentionableUsers(fileId);
  return NextResponse.json(people.filter((p) => p.userId !== userId));
}
```

- [ ] **Step 7: Run the project checks**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean. (No unit test here: these are database reads, verified live in Task 9.)

- [ ] **Step 8: Commit**

```bash
git add lib/migrations/016-comment-mentions.sql lib/schema.sql lib/types.ts lib/commentColumns.ts lib/mentionable.ts app/api/mentionable/route.ts app/api/comments/route.ts
git commit -m "feat(mentions): mentions column and the mentionable list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Store, return and notify

**Files:**
- Create: `lib/mentionNotify.ts`
- Modify: `app/api/comments/route.ts` (GET select and mapping; POST body, insert and response)
- Modify: `app/api/comments/[id]/route.ts` (PUT, whole handler)

**Interfaces:**
- Consumes: `reconcileMentions`, `newlyMentioned`, `parseMentions`, `Mention` from `@/lib/mentions`; `mentionableUsers` from `@/lib/mentionable`; `ensureCommentColumns` from `@/lib/commentColumns`; `portalDeepLinkPath` from `@/lib/portalDeepLink`; `NOTIFICATION_EVENTS` from `@/lib/notificationEvents`; `sendEmail`, `mentionEmail` from `@/lib/email`; `appBaseUrlOrNull` from `@/lib/appUrl`.
- Produces:
  - `notifyMentions(opts: { actorId: string; actorName: string; recipientIds: string[]; fileId: string; commentId: string; content: string }): Promise<void>` — never throws.
  - `POST /api/comments` accepts `mentions?: string[]`; its response and every `GET /api/comments` row carry `mentions: Mention[]`.
  - `PUT /api/comments/[id]` accepts `mentions?: string[]`; its response carries `mentions: Mention[]`.

- [ ] **Step 1: Write `lib/mentionNotify.ts`**

```ts
import { v4 as uuidv4 } from 'uuid';
import { sql } from '@/lib/db';
import { portalForFile } from '@/lib/access';
import { sendEmail, mentionEmail } from '@/lib/email';
import { appBaseUrlOrNull } from '@/lib/appUrl';
import { NOTIFICATION_EVENTS } from '@/lib/notificationEvents';
import { portalDeepLinkPath } from '@/lib/portalDeepLink';

const EXCERPT_LENGTH = 140;

/**
 * Tell people they were mentioned.
 *
 * Called after the comment is already saved, so it never throws: a failure to
 * notify must not turn a saved comment into an error response. Each recipient
 * is handled on their own for the same reason — one bad address must not cost
 * everyone after it their notification.
 *
 * Per recipient:
 *   - a muted package means nothing at all (the mute copy promises "even for
 *     @mentions");
 *   - the in-app row and the email each follow their `mention` preference,
 *     where a missing row means the default in NOTIFICATION_EVENTS;
 *   - a paused inbox skips the email only.
 */
export async function notifyMentions(opts: {
  actorId: string;
  actorName: string;
  recipientIds: string[];
  fileId: string;
  commentId: string;
  content: string;
}): Promise<void> {
  const recipientIds = opts.recipientIds.filter((id) => id !== opts.actorId);
  if (recipientIds.length === 0) return;

  try {
    const location = await portalForFile(opts.fileId);
    if (!location) return;

    const context = await sql`
      SELECT f.filename AS "fileName", po.name AS "packageName"
      FROM files f
      JOIN versions v ON v.id = f.version_id
      JOIN portals po ON po.id = v.portal_id
      WHERE f.id = ${opts.fileId}
    `;
    const fileName = (context[0]?.fileName as string | undefined) ?? 'a file';
    const packageName = (context[0]?.packageName as string | undefined) ?? 'a package';

    const path = portalDeepLinkPath(location.portalId, {
      versionId: location.versionId,
      fileId: opts.fileId,
      commentId: opts.commentId,
    });
    const excerpt =
      opts.content.length > EXCERPT_LENGTH
        ? `${opts.content.slice(0, EXCERPT_LENGTH - 1)}…`
        : opts.content;
    const title = `${opts.actorName} mentioned you on ${fileName}`;

    const defaults = NOTIFICATION_EVENTS.find((e) => e.key === 'mention');
    const defaultInApp = defaults?.inApp ?? true;
    const defaultEmail = defaults?.email ?? true;
    // Configured host only — never the request's. See lib/appUrl.ts.
    const base = appBaseUrlOrNull();

    for (const userId of recipientIds) {
      try {
        const rows = await sql`
          SELECT u.email,
                 (u.email_paused_until IS NOT NULL AND u.email_paused_until > NOW()) AS paused,
                 EXISTS (
                   SELECT 1 FROM portal_mutes m
                   WHERE m.portal_id = ${location.portalId} AND m.user_id = u.id
                 ) AS muted,
                 np.in_app AS "inApp",
                 np.email AS "wantsEmail"
          FROM users u
          LEFT JOIN notification_prefs np
            ON np.user_id = u.id AND np.event = 'mention'
          WHERE u.id = ${userId}
        `;
        const r = rows[0];
        if (!r || r.muted) continue;

        const inApp = r.inApp == null ? defaultInApp : Boolean(r.inApp);
        const wantsEmail = r.wantsEmail == null ? defaultEmail : Boolean(r.wantsEmail);

        if (inApp) {
          await sql`
            INSERT INTO notifications
              (id, user_id, type, portal_id, actor_id, title, excerpt, href)
            VALUES (
              ${uuidv4()}, ${userId}, 'mention', ${location.portalId},
              ${opts.actorId}, ${title}, ${excerpt}, ${path}
            )
          `;
        }

        if (wantsEmail && !r.paused && base) {
          await sendEmail({
            to: r.email as string,
            ...mentionEmail({
              actorName: opts.actorName,
              fileName,
              packageName,
              excerpt,
              link: `${base}${path}`,
            }),
          });
        }
      } catch (err) {
        console.error('[mentions] could not notify', userId, err);
      }
    }
  } catch (err) {
    console.error('[mentions] notify failed', err);
  }
}
```

- [ ] **Step 2: Return `mentions` from `GET /api/comments`**

In `app/api/comments/route.ts`, add to the imports:

```ts
import { mentionableUsers } from '@/lib/mentionable';
import { notifyMentions } from '@/lib/mentionNotify';
import { parseMentions, reconcileMentions, type Mention } from '@/lib/mentions';
```

In the GET handler's first (non-fallback) `SELECT`, replace:

```ts
             page_number AS "pageNumber", timestamp,
             author, created_at AS "createdAt"
      FROM comments WHERE file_id = ${fileId}
```

with:

```ts
             page_number AS "pageNumber", timestamp,
             author, created_at AS "createdAt", mentions
      FROM comments WHERE file_id = ${fileId}
```

(The fallback `SELECT` in the `catch` stays as it is.) Then replace:

```ts
    rows.map(async (row) => {
      // Resolve snapshot URL
```

with:

```ts
    rows.map(async (row) => {
      // Always an array on the wire, including for the fallback query above,
      // which does not select the column at all.
      row = { ...row, mentions: parseMentions(row.mentions) };
      // Resolve snapshot URL
```

- [ ] **Step 3: Store and notify in `POST /api/comments`**

Replace:

```ts
  const { fileId, content, xPosition, yPosition, worldX, worldY, worldZ, parentCommentId, snapshotUrl, pageNumber, timestamp, attachments } =
    await request.json();
```

with:

```ts
  const { fileId, content, xPosition, yPosition, worldX, worldY, worldZ, parentCommentId, snapshotUrl, pageNumber, timestamp, attachments, mentions } =
    await request.json();
```

Replace:

```ts
  // The author is the session, never a client-supplied string.
  const resolvedAuthor = session.user.name || session.user.email || 'Someone';
  const attachmentsJson = JSON.stringify(attachments ?? []);
```

with:

```ts
  // The author is the session, never a client-supplied string.
  const resolvedAuthor = session.user.name || session.user.email || 'Someone';
  const attachmentsJson = JSON.stringify(attachments ?? []);

  // The ids are a claim, not a fact. Each survives only if the server's own
  // list says that person can open this file AND their @label is in the text.
  const authorId = session.user.id;
  let storedMentions: Mention[] = [];
  if (Array.isArray(mentions) && mentions.length > 0 && typeof content === 'string') {
    const allowed = new Map<string, string>();
    for (const p of await mentionableUsers(fileId)) {
      if (p.userId !== authorId) allowed.set(p.userId, p.label);
    }
    storedMentions = reconcileMentions(content, mentions, allowed);
  }
```

In the first (non-fallback) `INSERT`, replace:

```ts
      INSERT INTO comments (id, file_id, user_id, parent_comment_id, content,
                            x_position, y_position, world_x, world_y, world_z,
                            snapshot_url, attachments, page_number, timestamp, author)
      VALUES (${id}, ${fileId}, ${session?.user?.id ?? null}, ${parentCommentId ?? null},
              ${content}, ${xPosition ?? null}, ${yPosition ?? null},
              ${worldX ?? null}, ${worldY ?? null}, ${worldZ ?? null},
              ${snapshotUrl ?? null}, ${attachmentsJson}::jsonb, ${pageNumber ?? null}, ${timestamp ?? null}, ${resolvedAuthor})
```

with:

```ts
      INSERT INTO comments (id, file_id, user_id, parent_comment_id, content,
                            x_position, y_position, world_x, world_y, world_z,
                            snapshot_url, attachments, page_number, timestamp, author, mentions)
      VALUES (${id}, ${fileId}, ${session?.user?.id ?? null}, ${parentCommentId ?? null},
              ${content}, ${xPosition ?? null}, ${yPosition ?? null},
              ${worldX ?? null}, ${worldY ?? null}, ${worldZ ?? null},
              ${snapshotUrl ?? null}, ${attachmentsJson}::jsonb, ${pageNumber ?? null}, ${timestamp ?? null}, ${resolvedAuthor},
              ${JSON.stringify(storedMentions)}::jsonb)
```

In the `catch` that holds the fallback `INSERT`, replace:

```ts
  } catch {
    // Fallback without attachments column
    rows = await sql`
```

with:

```ts
  } catch {
    // The fallback row has no mentions column to write to, so nobody is
    // recorded as mentioned and nobody may be notified.
    storedMentions = [];
    // Fallback without attachments column
    rows = await sql`
```

Finally replace the handler's last line:

```ts
  return NextResponse.json(rows[0], { status: 201 });
```

with:

```ts
  // Awaited, not fired and forgotten: on a serverless host, work still running
  // after the response is sent is killed. It never throws.
  if (storedMentions.length > 0) {
    await notifyMentions({
      actorId: authorId,
      actorName: resolvedAuthor,
      recipientIds: storedMentions.map((m) => m.userId),
      fileId,
      commentId: id,
      content: String(content ?? ''),
    });
  }

  return NextResponse.json({ ...rows[0], mentions: storedMentions }, { status: 201 });
```

- [ ] **Step 4: Reconcile and notify in `PUT /api/comments/[id]`**

In `app/api/comments/[id]/route.ts`, replace the imports and the whole `PUT` function (leave `DELETE` untouched) with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getFileAccess } from '@/lib/access';
import { ensureCommentColumns } from '@/lib/commentColumns';
import { mentionableUsers } from '@/lib/mentionable';
import { notifyMentions } from '@/lib/mentionNotify';
import { newlyMentioned, parseMentions, reconcileMentions } from '@/lib/mentions';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const editorId = session.user.id;

  const { content, mentions } = await request.json();
  if (!content || !content.trim()) {
    return NextResponse.json({ error: 'Content is required' }, { status: 400 });
  }
  const trimmed: string = content.trim();

  await ensureCommentColumns();

  const existing = await sql`
    SELECT user_id, file_id, mentions FROM comments WHERE id = ${params.id}
  `;
  if (!existing[0]) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }
  // Only the comment's owner may edit (anonymous comments have no owner and are not editable).
  if (existing[0].user_id !== editorId) {
    return NextResponse.json({ error: 'Not authorized to edit this comment' }, { status: 403 });
  }

  const fileId = existing[0].file_id as string;
  const stored = parseMentions(existing[0].mentions);
  // A client that does not know about mentions sends none. That means "check
  // the ones already here against the new text", not "clear them".
  const requested: unknown[] = Array.isArray(mentions)
    ? mentions
    : stored.map((m) => m.userId);

  // The list is only needed to admit someone NEW. And an author who has since
  // lost comment access may still fix their own words, but may not use the
  // edit to notify people on a package they are no longer on.
  const allowed = new Map<string, string>();
  const addsSomeone = requested.some((id) => !stored.some((m) => m.userId === id));
  if (addsSomeone) {
    const access = await getFileAccess(editorId, fileId);
    if (access?.canComment) {
      for (const p of await mentionableUsers(fileId)) {
        if (p.userId !== editorId) allowed.set(p.userId, p.label);
      }
    }
  }
  const nextMentions = reconcileMentions(trimmed, requested, allowed, stored);

  // edited_at is what lets every other open portal notice this edit. The change
  // feed compares a (count, latest stamp) pair, and an edit moves neither
  // created_at nor the row count — see lib/migrations/013-comment-edits.sql.
  const rows = await sql`
    UPDATE comments
    SET content = ${trimmed},
        mentions = ${JSON.stringify(nextMentions)}::jsonb,
        edited_at = NOW()
    WHERE id = ${params.id}
    RETURNING id, file_id AS "fileId", user_id AS "userId",
              parent_comment_id AS "parentCommentId", content,
              x_position AS "xPosition", y_position AS "yPosition",
              world_x AS "worldX", world_y AS "worldY", world_z AS "worldZ",
              snapshot_url AS "snapshotUrl", author, created_at AS "createdAt",
              edited_at AS "editedAt"
  `;
  if (!rows[0]) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }

  // Only people this edit added. Everyone already mentioned was told when
  // they were first mentioned.
  const added = newlyMentioned(stored, nextMentions);
  if (added.length > 0) {
    await notifyMentions({
      actorId: editorId,
      actorName: session.user.name || session.user.email || 'Someone',
      recipientIds: added,
      fileId,
      commentId: params.id,
      content: trimmed,
    });
  }

  return NextResponse.json({ ...rows[0], mentions: nextMentions });
}
```

- [ ] **Step 5: Run the project checks**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/mentionNotify.ts app/api/comments/route.ts "app/api/comments/[id]/route.ts"
git commit -m "feat(mentions): store, reconcile and notify on comment save

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The mention input, the pill renderer and the people hook

**Files:**
- Create: `lib/useMentionable.ts`
- Create: `components/portal/MentionInput.tsx`
- Create: `components/portal/MentionText.tsx`

**Interfaces:**
- Consumes: `activeMentionQuery`, `filterMentionable`, `insertMention`, `splitMentions`, `Mention`, `MentionablePerson` from `@/lib/mentions`; `getInitials` from `@/lib/initials`.
- Produces:
  - `useMentionable(fileId: string | null, refreshKey?: number): MentionablePerson[]`
  - `<MentionInput value onChange mentionIds onMentionIdsChange people placement? inputRef? placeholder? className? wrapperClassName? autoFocus? onKeyDown? />` (default export)
  - `<MentionText content mentions currentUserId />` (default export)

- [ ] **Step 1: Write `lib/useMentionable.ts`**

```ts
'use client';

import { useEffect, useState } from 'react';
import type { MentionablePerson } from '@/lib/mentions';

/**
 * Who can be @mentioned on a file. Empty while loading, for a null file, and
 * on any failure — in all three the comment inputs behave exactly as they did
 * before mentions existed.
 *
 * `refreshKey` re-fetches without clearing, for when the roster changes under
 * an open package.
 */
export function useMentionable(
  fileId: string | null,
  refreshKey = 0
): MentionablePerson[] {
  const [people, setPeople] = useState<MentionablePerson[]>([]);

  // A different file is a different list. Never show the last file's people
  // while the new one loads.
  useEffect(() => {
    setPeople([]);
  }, [fileId]);

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    fetch(`/api/mentionable?fileId=${encodeURIComponent(fileId)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setPeople(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fileId, refreshKey]);

  return people;
}
```

- [ ] **Step 2: Write `components/portal/MentionInput.tsx`**

```tsx
'use client';

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  activeMentionQuery,
  filterMentionable,
  insertMention,
  type MentionablePerson,
} from '@/lib/mentions';
import { getInitials } from '@/lib/initials';

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Ids of the people picked so far. The server re-checks every one. */
  mentionIds: string[];
  onMentionIdsChange: (ids: string[]) => void;
  people: MentionablePerson[];
  /**
   * Where the list opens. The composer sits at the bottom of the panel, so it
   * opens upward. A reply or edit box sits inside the scrolling thread, where a
   * list above the first comment would be clipped — those open downward.
   */
  placement?: 'above' | 'below';
  inputRef?: React.RefObject<HTMLInputElement>;
  placeholder?: string;
  className?: string;
  wrapperClassName?: string;
  autoFocus?: boolean;
  /** Runs for every key the open list did not consume. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

/** A single-line text input that offers people to mention after an `@`. */
export default function MentionInput({
  value,
  onChange,
  mentionIds,
  onMentionIdsChange,
  people,
  placement = 'below',
  inputRef,
  placeholder,
  className,
  wrapperClassName,
  autoFocus,
  onKeyDown,
}: MentionInputProps) {
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // The `@` whose list was picked from or dismissed. Without it, the text right
  // after a pick ("@Jane do it") is itself a query that can match someone else
  // ("Jane Doe"), the list reopens, and Enter picks a person instead of sending.
  const [closedAt, setClosedAt] = useState<number | null>(null);
  // Where the caret belongs after a pick rewrote the text. A controlled input
  // otherwise drops it at the end.
  const pendingCaret = useRef<number | null>(null);

  const active = focused ? activeMentionQuery(value, caret) : null;
  const activeStart = active ? active.start : null;
  const matches =
    active && active.start !== closedAt ? filterMentionable(people, active.query) : [];
  const open = matches.length > 0;
  const current = Math.min(highlight, matches.length - 1);

  // Once the caret has left that `@` behind, forget it, so a later `@` typed at
  // the same index opens normally.
  useEffect(() => {
    if (activeStart === null && closedAt !== null) setClosedAt(null);
  }, [activeStart, closedAt]);

  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    ref.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [value, ref]);

  const syncCaret = (el: HTMLInputElement) => {
    setCaret(el.selectionStart ?? el.value.length);
  };

  const pick = (person: MentionablePerson) => {
    if (!active) return;
    const next = insertMention(value, active.start, caret, person.label);
    pendingCaret.current = next.caret;
    onChange(next.text);
    setCaret(next.caret);
    setClosedAt(active.start);
    if (!mentionIds.includes(person.userId)) {
      onMentionIdsChange([...mentionIds, person.userId]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open && active) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((current + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((current - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[current]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        // React is hydrated onto `document`, so stopPropagation() would not
        // stop a document-level Escape handler (a drawer, the package page's
        // own shortcuts). Only this does.
        e.nativeEvent.stopImmediatePropagation();
        setClosedAt(active.start);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div className={`relative ${wrapperClassName ?? ''}`}>
      <input
        ref={ref}
        type="text"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={className}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${current}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          syncCaret(e.target);
          setHighlight(0);
        }}
        onSelect={(e) => syncCaret(e.currentTarget)}
        onFocus={(e) => {
          setFocused(true);
          syncCaret(e.currentTarget);
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention someone"
          className={`absolute left-0 z-30 w-[240px] max-w-full overflow-hidden rounded-xl border border-stiko-divider bg-white py-1 shadow-stiko-popover ${
            placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-1'
          }`}
        >
          {matches.map((person, i) => (
            <li
              key={person.userId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              // mousedown, not click, and prevented: a click would blur the
              // input first, which closes the list before the click lands.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(person);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex cursor-pointer items-center gap-2 px-2.5 py-1.5 ${
                i === current ? 'bg-stiko-tint' : ''
              }`}
            >
              <span className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-stiko-idle text-[9px] font-extrabold text-stiko-secondary">
                {getInitials(person.label)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-bold text-stiko-ink">
                  {person.label}
                </span>
                {person.company && (
                  <span className="block truncate text-[11px] text-stiko-muted">
                    {person.company}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write `components/portal/MentionText.tsx`**

```tsx
import React from 'react';
import { splitMentions, type Mention } from '@/lib/mentions';

/**
 * A comment body with its mentions drawn as pills.
 *
 * With no mentions this renders the text exactly as a bare `{content}` did, so
 * a typed `@something` that was never picked stays plain text.
 */
export default function MentionText({
  content,
  mentions,
  currentUserId,
}: {
  content: string;
  mentions?: Mention[];
  currentUserId: string | null;
}) {
  const segments = splitMentions(content, mentions ?? []);
  return (
    <>
      {segments.map((segment, i) =>
        segment.type === 'text' ? (
          <React.Fragment key={i}>{segment.text}</React.Fragment>
        ) : (
          <span
            key={i}
            className={`rounded-[5px] px-1 py-px font-semibold ${
              segment.userId === currentUserId
                ? 'bg-stiko-primary text-white'
                : 'bg-stiko-primary/10 text-stiko-primary'
            }`}
          >
            {segment.text}
          </span>
        )
      )}
    </>
  );
}
```

- [ ] **Step 4: Run the project checks**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean. (Nothing renders these yet; Task 5 wires them in.)

- [ ] **Step 5: Commit**

```bash
git add lib/useMentionable.ts components/portal/MentionInput.tsx components/portal/MentionText.tsx
git commit -m "feat(mentions): mention input, pill renderer and people hook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wire mentions into the comment UI

**Files:**
- Modify: `components/portal/CommentsPanel.tsx` (props, `CommentForm`, `CommentItem`, main panel)
- Modify: `components/portal/CommentComposer.tsx` (props and the text input)
- Modify: `app/portal/[id]/page.tsx` (composer state near line 309, reset effect near line 1713, `handleComposerSubmit` near line 1875, the `<CommentsPanel>` near line 2519)

**Interfaces:**
- Consumes: `MentionInput`, `MentionText`, `useMentionable` from Task 4; `MentionablePerson` from `@/lib/mentions`; `Comment.mentions` from Task 2.
- Produces: `CommentsPanel` prop `mentionable?: MentionablePerson[]`; `CommentComposer` props `people: MentionablePerson[]`, `mentionIds: string[]`, `onMentionIdsChange: (ids: string[]) => void`.

- [ ] **Step 1: `CommentsPanel.tsx` — imports and props**

After the line `import { preserveIfUnchanged } from '@/lib/portalActivity';` add:

```tsx
import MentionInput from '@/components/portal/MentionInput';
import MentionText from '@/components/portal/MentionText';
import type { MentionablePerson } from '@/lib/mentions';
```

In `interface CommentsPanelProps`, after `onCommentsChanged?: () => void;` add:

```tsx
  /** Who can be @mentioned on the open file. Fetched once by the page and shared. */
  mentionable?: MentionablePerson[];
```

- [ ] **Step 2: `CommentsPanel.tsx` — the reply form (`CommentForm`)**

In `interface CommentFormProps`, after `autoFocus?: boolean;` add:

```tsx
  people: MentionablePerson[];
```

In the `CommentForm` parameter list, after `autoFocus = false,` add:

```tsx
  people,
```

After `const [text, setText] = useState('');` add:

```tsx
  const [mentionIds, setMentionIds] = useState<string[]>([]);
```

In `handleSubmit`'s request body, replace:

```tsx
          parentCommentId: parentCommentId ?? null,
          attachments,
        }),
```

with:

```tsx
          parentCommentId: parentCommentId ?? null,
          attachments,
          mentions: mentionIds,
        }),
```

and replace:

```tsx
      setText('');
      setPendingFiles([]);
      onSubmitted();
```

with:

```tsx
      setText('');
      setMentionIds([]);
      setPendingFiles([]);
      onSubmitted();
```

Replace the text input:

```tsx
        <input
          ref={textInputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-400 focus:bg-white outline-none transition-colors"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
            if (e.key === 'Escape' && onCancel) onCancel();
          }}
        />
```

with:

```tsx
        <MentionInput
          inputRef={textInputRef}
          value={text}
          onChange={setText}
          mentionIds={mentionIds}
          onMentionIdsChange={setMentionIds}
          people={people}
          placement="below"
          placeholder={placeholder}
          wrapperClassName="flex-1 min-w-0"
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-400 focus:bg-white outline-none transition-colors"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
            if (e.key === 'Escape' && onCancel) onCancel();
          }}
        />
```

- [ ] **Step 3: `CommentsPanel.tsx` — the comment card (`CommentItem`)**

In the `CommentItem` parameter list, after `onChanged,` add `people,`; in its props type, after `onChanged?: () => void;` add:

```tsx
  people: MentionablePerson[];
```

After `const [editText, setEditText] = useState(comment.content);` add:

```tsx
  const storedMentionIds = (comment.mentions ?? []).map((m) => m.userId);
  const [editMentionIds, setEditMentionIds] = useState<string[]>(storedMentionIds);
```

In `saveEdit`, replace:

```tsx
        body: JSON.stringify({ content: editText.trim() }),
```

with:

```tsx
        body: JSON.stringify({ content: editText.trim(), mentions: editMentionIds }),
```

Replace the edit input:

```tsx
            <input
              type="text"
              value={editText}
              autoFocus
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') setIsEditing(false); }}
              className="w-full rounded-lg border border-stiko-border bg-white px-2.5 py-1.5 text-[12.5px] text-stiko-ink focus:border-stiko-primary focus:ring-1 focus:ring-stiko-primary outline-none"
            />
```

with:

```tsx
            <MentionInput
              value={editText}
              onChange={setEditText}
              mentionIds={editMentionIds}
              onMentionIdsChange={setEditMentionIds}
              people={people}
              placement="below"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') setIsEditing(false); }}
              className="w-full rounded-lg border border-stiko-border bg-white px-2.5 py-1.5 text-[12.5px] text-stiko-ink focus:border-stiko-primary focus:ring-1 focus:ring-stiko-primary outline-none"
            />
```

Replace the Cancel button's handler:

```tsx
              <button onClick={() => { setIsEditing(false); setEditText(comment.content); }} className="text-[11px] font-semibold text-stiko-muted hover:text-stiko-secondary">Cancel</button>
```

with:

```tsx
              <button onClick={() => { setIsEditing(false); setEditText(comment.content); setEditMentionIds(storedMentionIds); }} className="text-[11px] font-semibold text-stiko-muted hover:text-stiko-secondary">Cancel</button>
```

Replace the body paragraph:

```tsx
          <p className="text-[12.5px] leading-[1.5] text-[#4A4F63]">{comment.content}</p>
```

with:

```tsx
          <p className="text-[12.5px] leading-[1.5] text-[#4A4F63]">
            <MentionText content={comment.content} mentions={comment.mentions} currentUserId={currentUserId} />
          </p>
```

Replace the Edit button's handler:

```tsx
              <button onClick={(e) => { e.stopPropagation(); setIsEditing(true); setEditText(comment.content); }} className="text-[11px] font-semibold text-stiko-muted hover:text-stiko-secondary transition-colors">Edit</button>
```

with:

```tsx
              <button onClick={(e) => { e.stopPropagation(); setIsEditing(true); setEditText(comment.content); setEditMentionIds(storedMentionIds); }} className="text-[11px] font-semibold text-stiko-muted hover:text-stiko-secondary transition-colors">Edit</button>
```

In the inline reply form, replace:

```tsx
            placeholder={`Reply to ${comment.author}...`}
            autoFocus
          />
```

with:

```tsx
            placeholder={`Reply to ${comment.author}...`}
            autoFocus
            people={people}
          />
```

In the nested replies' `<CommentItem>`, replace:

```tsx
              currentUserId={currentUserId}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

with:

```tsx
              currentUserId={currentUserId}
              onChanged={onChanged}
              people={people}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `CommentsPanel.tsx` — the main panel**

Replace the component signature:

```tsx
export default function CommentsPanel({ fileId, onCommentClick, activeCommentId, refreshKey, collapsed, onToggleCollapse, composer, onViewImage, onCommentsChanged }: CommentsPanelProps) {
```

with:

```tsx
export default function CommentsPanel({ fileId, onCommentClick, activeCommentId, refreshKey, collapsed, onToggleCollapse, composer, onViewImage, onCommentsChanged, mentionable }: CommentsPanelProps) {
```

In the top-level `<CommentItem>` (inside `topLevelComments.map`), replace:

```tsx
              currentUserId={currentUserId}
              onChanged={onCommentsChanged}
            />
```

with:

```tsx
              currentUserId={currentUserId}
              onChanged={onCommentsChanged}
              people={mentionable ?? []}
            />
```

- [ ] **Step 5: `CommentComposer.tsx`**

Replace the React import:

```tsx
import React, { useRef, useMemo, useEffect } from 'react';
```

with:

```tsx
import React, { useRef, useMemo, useEffect } from 'react';
import MentionInput from '@/components/portal/MentionInput';
import type { MentionablePerson } from '@/lib/mentions';
```

In `interface CommentComposerProps`, after `onTextChange: (t: string) => void;` add:

```tsx
  /** Who can be @mentioned on the open file, and who has been picked so far. */
  people: MentionablePerson[];
  mentionIds: string[];
  onMentionIdsChange: (ids: string[]) => void;
```

Replace the destructuring:

```tsx
  text, onTextChange, pendingFiles, onFilesChange, onAnnotateFile,
  tagging, hasTag, onClearTag, onSubmit, submitting, inputRef,
```

with:

```tsx
  text, onTextChange, people, mentionIds, onMentionIdsChange,
  pendingFiles, onFilesChange, onAnnotateFile,
  tagging, hasTag, onClearTag, onSubmit, submitting, inputRef,
```

Replace the text input:

```tsx
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder="Add a comment…"
        className="w-full bg-transparent border-0 p-0 text-[12.5px] text-stiko-ink placeholder:text-stiko-faint outline-none"
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) onSubmit(); } }}
      />
```

with:

```tsx
      <MentionInput
        inputRef={inputRef}
        value={text}
        onChange={onTextChange}
        mentionIds={mentionIds}
        onMentionIdsChange={onMentionIdsChange}
        people={people}
        placement="above"
        placeholder="Add a comment…"
        className="w-full bg-transparent border-0 p-0 text-[12.5px] text-stiko-ink placeholder:text-stiko-faint outline-none"
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) onSubmit(); } }}
      />
```

- [ ] **Step 6: `app/portal/[id]/page.tsx`**

After the import `import { messageForStatus } from '@/lib/submitErrors';` add:

```tsx
import { useMentionable } from '@/lib/useMentionable';
```

Replace:

```tsx
  const [composerText, setComposerText] = useState('');
```

with:

```tsx
  const [composerText, setComposerText] = useState('');
  // Ids picked in the composer's @ list. Lives beside the text because the two
  // are sent, and cleared, together.
  const [composerMentions, setComposerMentions] = useState<string[]>([]);
  // One list per open file, shared by the composer and every reply and edit
  // box in the panel. A viewer cannot comment, so nothing is fetched for one.
  const mentionable = useMentionable(canComment ? selectedFileId : null, participantsRefreshKey);
```

(`canComment` and `participantsRefreshKey` are both declared above this line. If `tsc` reports either as used before declaration, move these three lines to directly below whichever is declared later.)

In the reset effect that runs when the selected file changes, replace:

```tsx
    setComposerText('');
    setComposerFiles([]);
    setPendingTag(null);
    setTagging(false);
    setTransformMode(null);
```

with:

```tsx
    setComposerText('');
    setComposerMentions([]);
    setComposerFiles([]);
    setPendingTag(null);
    setTagging(false);
    setTransformMode(null);
```

In `handleComposerSubmit`, replace:

```tsx
          timestamp: pendingTag?.timestamp ?? null,
          attachments,
        }),
```

with:

```tsx
          timestamp: pendingTag?.timestamp ?? null,
          attachments,
          mentions: composerMentions,
        }),
```

and replace:

```tsx
      setComposerText('');
      setComposerFiles([]);
      setPendingTag(null);
      setTagging(false);
      setCommentsRefreshKey((k) => k + 1);
```

with:

```tsx
      setComposerText('');
      setComposerMentions([]);
      setComposerFiles([]);
      setPendingTag(null);
      setTagging(false);
      setCommentsRefreshKey((k) => k + 1);
```

In the JSX, replace:

```tsx
          onViewImage={setViewportImage}
          onCommentsChanged={() => setCommentsRefreshKey((k) => k + 1)}
          composer={
```

with:

```tsx
          onViewImage={setViewportImage}
          onCommentsChanged={() => setCommentsRefreshKey((k) => k + 1)}
          mentionable={mentionable}
          composer={
```

and replace:

```tsx
            <CommentComposer
              text={composerText}
              onTextChange={setComposerText}
```

with:

```tsx
            <CommentComposer
              text={composerText}
              onTextChange={setComposerText}
              people={mentionable}
              mentionIds={composerMentions}
              onMentionIdsChange={setComposerMentions}
```

- [ ] **Step 7: Run the project checks and a production build**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: clean, and the build completes. (`handleComposerSubmit` is a plain function, not a `useCallback`, so `composerMentions` needs no dependency array entry.)

- [ ] **Step 8: Commit**

```bash
git add components/portal/CommentsPanel.tsx components/portal/CommentComposer.tsx "app/portal/[id]/page.tsx"
git commit -m "feat(mentions): @ picker in composer, replies and edits; pills in comments

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Open a mention link on the right comment

**Files:**
- Modify: `app/portal/[id]/page.tsx` (state near line 298, `loadVersions` near line 1039, `fetchFiles` near line 1169)

**Interfaces:**
- Consumes: `parsePortalDeepLink`, `PortalDeepLink` from `@/lib/portalDeepLink`.
- Produces: `/portal/<id>?submission=<versionId>&file=<fileId>&comment=<commentId>` opens that file with that comment highlighted.

How it works: the link is read once, the first time versions load. `loadVersions` uses it to choose the version; `fetchFiles` takes it (one shot) and uses it to choose the file and the active comment. `CommentsPanel` already scrolls to and outlines `activeCommentId` once that file's comments land, so nothing here scrolls.

- [ ] **Step 1: Add the ref**

Add to the imports:

```tsx
import { parsePortalDeepLink, type PortalDeepLink } from '@/lib/portalDeepLink';
```

Replace:

```tsx
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
```

with:

```tsx
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  // A notification link: ?submission=&file=&comment=. `undefined` means not
  // read yet; `null` means there is none, or it has been used. It is read from
  // window.location rather than useSearchParams because it is wanted exactly
  // once, inside a callback that only ever runs in the browser.
  const deepLinkRef = useRef<PortalDeepLink | null | undefined>(undefined);
```

- [ ] **Step 2: Choose the version in `loadVersions`**

Replace:

```tsx
      const data: Version[] = await res.json();
      setVersions(data);
      if (data.length > 0) {
        setSelectedVersionId((current) =>
          current && data.some((v) => v.id === current) ? current : data[0].id
        );
      }
```

with:

```tsx
      const data: Version[] = await res.json();
      setVersions(data);
      if (deepLinkRef.current === undefined) {
        deepLinkRef.current = parsePortalDeepLink(window.location.search);
      }
      // A link to something this person cannot see, or that is gone, is
      // dropped whole and the page opens as it always has. Never half-honoured.
      if (deepLinkRef.current && !data.some((v) => v.id === deepLinkRef.current?.versionId)) {
        deepLinkRef.current = null;
      }
      const linkedVersionId = deepLinkRef.current?.versionId ?? null;
      if (data.length > 0) {
        setSelectedVersionId((current) =>
          linkedVersionId ?? (current && data.some((v) => v.id === current) ? current : data[0].id)
        );
      }
```

- [ ] **Step 3: Choose the file and the comment in `fetchFiles`**

Replace:

```tsx
      const background = options?.background === true;
      if (!background) setFilesLoading(true);
      try {
        const res = await fetch(`/api/files?versionId=${versionId}`);
```

with:

```tsx
      const background = options?.background === true;
      if (!background) setFilesLoading(true);
      // Taken before the request, whatever its outcome. A link left pending
      // after a failed fetch would make every later poll of loadVersions drag
      // the user back to this version.
      const link =
        deepLinkRef.current && deepLinkRef.current.versionId === versionId
          ? deepLinkRef.current
          : null;
      if (link) deepLinkRef.current = null;
      try {
        const res = await fetch(`/api/files?versionId=${versionId}`);
```

Replace:

```tsx
          setSelectedFileId((current) =>
            current && data.some((f) => f.id === current) ? current : data[0].id
          );
        } else {
          setSelectedFileId(null);
        }
```

with:

```tsx
          const linkedFileId =
            link && data.some((f) => f.id === link.fileId) ? link.fileId : null;
          setSelectedFileId((current) =>
            linkedFileId ?? (current && data.some((f) => f.id === current) ? current : data[0].id)
          );
          // CommentsPanel owns the scroll and the outline, and retries once this
          // file's comments have loaded — never scrollIntoView from here.
          if (linkedFileId && link?.commentId) {
            setActiveCommentId(link.commentId);
            setCommentsCollapsed(false);
          }
        } else {
          setSelectedFileId(null);
        }
```

`fetchFiles` keeps its empty dependency array: it only reads a ref and calls state setters, which are stable.

- [ ] **Step 4: Run the project checks and a production build**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: clean. If lint reports `react-hooks/exhaustive-deps` on `fetchFiles`, the cause is something other than the ref or the setters; do not add `deepLinkRef` to the array.

- [ ] **Step 5: Commit**

```bash
git add "app/portal/[id]/page.tsx"
git commit -m "feat(mentions): a mention link opens its file and highlights its comment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Invite suggestions endpoint

**Files:**
- Create: `lib/peopleSuggest.ts`
- Create: `app/api/people/suggest/route.ts`
- Test: `scripts/tests/peopleSuggest.test.mjs`

**Interfaces:**
- Consumes: `getPackageAccess` from `@/lib/access`.
- Produces:
  - `MIN_SUGGEST_QUERY: 2`, `MAX_SUGGESTIONS: 8`
  - `escapeLike(q: string): string`
  - `suggestPatterns(raw: string): { prefix: string; word: string } | null`
  - `looksLikeEmail(value: string): boolean`
  - `GET /api/people/suggest?portalId=&q=` → `{ name: string | null; email: string; company: string | null }[]` (at most 8); 401 / 400 / 403

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/peopleSuggest.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeLike, suggestPatterns, looksLikeEmail } from '../../lib/peopleSuggest.ts';

// Unescaped, a "%" typed into the invite field matches every connection and a
// "_" matches any single character.
test('escapeLike neutralises the three characters ILIKE treats specially', () => {
  assert.equal(escapeLike('50%_'), '50\\%\\_');
  assert.equal(escapeLike('a\\b'), 'a\\\\b');
  assert.equal(escapeLike('plain'), 'plain');
});

test('suggestPatterns needs two characters after trimming', () => {
  assert.equal(suggestPatterns(''), null);
  assert.equal(suggestPatterns('d'), null);
  assert.equal(suggestPatterns('  d  '), null);
});

test('suggestPatterns builds a prefix pattern and a word-prefix pattern', () => {
  assert.deepEqual(suggestPatterns('  da '), { prefix: 'da%', word: '% da%' });
  assert.deepEqual(suggestPatterns('%%'), { prefix: '\\%\\%%', word: '% \\%\\%%' });
});

test('looksLikeEmail accepts an address and refuses a half-typed name', () => {
  assert.equal(looksLikeEmail('dana@consultant.com'), true);
  assert.equal(looksLikeEmail('  dana@consultant.com  '), true);
  assert.equal(looksLikeEmail('dana'), false);
  assert.equal(looksLikeEmail('dana@'), false);
  assert.equal(looksLikeEmail('dana@consultant'), false);
  assert.equal(looksLikeEmail('dana lee@consultant.com'), false);
  assert.equal(looksLikeEmail(''), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/tests/peopleSuggest.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/peopleSuggest.ts`.

- [ ] **Step 3: Write `lib/peopleSuggest.ts`**

```ts
/**
 * Invite autocomplete — the pure parts. No imports, so `node --test` can load
 * it.
 */

/** Fewer characters than this would list a whole address book one letter at a time. */
export const MIN_SUGGEST_QUERY = 2;
export const MAX_SUGGESTIONS = 8;

/** Escape what ILIKE treats specially, so typed text only ever matches itself. */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The two ILIKE patterns a query is searched with: a prefix of the whole
 * value (an email, or a name from its start) and a prefix of any later word in
 * a name. Null when the query is too short to search.
 */
export function suggestPatterns(raw: string): { prefix: string; word: string } | null {
  const q = raw.trim();
  if (q.length < MIN_SUGGEST_QUERY) return null;
  const escaped = escapeLike(q);
  return { prefix: `${escaped}%`, word: `% ${escaped}%` };
}

/** Shaped like an address. Stops a half-typed name being sent as an invite. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/tests/peopleSuggest.test.mjs`
Expected: PASS, 0 failures.

- [ ] **Step 5: Write `app/api/people/suggest/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPackageAccess } from '@/lib/access';
import { MAX_SUGGESTIONS, suggestPatterns } from '@/lib/peopleSuggest';

/**
 * People the caller could invite to this package without retyping an address.
 *
 * Only ever the caller's own connections: anyone who stands beside them on a
 * package they can open — its participants, and the owner and coordinators of
 * its project. Nobody is suggested whom the caller could not already come
 * across in the product, so this cannot be used to browse Stiko's users.
 *
 * Gated exactly like sending an invite. Someone who may not invite to this
 * package has no reason to search for invitees.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const portalId = request.nextUrl.searchParams.get('portalId');
  if (!portalId) {
    return NextResponse.json({ error: 'portalId required' }, { status: 400 });
  }

  const access = await getPackageAccess(userId, portalId);
  if (!access?.canManagePeople) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const patterns = suggestPatterns(request.nextUrl.searchParams.get('q') ?? '');
  if (!patterns) return NextResponse.json([]);

  // `visible` is visiblePackageIds() from lib/access.ts written as a CTE, so
  // the whole answer is one round trip. If that function's rule changes, this
  // must change with it.
  //
  // `already` is everyone who can open the target package today: suggesting
  // them would only produce a redundant invitation.
  const rows = await sql`
    WITH visible AS (
      SELECT DISTINCT po.id AS portal_id, po.project_id, pr.owner_id
      FROM portals po
      JOIN projects pr ON pr.id = po.project_id
      LEFT JOIN project_members pm
        ON pm.project_id = pr.id AND pm.user_id = ${userId}
      LEFT JOIN participants pa
        ON pa.portal_id = po.id AND pa.user_id = ${userId}
      WHERE po.deleted_at IS NULL
        AND pr.deleted_at IS NULL
        AND (pr.owner_id = ${userId} OR pm.user_id IS NOT NULL OR pa.user_id IS NOT NULL)
    ),
    connections AS (
      SELECT pa.user_id FROM participants pa JOIN visible v ON v.portal_id = pa.portal_id
      UNION
      SELECT v.owner_id FROM visible v
      UNION
      SELECT pm.user_id FROM project_members pm JOIN visible v ON v.project_id = pm.project_id
    ),
    already AS (
      SELECT pa.user_id FROM participants pa WHERE pa.portal_id = ${portalId}
      UNION
      SELECT pr.owner_id
      FROM portals po JOIN projects pr ON pr.id = po.project_id
      WHERE po.id = ${portalId}
      UNION
      SELECT pm.user_id
      FROM portals po JOIN project_members pm ON pm.project_id = po.project_id
      WHERE po.id = ${portalId}
    )
    SELECT u.name, u.email, u.company
    FROM users u
    WHERE u.id IN (SELECT user_id FROM connections WHERE user_id IS NOT NULL)
      AND u.id NOT IN (SELECT user_id FROM already WHERE user_id IS NOT NULL)
      AND u.id <> ${userId}
      AND (
        u.email ILIKE ${patterns.prefix}
        OR u.name ILIKE ${patterns.prefix}
        OR u.name ILIKE ${patterns.word}
      )
    ORDER BY u.name NULLS LAST, u.email
    LIMIT ${MAX_SUGGESTIONS}
  `;

  // An allowlist of fields, and no user ids: the field only needs something to
  // show and an address to fill in.
  return NextResponse.json(
    rows.map((r) => ({
      name: (r.name as string | null) ?? null,
      email: r.email as string,
      company: (r.company as string | null) ?? null,
    }))
  );
}
```

- [ ] **Step 6: Run the project checks**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/peopleSuggest.ts scripts/tests/peopleSuggest.test.mjs app/api/people/suggest/route.ts
git commit -m "feat(invite): suggest existing connections to an inviter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The invite field

**Files:**
- Create: `components/portal/InviteeInput.tsx`
- Modify: `components/portal/ShareModal.tsx` (imports, `handleInvite`, the "Invite someone" input and Send button)

**Interfaces:**
- Consumes: `GET /api/people/suggest` and `MIN_SUGGEST_QUERY`, `looksLikeEmail` from Task 7; `mentionLabel` from `@/lib/mentions`; `getInitials` from `@/lib/initials`.
- Produces: `<InviteeInput portalId value onChange className? />` (default export).

- [ ] **Step 1: Write `components/portal/InviteeInput.tsx`**

```tsx
'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { getInitials } from '@/lib/initials';
import { mentionLabel } from '@/lib/mentions';
import { MIN_SUGGEST_QUERY } from '@/lib/peopleSuggest';

interface Suggestion {
  name: string | null;
  email: string;
  company: string | null;
}

/**
 * The invite field: type a name or an email, pick a person you already work
 * with, or just type a new address.
 *
 * A pick only fills the field in. It stays editable afterwards — a suggestion
 * is a default, never a lock. With no matches, or if the lookup fails, this is
 * a plain text box and inviting works exactly as it did.
 */
export default function InviteeInput({
  portalId,
  value,
  onChange,
  className,
}: {
  portalId: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [focused, setFocused] = useState(false);
  // The address a pick just wrote into the field. Without it that address is
  // searched in turn, matches the same person, and reopens the list on the row
  // that was just chosen.
  const pickedRef = useRef<string | null>(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < MIN_SUGGEST_QUERY || q === pickedRef.current) {
      setSuggestions([]);
      return;
    }
    pickedRef.current = null;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(
        `/api/people/suggest?portalId=${encodeURIComponent(portalId)}&q=${encodeURIComponent(q)}`,
        { signal: controller.signal }
      )
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          setSuggestions(Array.isArray(data) ? data : []);
          setHighlight(0);
        })
        .catch(() => {
          // An aborted request was simply outrun by the next keystroke.
          if (!controller.signal.aborted) setSuggestions([]);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, portalId]);

  const open = focused && suggestions.length > 0;
  const current = Math.min(highlight, suggestions.length - 1);

  const pick = (s: Suggestion) => {
    pickedRef.current = s.email;
    onChange(s.email);
    setSuggestions([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((current + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((current - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(suggestions[current]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // The modal closes on a document-level Escape listener, and React is
      // hydrated onto `document` too, so stopPropagation() would not stop it.
      // The first Escape closes the list; the next one closes the modal.
      e.nativeEvent.stopImmediatePropagation();
      setSuggestions([]);
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input
        type="text"
        inputMode="email"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        placeholder="Name or email"
        className={className}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${current}` : undefined}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="People you work with"
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-stiko-divider bg-white py-1 shadow-stiko-popover"
        >
          {suggestions.map((s, i) => {
            const label = mentionLabel(s.name, s.email);
            return (
              <li
                key={s.email}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === current}
                // mousedown, not click, and prevented: a click would blur the
                // input first, which closes the list before the click lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 ${
                  i === current ? 'bg-stiko-tint' : ''
                }`}
              >
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-stiko-idle text-[10px] font-extrabold text-stiko-secondary">
                  {getInitials(label)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-bold text-stiko-ink">
                    {label}
                  </span>
                  <span className="block truncate text-[11.5px] text-stiko-muted">
                    {s.company ? `${s.email} · ${s.company}` : s.email}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Use it in `ShareModal.tsx`**

After `import { submissionBadge, submissionTitle } from '@/lib/submissionName';` add:

```tsx
import InviteeInput from '@/components/portal/InviteeInput';
import { looksLikeEmail } from '@/lib/peopleSuggest';
```

In `handleInvite`, replace:

```tsx
    const recipient = email.trim();
    if (!recipient || busy) return;
```

with:

```tsx
    const recipient = email.trim();
    // The field now accepts a name to search by, so a non-empty value is no
    // longer proof of an address.
    if (!looksLikeEmail(recipient) || busy) return;
```

Replace the input:

```tsx
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@email.com"
              className="flex-1 rounded-lg border border-stiko-border bg-white px-3 py-1.5 text-[12.5px] text-stiko-ink focus:border-stiko-primary focus:ring-1 focus:ring-stiko-primary outline-none"
            />
```

with:

```tsx
            <InviteeInput
              portalId={portalId}
              value={email}
              onChange={setEmail}
              className="w-full rounded-lg border border-stiko-border bg-white px-3 py-1.5 text-[12.5px] text-stiko-ink focus:border-stiko-primary focus:ring-1 focus:ring-stiko-primary outline-none"
            />
```

Replace the Send button's `disabled`:

```tsx
            <button onClick={handleInvite} disabled={!email.trim() || busy === 'invite' || inviteScopeEmpty} className="text-white font-bold text-[12.5px] px-4 py-1.5 rounded-lg disabled:opacity-40 transition-[filter] hover:brightness-[0.97]" style={{ background: GRADIENT }}>
```

with:

```tsx
            <button onClick={handleInvite} disabled={!looksLikeEmail(email) || busy === 'invite' || inviteScopeEmpty} className="text-white font-bold text-[12.5px] px-4 py-1.5 rounded-lg disabled:opacity-40 transition-[filter] hover:brightness-[0.97]" style={{ background: GRADIENT }}>
```

- [ ] **Step 3: Run the project checks and a production build**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: clean, and the build completes.

- [ ] **Step 4: Commit**

```bash
git add components/portal/InviteeInput.tsx components/portal/ShareModal.tsx
git commit -m "feat(invite): pick an existing connection in the Share package window

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Migration, live verification and rollout

Production is the only environment and this sandbox cannot read `.env.local`, so every database command in this task is run **by the user**, in a terminal opened in the project folder (`/Users/user/Desktop/STIKO-main`). Hand each one over as a single paste block and wait for the output. Do not `source .env.local` and do not paraphrase the command below: an unquoted connection string in zsh has leaked the database password twice.

**Files:** none changed, unless verification finds a defect.

- [ ] **Step 1: Confirm the branch is clean and complete**

Run: `git status --short && git log --oneline main..HEAD`
Expected: only the four untracked handoff directories, and the branch's commits: the spec, the plan and its corrections, each task, and the review fixes (about two dozen).

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: clean.

- [ ] **Step 2: Ask the user to check which migrations are applied (dry run)**

```bash
cd /Users/user/Desktop/STIKO-main && DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" npm run migrate -- --dry 2>&1 | sed -E 's#postgres(ql)?://[^ ]*#<redacted-url>#g'
```

Expected: `016-comment-mentions.sql` listed as outstanding and nothing else unexpected. If any earlier migration is also outstanding, stop and tell the user before going further.

- [ ] **Step 3: Ask the user to apply migration 016**

```bash
cd /Users/user/Desktop/STIKO-main && DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')" npm run migrate 2>&1 | sed -E 's#postgres(ql)?://[^ ]*#<redacted-url>#g'
```

Expected: `016-comment-mentions.sql` applied, 1 statement. The column is additive and defaulted, so the code currently live in production is unaffected.

- [ ] **Step 4: Browser pass against the local dev server**

Run `npm run dev` and open the app signed in as an account that owns a package with at least two other participants, one of them a commenter scoped to a single submission.

This runs against the production database. **Mention only accounts you control.** A mention of a real collaborator leaves them a permanent "mentioned you" notification: deleting the test comment does not remove it, and there is no way to delete a notification. If outbound email has been fixed by then, they would also get an email, and its link would point at whatever `NEXTAUTH_URL` or `APP_URL` is set in `.env.local`.

Mentions:
1. In the composer type `@`. A list opens above the box with the other people on the package and not you. Type two letters: it filters.
2. Arrow down, Enter. The name is inserted with a trailing space and the comment is **not** sent. Enter again sends it.
3. The comment shows `@Name` as a pill. Signed in as the mentioned person, the pill is solid.
4. Type `@`, press Escape. The list closes, the text stays, and nothing else on the page reacts.
5. Open a file in a submission the scoped commenter cannot see and type `@`. They are not in the list.
6. Reply to a comment and edit a comment: the list opens below the box in both and works the same way.
7. Edit a comment that mentions one person, add a second, save. Only the second person gets a new notification.
8. As the mentioned person, open the dashboard: the package shows the mention badge. Click the notification: the package opens on that file with that comment outlined and scrolled into view. Go back to the dashboard: the badge is gone.
8a. Get mentioned again, then open the package from its card instead of the notification, and go back: the badge is gone that way too.
8b. Mention someone inside a reply, and open that notification: the reply itself is outlined, not just its thread.
8c. Pick one person from the list, delete the name, pick a different person whose name starts the same way (if two such people exist): only the second is notified.
9. Mute the package as the mentioned person, get mentioned again: no notification.

Invite autocomplete:
10. Open Share package. The field reads "Name or email". Type two letters of the name of someone you share another package with: they appear with their email and company.
10a. Signed in as someone who is only a guest (commenter) on another person's package and owns a project of their own: in their own Share package window, typing the other project's owner's name suggests nobody, while typing a fellow participant's name from that package does.
11. Click them: the field holds their email, the list closes and does not reopen, and Send is enabled. The field is still editable.
12. Type `%%`: no results. Type a name of someone already on this package: not suggested.
13. Type a brand-new address in full and send it: the invitation goes out exactly as before.
14. With the list open press Escape: the list closes and the modal stays. Escape again closes the modal.
15. Type a name with no `@`: Send stays disabled.

- [ ] **Step 5: Server-side checks the UI cannot show**

Signed in to the local dev server in a browser, from the DevTools console on a package page (replace the ids):

```js
// A forged id for someone who cannot open this file must be dropped.
await (await fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fileId: 'FILE_ID', content: 'hello @Somebody Else', mentions: ['USER_ID_NOT_ON_PACKAGE'] }) })).json();
```

Expected: the response has `mentions: []`.

```js
// A commenter (not an owner or coordinator) must not be able to search.
await (await fetch('/api/people/suggest?portalId=PORTAL_ID&q=an')).status;
```

Expected, signed in as a commenter: `403`. Signed in as the owner: `200`.

Delete the test comment afterwards.

- [ ] **Step 6: Report, then merge and push only when the user says so**

Report what was verified and anything that was not. Pushing `main` deploys to production, so it needs the user's explicit go-ahead. When given:

```bash
git checkout main && git merge --no-ff feature/mentions-and-invite-autocomplete -m "merge: @mentions in comments and invite autocomplete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push
```

After the push, on the live site: open a thread, then post, edit and delete a comment that has an attachment, and confirm all three work. Check the host's function logs for lines starting `[mentions]`. Confirm `NEXTAUTH_URL` or `APP_URL` is set in production: without one, mention emails are skipped (and logged), and `NEXTAUTH_URL` is likely to disappear when NextAuth is removed.

**Rollback:** `git revert -m 1 <merge commit>` and push. The `mentions` column and any `mention` notifications already written are harmless to the previous code, though a mention badge written before the revert can then only be cleared from its row in the Activity rail.

**If the code is ever deployed before migration 016:** run the migration; do not revert. The comment routes add the column themselves on first use when the database role may alter tables. If it may not, comments still load and post (without attachments, video timestamps or mentions) but editing a comment fails until the migration is applied.

**Known limitation to state in the report:** outbound email is currently rejected by Resend (missing DKIM record), so mention emails will not arrive until that is fixed. In-app notifications and the dashboard badge do not depend on it.
