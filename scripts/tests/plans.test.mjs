// scripts/tests/plans.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANS,
  DEFAULT_PLAN_ID,
  planFor,
  usageFraction,
} from '../../lib/plans.ts';

test('every tier has a label, a positive byte limit and a valid project limit', () => {
  for (const [id, plan] of Object.entries(PLANS)) {
    assert.equal(plan.id, id, `${id} id matches its key`);
    assert.ok(plan.label.length > 0, `${id} has a label`);
    assert.ok(plan.storageBytes > 0, `${id} has a positive byte limit`);
    assert.ok(
      plan.maxProjects === null ||
        (Number.isInteger(plan.maxProjects) && plan.maxProjects > 0),
      `${id} project limit is null or a positive integer`
    );
  }
});

test('the tiers carry the agreed limits', () => {
  assert.equal(PLANS.free.storageBytes, 2 * 1024 ** 3);
  assert.equal(PLANS.free.maxProjects, 2);
  assert.equal(PLANS.standard.storageBytes, 100 * 1024 ** 3);
  assert.equal(PLANS.standard.maxProjects, null);
});

test('an unrecognised plan resolves to the default rather than throwing', () => {
  // The column has no CHECK constraint, so anything can land in it. A typo in
  // an UPDATE must degrade to Free, never 500 the account menu.
  for (const bad of [null, undefined, '', 'enterprise', 'FREE', '  free  ']) {
    assert.equal(planFor(bad).id, DEFAULT_PLAN_ID, `${JSON.stringify(bad)}`);
  }
});

test('a recognised plan resolves to itself', () => {
  assert.equal(planFor('free').id, 'free');
  assert.equal(planFor('standard').id, 'standard');
});

test('usageFraction is null when the limit is unlimited', () => {
  // null means "draw no bar at all" — a bar with no denominator is meaningless.
  assert.equal(usageFraction(500, null), null);
});

test('usageFraction covers empty, partial, exact and over-limit', () => {
  assert.equal(usageFraction(0, 100), 0);
  assert.equal(usageFraction(25, 100), 0.25);
  assert.equal(usageFraction(100, 100), 1);
  // Over quota is reachable today — nothing enforces these limits.
  assert.equal(usageFraction(250, 100), 1, 'clamps rather than overflowing');
});

test('usageFraction survives junk input', () => {
  assert.equal(usageFraction(-5, 100), 0, 'negative usage floors at 0');
  assert.equal(usageFraction(0, 0), 0, 'zero limit, zero use');
  assert.equal(usageFraction(5, 0), 1, 'zero limit, any use is full');
  assert.equal(usageFraction(Number.NaN, 100), 0);
});
