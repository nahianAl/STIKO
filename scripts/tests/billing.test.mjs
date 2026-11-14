import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  billingEnabled,
  planForSubscriptionStatus,
  decideBillingUpdate,
  billingActionFor,
  isBillingInterval,
  summarizeSubscription,
  renewalLine,
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

// --- summarizeSubscription: a Stripe-shaped object -> the status payload ----

/** Just the fields summarizeSubscription reads, in the shape stripe-node returns them. */
function stripeSub(overrides = {}, item = {}) {
  return {
    status: 'active',
    cancel_at: null,
    cancel_at_period_end: false,
    items: {
      data: [{ current_period_end: 1_800_000_000, price: { recurring: { interval: 'month' } }, ...item }],
    },
    ...overrides,
  };
}

test('summarizeSubscription: an active monthly subscription', () => {
  assert.deepEqual(summarizeSubscription(stripeSub()), {
    status: 'active',
    interval: 'month',
    renewsAt: new Date(1_800_000_000 * 1000).toISOString(),
    cancelAtPeriodEnd: false,
    cancelAt: null,
  });
});

test('summarizeSubscription: yearly interval', () => {
  const out = summarizeSubscription(stripeSub({}, { price: { recurring: { interval: 'year' } } }));
  assert.equal(out.interval, 'year');
});

test('summarizeSubscription: an interval Stiko does not sell is null, not passed through', () => {
  assert.equal(summarizeSubscription(stripeSub({}, { price: { recurring: { interval: 'week' } } })).interval, null);
  assert.equal(summarizeSubscription(stripeSub({}, { price: { recurring: null } })).interval, null);
  assert.equal(summarizeSubscription(stripeSub({}, { price: undefined })).interval, null);
});

test('summarizeSubscription: cancel_at_period_end means it cancels, with no separate date', () => {
  const out = summarizeSubscription(stripeSub({ cancel_at_period_end: true }));
  assert.equal(out.cancelAtPeriodEnd, true);
  assert.equal(out.cancelAt, null);
});

test('summarizeSubscription: a scheduled cancel_at means it cancels, and carries its date', () => {
  const out = summarizeSubscription(stripeSub({ cancel_at: 1_790_000_000 }));
  assert.equal(out.cancelAtPeriodEnd, true);
  assert.equal(out.cancelAt, new Date(1_790_000_000 * 1000).toISOString());
});

test('summarizeSubscription: no items means no period and no interval, not a crash', () => {
  const out = summarizeSubscription({ status: 'active', cancel_at: null, cancel_at_period_end: false, items: { data: [] } });
  assert.equal(out.renewsAt, null);
  assert.equal(out.interval, null);
});

test('summarizeSubscription: a missing period end is null, not 1970', () => {
  assert.equal(summarizeSubscription(stripeSub({}, { current_period_end: undefined })).renewsAt, null);
  assert.equal(summarizeSubscription(stripeSub({}, { current_period_end: 0 })).renewsAt, null);
});

// --- renewalLine: the sentence under "Plan" --------------------------------

const ISO = '2027-01-15T00:00:00.000Z';
const fmt = (iso) => `<${iso}>`;
const facts = (o = {}) => ({
  status: 'active',
  interval: 'month',
  renewsAt: ISO,
  cancelAtPeriodEnd: false,
  cancelAt: null,
  ...o,
});

test('renewalLine: renews, with its cadence', () => {
  assert.equal(renewalLine(facts(), fmt), `Renews on <${ISO}> · Monthly`);
  assert.equal(renewalLine(facts({ interval: 'year' }), fmt), `Renews on <${ISO}> · Yearly`);
});

test('renewalLine: no cadence when the interval is unknown', () => {
  assert.equal(renewalLine(facts({ interval: null }), fmt), `Renews on <${ISO}>`);
});

test('renewalLine: cancelling says Cancels, on the scheduled date when there is one', () => {
  const later = '2027-02-01T00:00:00.000Z';
  assert.equal(renewalLine(facts({ cancelAtPeriodEnd: true }), fmt), `Cancels on <${ISO}>`);
  assert.equal(renewalLine(facts({ cancelAtPeriodEnd: true, cancelAt: later }), fmt), `Cancels on <${later}>`);
});

test('renewalLine: nothing to say without a date', () => {
  assert.equal(renewalLine(facts({ renewsAt: null }), fmt), null);
  assert.equal(renewalLine(facts({ renewsAt: null, cancelAtPeriodEnd: true }), fmt), null);
  assert.equal(renewalLine(undefined, fmt), null);
  assert.equal(renewalLine(null, fmt), null);
});

test('renewalLine: only a paid subscription renews or cancels; a churned one says nothing', () => {
  for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
    assert.equal(renewalLine(facts({ status }), fmt), null, status);
    assert.equal(renewalLine(facts({ status, cancelAtPeriodEnd: true }), fmt), null, status);
  }
  for (const status of ['active', 'trialing', 'past_due']) {
    assert.notEqual(renewalLine(facts({ status }), fmt), null, status);
  }
});
