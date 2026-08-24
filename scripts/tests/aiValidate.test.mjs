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
