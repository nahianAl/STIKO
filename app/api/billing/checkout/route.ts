import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { appBaseUrl } from '@/lib/appUrl';
import { billingEnabled, isBillingInterval, planForSubscriptionStatus } from '@/lib/billing';
import { ensureCustomer, getUserBilling, portalConfigurationId, priceIdFor, stripe } from '@/lib/stripe';
import { track } from '@/lib/analytics/server';

export const dynamic = 'force-dynamic';

/**
 * Start a Stripe Checkout for Standard. Returns { url } for the browser to
 * follow; the payment page is Stripe's, on payments.stiko.design.
 *
 * Called by /billing/checkout. Each step of paying has its own URL, and the
 * Checkout Session ID travels through all of them, so one payment can be
 * traced end to end (pricing, analytics, Stripe and the payments table):
 *   /billing/checkout?interval=…         this route is called
 *   payments.stiko.design/c/pay/cs_…     Stripe's payment page
 *   /api/billing/return?session_id=cs_…  plan synced, payment recorded
 *   /billing/success?txn=STK-…&session_id=cs_…  or  /billing/cancelled?interval=…
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!billingEnabled()) {
    return NextResponse.json({ error: 'Billing is not available.' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const interval = (body as { interval?: unknown }).interval;
  if (!isBillingInterval(interval)) {
    return NextResponse.json({ error: 'interval must be "month" or "year".' }, { status: 400 });
  }

  try {
    const user = await getUserBilling(session.user.id);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const customer = await ensureCustomer(user);
    const base = appBaseUrl();

    // Already paying: a second Checkout would start a second subscription and
    // bill twice. Send them to manage the one they have instead.
    if (planForSubscriptionStatus(user.stripeSubscriptionStatus) === 'standard') {
      const portal = await stripe().billingPortal.sessions.create({
        customer,
        return_url: `${base}/`,
        configuration: await portalConfigurationId(),
      });
      return NextResponse.json({ url: portal.url });
    }

    const checkout = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: user.id,
      line_items: [{ price: await priceIdFor(interval), quantity: 1 }],
      subscription_data: { metadata: { stiko_user_id: user.id } },
      metadata: { stiko_user_id: user.id },
      allow_promotion_codes: true,
      // The return route syncs the plan and records the payment straight away,
      // so the account shows Standard on arrival even if the webhook is a few
      // seconds behind.
      success_url: `${base}/api/billing/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/billing/cancelled?interval=${interval}`,
    });

    if (!checkout.url) throw new Error('Stripe returned a Checkout Session without a URL');
    await track('checkout_started', {
      userId: user.id,
      properties: { interval, stripe_checkout_session_id: checkout.id, stripe_customer_id: customer },
    });
    return NextResponse.json({ url: checkout.url });
  } catch (err) {
    console.error('[api/billing/checkout]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 });
  }
}
