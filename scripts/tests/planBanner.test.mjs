import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBannerMessage, NEAR_LIMIT_FRACTION } from '../../lib/upgradeCopy.ts';
import { PLANS } from '../../lib/plans.ts';

const GIB = 1024 ** 3;
const FREE_BYTES = PLANS.free.storageBytes;

const usage = ({ plan = PLANS.free, count = 1, bytes = 0 } = {}) => ({
  plan,
  storage: { projectBytes: bytes, trashBytes: 0, totalBytes: bytes },
  projects: { count, max: plan.maxProjects },
});

test('the near-limit threshold is 80%', () => {
  assert.equal(NEAR_LIMIT_FRACTION, 0.8);
});

test('at 2 of 2 Free projects the banner names the project count', () => {
  assert.equal(planBannerMessage(usage({ count: 2 })), "You're using 2 of 2 Free projects.");
});

test('over the project limit (3 of 2) still shows the project count', () => {
  assert.equal(planBannerMessage(usage({ count: 3 })), "You're using 3 of 2 Free projects.");
});

test('projects win over storage when both are near the limit', () => {
  assert.match(planBannerMessage(usage({ count: 2, bytes: FREE_BYTES })), /Free projects/);
});

test('1 of 2 projects at 79.9% storage shows nothing', () => {
  assert.equal(planBannerMessage(usage({ count: 1, bytes: Math.floor(FREE_BYTES * 0.799) })), null);
});

test('1 of 2 projects at exactly 80% storage shows the storage line', () => {
  const bytes = Math.ceil(FREE_BYTES * NEAR_LIMIT_FRACTION);
  assert.equal(
    planBannerMessage(usage({ count: 1, bytes }), (n) => `${n}B`),
    `You've used ${bytes}B of ${FREE_BYTES}B storage.`
  );
});

test('the default formatter renders human sizes', () => {
  assert.equal(
    planBannerMessage(usage({ count: 0, bytes: FREE_BYTES })),
    "You've used 2 GB of 2 GB storage."
  );
});

test('Standard (unlimited projects) never shows the banner, even near its storage cap', () => {
  const std = PLANS.standard;
  assert.equal(std.maxProjects, null);
  assert.equal(planBannerMessage(usage({ plan: std, count: 50, bytes: 99 * GIB })), null);
  assert.equal(planBannerMessage(usage({ plan: std, count: 0, bytes: 0 })), null);
});
