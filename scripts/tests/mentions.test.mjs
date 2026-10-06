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
  // Punctuation ends it — including the curly apostrophe phones and Macs type.
  assert.equal(hasMention("@Jane's idea", 'Jane'), true);
  assert.equal(hasMention("@Jane's idea", 'Jane'), true);
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
