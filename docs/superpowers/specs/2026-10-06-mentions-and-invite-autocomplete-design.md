# @mentions in comments, and invite autocomplete

**Date:** 2026-10-06
**Status:** Approved, not yet implemented
**Scope:** Two features in one spec. They share no code and can ship separately;
Part 1 needs migration 016, Part 2 needs none.

## Problem

**Mentions.** A comment cannot be addressed to anyone. The notification type
`mention`, the "Someone @mentions me" preference, `mentionEmail` in
`lib/email.ts` and the dashboard's mention badge (`lib/queries.ts`,
`lib/home.ts`) all exist, but nothing has ever written a `mention` row, and the
comment box is a plain `<input>` with no `@` handling. The badge can never light
up.

**Invites.** The "Invite someone" field in the Share package window takes a
typed email and nothing else. Inviting a person you already work with on Stiko
means remembering and retyping their address.

## Decisions

| Question | Decision |
|---|---|
| Who can mention | Anyone who can comment on the file |
| Who can be mentioned | Only people who can open that file: the package's participants plus the project's owner and coordinators, minus anyone whose version scope excludes the file's submission, minus the author. On a draft (unpublished) submission that means the owner, coordinators and uploaders only |
| People elsewhere in the project | Not mentionable. A package is a permission boundary |
| `@everyone` | Not included |
| How a mention is stored | The comment text stays plain (`@Jane Doe`); a new `mentions` column records who |
| Mention on edit | Notifies only people newly added by that edit |
| Where a mention link lands | The package, on that file, with the comment highlighted |
| Who invite autocomplete suggests | Everyone on a package the inviter can open, plus the owner and coordinators of projects the inviter is themselves an owner or coordinator of. Never the owner or coordinators of a project the inviter is only a guest on |
| Inviting a brand-new email | Still works exactly as today |
| Pending (unaccepted) invitees | Not suggested; they have no profile |

**Naming.** In this codebase "tag" and "tagging" already mean placing a pin
(`tagging`, `hasTag`, `pendingTag` in `CommentComposer` and the portal page).
Everything in this feature is named `mention` in code. The user calls it
tagging; the UI needs no label for it beyond the notification's "mentioned you".

---

## Part 1: @mentions

### Data model

New migration `lib/migrations/016-comment-mentions.sql`, mirrored in
`lib/schema.sql`:

```sql
-- Who a comment mentions: [{ "userId": "...", "name": "Jane Doe" }].
-- `name` is the label as it was written into the comment text, so a mention
-- still renders after the person renames themselves or leaves the package.
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]';
```

Additive and defaulted, so existing rows need no backfill and code that predates
it ignores it. The `notifications.type` check already allows `'mention'`.

A column rather than a `comment_mentions` table: the list is only ever read with
its comment, it should die with its comment, and "what mentions me" is already
answered by the `notifications` table.

Rejected: encoding mentions inside the text (`@[Jane Doe](user:abc)`). It needs
no migration, but AI summaries, the Brief, notification excerpts and the
existing comment renderer all read `content` as plain text and would each need
to strip the encoding.

**Forgotten-migration guard.** Migrations here are applied by hand and have been
missed twice. If the comment list query named a column that did not exist, every
comment in production would disappear behind a 500. `ensureCommentColumns()` in
`app/api/comments/route.ts` already adds `attachments` and `timestamp` lazily;
`mentions` joins that list, and `PUT /api/comments/[id]` calls the same guard.
The migration is still the real mechanism; this only bounds the damage.

### Who is mentionable

`lib/mentionable.ts` exports `mentionableUsers(fileId)`. It resolves the file's
package and version, then returns the union of:

- the project owner (`projects.owner_id`),
- coordinators (`project_members` with `role = 'coordinator'`, the only member
  role `getPackageAccess` admits),
- `participants` on the package who are uploaders, and
- commenters and viewers, but only when the file's submission is **published**
  and their scope covers it (`all_versions = TRUE`, or a `participant_versions`
  row names it).

