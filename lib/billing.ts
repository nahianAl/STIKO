/**
 * Billing rules that do not need Stripe or the database, so they can be tested.
 *
 * Stripe is the source of truth for whether someone is paying. Stiko keeps a
 * copy on the users row (plan + subscription id/status) so every page can read
 * the plan without calling Stripe. The webhook and the checkout return route
 * keep that copy in sync, always from a freshly fetched subscription — never
 * from the event payload — so events arriving late or out of order cannot
 * leave the copy wrong.
 */

import type { PlanId } from './plans';

export type BillingInterval = 'month' | 'year';

/**
 * Stripe Price lookup keys. Prices are found by these instead of by ID, so the
 * same code works in test mode and live mode without per-environment config.
 * scripts/stripe-setup.mjs creates prices carrying these keys.
 */
export const PRICE_LOOKUP_KEYS: Record<BillingInterval, string> = Object.freeze({
  month: 'stiko_standard_monthly',
  year: 'stiko_standard_yearly',
});

/** Display only. What is actually charged is whatever the Stripe Price says. */
export const PRICE_DISPLAY: Record<BillingInterval, { perMonth: string; note: string }> =
  Object.freeze({
    month: Object.freeze({ perMonth: '$20', note: 'Billed monthly' }),
    year: Object.freeze({ perMonth: '$18', note: 'Billed $216 yearly' }),
  });

export function isBillingInterval(value: unknown): value is BillingInterval {
  return value === 'month' || value === 'year';
}

/**
 * The kill switch. Billing UI and routes exist only when both are set, so
 * removing BILLING_ENABLED in Vercel turns the whole feature off without a
 * code change. Already-paying customers keep their plan either way: the
 * webhook keeps running whenever the keys are present.
 */
export function billingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.BILLING_ENABLED === 'true' && !!env.STRIPE_SECRET_KEY;
}

/**
 * Subscription statuses that keep the paid plan.
 *
 * past_due stays paid: Stripe is retrying the card, and cutting someone off on
 * the first failed charge punishes an expired card. Stripe moves the
 * subscription to canceled or unpaid when retries run out, and that downgrades.
 */
const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function planForSubscriptionStatus(status: string | null | undefined): PlanId {
  return status && PAID_STATUSES.has(status) ? 'standard' : 'free';
}

export interface StoredBilling {
  subscriptionId: string | null;
}

export interface FreshSubscription {
  id: string;
  status: string;
}

export type BillingUpdate =
  | { kind: 'apply'; plan: PlanId; subscriptionId: string; status: string }
  | { kind: 'ignore'; reason: string };

/**
 * What a freshly fetched subscription should do to the stored copy.
 *
 * A paying subscription always wins and becomes the one tracked. A non-paying
 * one only applies if it IS the tracked subscription (or nothing is tracked):
 * otherwise a late "canceled" for an old subscription would downgrade someone
 * who has since subscribed again.
 */
export function decideBillingUpdate(stored: StoredBilling, sub: FreshSubscription): BillingUpdate {
  const plan = planForSubscriptionStatus(sub.status);
  if (plan === 'standard') {
    return { kind: 'apply', plan, subscriptionId: sub.id, status: sub.status };
  }
  if (stored.subscriptionId === null || stored.subscriptionId === sub.id) {
    return { kind: 'apply', plan, subscriptionId: sub.id, status: sub.status };
  }
  return {
    kind: 'ignore',
    reason: `subscription ${sub.id} is ${sub.status} but ${stored.subscriptionId} is the tracked one`,
  };
}

/** What the account menu shows. */
export type BillingAction = 'upgrade' | 'manage' | 'none';

export function billingActionFor(input: {
  enabled: boolean;
  plan: PlanId;
  subscriptionStatus: string | null;
}): BillingAction {
  if (!input.enabled) return 'none';
  if (planForSubscriptionStatus(input.subscriptionStatus) === 'standard') return 'manage';
  // Standard granted by hand (UPDATE users SET plan = 'standard'), with no
  // subscription behind it: nothing to upgrade to and nothing to manage.
  if (input.plan === 'standard') return 'none';
  return 'upgrade';
}
