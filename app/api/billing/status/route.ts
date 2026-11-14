import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  billingActionFor,
  billingEnabled,
  PRICE_DISPLAY,
  type BillingStatusPayload,
} from '@/lib/billing';
import { limitsEnforced } from '@/lib/planLimits';
import { planFor } from '@/lib/plans';
import { getUserBilling, subscriptionSummary } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/**
 * What the account menu and the Plan & billing page should offer: Upgrade,
 * Manage billing, or nothing, plus the plan, whether limits are on and renewal facts.
 *
 * Separate from /api/me/usage on purpose. If migration 018 is missing this
 * route fails and the billing buttons stay hidden, while the usage meters
 * keep working.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enabled = billingEnabled();
  if (!enabled) return NextResponse.json({ action: 'none', limitsEnforced: false });

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
    let subscription: BillingStatusPayload['subscription'];
    if (user.stripeSubscriptionId) {
      subscription = await subscriptionSummary(user.stripeSubscriptionId).catch((err) => {
        console.error('[api/billing/status] subscription', err instanceof Error ? err.message : err);
        return undefined;
      });
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
    return NextResponse.json({ action: 'none' });
  }
}
