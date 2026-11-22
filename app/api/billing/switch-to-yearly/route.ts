import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { appBaseUrl } from '@/lib/appUrl';
import { billingEnabled, planForSubscriptionStatus } from '@/lib/billing';
import { getUserBilling, portalConfigurationId, priceIdFor, stripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/**
 * Switch a monthly Standard subscription to yearly.
 *
 * Nothing is changed here. This opens Stripe's billing portal straight on its
 * "confirm this update" screen for the yearly price, which shows the prorated
 * amount and only changes the subscription when the customer confirms. The
 * webhook then syncs it like any other portal change. The portal configuration
 * already allows switching between the two Standard prices
 * (scripts/stripe-setup.mjs, subscription_update).
 *
 * Every condition is re-checked against the LIVE subscription, not the page:
 * the button can be stale, and a yearly or cancelling subscription must not be
 * offered a confirm screen.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!billingEnabled()) {
    return NextResponse.json({ error: 'Billing is not available.' }, { status: 404 });
  }

  try {
    const user = await getUserBilling(session.user.id);
    if (!user?.stripeCustomerId || !user.stripeSubscriptionId) {
      return NextResponse.json({ error: 'No subscription to switch.' }, { status: 404 });
    }

    const sub = await stripe().subscriptions.retrieve(user.stripeSubscriptionId);
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    // The stored id is this user's, but check the subscription agrees.
    if (customerId !== user.stripeCustomerId) {
      return NextResponse.json({ error: 'No subscription to switch.' }, { status: 404 });
    }
    if (planForSubscriptionStatus(sub.status) !== 'standard') {
      return NextResponse.json({ error: 'No subscription to switch.' }, { status: 404 });
    }
    if (sub.cancel_at_period_end || sub.cancel_at != null) {
      return NextResponse.json(
        { error: 'This subscription is set to end. Resume it from Manage billing first.' },
        { status: 409 }
      );
    }
    // Stripe's confirm flow updates exactly one item, and Stiko sells one.
    const item = sub.items.data.length === 1 ? sub.items.data[0] : null;
    if (!item) {
      return NextResponse.json({ error: 'Open Manage billing to change this plan.' }, { status: 409 });
    }
    if (item.price?.recurring?.interval === 'year') {
      return NextResponse.json({ error: "You're already billed yearly." }, { status: 409 });
    }

    const yearly = await priceIdFor('year');
    const base = appBaseUrl();
    const portal = await stripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${base}/pricing`,
      configuration: await portalConfigurationId(),
      flow_data: {
        type: 'subscription_update_confirm',
        subscription_update_confirm: {
          subscription: sub.id,
          items: [{ id: item.id, price: yearly, quantity: item.quantity ?? 1 }],
        },
        after_completion: { type: 'redirect', redirect: { return_url: `${base}/pricing` } },
      },
    });
    return NextResponse.json({ url: portal.url });
  } catch (err) {
    console.error('[api/billing/switch-to-yearly]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not open billing. Please try again.' }, { status: 500 });
  }
}
