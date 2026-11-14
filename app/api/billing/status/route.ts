import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { billingActionFor, billingEnabled, PRICE_DISPLAY } from '@/lib/billing';
import { planFor } from '@/lib/plans';
import { getUserBilling } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/**
 * What the account menu should offer: Upgrade, Manage billing, or nothing.
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
  if (!enabled) return NextResponse.json({ action: 'none' });

  try {
    const user = await getUserBilling(session.user.id);
    if (!user) return NextResponse.json({ action: 'none' });
    const action = billingActionFor({
      enabled,
      plan: planFor(user.plan).id,
      subscriptionStatus: user.stripeSubscriptionStatus,
    });
    return NextResponse.json({
      action,
      // Lets a Free user who once paid reach their invoices.
      hasBillingHistory: !!user.stripeCustomerId,
      prices: PRICE_DISPLAY,
    });
  } catch (err) {
    console.error('[api/billing/status]', err instanceof Error ? err.message : err);
    return NextResponse.json({ action: 'none' });
  }
}
