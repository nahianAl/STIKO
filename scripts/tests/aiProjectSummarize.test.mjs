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
