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
 * whitespace and punctuation: `@Jane,` and `@Jane's` end the name, while
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
  /[\s!-\/:-@\[-^`{-~\u00A0-\u00BF\u2000-\u206F\u3000-\u303F\uFF00-\uFF0F\uFF1A-\uFF20]/;

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

/**
 * Which channels may tell one person they were mentioned.
 *
 * A muted package means neither, whatever their preferences say. Otherwise
 * each channel follows its own preference, where null means they never set
 * one and the default applies. A paused inbox skips the email only.
 */
export function mentionChannels(
  recipient: { muted: boolean; paused: boolean; inApp: boolean | null; email: boolean | null },
  defaults: { inApp: boolean; email: boolean }
): { inApp: boolean; email: boolean } {
  if (recipient.muted) return { inApp: false, email: false };
  const inApp = recipient.inApp ?? defaults.inApp;
  const wantsEmail = recipient.email ?? defaults.email;
  return { inApp, email: wantsEmail && !recipient.paused };
}

/**
 * The start of a comment, for a notification. Counted in characters, not
 * UTF-16 units, so the cut never lands inside an emoji.
 */
export function mentionExcerpt(content: string, max = 140): string {
  const chars = Array.from(content);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : content;
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
