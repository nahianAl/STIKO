import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  billingActionFor,
  billingEnabled,
  planForSubscriptionStatus,
  PRICE_DISPLAY,
  type BillingStatusPayload,
} from '@/lib/billing';
import { limitsEnforced } from '@/lib/planLimits';
import { planFor } from '@/lib/plans';
import { getUserBilling, getUserPlanId, subscriptionSummary } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/**
 * What the account menu, Plan & billing page and pricing page should offer:
 * Upgrade, Manage billing, or nothing, plus the plan and whether limits are on.
 *
 * Renewal facts (`subscription`) are opt-in with `?include=renewal`. They cost
 * a live Stripe call, and this route is hit on load by every surface that shows
 * a plan; only Settings → Plan & billing asks.
 *
 * Separate from /api/me/usage on purpose. If migration 018 is missing this
 * route answers 503 and the billing buttons stay hidden, while the usage
 * meters keep working.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enabled = billingEnabled();
  if (!enabled) {
    // Billing is off, but the plan is still worth knowing: a Standard account
    // granted by hand must not be shown "Coming soon". If the read fails the
    // plan is simply omitted.
    const plan = await getUserPlanId(session.user.id).catch(() => undefined);
    const payload: BillingStatusPayload = { action: 'none', limitsEnforced: false, plan };
    return NextResponse.json(payload);
  }

  const includeRenewal = (new URL(req.url).searchParams.get('include') ?? '')
    .split(',')
    .includes('renewal');

  try {
    const user = await getUserBilling(session.user.id);
    if (!user) return NextResponse.json({ action: 'none' });
    const plan = planFor(user.plan).id;
    const action = billingActionFor({
      enabled,
      plan,
      subscriptionStatus: user.stripeSubscriptionStatus,
    });

    // Renewal facts are a nicety: a Stripe hiccup omits them, never fails the call.
    // Only a paying subscription has anything to renew. Stiko keeps the
    // subscription id after one ends, so a churned user must not trigger a
    // lookup (nor show a past renewal date).
    let subscription: BillingStatusPayload['subscription'];
    if (
      includeRenewal &&
      user.stripeSubscriptionId &&
      planForSubscriptionStatus(user.stripeSubscriptionStatus) === 'standard'
    ) {
      subscription = await subscriptionSummary(user.stripeSubscriptionId).catch((err) => {
        console.error('[api/billing/status] subscription', err instanceof Error ? err.message : err);
        return undefined;
      });
    }
    // The failed-payment notice must survive Stripe being slow: the stored
    // status is enough to say it.
    if (includeRenewal && !subscription && user.stripeSubscriptionStatus === 'past_due') {
      subscription = {
        status: 'past_due',
        interval: null,
        renewsAt: null,
        cancelAtPeriodEnd: false,
        cancelAt: null,
      };
    }

    const payload: BillingStatusPayload = {
      action,
      plan,
      limitsEnforced: limitsEnforced(),
      // Lets a Free user who once paid reach their invoices.
      hasBillingHistory: !!user.stripeCustomerId,
      prices: PRICE_DISPLAY,
      subscription,
    };
    return NextResponse.json(payload);
  } catch (err) {
    console.error('[api/billing/status]', err instanceof Error ? err.message : err);
    // Not 200 {action:'none'}: that reads as "billing is off" and, on /pricing,
    // as "Coming soon". A real failure says so, and every consumer hides its
    // buttons on a non-OK response.
    return NextResponse.json({ error: 'Billing status unavailable' }, { status: 503 });
  }
}
