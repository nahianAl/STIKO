import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilitiesFor } from '../../lib/capabilities.ts';

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
