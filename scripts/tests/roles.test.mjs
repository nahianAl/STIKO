import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_RANK,
  highestRole,
  roleLabel,
  roleTagSpec,
} from '../../lib/roles.ts';

// The two role vocabularies are stored in different tables and must be
// comparable, because a project-level role is derived from whichever is
// strongest across the packages the viewer can see.
test('project roles outrank package roles', () => {
  assert.ok(ROLE_RANK.owner > ROLE_RANK.coordinator);
  assert.ok(ROLE_RANK.coordinator > ROLE_RANK.uploader);
  assert.ok(ROLE_RANK.uploader > ROLE_RANK.commenter);
  assert.ok(ROLE_RANK.commenter > ROLE_RANK.viewer);
});

test('highestRole picks the strongest role across packages', () => {
  assert.equal(highestRole(['viewer', 'uploader', 'commenter']), 'uploader');
  assert.equal(highestRole(['commenter', 'commenter']), 'commenter');
  assert.equal(highestRole(['viewer']), 'viewer');
});

test('highestRole ignores nulls, blanks and unknown roles', () => {
  // An unrecognised role must not win by accident: the database CHECK
  // constraint can gain a value the TypeScript union has not.
  assert.equal(highestRole([null, 'commenter', undefined]), 'commenter');
  assert.equal(highestRole(['reviewer', 'viewer']), 'viewer');
  assert.equal(highestRole([]), null);
  assert.equal(highestRole([null, 'reviewer']), null);
});

test('roleLabel title-cases for the ownership chip', () => {
  assert.equal(roleLabel('commenter'), 'Commenter');
  assert.equal(roleLabel('uploader'), 'Uploader');
  assert.equal(roleLabel(null), '');
});

test('role tag colours match the existing role palette', () => {
  assert.deepEqual(roleTagSpec('owner'), { bg: '#EBE4FD', fg: '#6b4fc4' });
  assert.deepEqual(roleTagSpec('uploader'), { bg: '#EBE4FD', fg: '#6b4fc4' });
  assert.deepEqual(roleTagSpec('coordinator'), { bg: '#F1F3FF', fg: '#5B60FF' });
  assert.deepEqual(roleTagSpec('commenter'), { bg: '#EDFFDA', fg: '#4B7A28' });
  assert.deepEqual(roleTagSpec('viewer'), { bg: '#E2F2FF', fg: '#2f7fc4' });
});

test('an unknown role has no tag rather than a blank one', () => {
  assert.equal(roleTagSpec('reviewer'), null);
  assert.equal(roleTagSpec(null), null);
});
