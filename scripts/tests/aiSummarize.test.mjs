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
  coverage: { count: 2, maxCreatedAt: '2026-08-23T10:00:00Z' },
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
  assert.equal(out.coveredCount, 2);
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
