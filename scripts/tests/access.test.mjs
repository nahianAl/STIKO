import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilitiesFor, canDeleteContent, canDownloadFile, canSeeVersion } from '../../lib/capabilities.ts';

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

// Download rules — docs/superpowers/specs/2026-09-04-download-authorization-design.md.
// Kept as an explicit matrix rather than derived from any role table: download
// is not a property of the role alone, it is role plus a per-person grant plus
// whether you supplied the file yourself.

test('owner and coordinator download anything, granted or not', () => {
  for (const role of ['owner', 'coordinator']) {
    for (const isOwnUpload of [true, false]) {
      for (const mayDownload of [true, false]) {
        assert.equal(
          canDownloadFile({ role, isOwnUpload, mayDownload }),
          true,
          `${role} own=${isOwnUpload} granted=${mayDownload}`
        );
      }
    }
  }
});

test('an uploader always gets their own upload back, grant or no grant', () => {
  // They supplied the file; it is already on their machine. Requiring the
  // owner's permission to retrieve it is a rule nobody would expect.
  assert.equal(
    canDownloadFile({ role: 'uploader', isOwnUpload: true, mayDownload: false }),
    true
  );
});

test("an uploader needs the grant for someone else's file", () => {
  assert.equal(
    canDownloadFile({ role: 'uploader', isOwnUpload: false, mayDownload: false }),
    false
  );
  assert.equal(
    canDownloadFile({ role: 'uploader', isOwnUpload: false, mayDownload: true }),
    true
  );
});

test('commenters and viewers download only with the grant', () => {
  for (const role of ['commenter', 'viewer']) {
    assert.equal(
      canDownloadFile({ role, isOwnUpload: false, mayDownload: false }),
      false,
      `${role} without the grant`
    );
    assert.equal(
      canDownloadFile({ role, isOwnUpload: false, mayDownload: true }),
      true,
      `${role} with the grant`
    );
  }
});

test('an unrecognised role cannot download', () => {
  // Same fail-closed guarantee capabilitiesFor and canDeleteContent make.
  assert.equal(
    canDownloadFile({ role: 'reviewer', isOwnUpload: true, mayDownload: true }),
    false
  );
});

test('a commenter or viewer is denied even if isOwnUpload is somehow true', () => {
  // Unreachable in production — capabilitiesFor denies these roles canUpload,
  // so isOwnUpload cannot be true for them. Pinned anyway: without it, an edit
  // that added `isOwnUpload ||` to that branch would pass the whole suite.
  for (const role of ['commenter', 'viewer']) {
    assert.equal(
      canDownloadFile({ role, isOwnUpload: true, mayDownload: false }),
      false,
      `${role} with a bogus own-upload claim`
    );
  }
});

// Version scoping — docs/superpowers/specs/2026-09-04-version-scoped-invites-design.md.
// Trivial logic deliberately given its own home: the rule needs one place to be
// read and one place to be asserted, because a dozen routes depend on it.

test("'all' sees every version, including ones that did not exist yet", () => {
  // The whole point of 'all' rather than an enumerated list: a version
  // published tomorrow is covered without anyone updating a row.
  assert.equal(canSeeVersion('all', 'v1'), true);
  assert.equal(canSeeVersion('all', 'a-version-nobody-has-created'), true);
});

test('a list sees exactly its members', () => {
  assert.equal(canSeeVersion(['v1', 'v2'], 'v1'), true);
  assert.equal(canSeeVersion(['v1', 'v2'], 'v2'), true);
  assert.equal(canSeeVersion(['v1', 'v2'], 'v3'), false);
});

test('an empty list sees nothing', () => {
  // Reachable: deleting a version cascades its scope rows away, so someone
  // scoped to one deleted version ends up here. Seeing nothing is correct.
  assert.equal(canSeeVersion([], 'v1'), false);
});
