import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signupTypeFor } from '../../lib/attribution.ts';

test('signup type from the resolved signup source', () => {
  assert.equal(signupTypeFor('reviewer_invite'), 'invited_reviewer');
  assert.equal(signupTypeFor('direct'), 'new_workspace');
});
