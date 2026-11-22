import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  limitsEnforced,
  canCreateProject,
  canAddPackage,
  canAddBytes,
  isPlanLimitPayload,
  isDeclaredFileSize,
} from '../../lib/planLimits.ts';
import { billingEnabled } from '../../lib/billing.ts';

const GIB = 1024 ** 3;
const FREE = { maxProjects: 2, maxPackagesPerProject: 2, storageBytes: 2 * GIB };
const STANDARD = { maxProjects: null, maxPackagesPerProject: null, storageBytes: 100 * GIB };

test('limits follow the billing kill switch', () => {
  assert.equal(limitsEnforced({}), false);
  assert.equal(limitsEnforced({ BILLING_ENABLED: 'true' }), false);
  assert.equal(limitsEnforced({ BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_x' }), true);
});

// limitsEnforced duplicates billingEnabled rather than importing it (to keep
// lib/planLimits.ts free of value imports). If the two ever disagree, limits
// could be on while nobody can pay to lift them, or off while billing charges.
test('limitsEnforced never drifts from billingEnabled', () => {
  for (const BILLING_ENABLED of ['true', undefined]) {
    for (const STRIPE_SECRET_KEY of ['sk_test_x', undefined]) {
      const env = {};
      if (BILLING_ENABLED !== undefined) env.BILLING_ENABLED = BILLING_ENABLED;
      if (STRIPE_SECRET_KEY !== undefined) env.STRIPE_SECRET_KEY = STRIPE_SECRET_KEY;
      assert.equal(
        limitsEnforced(env),
        billingEnabled(env),
        `BILLING_ENABLED=${BILLING_ENABLED} STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY ? 'set' : 'absent'}`
      );
    }
  }
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

test('Free allows a 1st and 2nd package in a project, refuses the 3rd', () => {
  assert.equal(canAddPackage(FREE, 0), true);
  assert.equal(canAddPackage(FREE, 1), true);
  assert.equal(canAddPackage(FREE, 2), false);
  // Over the limit already (packages from before the limit existed): still refused.
  assert.equal(canAddPackage(FREE, 7), false);
});

test('Standard never refuses a package', () => {
  assert.equal(canAddPackage(STANDARD, 0), true);
  assert.equal(canAddPackage(STANDARD, 10_000), true);
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
  assert.equal(
    isPlanLimitPayload({ code: 'plan_limit', limit: 'packages', plan: 'free', isOwner: true, used: 2, max: 2, adding: 1, error: 'x' }),
    true
  );
  assert.equal(isPlanLimitPayload({ code: 'plan_limit', limit: 'seats' }), false);
  assert.equal(isPlanLimitPayload({ error: 'Forbidden' }), false);
  assert.equal(isPlanLimitPayload(null), false);
});

test('a declared file size may be zero: empty files uploaded before limits and still must', () => {
  assert.equal(isDeclaredFileSize(0), true);
  assert.equal(isDeclaredFileSize(1), true);
  assert.equal(isDeclaredFileSize(Number.MAX_SAFE_INTEGER), true);
  assert.equal(isDeclaredFileSize(-1), false);
  assert.equal(isDeclaredFileSize(1.5), false);
  assert.equal(isDeclaredFileSize(Number.NaN), false);
  assert.equal(isDeclaredFileSize(Number.MAX_SAFE_INTEGER + 1), false);
  assert.equal(isDeclaredFileSize('10'), false);
  assert.equal(isDeclaredFileSize(undefined), false);
  assert.equal(isDeclaredFileSize(null), false);
});

test('a zero-byte file passes the storage check even at the limit', () => {
  assert.equal(canAddBytes(FREE, 2 * GIB, 0), true);
});