The published condition matters: a draft is visible only to whoever can upload
(`app/api/versions/route.ts`), so a reviewer mentioned on a draft's file would
be emailed its file name and comment text without being shown the draft. The
publish route's recipient query has no such condition only because it runs at
the moment of publication and never meets a draft; mentions do. Each entry is
`{ userId, label, company, role }`. `label` is the user's trimmed `name`,
falling back to the part of their email before the `@` when they have none.

`GET /api/mentionable?fileId=` returns that list without the caller.
`getFileAccess` gates it: no access is 404, and access without `canComment` is
403, since only someone composing a comment needs the list. Emails are not in
the response.

### Saving a comment

`POST /api/comments` and `PUT /api/comments/[id]` accept an optional
`mentions: string[]` of user ids. The server never trusts it:

1. Load `mentionableUsers(fileId)`.
2. Keep an id only if it is in that list **and** an `@` in the content is
   attributed to its label, using the server's label, never a client-supplied
   name. Each `@` goes to the longest label that fits it, as the renderer reads
   it.
3. Deduplicate and store as `[{ userId, name: label }]`.

On `PUT`, a missing `mentions` field means "re-check the stored ones against the
new text", so an edit that deletes `@Jane Doe` drops Jane, and a client that
does not know about mentions cannot leave stale ones behind.

`GET /api/comments` returns `mentions` on every row.

### Notifying

`lib/mentionNotify.ts` exports `notifyMentions({ actor, recipients, fileId,
commentId, content })`. For each recipient:

- **Muted package** (`portal_mutes`): nothing at all. The mute copy already
  promises "No emails or badges, even for @mentions".
- **In-app**: insert a `mention` notification unless their `notification_prefs`
  row for `mention` has `in_app = FALSE`. No row means the default in
  `NOTIFICATION_EVENTS`, which is on.
- **Email**: send `mentionEmail` unless their pref has `email = FALSE` (default
  on) or `email_paused_until` is in the future.

The notification's `title` is `<actor> mentioned you on <filename>`, `excerpt`
is the first 140 characters of the comment, and `href` is
`/portal/<portalId>?submission=<versionId>&file=<fileId>&comment=<commentId>`.
The parameter is `submission`, not `version`: it is the word people see, and
`scripts/tests/copyTerms.test.mjs` fails on a string literal that says
"version". The email link is the same path on `appBaseUrl()`, never the
request's host. Building and parsing the link both live in
`lib/portalDeepLink.ts` so the two ends cannot drift.

Recipients on `POST` are everyone stored in `mentions`. On `PUT` they are the
ids in the new list that were not in the old one.

**Clearing the badge.** The dashboard's mention badge counts unread `mention`
rows per package. Opening a package marks that person's mentions on it read, all of them at
once: it is per package, not per file or per comment, and the rows stay listed
in the Activity rail afterwards
(`PATCH /api/notifications` with `{ portalId }`, fired once by the package
page). Before this, `read_at` was only ever set by clicking the exact row in
the dashboard's Activity rail, so someone who arrived by the package card or
the email link kept a badge for a mention they had already read. Mentions only:
the other notification types on a package are things to act on, not things that
opening it settles. A mention that arrives while the package is already open
stays unread until the next time it is opened.

The comment is already saved when notifying starts. A failure to notify is
logged and swallowed; it must never turn a saved comment into an error response.

**Known limitation:** outbound email is currently rejected by Resend (missing
DKIM record). Until that is fixed, mention emails will not arrive; in-app
notifications and the dashboard badge are unaffected.

### Opening a mention

The portal page does not read query parameters today. It gains a one-time read,
after versions have loaded, of `submission`, `file` and `comment`:

- select that version if it is in the caller's list, then that file,
- set `activeCommentId`, which `CommentsPanel` already scrolls to and
  highlights, and un-collapse the comments panel. Replies are highlighted too
  (`CommentItem` passes `isActive` down to its replies); before this only
  top-level comments were.

