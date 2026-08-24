import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateVersionBrief } from '../../lib/ai/validate.ts';

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
