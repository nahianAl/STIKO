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