Anything missing, malformed or out of the caller's scope is ignored and the page
opens as it does now. Read from `window.location.search` inside the effect
rather than `useSearchParams`: it is a one-time read, and it avoids the Suspense
boundary `useSearchParams` can demand at build time on a page that has none.

### Typing a mention

Pure helpers in `lib/mentions.ts` (no `@/` imports, so `node --test` can load
it):

- `activeMentionQuery(text, caret)` → `{ start, query } | null`. An `@` counts
  when it is at the start or follows whitespace. The query runs from there to
  the caret and may contain spaces, since names do; it ends at 30 characters.
- `insertMention(text, start, caret, label)` → new text and caret, replacing
  `@query` with `@<label>` and a trailing space.
- `reconcileMentions(content, ids, allowed, stored?)` → the server rule above.
  Each `@` in the text is given to the longest label that fits it, the same
  way the renderer reads it, so `@Sam Lee` never also counts as a mention of
  someone called Sam who was picked first and then replaced.
  `stored` is what the comment already held: on an edit, an earlier mention is
  kept while its text is still there, even if that person has since left the
  package.
- `newlyMentioned(before, after)` → ids to notify on edit.
- `filterMentionable(people, query)` → who the list shows for a query.
- `parseMentions(raw)` → the stored column, tolerant of JSON text and garbage.
- `splitMentions(content, mentions)` → text and mention segments for rendering,
  matching longer labels first so `@Jane Doe` is not cut short by `@Jane`.

`components/portal/MentionInput.tsx` wraps the existing single-line `<input>`
and is used in all three places a comment is typed: the composer, the reply box
and the edit box. It takes `value`, `onChange`, `mentions`, `onMentionsChange`
and the people list, and passes through `placeholder`, `className`, `inputRef`
and `onKeyDown`.

- When `activeMentionQuery` is non-null and at least one person matches (prefix
  of any word in the label, case-insensitive), a list opens: initials, label,
  company. It opens above the composer and below a reply or edit box, which
  sit inside the scrolling thread where a list above could be clipped.
  (Initials only: nothing in the app reads `users.image` today.)
- Up/Down move, Enter or Tab or a click picks, Escape closes. While the list is
  open these keys are consumed, so Enter picks a person and does not send the
  comment.
- With no matches the list closes and Enter sends as usual.
- Picking calls `insertMention` and adds the id to `mentions`.
- `role="combobox"` / `listbox` / `option` with `aria-activedescendant`.

The people list is fetched once per file from `/api/mentionable` and shared by
all three inputs. If the fetch fails the inputs behave exactly as they do today.

The composer's text lives in the portal page (`composerText`), so the page gains
`composerMentions` beside it and clears both together after a send.

### Showing a mention

