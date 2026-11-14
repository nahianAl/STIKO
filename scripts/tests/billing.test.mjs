import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  billingEnabled,
  planForSubscriptionStatus,
  decideBillingUpdate,
  billingActionFor,
  isBillingInterval,
  PRICE_LOOKUP_KEYS,
} from '../../lib/billing.ts';

test('billing is off unless the flag AND the key are both set', () => {
  assert.equal(billingEnabled({}), false);
  assert.equal(billingEnabled({ BILLING_ENABLED: 'true' }), false);
  assert.equal(billingEnabled({ STRIPE_SECRET_KEY: 'sk_test_x' }), false);
  assert.equal(billingEnabled({ BILLING_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_test_x' }), false);
  assert.equal(billingEnabled({ BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_x' }), true);
});

test('paying statuses keep Standard; everything else is Free', () => {
  for (const s of ['active', 'trialing', 'past_due']) {
    assert.equal(planForSubscriptionStatus(s), 'standard', s);
  }
  for (const s of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', '', null, undefined]) {
    assert.equal(planForSubscriptionStatus(s), 'free', String(s));
  }
});

test('a paying subscription is applied and becomes the tracked one', () => {
  assert.deepEqual(decideBillingUpdate({ subscriptionId: null }, { id: 'sub_1', status: 'active' }), {
    kind: 'apply', plan: 'standard', subscriptionId: 'sub_1', status: 'active',
  });
  assert.deepEqual(decideBillingUpdate({ subscriptionId: 'sub_old' }, { id: 'sub_2', status: 'active' }), {
    kind: 'apply', plan: 'standard', subscriptionId: 'sub_2', status: 'active',
  });
});

test('cancelling the tracked subscription downgrades to Free', () => {
  assert.deepEqual(decideBillingUpdate({ subscriptionId: 'sub_1' }, { id: 'sub_1', status: 'canceled' }), {
    kind: 'apply', plan: 'free', subscriptionId: 'sub_1', status: 'canceled',
  });
});

// The out-of-order case: someone cancels, re-subscribes, and the old
// subscription's final event arrives after the new one is active.
test('a late cancel for an old subscription does not downgrade a re-subscriber', () => {
  const d = decideBillingUpdate({ subscriptionId: 'sub_new' }, { id: 'sub_old', status: 'canceled' });
  assert.equal(d.kind, 'ignore');
});

test('the menu offers the right action', () => {
  assert.equal(billingActionFor({ enabled: false, plan: 'free', subscriptionStatus: null }), 'none');
  assert.equal(billingActionFor({ enabled: true, plan: 'free', subscriptionStatus: null }), 'upgrade');
  assert.equal(billingActionFor({ enabled: true, plan: 'free', subscriptionStatus: 'canceled' }), 'upgrade');
  assert.equal(billingActionFor({ enabled: true, plan: 'standard', subscriptionStatus: 'active' }), 'manage');
  assert.equal(billingActionFor({ enabled: true, plan: 'standard', subscriptionStatus: 'past_due' }), 'manage');
  // Granted by hand, no subscription: nothing to sell, nothing to manage.
  assert.equal(billingActionFor({ enabled: true, plan: 'standard', subscriptionStatus: null }), 'none');
});

test('only month and year are accepted intervals, each with its own price', () => {
  assert.equal(isBillingInterval('month'), true);
  assert.equal(isBillingInterval('year'), true);
  assert.equal(isBillingInterval('week'), false);
  assert.equal(isBillingInterval(undefined), false);
  assert.notEqual(PRICE_LOOKUP_KEYS.month, PRICE_LOOKUP_KEYS.year);
});
