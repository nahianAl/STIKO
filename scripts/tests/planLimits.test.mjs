import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  limitsEnforced,
  canCreateProject,
  canAddBytes,
  isPlanLimitPayload,
} from '../../lib/planLimits.ts';

const GIB = 1024 ** 3;
const FREE = { maxProjects: 2, storageBytes: 2 * GIB };
const STANDARD = { maxProjects: null, storageBytes: 100 * GIB };

test('limits follow the billing kill switch', () => {
  assert.equal(limitsEnforced({}), false);
  assert.equal(limitsEnforced({ BILLING_ENABLED: 'true' }), false);
  assert.equal(limitsEnforced({ BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_x' }), true);
});

test('Free allows a 1st and 2nd project, refuses the 3rd', () => {
  assert.equal(canCreateProject(FREE, 0), true);
  assert.equal(canCreateProject(FREE, 1), true);
  assert.equal(canCreateProject(FREE, 2), false);
  assert.equal(canCreateProject(FREE, 5), false);
});

test('Standard never refuses a project', () => {
  assert.equal(canCreateProject(STANDARD, 0), true);
  assert.equal(canCreateProject(STANDARD, 10_000), true);
});

test('storage: exactly at the limit is allowed, one byte over is not', () => {
  assert.equal(canAddBytes(FREE, 0, 2 * GIB), true);
  assert.equal(canAddBytes(FREE, GIB, GIB), true);
  assert.equal(canAddBytes(FREE, GIB, GIB + 1), false);
  assert.equal(canAddBytes(FREE, 3 * GIB, 1), false);
  assert.equal(canAddBytes(STANDARD, 3 * GIB, GIB), true);
});

test('storage: a non-finite or negative claim is refused', () => {
  assert.equal(canAddBytes(FREE, 0, Number.NaN), false);
  assert.equal(canAddBytes(FREE, 0, -1), false);
  assert.equal(canAddBytes(FREE, 0, Number.POSITIVE_INFINITY), false);
});

test('recognises a 402 body and nothing else', () => {
  assert.equal(
    isPlanLimitPayload({ code: 'plan_limit', limit: 'storage', isOwner: true, used: 1, max: 2, adding: 1, error: 'x' }),
    true
  );
  assert.equal(
    isPlanLimitPayload({ code: 'plan_limit', limit: 'storage', plan: 'standard', isOwner: true, used: 1, max: 2, adding: 1, error: 'x' }),
    true
  );
  assert.equal(isPlanLimitPayload({ code: 'plan_limit', limit: 'seats' }), false);
  assert.equal(isPlanLimitPayload({ error: 'Forbidden' }), false);
  assert.equal(isPlanLimitPayload(null), false);
});