`components/portal/MentionText.tsx` renders a comment body from
`splitMentions`: plain text as now, each mention as an inline pill
(`bg-stiko-primary/10 text-stiko-primary`, rounded, semibold; `stiko-tint` is
almost the comment card's own background and would not read as a pill). A mention of the
signed-in user gets the stronger treatment (solid primary, white text). It
replaces the bare `{comment.content}` in `CommentsPanel`.

A comment with an empty `mentions` list renders exactly as today, so a typed
`@something` that was never picked is just text.

### Edge cases

- **Person removed from the package later.** Their past mentions still render,
  from the stored `name`. Their old notification link answers 404, as any
  package link does once access is gone.
- **Two people with the same label.** Both appear in the list, told apart by
  company. Picking one records only that id.
- **Comment deleted.** The notification survives (notifications are
  denormalised by design) and its link opens the file with nothing highlighted.
- **Scope narrowed after a mention was sent.** Nothing is recalled. The link
  follows the existing rule and 404s.
- **Viewers** cannot comment, so cannot mention, but can be mentioned.

---

## Part 2: Invite autocomplete

### Who can be suggested

A "connection" is someone whose name and email the caller can already see in
Stiko. For every id in `visiblePackageIds(callerId)`:

- that package's `participants`, always: any participant already sees the
  roster, emails included;
- the owner and coordinators of its project, but only when the caller is
  themselves the owner or a member of that project.

The second condition was narrowed during the final review. A guest on one
package sees the owner's name there but not their email, and never sees the
coordinators at all, while this endpoint returns emails. Without the condition,
an outside reviewer who creates a free project of their own (which lets them
call the endpoint) could collect the inviting firm's owner and coordinator
addresses two letters at a time. An address cannot be un-disclosed, and
widening this later is easy. The cost: a guest cannot autocomplete the person
who invited them.

Removed from that set: the caller, everyone already a participant on the target
package, and the target project's owner and coordinators, who have access
already.

### Endpoint

`GET /api/people/suggest?portalId=&q=`

- 401 without a session. 403 unless `getPackageAccess(...).canManagePeople` on
  `portalId`, the same gate as sending an invite. Only someone allowed to invite
  to this package can search at all.
- `q` is trimmed. Under 2 characters returns `[]`.
- Matches where `q` is a prefix of the email, or a prefix of any word in the
  name, case-insensitive. `%`, `_` and `\` in `q` are escaped before it reaches
  `ILIKE`; the escaping is a pure helper in `lib/peopleSuggest.ts` with its own
  test.
- Up to 8 rows ordered by name: `{ name, email, company }`. No user ids.
- `Cache-Control: no-store`, since the response carries addresses.

The set is computed in one query per request. Nothing is cached, so a person
removed from a shared package stops being suggested immediately.

### The field

`components/portal/InviteeInput.tsx` replaces the `type="email"` input in
`ShareModal`, which is the only place an invite email is typed.

- A text input (`inputMode="email"`, `autoComplete="off"`) with the placeholder
  "Name or email". After 2 characters it asks the endpoint, debounced 200 ms,
  aborting any request it has outrun.
- Results drop down under the field: initials, name, email, company. Same
  keyboard model and ARIA roles as `MentionInput`, except that Tab does not
  pick (the modal traps focus with Tab).
- Picking a row writes that person's email into the field. The field stays
  editable afterwards; a suggestion is a default, not a lock.
- No results, or a failed request: no dropdown, and the field is a plain email
  box as it is today.
- Send stays disabled until the field holds something shaped like an email, so
  a half-typed name cannot be submitted. Role, download and submission scope
  controls are untouched, and so is `POST /api/participants`.

---

## Testing

`node --test` (`scripts/tests/*.mjs`), following the repo rule that tested `lib`
modules use no `@/` alias:

- `mentions.test.mjs`: `activeMentionQuery` (start of text, after whitespace,
  mid-word `a@b` is not a mention, spaces in names, the 30-character end),
  `insertMention`, `reconcileMentions` (id not allowed, label no longer in text,
  duplicates), `newlyMentioned`, `splitMentions` (overlapping labels, repeated
  mentions, none).
- `peopleSuggest.test.mjs`: `ILIKE` escaping.

Then `tsc`, lint and the full suite. The database rules (who is mentionable, who
is suggested, mute and preference handling) are verified live, since production
is the only environment:

- a scoped commenter does not appear in the list on a file outside their scope,
  and a forged id for them in `POST /api/comments` is dropped;
- a mention creates one notification, and the dashboard badge shows it;
- a muted package produces none;
- editing to add a second person notifies only the second;
- the notification link opens the right file with the comment highlighted;
- `/api/people/suggest` answers 403 to a commenter, and never returns someone
  from a package the caller is not on.

A browser pass covers the list, keyboard handling, pills and the invite
dropdown.

## Rollout

1. Check `schema_migrations`, apply migration 016 to production.
2. Merge and push; `main` deploys on push.

Rollback is reverting the merge. The `mentions` column and any `mention`
notifications already written are harmless to the previous code.

## Not included

- Mentioning people who are not on the package, or granting access by mention.
- `@everyone` or role mentions.
- Wiring the other dormant events (`comment_reply`, `new_comment`).
- Suggesting pending invitees, or autocomplete anywhere other than the Share
  package window.
