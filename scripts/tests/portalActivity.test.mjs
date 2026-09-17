import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffDigest,
  preserveIfUnchanged,
  feedFilters,
  PORTAL_ENTITIES,
} from '../../lib/portalActivity.ts';

/** A digest with every entity quiet, so each test can move exactly one thing. */
function digest(overrides = {}) {
  return {
    comments: { n: 3, at: '2026-09-17T09:00:00.000Z' },
    participants: { n: 2, at: '2026-09-16T08:00:00.000Z' },
    versions: { n: 1, at: '2026-09-15T08:00:00.000Z' },
    files: { n: 4, at: '2026-09-15T09:00:00.000Z' },
    ...overrides,
  };
}

test('an identical digest reports nothing changed', () => {
  const diff = diffDigest(digest(), digest());
  for (const key of PORTAL_ENTITIES) {
    assert.equal(diff[key], false, `${key} should be quiet`);
  }
});

test('the first poll seeds the baseline and fires nothing', () => {
  // Without this the very first response diffs against nothing and re-fetches
  // all four entities seconds after mount already loaded them.
  const diff = diffDigest(null, digest());
  for (const key of PORTAL_ENTITIES) {
    assert.equal(diff[key], false, `${key} must not fire on the seeding poll`);
  }
});

test('an insert moves both count and stamp', () => {
  const next = digest({ comments: { n: 4, at: '2026-09-17T09:05:00.000Z' } });
  assert.equal(diffDigest(digest(), next).comments, true);
});

test('a delete is caught by the count alone', () => {
  // Comments are hard-deleted, so the stamp can sit still while a row vanishes.
  const next = digest({ comments: { n: 2, at: '2026-09-17T09:00:00.000Z' } });
  assert.equal(diffDigest(digest(), next).comments, true);
});

test('an edit is caught by the stamp alone', () => {
  // An edit rewrites content and leaves created_at alone; edited_at is what moves.
  const next = digest({ comments: { n: 3, at: '2026-09-17T09:07:00.000Z' } });
  assert.equal(diffDigest(digest(), next).comments, true);
});

test('one entity moving does not fire the others', () => {
  const next = digest({ participants: { n: 3, at: '2026-09-17T10:00:00.000Z' } });
  const diff = diffDigest(digest(), next);
  assert.equal(diff.participants, true);
  assert.equal(diff.comments, false);
  assert.equal(diff.versions, false);
  assert.equal(diff.files, false);
});

test('an empty package is quiet, not perpetually changing', () => {
  // MAX() over no rows is NULL. Compared naively that could read as a change
  // on every single poll.
  const empty = digest({ comments: { n: 0, at: null } });
  assert.equal(diffDigest(empty, empty).comments, false);
});

test('a package going from empty to its first comment fires', () => {
  const before = digest({ comments: { n: 0, at: null } });
  const after = digest({ comments: { n: 1, at: '2026-09-17T11:00:00.000Z' } });
  assert.equal(diffDigest(before, after).comments, true);
});

test('preserveIfUnchanged keeps the old reference for equal payloads', () => {
  // Identity, not equality, is the point: pin overlays and the 3D scene
  // re-render on reference change, and a portal-wide comment cursor re-fetches
  // this file's comments whenever anyone comments on any file.
  const prev = [{ id: 'c1', content: 'hi' }];
  const next = [{ id: 'c1', content: 'hi' }];
  assert.strictEqual(preserveIfUnchanged(prev, next), prev);
});

test('preserveIfUnchanged returns the new reference when anything differs', () => {
  const prev = [{ id: 'c1', content: 'hi' }];
  const next = [{ id: 'c1', content: 'hi there' }];
  assert.strictEqual(preserveIfUnchanged(prev, next), next);
});

test('feedFilters lets a publisher see drafts and hides them from a reviewer', () => {
  assert.equal(feedFilters({ canUpload: true, versionScope: 'all' }).includeDrafts, true);
  assert.equal(feedFilters({ canUpload: false, versionScope: 'all' }).includeDrafts, false);
});

test('feedFilters narrows to a scoped reviewer\'s own versions', () => {
  // Counting the whole package would tell a scoped reviewer exactly how much
  // exists outside their scope — the thing the participants route strips its
  // scope fields to avoid.
  assert.deepEqual(feedFilters({ canUpload: false, versionScope: ['v1', 'v2'] }).versionIds, ['v1', 'v2']);
  assert.equal(feedFilters({ canUpload: true, versionScope: 'all' }).versionIds, null);
});

test('feedFilters returns an empty list, not null, for a reviewer scoped to nothing', () => {
  // null means "no restriction". Collapsing an empty scope to null would hand
  // a reviewer with no versions the whole package.
  assert.deepEqual(feedFilters({ canUpload: false, versionScope: [] }).versionIds, []);
});
