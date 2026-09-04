import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilitiesFor, canDeleteContent } from '../../lib/capabilities.ts';

// Who may reposition an object everyone else reviews. Kept explicit rather than
// derived from canUpload: "may add a file" and "may change how everyone sees an
// existing one" are different powers that will drift apart.
const EXPECTED = {
  owner:       { canComment: true,  canUpload: true,  canTransform: true,  canManagePeople: true  },
  coordinator: { canComment: true,  canUpload: true,  canTransform: true,  canManagePeople: true  },
  uploader:    { canComment: true,  canUpload: true,  canTransform: true,  canManagePeople: false },
  commenter:   { canComment: true,  canUpload: false, canTransform: false, canManagePeople: false },
  viewer:      { canComment: false, canUpload: false, canTransform: false, canManagePeople: false },
};

test('every role gets exactly its documented capabilities', () => {
  for (const [role, expected] of Object.entries(EXPECTED)) {
    assert.deepEqual(capabilitiesFor(role), expected, `role ${role}`);
  }
});

test('only owner, coordinator and uploader can transform', () => {
  const allowed = Object.keys(EXPECTED).filter((r) => capabilitiesFor(r).canTransform);
  assert.deepEqual(allowed.sort(), ['coordinator', 'owner', 'uploader']);
});

test('viewers and commenters cannot transform', () => {
  // Stated separately from the matrix above so the intent survives a careless
  // edit to EXPECTED.
  assert.equal(capabilitiesFor('viewer').canTransform, false);
  assert.equal(capabilitiesFor('commenter').canTransform, false);
});

test('an unrecognised role is denied everything, not left undefined', () => {
  // The database CHECK constraint can gain a role the TypeScript union has not, and it
  // reaches capabilitiesFor through an unchecked cast. Returning undefined would leave the
  // Access object with no capability keys at all — falsy today, but only by accident.
  assert.deepEqual(capabilitiesFor('reviewer'), {
    canComment: false,
    canUpload: false,
    canTransform: false,
    canManagePeople: false,
  });
});

// Deletion rules — docs/superpowers/specs/2026-09-03-content-deletion-design.md.
// Kept as an explicit matrix rather than derived from capabilitiesFor: "may add
// a file" and "may destroy one with other people's comments on it" are
// different powers, and deriving one from the other is how they silently merge.

test('owner and coordinator delete anything, published or not', () => {
  for (const role of ['owner', 'coordinator']) {
    for (const isOwnUpload of [true, false]) {
      for (const isPublished of [true, false]) {
        assert.equal(
          canDeleteContent({ role, isOwnUpload, isPublished }),
          true,
          `${role} own=${isOwnUpload} published=${isPublished}`
        );
      }
    }
  }
});

test('an uploader deletes their own file only while it is unpublished', () => {
  assert.equal(
    canDeleteContent({ role: 'uploader', isOwnUpload: true, isPublished: false }),
    true
  );
});

test('an uploader cannot delete their own file once it is published', () => {
  // The rule most likely to be loosened by accident. Publishing is the moment
  // reviewers can see and comment on the file, and deleting it cascades to
  // their comments and markups.
  assert.equal(
    canDeleteContent({ role: 'uploader', isOwnUpload: true, isPublished: true }),
    false
  );
});

test('an uploader cannot delete someone else\'s file, even in a draft', () => {
  assert.equal(
    canDeleteContent({ role: 'uploader', isOwnUpload: false, isPublished: false }),
    false
  );
});

test('commenters and viewers never delete anything', () => {
  for (const role of ['commenter', 'viewer']) {
    for (const isOwnUpload of [true, false]) {
      for (const isPublished of [true, false]) {
        assert.equal(
          canDeleteContent({ role, isOwnUpload, isPublished }),
          false,
          `${role} own=${isOwnUpload} published=${isPublished}`
        );
      }
    }
  }
});

test('an unrecognised role cannot delete', () => {
  // Same fail-closed guarantee capabilitiesFor makes: the database CHECK
  // constraint can gain a role the TypeScript union has not.
  assert.equal(
    canDeleteContent({ role: 'reviewer', isOwnUpload: true, isPublished: false }),
    false
  );
});
